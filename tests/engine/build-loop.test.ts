import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { BuildLoopRunner } from "../../src/engine/build-loop.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import type { StageGraph, StageEntry } from "../../src/engine/stage-graph.js";
import type { WorkItem } from "../../src/backend/types.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

let tmpDir: string;
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;
let buildStage: StageEntry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-buildloop-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
  // Get the build stage and add worker_spec/validator_spec (do NOT modify stage-graph.yaml)
  buildStage = {
    ...graph.stages.find((s) => s.id === "build")!,
    worker_spec: "agent-specs/build.yaml",
    validator_spec: "agent-specs/build.yaml",
  };
});

afterEach(() => {
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface CannedResult {
  output_status: string;
  artifact: Record<string, unknown>;
  token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
  trace_id: string;
  jsonEvents?: unknown[];
}

/**
 * Create a mock AgentStageRunner that returns canned results based on the
 * schemaKey in opts. The `workerResults` and `validatorResults` arrays are
 * consumed in order (one per dispatch). If exhausted, the last entry repeats.
 */
function makeMockRunner(workerResults: CannedResult[], validatorResults: CannedResult[]) {
  let workerIdx = 0;
  let validatorIdx = 0;
  const heartbeatSpy = vi.fn();
  const run = vi.fn().mockImplementation(async (
    _item: WorkItem,
    _stage: StageEntry,
    _workspacePath: string,
    opts?: { specOverride?: string; schemaKey?: string; extraContext?: Record<string, unknown> },
  ): Promise<CannedResult> => {
    const schemaKey = opts?.schemaKey ?? "build";
    if (schemaKey === "build_worker") {
      const r = workerResults[Math.min(workerIdx, workerResults.length - 1)];
      workerIdx++;
      return { ...r };
    } else if (schemaKey === "build_validator") {
      const r = validatorResults[Math.min(validatorIdx, validatorResults.length - 1)];
      validatorIdx++;
      return { ...r };
    }
    return workerResults[0];
  });
  return { run, heartbeatSpy, _workerIdx: () => workerIdx, _validatorIdx: () => validatorIdx };
}

function makeWorkerSuccess(cost = 0.05): CannedResult {
  return {
    output_status: "pass",
    artifact: {
      story_id: "1",
      result: "success",
      branch: "main",
      commits: [],
      test_output: "",
      test_passed: 5,
      test_failed: 0,
      notes: "",
    },
    token_usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated_cost_usd: cost },
    trace_id: "trace_test",
  };
}

function makeValidatorPass(cost = 0.03): CannedResult {
  return {
    output_status: "pass",
    artifact: {
      story_id: "1",
      verdict: "pass",
      criteria_results: [],
      security_checklist: [],
      notes: "",
    },
    token_usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, estimated_cost_usd: cost },
    trace_id: "trace_test",
  };
}

function setupRun(stories: Array<{ id: string; title: string; acceptance_criteria: string[]; depends_on?: string[] }>, opts?: { capUsd?: number; spentUsd?: number; controlMode?: string }) {
  const runId = "run_test";
  const workspace = `${tmpDir}/workspaces/${runId}`;
  fs.mkdirSync(workspace, { recursive: true });

  // Write spec.json
  const specArtifact = {
    epics_md: "# Epics",
    backlog_md: "# Backlog",
    dependency_graph: "graph",
    story_count: stories.length,
    stories,
  };
  storage.write(`runs/${runId}/spec.json`, JSON.stringify({
    artifact: specArtifact,
    stage: "spec",
    run_id: runId,
  }, null, 2));

  // Write run.json
  const runRecord = {
    run_id: runId,
    idea: "test idea",
    status: "specified",
    spent_usd: opts?.spentUsd ?? 0,
    cap_usd: opts?.capUsd ?? graph.cost_cap_usd_per_run,
    created_at: Date.now(),
    workspace_path: workspace,
  };
  storage.write(`runs/${runId}/run.json`, JSON.stringify(runRecord, null, 2));

  // Write control.json
  const control = {
    run_mode: opts?.controlMode ?? "continuous",
    concurrency: 1,
    per_stage_model_overrides: {},
    cost_cap_usd: graph.cost_cap_usd_per_run,
    updated_at: Date.now(),
    updated_by: "test",
  };
  storage.write("control.json", JSON.stringify(control, null, 2));

  // Publish a work item
  const itemId = queue.publish({
    run_id: runId,
    stage: "build",
    status: "specified",
    payload: { idea: "test", workspace, trace_id: "trace_test" },
  });

  const item = queue.get(itemId)!;
  return { item, runId, workspace };
}

function readBuildState(): Record<string, unknown> | null {
  const raw = storage.read("runs/run_test/build-state.json");
  if (!raw) return null;
  return JSON.parse(raw);
}

describe("BuildLoopRunner", () => {
  it("processes 3 stories serially, all succeed", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
      { id: "3", title: "Story 3", acceptance_criteria: ["crit 3"] },
    ];
    const { item, workspace } = setupRun(stories);
    const mock = makeMockRunner(
      [makeWorkerSuccess(0.05), makeWorkerSuccess(0.06), makeWorkerSuccess(0.07)],
      [makeValidatorPass(0.03), makeValidatorPass(0.04), makeValidatorPass(0.05)],
    );
    const heartbeatSpy = vi.spyOn(queue, "heartbeat");
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    expect(result.artifact.stories).toHaveLength(3);
    expect(result.artifact.stories.every((s: { status: string }) => s.status === "done")).toBe(true);
    // Loop increment cost = sum of all 6 sandbox costs
    expect(result.token_usage.estimated_cost_usd).toBeCloseTo(0.05 + 0.06 + 0.07 + 0.03 + 0.04 + 0.05, 6);
    // build-state.json written
    const state = readBuildState();
    expect(state).not.toBeNull();
    expect(state!.stories).toHaveLength(3);
    expect(state!.stories.every((s: { status: string }) => s.status === "done")).toBe(true);
    // Heartbeat called twice per story (before Worker + before Validator) = 6 total
    expect(heartbeatSpy).toHaveBeenCalledTimes(6);
    // Worker called 3 times, Validator called 3 times
    expect(mock.run).toHaveBeenCalledTimes(6);
  });

  it("respects dependencies — story 2 waits for story 1", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"], depends_on: [] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"], depends_on: ["1"] },
      { id: "3", title: "Story 3", acceptance_criteria: ["crit 3"], depends_on: ["2"] },
    ];
    const { item, workspace } = setupRun(stories);
    const mock = makeMockRunner(
      [makeWorkerSuccess(), makeWorkerSuccess(), makeWorkerSuccess()],
      [makeValidatorPass(), makeValidatorPass(), makeValidatorPass()],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    expect(result.artifact.stories).toHaveLength(3);
    // Verify the dispatch order: worker(1), validator(1), worker(2), validator(2), worker(3), validator(3)
    const callArgs = mock.run.mock.calls.map((c: unknown[]) => {
      const opts = c[3] as { schemaKey?: string; extraContext?: { story_id?: string } };
      return { schemaKey: opts?.schemaKey, story_id: opts?.extraContext?.story_id };
    });
    expect(callArgs).toEqual([
      { schemaKey: "build_worker", story_id: "1" },
      { schemaKey: "build_validator", story_id: "1" },
      { schemaKey: "build_worker", story_id: "2" },
      { schemaKey: "build_validator", story_id: "2" },
      { schemaKey: "build_worker", story_id: "3" },
      { schemaKey: "build_validator", story_id: "3" },
    ]);
  });

  it("retries on environment failure, then succeeds on 2nd attempt", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    const { item, workspace } = setupRun(stories);
    const envFail: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", result: "failed", failure_type: "environment", branch: "main", commits: [], test_output: "", test_passed: 0, test_failed: 0, notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner(
      [envFail, makeWorkerSuccess()],
      [makeValidatorPass()],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    // Worker dispatched twice (1st fail, 2nd success)
    expect(mock.run).toHaveBeenCalledTimes(3); // worker(fail), worker(success), validator(pass)
    const state = readBuildState();
    expect(state!.stories[0].retry_count).toBe(1);
    expect(state!.stories[0].status).toBe("done");
  });

  it("escalates after 3 environment failures", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    const { item, workspace } = setupRun(stories);
    const envFail: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", result: "failed", failure_type: "environment", branch: "main", commits: [], test_output: "", test_passed: 0, test_failed: 0, notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner(
      [envFail, envFail, envFail],
      [],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("environment failure");
    expect(result.artifact.gate_notes).toContain("3 retries");
    const state = readBuildState();
    expect(state!.stories[0].status).toBe("escalated");
    expect(state!.stories[0].retry_count).toBe(3);
  });

  it("escalates immediately on implementation failure (0 retries)", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    const { item, workspace } = setupRun(stories);
    const implFail: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", result: "failed", failure_type: "implementation", branch: "main", commits: [], test_output: "", test_passed: 0, test_failed: 0, notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner([implFail], []);
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("implementation failure");
    // Only 1 worker dispatch — no retry
    expect(mock.run).toHaveBeenCalledTimes(1);
    const state = readBuildState();
    expect(state!.stories[0].status).toBe("escalated");
    expect(state!.stories[0].retry_count).toBe(0);
  });

  it("retries on validator fail, then passes on 2nd attempt (worker re-dispatched)", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    const { item, workspace } = setupRun(stories);
    const validatorFail: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", verdict: "fail", criteria_results: [], security_checklist: [], notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner(
      [makeWorkerSuccess(), makeWorkerSuccess()],
      [validatorFail, makeValidatorPass()],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    // worker(1st attempt) → validator(fail) → worker(re-dispatch) → validator(pass) = 4 calls
    expect(mock.run).toHaveBeenCalledTimes(4);
    const state = readBuildState();
    expect(state!.stories[0].retry_count).toBe(1);
    expect(state!.stories[0].status).toBe("done");
  });

  it("escalates immediately on validator escalate verdict", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    const { item, workspace } = setupRun(stories);
    const validatorEscalate: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", verdict: "escalate", criteria_results: [], security_checklist: [], notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner(
      [makeWorkerSuccess()],
      [validatorEscalate],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("validator escalate verdict");
    expect(mock.run).toHaveBeenCalledTimes(2); // worker + validator
    const state = readBuildState();
    expect(state!.stories[0].status).toBe("escalated");
  });

  it("honors pause — control doc paused between stories returns escalate", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { item, workspace } = setupRun(stories);
    const mock = makeMockRunner(
      [makeWorkerSuccess(), makeWorkerSuccess()],
      [makeValidatorPass(), makeValidatorPass()],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    // After the first story completes (worker+validator done), set control doc to paused
    let callCount = 0;
    const originalRun = mock.run;
    mock.run = vi.fn().mockImplementation(async (
      iitem: WorkItem,
      istage: StageEntry,
      iworkspacePath: string,
      opts?: { specOverride?: string; schemaKey?: string; extraContext?: Record<string, unknown> },
    ): Promise<CannedResult> => {
      callCount++;
      const result = await originalRun(iitem, istage, iworkspacePath, opts);
      // After story 1's validator (call 2), pause before story 2
      if (callCount === 2) {
        const control = { run_mode: "paused", concurrency: 1, per_stage_model_overrides: {}, cost_cap_usd: 8, updated_at: Date.now(), updated_by: "test" };
        storage.write("control.json", JSON.stringify(control, null, 2));
      }
      return result;
    }) as never;

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("paused by operator mid-build-loop");
    expect(result.artifact.gate_notes).toContain("1/2 stories done");
    const state = readBuildState();
    expect(state!.paused).toBe(true);
    expect(state!.stories[0].status).toBe("done");
    expect(state!.stories[1].status).toBe("pending");
  });

  it("cost cap mid-loop — escalates when spent + loopCost >= cap", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    // cap = 0.10; story 1 worker(0.05) + validator(0.03) = 0.08; before story 2, 0 + 0.08 >= 0.10? no.
    // Make story 1 cost more: worker 0.06 + validator 0.05 = 0.11 >= 0.10 → escalate before story 2
    const { item, workspace } = setupRun(stories, { capUsd: 0.10 });
    const mock = makeMockRunner(
      [makeWorkerSuccess(0.06), makeWorkerSuccess(0.05)],
      [makeValidatorPass(0.05), makeValidatorPass(0.03)],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("cost cap hit mid-loop");
    expect(result.artifact.gate_notes).toContain("1/2 stories done");
    // Only story 1 dispatched (worker + validator)
    expect(mock.run).toHaveBeenCalledTimes(2);
  });

  it("wall-clock bound exceeded — escalates", async () => {
    vi.useFakeTimers();
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { item, workspace } = setupRun(stories);
    // Set a short timeout (100ms); the mock will advance time past it
    const stageWithShortTimeout: StageEntry = { ...buildStage, timeout_ms: 100 };
    const mock = makeMockRunner(
      [makeWorkerSuccess(), makeWorkerSuccess()],
      [makeValidatorPass(), makeValidatorPass()],
    );
    // Wrap the mock to advance time by 200ms on each call (exceeds the 100ms deadline)
    const originalRun = mock.run;
    mock.run = vi.fn().mockImplementation(async (
      iitem: WorkItem,
      istage: StageEntry,
      iworkspacePath: string,
      opts?: { specOverride?: string; schemaKey?: string; extraContext?: Record<string, unknown> },
    ) => {
      vi.advanceTimersByTime(200);
      return originalRun(iitem, istage, iworkspacePath, opts);
    }) as never;
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, stageWithShortTimeout, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("wall-clock bound exceeded");
    vi.useRealTimers();
  });

  it("heartbeat called before BOTH Worker and Validator dispatches", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const { item, workspace } = setupRun(stories);
    const mock = makeMockRunner(
      [makeWorkerSuccess(), makeWorkerSuccess()],
      [makeValidatorPass(), makeValidatorPass()],
    );
    const heartbeatSpy = vi.spyOn(queue, "heartbeat");
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    await runner.run(item, buildStage, workspace);

    // 2 stories × 2 heartbeats (before worker + before validator) = 4
    expect(heartbeatSpy).toHaveBeenCalledTimes(4);
    // Verify each call passes the item id and timeout_ms
    for (const call of heartbeatSpy.mock.calls) {
      expect(call[0]).toBe(item.id);
      expect(call[1]).toBe(buildStage.timeout_ms);
    }
  });

  it("missing spec stories — escalates with clear error", async () => {
    // Write spec.json with no stories array
    storage.write("runs/run_test/spec.json", JSON.stringify({
      artifact: { epics_md: "# E", backlog_md: "# B", dependency_graph: "g", story_count: 0 },
      stage: "spec",
      run_id: "run_test",
    }, null, 2));
    storage.write("runs/run_test/run.json", JSON.stringify({
      run_id: "run_test", idea: "test", status: "specified", spent_usd: 0, cap_usd: 8, created_at: Date.now(), workspace_path: "/tmp/ws",
    }, null, 2));
    storage.write("control.json", JSON.stringify({ run_mode: "continuous", concurrency: 1, per_stage_model_overrides: {}, cost_cap_usd: 8, updated_at: Date.now(), updated_by: "test" }, null, 2));
    const item: WorkItem = {
      id: "item1", run_id: "run_test", stage: "build", status: "specified", retry_count: 0, worker_id: "w", lease_expires_at: Date.now() + 60000,
      payload: { idea: "test", trace_id: "trace_test" }, created_at: Date.now(), updated_at: Date.now(),
    };
    const mock = makeMockRunner([], []);
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, "/tmp/ws");

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("spec artifact lacks structured stories array");
    expect(mock.run).not.toHaveBeenCalled();
  });

  it("all blocked — story 2 depends on story 1 which escalates", async () => {
    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"], depends_on: [] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"], depends_on: ["1"] },
    ];
    const { item, workspace } = setupRun(stories);
    const implFail: CannedResult = {
      output_status: "pass",
      artifact: { story_id: "1", result: "failed", failure_type: "implementation", branch: "main", commits: [], test_output: "", test_passed: 0, test_failed: 0, notes: "" },
      token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
      trace_id: "trace_test",
    };
    const mock = makeMockRunner([implFail], []);
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("escalate");
    expect(result.artifact.gate_notes).toContain("implementation failure");
    const state = readBuildState();
    expect(state!.stories[0].status).toBe("escalated");
    expect(state!.stories[1].status).toBe("pending"); // story 2 never started
    expect(mock.run).toHaveBeenCalledTimes(1); // only story 1's worker
  });

  it("cost increment returned — NOT total run cost (no double-counting)", async () => {
    const stories = [{ id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] }];
    // Pre-loop spent_usd = 1.50; loop cost = 0.05 + 0.03 = 0.08
    const { item, workspace } = setupRun(stories, { spentUsd: 1.50 });
    const mock = makeMockRunner(
      [makeWorkerSuccess(0.05)],
      [makeValidatorPass(0.03)],
    );
    const runner = new BuildLoopRunner(mock as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    // Returned cost is the LOOP increment (0.08), NOT pre-loop + loop (1.58)
    expect(result.token_usage.estimated_cost_usd).toBeCloseTo(0.08, 6);
    expect(result.token_usage.estimated_cost_usd).not.toBeCloseTo(1.58, 2);
  });
});
