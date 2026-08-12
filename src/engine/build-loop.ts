import type { AgentStageRunner } from "../agents/runner.js";
import type { Storage, Queue, WorkItem } from "../backend/types.js";
import type { StageGraph, StageEntry } from "./stage-graph.js";
import type { StageRunner } from "./dispatcher.js";
import type { Span } from "@opentelemetry/api";
import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

export interface BuildLoopRunnerOptions {
  repoRoot: string;
}

interface StoryState {
  story_id: string;
  title: string;
  status: "pending" | "building" | "validating" | "done" | "failed" | "escalated";
  retry_count: number;
  worker_container_id: string | null;
  validator_container_id: string | null;
  worker_output: Record<string, unknown> | null;
  validator_output: Record<string, unknown> | null;
  started_at: number | null;
  completed_at: number | null;
  depends_on: string[];
  acceptance_criteria: string[];
  worker_tokens?: number;
  validator_tokens?: number;
  worker_cost_usd?: number;
  validator_cost_usd?: number;
  test_passed?: number;
  test_failed?: number;
}

interface BuildState {
  run_id: string;
  started_at: number;
  wall_clock_deadline_ms: number;
  paused: boolean;
  pause_reason: string | null;
  stories: StoryState[];
  containers: Array<{ container_id: string | null; role: string; story_id: string; log_path: string }>;
}

interface StorySpecLike {
  id: string;
  title: string;
  acceptance_criteria: string[];
  depends_on: string[];
}

const ZERO_TOKENS = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  estimated_cost_usd: 0,
};

const CONTROL_DOC_PATH = "control.json";

/**
 * BuildLoopRunner orchestrates the per-story Worker→Validator serial loop
 * for inner-loop build stages (ADR-009). It implements the same StageRunner
 * interface as AgentStageRunner — the dispatcher treats it as a drop-in
 * alternative for stages where `stage.inner_loop && stage.worker_spec`.
 *
 * The runner dispatches each story's Worker and Validator sandboxes via
 * AgentStageRunner.run() (with specOverride/schemaKey/extraContext), applies
 * the result-mapping table (§4.2), tracks per-story cost locally (returns
 * the loop increment — NOT the total — so the dispatcher's existing
 * `run.spent_usd += result.token_usage.estimated_cost_usd` computes the
 * correct total without double-counting), heartbeats the lease before BOTH
 * dispatches, re-reads the control doc between stories (terminal escalation
 * on pause), and enforces the wall-clock bound.
 */
export class BuildLoopRunner implements StageRunner {
  constructor(
    private runner: AgentStageRunner,
    private storage: Storage,
    private graph: StageGraph,
    private queue: Queue,
    private options: BuildLoopRunnerOptions,
  ) {}

  async run(item: WorkItem, stage: StageEntry, workspacePath: string): Promise<{
    output_status: string;
    artifact: Record<string, unknown>;
    token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
    trace_id: string;
    jsonEvents?: unknown[];
  }> {
    const traceId = (item.payload.trace_id as string) || item.run_id;
    const startedAt = Date.now();
    const wallClockDeadlineMs = startedAt + (stage.timeout_ms ?? 300_000);
    const perStoryCeiling = this.graph.retry_ceilings.per_story_build;

    // 1. Read the spec artifact
    const specRaw = this.storage.read(`runs/${item.run_id}/spec.json`);
    if (!specRaw) {
      return this.escalate(item.run_id, traceId, "spec artifact not found", ZERO_TOKENS, 0, 0);
    }
    let specParsed: { artifact?: { stories?: StorySpecLike[] } };
    try {
      specParsed = JSON.parse(specRaw);
    } catch {
      return this.escalate(item.run_id, traceId, "spec artifact is not valid JSON", ZERO_TOKENS, 0, 0);
    }
    const stories = specParsed.artifact?.stories;
    if (!stories || !Array.isArray(stories) || stories.length === 0) {
      return this.escalate(item.run_id, traceId, "spec artifact lacks structured stories array — cannot build", ZERO_TOKENS, 0, 0);
    }

    // 2. Read the run record (pre-loop snapshot for cost tracking)
    const runRaw = this.storage.read(`runs/${item.run_id}/run.json`);
    if (!runRaw) {
      return this.escalate(item.run_id, traceId, "run record not found", ZERO_TOKENS, 0, 0);
    }
    const runRecord = JSON.parse(runRaw) as { spent_usd: number; cap_usd: number };
    const preLoopSpentUsd = runRecord.spent_usd ?? 0;
    const capUsd = runRecord.cap_usd ?? this.graph.cost_cap_usd_per_run;

    // 3. Read the control doc — check for pause before starting
    const controlStart = this.readControlDoc();
    if (controlStart.run_mode === "paused" || controlStart.run_mode === "paused_cost_cap") {
      return this.escalate(item.run_id, traceId, "paused by operator before build-loop (0 stories done)", ZERO_TOKENS, 0, stories.length);
    }

    // 4. Initialize build state
    const buildState: BuildState = {
      run_id: item.run_id,
      started_at: startedAt,
      wall_clock_deadline_ms: wallClockDeadlineMs,
      paused: false,
      pause_reason: null,
      stories: stories.map((s) => ({
        story_id: s.id,
        title: s.title,
        status: "pending" as const,
        retry_count: 0,
        worker_container_id: null,
        validator_container_id: null,
        worker_output: null,
        validator_output: null,
        started_at: null,
        completed_at: null,
        depends_on: s.depends_on ?? [],
        acceptance_criteria: s.acceptance_criteria ?? [],
      })),
      containers: [],
    };
    this.writeBuildState(item.run_id, buildState);

    // 5. Inner loop
    let loopCostUsd = 0;
    let loopPromptTokens = 0;
    let loopCompletionTokens = 0;
    let loopTotalTokens = 0;
    const escalations: Array<{ story: string; reason: string }> = [];
    const stageSpan = this.startBuildStageSpan(item.run_id, stage.id);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Control-doc check between stories (2-C2: terminal escalation)
      const control = this.readControlDoc();
      if (control.run_mode === "paused" || control.run_mode === "paused_cost_cap") {
        buildState.paused = true;
        buildState.pause_reason = "operator paused";
        this.writeBuildState(item.run_id, buildState);
        const doneCount = buildState.stories.filter((s) => s.status === "done").length;
        this.endSpan(stageSpan, false, "paused mid-loop");
        return this.escalate(
          item.run_id,
          traceId,
          `paused by operator mid-build-loop (${doneCount}/${buildState.stories.length} stories done)`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          doneCount,
          buildState.stories.length,
          buildState,
          escalations,
          true,
        );
      }

      // Find next ready story
      const story = this.nextReadyStory(buildState);
      if (story === "ALL_DONE") {
        break;
      }
      if (story === null) {
        // No ready story but stories remain not-done → all remaining blocked
        const doneCount = buildState.stories.filter((s) => s.status === "done").length;
        this.writeBuildState(item.run_id, buildState);
        this.endSpan(stageSpan, false, "all remaining blocked");
        return this.escalate(
          item.run_id,
          traceId,
          `all remaining blocked (${doneCount}/${buildState.stories.length} stories done)`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          doneCount,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }

      // Cost cap check between stories (2-C2: terminal escalation)
      if (preLoopSpentUsd + loopCostUsd >= capUsd) {
        const doneCount = buildState.stories.filter((s) => s.status === "done").length;
        this.writeBuildState(item.run_id, buildState);
        this.endSpan(stageSpan, false, "cost cap hit mid-loop");
        return this.escalate(
          item.run_id,
          traceId,
          `cost cap hit mid-loop (${doneCount}/${buildState.stories.length} stories done)`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          doneCount,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }

      // Wall-clock bound check
      if (Date.now() > wallClockDeadlineMs) {
        const doneCount = buildState.stories.filter((s) => s.status === "done").length;
        this.writeBuildState(item.run_id, buildState);
        this.endSpan(stageSpan, false, "wall-clock bound exceeded");
        return this.escalate(
          item.run_id,
          traceId,
          `wall-clock bound exceeded (${doneCount}/${buildState.stories.length} stories done)`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          doneCount,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }

      const criteriaStr = story.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

      // === WORKER DISPATCH ===
      // Lease heartbeat before Worker (2-C3)
      this.queue.heartbeat(item.id, stage.timeout_ms ?? 300_000);

      story.status = "building";
      story.started_at = Date.now();
      this.writeBuildState(item.run_id, buildState);

      const workerResult = await this.runner.run(item, stage, workspacePath, {
        specOverride: stage.worker_spec,
        schemaKey: "build_worker",
        extraContext: {
          story_id: story.story_id,
          story_title: story.title,
          acceptance_criteria: criteriaStr,
          role: "build_worker",
        },
      });

      story.worker_output = workerResult.artifact;
      story.worker_cost_usd = workerResult.token_usage.estimated_cost_usd;
      story.worker_tokens = workerResult.token_usage.total_tokens;
      loopCostUsd += workerResult.token_usage.estimated_cost_usd;
      loopPromptTokens += workerResult.token_usage.prompt_tokens;
      loopCompletionTokens += workerResult.token_usage.completion_tokens;
      loopTotalTokens += workerResult.token_usage.total_tokens;
      this.emitTurnSpans(item.run_id, story.story_id, "build_worker", workerResult.jsonEvents ?? [], stageSpan);
      this.writeBuildState(item.run_id, buildState);

      // Worker result mapping (§4.2 table)
      const workerArtifact = workerResult.artifact as { result?: string; failure_type?: string };
      if (workerResult.output_status === "escalate") {
        story.status = "escalated";
        this.writeBuildState(item.run_id, buildState);
        escalations.push({ story: story.story_id, reason: `story ${story.story_id} worker escalated` });
        this.endSpan(stageSpan, false, "worker escalated");
        return this.escalate(
          item.run_id,
          traceId,
          `story ${story.story_id} worker escalated`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          buildState.stories.filter((s) => s.status === "done").length,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }
      if (workerArtifact.result === "success") {
        // proceed to validator
      } else if (workerArtifact.result === "failed" && workerArtifact.failure_type === "environment") {
        story.retry_count++;
        if (story.retry_count >= perStoryCeiling) {
          story.status = "escalated";
          this.writeBuildState(item.run_id, buildState);
          escalations.push({ story: story.story_id, reason: `story ${story.story_id} worker environment failure (${perStoryCeiling} retries)` });
          this.endSpan(stageSpan, false, "worker environment ceiling");
          return this.escalate(
            item.run_id,
            traceId,
            `story ${story.story_id} worker environment failure (${perStoryCeiling} retries)`,
            { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
            buildState.stories.filter((s) => s.status === "done").length,
            buildState.stories.length,
            buildState,
            escalations,
          );
        }
        story.status = "pending";
        this.writeBuildState(item.run_id, buildState);
        continue; // retry same story (re-dispatch worker)
      } else if (workerArtifact.result === "failed" && workerArtifact.failure_type === "implementation") {
        story.status = "escalated";
        this.writeBuildState(item.run_id, buildState);
        escalations.push({ story: story.story_id, reason: `story ${story.story_id} worker implementation failure` });
        this.endSpan(stageSpan, false, "worker implementation failure");
        return this.escalate(
          item.run_id,
          traceId,
          `story ${story.story_id} worker implementation failure`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          buildState.stories.filter((s) => s.status === "done").length,
          buildState.stories.length,
          buildState,
          escalations,
        );
      } else {
        // unknown result — escalate
        story.status = "escalated";
        this.writeBuildState(item.run_id, buildState);
        escalations.push({ story: story.story_id, reason: `story ${story.story_id} worker unknown result` });
        this.endSpan(stageSpan, false, "worker unknown result");
        return this.escalate(
          item.run_id,
          traceId,
          `story ${story.story_id} worker unknown result`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          buildState.stories.filter((s) => s.status === "done").length,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }

      // === VALIDATOR DISPATCH ===
      // Lease heartbeat before Validator (2-C3)
      this.queue.heartbeat(item.id, stage.timeout_ms ?? 300_000);

      story.status = "validating";
      this.writeBuildState(item.run_id, buildState);

      const validatorResult = await this.runner.run(item, stage, workspacePath, {
        specOverride: stage.validator_spec,
        schemaKey: "build_validator",
        extraContext: {
          story_id: story.story_id,
          story_title: story.title,
          acceptance_criteria: criteriaStr,
          worker_output: workerResult.artifact,
          role: "build_validator",
        },
      });

      story.validator_output = validatorResult.artifact;
      story.validator_cost_usd = validatorResult.token_usage.estimated_cost_usd;
      story.validator_tokens = validatorResult.token_usage.total_tokens;
      loopCostUsd += validatorResult.token_usage.estimated_cost_usd;
      loopPromptTokens += validatorResult.token_usage.prompt_tokens;
      loopCompletionTokens += validatorResult.token_usage.completion_tokens;
      loopTotalTokens += validatorResult.token_usage.total_tokens;
      this.emitTurnSpans(item.run_id, story.story_id, "build_validator", validatorResult.jsonEvents ?? [], stageSpan);
      this.writeBuildState(item.run_id, buildState);

      // Validator result mapping (§4.2 table)
      const validatorArtifact = validatorResult.artifact as { verdict?: string };
      if (validatorResult.output_status === "escalate") {
        story.status = "escalated";
        this.writeBuildState(item.run_id, buildState);
        escalations.push({ story: story.story_id, reason: `story ${story.story_id} validator escalated` });
        this.endSpan(stageSpan, false, "validator escalated");
        return this.escalate(
          item.run_id,
          traceId,
          `story ${story.story_id} validator escalated`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          buildState.stories.filter((s) => s.status === "done").length,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }
      if (validatorArtifact.verdict === "pass") {
        story.status = "done";
        story.completed_at = Date.now();
        // Capture test counts from worker artifact if present
        const wa = workerResult.artifact as { test_passed?: number; test_failed?: number };
        story.test_passed = wa.test_passed ?? 0;
        story.test_failed = wa.test_failed ?? 0;
        this.writeBuildState(item.run_id, buildState);
        // continue to next story
      } else if (validatorArtifact.verdict === "fail") {
        story.retry_count++;
        if (story.retry_count >= perStoryCeiling) {
          story.status = "escalated";
          this.writeBuildState(item.run_id, buildState);
          escalations.push({ story: story.story_id, reason: `story ${story.story_id} validator fail (${perStoryCeiling} retries)` });
          this.endSpan(stageSpan, false, "validator fail ceiling");
          return this.escalate(
            item.run_id,
            traceId,
            `story ${story.story_id} validator fail (${perStoryCeiling} retries)`,
            { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
            buildState.stories.filter((s) => s.status === "done").length,
            buildState.stories.length,
            buildState,
            escalations,
          );
        }
        story.status = "pending";
        this.writeBuildState(item.run_id, buildState);
        continue; // retry (re-dispatch worker)
      } else {
        // verdict === "escalate"
        story.status = "escalated";
        this.writeBuildState(item.run_id, buildState);
        escalations.push({ story: story.story_id, reason: `story ${story.story_id} validator escalate verdict` });
        this.endSpan(stageSpan, false, "validator escalate verdict");
        return this.escalate(
          item.run_id,
          traceId,
          `story ${story.story_id} validator escalate verdict`,
          { prompt_tokens: loopPromptTokens, completion_tokens: loopCompletionTokens, total_tokens: loopTotalTokens, estimated_cost_usd: loopCostUsd },
          buildState.stories.filter((s) => s.status === "done").length,
          buildState.stories.length,
          buildState,
          escalations,
        );
      }
    }

    // 6. All stories done — build aggregated artifact
    this.endSpan(stageSpan, true);
    const aggregatedTokens = {
      prompt_tokens: loopPromptTokens,
      completion_tokens: loopCompletionTokens,
      total_tokens: loopTotalTokens,
      estimated_cost_usd: loopCostUsd,
    };
    const sumTestPassed = buildState.stories.reduce((sum, s) => sum + (s.test_passed ?? 0), 0);
    const sumTestFailed = buildState.stories.reduce((sum, s) => sum + (s.test_failed ?? 0), 0);
    const buildArtifact = {
      repo_path: workspacePath,
      test_results: { passed: sumTestPassed, failed: sumTestFailed, skipped: 0, coverage_pct: 0 },
      prs_merged: [],
      escalations: [],
      stories: buildState.stories.map((s) => ({
        story_id: s.story_id,
        status: s.status === "done" ? "done" as const : "escalated" as const,
        retry_count: s.retry_count,
        worker_tokens: s.worker_tokens ?? 0,
        validator_tokens: s.validator_tokens ?? 0,
        worker_cost_usd: s.worker_cost_usd ?? 0,
        validator_cost_usd: s.validator_cost_usd ?? 0,
        test_passed: s.test_passed ?? 0,
        test_failed: s.test_failed ?? 0,
      })),
    };
    return {
      output_status: "pass",
      artifact: buildArtifact,
      token_usage: aggregatedTokens,
      trace_id: traceId,
      jsonEvents: [],
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private nextReadyStory(state: BuildState): StoryState | "ALL_DONE" | null {
    const allDone = state.stories.every((s) => s.status === "done");
    if (allDone) return "ALL_DONE";
    for (const s of state.stories) {
      if (s.status !== "pending") continue;
      const depsOk = s.depends_on.every((depId) => {
        const dep = state.stories.find((x) => x.story_id === depId);
        return dep && dep.status === "done";
      });
      if (depsOk) return s;
    }
    // No ready story — check if any are still in-progress (building/validating)
    // In a serial loop this shouldn't happen, but if all remaining are blocked
    // by dependencies that can never complete, return null.
    const anyInProgress = state.stories.some((s) => s.status === "building" || s.status === "validating");
    if (anyInProgress) return null; // shouldn't happen in serial loop, but safe
    // All remaining are pending but blocked → all remaining blocked
    return null;
  }

  private writeBuildState(runId: string, state: BuildState): void {
    this.storage.write(`runs/${runId}/build-state.json`, JSON.stringify(state, null, 2));
  }

  private readControlDoc(): { run_mode: "continuous" | "step" | "paused" | "paused_cost_cap" } {
    const raw = this.storage.read(CONTROL_DOC_PATH);
    if (!raw) {
      return { run_mode: "continuous" };
    }
    try {
      const doc = JSON.parse(raw) as { run_mode: "continuous" | "step" | "paused" | "paused_cost_cap" };
      return doc;
    } catch {
      return { run_mode: "continuous" };
    }
  }

  /**
   * Set the control doc to paused (called when the loop exits due to pause).
   * This ensures the dispatcher's top-of-cycle check also sees paused.
   */
  private escalate(
    runId: string,
    traceId: string,
    reason: string,
    tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number },
    doneCount: number,
    totalCount: number,
    buildState?: BuildState,
    escalations?: Array<{ story: string; reason: string }>,
    paused = false,
  ): {
    output_status: string;
    artifact: Record<string, unknown>;
    token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
    trace_id: string;
    jsonEvents?: unknown[];
  } {
    const artifact: Record<string, unknown> = {
      status: "escalated",
      escalations: escalations ?? [{ story: "-", reason }],
      gate_notes: reason,
    };
    if (buildState) {
      artifact.stories = buildState.stories.map((s) => ({
        story_id: s.story_id,
        status: s.status === "done" ? "done" : "escalated",
        retry_count: s.retry_count,
        worker_tokens: s.worker_tokens ?? 0,
        validator_tokens: s.validator_tokens ?? 0,
        worker_cost_usd: s.worker_cost_usd ?? 0,
        validator_cost_usd: s.validator_cost_usd ?? 0,
        test_passed: s.test_passed ?? 0,
        test_failed: s.test_failed ?? 0,
      }));
      artifact.test_results = {
        passed: buildState.stories.reduce((sum, s) => sum + (s.test_passed ?? 0), 0),
        failed: buildState.stories.reduce((sum, s) => sum + (s.test_failed ?? 0), 0),
        skipped: 0,
        coverage_pct: 0,
      };
      artifact.repo_path = buildState.run_id; // will be overwritten by caller if needed
    }
    if (paused) {
      artifact.paused = true;
    }
    return {
      output_status: "escalate",
      artifact,
      token_usage: tokenUsage,
      trace_id: traceId,
      jsonEvents: [],
    };
  }

  // ─── Tracing ────────────────────────────────────────────────────────────

  private startBuildStageSpan(runId: string, stageId: string): Span {
    const tracer = trace.getTracer("realcode");
    return tracer.startSpan(`build-loop:${stageId}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        "realcode.run_id": runId,
        "realcode.stage": stageId,
        "realcode.span_type": "build-loop",
      },
    });
  }

  private endSpan(span: Span, success: boolean, error?: string): void {
    if (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: error });
      span.setAttribute("error.message", error);
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
  }

  /**
   * Emit per-turn and per-tool-call OTel spans from the sandbox's jsonEvents.
   * Each event with part.tokens becomes a turn span; each event with
   * part.type === "tool_use" or part.tool becomes a tool-call span.
   * Spans carry realcode.run_id, realcode.story_id, realcode.role,
   * realcode.turn, realcode.tokens.*, realcode.cost.usd,
   * realcode.agent_message, realcode.tool.
   */
  private emitTurnSpans(
    runId: string,
    storyId: string,
    role: string,
    jsonEvents: unknown[],
    _parentSpan: Span,
  ): void {
    if (!jsonEvents || jsonEvents.length === 0) return;
    const tracer = trace.getTracer("realcode");
    let turnIndex = 0;
    for (const ev of jsonEvents) {
      const e = ev as Record<string, unknown>;
      const part = e.part as Record<string, unknown> | undefined;
      if (!part) continue;

      const hasTokens = part.tokens !== undefined;
      const isToolUse = part.type === "tool_use" || part.tool !== undefined;

      if (hasTokens) {
        const span = tracer.startSpan(`turn:${role}_${storyId}:${turnIndex}`, {
          kind: SpanKind.INTERNAL,
          attributes: {
            "realcode.run_id": runId,
            "realcode.story_id": storyId,
            "realcode.role": role,
            "realcode.turn": turnIndex,
            "realcode.span_type": "turn",
          },
        });
        const tokens = part.tokens as Record<string, number> | undefined;
        if (tokens) {
          span.setAttributes({
            "realcode.tokens.prompt": tokens.input ?? 0,
            "realcode.tokens.completion": tokens.output ?? 0,
            "realcode.tokens.total": tokens.total ?? 0,
          });
        }
        const cost = (part.cost as number) ?? 0;
        span.setAttribute("realcode.cost.usd", cost);
        if (typeof part.text === "string") {
          const msg = part.text.length > 2000 ? part.text.slice(0, 2000) : part.text;
          span.setAttribute("realcode.agent_message", msg);
        }
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        turnIndex++;
      }

      if (isToolUse) {
        const toolSpan = tracer.startSpan(`tool:${role}_${storyId}:${turnIndex}`, {
          kind: SpanKind.INTERNAL,
          attributes: {
            "realcode.run_id": runId,
            "realcode.story_id": storyId,
            "realcode.role": role,
            "realcode.tool": (part.tool as string) ?? "unknown",
            "realcode.span_type": "tool-call",
          },
        });
        if (typeof part.text === "string") {
          const msg = part.text.length > 2000 ? part.text.slice(0, 2000) : part.text;
          toolSpan.setAttribute("realcode.agent_message", msg);
        }
        toolSpan.setStatus({ code: SpanStatusCode.OK });
        toolSpan.end();
      }
    }
  }
}
