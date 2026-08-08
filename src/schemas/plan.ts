import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const Adr = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["Proposed", "Accepted", "Deprecated", "Superseded"]),
});

export const PlanArtifact = z.object({
  prd_md: z.string().min(1, "prd.md content required"),
  adrs: z.array(Adr).min(1, "at least one ADR required"),
  ux_design_md: z.string().optional(),
  prototype_path: z.string().optional(),
});

export const PlanOutput = StageOutputBase.extend({
  stage: z.literal("plan"),
  status: z.enum(["planned", "plan_failed"]),
  revisions_used: z.number().int().min(0).max(2).default(0),
  artifact: PlanArtifact,
});

export type PlanOutput = z.infer<typeof PlanOutput>;
export type PlanArtifact = z.infer<typeof PlanArtifact>;

export const planJsonSchema = zodToJsonSchema(PlanOutput, "PlanOutput");
