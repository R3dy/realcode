import { describe, it, expect } from "vitest";
import { loadStageGraph, GraphValidationError } from "../src/engine/stage-graph.js";
import * as path from "path";

const GRAPH_PATH = path.resolve(process.cwd(), "stage-graph.yaml");

describe("Stage graph loader", () => {
  it("loads and validates the real stage-graph.yaml", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    expect(graph.version).toBe(1);
    expect(graph.stages.length).toBe(8);
    expect(graph.stages.map((s) => s.id)).toEqual([
      "conductor", "frame", "discover", "plan", "spec", "build", "ship", "change",
    ]);
  });

  it("every stage has input states, output states, and transitions", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    for (const stage of graph.stages) {
      expect(stage.input_states.length).toBeGreaterThanOrEqual(1);
      expect(stage.output_states.length).toBeGreaterThanOrEqual(1);
      expect(stage.transitions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("failed states are terminal (no outbound transitions)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    for (const stage of graph.stages) {
      for (const out of stage.output_states) {
        if (out.endsWith("_failed") || out === "escalated") {
          const hasOutbound = stage.transitions.some((t) => t.from === out);
          expect(hasOutbound).toBe(false);
        }
      }
    }
  });

  it("cost cap is set", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    expect(graph.cost_cap_usd_per_run).toBe(8.0);
  });
});

describe("Hard gate: zero hard-coded stage logic in engine code", () => {
  it("no `if stage ==` or `switch(stage)` in engine source", () => {
    const engineSrc = `
      ${require("fs").readFileSync(path.resolve(process.cwd(), "src/engine/dispatcher.ts"), "utf8")}
      ${require("fs").readFileSync(path.resolve(process.cwd(), "src/engine/stage-graph.ts"), "utf8")}
    `;
    // Check for hard-coded stage dispatch (if/switch on stage name)
    expect(engineSrc).not.toMatch(/if\s*\(\s*(stage|item\.stage|stageId)\s*==/i);
    expect(engineSrc).not.toMatch(/switch\s*\(\s*(stage|item\.stage|stageId)\s*\)/i);
  });
});
