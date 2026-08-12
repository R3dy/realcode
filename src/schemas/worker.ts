import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const WorkerArtifact = z.object({
  story_id: z.string().min(1),
  result: z.enum(["success", "failed"]),
  failure_type: z.enum(["environment", "implementation"]).optional(),
  failure_description: z.string().optional(),
  branch: z.string().min(1),
  commits: z
    .array(z.object({ sha: z.string(), message: z.string() }))
    .default([]),
  test_output: z.string().default(""),
  test_passed: z.number().int().nonnegative().default(0),
  test_failed: z.number().int().nonnegative().default(0),
  notes: z.string().default(""),
});

export const WorkerOutput = StageOutputBase.extend({
  stage: z.literal("build_worker"),
  status: z.enum(["success", "failed", "escalated"]),
  artifact: WorkerArtifact,
});

export type WorkerOutput = z.infer<typeof WorkerOutput>;
export type WorkerArtifact = z.infer<typeof WorkerArtifact>;

export const workerJsonSchema = zodToJsonSchema(WorkerOutput, "WorkerOutput");
