import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RunRecord, LiveState } from "../src/dashboard/lib/engine.js";

const TMP_DIR = path.join(os.tmpdir(), `realcode-a112-test-${Date.now()}-${process.pid}`);
const DATA_DIR = path.join(TMP_DIR, "data");

// The dashboard engine reads REALCODE_DATA_DIR at module load; reset modules
// after setting the env var so it picks up the fresh DATA_DIR each test.
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

function writeJson(id: string, filename: string, value: unknown, dataDir = DATA_DIR) {
  const runDir = path.join(dataDir, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, filename), JSON.stringify(value, null, 2));
}

function makeLiveState(id: string, partial: Partial<LiveState> = {}): LiveState {
  return {
    run_id: id,
    stage: "discover",
    status: "running",
    started_at: 1700000000000,
    updated_at: 1700000100000,
    container: {
      container_id: "cid_live_discover",
      name: `realcode-${id}-discover-0`,
      role: "discover",
      status: "running",
      started_at: 1700000000000,
      log_path: `runs/${id}/containers/stage-discover-0.log`,
    },
    events: [
      {
        kind: "llm-message",
        stage: "discover",
        agent: "discover",
        content: "live llm message",
        timestamp: 1700000050000,
        tokens: 1500,
        cost_usd: 0.015,
        role: "discover",
      },
      {
        kind: "tool-call",
        stage: "discover",
        agent: "discover",
        content: "live tool call",
        timestamp: 1700000055000,
        tool: "read_file",
        role: "discover",
        tokens: 0,
        cost_usd: 0,
      },
    ],
    tokens_total: 1500,
    cost_usd: 0.015,
    ...partial,
  };
}

const SAMPLE_BUILD_STATE = {
  run_id: "run_build",
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
      worker_output: { result: "success", notes: "implemented" },
      validator_output: null,
      started_at: 1700000000000,
      completed_at: 1700000060000,
      depends_on: [],
      acceptance_criteria: [],
      worker_tokens: 1000,
      worker_cost_usd: 0.01,
    },
  ],
  containers: [],
};

describe("A11.2 getLiveState (engine client)", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("getLiveState returns null when live.json is absent", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_nolive", "discovering");
    expect(getEngine().getLiveState("run_nolive")).toBeNull();
  });

  it("getLiveState returns null for a corrupt live.json", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_corrupt", "discovering");
    const runDir = path.join(DATA_DIR, "runs", "run_corrupt");
    fs.writeFileSync(path.join(runDir, "live.json"), "{ not valid json !!");
    expect(getEngine().getLiveState("run_corrupt")).toBeNull();
  });

  it("getLiveState returns the parsed live.json", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    const live = getEngine().getLiveState("run_live");
    expect(live).not.toBeNull();
    expect(live!.stage).toBe("discover");
    expect(live!.status).toBe("running");
    expect(live!.container!.container_id).toBe("cid_live_discover");
    expect(live!.events.length).toBe(2);
    expect(live!.tokens_total).toBe(1500);
  });
});

describe("A11.2 listContainers merges live container (AC #6)", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("returns the live container for a non-build run with live.json but no build_state.json", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    const views = getEngine().listContainers("run_live");
    expect(views.length).toBe(1);
    expect(views[0].container_id).toBe("cid_live_discover");
    expect(views[0].name).toBe("realcode-run_live-discover-0");
    expect(views[0].story_id).toBe("");
    expect(views[0].role).toBe("discover");
    expect(views[0].status).toBe("running");
    expect(views[0].log_path).toBe("runs/run_live/containers/stage-discover-0.log");
  });

  it("dedupes live container against build containers by container_id", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_both", "specified");
    // Build-state has a container with the same id as live's — build wins.
    writeJson("run_both", "build-state.json", {
      ...SAMPLE_BUILD_STATE,
      run_id: "run_both",
      containers: [
        { container_id: "cid_live_discover", role: "discover", story_id: "", log_path: "runs/run_both/containers/existing.log" },
      ],
    });
    writeJson("run_both", "live.json", makeLiveState("run_both"));
    const views = getEngine().listContainers("run_both");
    const live = views.filter((v) => v.container_id === "cid_live_discover");
    expect(live.length).toBe(1);
    // Build-state entry wins (deduped), not duplicated as a running live view.
    expect(live[0].status).toBe("exited");
  });

  it("regression: build_state-only run (no live.json) returns identical views", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build", "specified");
    writeJson("run_build", "build-state.json", SAMPLE_BUILD_STATE);
    const views = getEngine().listContainers("run_build");
    expect(views.length).toBe(2); // worker + validator for story 3.1
    const cids = views.map((v) => v.container_id).sort();
    expect(cids).toEqual(["cid_val_31", "cid_worker_31"]);
  });
});

describe("A11.2 getTraceEvents appends live events (AC #7)", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("returns only live events for a non-build run (no build_state)", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    const events = getEngine().getTraceEvents("run_live");
    // Only the 2 live events, no build_state synthesis.
    expect(events.length).toBe(2);
    expect(events.every((e) => e.stage === "discover")).toBe(true);
    // Sorted by timestamp ascending.
    for (let i = 1; i < events.length; i++) {
      expect((events[i].timestamp ?? 0)).toBeGreaterThanOrEqual((events[i - 1].timestamp ?? 0));
    }
    const llm = events.find((e) => e.kind === "llm-message")!;
    expect(llm.tokens).toBe(1500);
    expect(llm.cost_usd).toBe(0.015);
    expect(events.find((e) => e.kind === "tool-call")!.tool).toBe("read_file");
  });

  it("returns build events + live events, deduped by timestamp|stage|content and ordered", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_both", "specified");
    writeJson("run_both", "build-state.json", SAMPLE_BUILD_STATE);
    // Live event with an overlapping signature as the synthesized build event for
    // the worker: same stage+content+timestamp — the build event must win (dedup drop).
    const live = makeLiveState("run_both", {
      events: [
        {
          kind: "llm-message",
          stage: "build",
          agent: "build_worker",
          content: "implemented",
          timestamp: 1700000000000, // same sig as build synth event (started_at)
          tokens: 10,
          cost_usd: 0.001,
        },
        {
          kind: "tool-call",
          stage: "discover",
          agent: "discover",
          content: "live tool call",
          timestamp: 1700000020000,
          tool: "read_file",
          role: "discover",
          tokens: 0,
          cost_usd: 0,
        },
      ],
    });
    writeJson("run_both", "live.json", live);
    const events = getEngine().getTraceEvents("run_both");
    // Build event (llm-message "implemented") is present with build priority.
    const buildWorker = events.filter((e) => e.content === "implemented");
    expect(buildWorker.length).toBe(1);
    expect(buildWorker[0].tokens).toBe(1000); // build tokens, not live's 10
    // Live discover event appended.
    expect(events.some((e) => e.content === "live tool call" && e.stage === "discover")).toBe(true);
    // Sorted ascending.
    for (let i = 1; i < events.length; i++) {
      expect((events[i].timestamp ?? 0)).toBeGreaterThanOrEqual((events[i - 1].timestamp ?? 0));
    }
  });

  it("regression: build_state-only run (no live.json) returns identical events", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build", "specified");
    writeJson("run_build", "build-state.json", SAMPLE_BUILD_STATE);
    const events = getEngine().getTraceEvents("run_build");
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.kind === "stage-event")).toBe(true);
    expect(events.some((e) => e.kind === "llm-message")).toBe(true);
  });
});

describe("A11.2 getContainerLogs resolves live log_path (AC #8, 1-C6)", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("resolves the live log_path for a run with no build_state.json", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    // Write the live log file.
    const runDir = path.join(DATA_DIR, "runs", "run_live", "containers");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "stage-discover-0.log"), "line a\nline b\nline c\n");
    const res = getEngine().getContainerLogs("run_live", "cid_live_discover", 2);
    expect(res).not.toBeNull();
    expect(res!.log_path).toBe("runs/run_live/containers/stage-discover-0.log");
    expect(res!.text).toBe("line b\nline c");
  });

  it("matches by live container name as well as container_id", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    const runDir = path.join(DATA_DIR, "runs", "run_live", "containers");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "stage-discover-0.log"), "content\n");
    const res = getEngine().getContainerLogs("run_live", "realcode-run_live-discover-0");
    expect(res).not.toBeNull();
    expect(res!.text).toBe("content\n");
  });

  it("returns empty text + log_path when the live log file is absent yet", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_live", "discovering");
    writeJson("run_live", "live.json", makeLiveState("run_live"));
    const res = getEngine().getContainerLogs("run_live", "cid_live_discover");
    expect(res).not.toBeNull();
    expect(res!.text).toBe("");
    expect(res!.log_path).toBe("runs/run_live/containers/stage-discover-0.log");
  });

  it("regression: build-only fallback still resolves and 404s unchanged", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_build", "specified");
    writeJson("run_build", "build-state.json", {
      ...SAMPLE_BUILD_STATE,
      run_id: "run_build",
      containers: [
        { container_id: "cid_worker_31", role: "worker", story_id: "3.1", log_path: "runs/run_build/containers/3.1-worker-0.log" },
      ],
    });
    const runDir = path.join(DATA_DIR, "runs", "run_build", "containers");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "3.1-worker-0.log"), "build log\n");
    const res = getEngine().getContainerLogs("run_build", "cid_worker_31");
    expect(res!.log_path).toBe("runs/run_build/containers/3.1-worker-0.log");
    expect(res!.text).toBe("build log\n");
    // Unknown cid still returns null (404).
    expect(getEngine().getContainerLogs("run_build", "cid_unknown")).toBeNull();
  });
});
