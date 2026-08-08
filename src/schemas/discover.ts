import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const FailureMode = z.object({
  mode: z.string().min(1),
  mitigation: z.string().min(1),
});

export const DiscoverArtifact = z.object({
  discovery_md: z.string().min(1, "discovery.md content required"),
  lite_mode: z.boolean(),
  failure_modes: z.array(FailureMode).min(1, "at least one failure mode required"),
});

export const DiscoverOutput = StageOutputBase.extend({
  stage: z.literal("discover"),
  status: z.enum(["discovered", "discovery_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: DiscoverArtifact,
});

export type DiscoverOutput = z.infer<typeof DiscoverOutput>;
export type DiscoverArtifact = z.infer<typeof DiscoverArtifact>;

export const discoverJsonSchema = zodToJsonSchema(DiscoverOutput, "DiscoverOutput");
