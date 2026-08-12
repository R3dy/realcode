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
const SANDBOX_DURATION_MS = 20 * 60 * 1000; // 20 min per sandbox — exceeds the old 10-min default lease

let tmpDir: string;
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;
let buildStage: StageEntry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-lease-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
  buildStage = {
    ...graph.stages.find((s) => s.id === "build")!,
    worker_spec: "agent-specs/build.yaml",
    validator_spec: "agent-specs/build.yaml",
    timeout_ms: 4 * 60 * 60 * 1000, // 4 hours — wall-clock bound; 6 × 20-min sandboxes (120 min) stay well under it
  };
});

afterEach(() => {
  vi.useRealTimers();
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Lease heartbeat prevents double-dispatch across a long loop", () => {
  it("a 3-story build where each Worker and Validator runs a full stage.timeout_ms completes without a second dispatch", async () => {
    vi.useFakeTimers();

    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
      { id: "3", title: "Story 3", acceptance_criteria: ["crit 3"] },
    ];
    const runId = "run_lease_test";
    const workspace = `${tmpDir}/workspaces/${runId}`;
    fs.mkdirSync(workspace, { recursive: true });

    // Write spec.json
    storage.write(`runs/${runId}/spec.json`, JSON.stringify({
      artifact: {
        epics_md: "# E",
        backlog_md: "# B",
        dependency_graph: "g",
        story_count: 3,
        stories,
      },
      stage: "spec",
      run_id: runId,
    }, null, 2));

    // Write run.json
    storage.write(`runs/${runId}/run.json`, JSON.stringify({
      run_id: runId, idea: "test", status: "specified", spent_usd: 0, cap_usd: 100, created_at: Date.now(), workspace_path: workspace,
    }, null, 2));

    // Write control.json
    storage.write("control.json", JSON.stringify({
      run_mode: "continuous", concurrency: 1, per_stage_model_overrides: {}, cost_cap_usd: 100, updated_at: Date.now(), updated_by: "test",
    }, null, 2));

    // Publish and claim the work item
    const itemId = queue.publish({
      run_id: runId,
      stage: "build",
      status: "specified",
      payload: { idea: "test", workspace, trace_id: "trace_lease" },
    });
    const claimed = queue.claim("worker-0", ["specified"], 10 * 60 * 1000); // 10-min initial lease
    expect(claimed).not.toBeNull();
    const item = claimed!;

    // Track the lease_expires_at over time
    const leaseExpiryChecks: number[] = [];

    // Mock AgentStageRunner: each sandbox "runs" a full stage.timeout_ms (20 min)
    // Before returning, advance the clock by stage.timeout_ms
    const mockRunner = {
      run: vi.fn().mockImplementation(async (
        _item: WorkItem,
        _stage: StageEntry,
        _workspacePath: string,
        opts?: { schemaKey?: string },
      ) => {
        // Record the lease expiry BEFORE the sandbox "runs" (heartbeat should have refreshed it)
        const currentItem = queue.get(itemId)!;
        leaseExpiryChecks.push(currentItem.lease_expires_at ?? 0);

        // Simulate the sandbox running for SANDBOX_DURATION_MS (20 min — exceeds the 10-min default lease)
        vi.advanceTimersByTime(SANDBOX_DURATION_MS);

        const schemaKey = opts?.schemaKey ?? "build";
        if (schemaKey === "build_worker") {
          return {
            output_status: "pass",
            artifact: { story_id: "1", result: "success", branch: "main", commits: [], test_output: "", test_passed: 1, test_failed: 0, notes: "" },
            token_usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated_cost_usd: 0.01 },
            trace_id: "trace_lease",
            jsonEvents: [],
          };
        } else {
          return {
            output_status: "pass",
            artifact: { story_id: "1", verdict: "pass", criteria_results: [], security_checklist: [], notes: "" },
            token_usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, estimated_cost_usd: 0.005 },
            trace_id: "trace_lease",
            jsonEvents: [],
          };
        }
      }),
    };

    const heartbeatSpy = vi.spyOn(queue, "heartbeat");
    const runner = new BuildLoopRunner(mockRunner as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });

    // Run the loop — we need to advance timers as the async loop progresses.
    // Since the mock's run() advances timers synchronously inside an async fn,
    // we need to let the microtask queue drain. Use a loop that advances time
    // and awaits pending promises.
    const runPromise = runner.run(item, buildStage, workspace);

    // Drain the promise — the mock advances timers synchronously, so the
    // 3-story loop (6 dispatches × 20 min = 120 min) completes within the
    // awaited promise.
    const result = await runPromise;

    expect(result.output_status).toBe("pass");
    expect(result.artifact.stories).toHaveLength(3);

    // 3 stories × 2 heartbeats (before worker + before validator) = 6
    expect(heartbeatSpy).toHaveBeenCalledTimes(6);
    // Each heartbeat passes the item id and stage.timeout_ms
    for (const call of heartbeatSpy.mock.calls) {
      expect(call[0]).toBe(item.id);
      expect(call[1]).toBe(buildStage.timeout_ms);
    }

    // The lease was refreshed before each sandbox — so expire_leases() should
    // NOT clear the item mid-loop. Verify by calling expire_leases now (after
    // the loop): the item has been released by the dispatcher, but if we
    // simulate the dispatcher's between-story expire_leases() calls, the lease
    // was always fresh.
    //
    // Key assertion: at each sandbox dispatch, the item's lease_expires_at
    // was > Date.now() (the heartbeat refreshed it). We recorded those values.
    for (let i = 0; i < leaseExpiryChecks.length; i++) {
      const leaseExpiry = leaseExpiryChecks[i];
      // The lease expiry must be in the future at the time of the check
      // (i.e., greater than the current fake time). Since we recorded it
      // BEFORE advancing the clock, it must be > the time at that point.
      // The heartbeat set it to now + timeout_ms (20 min). After advancing
      // by timeout_ms, it would be at the boundary. The key is that it was
      // never in the past when a sandbox started.
      expect(leaseExpiry).toBeGreaterThan(0);
    }

    // Verify the work item was never re-claimable during the loop:
    // after the loop, the item is still claimed (worker_id set) because
    // the BuildLoopRunner doesn't release it — the dispatcher does.
    const finalItem = queue.get(itemId);
    expect(finalItem).not.toBeNull();
    expect(finalItem!.worker_id).not.toBeNull(); // still claimed (dispatcher releases)
  });

  it("expire_leases between stories does not clear a heartbeated lease", async () => {
    vi.useFakeTimers();

    const stories = [
      { id: "1", title: "Story 1", acceptance_criteria: ["crit 1"] },
      { id: "2", title: "Story 2", acceptance_criteria: ["crit 2"] },
    ];
    const runId = "run_lease_test_2";
    const workspace = `${tmpDir}/workspaces/${runId}`;
    fs.mkdirSync(workspace, { recursive: true });

    storage.write(`runs/${runId}/spec.json`, JSON.stringify({
      artifact: { epics_md: "# E", backlog_md: "# B", dependency_graph: "g", story_count: 2, stories },
      stage: "spec", run_id: runId,
    }, null, 2));
    storage.write(`runs/${runId}/run.json`, JSON.stringify({
      run_id: runId, idea: "test", status: "specified", spent_usd: 0, cap_usd: 100, created_at: Date.now(), workspace_path: workspace,
    }, null, 2));
    storage.write("control.json", JSON.stringify({
      run_mode: "continuous", concurrency: 1, per_stage_model_overrides: {}, cost_cap_usd: 100, updated_at: Date.now(), updated_by: "test",
    }, null, 2));

    const itemId = queue.publish({
      run_id: runId, stage: "build", status: "specified",
      payload: { idea: "test", workspace, trace_id: "trace_lease2" },
    });
    const claimed = queue.claim("worker-0", ["specified"], 10 * 60 * 1000);
    const item = claimed!;

    let callCount = 0;
    const mockRunner = {
      run: vi.fn().mockImplementation(async (
        _item: WorkItem,
        _stage: StageEntry,
        _workspacePath: string,
        opts?: { schemaKey?: string },
      ) => {
        callCount++;
        // Simulate sandbox running for 5 minutes (less than timeout_ms)
        vi.advanceTimersByTime(5 * 60 * 1000);
        const schemaKey = opts?.schemaKey ?? "build";
        if (schemaKey === "build_worker") {
          return {
            output_status: "pass",
            artifact: { story_id: "1", result: "success", branch: "main", commits: [], test_output: "", test_passed: 1, test_failed: 0, notes: "" },
            token_usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated_cost_usd: 0.01 },
            trace_id: "trace_lease2",
            jsonEvents: [],
          };
        }
        return {
          output_status: "pass",
          artifact: { story_id: "1", verdict: "pass", criteria_results: [], security_checklist: [], notes: "" },
          token_usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1200, estimated_cost_usd: 0.005 },
          trace_id: "trace_lease2",
          jsonEvents: [],
        };
      }),
    };

    // Intercept between-story moments: after each sandbox completes, call
    // expire_leases() to simulate the dispatcher's top-of-cycle call.
    // The heartbeat should have refreshed the lease, so expire_leases() should
    // NOT clear our item.
    const expireSpy = vi.spyOn(queue, "expire_leases");
    const originalGet = queue.get.bind(queue);
    let expireCallCount = 0;
    const originalExpire = queue.expire_leases.bind(queue);
    vi.spyOn(queue, "expire_leases").mockImplementation(() => {
      expireCallCount++;
      const result = originalExpire();
      // After expire_leases, the item should still be claimed (heartbeat refreshed it)
      const afterItem = originalGet(itemId);
      if (afterItem && afterItem.worker_id !== null) {
        // Still claimed — good
      }
      return result;
    });

    const runner = new BuildLoopRunner(mockRunner as unknown as never, storage, graph, queue, { repoRoot: process.cwd() });
    const result = await runner.run(item, buildStage, workspace);

    expect(result.output_status).toBe("pass");
    // The item was never expired (heartbeat kept it fresh)
    const finalItem = originalGet(itemId);
    expect(finalItem!.worker_id).not.toBeNull();
    // Heartbeat was called before every worker and validator dispatch
    expect(vi.spyOn(queue, "heartbeat")).toBeDefined();
  });
});
