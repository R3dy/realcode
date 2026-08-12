"use client";
import { usePoll } from "@/lib/api";
import { Badge, Card, StatusDot, cn } from "@/components/ui";
import { Loader2, Coins, Cpu, Clock } from "lucide-react";

interface BuildStory {
  story_id: string;
  title: string;
  status: "pending" | "building" | "validating" | "done" | "failed" | "escalated";
  retry_count: number;
  started_at: number | null;
  completed_at: number | null;
  worker_tokens?: number;
  validator_tokens?: number;
  worker_cost_usd?: number;
  validator_cost_usd?: number;
}

interface BuildStateResponse {
  run_id: string;
  started_at: number;
  stories: BuildStory[];
}

const STORY_TONE: Record<BuildStory["status"], "pass" | "run" | "fail" | "pause" | "neutral"> = {
  pending: "neutral",
  building: "run",
  validating: "run",
  done: "pass",
  failed: "fail",
  escalated: "fail",
};

const STATUS_LABEL: Record<BuildStory["status"], string> = {
  pending: "pending",
  building: "building",
  validating: "validating",
  done: "done",
  failed: "failed",
  escalated: "escalated",
};

function fmtDuration(ms: number | null, completed: number | null): string {
  if (!ms) return "—";
  const end = completed ?? Date.now();
  const s = Math.max(0, Math.floor((end - ms) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m === 0 ? `${sec}s` : `${m}m ${sec.toString().padStart(2, "0")}s`;
}

export function StoryProgress({ runId, buildActive }: { runId: string; buildActive: boolean }) {
  // Poll every 2s while the build stage is active; back off to 10s when done.
  const intervalMs = buildActive ? 2000 : 10000;
  const { data, error, loading } = usePoll<BuildStateResponse>(`/api/runs/${runId}/build-state`, intervalMs);

  if (loading) {
    return (
      <Card className="p-4">
        <Header />
        <div className="flex items-center gap-2 py-4 text-xs text-ink-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading story progress…
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-4">
        <Header />
        <p className="py-4 text-xs text-ink-600">No build state available.</p>
      </Card>
    );
  }

  const stories = data.stories ?? [];
  const doneCount = stories.filter((s) => s.status === "done").length;

  return (
    <Card className="p-4">
      <Header doneCount={doneCount} total={stories.length} startedAt={data.started_at} />
      <ul className="mt-3 space-y-1.5">
        {stories.map((s) => {
          const tone = STORY_TONE[s.status];
          const live = s.status === "building" || s.status === "validating";
          const tokens = (s.worker_tokens ?? 0) + (s.validator_tokens ?? 0);
          const cost = (s.worker_cost_usd ?? 0) + (s.validator_cost_usd ?? 0);
          return (
            <li
              key={s.story_id}
              className="flex items-center gap-3 rounded-lg border border-ink-700/40 bg-ink-850/40 px-3 py-2"
            >
              <StatusDot tone={tone} pulse={live} />
              <span className="font-mono text-xs text-ink-300">{s.story_id}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{s.title}</span>
              <Badge tone={tone}>{STATUS_LABEL[s.status]}</Badge>
              {s.retry_count > 0 && (
                <span className="font-mono text-[10px] text-status-warn">retry {s.retry_count}</span>
              )}
              <span className="hidden items-center gap-1 text-[11px] text-ink-500 sm:inline-flex">
                <Coins className="h-3 w-3" />${cost.toFixed(3)}
              </span>
              <span className="hidden items-center gap-1 text-[11px] text-ink-500 md:inline-flex">
                <Cpu className="h-3 w-3" />{tokens > 0 ? `${(tokens / 1000).toFixed(1)}k` : "—"}
              </span>
              <span className="hidden items-center gap-1 text-[11px] text-ink-500 md:inline-flex">
                <Clock className="h-3 w-3" />
                {fmtDuration(s.started_at, s.completed_at)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Header({ doneCount, total, startedAt }: { doneCount?: number; total?: number; startedAt?: number }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="font-display text-sm font-semibold text-ink-100">Story Progress</h3>
      {doneCount !== undefined && total !== undefined && (
        <span className="font-mono text-xs text-ink-500">
          <span className={cn(doneCount === total && total > 0 && "text-status-pass")}>{doneCount}</span>
          <span className="text-ink-600"> / {total} done</span>
          {startedAt && (
            <span className="ml-2 text-ink-600">
              {new Date(startedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
            </span>
          )}
        </span>
      )}
    </div>
  );
}
