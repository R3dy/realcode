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

export interface RunDetailResponse {
  run: RunRecord;
  stages: Record<StageName, DetailStageStatus>;
  artifacts: Partial<Record<StageName, unknown>>;
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`run not found: ${runId}`);
    this.name = "RunNotFoundError";
  }
}

const DATA_DIR = process.env.REALCODE_DATA_DIR || path.resolve(process.cwd(), ".realcode-data");
const CONTROL_PATH = path.join(DATA_DIR, "control.json");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const QUEUE_PATH = path.join(DATA_DIR, "queue.db");

const MISSION_CONTROL_ROOT = process.env.MISSION_CONTROL_ROOT || "/home/royce/mission-control";
const TARGET_TAG_RE = /\[target:\s*([A-Za-z0-9_.\-]+)\s*\]/i;
const COPY_EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", ".next", ".cache"]);

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
      return { run, stages, artifacts };
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
