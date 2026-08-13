import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Engine } from "../src/engine/dispatcher.js";
import { loadStageGraph } from "../src/engine/stage-graph.js";
import { SQLiteQueue } from "../src/backend/sqlite-queue.js";
import { FileStorage } from "../src/backend/file-storage.js";
import { readLiveState } from "../src/engine/live-state.js";
import type { StageGraph } from "../src/engine/stage-graph.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

describe("Change flow: conductor → change (agile path)", () => {
  let tmpDir: string;
  let queue: SQLiteQueue;
  let storage: FileStorage;
  let graph: StageGraph;
  let oldApiKey: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-change-"));
    graph = loadStageGraph(GRAPH_PATH);
    queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
    storage = new FileStorage(tmpDir);
    oldApiKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (oldApiKey !== undefined) process.env.OPENROUTER_API_KEY = oldApiKey;
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("classifies a change request targeting realvol and routes to the change stage", async () => {
    // The idea mentions "realvol" → conductor deterministically classifies as change
    const runId = "run_change_001";
    const engine = new Engine(graph, queue, storage, { run: vi.fn() }, tmpDir);

    engine.createRun(runId, "Add a footer to the bottom of the realvol page");

    // First dispatch: conductor classifies
    await engine.dispatchCycle();

    const run = engine.getRun(runId)!;
    expect(run.status).toBe("classified_change");

    // Conductor artifact should be stored
    const conductorRaw = storage.read(`runs/${runId}/conductor.json`);
    expect(conductorRaw).not.toBeNull();
    const conductorArtifact = JSON.parse(conductorRaw!);
    expect(conductorArtifact.artifact.intent).toBe("change");
    expect(conductorArtifact.artifact.target_project).toBe("realvol");
    expect(conductorArtifact.artifact.flow_type).toBe("agile");
  });

  it("the change stage dispatches through the sandbox runner", async () => {
    const runId = "run_change_002";
    const changeArtifact = {
      gate_verdict: "pass",
      gate_notes: "Footer added and tests pass",
      status: "shipped",
      revisions_used: 0,
      artifact: {
        changes_summary: "Added a Footer component to the bottom of the page",
        files_modified: ["src/components/Footer.tsx"],
        files_created: [],
        tests_run: true,
        tests_passed: true,
        test_output: "All tests passed",
        commit_sha: "abc1234",
        commit_message: "feat: add footer to page",
        target_project: "realvol",
      },
    };

    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: changeArtifact.artifact,
        token_usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500, estimated_cost_usd: 0.02 },
        trace_id: "trace-change-002",
      }),
    };

    const engine = new Engine(graph, queue, storage, mockRunner, tmpDir);
    engine.createRun(runId, "Add a footer to the realvol page");

    // Dispatch 1: conductor
    await engine.dispatchCycle();
    expect(engine.getRun(runId)!.status).toBe("classified_change");

    // Dispatch 2: change stage
    await engine.dispatchCycle();
    expect(engine.getRun(runId)!.status).toBe("shipped");

    // The runner was called once (for the change stage)
    expect(mockRunner.run).toHaveBeenCalledTimes(1);

    // Change artifact stored
    const changeRaw = storage.read(`runs/${runId}/change.json`);
    expect(changeRaw).not.toBeNull();
    const parsed = JSON.parse(changeRaw!);
    expect(parsed.stage).toBe("change");
    expect(parsed.artifact.changes_summary).toContain("Footer");
  });

  it("a new-project request routes to the full pipeline (classified_new)", async () => {
    const runId = "run_change_003";
    const mockRunner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: { project_md: "# Test", project_type: "saas", has_ui: true, is_sellable: true },
        token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.001 },
        trace_id: "t",
      }),
    };

    const engine = new Engine(graph, queue, storage, mockRunner, tmpDir);
    engine.createRun(runId, "Build a markdown-to-PDF CLI");

    // Dispatch 1: conductor classifies as new
    await engine.dispatchCycle();
    expect(engine.getRun(runId)!.status).toBe("classified_new");

    // The runner was NOT called (conductor doesn't use the runner)
    expect(mockRunner.run).not.toHaveBeenCalled();
  });

  it("live-mount workspace path is set for change flows", async () => {
    const runId = "run_change_004";
    const engine = new Engine(graph, queue, storage, { run: vi.fn() }, tmpDir);
    engine.createRun(runId, "Fix a bug in realcode");

    await engine.dispatchCycle();

    const run = engine.getRun(runId)!;
    expect(run.status).toBe("classified_change");
    // The workspace_path should point to the real project repo
    expect(run.workspace_path).toContain("PROJECTS");
    expect(run.workspace_path).toContain("realcode");
    expect(run.workspace_path).toContain("repo");
  });
});
