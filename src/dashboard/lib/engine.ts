import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import Database from "better-sqlite3";

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
  };
}
