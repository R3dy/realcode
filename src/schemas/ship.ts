import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const ShipArtifact = z.object({
  live_url: z.string().url().nullish(),
  repo_url: z.string().url().nullish(),
  launch_checklist_md: z.string().min(1, "launch checklist required"),
  metrics_dashboard_md: z.string().min(1, "metrics dashboard required"),
}).refine(
  (a) => a.live_url || a.repo_url,
  { message: "either live_url or repo_url is required" },
);

export const ShipOutput = StageOutputBase.extend({
  stage: z.literal("ship"),
  status: z.enum(["shipped", "ship_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: ShipArtifact,
});

export type ShipOutput = z.infer<typeof ShipOutput>;
export type ShipArtifact = z.infer<typeof ShipArtifact>;

export const shipJsonSchema = zodToJsonSchema(ShipOutput, "ShipOutput");
