import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase, ProjectType } from "./base.js";

export const FrameArtifact = z.object({
  project_md: z.string().min(1, "PROJECT.md content required"),
  project_type: ProjectType,
  has_ui: z.boolean(),
  is_sellable: z.boolean(),
});

export const FrameOutput = StageOutputBase.extend({
  stage: z.literal("frame"),
  status: z.enum(["framed", "framing_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: FrameArtifact,
});

export type FrameOutput = z.infer<typeof FrameOutput>;
export type FrameArtifact = z.infer<typeof FrameArtifact>;

export const frameJsonSchema = zodToJsonSchema(FrameOutput, "FrameOutput");
