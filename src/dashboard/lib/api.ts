import { useState, useEffect, useCallback } from "react";
import type { Run, RunStatus, StageName, Stage, StageStatus } from "./data";
import { STAGE_ORDER } from "./data";

export type { RunDetailResponse, DetailStageStatus } from "./engine";

export interface RunRecord {
  run_id: string;
  idea: string;
  status: string;
  spent_usd: number;
  cap_usd: number;
  created_at: number;
  workspace_path: string;
}

export interface Stats {
  activeRuns: number;
  todaySpend: number;
  shippedToday: number;
  avgCost: number;
  escalations: number;
  runMode: string;
  concurrency: number;
}

export interface ControlDoc {
  run_mode: "continuous" | "step" | "paused" | "paused_cost_cap";
  concurrency: number;
  per_stage_model_overrides: Record<string, string>;
  cost_cap_usd: number;
  updated_at: number;
  updated_by: string;
}

const POLL_MS = 3000;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export function usePoll<T>(url: string, intervalMs = POLL_MS): { data: T | null; error: Error | null; loading: boolean; mutate: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);
  const loading = data === null && error === null;

  const mutate = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchJson<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    const id = setInterval(() => {
      fetchJson<T>(url)
        .then((d) => { if (!cancelled) { setData(d); setError(null); } })
        .catch((e) => { if (!cancelled) setError(e instanceof Error ? e : new Error(String(e))); });
    }, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [url, intervalMs, tick]);

  return { data, error, loading, mutate };
}

const STATUS_TO_RUN_STATUS: Record<string, RunStatus> = {
  intake: "running",
  framed: "running",
  discovered: "running",
  planned: "running",
  specified: "running",
  built: "running",
  running: "running",
  claimed: "running",
  shipped: "shipped",
  paused_step: "paused_step",
  paused_cost_cap: "paused_cost_cap",
  escalated: "escalated",
  framing_failed: "failed",
  discovery_failed: "failed",
  plan_failed: "failed",
  spec_failed: "failed",
  build_failed: "failed",
  ship_failed: "failed",
};

const STATE_TO_STAGE: Record<string, StageName> = {
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

function deriveStages(status: string): { stages: Stage[]; current: StageName } {
  const current = STATE_TO_STAGE[status] ?? "frame";
  const currentIdx = STAGE_ORDER.indexOf(current);
  const isFailed = status.endsWith("_failed");
  const isPaused = status === "paused_step" || status === "paused_cost_cap";
  const isDone = status === "shipped";
  const failedStage = isFailed ? current : null;
  const pausedStage = isPaused ? (STATE_TO_STAGE[status] ?? "build") : null;

  const stages: Stage[] = STAGE_ORDER.map((name, i) => {
    let s: StageStatus;
    if (isDone) {
      s = "pass";
    } else if (name === failedStage) {
      s = "fail";
    } else if (name === pausedStage) {
      s = "pause";
    } else if (i < currentIdx) {
      s = "pass";
    } else if (i === currentIdx) {
      s = status === "intake" ? "pending" : isFailed ? "fail" : "running";
    } else {
      s = "pending";
    }
    return { name, status: s, tokens: 0, costUsd: 0, latencyMs: 0 };
  });
  return { stages, current };
}

export function mapRunRecord(r: RunRecord): Run {
  const runStatus = STATUS_TO_RUN_STATUS[r.status] ?? "running";
  const { stages, current } = deriveStages(r.status);
  return {
    id: r.run_id,
    idea: r.idea,
    status: runStatus,
    current,
    stages,
    costUsd: r.spent_usd,
    capUsd: r.cap_usd,
    latencyMs: 0,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function putControl(doc: Partial<ControlDoc>): Promise<ControlDoc> {
  const res = await fetch("/api/control", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function fetchRunDetail(
  id: string,
): Promise<import("./engine").RunDetailResponse | null> {
  const res = await fetch(`/api/runs/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<import("./engine").RunDetailResponse>;
}

export async function deleteRun(
  id: string,
  force = false,
): Promise<{ deleted: string } | { error: string; status: string }> {
  const url = force ? `/api/runs/${id}?force=1` : `/api/runs/${id}`;
  const res = await fetch(url, { method: "DELETE" });
  return res.json();
}
