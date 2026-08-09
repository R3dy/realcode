import * as path from "path";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { StageRunner } from "../engine/dispatcher.js";
import type { StageEntry, StageGraph } from "../engine/stage-graph.js";
import type { WorkItem, Storage } from "../backend/types.js";
import { SandboxRunner } from "../sandbox/runner.js";
import { loadAgentSpec, type AgentSpec } from "./spec-loader.js";
import {
  FrameOutput,
  DiscoverOutput,
  PlanOutput,
  SpecOutput,
  BuildOutput,
  ShipOutput,
} from "../schemas/index.js";

const STAGE_SCHEMAS: Record<string, ZodTypeAny> = {
  frame: FrameOutput,
  discover: DiscoverOutput,
  plan: PlanOutput,
  spec: SpecOutput,
  build: BuildOutput,
  ship: ShipOutput,
};

const TIER_ENV: Record<number, string> = {
  1: "ANYMAKE_MODEL_TIER1",
  2: "ANYMAKE_MODEL_TIER2",
  3: "ANYMAKE_MODEL_TIER3",
};

const DEFAULT_MODEL = "openrouter/z-ai/glm-5.2";
const DEFAULT_TIMEOUT_MS = 300_000;

const ARTIFACT_TAG_OPEN = "<artifact>";
const ARTIFACT_TAG_CLOSE = "</artifact>";

export interface AgentStageRunnerOptions {
  localMode?: boolean;
  repoRoot: string;
  timeoutMs?: number;
}

export class AgentStageRunner implements StageRunner {
  constructor(
    private sandbox: SandboxRunner,
    private storage: Storage,
    private graph: StageGraph,
    private options: AgentStageRunnerOptions,
  ) {}

  async run(item: WorkItem, stage: StageEntry, workspacePath: string) {
    const specPath = path.resolve(this.options.repoRoot, stage.agent_spec);
    const spec = loadAgentSpec(specPath);
    const model = this.resolveModel(stage, spec);
    const priorArtifacts = this.gatherPriorArtifacts(item.run_id, stage.id, item.payload);
    const userPrompt = this.fillTemplate(spec.user_prompt_template, priorArtifacts);
    const schemaJson = this.getStageSchemaJson(stage.id);
    const dispatchMessage = this.buildDispatchMessage(spec, userPrompt, schemaJson, stage);
    const traceId = (item.payload.trace_id as string) || item.run_id;

    const result = await this.sandbox.run({
      workspacePath,
      model,
      dispatchMessage,
      traceparent: traceId,
      localMode: this.options.localMode ?? true,
      timeoutMs: this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const tokenUsage = SandboxRunner.extractTokenUsage(result.jsonEvents ?? []);

    if (result.timedOut || result.exitCode !== 0) {
      return {
        output_status: "escalate" as const,
        artifact: {
          error: `Stage ${stage.id} sandbox failed: exit ${result.exitCode}, timedOut ${result.timedOut}`,
          stderr: result.stderr.slice(-1000),
        },
        token_usage: tokenUsage,
        trace_id: traceId,
      };
    }

    const partialArtifact = this.extractArtifact(result.stdout);
    if (!partialArtifact) {
      return {
        output_status: "escalate" as const,
        artifact: {
          error: `No <artifact> JSON block found in stage ${stage.id} output`,
          stdout_tail: result.stdout.slice(-1000),
        },
        token_usage: tokenUsage,
        trace_id: traceId,
      };
    }

    const fullOutput = {
      schema_version: 1 as const,
      run_id: item.run_id,
      trace_id: traceId,
      token_usage: tokenUsage,
      stage: stage.id,
      ...partialArtifact,
    };

    const schema = STAGE_SCHEMAS[stage.id];
    if (!schema) {
      return {
        output_status: "escalate" as const,
        artifact: { error: `No schema registered for stage ${stage.id}` },
        token_usage: tokenUsage,
        trace_id: traceId,
      };
    }

    const validated = schema.safeParse(fullOutput);
    if (!validated.success) {
      return {
        output_status: "escalate" as const,
        artifact: {
          error: `Artifact validation failed for stage ${stage.id}`,
          issues: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          raw_artifact: partialArtifact,
        },
        token_usage: tokenUsage,
        trace_id: traceId,
      };
    }

    return {
      output_status: validated.data.gate_verdict as string,
      artifact: validated.data.artifact as Record<string, unknown>,
      token_usage: tokenUsage,
      trace_id: validated.data.trace_id as string,
    };
  }

  resolveModel(stage: StageEntry, spec: AgentSpec): string {
    const tierEnv = TIER_ENV[spec.model_tier];
    if (tierEnv && process.env[tierEnv]) {
      return process.env[tierEnv]!;
    }
    return process.env.ANYMAKE_MODEL_TIER1 ?? DEFAULT_MODEL;
  }

  gatherPriorArtifacts(
    runId: string,
    currentStageId: string,
    intakePayload: Record<string, unknown>,
  ): Record<string, unknown> {
    const ctx: Record<string, unknown> = { idea: intakePayload.idea ?? "", workspace: intakePayload.workspace ?? "" };

    const stageOrder = this.graph.stages.map((s) => s.id);
    const currentIdx = stageOrder.indexOf(currentStageId);
    if (currentIdx <= 0) return ctx;

    for (let i = 0; i < currentIdx; i++) {
      const priorStageId = stageOrder[i];
      const raw = this.storage.read(`runs/${runId}/${priorStageId}.json`);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const artifact = (parsed.artifact as Record<string, unknown>) || {};
        ctx[priorStageId] = artifact;
      } catch {
        // corrupted prior artifact — skip; the gate for that stage should have caught it
      }
    }
    return ctx;
  }

  fillTemplate(template: string, ctx: Record<string, unknown>): string {
    return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (match, key: string) => {
      const parts = key.split(".");
      let val: unknown = ctx;
      for (const p of parts) {
        if (val && typeof val === "object" && p in (val as Record<string, unknown>)) {
          val = (val as Record<string, unknown>)[p];
        } else {
          return match;
        }
      }
      if (typeof val === "string") {
        return val.length > 2000 ? val.slice(0, 2000) + "\n...[truncated]" : val;
      }
      if (typeof val === "number" || typeof val === "boolean") {
        return String(val);
      }
      if (val && typeof val === "object") {
        const json = JSON.stringify(val, null, 2);
        return json.length > 2000 ? json.slice(0, 2000) + "\n...[truncated]" : json;
      }
      return match;
    });
  }

  extractArtifact(stdout: string): Record<string, unknown> | null {
    const openIdx = stdout.lastIndexOf(ARTIFACT_TAG_OPEN);
    if (openIdx === -1) return null;
    const closeIdx = stdout.indexOf(ARTIFACT_TAG_CLOSE, openIdx);
    if (closeIdx === -1) return null;
    const jsonStr = stdout.slice(openIdx + ARTIFACT_TAG_OPEN.length, closeIdx).trim();
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not valid JSON
    }
    return null;
  }

  getStageSchemaJson(stageId: string): string {
    const schema = STAGE_SCHEMAS[stageId];
    if (!schema) return "{}";
    return JSON.stringify(zodToJsonSchema(schema), null, 2);
  }

  buildDispatchMessage(spec: AgentSpec, userPrompt: string, schemaJson: string, stage: StageEntry): string {
    return [
      spec.system_prompt.trim(),
      "",
      "---",
      "",
      userPrompt.trim(),
      "",
      "---",
      "",
      `Stage: ${stage.id} (anymake Phase ${spec.anymake_phase})`,
      `Model tier: ${spec.model_tier}`,
      `Permission mode: ${spec.permission_mode}`,
      "",
      "OUTPUT CONTRACT:",
      "Emit your final result as a JSON object wrapped in <artifact>...</artifact> tags.",
      "The JSON must contain these fields:",
      '  - gate_verdict: "pass" | "needs_changes" | "escalate"',
      "  - gate_notes: string (brief rationale for the verdict)",
      `  - status: the stage's resulting status (e.g. "framed", "framing_failed")`,
      "  - revisions_used: integer (0 if first attempt)",
      "  - artifact: the stage's canonical artifact object (see schema below)",
      "",
      "The full output schema (for reference — realcode fills schema_version, run_id, trace_id, token_usage):",
      schemaJson,
    ].join("\n");
  }
}
