import * as fs from "fs";
import * as path from "path";

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

let _cache: { runs: RunRecord[]; ts: number } | null = null;
const CACHE_TTL = 2000;

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
  };
}
