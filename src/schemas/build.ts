import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const TestResults = z.object({
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  coverage_pct: z.number().min(0).max(100),
});

export const PrMerged = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  url: z.string().url(),
});

export const Escalation = z.object({
  story: z.string().min(1),
  reason: z.string().min(1),
});

export const StoryBuildResult = z.object({
  story_id: z.string().min(1),
  status: z.enum(["done", "failed", "escalated"]),
  retry_count: z.number().int().nonnegative(),
  worker_tokens: z.number().int().nonnegative(),
  validator_tokens: z.number().int().nonnegative(),
  worker_cost_usd: z.number().nonnegative(),
  validator_cost_usd: z.number().nonnegative(),
  test_passed: z.number().int().nonnegative(),
  test_failed: z.number().int().nonnegative(),
});

export const BuildArtifact = z.object({
  repo_path: z.string().min(1, "repo path required"),
  test_results: TestResults,
  prs_merged: z.array(PrMerged).default([]),
  escalations: z.array(Escalation).default([]),
  stories: z.array(StoryBuildResult).optional(),
});

export const BuildOutput = StageOutputBase.extend({
  stage: z.literal("build"),
  status: z.enum(["built", "build_failed", "escalated"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  escalation_count: z.number().int().min(0).default(0),
  artifact: BuildArtifact,
});

export type BuildOutput = z.infer<typeof BuildOutput>;
export type BuildArtifact = z.infer<typeof BuildArtifact>;
export type StoryBuildResult = z.infer<typeof StoryBuildResult>;

export const buildJsonSchema = zodToJsonSchema(BuildOutput, "BuildOutput");
