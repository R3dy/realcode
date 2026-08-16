import * as fs from "fs";
import * as path from "path";
import type { StageGraph, StageEntry } from "./stage-graph.js";
import { findStageForStatus, applyTransition } from "./stage-graph.js";
import type { Queue, Storage, WorkItem } from "../backend/types.js";
import { startStageSpan, endSpan } from "./tracing.js";
import { writeLiveState, readLiveState, flushLiveEvents } from "./live-state.js";
import { classifyIntent, resolveLiveWorkspace, listAvailableProjects } from "./conductor.js";

const MISSION_CONTROL_ROOT = process.env.MISSION_CONTROL_ROOT || "/home/royce/mission-control";
const TARGET_TAG_RE = /\[target:\s*([A-Za-z0-9_.-]+)\s*\]/i;

/**
 * Directories excluded when persisting a shipped workspace to
 * PROJECTS/<name>/repo. Mirrors the COPY_EXCLUDE_DIRS used by
 * seedWorkspaceFromProject (inverted purpose: we don't want to copy the
 * ephemeral run metadata / node caches into the durable project repo).
 */
const PERSIST_EXCLUDE_DIRS = new Set([".realcode-data", "node_modules", ".git", "data", ".next", "coverage", "dist"]);

/**
 * Extract a filesystem-safe project name from the frame stage's PROJECT.md.
 * The first `# <name>` heading is the canonical project name (see
 * TEMPLATES/project.md). Falls back to null when no heading is found.
 */
function extractProjectNameFromFrame(runId: string, storage: Storage): string | null {
  try {
    const raw = storage.read(`runs/${runId}/frame.json`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { artifact?: { project_md?: string } };
    const md = parsed.artifact?.project_md ?? "";
    // First "# <name>" heading — strip leading '#' + whitespace + any backticks
    const m = md.match(/^#\s+(.+)$/m);
    if (!m) return null;
    const name = m[1].trim().replace(/[`*]/g, "");
    // Sanitize to a filesystem-safe directory name (lowercase, hyphenated)
    const safe = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return safe || null;
  } catch {
    return null;
  }
}

/**
 * Persist a shipped net-new project's workspace to
 * MISSION_CONTROL_ROOT/PROJECTS/<name>/repo so subsequent
 * `[target: <name>]` change-flow runs can find + modify it.
 * Only runs for the ship stage reaching `shipped`. Idempotent: if the
 * target dir already exists (re-shipping an existing project), it is
 * overwritten. Best-effort — a persistence failure is logged but does
 * NOT fail the run (the ship stage already passed).
 */
function persistShippedProject(runId: string, workspacePath: string, storage: Storage): void {
  const projectName = extractProjectNameFromFrame(runId, storage);
  if (!projectName) {
    console.warn(`[dispatcher] ship-persist: could not extract project name from frame.json for run ${runId} — skipping persistence`);
    return;
  }
  const targetRepo = path.join(MISSION_CONTROL_ROOT, "PROJECTS", projectName, "repo");
  try {
    fs.mkdirSync(path.dirname(targetRepo), { recursive: true });
    // If the target already exists, remove it first (re-ship overwrites)
    if (fs.existsSync(targetRepo)) {
      fs.rmSync(targetRepo, { recursive: true, force: true });
    }
    fs.cpSync(workspacePath, targetRepo, {
      recursive: true,
      filter: (_src, dest) => {
        const base = path.basename(dest);
        // Exclude ephemeral run metadata + caches. dest is the target path;
        // the first segment after the workspace root is the top-level dir name.
        if (PERSIST_EXCLUDE_DIRS.has(base) && base !== path.basename(workspacePath)) return false;
        return true;
      },
    });
    console.log(`[dispatcher] ship-persist: persisted shipped project "${projectName}" to ${targetRepo}`);
  } catch (err) {
    // Best-effort: the ship stage already passed; a persistence failure does
    // not retroactively fail the run. Log so the operator can manually recover.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[dispatcher] ship-persist: failed to persist project "${projectName}" to ${targetRepo}: ${msg}`);
  }
}

interface TargetParseResult {
  cleanIdea: string;
  targetProject: string | null;
}

function parseTargetTag(idea: string): TargetParseResult {
  const match = idea.match(TARGET_TAG_RE);
  if (!match) return { cleanIdea: idea, targetProject: null };
  const targetProject = match[1].trim();
  const cleanIdea = idea.replace(match[0], "").replace(/\s{2,}/g, " ").trim();
  return { cleanIdea, targetProject };
}

// Directories excluded when seeding a workspace from a target project repo.
// "data" is CRITICAL: the realcode repo's data/ contains data/workspaces/<runId>/
// (the workspace being created), so copying it causes infinite recursion (138
// levels deep, 1.8GB). "tests" and "package-lock.json" reduce context bloat
// that inflates the sandbox agent's prompt (a 288KB lockfile = ~70K tokens).
const COPY_EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".cache", "data", "tests"]);
const COPY_EXCLUDE_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

function seedWorkspaceFromProject(workspace: string, projectName: string): boolean {
  const projectRepo = path.join(MISSION_CONTROL_ROOT, "PROJECTS", projectName, "repo");
  if (!fs.existsSync(projectRepo) || !fs.statSync(projectRepo).isDirectory()) return false;
  try {
    fs.cpSync(projectRepo, workspace, {
      recursive: true,
      filter: (src: string): boolean => {
        const base = path.basename(src);
        if (COPY_EXCLUDE_DIRS.has(base) && base !== path.basename(workspace)) return false;
        if (COPY_EXCLUDE_FILES.has(base)) return false;
        return true;
      },
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[dispatcher] seedWorkspaceFromProject: copy failed for "${projectName}" -> ${workspace}: ${msg}`);
    return false;
  }
}

export interface ControlDoc {
  run_mode: "continuous" | "step" | "paused" | "paused_cost_cap";
  concurrency: number;
  per_stage_model_overrides: Record<string, string>;
  cost_cap_usd: number;
  updated_at: number;
  updated_by: string;
}

export interface StageRunner {
  run(item: WorkItem, stage: StageEntry, workspacePath: string): Promise<{
    output_status: string;
    artifact: Record<string, unknown>;
    token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
    trace_id: string;
    jsonEvents?: unknown[];
  }>;
}

export interface RunRecord {
  run_id: string;
  idea: string;
  status: string;
  spent_usd: number;
  cap_usd: number;
  created_at: number;
  workspace_path: string;
}

const CONTROL_DOC_PATH = "control.json";
const RUNS_PREFIX = "runs";

export class Engine {
  constructor(
    private graph: StageGraph,
    private queue: Queue,
    private storage: Storage,
    private runner: StageRunner,
    private dataDir: string,
    private buildLoopRunner?: StageRunner,
  ) {}

  createRun(runId: string, idea: string): RunRecord {
    const workspace = `${this.dataDir}/workspaces/${runId}`;
    this.storage.mkdirSync?.(workspace);

    const { cleanIdea, targetProject } = parseTargetTag(idea);
    if (targetProject) {
      const seeded = seedWorkspaceFromProject(workspace, targetProject);
      if (!seeded) {
        const projectRepo = path.join(MISSION_CONTROL_ROOT, "PROJECTS", targetProject, "repo");
        if (!fs.existsSync(projectRepo)) {
          console.warn(`[dispatcher] createRun: target project "${targetProject}" not found at ${projectRepo}; proceeding with empty workspace`);
        }
      }
    }

    const run: RunRecord = {
      run_id: runId,
      idea: cleanIdea,
      status: "intake",
      spent_usd: 0,
      cap_usd: this.graph.cost_cap_usd_per_run,
      created_at: Date.now(),
      workspace_path: workspace,
    };
    this.storage.write(`${RUNS_PREFIX}/${runId}/run.json`, JSON.stringify(run, null, 2));
    this.queue.publish({
      run_id: runId,
      stage: "conductor",
      status: "intake",
      payload: { idea: cleanIdea, workspace, ...(targetProject ? { target_project: targetProject } : {}) },
    });
    return run;
  }

  getControlDoc(): ControlDoc {
    const raw = this.storage.read(CONTROL_DOC_PATH);
    if (!raw) {
      return {
        run_mode: "continuous",
        concurrency: 1,
        per_stage_model_overrides: {},
        cost_cap_usd: this.graph.cost_cap_usd_per_run,
        updated_at: Date.now(),
        updated_by: "default",
      };
    }
    const doc = JSON.parse(raw) as ControlDoc;
    // Validate
    if (doc.concurrency < 1) doc.concurrency = 1;
    return doc;
  }

  setControlDoc(doc: Partial<ControlDoc>, updatedBy: string): void {
    const current = this.getControlDoc();
    const next: ControlDoc = {
      ...current,
      ...doc,
      updated_at: Date.now(),
      updated_by: updatedBy,
    };
    if (next.concurrency < 1) next.concurrency = 1;
    this.storage.write(CONTROL_DOC_PATH, JSON.stringify(next, null, 2));
  }

  getRun(runId: string): RunRecord | null {
    const raw = this.storage.read(`${RUNS_PREFIX}/${runId}/run.json`);
    if (!raw) return null;
    return JSON.parse(raw) as RunRecord;
  }

  listRuns(): RunRecord[] {
    const files = this.storage.list(RUNS_PREFIX);
    const runIds = new Set<string>();
    for (const f of files) {
      const parts = f.split("/");
      if (parts.length >= 2) runIds.add(parts[1]);
    }
    return [...runIds]
      .map((id) => this.getRun(id))
      .filter((r): r is RunRecord => r !== null)
      .sort((a, b) => b.created_at - a.created_at);
  }

  async dispatchCycle(): Promise<number> {
    const control = this.getControlDoc();
    if (control.run_mode === "paused" || control.run_mode === "paused_cost_cap") return 0;

    // Expire stale leases
    this.queue.expire_leases();

    // Find eligible items (any status that matches a stage's input_states)
    const eligible = new Set<string>();
    for (const stage of this.graph.stages) {
      for (const s of stage.input_states) {
        eligible.add(s);
      }
    }

    let dispatched = 0;
    for (let i = 0; i < control.concurrency; i++) {
      const item = this.queue.claim(`worker-${i}`, [...eligible]);
      if (!item) break;

      const run = this.getRun(item.run_id);
      if (!run) {
        this.queue.release(item.id, "escalated");
        continue;
      }

      // Cost cap check
      if (run.spent_usd >= run.cap_usd) {
        this.setRunStatus(run, "paused_cost_cap");
        this.queue.release(item.id, "paused_cost_cap");
        this.setControlDoc({ run_mode: "paused_cost_cap" }, "breaker");
        continue;
      }

      const stage = findStageForStatus(this.graph, item.status);
      if (!stage) {
        this.queue.release(item.id, "escalated");
        continue;
      }

      // ─── Conductor stage: direct LLM call (no container) ──────────────
      // The conductor classifies the request as new_project vs change and
      // branches the flow. For change flows, it also resolves the live
      // workspace path (the real project repo, not an ephemeral copy).
      if (stage.conductor) {
        try {
          const idea = (item.payload.idea as string) || run.idea;
          // The dashboard deterministically parses the [target: X] tag and forwards
          // `target_project` in the work-item payload. Trust it FIRST — the idea
          // stored on the run has already been stripped of the tag, so re-parsing
          // the idea in the conductor would miss it and fall to a (fallible) LLM
          // call. Only invoke the LLM when no target_project was pre-resolved.
          const preTarget = (item.payload.target_project as string | undefined) || undefined;
          const classification = await classifyIntent(idea, preTarget);

          // Update the run with the classification + workspace path
          run.spent_usd += classification.token_usage.estimated_cost_usd;
          if (classification.flow_type === "agile" && classification.target_project) {
            run.workspace_path = resolveLiveWorkspace(classification.target_project);
            run.idea = classification.clean_idea;
          }
          this.updateRun(run);

          // Store the conductor artifact
          const gateVerdict = classification.flow_type === "agile" ? "classify_change" : "classify_new";
          const status = classification.flow_type === "agile" ? "classified_change" : "classified_new";
          this.storage.write(
            `${RUNS_PREFIX}/${item.run_id}/conductor.json`,
            JSON.stringify({
              schema_version: 1,
              run_id: item.run_id,
              trace_id: item.run_id,
              stage: "conductor",
              gate_verdict: gateVerdict,
              gate_notes: classification.reasoning,
              token_usage: classification.token_usage,
              status,
              revisions_used: 0,
              artifact: {
                intent: classification.intent,
                target_project: classification.target_project,
                flow_type: classification.flow_type,
                clean_idea: classification.clean_idea,
                classification_reasoning: classification.reasoning,
                available_projects: classification.available_projects,
              },
            }, null, 2),
          );

          // Update the work item payload with classification info
          item.payload.target_project = classification.target_project;
          item.payload.flow_type = classification.flow_type;
          item.payload.idea = classification.clean_idea;

          this.queue.release(item.id, status);
          this.setRunStatus(run, status);
          dispatched++;
          if (control.run_mode === "step") {
            this.setControlDoc({ run_mode: "paused" }, "step-mode");
            break;
          }
          continue;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[dispatcher] conductor failed: ${msg}`);
          this.queue.release(item.id, "conductor_failed");
          this.setRunStatus(run, "conductor_failed");
          dispatched++;
          continue;
        }
      }

      // ─── Live-mount: resolve workspace for change flow ────────────────
      // When the change stage is dispatched, ensure the workspace path
      // points to the real project repo (set by the conductor).
      if (stage.live_mount && item.payload.target_project) {
        const livePath = resolveLiveWorkspace(item.payload.target_project as string);
        if (fs.existsSync(livePath)) {
          run.workspace_path = livePath;
          this.updateRun(run);
        }
      }

      const stageSpan = startStageSpan(item.run_id, stage.id, "");
      // A11.1: stage-start live.json write (non-build stages only — the build
      // path stays byte-identical, see §4.2 boundary). Wrapped in try/catch —
      // a live-state write failure must NOT prevent the stage from running.
      if (!stage.inner_loop) {
        try {
          writeLiveState(item.run_id, {
            run_id: item.run_id,
            stage: stage.id,
            status: "running",
            started_at: Date.now(),
            updated_at: Date.now(),
            container: null,
            events: [],
            tokens_total: 0,
            cost_usd: 0,
          });
        } catch (err) {
          console.warn(`[dispatcher] live-state start write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      try {
        let result;
        if (stage.inner_loop && stage.worker_spec) {
          if (!this.buildLoopRunner) {
            throw new Error(
              `Stage '${stage.id}' has inner_loop but no BuildLoopRunner configured — ` +
                `cannot dispatch. Pass a BuildLoopRunner to the Engine constructor (6th param).`,
            );
          }
          result = await this.buildLoopRunner.run(item, stage, run.workspace_path);
        } else {
          result = await this.runner.run(item, stage, run.workspace_path);
        }
        stageSpan.setAttributes({
          "realcode.gate_verdict": result.output_status,
          "realcode.tokens.prompt": result.token_usage.prompt_tokens,
          "realcode.tokens.completion": result.token_usage.completion_tokens,
          "realcode.tokens.total": result.token_usage.total_tokens,
          "realcode.cost.usd": result.token_usage.estimated_cost_usd,
        });
        run.spent_usd += result.token_usage.estimated_cost_usd;
        this.updateRun(run);

        // Store the artifact
        this.storage.write(
          `${RUNS_PREFIX}/${item.run_id}/${stage.id}.json`,
          JSON.stringify({
            ...result,
            stage: stage.id,
            run_id: item.run_id,
            schema_version: 1,
          }, null, 2),
        );

        // A11.1: stage-end live.json write (success path, non-build stages
        // only). Flushes any coalesced trace events so the last event of the
        // stage is not dropped by the 250ms throttle. Wrapped in try/catch —
        // a live-state write failure must NOT fail the stage.
        if (!stage.inner_loop) {
          try {
            const current = readLiveState(item.run_id);
            writeLiveState(item.run_id, {
              stage: stage.id,
              status: "completed",
              updated_at: Date.now(),
              container: current?.container ? { ...current.container, status: "exited" } : null,
            });
            flushLiveEvents(item.run_id);
          } catch (err) {
            console.warn(`[dispatcher] live-state end write failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Apply the transition: item.status is the `from` state, result.output_status is the gate verdict (the `on` event)
        let newStatus = applyTransition(this.graph, stage.id, item.status, result.output_status);
        if (!newStatus) {
          // No matching transition for this gate verdict in this stage — route to the stage's failure terminal
          const failedState = stage.output_states.find((s) => s.endsWith("_failed"));
          newStatus = failedState ?? result.output_status;
        }
        this.queue.release(item.id, newStatus);
        this.setRunStatus(run, newStatus);
        endSpan(stageSpan, true);

        // ─── Ship-stage persistence (ADR: net-new → durable project) ─────
        // When the ship stage reaches `shipped`, copy the workspace to
        // PROJECTS/<name>/repo so a subsequent `[target: <name>]` change
        // run can find + modify the just-built project. Best-effort: a
        // failure here is logged but does not retroactively fail the ship
        // (the stage already passed + the artifact is stored). Only fires
        // for the full (new_project) flow — the agile change flow mutates
        // the live repo directly and never reaches the ship stage.
        if (stage.id === "ship" && newStatus === "shipped") {
          try {
            persistShippedProject(item.run_id, run.workspace_path, this.storage);
          } catch (err) {
            console.warn(`[dispatcher] ship-persist threw: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        dispatched++;

        if (control.run_mode === "step") {
          // Re-pause after one dispatch
          this.setControlDoc({ run_mode: "paused" }, "step-mode");
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        endSpan(stageSpan, false, msg);
        // A11.1 (1-C4): catch-path live.json rewrite with status:"failed" +
        // the failure message, BEFORE the work item is released. Wrapped in
        // try/catch — a live-state write failure here MUST NOT mask the
        // original error or crash the dispatch cycle (INV-4 best-effort).
        if (!stage.inner_loop) {
          try {
            const prior = readLiveState(item.run_id);
            writeLiveState(item.run_id, {
              stage: stage.id,
              status: "failed",
              updated_at: Date.now(),
              failure_message: msg,
              container: prior?.container ? { ...prior.container, status: "failed" } : null,
              events: prior?.events ?? [],
              tokens_total: prior?.tokens_total ?? 0,
              cost_usd: prior?.cost_usd ?? 0,
            });
            flushLiveEvents(item.run_id);
          } catch (liveErr) {
            console.warn(`[dispatcher] live-state failure write failed (non-fatal): ${liveErr instanceof Error ? liveErr.message : String(liveErr)}`);
          }
        }
        this.queue.release(item.id, "escalated");
        this.setRunStatus(run, "escalated");
        dispatched++;
      }
    }
    return dispatched;
  }

  private updateRun(run: RunRecord): void {
    this.storage.write(`${RUNS_PREFIX}/${run.run_id}/run.json`, JSON.stringify(run, null, 2));
  }

  private setRunStatus(run: RunRecord, status: string): void {
    run.status = status;
    this.updateRun(run);
  }
}
