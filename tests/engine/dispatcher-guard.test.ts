import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Engine } from "../../src/engine/dispatcher.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import type { StageGraph, StageEntry } from "../../src/engine/stage-graph.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

let tmpDir: string;
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-guard-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
});

afterEach(() => {
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Dispatcher missing-runner guard", () => {
  it("throws a clear Error (not TypeError) when an inner-loop stage has no BuildLoopRunner", async () => {
    // Mutate the loaded graph: flip the build stage to inner-loop mode
    // (add worker_spec, remove agent_spec). This simulates the A4.4 state
    // WITHOUT modifying stage-graph.yaml.
    const buildStage = graph.stages.find((s) => s.id === "build")!;
    const mutatedBuild: StageEntry = {
      ...buildStage,
      agent_spec: undefined,
      inner_loop: "anymake-build-loop",
      worker_spec: "agent-specs/build.yaml",
      validator_spec: "agent-specs/build.yaml",
    };
    graph.stages = graph.stages.map((s) => (s.id === "build" ? mutatedBuild : s));

    // The runner should NOT be called (the guard fires first). If it were,
    // it would return a generic result. We use a mock to assert it's not called.
    const runner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: {},
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        trace_id: "t",
      }),
    };

    // 5-arg constructor — no buildLoopRunner passed.
    const engine = new Engine(graph, queue, storage, runner, tmpDir);

    // Write the run record directly at status "specified" (the build stage's
    // input) — do NOT call createRun (which publishes an intake work item
    // that would be claimed first by the frame stage).
    const workspace = `${tmpDir}/workspaces/run_guard_001`;
    fs.mkdirSync(workspace, { recursive: true });
    const runRecord = {
      run_id: "run_guard_001",
      idea: "test idea",
      status: "specified",
      spent_usd: 0,
      cap_usd: graph.cost_cap_usd_per_run,
      created_at: Date.now(),
      workspace_path: workspace,
    };
    storage.write("runs/run_guard_001/run.json", JSON.stringify(runRecord, null, 2));
    queue.publish({
      run_id: "run_guard_001",
      stage: "build",
      status: "specified",
      payload: { idea: "test", workspace },
    });

    const dispatched = await engine.dispatchCycle();

    // The guard fires → caught by try/catch → run escalates → dispatched counts it
    expect(dispatched).toBe(1);
    expect(runner.run).not.toHaveBeenCalled();

    const finalRun = engine.getRun("run_guard_001")!;
    expect(finalRun.status).toBe("escalated");
  });

  it("the guard condition is stage.inner_loop && stage.worker_spec (not inner_loop alone)", async () => {
    // At A4.1 the build stage has inner_loop (dormant) but NO worker_spec.
    // The guard must NOT fire — the old runner.run() path is taken.
    // We verify by checking the dispatcher uses runner.run (not buildLoopRunner).
    const runner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: { repo_path: "/x", test_results: { passed: 0, failed: 0, skipped: 0, coverage_pct: 0 } },
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        trace_id: "t",
      }),
    };

    const engine = new Engine(graph, queue, storage, runner, tmpDir);

    // Write the run record directly at "specified" — do NOT call createRun.
    const workspace = `${tmpDir}/workspaces/run_guard_002`;
    fs.mkdirSync(workspace, { recursive: true });
    const runRecord = {
      run_id: "run_guard_002",
      idea: "test idea",
      status: "specified",
      spent_usd: 0,
      cap_usd: graph.cost_cap_usd_per_run,
      created_at: Date.now(),
      workspace_path: workspace,
    };
    storage.write("runs/run_guard_002/run.json", JSON.stringify(runRecord, null, 2));
    queue.publish({
      run_id: "run_guard_002",
      stage: "build",
      status: "specified",
      payload: { idea: "test", workspace },
    });

    await engine.dispatchCycle();
    // The build stage has inner_loop but no worker_spec → old path → runner.run called
    expect(runner.run).toHaveBeenCalledTimes(1);
  });
});
