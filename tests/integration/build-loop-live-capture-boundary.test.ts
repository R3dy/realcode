import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { BuildLoopRunner } from "../../src/engine/build-loop.js";
import { AgentStageRunner } from "../../src/agents/runner.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import type { StageGraph, StageEntry } from "../../src/engine/stage-graph.js";
import type { SandboxOptions } from "../../src/sandbox/runner.js";
import type { WorkItem } from "../../src/backend/types.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

let tmpDir: string;
let queue: SQLiteQueue;
let storage: FileStorage;
let graph: StageGraph;
let buildStage: StageEntry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-blboundary-"));
  graph = loadStageGraph(GRAPH_PATH);
  queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
  storage = new FileStorage(tmpDir);
  buildStage = {
    ...graph.stages.find((s) => s.id === "build")!,
  };
});

afterEach(() => {
  queue.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("1-C1: build dispatch path NOW receives liveCapture + identity (visibility fix)", () => {
  it("AgentStageRunner.run() invoked via BuildLoopRunner passes liveCapture/identity to sandbox.run", async () => {
    const runId = "run_1c1";
    // spec.json (build-loop needs a stories array)
    storage.write(`runs/${runId}/spec.json`, JSON.stringify({
      artifact: {
        epics_md: "# E",
        backlog_md: "# B",
        dependency_graph: "g",
        story_count: 1,
        stories: [{ id: "1", title: "Story 1", acceptance_criteria: ["c"], depends_on: [] }],
      },
      stage: "spec",
      run_id: runId,
    }, null, 2));
    storage.write(`runs/${runId}/run.json`, JSON.stringify({
      run_id: runId, idea: "test", status: "specified", spent_usd: 0,
      cap_usd: graph.cost_cap_usd_per_run, created_at: Date.now(), workspace_path: "/tmp/ws",
    }, null, 2));
    storage.write("control.json", JSON.stringify({
      run_mode: "continuous", concurrency: 1, per_stage_model_overrides: {}, cost_cap_usd: 8,
      updated_at: Date.now(), updated_by: "test",
    }, null, 2));

    // Recording sandbox: captures every opts object it receives.
    const recorded: SandboxOptions[] = [];
    const recordingSandbox = {
      run: (opts: SandboxOptions) => {
        recorded.push(opts);
        // No artifact in stdout → AgentStageRunner escalates the worker →
        // BuildLoopRunner stops after 1 dispatch. We only inspect recorded opts.
        return Promise.resolve({
          exitCode: 0,
          stdout: "",
          stderr: "",
          jsonEvents: undefined,
          timedOut: false,
          containerId: "fake-cid-abc123",
        });
      },
    };

    const runner = new AgentStageRunner(recordingSandbox as never, storage, graph, {
      localMode: false,
      repoRoot: process.cwd(),
    });
    const loop = new BuildLoopRunner(runner, storage, graph, queue, { repoRoot: process.cwd() });

    const item: WorkItem = {
      id: "item_1c1", run_id: runId, stage: "build", status: "specified", retry_count: 0,
      worker_id: "w", lease_expires_at: Date.now() + 60000,
      payload: { idea: "test", trace_id: "trace_1c1" }, created_at: Date.now(), updated_at: Date.now(),
    };

    const result = await loop.run(item, buildStage, "/tmp/ws");

    // One Worker sandbox was dispatched on the build path.
    expect(recorded).toHaveLength(1);
    const opts = recorded[0];
    // Build path NOW receives liveCapture + identity fields (visibility fix —
    // workers previously had zero container logs / trace events / container_id,
    // making worker timeouts completely undiagnosable).
    expect(opts.liveCapture).toBe(true);
    expect(opts.runId).toBe(runId);
    expect(opts.storyId).toBe("1");
    expect(opts.containerRole).toBe("build_worker");
    expect(opts.containerAttempt).toBe(0);
    expect(opts.stageId).toBe("build");
    expect(typeof opts.onJsonLine).toBe("function");
    // The worker escalated (no artifact) — container_id is still tracked.
    expect(result.output_status).toBe("escalate");
    const buildState = JSON.parse(storage.read(`runs/${runId}/build-state.json`)!) as { containers: Array<{ container_id: string }>; stories: Array<{ worker_container_id: string | null }> };
    expect(buildState.containers).toHaveLength(1);
    expect(buildState.containers[0].container_id).toBe("fake-cid-abc123");
    expect(buildState.stories[0].worker_container_id).toBe("fake-cid-abc123");
  });

  it("AgentStageRunner.run() DIRECT non-build dispatch DOES pass liveCapture + identity fields", async () => {
    const runId = "run_nonbuild_1c1";
    const workspace = `${tmpDir}/ws_${runId}`;
    fs.mkdirSync(workspace, { recursive: true });
    storage.write(`runs/${runId}/run.json`, JSON.stringify({
      run_id: runId, idea: "test", status: "intake", spent_usd: 0,
      cap_usd: graph.cost_cap_usd_per_run, created_at: Date.now(), workspace_path: workspace,
    }, null, 2));

    const recorded: SandboxOptions[] = [];
    const recordingSandbox = {
      run: (opts: SandboxOptions) => {
        recorded.push(opts);
        return Promise.resolve({
          exitCode: 0, stdout: "", stderr: "", jsonEvents: undefined, timedOut: false, containerId: "",
        });
      },
    };
    const agent = new AgentStageRunner(recordingSandbox as never, storage, graph, {
      localMode: false,
      repoRoot: process.cwd(),
    });

    const frameStage = graph.stages.find((s) => s.id === "frame")!;
    // Direct non-build dispatch — no opts.specOverride (this is what the
    // dispatcher does for a non-inner-loop stage: runner.run(item, stage, ws)).
    await agent.run(
      { id: "i", run_id: runId, stage: "frame", status: "intake", retry_count: 0, worker_id: "w", lease_expires_at: Date.now() + 60000, payload: {}, created_at: Date.now(), updated_at: Date.now() },
      frameStage,
      workspace,
      undefined,
    );

    expect(recorded).toHaveLength(1);
    const opts = recorded[0];
    expect(opts.liveCapture).toBe(true);
    expect(opts.runId).toBe(runId);
    expect(opts.storyId).toBe("stage");
    expect(opts.containerRole).toBe("frame");
    expect(opts.containerAttempt).toBe(0);
    expect(opts.stageId).toBe("frame");
    expect(typeof opts.onJsonLine).toBe("function");
  });
});