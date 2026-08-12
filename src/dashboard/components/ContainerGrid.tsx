"use client";
import { usePoll } from "@/lib/api";
import { Badge, Card, StatusDot, cn } from "@/components/ui";
import { Loader2, Box, Clock } from "lucide-react";

interface ContainerView {
  container_id: string;
  name: string;
  story_id: string;
  role: string;
  status: string;
  started_at: number | null;
  exited_at: number | null;
  log_path: string;
}

interface ContainersResponse {
  containers: ContainerView[];
}

const ROLE_TONE: Record<string, "brand" | "pass"> = {
  worker: "brand",
  validator: "pass",
};

const STATUS_TONE: Record<string, "run" | "pass" | "fail" | "neutral"> = {
  running: "run",
  exited: "pass",
  done: "pass",
  failed: "fail",
};

function fmtDuration(start: number | null, end: number | null): string {
  if (!start) return "—";
  const e = end ?? Date.now();
  const s = Math.max(0, Math.floor((e - start) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m === 0 ? `${sec}s` : `${m}m ${sec.toString().padStart(2, "0")}s`;
}

export function ContainerGrid({
  runId,
  buildActive,
  selectedCid,
  onSelect,
}: {
  runId: string;
  buildActive: boolean;
  selectedCid: string | null;
  onSelect: (c: ContainerView) => void;
}) {
  const intervalMs = buildActive ? 2000 : 10000;
  const { data, error, loading } = usePoll<ContainersResponse>(`/api/runs/${runId}/containers`, intervalMs);

  if (loading) {
    return (
      <Card className="p-4">
        <Header />
        <div className="flex items-center gap-2 py-4 text-xs text-ink-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading containers…
        </div>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="p-4">
        <Header />
        <p className="py-4 text-xs text-ink-600">No container data available.</p>
      </Card>
    );
  }

  const containers = data.containers ?? [];

  return (
    <Card className="p-4">
      <Header count={containers.length} />
      {containers.length === 0 ? (
        <p className="py-4 text-xs text-ink-600">
          No containers tracked yet. Containers appear once the build loop dispatches Worker/Validator sandboxes.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {containers.map((c) => {
            const tone = STATUS_TONE[c.status] ?? "neutral";
            const live = c.status === "running";
            const isSelected = selectedCid === c.container_id;
            const hasLogs = Boolean(c.log_path);
            return (
              <button
                key={c.container_id}
                type="button"
                onClick={() => onSelect(c)}
                disabled={!hasLogs}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border bg-ink-850/40 px-3 py-2.5 text-left transition-all",
                  isSelected
                    ? "border-brand-500/60 bg-brand-500/5"
                    : "border-ink-700/40 hover:border-ink-700 hover:bg-ink-850",
                  !hasLogs && "cursor-default opacity-70 hover:border-ink-700/40 hover:bg-ink-850/40",
                )}
              >
                <div className="flex items-center gap-2">
                  <StatusDot tone={tone} pulse={live} />
                  <Box className="h-3.5 w-3.5 text-ink-500" />
                  <span className="truncate font-mono text-xs text-ink-300" title={c.container_id}>
                    {c.name}
                  </span>
                  <Badge tone={ROLE_TONE[c.role] ?? "neutral"} className="ml-auto">
                    {c.role}
                  </Badge>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-ink-500">
                  <span className="font-mono">{c.story_id}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {fmtDuration(c.started_at, c.exited_at)}
                  </span>
                  <span className="ml-auto">{hasLogs ? "view logs →" : "no logs"}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="font-display text-sm font-semibold text-ink-100">Containers</h3>
      {count !== undefined && <span className="font-mono text-xs text-ink-500">{count} active</span>}
    </div>
  );
}
