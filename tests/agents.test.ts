import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { loadAgentSpec, AgentSpecSchema } from "../src/agents/spec-loader.js";
import { AgentStageRunner } from "../src/agents/runner.js";
import { loadStageGraph } from "../src/engine/stage-graph.js";
import { FileStorage } from "../src/backend/index.js";
import type { StageEntry, StageGraph } from "../src/engine/stage-graph.js";
import type { WorkItem } from "../backend/types.js";
import type { SandboxResult } from "../src/sandbox/runner.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

function makeMockSandbox(stdout: string, exitCode = 0, timedOut = false) {
  const mockResult: SandboxResult = {
    exitCode,
    stdout,
    stderr: "",
    jsonEvents: [
      {
        part: {
          tokens: { input: 1000, output: 500, total: 1500 },
          cost: 0.05,
        },
      },
    ],
    timedOut,
  };
  return {
    run: vi.fn().mockResolvedValue(mockResult),
    extractTokenUsage: vi.fn().mockReturnValue({
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      estimated_cost_usd: 0.05,
    }),
  };
}

function makeFrameArtifact(): string {
  const artifact = {
    gate_verdict: "pass",
    gate_notes: "PROJECT.md captures identity and scope",
    status: "framed",
    revisions_used: 0,
    artifact: {
      project_md: "# Test Project\n\nA test project for the frame stage.",
      project_type: "saas",
      has_ui: true,
      is_sellable: true,
    },
  };
  return `<artifact>\n${JSON.stringify(artifact, null, 2)}\n</artifact>`;
}

describe("AgentSpec loader", () => {
  it("loads and validates the frame agent spec", () => {
    const spec = loadAgentSpec(path.resolve(REPO_ROOT, "agent-specs/frame.yaml"));
    expect(spec.stage).toBe("frame");
    expect(spec.anymake_phase).toBe(0);
    expect(spec.system_prompt).toContain("Phase 0");
    expect(spec.user_prompt_template).toContain("{idea}");
    expect(spec.tool_allowlist).toContain("Read");
    expect(spec.model_tier).toBe(1);
    expect(spec.permission_mode).toBe("unattended");
  });

  it("loads and validates all 6 agent specs", () => {
    const stages = ["frame", "discover", "plan", "spec", "build", "ship"];
    for (const stage of stages) {
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, `agent-specs/${stage}.yaml`));
      expect(spec.stage).toBe(stage);
      expect(spec.system_prompt.length).toBeGreaterThan(50);
      expect(spec.user_prompt_template.length).toBeGreaterThan(10);
      expect(spec.tool_allowlist.length).toBeGreaterThan(0);
    }
  });

  it("rejects an agent spec missing required fields", () => {
    const bad = { stage: "test" };
    const result = AgentSpecSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects an invalid model_tier", () => {
    const result = AgentSpecSchema.safeParse({
      stage: "test",
      anymake_phase: 0,
      system_prompt: "x",
      user_prompt_template: "y",
      tool_allowlist: ["Read"],
      model_tier: 5,
      permission_mode: "unattended",
    });
    expect(result.success).toBe(false);
  });
});

describe("AgentStageRunner", () => {
  let tmpDir: string;
  let storage: FileStorage;
  let graph: StageGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-test-"));
    storage = new FileStorage(tmpDir);
    graph = loadStageGraph(GRAPH_PATH);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("resolveModel", () => {
    it("uses the tier env var for the stage's model tier", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stage = graph.stages[0]; // frame, tier 1
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, stage.agent_spec));

      process.env.ANYMAKE_MODEL_TIER1 = "anthropic/claude-sonnet-4";
      expect(runner.resolveModel(stage, spec)).toBe("anthropic/claude-sonnet-4");
      delete process.env.ANYMAKE_MODEL_TIER1;
    });

    it("falls back to TIER1 env var then default", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stage = graph.stages[4]; // build, tier 3
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, stage.agent_spec));

      delete process.env.ANYMAKE_MODEL_TIER3;
      delete process.env.ANYMAKE_MODEL_TIER1;
      expect(runner.resolveModel(stage, spec)).toBe("openrouter/z-ai/glm-5.2");

      process.env.ANYMAKE_MODEL_TIER1 = "fallback-model";
      expect(runner.resolveModel(stage, spec)).toBe("fallback-model");
      delete process.env.ANYMAKE_MODEL_TIER1;
    });

    it("uses tier 3 env for build stage", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stage = graph.stages[4]; // build, tier 3
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, stage.agent_spec));

      process.env.ANYMAKE_MODEL_TIER3 = "economy-model";
      expect(runner.resolveModel(stage, spec)).toBe("economy-model");
      delete process.env.ANYMAKE_MODEL_TIER3;
    });
  });

  describe("fillTemplate", () => {
    it("fills simple placeholders", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const result = runner.fillTemplate("Idea: {idea}, workspace: {workspace}", {
        idea: "build a SaaS",
        workspace: "/tmp/ws",
      });
      expect(result).toBe("Idea: build a SaaS, workspace: /tmp/ws");
    });

    it("fills nested object fields from prior artifacts", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const result = runner.fillTemplate("Type: {frame.project_type}, UI: {frame.has_ui}", {
        frame: { project_type: "saas", has_ui: true },
      });
      expect(result).toBe("Type: saas, UI: true");
    });

    it("leaves unmatched placeholders as-is", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const result = runner.fillTemplate("Missing: {nonexistent.field}", {});
      expect(result).toBe("Missing: {nonexistent.field}");
    });

    it("truncates long string values", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const longStr = "x".repeat(10000);
      const result = runner.fillTemplate("Content: {content}", { content: longStr });
      expect(result).toContain("[truncated]");
      expect(result.length).toBeLessThan(8200);
    });
  });

  describe("extractArtifact", () => {
    it("extracts JSON from artifact tags", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `Some agent output here...\n<artifact>\n{"gate_verdict": "pass", "status": "framed", "artifact": {}}\n</artifact>\nDone.`;
      const result = runner.extractArtifact(stdout);
      expect(result).not.toBeNull();
      expect(result!.gate_verdict).toBe("pass");
      expect(result!.status).toBe("framed");
    });

    it("returns null when no artifact tags present", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      expect(runner.extractArtifact("just regular text output")).toBeNull();
    });

    it("returns null for invalid JSON in tags", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `<artifact>not valid json</artifact>`;
      expect(runner.extractArtifact(stdout)).toBeNull();
    });

    it("uses the LAST artifact block when multiple present", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `<artifact>{"gate_verdict": "needs_changes"}</artifact>\nretry...\n<artifact>{"gate_verdict": "pass", "status": "framed", "artifact": {}}</artifact>`;
      const result = runner.extractArtifact(stdout);
      expect(result!.gate_verdict).toBe("pass");
    });

    it("strips a ```json markdown code fence wrapping the artifact", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `<artifact>\n\`\`\`json\n{"gate_verdict": "pass", "status": "framed", "artifact": {}}\n\`\`\`\n</artifact>`;
      const result = runner.extractArtifact(stdout);
      expect(result).not.toBeNull();
      expect(result!.gate_verdict).toBe("pass");
      expect(result!.status).toBe("framed");
    });

    it("strips a bare ``` fence wrapping the artifact", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `<artifact>\n\`\`\`\n{"gate_verdict": "pass", "status": "framed", "artifact": {}}\n\`\`\`\n</artifact>`;
      const result = runner.extractArtifact(stdout);
      expect(result).not.toBeNull();
      expect(result!.gate_verdict).toBe("pass");
    });

    it("brace-matches the JSON when prose precedes/follows it inside the tags", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const stdout = `<artifact>\nHere is the result:\n{"gate_verdict": "pass", "status": "framed", "artifact": {}}\n(end)\n</artifact>`;
      const result = runner.extractArtifact(stdout);
      expect(result).not.toBeNull();
      expect(result!.gate_verdict).toBe("pass");
    });

    it("extracts text from any event part carrying a text field (not just type=text)", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const events = [
        { part: { type: "reasoning", text: "<artifact>{\"gate_verdict\": \"pass\", \"status\": \"framed\", \"artifact\": {}}</artifact>", time: { start: 1, end: 2 } } },
      ];
      const result = runner.extractArtifact("", events);
      expect(result).not.toBeNull();
      expect(result!.gate_verdict).toBe("pass");
    });
  });

  describe("gatherPriorArtifacts", () => {
    it("returns idea from intake payload for the first stage", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      const ctx = runner.gatherPriorArtifacts("run_001", "frame", { idea: "build a CLI tool" });
      expect(ctx.idea).toBe("build a CLI tool");
    });

    it("reads prior stage artifacts from storage", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      storage.write("runs/run_001/frame.json", JSON.stringify({
        artifact: { project_md: "# Project", project_type: "saas", has_ui: true, is_sellable: true },
      }));
      const ctx = runner.gatherPriorArtifacts("run_001", "discover", { idea: "build a SaaS" });
      expect(ctx.frame).toBeDefined();
      expect((ctx.frame as Record<string, unknown>).project_type).toBe("saas");
    });

    it("skips corrupted prior artifacts", () => {
      const sandbox = makeMockSandbox("");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });
      storage.write("runs/run_001/frame.json", "not json{{{");
      const ctx = runner.gatherPriorArtifacts("run_001", "discover", { idea: "test" });
      expect(ctx.idea).toBe("test");
      expect(ctx.frame).toBeUndefined();
    });
  });

  describe("run (integration with mock sandbox)", () => {
    it("processes a frame stage item end-to-end and returns gate_verdict as output_status", async () => {
      const sandbox = makeMockSandbox(makeFrameArtifact());
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT, localMode: true });

      const item: WorkItem = {
        id: "item_001",
        run_id: "run_001",
        stage: "frame",
        status: "intake",
        retry_count: 0,
        worker_id: "worker-0",
        lease_expires_at: null,
        payload: { idea: "Build a SaaS for managing personal finances", workspace: "/tmp/ws" },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const stage = graph.stages[0]; // frame

      const result = await runner.run(item, stage, "/tmp/ws");

      expect(result.output_status).toBe("pass");
      expect(result.artifact.project_md).toContain("# Test Project");
      expect(result.artifact.project_type).toBe("saas");
      expect(result.token_usage.estimated_cost_usd).toBe(0.05);
      expect(result.trace_id).toBe("run_001");

      expect(sandbox.run).toHaveBeenCalledTimes(1);
      const callArgs = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.model).toBe("openrouter/z-ai/glm-5.2");
      expect(callArgs.localMode).toBe(true);
      expect(callArgs.dispatchMessage).toContain("Phase 0");
      expect(callArgs.dispatchMessage).toContain("<artifact>");
      expect(callArgs.dispatchMessage).toContain("Build a SaaS for managing personal finances");
    });

    it("returns escalate when sandbox fails (non-zero exit)", async () => {
      const sandbox = makeMockSandbox("", 1, false);
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });

      const item: WorkItem = {
        id: "item_002",
        run_id: "run_002",
        stage: "frame",
        status: "intake",
        retry_count: 0,
        worker_id: "worker-0",
        lease_expires_at: null,
        payload: { idea: "test idea" },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const stage = graph.stages[0];

      const result = await runner.run(item, stage, "/tmp/ws");
      expect(result.output_status).toBe("escalate");
      expect(result.artifact.error).toContain("sandbox failed");
    });

    it("returns escalate when no artifact block is found", async () => {
      const sandbox = makeMockSandbox("agent ran but produced no artifact JSON");
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });

      const item: WorkItem = {
        id: "item_003",
        run_id: "run_003",
        stage: "frame",
        status: "intake",
        retry_count: 0,
        worker_id: "worker-0",
        lease_expires_at: null,
        payload: { idea: "test" },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const stage = graph.stages[0];

      const result = await runner.run(item, stage, "/tmp/ws");
      expect(result.output_status).toBe("escalate");
      expect(result.artifact.error).toContain("No <artifact>");
    });

    it("returns escalate when artifact fails schema validation", async () => {
      const badArtifact = `<artifact>\n${JSON.stringify({
        gate_verdict: "pass",
        status: "framed",
        artifact: { project_md: "", project_type: "invalid_type", has_ui: true, is_sellable: true },
      })}\n</artifact>`;
      const sandbox = makeMockSandbox(badArtifact);
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });

      const item: WorkItem = {
        id: "item_004",
        run_id: "run_004",
        stage: "frame",
        status: "intake",
        retry_count: 0,
        worker_id: "worker-0",
        lease_expires_at: null,
        payload: { idea: "test" },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const stage = graph.stages[0];

      const result = await runner.run(item, stage, "/tmp/ws");
      expect(result.output_status).toBe("escalate");
      expect(result.artifact.error).toContain("validation failed");
    });

    it("fills the user prompt template with prior stage artifacts", async () => {
      const planArtifact = `<artifact>\n${JSON.stringify({
        gate_verdict: "pass",
        gate_notes: "planning complete",
        status: "planned",
        revisions_used: 0,
        artifact: {
          prd_md: "# PRD\nA product requirements doc.",
          adrs: [{ id: "ADR-001", title: "Stack choice", status: "Accepted" }],
          ux_design_md: "# UX Design\nDesign system spec.",
        },
      })}\n</artifact>`;

      storage.write("runs/run_005/frame.json", JSON.stringify({
        artifact: {
          project_md: "# Finance SaaS\nA personal finance app.",
          project_type: "saas",
          has_ui: true,
          is_sellable: true,
        },
      }));
      storage.write("runs/run_005/discover.json", JSON.stringify({
        artifact: {
          discovery_md: "# Discovery\nPrior art found.",
          lite_mode: false,
          failure_modes: [{ mode: "cost overrun", mitigation: "budget caps" }],
        },
      }));

      const sandbox = makeMockSandbox(planArtifact);
      const runner = new AgentStageRunner(sandbox as never, storage, graph, { repoRoot: REPO_ROOT });

      const item: WorkItem = {
        id: "item_005",
        run_id: "run_005",
        stage: "plan",
        status: "discovered",
        retry_count: 0,
        worker_id: "worker-0",
        lease_expires_at: null,
        payload: { idea: "finance SaaS", workspace: "/tmp/ws" },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const stage = graph.stages[2]; // plan

      const result = await runner.run(item, stage, "/tmp/ws");

      expect(result.output_status).toBe("pass");
      const callArgs = (sandbox.run as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.dispatchMessage).toContain("# Finance SaaS");
      expect(callArgs.dispatchMessage).toContain("saas");
      expect(callArgs.dispatchMessage).toContain("# Discovery");
    });
  });
});

describe("Dispatcher transition fix (hard gate)", () => {
  it("dispatcher source uses item.status as 'from' and result.output_status as 'on' (not hardcoded 'pass')", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/engine/dispatcher.ts"), "utf8");
    expect(src).not.toMatch(/applyTransition\([^,]+,\s*[^,]+,\s*result\.output_status,\s*["']pass["']\)/);
    expect(src).toMatch(/applyTransition\([^,]+,\s*[^,]+,\s*item\.status,\s*result\.output_status\)/);
  });
});
