import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { RunRecord, RunDetailResponse, DetailStageStatus, RunNotFoundError as RNF } from "../src/dashboard/lib/engine.js";
import type { StageName } from "../src/dashboard/lib/data.js";

const TMP_DIR = path.join(os.tmpdir(), `realcode-test-${Date.now()}-${process.pid}`);
const DATA_DIR = path.join(TMP_DIR, "data");

// We need to import the engine module AFTER setting the env var, so we use
// dynamic imports with vi.resetModules() in beforeEach.
async function importEngine() {
  vi.resetModules();
  return (await import("../src/dashboard/lib/engine.js")) as typeof import("../src/dashboard/lib/engine.js");
}

// deriveStageStatuses is a pure function — it doesn't depend on DATA_DIR,
// so we can import it statically for those tests
import { deriveStageStatuses } from "../src/dashboard/lib/engine.js";

function makeRun(id: string, status: string, artifacts: StageName[] = [], dataDir = DATA_DIR): RunRecord {
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
  for (const stage of artifacts) {
    fs.writeFileSync(
      path.join(runDir, `${stage}.json`),
      JSON.stringify({ stage, test: true }, null, 2),
    );
  }
  return run;
}

describe("deriveStageStatuses (pure function)", () => {
  it("returns all pass for a shipped run", () => {
    const run = { status: "shipped" } as RunRecord;
    const present = new Set<StageName>(["frame", "discover", "plan", "spec", "build", "ship"]);
    const result = deriveStageStatuses(run, present);
    for (const stage of ["frame", "discover", "plan", "spec", "build", "ship"] as StageName[]) {
      expect(result[stage]).toBe("pass");
    }
  });

  it("returns fail for the failure stage and not-reached for later stages", () => {
    const run = { status: "spec_failed" } as RunRecord;
    const present = new Set<StageName>(["frame", "discover", "plan"]);
    const result = deriveStageStatuses(run, present);
    expect(result.frame).toBe("pass");
    expect(result.discover).toBe("pass");
    expect(result.plan).toBe("pass");
    expect(result.spec).toBe("fail");
    expect(result.build).toBe("not-reached");
    expect(result.ship).toBe("not-reached");
  });

  it("returns running for the in-flight stage of an active run", () => {
    const run = { status: "specified" } as RunRecord;
    const present = new Set<StageName>(["frame", "discover", "plan", "spec"]);
    const result = deriveStageStatuses(run, present);
    expect(result.frame).toBe("pass");
    expect(result.discover).toBe("pass");
    expect(result.plan).toBe("pass");
    expect(result.spec).toBe("pass");
    expect(result.build).toBe("running");
    expect(result.ship).toBe("not-reached");
  });

  it("returns pending for the frame stage of an intake run", () => {
    const run = { status: "intake" } as RunRecord;
    const present = new Set<StageName>([]);
    const result = deriveStageStatuses(run, present);
    expect(result.frame).toBe("pending");
    expect(result.discover).toBe("not-reached");
    expect(result.ship).toBe("not-reached");
  });

  it("returns fail for framing_failed", () => {
    const run = { status: "framing_failed" } as RunRecord;
    const present = new Set<StageName>([]);
    const result = deriveStageStatuses(run, present);
    expect(result.frame).toBe("fail");
    expect(result.discover).toBe("not-reached");
  });
});

describe("engine.getRunDetail + deleteRun", () => {
  beforeEach(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    process.env.REALCODE_DATA_DIR = DATA_DIR;
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    delete process.env.REALCODE_DATA_DIR;
  });

  it("getRunDetail returns null for a non-existent run", async () => {
    const { getEngine } = await importEngine();
    expect(getEngine().getRunDetail("run_nonexistent")).toBeNull();
  });

  it("getRunDetail returns run + stages + artifacts for a shipped run", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_shipped", "shipped", ["frame", "discover", "plan", "spec", "build", "ship"]);
    const detail = getEngine().getRunDetail("run_shipped");
    expect(detail).not.toBeNull();
    expect(detail!.run.run_id).toBe("run_shipped");
    expect(detail!.stages.ship).toBe("pass");
    expect(detail!.artifacts.ship).toBeDefined();
    expect(detail!.artifacts.frame).toBeDefined();
  });

  it("getRunDetail returns partial artifacts for a failed run", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_failed", "discovery_failed", ["frame"]);
    const detail = getEngine().getRunDetail("run_failed");
    expect(detail).not.toBeNull();
    expect(detail!.stages.frame).toBe("pass");
    expect(detail!.stages.discover).toBe("fail");
    expect(detail!.stages.plan).toBe("not-reached");
    expect(detail!.artifacts.frame).toBeDefined();
    expect(detail!.artifacts.discover).toBeUndefined();
  });

  it("deleteRun removes the run directory", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_del1", "framing_failed", []);
    const runDir = path.join(DATA_DIR, "runs", "run_del1");
    expect(fs.existsSync(runDir)).toBe(true);
    getEngine().deleteRun("run_del1");
    expect(fs.existsSync(runDir)).toBe(false);
  });

  it("deleteRun removes the workspace directory if present", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_del2", "framing_failed", []);
    const wsDir = path.join(DATA_DIR, "workspaces", "run_del2");
    fs.mkdirSync(wsDir, { recursive: true });
    fs.writeFileSync(path.join(wsDir, "test.txt"), "hello");
    getEngine().deleteRun("run_del2");
    expect(fs.existsSync(wsDir)).toBe(false);
  });

  it("deleteRun throws RunNotFoundError for a missing run", async () => {
    const { getEngine, RunNotFoundError } = await importEngine();
    expect(() => getEngine().deleteRun("run_does_not_exist")).toThrow(RunNotFoundError);
  });

  it("deleteRun does NOT check active status — gate lives in the route", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_active", "intake", []);
    getEngine().deleteRun("run_active");
    expect(getEngine().getRun("run_active")).toBeNull();
  });

  it("deleteRun does not affect other runs", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_a", "framing_failed", []);
    makeRun("run_b", "shipped", ["frame", "discover", "plan", "spec", "build", "ship"]);
    getEngine().deleteRun("run_a");
    expect(getEngine().getRun("run_a")).toBeNull();
    expect(getEngine().getRun("run_b")).not.toBeNull();
    expect(getEngine().getRunDetail("run_b")!.stages.ship).toBe("pass");
  });

  it("after deleteRun, getRunDetail returns null", async () => {
    const { getEngine } = await importEngine();
    makeRun("run_del3", "ship_failed", ["frame", "discover", "plan", "spec", "build"]);
    getEngine().deleteRun("run_del3");
    expect(getEngine().getRunDetail("run_del3")).toBeNull();
  });
});
