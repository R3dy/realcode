import { z } from "zod";
import { parse } from "yaml";
import * as fs from "fs";

export const AgentSpecSchema = z.object({
  stage: z.string().min(1),
  anymake_phase: z.number().int().min(0).max(5),
  system_prompt: z.string().min(1),
  user_prompt_template: z.string().min(1),
  tool_allowlist: z.array(z.string()).min(1),
  model_tier: z.number().int().min(1).max(3),
  permission_mode: z.enum(["unattended", "unattended_with_approval_on_deploy"]),
});

export type AgentSpec = z.infer<typeof AgentSpecSchema>;

export function loadAgentSpec(filePath: string): AgentSpec {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parse(raw);
  if (!parsed) {
    throw new Error(`Agent spec at ${filePath} is empty or unparseable`);
  }
  const result = AgentSpecSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid agent spec at ${filePath}:\n${errors}`);
  }
  return result.data;
}
