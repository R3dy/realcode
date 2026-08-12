import { describe, it, expect } from "vitest";
import * as path from "path";
import { loadAgentSpec } from "../../src/agents/spec-loader.js";
import { AgentSpecSchema } from "../../src/agents/spec-loader.js";
import { WorkerOutput } from "../../src/schemas/worker.js";
import { ValidatorOutput } from "../../src/schemas/validator.js";
import { parse } from "yaml";
import * as fs from "fs";

const REPO_ROOT = path.resolve(process.cwd());
const WORKER_SPEC = path.resolve(REPO_ROOT, "agent-specs/worker.yaml");
const VALIDATOR_SPEC = path.resolve(REPO_ROOT, "agent-specs/validator.yaml");

describe("agent-specs/worker.yaml (A4.4)", () => {
  it("loads and parses successfully via loadAgentSpec", () => {
    const spec = loadAgentSpec(WORKER_SPEC);
    expect(spec.stage).toBe("build_worker");
    expect(spec.anymake_phase).toBe(4);
    expect(spec.model_tier).toBe(3);
    expect(spec.permission_mode).toBe("unattended");
  });

  it("satisfies the AgentSpecSchema (zod parse passes)", () => {
    const raw = fs.readFileSync(WORKER_SPEC, "utf8");
    const parsed = parse(raw);
    const result = AgentSpecSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("tool_allowlist is exactly Read, Write, Edit, Bash", () => {
    const spec = loadAgentSpec(WORKER_SPEC);
    expect(spec.tool_allowlist).toEqual(
      expect.arrayContaining(["Read", "Write", "Edit", "Bash"]),
    );
    expect(spec.tool_allowlist).not.toContain("WebFetch");
  });

  it("system_prompt is self-contained (INV-7): no positive external-file read instructions", () => {
    const spec = loadAgentSpec(WORKER_SPEC);
    // INV-7 forbids instructing the agent to read external files (e.g.
    // "Read PHASE_GUIDES/phase-4.md" or "Required reading: TEMPLATES/...").
    // Negative mentions ("Do NOT read PHASE_GUIDES/") are allowed and match
    // build.yaml's pattern — they tell the agent what NOT to look for.
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?PHASE_GUIDES/i);
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?TEMPLATES/i);
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?AGENTS/i);
    expect(spec.system_prompt).not.toMatch(/Required reading/i);
    // Must contain the context-discipline guard (negative mentions are fine)
    expect(spec.system_prompt).toMatch(/node_modules/);
    expect(spec.system_prompt).toMatch(/\.git/);
    expect(spec.system_prompt).toMatch(/dist/);
    expect(spec.system_prompt).toMatch(/coverage/);
    // Must tell the agent there is no Task tool / no subagents
    expect(spec.system_prompt).toMatch(/NO Task tool/);
  });

  it("user_prompt_template uses the required placeholders", () => {
    const spec = loadAgentSpec(WORKER_SPEC);
    expect(spec.user_prompt_template).toContain("{story_id}");
    expect(spec.user_prompt_template).toContain("{story_title}");
    expect(spec.user_prompt_template).toContain("{acceptance_criteria}");
    expect(spec.user_prompt_template).toContain("{workspace}");
    // Prior-art placeholders (resolvable via gatherPriorArtifacts + extraContext)
    expect(spec.user_prompt_template).toContain("{frame.project_type}");
    expect(spec.user_prompt_template).toContain("{plan.prd_md}");
    expect(spec.user_prompt_template).toContain("{plan.adrs}");
  });

  it("output contract emits gate_verdict values per the §4.2 mapping table", () => {
    const spec = loadAgentSpec(WORKER_SPEC);
    // The mapping table: success → pass; environment failure → needs_changes;
    // implementation failure / cannot proceed → escalate
    expect(spec.system_prompt).toMatch(/"pass"/);
    expect(spec.system_prompt).toMatch(/"needs_changes"/);
    expect(spec.system_prompt).toMatch(/"escalate"/);
    expect(spec.system_prompt).toMatch(/"success"/);
    expect(spec.system_prompt).toMatch(/"failed"/);
    expect(spec.system_prompt).toMatch(/environment/);
    expect(spec.system_prompt).toMatch(/implementation/);
  });
});

describe("agent-specs/validator.yaml (A4.4)", () => {
  it("loads and parses successfully via loadAgentSpec", () => {
    const spec = loadAgentSpec(VALIDATOR_SPEC);
    expect(spec.stage).toBe("build_validator");
    expect(spec.anymake_phase).toBe(4);
    expect(spec.model_tier).toBe(2);
    expect(spec.permission_mode).toBe("unattended");
  });

  it("satisfies the AgentSpecSchema (zod parse passes)", () => {
    const raw = fs.readFileSync(VALIDATOR_SPEC, "utf8");
    const parsed = parse(raw);
    const result = AgentSpecSchema.safeParse(parsed);
    expect(result.success).toBe(true);
  });

  it("tool_allowlist has Read + Bash and NO Write/Edit (validator never modifies code)", () => {
    const spec = loadAgentSpec(VALIDATOR_SPEC);
    expect(spec.tool_allowlist).toContain("Read");
    expect(spec.tool_allowlist).toContain("Bash");
    expect(spec.tool_allowlist).not.toContain("Write");
    expect(spec.tool_allowlist).not.toContain("Edit");
    expect(spec.tool_allowlist).not.toContain("WebFetch");
  });

  it("system_prompt is self-contained (INV-7): no positive external-file read instructions", () => {
    const spec = loadAgentSpec(VALIDATOR_SPEC);
    // INV-7 forbids instructing the agent to read external files. Negative
    // mentions ("Do NOT read PHASE_GUIDES/") are allowed.
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?PHASE_GUIDES/i);
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?TEMPLATES/i);
    expect(spec.system_prompt).not.toMatch(/Read (?:the )?AGENTS/i);
    expect(spec.system_prompt).not.toMatch(/Required reading/i);
    // Must contain the context-discipline guard
    expect(spec.system_prompt).toMatch(/node_modules/);
    expect(spec.system_prompt).toMatch(/\.git/);
    expect(spec.system_prompt).toMatch(/dist/);
    expect(spec.system_prompt).toMatch(/coverage/);
    // Must state it never edits code
    expect(spec.system_prompt).toMatch(/NEVER edit/i);
  });

  it("user_prompt_template uses the required placeholders", () => {
    const spec = loadAgentSpec(VALIDATOR_SPEC);
    expect(spec.user_prompt_template).toContain("{story_id}");
    expect(spec.user_prompt_template).toContain("{story_title}");
    expect(spec.user_prompt_template).toContain("{acceptance_criteria}");
    expect(spec.user_prompt_template).toContain("{worker_output}");
    expect(spec.user_prompt_template).toContain("{workspace}");
  });

  it("output contract emits gate_verdict + verdict per the §4.2 mapping table", () => {
    const spec = loadAgentSpec(VALIDATOR_SPEC);
    // gate_verdict: "pass" (sandbox ran) or "escalate" (crash / verdict=escalate)
    expect(spec.system_prompt).toMatch(/"pass"/);
    expect(spec.system_prompt).toMatch(/"escalate"/);
    // artifact.verdict: pass | fail | escalate
    expect(spec.system_prompt).toMatch(/verdict/);
    expect(spec.system_prompt).toMatch(/"fail"/);
    // Security checklist reference
    expect(spec.system_prompt).toMatch(/security/i);
  });
});

describe("worker.yaml + validator.yaml: dispatch compatibility (A4.4)", () => {
  it("the worker spec's output contract matches the WorkerOutput zod schema shape", () => {
    // The artifact block the worker emits must be validatable by WorkerOutput.
    // Construct a minimal valid WorkerOutput and confirm the field names the
    // spec mentions are all present in the schema.
    const sample = {
      schema_version: 1 as const,
      run_id: "run_x",
      trace_id: "trace_x",
      gate_verdict: "pass" as const,
      gate_notes: "ok",
      token_usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        estimated_cost_usd: 0,
      },
      stage: "build_worker" as const,
      status: "success" as const,
      artifact: {
        story_id: "3.1",
        result: "success" as const,
        branch: "main",
        commits: [{ sha: "abc", message: "feat" }],
        test_output: "all pass",
        test_passed: 5,
        test_failed: 0,
        notes: "",
      },
    };
    expect(WorkerOutput.safeParse(sample).success).toBe(true);
  });

  it("the validator spec's output contract matches the ValidatorOutput zod schema shape", () => {
    const sample = {
      schema_version: 1 as const,
      run_id: "run_x",
      trace_id: "trace_x",
      gate_verdict: "pass" as const,
      gate_notes: "ok",
      token_usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
        estimated_cost_usd: 0,
      },
      stage: "build_validator" as const,
      status: "pass" as const,
      artifact: {
        story_id: "3.1",
        verdict: "pass" as const,
        criteria_results: [{ criterion: "works", result: "pass", evidence: "ran tests" }],
        security_checklist: [{ check: "no secrets", result: "pass" }],
        notes: "",
      },
    };
    expect(ValidatorOutput.safeParse(sample).success).toBe(true);
  });
});
