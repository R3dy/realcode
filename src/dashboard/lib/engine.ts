import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import Database from "better-sqlite3";
import { STAGE_ORDER, type StageName, type StageStatus } from "./data";

export interface RunRecord {
  run_id: string;
  idea: string;
  status: string;
  spent_usd: number;
  cap_usd: number;
  created_at: number;
  workspace_path: string;
}

export interface ControlDoc {
  run_mode: "continuous" | "step" | "paused" | "paused_cost_cap";
  concurrency: number;
  per_stage_model_overrides: Record<string, string>;
  cost_cap_usd: number;
  updated_at: number;
  updated_by: string;
}

// Detail-page stage-status vocabulary (adds "not-reached" to the board's StageStatus)
export type DetailStageStatus = StageStatus | "not-reached";

// ── Build-state types (A4.5 — mission-control visibility) ──
// Mirrors the shape produced by src/engine/build-loop.ts (A4.2). The engine
// owns the source of truth; the dashboard only reads it. Fields are tolerant
// (null/undefined) because the build loop writes them incrementally.
export interface BuildStoryState {
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

export interface BuildContainerEntry {
  container_id: string | null;
  role: string;
  story_id: string;
  log_path: string;
}

export interface BuildState {
  run_id: string;
  started_at: number;
  wall_clock_deadline_ms: number;
  paused: boolean;
  pause_reason: string | null;
  stories: BuildStoryState[];
  containers: BuildContainerEntry[];
}

// ── Live-state types (A11.2 — realtime visibility for non-build stages) ──
// Mirror src/engine/live-state.ts:14-51 exactly (field names, nullability).
// The engine owns the source of truth; the dashboard only reads live.json.
export interface LiveContainer {
  container_id: string | null;
  name: string;
  role: string;
  status: string;
  started_at: number;
  log_path: string;
}

export interface LiveTraceEvent {
  kind: string;
  stage: string;
  agent: string;
  content: string;
  timestamp: number;
  role?: string;
  tool?: string;
  tokens?: number;
  cost_usd?: number;
}

export interface LiveState {
  run_id: string;
  stage: string | null;
  status: string;
  started_at: number;
  updated_at: number;
  container: LiveContainer | null;
  events: LiveTraceEvent[];
  tokens_total: number;
  cost_usd: number;
  failure_message?: string;
}

// Container view returned by /api/runs/[id]/containers — merges the explicit
// `containers[]` array with per-story worker/validator container IDs (A4.2
// populates worker_container_id/validator_container_id; A4.3 will populate
// the explicit containers[] array with log_path).
export interface ContainerView {
  container_id: string;
  name: string;
  story_id: string;
  role: string;
  status: string;
  started_at: number | null;
  exited_at: number | null;
  log_path: string;
}

export interface RunDetailResponse {
  run: RunRecord;
  stages: Record<StageName, DetailStageStatus>;
  artifacts: Partial<Record<StageName, unknown>>;
  build_state?: BuildState;
  live_state?: LiveState;
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

// ── Trace event types (A4.5 — engine-side synthesis from build-state.json) ──
export interface TraceEvent {
  kind: "llm-message" | "tool-call" | "stage-event" | "error";
  stage: string;
  agent: string;
  content: string;
  timestamp?: number;
  story_id?: string;
  role?: string;
  tool?: string;
  tool_input?: string;
  tokens?: number;
  cost_usd?: number;
}

function summarizeOutput(output: Record<string, unknown> | null): string {
  if (!output || typeof output !== "object") return "";
  const a = output as Record<string, unknown>;
  // WorkerOutput has notes/failure_description; ValidatorOutput has notes/verdict.
  if (typeof a.notes === "string" && a.notes) return a.notes;
  if (typeof a.failure_description === "string" && a.failure_description) return a.failure_description;
  if (typeof a.verdict === "string") return `verdict: ${a.verdict}`;
  if (typeof a.result === "string") return `result: ${a.result}`;
  return "";
}

function toolCallEvents(
  output: Record<string, unknown> | null,
  role: string,
  storyId: string,
  ts: number,
): TraceEvent[] {
  if (!output || typeof output !== "object") return [];
  const a = output as Record<string, unknown>;
  const commits = Array.isArray(a.commits) ? a.commits : null;
  const out: TraceEvent[] = [];
  if (commits) {
    for (const c of commits) {
      if (c && typeof c === "object" && typeof (c as Record<string, unknown>).message === "string") {
        out.push({
          kind: "tool-call",
          stage: "build",
          agent: role,
          tool: "git commit",
          tool_input: String((c as Record<string, unknown>).message),
          content: "",
          timestamp: ts,
          story_id: storyId,
          role,
        });
      }
    }
  }
  if (typeof a.test_output === "string" && a.test_output) {
    out.push({
      kind: "tool-call",
      stage: "build",
      agent: role,
      tool: "npm test",
      tool_input: "",
      content: a.test_output.slice(0, 200),
      timestamp: ts,
      story_id: storyId,
      role,
    });
  }
  return out;
}

const DATA_DIR = process.env.REALCODE_DATA_DIR || path.resolve(process.cwd(), ".realcode-data");
const CONTROL_PATH = path.join(DATA_DIR, "control.json");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const QUEUE_PATH = path.join(DATA_DIR, "queue.db");

const MISSION_CONTROL_ROOT = process.env.MISSION_CONTROL_ROOT || "/home/royce/mission-control";
const TARGET_TAG_RE = /\[target:\s*([A-Za-z0-9_.-]+)\s*\]/i;
// "data" is CRITICAL: the realcode repo's data/ contains data/workspaces/<runId>/
// (the workspace being created), so copying it causes infinite recursion.
// "tests" and lockfiles reduce context bloat that inflates the sandbox agent's prompt.
const COPY_EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".cache", "data", "tests"]);
const COPY_EXCLUDE_FILES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]);

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

function seedWorkspaceFromProject(workspace: string, projectName: string): boolean {
  const projectRepo = path.join(MISSION_CONTROL_ROOT, "PROJECTS", projectName, "repo");
  if (!fs.existsSync(projectRepo) || !fs.statSync(projectRepo).isDirectory()) return false;
  try {
    fs.cpSync(projectRepo, workspace, {
      recursive: true,
      filter: (src: string): boolean => {
        const base = path.basename(src);
        if (COPY_EXCLUDE_DIRS.has(base)) return false;
        if (COPY_EXCLUDE_FILES.has(base)) return false;
        return true;
      },
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[engine] seedWorkspaceFromProject: copy failed for "${projectName}" -> ${workspace}: ${msg}`);
    return false;
  }
}

let _cache: { runs: RunRecord[]; ts: number } | null = null;
const CACHE_TTL = 2000;

let _db: Database.Database | null = null;
function getQueueDb(): Database.Database {
  if (!_db) {
    _db = new Database(QUEUE_PATH);
    _db.exec(`CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      worker_id TEXT,
      lease_expires_at INTEGER,
      payload TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
  }
  return _db;
}

// Maps a run's top-level status + which stage artifacts are present on disk
// to a per-stage DetailStageStatus for the detail page.
const STATUS_TO_STAGE: Record<string, StageName> = {
  intake: "frame",
  framing_failed: "frame",
  framed: "discover",
  discovered: "plan",
  discovery_failed: "discover",
  planned: "spec",
  plan_failed: "plan",
  specified: "build",
  spec_failed: "spec",
  built: "ship",
  build_failed: "build",
  escalated: "build",
  shipped: "ship",
  ship_failed: "ship",
};

export function deriveStageStatuses(
  run: RunRecord,
  presentArtifacts: Set<StageName>,
): Record<StageName, DetailStageStatus> {
  const current = STATUS_TO_STAGE[run.status] ?? "frame";
  const currentIdx = STAGE_ORDER.indexOf(current);
  const isFailed = run.status.endsWith("_failed");
  const isShipped = run.status === "shipped";
  const failedStage = isFailed ? current : null;

  const result = {} as Record<StageName, DetailStageStatus>;
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    if (isShipped) {
      result[stage] = "pass";
    } else if (stage === failedStage) {
      result[stage] = "fail";
    } else if (i < currentIdx) {
      result[stage] = "pass";
    } else if (i === currentIdx) {
      // The in-flight stage: "running" unless it's the failed stage (handled above)
      // or the run is still in intake (pending, not started yet)
      result[stage] = run.status === "intake" ? "pending" : isFailed ? "fail" : "running";
    } else {
      result[stage] = "not-reached";
    }
  }
  return result;
}

export function getEngine() {
  return {
    listRuns(): RunRecord[] {
      if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.runs;
      const runs: RunRecord[] = [];
      if (fs.existsSync(RUNS_DIR)) {
        for (const dir of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
          if (!dir.isDirectory()) continue;
          const fp = path.join(RUNS_DIR, dir.name, "run.json");
          if (!fs.existsSync(fp)) continue;
          try {
            runs.push(JSON.parse(fs.readFileSync(fp, "utf8")) as RunRecord);
          } catch {
            // skip corrupt
          }
        }
      }
      runs.sort((a, b) => b.created_at - a.created_at);
      _cache = { runs, ts: Date.now() };
      return runs;
    },
    getRun(runId: string): RunRecord | null {
      const fp = path.join(RUNS_DIR, runId, "run.json");
      if (!fs.existsSync(fp)) return null;
      try {
        return JSON.parse(fs.readFileSync(fp, "utf8")) as RunRecord;
      } catch {
        return null;
      }
    },
    getControlDoc(): ControlDoc {
      if (!fs.existsSync(CONTROL_PATH)) {
        return {
          run_mode: "continuous",
          concurrency: 1,
          per_stage_model_overrides: {},
          cost_cap_usd: 8.0,
          updated_at: Date.now(),
          updated_by: "default",
        };
      }
      const doc = JSON.parse(fs.readFileSync(CONTROL_PATH, "utf8")) as ControlDoc;
      if (doc.concurrency < 1) doc.concurrency = 1;
      return doc;
    },
    setControlDoc(partial: Partial<ControlDoc>, updatedBy: string): void {
      const current = this.getControlDoc();
      const next: ControlDoc = {
        ...current,
        ...partial,
        updated_at: Date.now(),
        updated_by: updatedBy,
      };
      if (next.concurrency < 1) next.concurrency = 1;
      const tmp = `${CONTROL_PATH}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
      fs.renameSync(tmp, CONTROL_PATH);
    },
    createRun(runId: string, idea: string): RunRecord {
      const workspace = `${DATA_DIR}/workspaces/${runId}`;
      fs.mkdirSync(workspace, { recursive: true });

      const { cleanIdea, targetProject } = parseTargetTag(idea);
      if (targetProject) {
        const seeded = seedWorkspaceFromProject(workspace, targetProject);
        if (!seeded) {
          const projectRepo = path.join(MISSION_CONTROL_ROOT, "PROJECTS", targetProject, "repo");
          if (!fs.existsSync(projectRepo)) {
            console.warn(`[engine] createRun: target project "${targetProject}" not found at ${projectRepo}; proceeding with empty workspace`);
          }
        }
      }

      const run: RunRecord = {
        run_id: runId,
        idea: cleanIdea,
        status: "intake",
        spent_usd: 0,
        cap_usd: 8.0,
        created_at: Date.now(),
        workspace_path: workspace,
      };
      const runsDir = path.join(RUNS_DIR, runId);
      fs.mkdirSync(runsDir, { recursive: true });
      fs.writeFileSync(path.join(runsDir, "run.json"), JSON.stringify(run, null, 2));
      // Publish to the queue so the engine dispatches this run
      const db = getQueueDb();
      const now = Date.now();
      db.prepare(
        "INSERT INTO work_items (id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload, created_at, updated_at) VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)"
      ).run(
        crypto.randomUUID(),
        runId,
        "frame",
        "intake",
        JSON.stringify({ idea: cleanIdea, workspace, ...(targetProject ? { target_project: targetProject } : {}) }),
        now,
        now
      );
      return run;
    },
    getRunDetail(runId: string): RunDetailResponse | null {
      const runDir = path.join(RUNS_DIR, runId);
      const runFp = path.join(runDir, "run.json");
      if (!fs.existsSync(runFp)) return null;
      let run: RunRecord;
      try {
        run = JSON.parse(fs.readFileSync(runFp, "utf8")) as RunRecord;
      } catch {
        return null;
      }
      const presentArtifacts = new Set<StageName>();
      const artifacts: Partial<Record<StageName, unknown>> = {};
      for (const stage of STAGE_ORDER) {
        const artifactFp = path.join(runDir, `${stage}.json`);
        if (fs.existsSync(artifactFp)) {
          try {
            artifacts[stage] = JSON.parse(fs.readFileSync(artifactFp, "utf8"));
            presentArtifacts.add(stage);
          } catch {
            // corrupt artifact — skip
          }
        }
      }
      const stages = deriveStageStatuses(run, presentArtifacts);
      const build_state = this.getBuildState(runId) ?? undefined;
      const live_state = this.getLiveState(runId) ?? undefined;
      const detail: RunDetailResponse = { run, stages, artifacts };
      if (build_state) detail.build_state = build_state;
      if (live_state) detail.live_state = live_state;
      return detail;
    },
    // ── Build-state helpers (A4.5) ──
    getBuildState(runId: string): BuildState | null {
      const fp = path.join(RUNS_DIR, runId, "build-state.json");
      if (!fs.existsSync(fp)) return null;
      try {
        return JSON.parse(fs.readFileSync(fp, "utf8")) as BuildState;
      } catch {
        return null;
      }
    },
    // ── Live-state helper (A11.2) ──
    // Mirrors getBuildState's null-on-missing/corrupt contract (INV-4): a
    // malformed live.json can never crash the dashboard.
    getLiveState(runId: string): LiveState | null {
      const fp = path.join(RUNS_DIR, runId, "live.json");
      if (!fs.existsSync(fp)) return null;
      try {
        return JSON.parse(fs.readFileSync(fp, "utf8")) as LiveState;
      } catch {
        return null;
      }
    },
    listContainers(runId: string): ContainerView[] {
      const state = this.getBuildState(runId);
      const views: ContainerView[] = [];
      const seen = new Set<string>();
      // 1. Explicit containers[] entries (A4.3 wiring).
      for (const c of state?.containers ?? []) {
        if (!c.container_id) continue;
        if (seen.has(c.container_id)) continue;
        seen.add(c.container_id);
        views.push({
          container_id: c.container_id,
          name: c.container_id,
          story_id: c.story_id,
          role: c.role,
          status: "exited",
          started_at: null,
          exited_at: null,
          log_path: c.log_path ?? "",
        });
      }
      // 2. Per-story worker/validator container IDs (A4.2 fallback when
      //    the explicit containers[] array is empty / pre-A4.3 wiring).
      for (const s of state?.stories ?? []) {
        const pairs: Array<[string | null, string]> = [
          [s.worker_container_id, "worker"],
          [s.validator_container_id, "validator"],
        ];
        for (const [cid, role] of pairs) {
          if (!cid || seen.has(cid)) continue;
          seen.add(cid);
          views.push({
            container_id: cid,
            name: cid,
            story_id: s.story_id,
            role,
            status: s.status === "building" && role === "worker" ? "running"
              : s.status === "validating" && role === "validator" ? "running"
              : "exited",
            started_at: s.started_at,
            exited_at: s.completed_at,
            log_path: "",
          });
        }
      }
      // 3. Live (non-build stage) container from live.json (A11.2). Stage-level,
      //    not story-level, so story_id is "".
      const live = this.getLiveState(runId);
      if (live && live.container && live.container.container_id && !seen.has(live.container.container_id)) {
        seen.add(live.container.container_id);
        views.push({
          container_id: live.container.container_id,
          name: live.container.name,
          story_id: "",
          role: live.container.role,
          status: "running",
          started_at: live.container.started_at,
          exited_at: null,
          log_path: live.container.log_path,
        });
      }
      return views;
    },
    getContainerLogs(runId: string, cid: string, tail?: number): { text: string; log_path: string } | null {
      // Live (non-build stage) container check runs FIRST (A11.2, 1-C6): match
      // cid against live.container.container_id or live.container.name.
      const live = this.getLiveState(runId);
      if (live && live.container && (live.container.container_id === cid || live.container.name === cid)) {
        const livePath = live.container.log_path;
        const liveAbs = path.join(DATA_DIR, livePath);
        if (!fs.existsSync(liveAbs)) return { text: "", log_path: livePath };
        const liveText = fs.readFileSync(liveAbs, "utf8");
        if (tail && tail > 0) {
          let lines = liveText.split(/\r?\n/);
          if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
          return { text: lines.slice(Math.max(0, lines.length - tail)).join("\n"), log_path: livePath };
        }
        return { text: liveText, log_path: livePath };
      }
      // Fall through to the existing build_state resolution.
      const state = this.getBuildState(runId);
      if (!state) return null;
      // Resolve log_path through containers[] (match container_id or role+story).
      let logPath: string | null = null;
      for (const c of state.containers ?? []) {
        if (c.container_id === cid || c.log_path === cid) { logPath = c.log_path || null; break; }
      }
      // Fallback: synthesize log_path from the per-story container IDs (A4.2
      // wrote worker_container_id/validator_container_id but not containers[]).
      if (!logPath) {
        for (const s of state.stories ?? []) {
          if (s.worker_container_id === cid) {
            logPath = path.join("runs", runId, "containers", `${s.story_id}-worker-0.log`);
            break;
          }
          if (s.validator_container_id === cid) {
            logPath = path.join("runs", runId, "containers", `${s.story_id}-validator-0.log`);
            break;
          }
        }
      }
      if (!logPath) return null;
      const abs = path.join(DATA_DIR, logPath);
      if (!fs.existsSync(abs)) return { text: "", log_path: logPath };
      const text = fs.readFileSync(abs, "utf8");
      if (tail && tail > 0) {
        let lines = text.split(/\r?\n/);
        // Drop a single trailing empty line produced by a final newline so
        // `tail=N` returns the last N non-empty lines (matches `tail -n` UX).
        if (lines.length > 0 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
        return { text: lines.slice(Math.max(0, lines.length - tail)).join("\n"), log_path: logPath };
      }
      return { text, log_path: logPath };
    },
    hasRunningBuildContainers(runId: string): boolean {
      const state = this.getBuildState(runId);
      if (!state) return false;
      return state.stories.some((s) => s.status === "building" || s.status === "validating");
    },
    getTraceEvents(runId: string): TraceEvent[] {
      const state = this.getBuildState(runId);
      const events: TraceEvent[] = [];
      for (const s of state?.stories ?? []) {
        // Story-level stage events (status transitions).
        if (s.started_at) {
          events.push({
            kind: "stage-event",
            stage: "build",
            agent: "orchestrator",
            content: `story ${s.story_id} → ${s.status}`,
            timestamp: s.started_at,
            story_id: s.story_id,
            role: "orchestrator",
          });
        }
        // Synthesized per-story turn events from worker output + token/cost.
        if (s.worker_output || s.worker_tokens || s.worker_cost_usd) {
          events.push({
            kind: "llm-message",
            stage: "build",
            agent: "build_worker",
            content: summarizeOutput(s.worker_output) || `worker dispatched for story ${s.story_id}`,
            timestamp: s.started_at ?? state.started_at,
            story_id: s.story_id,
            role: "build_worker",
            tokens: s.worker_tokens ?? 0,
            cost_usd: s.worker_cost_usd ?? 0,
          });
          events.push(...toolCallEvents(s.worker_output, "build_worker", s.story_id, s.started_at ?? state.started_at));
        }
        if (s.validator_output || s.validator_tokens || s.validator_cost_usd) {
          events.push({
            kind: "llm-message",
            stage: "build",
            agent: "build_validator",
            content: summarizeOutput(s.validator_output) || `validator dispatched for story ${s.story_id}`,
            timestamp: s.completed_at ?? s.started_at ?? state.started_at,
            story_id: s.story_id,
            role: "build_validator",
            tokens: s.validator_tokens ?? 0,
            cost_usd: s.validator_cost_usd ?? 0,
          });
          events.push(...toolCallEvents(s.validator_output, "build_validator", s.story_id, s.completed_at ?? s.started_at ?? state.started_at));
        }
      }
      // Append live (non-build stage) trace events from live.json (A11.2).
      // Build events keep priority; live events fill the gap for non-build
      // stages, deduped by signature `timestamp|stage|content`.
      const live = this.getLiveState(runId);
      if (live) {
        const sigs = new Set(events.map((e) => `${e.timestamp}|${e.stage}|${e.content}`));
        for (const lv of live.events ?? []) {
          const sig = `${lv.timestamp}|${lv.stage}|${lv.content}`;
          if (sigs.has(sig)) continue;
          sigs.add(sig);
          events.push({
            kind: lv.kind as TraceEvent["kind"],
            stage: lv.stage,
            agent: lv.agent,
            content: lv.content,
            timestamp: lv.timestamp,
            ...(lv.role !== undefined ? { role: lv.role } : {}),
            ...(lv.tool !== undefined ? { tool: lv.tool } : {}),
            tokens: lv.tokens ?? 0,
            cost_usd: lv.cost_usd ?? 0,
          });
        }
      }
      events.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
      return events;
    },
    deleteRun(runId: string): void {
      const runDir = path.join(RUNS_DIR, runId);
      if (!fs.existsSync(path.join(runDir, "run.json"))) {
        throw new RunNotFoundError(runId);
      }
      // 1. Remove the run data directory
      fs.rmSync(runDir, { recursive: true, force: true });
      // 2. Remove the workspace directory if it exists
      const workspaceDir = path.join(DATA_DIR, "workspaces", runId);
      if (fs.existsSync(workspaceDir)) {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      }
      // 3. Delete work_items rows for this run from the queue
      const db = getQueueDb();
      db.prepare("DELETE FROM work_items WHERE run_id = ?").run(runId);
      // 4. Invalidate the list cache so the board sees the deletion
      _cache = null;
    },
  };
}
