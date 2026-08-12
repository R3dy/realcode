import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Engine } from "../../src/engine/dispatcher.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import { AgentStageRunner } from "../../src/agents/runner.js";
import { BuildLoopRunner } from "../../src/engine/build-loop.js";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import type { StageGraph } from "../../src/engine/stage-graph.js";
import type { SandboxResult, SandboxOptions } from "../../src/sandbox/runner.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

// ─── Canned artifacts ─────────────────────────────────────────────────────

function workerSuccess(storyId: string): Record<string, unknown> {
  return {
    gate_verdict: "pass",
    gate_notes: "Story implemented, tests passing",
    status: "success",
    artifact: {
      story_id: storyId,
      result: "success",
      branch: "main",
      commits: [{ sha: "abc1234", message: `feat(story-${storyId}): impl` }],
      test_output: "All tests passed",
      test_passed: 5,
      test_failed: 0,
      notes: "",
    },
  };
}

function workerImplFail(storyId: string): Record<string, unknown> {
  return {
    gate_verdict: "escalate",
    gate_notes: "Implementation failure — criteria ambiguous",
    status: "escalated",
    artifact: {
      story_id: storyId,
      result: "failed",
      failure_type: "implementation",
      failure_description: "criteria contradictory",
      branch: "main",
      commits: [],
      test_output: "",
      test_passed: 0,
      test_failed: 0,
      notes: "",
    },
  };
}

function validatorPass(storyId: string): Record<string, unknown> {
  return {
    gate_verdict: "pass",
    gate_notes: "All criteria verified",
    status: "pass",
    artifact: {
      story_id: storyId,
      verdict: "pass",
      criteria_results: [{ criterion: "works", result: "pass", evidence: "tests" }],
      security_checklist: [{ check: "no secrets", result: "pass" }],
      notes: "",
    },
  };
}

function validatorEscalate(storyId: string): Record<string, unknown> {
  return {
    gate_verdict: "pass",
    gate_notes: "Validator ran but verdict is escalate",
    status: "escalate",
    artifact: {
      story_id: storyId,
      verdict: "escalate",
      escalation_type: "security",
      criteria_results: [],
      security_checklist: [{ check: "secrets committed", result: "fail" }],
      notes: "secret detected",
    },
  };
}

// ─── Mock sandbox ──────────────────────────────────────────────────────────

interface MockSandboxConfig {
  workerArtifact?: (storyId: string) => Record<string, unknown>;
  validatorArtifact?: (storyId: string) => Record<string, unknown>;
  costPerCall?: number;
}

function makeMockSandbox(config: MockSandboxConfig = {}) {
  const cost = config.costPerCall ?? 0.08;
  return {
    run: vi.fn(async (opts: SandboxOptions): Promise<SandboxResult> => {
      const roleMatch = opts.dispatchMessage.match(/Role:\s*(\w+)/);
      const role = roleMatch ? roleMatch[1] : "unknown";
      const storyMatch = opts.dispatchMessage.match(/(?:Implement|Validate) story\s+([^\s:]+):/);
      const storyId = storyMatch ? storyMatch[1] : "unknown";

      let artifact: Record<string, unknown>;
      if (role === "build_worker") {
        artifact = config.workerArtifact
          ? config.workerArtifact(storyId)
          : workerSuccess(storyId);
      } else if (role === "build_validator") {
        artifact = config.validatorArtifact
          ? config.validatorArtifact(storyId)
          : validatorPass(storyId);
      } else {
        artifact = { gate_verdict: "pass", gate_notes: `${role} done`, status: "pass", artifact: {} };
      }

      return {
        exitCode: 0,
        stdout: `Agent output for ${role}...\n<artifact>\n${JSON.stringify(artifact, null, 2)}\n</artifact>`,
        stderr: "",
        jsonEvents: [{ part: { tokens: { input: 2000, output: 800, total: 2800 }, cost } }],
        timedOut: false,
        containerId: "",
      };
    }),
  };
}

// ─── Test harness ──────────────────────────────────────────────────────────

let tmpDir: string;
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-buildloop-e2e-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
});

afterEach(() => {
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setupRunAtSpecified(
  stories: Array<{ id: string; title: string; acceptance_criteria: string[]; depends_on?: string[] }>,
  opts?: { capUsd?: number; spentUsd?: number },
): { engine: Engine; mockSandbox: ReturnType<typeof makeMockSandbox>; runId: string; sandboxConfig: MockSandboxConfig } {
  const runId = `run_bl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workspace = `${tmpDir}/workspaces/${runId}`;
  fs.mkdirSync(workspace, { recursive: true });

  // Write spec.json
  storage.write(`runs/${runId}/spec.json`, JSON.stringify({
    artifact: {
      epics_md: "# Epics",
      backlog_md: "# Backlog",
      dependency_graph: "graph",
      story_count: stories.length,
      stories,
    },
    stage: "spec",
    run_id: runId,
  }, null, 2));

  // Write run.json
  storage.write(`runs/${runId}/run.json`, JSON.stringify({
    run_id: runId,
    idea: "test idea",
    status: "specified",
    spent_usd: opts?.spentUsd ?? 0,
    cap_usd: opts?.capUsd ?? graph.cost_cap_usd_per_run,
    created_at: Date.now(),
    workspace_path: workspace,
  }, null, 2));

  // Write control.json
  storage.write("control.json", JSON.stringify({
    run_mode: "continuous",
    concurrency: 1,
    per_stage_model_overrides: {},
    cost_cap_usd: graph.cost_cap_usd_per_run,
    updated_at: Date.now(),
    updated_by: "test",
  }, null, 2));

  // Publish a work item at "specified" status
  queue.publish({
    run_id: runId,
    stage: "build",
    status: "specified",
    payload: { idea: "test", workspace, trace_id: `trace_${runId}` },
  });

  const sandboxConfig: MockSandboxConfig = {};
  const mockSandbox = makeMockSandbox(sandboxConfig);
  const runner = new AgentStageRunner(mockSandbox as unknown as SandboxRunner, storage, graph, {
    localMode: true,
    repoRoot: REPO_ROOT,
  });
  const buildLoopRunner = new BuildLoopRunner(runner, storage, graph, queue, { repoRoot: REPO_ROOT });
  const engine = new Engine(graph, queue, storage, runner, tmpDir, buildLoopRunner);

  return { engine, mockSandbox, runId, sandboxConfig };
}

function readBuildState(runId: string): Record<string, unknown> | null {
  const raw = storage.read(`runs/${runId}/build-state.json`);
  if (!raw) return null;
  return JSON.parse(raw);
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Build-loop integration: Engine → Dispatcher → BuildLoopRunner → AgentStageRunner → mock sandbox", () => {
  it("drives a 3-story run from specified to built, dispatching Worker→Validator per story", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"] },
      { id: "S3", title: "Story 3", acceptance_criteria: ["crit 3"] },
    ];
    const { engine, mockSandbox, runId } = setupRunAtSpecified(stories);

    const dispatched = await engine.dispatchCycle();

    expect(dispatched).toBe(1);
    const run = engine.getRun(runId)!;
    expect(run.status).toBe("built");

    // 3 stories × 2 (worker+validator) = 6 sandbox calls
    expect(mockSandbox.run).toHaveBeenCalledTimes(6);

    // Verify dispatch order: worker(S1), validator(S1), worker(S2), validator(S2), worker(S3), validator(S3)
    const calls = (mockSandbox.run as ReturnType<typeof vi.fn>).mock.calls;
    const dispatchOrder = calls.map((c: [SandboxOptions]) => {
      const roleM = c[0].dispatchMessage.match(/Role:\s*(\w+)/);
      const storyM = c[0].dispatchMessage.match(/(?:Implement|Validate) story\s+([^\s:]+):/);
      return { role: roleM?.[1], story: storyM?.[1] };
    });
    expect(dispatchOrder).toEqual([
      { role: "build_worker", story: "S1" },
      { role: "build_validator", story: "S1" },
      { role: "build_worker", story: "S2" },
      { role: "build_validator", story: "S2" },
      { role: "build_worker", story: "S3" },
      { role: "build_validator", story: "S3" },
    ]);

    // build-state.json written with all stories done
    const state = readBuildState(runId);
    expect(state).not.toBeNull();
    expect(state!.stories).toHaveLength(3);
    expect((state!.stories as Array<{ status: string }>).every((s) => s.status === "done")).toBe(true);

    // build.json artifact stored
    const buildRaw = storage.read(`runs/${runId}/build.json`);
    expect(buildRaw).not.toBeNull();
    const buildParsed = JSON.parse(buildRaw!);
    expect(buildParsed.stage).toBe("build");
    expect(buildParsed.output_status).toBe("pass");
    expect(buildParsed.artifact.stories).toHaveLength(3);

    // Cost tracking: run.spent_usd > 0 (6 calls × 0.08 = 0.48)
    expect(run.spent_usd).toBeGreaterThan(0);
    expect(run.spent_usd).toBeCloseTo(0.48, 2);
  });

  it("writes build-state.json with per-story worker/validator tokens and cost", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { engine, runId } = setupRunAtSpecified(stories);

    await engine.dispatchCycle();

    const state = readBuildState(runId)!;
    const stateStories = state.stories as Array<Record<string, unknown>>;
    expect(stateStories).toHaveLength(2);
    for (const s of stateStories) {
      expect(s.worker_tokens).toBeGreaterThan(0);
      expect(s.validator_tokens).toBeGreaterThan(0);
      expect(s.worker_cost_usd).toBeGreaterThan(0);
      expect(s.validator_cost_usd).toBeGreaterThan(0);
      expect(s.status).toBe("done");
    }
  });

  it("escalates on worker implementation failure (gate_verdict escalate)", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { engine, mockSandbox, runId } = setupRunAtSpecified(stories);

    // Override mock: worker fails on S1 with implementation failure
    const mockRun = mockSandbox.run as ReturnType<typeof vi.fn>;
    mockRun.mockImplementation(async (opts: SandboxOptions) => {
      const roleMatch = opts.dispatchMessage.match(/Role:\s*(\w+)/);
      const role = roleMatch ? roleMatch[1] : "unknown";
      const storyMatch = opts.dispatchMessage.match(/(?:Implement|Validate) story\s+([^\s:]+):/);
      const storyId = storyMatch ? storyMatch[1] : "unknown";
      const artifact = role === "build_worker" ? workerImplFail(storyId) : validatorPass(storyId);
      return {
        exitCode: 0,
        stdout: `<artifact>\n${JSON.stringify(artifact, null, 2)}\n</artifact>`,
        stderr: "",
        jsonEvents: [{ part: { tokens: { input: 2000, output: 800, total: 2800 }, cost: 0.08 } }],
        timedOut: false,
        containerId: "",
      };
    });

    const dispatched = await engine.dispatchCycle();

    expect(dispatched).toBe(1);
    const run = engine.getRun(runId)!;
    expect(run.status).toBe("escalated");

    // Only 1 worker dispatch (escalates immediately, no validator)
    expect(mockRun).toHaveBeenCalledTimes(1);

    // build-state.json shows S1 escalated, S2 pending
    const state = readBuildState(runId)!;
    const stateStories = state.stories as Array<{ status: string; story_id: string }>;
    expect(stateStories[0].status).toBe("escalated");
    expect(stateStories[0].story_id).toBe("S1");
    expect(stateStories[1].status).toBe("pending");

    // build.json stored with escalation info
    const buildRaw = storage.read(`runs/${runId}/build.json`);
    const buildParsed = JSON.parse(buildRaw!);
    expect(buildParsed.output_status).toBe("escalate");
    expect(buildParsed.artifact.gate_notes).toContain("escalated");
  });

  it("escalates when validator returns escalate verdict (gate_verdict pass, verdict escalate)", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { engine, mockSandbox, runId } = setupRunAtSpecified(stories);

    // Override mock: validator returns escalate verdict on S1
    const mockRun = mockSandbox.run as ReturnType<typeof vi.fn>;
    mockRun.mockImplementation(async (opts: SandboxOptions) => {
      const roleMatch = opts.dispatchMessage.match(/Role:\s*(\w+)/);
      const role = roleMatch ? roleMatch[1] : "unknown";
      const storyMatch = opts.dispatchMessage.match(/(?:Implement|Validate) story\s+([^\s:]+):/);
      const storyId = storyMatch ? storyMatch[1] : "unknown";
      const artifact = role === "build_worker"
        ? workerSuccess(storyId)
        : validatorEscalate(storyId);
      return {
        exitCode: 0,
        stdout: `<artifact>\n${JSON.stringify(artifact, null, 2)}\n</artifact>`,
        stderr: "",
        jsonEvents: [{ part: { tokens: { input: 2000, output: 800, total: 2800 }, cost: 0.08 } }],
        timedOut: false,
        containerId: "",
      };
    });

    await engine.dispatchCycle();

    const run = engine.getRun(runId)!;
    expect(run.status).toBe("escalated");

    // Worker(S1) + Validator(S1) = 2 calls (escalates on validator verdict)
    expect(mockRun).toHaveBeenCalledTimes(2);

    const state = readBuildState(runId)!;
    const stateStories = state.stories as Array<{ status: string; story_id: string }>;
    expect(stateStories[0].status).toBe("escalated");
    expect(stateStories[1].status).toBe("pending");

    const buildRaw = storage.read(`runs/${runId}/build.json`);
    const buildParsed = JSON.parse(buildRaw!);
    expect(buildParsed.output_status).toBe("escalate");
    expect(buildParsed.artifact.gate_notes).toContain("validator escalate verdict");
  });

  it("escalates when cost cap is exceeded mid-loop", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"] },
      { id: "S3", title: "Story 3", acceptance_criteria: ["crit 3"] },
    ];
    // cap = 0.15: story 1 worker(0.08)+validator(0.08)=0.16 >= 0.15 → escalate before story 2
    const { engine, mockSandbox, runId } = setupRunAtSpecified(stories, { capUsd: 0.15 });

    await engine.dispatchCycle();

    const run = engine.getRun(runId)!;
    expect(run.status).toBe("escalated");

    // Only story 1 dispatched (worker + validator) = 2 calls
    expect(mockSandbox.run).toHaveBeenCalledTimes(2);

    const state = readBuildState(runId)!;
    const stateStories = state.stories as Array<{ status: string; story_id: string }>;
    expect(stateStories[0].status).toBe("done");
    expect(stateStories[0].story_id).toBe("S1");
    expect(stateStories[1].status).toBe("pending");

    const buildRaw = storage.read(`runs/${runId}/build.json`);
    const buildParsed = JSON.parse(buildRaw!);
    expect(buildParsed.output_status).toBe("escalate");
    expect(buildParsed.artifact.gate_notes).toContain("cost cap hit mid-loop");
    expect(buildParsed.artifact.gate_notes).toContain("1/3 stories done");
  });

  it("processes stories in dependency order (S2 waits for S1)", async () => {
    const stories = [
      { id: "S1", title: "Story 1", acceptance_criteria: ["crit 1"], depends_on: [] },
      { id: "S2", title: "Story 2", acceptance_criteria: ["crit 2"], depends_on: ["S1"] },
      { id: "S3", title: "Story 3", acceptance_criteria: ["crit 3"], depends_on: ["S2"] },
    ];
    const { engine, mockSandbox, runId } = setupRunAtSpecified(stories);

    await engine.dispatchCycle();

    const run = engine.getRun(runId)!;
    expect(run.status).toBe("built");

    // Verify dispatch order respects dependencies: S1 → S2 → S3
    const calls = (mockSandbox.run as ReturnType<typeof vi.fn>).mock.calls;
    const dispatchOrder = calls.map((c: [SandboxOptions]) => {
      const storyM = c[0].dispatchMessage.match(/(?:Implement|Validate) story\s+([^\s:]+):/);
      return storyM?.[1];
    });
    expect(dispatchOrder).toEqual(["S1", "S1", "S2", "S2", "S3", "S3"]);
  });
});
