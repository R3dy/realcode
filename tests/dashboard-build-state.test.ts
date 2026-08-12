import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RunRecord } from "../src/dashboard/lib/engine.js";

const TMP_DIR = path.join(os.tmpdir(), `realcode-a45-test-${Date.now()}-${process.pid}`);
const DATA_DIR = path.join(TMP_DIR, "data");

async function importEngine() {
  vi.resetModules();
  return (await import("../src/dashboard/lib/engine.js")) as typeof import("../src/dashboard/lib/engine.js");
}

function makeRun(id: string, status: string, dataDir = DATA_DIR): RunRecord {
  const runDir = path.join(dataDir, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });
  const run: RunRecord = {
    run_id: id,
    idea: `test run ${id}`,
    status,
    spent_usd: 0.5,
    cap_usd: 8.0,
    created_at: Date.now(),
    workspace_path: path.join(dataDir, "workspaces", id),
  };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(run, null, 2));
  return run;
}

function writeBuildState(id: string, state: unknown, dataDir = DATA_DIR) {
  const runDir = path.join(dataDir, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "build-state.json"), JSON.stringify(state, null, 2));
}

function writeContainerLog(id: string, relLogPath: string, text: string, dataDir = DATA_DIR) {
  const abs = path.join(dataDir, "runs", id, relLogPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

const SAMPLE_STATE = {
  run_id: "run_build1",
  started_at: 1700000000000,
  wall_clock_deadline_ms: 1700001200000,
  paused: false,
  pause_reason: null,
  stories: [
    {
      story_id: "3.1",
      title: "Story 3.1",
      status: "done",
      retry_count: 0,
      worker_container_id: "cid_worker_31",
      validator_container_id: "cid_val_31",
      worker_output: { result: "success", notes: "implemented", commits: [{ sha: "abc", message: "feat: 3.1" }], test_output: "3 passed" },
      validator_output: { verdict: "pass", notes: "all green" },
      started_at: 1700000000000,
      completed_at: 1700000060000,
      depends_on: [],
      acceptance_criteria: ["criterion 1"],
      worker_tokens: 1200,
      validator_tokens: 800,
      worker_cost_usd: 0.012,
      validator_cost_usd: 0.008,
      test_passed: 3,
      test_failed: 0,
    },
    {
      story_id: "3.2",
      title: "Story 3.2",
      status: "building",
      retry_count: 0,
      worker_container_id: "cid_worker_32",
      validator_container_id: null,
      worker_output: null,
      validator_output: null,
      started_at: 1700000060000,
      completed_at: null,
      depends_on: ["3.1"],
      acceptance_criteria: ["criterion 2"],
    },
  ],
  containers: [],
};

describe("A4.5 engine build-state helpers", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("getBuildState returns null when build-state.json is absent", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nobuild", "specified");
    expect(getEngine().getBuildState("run_nobuild")).toBeNull();
  });

  it("getBuildState returns the parsed build-state.json", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE);
    const state = getEngine().getBuildState("run_build1");
    expect(state).not.toBeNull();
    expect(state!.run_id).toBe("run_build1");
    expect(state!.stories.length).toBe(2);
    expect(state!.stories[0].status).toBe("done");
    expect(state!.stories[1].status).toBe("building");
  });

  it("getBuildState returns null for a non-existent run", async () => {
    const { getEngine } = await importEngine();
    expect(getEngine().getBuildState("run_does_not_exist")).toBeNull();
  });

  it("listContainers synthesizes entries from per-story worker/validator IDs when containers[] is empty", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE);
    const views = getEngine().listContainers("run_build1");
    // 2 stories × (worker + validator done for 3.1; worker only for 3.2) = 3
    expect(views.length).toBe(3);
    const cids = views.map((v) => v.container_id).sort();
    expect(cids).toEqual(["cid_val_31", "cid_worker_31", "cid_worker_32"]);
    const worker32 = views.find((v) => v.container_id === "cid_worker_32")!;
    expect(worker32.role).toBe("worker");
    expect(worker32.status).toBe("running"); // story 3.2 is building
    const val31 = views.find((v) => v.container_id === "cid_val_31")!;
    expect(val31.role).toBe("validator");
    expect(val31.status).toBe("exited"); // story 3.1 is done
  });

  it("listContainers returns [] when no build-state exists", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nobuild", "specified");
    expect(getEngine().listContainers("run_nobuild")).toEqual([]);
  });

  it("listContainers prefers explicit containers[] entries and dedupes", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_c2", "specified");
    writeBuildState("run_c2", {
      ...SAMPLE_STATE,
      run_id: "run_c2",
      containers: [
        { container_id: "cid_worker_31", role: "worker", story_id: "3.1", log_path: "runs/run_c2/containers/3.1-worker-0.log" },
      ],
    });
    const views = getEngine().listContainers("run_c2");
    // explicit entry for cid_worker_31 (with log_path) + synthesized cid_val_31 + cid_worker_32
    const w31 = views.find((v) => v.container_id === "cid_worker_31")!;
    expect(w31.log_path).toBe("runs/run_c2/containers/3.1-worker-0.log");
    expect(views.find((v) => v.container_id === "cid_val_31")).toBeDefined();
    expect(views.find((v) => v.container_id === "cid_worker_32")).toBeDefined();
  });

  it("getContainerLogs returns 404 (null) when the container is unknown", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE);
    expect(getEngine().getContainerLogs("run_build1", "cid_unknown")).toBeNull();
  });

  it("getContainerLogs resolves log_path via explicit containers[] entry", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_log1", "specified");
    writeBuildState("run_log1", {
      ...SAMPLE_STATE,
      run_id: "run_log1",
      containers: [
        { container_id: "cid_worker_31", role: "worker", story_id: "3.1", log_path: "runs/run_log1/containers/3.1-worker-0.log" },
      ],
    });
    writeContainerLog("run_log1", "containers/3.1-worker-0.log", "line1\nline2\nline3\nline4\nline5\n");
    const res = getEngine().getContainerLogs("run_log1", "cid_worker_31", 2);
    expect(res).not.toBeNull();
    expect(res!.log_path).toBe("runs/run_log1/containers/3.1-worker-0.log");
    expect(res!.text).toBe("line4\nline5");
  });

  it("getContainerLogs returns full text when tail is omitted", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_log2", "specified");
    writeBuildState("run_log2", {
      ...SAMPLE_STATE,
      run_id: "run_log2",
      containers: [
        { container_id: "cid_worker_31", role: "worker", story_id: "3.1", log_path: "runs/run_log2/containers/3.1-worker-0.log" },
      ],
    });
    writeContainerLog("run_log2", "containers/3.1-worker-0.log", "a\nb\nc\n");
    const res = getEngine().getContainerLogs("run_log2", "cid_worker_31");
    expect(res!.text).toBe("a\nb\nc\n");
  });

  it("getContainerLogs returns empty text when the log file does not exist yet", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_log3", "specified");
    writeBuildState("run_log3", {
      ...SAMPLE_STATE,
      run_id: "run_log3",
      containers: [
        { container_id: "cid_worker_31", role: "worker", story_id: "3.1", log_path: "runs/run_log3/containers/missing.log" },
      ],
    });
    const res = getEngine().getContainerLogs("run_log3", "cid_worker_31");
    expect(res).not.toBeNull();
    expect(res!.text).toBe("");
    expect(res!.log_path).toBe("runs/run_log3/containers/missing.log");
  });

  it("hasRunningBuildContainers is true when a story is building/validating", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE); // 3.2 is building
    expect(getEngine().hasRunningBuildContainers("run_build1")).toBe(true);
  });

  it("hasRunningBuildContainers is false when all stories are done", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_done", "built");
    writeBuildState("run_done", {
      ...SAMPLE_STATE,
      run_id: "run_done",
      stories: SAMPLE_STATE.stories.map((s) => ({ ...s, status: "done" })),
    });
    expect(getEngine().hasRunningBuildContainers("run_done")).toBe(false);
  });

  it("hasRunningBuildContainers is false when build-state is absent", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nobuild", "specified");
    expect(getEngine().hasRunningBuildContainers("run_nobuild")).toBe(false);
  });

  it("getTraceEvents synthesizes events from build-state stories", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE);
    const events = getEngine().getTraceEvents("run_build1");
    expect(events.length).toBeGreaterThan(0);
    // story-event for each story with started_at, llm-message for worker+validator
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("stage-event");
    expect(kinds).toContain("llm-message");
    expect(kinds).toContain("tool-call"); // from worker commits + test_output
    // events are sorted by timestamp ascending
    for (let i = 1; i < events.length; i++) {
      expect((events[i].timestamp ?? 0)).toBeGreaterThanOrEqual((events[i - 1].timestamp ?? 0));
    }
    // worker event carries tokens + cost
    const workerEvt = events.find((e) => e.role === "build_worker" && e.kind === "llm-message")!;
    expect(workerEvt.tokens).toBe(1200);
    expect(workerEvt.cost_usd).toBe(0.012);
  });

  it("getTraceEvents returns [] when build-state is absent", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nobuild", "specified");
    expect(getEngine().getTraceEvents("run_nobuild")).toEqual([]);
  });

  it("getRunDetail includes build_state when build-state.json exists", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build1", "specified");
    writeBuildState("run_build1", SAMPLE_STATE);
    const detail = getEngine().getRunDetail("run_build1");
    expect(detail).not.toBeNull();
    expect(detail!.build_state).toBeDefined();
    expect(detail!.build_state!.stories.length).toBe(2);
  });

  it("getRunDetail omits build_state when build-state.json is absent", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nobuild", "framed");
    const detail = getEngine().getRunDetail("run_nobuild");
    expect(detail).not.toBeNull();
    expect(detail!.build_state).toBeUndefined();
  });
});
