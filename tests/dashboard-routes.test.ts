import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RunRecord } from "../src/dashboard/lib/engine.js";

const TMP_DIR = path.join(os.tmpdir(), `realcode-a45-routes-${Date.now()}-${process.pid}`);
const DATA_DIR = path.join(TMP_DIR, "data");

async function importRoutes() {
  vi.resetModules();
  return {
    buildState: (await import("../src/dashboard/app/api/runs/[id]/build-state/route.js")) as typeof import("../src/dashboard/app/api/runs/[id]/build-state/route.js"),
    containers: (await import("../src/dashboard/app/api/runs/[id]/containers/route.js")) as typeof import("../src/dashboard/app/api/runs/[id]/containers/route.js"),
    logs: (await import("../src/dashboard/app/api/runs/[id]/containers/[cid]/logs/route.js")) as typeof import("../src/dashboard/app/api/runs/[id]/containers/[cid]/logs/route.js"),
    trace: (await import("../src/dashboard/app/api/runs/[id]/trace/route.js")) as typeof import("../src/dashboard/app/api/runs/[id]/trace/route.js"),
    runs: (await import("../src/dashboard/app/api/runs/[id]/route.js")) as typeof import("../src/dashboard/app/api/runs/[id]/route.js"),
  };
}

function makeRun(id: string, status: string, dataDir = DATA_DIR): RunRecord {
  const runDir = path.join(dataDir, "runs", id);
  fs.mkdirSync(runDir, { recursive: true });
  const run: RunRecord = {
    run_id: id,
    idea: `test ${id}`,
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

const SAMPLE_STATE = {
  run_id: "run_t1",
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
      worker_container_id: "cid_w_31",
      validator_container_id: "cid_v_31",
      worker_output: { result: "success", notes: "ok", commits: [{ sha: "a", message: "feat" }], test_output: "3 passed" },
      validator_output: { verdict: "pass", notes: "green" },
      started_at: 1700000000000,
      completed_at: 1700000060000,
      depends_on: [],
      acceptance_criteria: ["c1"],
      worker_tokens: 1000,
      validator_tokens: 500,
      worker_cost_usd: 0.01,
      validator_cost_usd: 0.005,
    },
  ],
  containers: [],
};

function mockReq(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

describe("A4.5 dashboard API routes", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("GET /api/runs/[id]/build-state returns 404 when no build-state.json", async () => {
    const r = await importRoutes();
    makeRun("run_nobuild", "specified");
    const res = await r.buildState.GET(mockReq(`http://x/api/runs/run_nobuild/build-state`), { params: { id: "run_nobuild" } });
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/[id]/build-state returns the build-state JSON", async () => {
    const r = await importRoutes();
    makeRun("run_t1", "specified");
    writeBuildState("run_t1", SAMPLE_STATE);
    const res = await r.buildState.GET(mockReq(`http://x/api/runs/run_t1/build-state`), { params: { id: "run_t1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run_id).toBe("run_t1");
    expect(body.stories.length).toBe(1);
    expect(body.stories[0].status).toBe("done");
  });

  it("GET /api/runs/[id]/containers returns synthesized container views", async () => {
    const r = await importRoutes();
    makeRun("run_t1", "specified");
    writeBuildState("run_t1", SAMPLE_STATE);
    const res = await r.containers.GET(mockReq(`http://x/api/runs/run_t1/containers`), { params: { id: "run_t1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.containers.length).toBe(2);
    const roles = body.containers.map((c: { role: string }) => c.role).sort();
    expect(roles).toEqual(["validator", "worker"]);
  });

  it("GET /api/runs/[id]/containers returns empty array when no build-state", async () => {
    const r = await importRoutes();
    makeRun("run_nobuild", "specified");
    const res = await r.containers.GET(mockReq(`http://x/api/runs/run_nobuild/containers`), { params: { id: "run_nobuild" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.containers).toEqual([]);
  });

  it("GET /api/runs/[id]/containers/[cid]/logs returns 404 when the container is unknown", async () => {
    const r = await importRoutes();
    makeRun("run_t1", "specified");
    writeBuildState("run_t1", SAMPLE_STATE);
    const res = await r.logs.GET(
      mockReq(`http://x/api/runs/run_t1/containers/cid_unknown/logs`),
      { params: { id: "run_t1", cid: "cid_unknown" } },
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/runs/[id]/containers/[cid]/logs returns the log text", async () => {
    const r = await importRoutes();
    makeRun("run_log", "specified");
    writeBuildState("run_log", {
      ...SAMPLE_STATE,
      run_id: "run_log",
      containers: [
        { container_id: "cid_w_31", role: "worker", story_id: "3.1", log_path: "runs/run_log/containers/3.1-worker-0.log" },
      ],
    });
    const runDir = path.join(DATA_DIR, "runs", "run_log", "containers");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "3.1-worker-0.log"), "line a\nline b\nline c\n");
    const res = await r.logs.GET(
      mockReq(`http://x/api/runs/run_log/containers/cid_w_31/logs?tail=2`),
      { params: { id: "run_log", cid: "cid_w_31" } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toBe("line b\nline c");
    expect(body.log_path).toBe("runs/run_log/containers/3.1-worker-0.log");
  });

  it("GET /api/runs/[id]/trace returns an SSE stream with a connected event", async () => {
    const r = await importRoutes();
    makeRun("run_t1", "specified");
    writeBuildState("run_t1", SAMPLE_STATE);
    const res = await r.trace.GET(mockReq(`http://x/api/runs/run_t1/trace`), { params: { id: "run_t1" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.body).not.toBeNull();
    // Read the first chunk from the stream — should contain a `connected` event.
    const reader = res.body!.getReader();
    const { value: firstChunk } = await reader.read();
    const text = new TextDecoder().decode(firstChunk ?? new Uint8Array());
    expect(text).toContain("connected");
    // Cancel the stream to release the SSE loop.
    await reader.cancel();
  }, 15000);

  it("DELETE /api/runs/[id] returns 409 when build loop has running containers (no force)", async () => {
    const r = await importRoutes();
    makeRun("run_active", "specified");
    writeBuildState("run_active", {
      ...SAMPLE_STATE,
      run_id: "run_active",
      stories: [{ ...SAMPLE_STATE.stories[0], status: "building", story_id: "3.1" }],
    });
    const res = await r.runs.DELETE(
      mockReq(`http://x/api/runs/run_active`, "DELETE"),
      { params: { id: "run_active" } },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("build loop");
  });

  it("DELETE /api/runs/[id]?force=1 deletes the run even with running build containers", async () => {
    const r = await importRoutes();
    makeRun("run_force", "specified");
    writeBuildState("run_force", {
      ...SAMPLE_STATE,
      run_id: "run_force",
      stories: [{ ...SAMPLE_STATE.stories[0], status: "building", story_id: "3.1" }],
    });
    const res = await r.runs.DELETE(
      mockReq(`http://x/api/runs/run_force?force=1`, "DELETE"),
      { params: { id: "run_force" } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe("run_force");
    // run dir removed
    expect(fs.existsSync(path.join(DATA_DIR, "runs", "run_force"))).toBe(false);
  });

  it("DELETE /api/runs/[id] deletes a run with no running build containers", async () => {
    const r = await importRoutes();
    makeRun("run_done", "built");
    writeBuildState("run_done", {
      ...SAMPLE_STATE,
      run_id: "run_done",
      stories: [{ ...SAMPLE_STATE.stories[0], status: "done", story_id: "3.1" }],
    });
    const res = await r.runs.DELETE(
      mockReq(`http://x/api/runs/run_done?force=1`, "DELETE"),
      { params: { id: "run_done" } },
    );
    expect(res.status).toBe(200);
  });
});
