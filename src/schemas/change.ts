import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

/**
 * Change stage — the agile flow for modifying an existing project.
 *
 * When the conductor classifies a request as `change`, the run enters this
 * stage instead of the full 6-stage greenfield pipeline. The change stage
 * spawns a single sandbox container with the REAL project directory mounted
 * read-write (no copy), and the agent makes the requested change directly.
 *
 * This mirrors what a human would do: read the relevant file, edit it, run
 * tests, commit. For a simple change like "add a footer", this takes 2-5
 * minutes instead of 20+ minutes through the full pipeline.
 */
export const ChangeArtifact = z.object({
  changes_summary: z.string().min(1, "summary of changes required"),
  files_modified: z.array(z.string()).default([]),
  files_created: z.array(z.string()).default([]),
  tests_run: z.boolean().default(false),
  tests_passed: z.boolean().default(false),
  test_output: z.string().default(""),
  commit_sha: z.string().nullish(),
  commit_message: z.string().nullish(),
  target_project: z.string(),
});

export const ChangeOutput = StageOutputBase.extend({
  stage: z.literal("change"),
  status: z.enum(["shipped", "change_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: ChangeArtifact,
});

export type ChangeOutput = z.infer<typeof ChangeOutput>;
export type ChangeArtifact = z.infer<typeof ChangeArtifact>;

export const changeJsonSchema = zodToJsonSchema(ChangeOutput, "ChangeOutput");
