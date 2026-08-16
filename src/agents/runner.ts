import * as path from "path";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { jsonrepair } from "jsonrepair";
import type { StageRunner } from "../engine/dispatcher.js";
import type { StageEntry, StageGraph } from "../engine/stage-graph.js";
import type { WorkItem, Storage } from "../backend/types.js";
import { SandboxRunner } from "../sandbox/runner.js";
import { loadAgentSpec, type AgentSpec } from "./spec-loader.js";
import { eventFromJsonLine, appendLiveEvent } from "../engine/live-state.js";
import {
  ConductorOutput,
  FrameOutput,
  DiscoverOutput,
  PlanOutput,
  SpecOutput,
  BuildOutput,
  ShipOutput,
  ChangeOutput,
  WorkerOutput,
  ValidatorOutput,
} from "../schemas/index.js";

const STAGE_SCHEMAS: Record<string, ZodTypeAny> = {
  conductor: ConductorOutput,
  frame: FrameOutput,
  discover: DiscoverOutput,
  plan: PlanOutput,
  spec: SpecOutput,
  build: BuildOutput,
  ship: ShipOutput,
  change: ChangeOutput,
  build_worker: WorkerOutput,
  build_validator: ValidatorOutput,
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

  async run(
    item: WorkItem,
    stage: StageEntry,
    workspacePath: string,
    opts?: {
      specOverride?: string;
      schemaKey?: string;
      extraContext?: Record<string, unknown>;
      attempt?: number;
      /** Per-dispatch timeout override (ms). Falls back to stage.timeout_ms. */
      timeoutMs?: number;
    },
  ): Promise<{
    output_status: string;
    artifact: Record<string, unknown>;
    token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
    trace_id: string;
    jsonEvents?: unknown[];
    /** Docker container ID (empty string when no cidfile was used). */
    containerId?: string;
  }> {
    if (!stage.agent_spec && !opts?.specOverride) {
      throw new Error(
        `Stage '${stage.id}' has no agent_spec and no specOverride provided — cannot dispatch via AgentStageRunner. ` +
          `Inner-loop stages require a BuildLoopRunner (6th Engine constructor param).`,
      );
    }
    const specPath = path.resolve(this.options.repoRoot, opts?.specOverride ?? stage.agent_spec!);
    const spec = loadAgentSpec(specPath);
    const model = this.resolveModel(stage, spec);
    const priorArtifacts = this.gatherPriorArtifacts(item.run_id, stage.id, item.payload);
    const ctx = { ...priorArtifacts, ...(opts?.extraContext ?? {}) };
    const userPrompt = this.fillTemplate(spec.user_prompt_template, ctx);
    const schemaKey = opts?.schemaKey ?? stage.id;
    const schemaJson = this.getStageSchemaJson(schemaKey);
    const role = (opts?.extraContext?.role as string | undefined) ?? stage.id;
    const dispatchMessage = this.buildDispatchMessage(spec, userPrompt, schemaJson, stage, role);
    const traceId = (item.payload.trace_id as string) || item.run_id;

    // Live capture is now enabled for ALL dispatches, including build
    // worker/validator sub-dispatches. The original A11.1 design left build
    // sub-dispatches without liveCapture to keep spawn args "byte-identical"
    // — but that made worker timeouts completely invisible (no container logs,
    // no trace events, no container_id in build-state). Royce hit exactly this
    // blind spot: a worker timed out on a trivial story and there was zero
    // evidence of what it was doing. Visibility wins over byte-identity.
    const isBuildSubDispatch = opts?.specOverride !== undefined;
    const containerRole = isBuildSubDispatch
      ? (opts?.extraContext?.role as string | undefined) ?? `build_${stage.id}`
      : stage.id;
    const storyId = isBuildSubDispatch
      ? (opts?.extraContext?.story_id as string | undefined) ?? "story"
      : "stage";
    const liveOptions = {
      runId: item.run_id,
      stageId: stage.id,
      containerRole,
      containerAttempt: opts?.attempt ?? 0,
      storyId,
      liveCapture: true as const,
      onJsonLine: (ev: unknown): void => {
        try {
          const traceEvent = eventFromJsonLine(ev, stage.id);
          if (traceEvent) {
            appendLiveEvent(item.run_id, traceEvent);
          }
        } catch (err) {
          console.warn(`[agents] onJsonLine handler failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    };

    const result = await this.sandbox.run({
      workspacePath,
      model,
      dispatchMessage,
      traceparent: traceId,
      localMode: this.options.localMode ?? true,
      timeoutMs: opts?.timeoutMs ?? stage.timeout_ms ?? this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      env: this.collectModelEnv(),
      ...liveOptions,
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
        jsonEvents: result.jsonEvents,
        containerId: result.containerId,
      };
    }

    const partialArtifact = this.extractArtifact(result.stdout, result.jsonEvents);
    if (!partialArtifact) {
      return {
        output_status: "escalate" as const,
        artifact: {
          error: `No <artifact> JSON block found in stage ${stage.id} output`,
          stdout_tail: result.stdout.slice(-1000),
        },
        token_usage: tokenUsage,
        trace_id: traceId,
        jsonEvents: result.jsonEvents,
        containerId: result.containerId,
      };
    }

    const fullOutput = {
      schema_version: 1 as const,
      run_id: item.run_id,
      trace_id: traceId,
      token_usage: tokenUsage,
      stage: schemaKey,
      ...partialArtifact,
    };

    const schema = STAGE_SCHEMAS[schemaKey];
    if (!schema) {
      return {
        output_status: "escalate" as const,
        artifact: { error: `No schema registered for stage ${schemaKey}` },
        token_usage: tokenUsage,
        trace_id: traceId,
        jsonEvents: result.jsonEvents,
        containerId: result.containerId,
      };
    }

    const validated = schema.safeParse(fullOutput);
    if (!validated.success) {
      return {
        output_status: "escalate" as const,
        artifact: {
          error: `Artifact validation failed for stage ${schemaKey}`,
          issues: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
          raw_artifact: partialArtifact,
        },
        token_usage: tokenUsage,
        trace_id: traceId,
        jsonEvents: result.jsonEvents,
        containerId: result.containerId,
      };
    }

    return {
      output_status: validated.data.gate_verdict as string,
      artifact: validated.data.artifact as Record<string, unknown>,
      token_usage: tokenUsage,
      trace_id: validated.data.trace_id as string,
      jsonEvents: result.jsonEvents,
      containerId: result.containerId,
    };
  }

  resolveModel(stage: StageEntry, spec: AgentSpec): string {
    const tierEnv = TIER_ENV[spec.model_tier];
    if (tierEnv && process.env[tierEnv]) {
      return process.env[tierEnv]!;
    }
    return process.env.ANYMAKE_MODEL_TIER1 ?? DEFAULT_MODEL;
  }

  /**
   * Collect model API keys + provider config from the engine's environment
   * to pass through to the sandbox container. The sandbox runs isolated and
   * does NOT inherit the engine's env, so credentials must be forwarded explicitly.
   */
  collectModelEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    const KEY_PATTERN = /^(OPENROUTER|OPENAI|ANTHROPIC|DEEPSEEK|GROQ|MISTRAL|TOGETHER|FIREWORKS|PERPLEXITY|COHERE|GOOGLE|AZURE)_(API_KEY|KEY)$/;
    for (const [key, value] of Object.entries(process.env)) {
      if (value && KEY_PATTERN.test(key)) {
        env[key] = value;
      }
    }
    return env;
  }

  gatherPriorArtifacts(
    runId: string,
    currentStageId: string,
    intakePayload: Record<string, unknown>,
  ): Record<string, unknown> {
    // In docker/sandbox mode the workspace is bind-mounted at /workspace (see
    // src/sandbox/runner.ts `containerWorkspace`). Agent prompts reference
    // {workspace} as "the target repo root" and the validator READS files at
    // that literal path. The engine-internal path (e.g. /data/workspaces/<id>)
    // only exists in the ENGINE container — inside a sandbox it is invisible,
    // so a validator that does `Read /data/workspaces/<id>/go.mod` sees nothing
    // and escalates with a false "workspace empty" crash even though the worker
    // succeeded (the worker ignores the string and works in its CWD = /workspace).
    // Fix: point {workspace} at the sandbox-internal mount path when not in
    // local mode. (Local mode keeps the real path — no mount translation.)
    const containerWorkspace = this.options.localMode
      ? (intakePayload.workspace as string | undefined) ?? ""
      : "/workspace";
    const ctx: Record<string, unknown> = { idea: intakePayload.idea ?? "", workspace: containerWorkspace };

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
        return val.length > 8000 ? val.slice(0, 8000) + "\n...[truncated]" : val;
      }
      if (typeof val === "number" || typeof val === "boolean") {
        return String(val);
      }
      if (val && typeof val === "object") {
        const json = JSON.stringify(val, null, 2);
        return json.length > 8000 ? json.slice(0, 8000) + "\n...[truncated]" : json;
      }
      return match;
    });
  }

  extractArtifact(stdout: string, jsonEvents?: unknown[]): Record<string, unknown> | null {
    // When opencode runs with --format json, the <artifact> block is embedded inside
    // a JSON event's text field with escaped quotes. We need to extract the text
    // content from the parsed events and search for the artifact tag there.
    if (jsonEvents && jsonEvents.length > 0) {
      const text = this.collectEventText(jsonEvents);
      const artifact = this.findArtifactInText(text);
      if (artifact) return artifact;
    }
    // Fallback: search raw stdout (works for non-JSON format or unescaped output)
    return this.findArtifactInText(stdout);
  }

  private collectEventText(events: unknown[]): string {
    let text = "";
    for (const e of events) {
      const ev = e as Record<string, unknown>;
      const part = ev.part as Record<string, unknown> | undefined;
      if (!part) continue;
      // Collect text from any part carrying a string `text` field, not just
      // `type === "text"`. Agents sometimes emit the <artifact> block inside a
      // reasoning or tool-result part that also carries a `time` field, which
      // would be skipped by a strict type check.
      if (typeof part.text === "string") {
        text += part.text;
      }
    }
    return text;
  }

  private findArtifactInText(text: string): Record<string, unknown> | null {
    const openIdx = text.lastIndexOf(ARTIFACT_TAG_OPEN);
    if (openIdx === -1) return null;
    const closeIdx = text.indexOf(ARTIFACT_TAG_CLOSE, openIdx);
    if (closeIdx === -1) return null;
    const jsonStr = text.slice(openIdx + ARTIFACT_TAG_OPEN.length, closeIdx).trim();
    return this.tryParseArtifact(jsonStr);
  }

  /**
   * Parse the content between <artifact></artifact> tags into a JSON object.
   * Agents frequently wrap the JSON in a markdown code fence (```json ... ```
   * or bare ``` ... ```), and sometimes prepend/prose around it. This strips
   * the fence and falls back to brace-matching the outermost JSON object so a
   * valid artifact is not rejected as "not found".
   */
  private tryParseArtifact(raw: string): Record<string, unknown> | null {
    let candidate = raw.trim();

    // Strip a leading markdown code fence (```json or ```) + trailing fence.
    const fenceMatch = candidate.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/);
    if (fenceMatch) {
      candidate = fenceMatch[1].trim();
    }

    // Direct parse.
    const direct = this.parseJsonObject(candidate);
    if (direct) return direct;

    // Brace-match fallback: extract the outermost { ... } object. Handles prose
    // around the JSON and partial fences that the regex above missed.
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const sliced = candidate.slice(firstBrace, lastBrace + 1);
      const matched = this.parseJsonObject(sliced);
      if (matched) return matched;
    }
    return null;
  }

  private parseJsonObject(s: string): Record<string, unknown> | null {
    // 1. Direct parse.
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not valid JSON — try fallbacks
    }
    // 2. Control-char sanitizer (LLMs emit literal newlines in string values).
    try {
      const sanitized = this.sanitizeJsonControlChars(s);
      if (sanitized !== s) {
        const parsed = JSON.parse(sanitized);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      }
    } catch {
      // still not valid JSON
    }
    // 3. jsonrepair — handles unescaped quotes, trailing commas, and other
    //    common LLM JSON mistakes that the sanitizer can't fix.
    try {
      const repaired = jsonrepair(s);
      const parsed = JSON.parse(repaired);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // jsonrepair also failed — give up
    }
    return null;
  }

  /**
   * Escape literal control characters inside JSON string values. Walks the
   * string tracking whether we're inside a quoted string value; when inside,
   * replaces literal \n \r \t and other control chars with their escaped
   * equivalents. This handles the common LLM mistake of emitting unescaped
   * newlines in multi-line string fields (e.g. markdown content).
   */
  private sanitizeJsonControlChars(s: string): string {
    let result = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escaped) {
        result += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        result += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        result += ch;
        continue;
      }
      if (inString) {
        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          switch (ch) {
            case "\n": result += "\\n"; break;
            case "\r": result += "\\r"; break;
            case "\t": result += "\\t"; break;
            default: result += "\\u" + code.toString(16).padStart(4, "0");
          }
        } else {
          result += ch;
        }
      } else {
        result += ch;
      }
    }
    return result;
  }

  getStageSchemaJson(stageId: string): string {
    const schema = STAGE_SCHEMAS[stageId];
    if (!schema) return "{}";
    return JSON.stringify(zodToJsonSchema(schema), null, 2);
  }

  buildDispatchMessage(spec: AgentSpec, userPrompt: string, schemaJson: string, stage: StageEntry, role?: string): string {
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
      `Role: ${role ?? stage.id}`,
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
