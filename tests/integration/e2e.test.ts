import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Engine } from "../../src/engine/dispatcher.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import { AgentStageRunner } from "../../src/agents/runner.js";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import type { StageGraph } from "../../src/engine/stage-graph.js";
import type { SandboxResult, SandboxOptions } from "../../src/sandbox/runner.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

const STAGE_ARTIFACTS: Record<string, Record<string, unknown>> = {
  frame: {
    gate_verdict: "pass",
    gate_notes: "PROJECT.md captures identity, scope, success model",
    status: "framed",
    revisions_used: 0,
    artifact: {
      project_md: "# FinanceFlow\n\nA SaaS for personal finance management.",
      project_type: "saas",
      has_ui: true,
      is_sellable: true,
    },
  },
  discover: {
    gate_verdict: "pass",
    gate_notes: "Discovery complete with prior art and failure modes",
    status: "discovered",
    revisions_used: 0,
    artifact: {
      discovery_md: "# Discovery\n\nPrior art: Mint, YNAB, Monarch.\nFailure modes identified.",
      lite_mode: false,
      failure_modes: [
        { mode: "cost overrun from LLM API", mitigation: "budget caps per run" },
        { mode: "user churn", mitigation: "onboarding flow" },
      ],
    },
  },
  plan: {
    gate_verdict: "pass",
    gate_notes: "PRD + ADRs + UX design produced",
    status: "planned",
    revisions_used: 0,
    artifact: {
      prd_md: "# PRD\n\nProduct requirements for FinanceFlow.",
      adrs: [
        { id: "ADR-001", title: "Next.js + Postgres stack", status: "Accepted" },
        { id: "ADR-002", title: "Stripe for billing", status: "Accepted" },
      ],
      ux_design_md: "# UX Design\n\nDesign system + component library.",
    },
  },
  spec: {
    gate_verdict: "pass",
    gate_notes: "Backlog with 8 stories across 3 epics",
    status: "specified",
    revisions_used: 0,
    artifact: {
      epics_md: "# Epics\n\nE1: Auth\nE2: Dashboard\nE3: Transactions",
      backlog_md: "# Backlog\n\n1. E1.1: Login\n2. E1.2: Signup\n3. E2.1: Dashboard\n4. E2.2: Charts\n5. E3.1: Add transaction\n6. E3.2: Categorize\n7. E3.3: Import\n8. E3.4: Export",
      dependency_graph: "E1.1 -> E1.2 -> E2.1 -> E2.2 -> E3.1 -> E3.2 -> E3.3 -> E3.4",
      story_count: 8,
      stories: [
        { id: "E1.1", title: "Login", epic: "E1: Auth", acceptance_criteria: ["user can log in"], depends_on: [] },
        { id: "E1.2", title: "Signup", epic: "E1: Auth", acceptance_criteria: ["user can sign up"], depends_on: ["E1.1"] },
        { id: "E2.1", title: "Dashboard", epic: "E2: Dashboard", acceptance_criteria: ["dashboard renders"], depends_on: ["E1.2"] },
        { id: "E2.2", title: "Charts", epic: "E2: Dashboard", acceptance_criteria: ["charts render"], depends_on: ["E2.1"] },
        { id: "E3.1", title: "Add transaction", epic: "E3: Transactions", acceptance_criteria: ["can add a transaction"], depends_on: ["E2.1"] },
        { id: "E3.2", title: "Categorize", epic: "E3: Transactions", acceptance_criteria: ["can categorize"], depends_on: ["E3.1"] },
        { id: "E3.3", title: "Import", epic: "E3: Transactions", acceptance_criteria: ["can import"], depends_on: ["E3.1"] },
        { id: "E3.4", title: "Export", epic: "E3: Transactions", acceptance_criteria: ["can export"], depends_on: ["E3.1"] },
      ],
    },
  },
  build: {
    gate_verdict: "pass",
    gate_notes: "All 8 stories built, tests passing, 3 PRs merged",
    status: "built",
    revisions_used: 0,
    escalation_count: 0,
    artifact: {
      repo_path: "/workspace/financeflow",
      test_results: { passed: 42, failed: 0, skipped: 2, coverage_pct: 87 },
      prs_merged: [
        { number: 1, title: "feat: auth flow", url: "https://github.com/test/financeflow/pull/1" },
        { number: 2, title: "feat: dashboard + charts", url: "https://github.com/test/financeflow/pull/2" },
        { number: 3, title: "feat: transactions", url: "https://github.com/test/financeflow/pull/3" },
      ],
      escalations: [],
    },
  },
  ship: {
    gate_verdict: "pass",
    gate_notes: "Deployed to Vercel, metrics configured",
    status: "shipped",
    revisions_used: 0,
    artifact: {
      live_url: "https://financeflow.vercel.app",
      launch_checklist_md: "# Launch Checklist\n\n- [x] Deployed\n- [x] DNS configured\n- [x] Metrics flowing",
      metrics_dashboard_md: "# Metrics Dashboard\n\nThroughput, cost, error rate configured.",
    },
  },
};

function makeMockSandbox() {
  return {
    run: vi.fn(async (opts: SandboxOptions): Promise<SandboxResult> => {
      const stageMatch = opts.dispatchMessage.match(/Stage:\s*(\w+)/);
      const stageId = stageMatch ? stageMatch[1] : "unknown";
      const artifact = STAGE_ARTIFACTS[stageId];
      if (!artifact) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Unknown stage: ${stageId}`,
          jsonEvents: [],
          timedOut: false,
        };
      }
      return {
        exitCode: 0,
        stdout: `Agent output for ${stageId}...\n<artifact>\n${JSON.stringify(artifact, null, 2)}\n</artifact>`,
        stderr: "",
        jsonEvents: [
          {
            part: {
              tokens: { input: 2000, output: 800, total: 2800 },
              cost: 0.08,
            },
          },
        ],
        timedOut: false,
      };
    }),
  };
}

describe("E2E: synthetic run through all 6 stages", () => {
  let tmpDir: string;
  let queue: SQLiteQueue;
  let storage: FileStorage;
  let graph: StageGraph;
  let engine: Engine;
  let mockSandbox: ReturnType<typeof makeMockSandbox>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-e2e-"));
    graph = loadStageGraph(GRAPH_PATH);
    queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
    storage = new FileStorage(tmpDir);
    mockSandbox = makeMockSandbox();
    const runner = new AgentStageRunner(mockSandbox as unknown as SandboxRunner, storage, graph, {
      localMode: true,
      repoRoot: REPO_ROOT,
    });
    engine = new Engine(graph, queue, storage, runner, tmpDir);
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("moves a work item from intake to shipped through all 6 stages", async () => {
    const runId = "run_e2e_001";
    const idea = "Build a SaaS for personal finance management";
    engine.createRun(runId, idea);

    let dispatched = 0;
    const stageSequence: string[] = [];
    for (let i = 0; i < 6; i++) {
      const count = await engine.dispatchCycle();
      dispatched += count;
      const run = engine.getRun(runId)!;
      stageSequence.push(run.status);
    }

    const finalRun = engine.getRun(runId)!;
    expect(finalRun.status).toBe("shipped");
    expect(dispatched).toBe(6);

    expect(stageSequence).toEqual([
      "framed",
      "discovered",
      "planned",
      "specified",
      "built",
      "shipped",
    ]);
  });

  it("produces all 6 stage artifacts in storage", async () => {
    const runId = "run_e2e_002";
    engine.createRun(runId, "Build a SaaS app");

    for (let i = 0; i < 6; i++) {
      await engine.dispatchCycle();
    }

    const stages = ["frame", "discover", "plan", "spec", "build", "ship"];
    for (const stage of stages) {
      const raw = storage.read(`runs/${runId}/${stage}.json`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.stage).toBe(stage);
      expect(parsed.run_id).toBe(runId);
      expect(parsed.schema_version).toBe(1);
      expect(parsed.artifact).toBeDefined();
    }
  });

  it("total spend stays under the $8 cost cap", async () => {
    const runId = "run_e2e_003";
    engine.createRun(runId, "Build a SaaS app");

    for (let i = 0; i < 6; i++) {
      await engine.dispatchCycle();
    }

    const run = engine.getRun(runId)!;
    expect(run.spent_usd).toBeGreaterThan(0);
    expect(run.spent_usd).toBeLessThan(run.cap_usd);
    expect(run.cap_usd).toBe(8.0);
  });

  it("each stage artifact carries token usage and trace_id", async () => {
    const runId = "run_e2e_004";
    engine.createRun(runId, "Build a SaaS app");

    for (let i = 0; i < 6; i++) {
      await engine.dispatchCycle();
    }

    const stages = ["frame", "discover", "plan", "spec", "build", "ship"];
    for (const stage of stages) {
      const raw = storage.read(`runs/${runId}/${stage}.json`);
      const parsed = JSON.parse(raw!);
      expect(parsed.token_usage).toBeDefined();
      expect(parsed.token_usage.total_tokens).toBeGreaterThan(0);
      expect(parsed.token_usage.estimated_cost_usd).toBeGreaterThan(0);
      expect(parsed.trace_id).toBeTruthy();
    }
  });

  it("the sandbox was called 6 times with the correct model and stage info", async () => {
    const runId = "run_e2e_005";
    engine.createRun(runId, "Build a SaaS app");

    for (let i = 0; i < 6; i++) {
      await engine.dispatchCycle();
    }

    expect(mockSandbox.run).toHaveBeenCalledTimes(6);
    const calls = (mockSandbox.run as ReturnType<typeof vi.fn>).mock.calls;
    const stageIds = calls.map((c: [SandboxOptions]) => {
      const m = c[0].dispatchMessage.match(/Stage:\s*(\w+)/);
      return m ? m[1] : null;
    });
    expect(stageIds).toEqual(["frame", "discover", "plan", "spec", "build", "ship"]);

    for (const c of calls as [SandboxOptions][]) {
      expect(c[0].model).toBe("openrouter/z-ai/glm-5.2");
      expect(c[0].localMode).toBe(true);
      expect(c[0].dispatchMessage).toContain("<artifact>");
    }
  });

  it("step mode advances one stage then re-pauses", async () => {
    const runId = "run_e2e_006";
    engine.createRun(runId, "Build a SaaS app");

    engine.setControlDoc({ run_mode: "step" }, "test");
    let dispatched = await engine.dispatchCycle();
    expect(dispatched).toBe(1);
    expect(engine.getRun(runId)!.status).toBe("framed");

    const control = engine.getControlDoc();
    expect(control.run_mode).toBe("paused");

    engine.setControlDoc({ run_mode: "step" }, "test");
    dispatched = await engine.dispatchCycle();
    expect(dispatched).toBe(1);
    expect(engine.getRun(runId)!.status).toBe("discovered");
  });
});
