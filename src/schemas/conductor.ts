import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

/**
 * Conductor stage (stage 0) — intent classification.
 *
 * The conductor is NOT a container-based stage. It runs a direct LLM call
 * inside the engine process to classify the user's request as either a
 * new-project build (full anymake pipeline) or a change to an existing
 * project (agile flow). The classification determines which branch of the
 * stage graph the run enters.
 */
export const ConductorArtifact = z.object({
  intent: z.enum(["new", "change"]),
  target_project: z.string().nullish(),
  flow_type: z.enum(["full", "agile"]),
  clean_idea: z.string().min(1, "clean idea required"),
  classification_reasoning: z.string().default(""),
  available_projects: z.array(z.string()).default([]),
});

export const ConductorOutput = StageOutputBase.extend({
  stage: z.literal("conductor"),
  status: z.enum(["classified_new", "classified_change", "conductor_failed"]),
  revisions_used: z.number().int().min(0).max(0).default(0),
  artifact: ConductorArtifact,
});

export type ConductorOutput = z.infer<typeof ConductorOutput>;
export type ConductorArtifact = z.infer<typeof ConductorArtifact>;

export const conductorJsonSchema = zodToJsonSchema(ConductorOutput, "ConductorOutput");
