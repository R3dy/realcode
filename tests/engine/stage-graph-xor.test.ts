import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadStageGraph, GraphValidationError } from "../../src/engine/stage-graph.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const REPO_ROOT = path.resolve(process.cwd());
const REAL_GRAPH = path.resolve(REPO_ROOT, "stage-graph.yaml");

let tmpDir: string;

function writeGraph(dir: string, stages: object[]): string {
  const graphPath = path.join(dir, "stage-graph.yaml");
  const content = {
    version: 1,
    cost_cap_usd_per_run: 8.0,
    retry_ceilings: {
      per_stage_revision: 2,
      per_story_build: 3,
      per_stage_escalation: 5,
    },
    stages,
  };
  fs.writeFileSync(graphPath, JSON.stringify(content));
  return graphPath;
}

// Use absolute paths (resolved against REPO_ROOT) so validateGraph's path
// checks pass regardless of where the temp graph file lives. Use "shipped"
// as the pass output state so it's terminal (no downstream pass transition
// needed in a single-stage synthetic graph).
const FRAME_SCHEMA = path.resolve(REPO_ROOT, "schemas/frame.schema.json");
const BUILD_SCHEMA = path.resolve(REPO_ROOT, "schemas/build.schema.json");
const FRAME_SPEC = path.resolve(REPO_ROOT, "agent-specs/frame.yaml");
const BUILD_SPEC = path.resolve(REPO_ROOT, "agent-specs/build.yaml");

// A minimal valid stage that uses agent_spec (the A4.1 pattern).
function agentSpecStage(id: string): object {
  return {
    id,
    anymake_phase: 0,
    anymake_agents: [],
    input_states: ["intake"],
    output_states: ["shipped", "framing_failed"],
    transitions: [
      { from: "intake", on: "pass", to: "shipped" },
      { from: "intake", on: "ceiling", to: "framing_failed" },
    ],
    concurrency: 1,
    soft_budget_tokens: 50000,
    timeout_ms: 600000,
    model_tier: 1,
    permission_mode: "unattended",
    artifact_schema: FRAME_SCHEMA,
    agent_spec: FRAME_SPEC,
  };
}

// A stage with inner_loop triad (no agent_spec) — the A4.4 pattern.
function innerLoopStage(id: string): object {
  return {
    id,
    anymake_phase: 4,
    anymake_agents: [],
    inner_loop: "anymake-build-loop",
    input_states: ["specified"],
    output_states: ["shipped", "build_failed"],
    transitions: [
      { from: "specified", on: "pass", to: "shipped" },
      { from: "specified", on: "ceiling", to: "build_failed" },
    ],
    concurrency: 1,
    soft_budget_tokens: 50000,
    timeout_ms: 600000,
    model_tier: 3,
    permission_mode: "unattended",
    artifact_schema: BUILD_SCHEMA,
    worker_spec: BUILD_SPEC,
    validator_spec: BUILD_SPEC,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-xor-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Stage-graph XOR rule", () => {
  it("loads the real stage-graph.yaml at A4.1 (build stage has agent_spec + dormant inner_loop)", () => {
    // The build stage has inner_loop: anymake-build-loop AND agent_spec, but
    // NO worker_spec/validator_spec. The XOR rule must NOT fire (inner_loop is dormant).
    const graph = loadStageGraph(REAL_GRAPH);
    expect(graph.stages.length).toBe(6);
    const buildStage = graph.stages.find((s) => s.id === "build")!;
    expect(buildStage.agent_spec).toBeDefined();
    expect(buildStage.inner_loop).toBeDefined();
    expect(buildStage.worker_spec).toBeUndefined();
    expect(buildStage.validator_spec).toBeUndefined();
  });

  it("rejects a stage with both agent_spec AND the inner_loop triad (cannot have both)", () => {
    const stage = agentSpecStage("frame");
    (stage as any).inner_loop = "anymake-build-loop";
    (stage as any).worker_spec = BUILD_SPEC;
    (stage as any).validator_spec = BUILD_SPEC;
    const graphPath = writeGraph(tmpDir, [stage]);
    expect(() => loadStageGraph(graphPath)).toThrow(GraphValidationError);
    try {
      loadStageGraph(graphPath);
    } catch (e) {
      const msg = (e as GraphValidationError).errors.join("\n");
      expect(msg).toContain("cannot have both agent_spec and inner_loop");
    }
  });

  it("rejects a stage with neither agent_spec nor inner_loop (must have either)", () => {
    const stage = agentSpecStage("frame");
    delete (stage as any).agent_spec;
    const graphPath = writeGraph(tmpDir, [stage]);
    expect(() => loadStageGraph(graphPath)).toThrow(GraphValidationError);
    try {
      loadStageGraph(graphPath);
    } catch (e) {
      const msg = (e as GraphValidationError).errors.join("\n");
      expect(msg).toContain("must have either agent_spec or inner_loop");
    }
  });

  it("rejects inner_loop without worker_spec/validator_spec (when no agent_spec)", () => {
    const stage = innerLoopStage("build");
    delete (stage as any).worker_spec;
    delete (stage as any).validator_spec;
    delete (stage as any).agent_spec;
    const graphPath = writeGraph(tmpDir, [stage]);
    expect(() => loadStageGraph(graphPath)).toThrow(GraphValidationError);
    try {
      loadStageGraph(graphPath);
    } catch (e) {
      const msg = (e as GraphValidationError).errors.join("\n");
      expect(msg).toContain("inner_loop requires both worker_spec and validator_spec");
    }
  });

  it("accepts a stage with the inner_loop triad (no agent_spec) — the A4.4 pattern", () => {
    const graphPath = writeGraph(tmpDir, [innerLoopStage("build")]);
    const graph = loadStageGraph(graphPath);
    expect(graph.stages.length).toBe(1);
    expect(graph.stages[0].agent_spec).toBeUndefined();
    expect(graph.stages[0].worker_spec).toBeDefined();
    expect(graph.stages[0].validator_spec).toBeDefined();
  });

  it("accepts a stage with agent_spec + bare inner_loop (no worker/validator) — the A4.1 build stage", () => {
    const stage = agentSpecStage("build");
    (stage as any).inner_loop = "anymake-build-loop";
    const graphPath = writeGraph(tmpDir, [stage]);
    const graph = loadStageGraph(graphPath);
    expect(graph.stages[0].agent_spec).toBeDefined();
    expect(graph.stages[0].inner_loop).toBeDefined();
    expect(graph.stages[0].worker_spec).toBeUndefined();
  });
});
