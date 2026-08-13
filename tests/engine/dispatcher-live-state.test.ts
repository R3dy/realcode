import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Engine } from "../../src/engine/dispatcher.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import { readLiveState } from "../../src/engine/live-state.js";
import type { StageGraph, StageEntry } from "../../src/engine/stage-graph.js";
import type { WorkItem } from "../../src/backend/types.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

let tmpDir: string; // FileStorage / SQLiteQueue root
let dataDir: string; // REALCODE_DATA_DIR → live.json lands here
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;
let oldDataDir: string | undefined;

const PASS_RESULT = {
  output_status: "pass",
  artifact: { idea: "x", framing_notes: "" },
  token_usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, estimated_cost_usd: 0.001 },
  trace_id: "t",
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-displive-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-displive-data-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
  oldDataDir = process.env.REALCODE_DATA_DIR;
  process.env.REALCODE_DATA_DIR = dataDir;
});

afterEach(() => {
  if (oldDataDir !== undefined) process.env.REALCODE_DATA_DIR = oldDataDir;
  else delete process.env.REALCODE_DATA_DIR;
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function setupNonBuildItem(status = "classified_new"): { runId: string; workspace: string } {
  const runId = `run_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const workspace = `${tmpDir}/workspaces/${runId}`;
  fs.mkdirSync(workspace, { recursive: true });
  const runRecord = {
    run_id: runId,
    idea: "test idea",
    status,
    spent_usd: 0,
    cap_usd: graph.cost_cap_usd_per_run,
    created_at: Date.now(),
    workspace_path: workspace,
  };
  storage.write(`runs/${runId}/run.json`, JSON.stringify(runRecord, null, 2));
  queue.publish({
    run_id: runId,
    stage: "frame",
    status,
    payload: { idea: "test", workspace },
  });
  return { runId, workspace };
}

/** Dispatch a BUILD-stage work item (build is inner_loop). */
function setupBuildItem(): { runId: string; workspace: string } {
  const runId = `run_build_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const workspace = `${tmpDir}/workspaces/${runId}`;
  fs.mkdirSync(workspace, { recursive: true });
  const runRecord = {
    run_id: runId,
    idea: "test idea",
    status: "specified",
    spent_usd: 0,
    cap_usd: graph.cost_cap_usd_per_run,
    created_at: Date.now(),
    workspace_path: workspace,
  };
  storage.write(`runs/${runId}/run.json`, JSON.stringify(runRecord, null, 2));
  queue.publish({
    run_id: runId,
    stage: "build",
    status: "specified",
    payload: { idea: "test", workspace },
  });
  return { runId, workspace };
}

describe("Dispatcher live-state writes (A11.1)", () => {
  it("1-C4: escalated run catch path writes live.json with status 'failed' + the failure message", async () => {
    const { runId } = setupNonBuildItem();
    const runner = { run: vi.fn().mockRejectedValue(new Error("sandbox exploded")) };
    const engine = new Engine(graph, queue, storage, runner, tmpDir);

    const dispatched = await engine.dispatchCycle();

    expect(dispatched).toBe(1);
    const state = readLiveState(runId)!;
    expect(state.status).toBe("failed");
    expect(state.failure_message).toContain("sandbox exploded");
    // Work item released as escalated (existing behavior unchanged).
    expect(engine.getRun(runId)!.status).toBe("escalated");
  });

  it("stage start writes live.json with status 'running' before the runner resolves", async () => {
    const { runId } = setupNonBuildItem();
    // The runner reads live.json at invoke time — it must already be "running".
    let statusAtStart: string | null = null;
    const runner = {
      run: vi.fn().mockImplementation(async (_item: WorkItem, _stage: StageEntry, _ws: string) => {
        const live = readLiveState(runId);
        statusAtStart = live?.status ?? null;
        return PASS_RESULT;
      }),
    };
    const engine = new Engine(graph, queue, storage, runner, tmpDir);

    await engine.dispatchCycle();

    expect(statusAtStart).toBe("running");
    const state = readLiveState(runId)!;
    expect(state.stage).toBe("frame");
  });

  it("stage end success path writes live.json with status 'completed'", async () => {
    const { runId } = setupNonBuildItem();
    const runner = { run: vi.fn().mockResolvedValue(PASS_RESULT) };
    const engine = new Engine(graph, queue, storage, runner, tmpDir);

    await engine.dispatchCycle();

    const state = readLiveState(runId)!;
    expect(state.status).toBe("completed");
    expect(engine.getRun(runId)!.status).toBe("framed");
  });

  it("build-loop stage does NOT write live.json (start write gated on !stage.inner_loop)", async () => {
    const { runId } = setupBuildItem();
    const runner = { run: vi.fn().mockResolvedValue(PASS_RESULT) };
    // buildLoopRunner returns a pass so the build stage completes cleanly —
    // and even so, NOTHING writes live.json for an inner_loop stage.
    const buildLoopRunner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: { repo_path: "/x", stories: [] },
        token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 },
        trace_id: "t",
      }),
    };
    const engine = new Engine(graph, queue, storage, runner, tmpDir, buildLoopRunner as never);

    const dispatched = await engine.dispatchCycle();

    expect(dispatched).toBe(1);
    expect(readLiveState(runId)).toBeNull();
  });
});