import { z } from "zod";

export const SchemaVersion = z.literal(1);
export const RunId = z.string().min(1);
export const TraceId = z.string().min(1);

export const TokenUsage = z.object({
  prompt_tokens: z.number().int().nonnegative(),
  completion_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative(),
  estimated_cost_usd: z.number().nonnegative(),
});

export const GateVerdict = z.enum(["pass", "needs_changes", "escalate"]);

export const StageOutputBase = z.object({
  schema_version: SchemaVersion,
  run_id: RunId,
  trace_id: TraceId,
  gate_verdict: GateVerdict,
  gate_notes: z.string().default(""),
  token_usage: TokenUsage,
});

export const ProjectType = z.enum([
  "saas",
  "hobby",
  "cli",
  "library",
  "api-service",
  "internal-tool",
  "static-site",
  "agentic-harness",
]);

export const StageName = z.enum([
  "frame",
  "discover",
  "plan",
  "spec",
  "build",
  "ship",
]);

export const StageStatus = z.enum([
  "pass",
  "running",
  "fail",
  "pause",
  "pending",
]);

export const RunStatus = z.enum([
  "intake",
  "framed",
  "framing_failed",
  "discovered",
  "discovery_failed",
  "planned",
  "plan_failed",
  "specified",
  "spec_failed",
  "built",
  "build_failed",
  "escalated",
  "shipped",
  "ship_failed",
  "paused_cost_cap",
  "paused_step",
  "claimed",
]);

export type StageOutputBase = z.infer<typeof StageOutputBase>;
export type TokenUsage = z.infer<typeof TokenUsage>;
export type ProjectType = z.infer<typeof ProjectType>;
export type StageName = z.infer<typeof StageName>;
export type StageStatus = z.infer<typeof StageStatus>;
export type RunStatus = z.infer<typeof RunStatus>;
