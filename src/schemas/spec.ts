import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const SpecArtifact = z.object({
  epics_md: z.string().min(1, "epics.md content required"),
  backlog_md: z.string().min(1, "backlog.md content required"),
  dependency_graph: z.string().min(1, "dependency graph required"),
  story_count: z.number().int().positive(),
});

export const SpecOutput = StageOutputBase.extend({
  stage: z.literal("spec"),
  status: z.enum(["specified", "spec_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: SpecArtifact,
});

export type SpecOutput = z.infer<typeof SpecOutput>;
export type SpecArtifact = z.infer<typeof SpecArtifact>;

export const specJsonSchema = zodToJsonSchema(SpecOutput, "SpecOutput");
