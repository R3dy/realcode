import type { StageGraph, StageEntry } from "./stage-graph.js";
import { findStageForStatus, applyTransition } from "./stage-graph.js";
import type { Queue, Storage, WorkItem } from "../backend/types.js";

export interface ControlDoc {
  run_mode: "continuous" | "step" | "paused";
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
  ) {}

  createRun(runId: string, idea: string): RunRecord {
    const workspace = `${this.dataDir}/workspaces/${runId}`;
    this.storage.mkdirSync?.(workspace);
    const run: RunRecord = {
      run_id: runId,
      idea,
      status: "intake",
      spent_usd: 0,
      cap_usd: this.graph.cost_cap_usd_per_run,
      created_at: Date.now(),
      workspace_path: workspace,
    };
    this.storage.write(`${RUNS_PREFIX}/${runId}/run.json`, JSON.stringify(run, null, 2));
    this.queue.publish({
      run_id: runId,
      stage: "frame",
      status: "intake",
      payload: { idea, workspace },
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
    if (control.run_mode === "paused") return 0;

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

      try {
        const result = await this.runner.run(item, stage, run.workspace_path);
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

        // Apply the transition
        const newStatus = applyTransition(this.graph, stage.id, result.output_status, "pass") ?? result.output_status;
        this.queue.release(item.id, newStatus);
        this.setRunStatus(run, newStatus);
        dispatched++;

        if (control.run_mode === "step") {
          // Re-pause after one dispatch
          this.setControlDoc({ run_mode: "paused" }, "step-mode");
          break;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
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
