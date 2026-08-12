import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StageOutputBase } from "./base.js";

export const CriterionResult = z.object({
  criterion: z.string().min(1),
  result: z.string().min(1),
  evidence: z.string().default(""),
});

export const SecurityChecklistEntry = z.object({
  check: z.string().min(1),
  result: z.string().min(1),
});

export const ValidatorArtifact = z.object({
  story_id: z.string().min(1),
  verdict: z.enum(["pass", "fail", "escalate"]),
  escalation_type: z.string().optional(),
  criteria_results: z.array(CriterionResult).default([]),
  security_checklist: z.array(SecurityChecklistEntry).default([]),
  notes: z.string().default(""),
});

export const ValidatorOutput = StageOutputBase.extend({
  stage: z.literal("build_validator"),
  status: z.enum(["pass", "fail", "escalate"]),
  artifact: ValidatorArtifact,
});

export type ValidatorOutput = z.infer<typeof ValidatorOutput>;
export type ValidatorArtifact = z.infer<typeof ValidatorArtifact>;

export const validatorJsonSchema = zodToJsonSchema(
  ValidatorOutput,
  "ValidatorOutput",
);
