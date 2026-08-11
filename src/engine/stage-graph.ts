import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";

const Transition = z.object({
  from: z.string(),
  on: z.enum(["pass", "needs_changes", "ceiling", "escalate", "reframe", "rediscover", "replan", "respec", "rebuild"]),
  to: z.string(),
  count_toward: z.enum(["revision", "loopback"]).optional(),
});

const StageEntry = z.object({
  id: z.string().min(1),
  anymake_phase: z.number().int().min(0).max(5),
  anymake_agents: z.array(z.string()).default([]),
  inner_loop: z.string().optional(),
  input_states: z.array(z.string()).min(1),
  output_states: z.array(z.string()).min(1),
  transitions: z.array(Transition).min(1),
  concurrency: z.number().int().positive().default(1),
  soft_budget_tokens: z.number().int().positive(),
  timeout_ms: z.number().int().positive().default(300_000),
  model_tier: z.number().int().min(1).max(3),
  permission_mode: z.enum(["unattended", "unattended_with_approval_on_deploy"]),
  artifact_schema: z.string().min(1),
  agent_spec: z.string().min(1),
});

const StageGraph = z.object({
  version: z.literal(1),
  cost_cap_usd_per_run: z.number().positive(),
  retry_ceilings: z.object({
    per_stage_revision: z.number().int().positive(),
    per_story_build: z.number().int().positive(),
    per_stage_escalation: z.number().int().positive(),
  }),
  stages: z.array(StageEntry).min(1),
});

export type StageEntry = z.infer<typeof StageEntry>;
export type Transition = z.infer<typeof Transition>;
export type StageGraph = z.infer<typeof StageGraph>;

export class GraphValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Stage graph validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    this.name = "GraphValidationError";
  }
}

export function loadStageGraph(configPath: string): StageGraph {
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = parse(raw);
  const result = StageGraph.safeParse(parsed);
  if (!result.success) {
    throw new GraphValidationError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  validateGraph(result.data, path.dirname(configPath));
  return result.data;
}

function validateGraph(graph: StageGraph, baseDir: string): void {
  const errors: string[] = [];
  const allStates = new Set<string>();
  const stageIds = new Set<string>();
  const allTransitions: { stage: string; from: string; on: string; to: string; count_toward?: string }[] = [];

  for (const stage of graph.stages) {
    if (stageIds.has(stage.id)) errors.push(`Duplicate stage id: ${stage.id}`);
    stageIds.add(stage.id);
    stage.input_states.forEach((s) => allStates.add(s));
    stage.output_states.forEach((s) => allStates.add(s));
    for (const t of stage.transitions) {
      allTransitions.push({ stage: stage.id, ...t });
    }
  }

  for (const stage of graph.stages) {
    // 1. Failed states are terminal (no outbound transitions from them in ANY stage)
    for (const out of stage.output_states) {
      if (out.endsWith("_failed") || out === "escalated") {
        const hasOutbound = allTransitions.some((t) => t.from === out);
        if (hasOutbound) errors.push(`Stage ${stage.id}: terminal state '${out}' has outbound transitions (should be terminal)`);
      }
    }
  }

  // 2. Every non-terminal output state has a pass transition (in ANY stage) that uses it as `from`
  //    OR it's the final terminal state (`shipped`)
  for (const stage of graph.stages) {
    for (const out of stage.output_states) {
      if (out.endsWith("_failed") || out === "escalated" || out === "shipped") continue;
      const hasPass = allTransitions.some((t) => t.from === out && t.on === "pass");
      if (!hasPass) errors.push(`Output state '${out}' (from stage ${stage.id}) has no 'on: pass' transition in any stage`);
    }
  }

  // 3. Transition targets exist
  for (const t of allTransitions) {
    if (!allStates.has(t.to) && t.to !== t.from) {
      errors.push(`Stage ${t.stage}: transition '${t.from} -> ${t.to}' targets unknown state '${t.to}'`);
    }
  }

  // 4. artifact_schema + agent_spec paths resolve
  for (const stage of graph.stages) {
    if (!fs.existsSync(path.resolve(baseDir, stage.artifact_schema))) {
      errors.push(`Stage ${stage.id}: artifact_schema path '${stage.artifact_schema}' does not exist`);
    }
    if (!fs.existsSync(path.resolve(baseDir, stage.agent_spec))) {
      errors.push(`Stage ${stage.id}: agent_spec path '${stage.agent_spec}' does not exist`);
    }
  }

  // 5. Acyclic among forward edges (exclude both loopback AND revision self-loops -- both are bounded by retry ceilings)
  const forwardEdges: Record<string, string[]> = {};
  for (const t of allTransitions) {
    if (t.count_toward === "loopback" || t.count_toward === "revision") continue;
    forwardEdges[t.from] = forwardEdges[t.from] || [];
    forwardEdges[t.from].push(t.to);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(node: string): boolean {
    if (stack.has(node)) return true; // cycle
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const next of forwardEdges[node] || []) {
      if (dfs(next)) return true;
    }
    stack.delete(node);
    return false;
  }
  for (const node of Object.keys(forwardEdges)) {
    if (dfs(node)) {
      errors.push(`Cycle detected in forward transitions involving state '${node}'`);
      break;
    }
  }

  if (errors.length > 0) throw new GraphValidationError(errors);
}

export function findStage(graph: StageGraph, stageId: string): StageEntry | undefined {
  return graph.stages.find((s) => s.id === stageId);
}

export function findStageForStatus(graph: StageGraph, status: string): StageEntry | undefined {
  return graph.stages.find((s) => s.input_states.includes(status));
}

export function applyTransition(graph: StageGraph, stageId: string, from: string, on: string): string | null {
  const stage = findStage(graph, stageId);
  if (!stage) return null;
  const t = stage.transitions.find((tr) => tr.from === from && tr.on === on);
  return t ? t.to : null;
}
