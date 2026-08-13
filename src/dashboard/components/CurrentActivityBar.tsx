"use client";
import { usePoll } from "@/lib/api";
import { Card, StatusDot } from "@/components/ui";
import { Clock, Cpu, Coins } from "lucide-react";
import type { RunDetailResponse, LiveState } from "@/lib/engine";

export type ActivityTone = "run" | "pass" | "fail";

// Prop contract for CurrentActivityBar. `runStatus` carries the run-level
// status from the page; the summary line is derived from live_state.status.
interface CABProps {
  runId: string;
  liveState: LiveState | null;
  runStatus: string;
}

// Pure helper — maps a live_state status to the status-dot tone.
// "running" → amber "run" (pulsed while active); "completed" → green "pass";
// "failed" → red "fail".
export function activityTone(status: string): ActivityTone {
  switch (status) {
    case "completed":
      return "pass";
    case "failed":
      return "fail";
    default:
      return "run";
  }
}

// Pure helper — elapsed time since started_at, matching ContainerGrid's fmtDuration.
export function fmtElapsed(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m === 0 ? `${sec}s` : `${m}m ${sec.toString().padStart(2, "0")}s`;
}

// Slim one-line "what's happening right now" status bar for the run detail page
// (A11.3). Reads live_state from GET /api/runs/[id], polled every 2s. Renders
// only when a live_state exists — the page owns the section predicate, so this
// component returns null when live_state is absent.
export function CurrentActivityBar({ runId, liveState }: CABProps) {
  // Poll the detail endpoint every 2s so the activity line re-evaluates elapsed
  // time and picks up live_state stage transitions without a new route (INV-5).
  const { data } = usePoll<RunDetailResponse>(`/api/runs/${runId}`, 2000);
  // usePoll initializes `data` to null until the first fetch resolves — guard
  // with optional chaining so the first render doesn't throw `null.live_state`.
  // Cast was a TypeScript-only assertion (erased at runtime) and never actually
  // protected us. The parent page only mounts this component when ITS fetch
  // already returned a live_state, but THIS component's own usePoll starts null.
  const live = data?.live_state ?? liveState;

  if (!live) return null;

  const tone = activityTone(live.status);
  const running = live.status === "running";
  const stage = live.stage ? live.stage.replace(/^./, (c) => c.toUpperCase()) : "—";
  const summary = running
    ? `Running: ${stage}`
    : live.status === "completed"
      ? `Completed: ${stage}`
      : `Failed: ${stage}`;

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <StatusDot tone={tone} pulse={running} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-ink-100">{stage}</span>
          <span className="truncate text-xs text-ink-300">{summary}</span>
        </div>
      </div>
      {live.container && (
        <span
          className="hidden font-mono text-xs text-ink-500 sm:inline"
          title={live.container.container_id ?? live.container.name}
        >
          {(live.container.container_id ?? live.container.name).slice(0, 12)}
        </span>
      )}
      <div className="flex items-center gap-3 text-xs text-ink-500">
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" /> {fmtElapsed(live.started_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Cpu className="h-3 w-3" /> {live.tokens_total}
        </span>
        <span className="inline-flex items-center gap-1">
          <Coins className="h-3 w-3" /> ${live.cost_usd.toFixed(2)}
        </span>
      </div>
    </Card>
  );
}