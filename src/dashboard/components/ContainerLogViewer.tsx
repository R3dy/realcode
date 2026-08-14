"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Card, cn } from "@/components/ui";
import { Loader2, Terminal, ArrowDownToLine } from "lucide-react";

interface LogsResponse {
  container_id: string;
  log_path: string;
  text: string;
}

export function ContainerLogViewer({
  runId,
  container,
  runActive,
}: {
  runId: string;
  container: { container_id: string; name: string; role: string; story_id: string } | null;
  runActive: boolean;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tail, setTail] = useState(true);
  const preRef = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchLogs = useCallback(async () => {
    if (!container) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/runs/${runId}/containers/${container.container_id}/logs${tail ? "?tail=100" : ""}`;
      const res = await fetch(url);
      if (res.status === 404) {
        setText("");
        setError("No log file for this container yet.");
        return;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as LogsResponse;
      setText(data.text ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [runId, container, tail]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Poll while the run is active and a container is selected.
  useEffect(() => {
    if (!container || !runActive) return;
    const id = setInterval(fetchLogs, 3000);
    return () => clearInterval(id);
  }, [container, runActive, fetchLogs]);

  // Auto-scroll to bottom on new text (unless the user has scrolled up).
  useEffect(() => {
    if (autoScroll && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [text, autoScroll]);

  const onScroll = () => {
    const el = preRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  };

  if (!container) {
    return (
      <Card className="p-4">
        <Header title="Container Logs" />
        <div className="flex items-center gap-2 py-8 text-xs text-ink-600">
          <Terminal className="h-3.5 w-3.5" />
          Select a container to view its logs.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-ink-100">Container Logs</h3>
          <p className="truncate font-mono text-xs text-ink-500" title={container.container_id}>
            {container.name} · {container.role} · story {container.story_id}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTail((t) => !t)}
          className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-ink-300 transition-colors hover:bg-ink-700"
        >
          <ArrowDownToLine className="h-3 w-3" />
          {tail ? "tail 100" : "full"}
        </button>
      </div>
      <div
        className="relative max-h-[420px] overflow-auto rounded-lg border border-ink-700/40 bg-ink-950"
        onWheel={() => setAutoScroll(false)}
      >
        <pre
          ref={preRef}
          onScroll={onScroll}
          className="min-w-full p-3 font-mono text-xs leading-relaxed text-ink-300"
        >
          {loading && text === "" ? (
            <span className="inline-flex items-center gap-2 text-ink-500">
              <Loader2 className="h-3 w-3 animate-spin" /> loading…
            </span>
          ) : error ? (
            <span className="text-status-warn">{error}</span>
          ) : text === "" ? (
            <span className="text-ink-600">(empty log)</span>
          ) : (
            text
          )}
        </pre>
        {!autoScroll && (
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
            }}
            className={cn(
              "absolute bottom-2 right-2 inline-flex min-h-[32px] items-center gap-1 rounded-md",
              "border border-ink-700 bg-ink-800/90 px-2 py-1 font-mono text-[11px] text-ink-300",
              "backdrop-blur hover:bg-ink-700",
            )}
          >
            <ArrowDownToLine className="h-3 w-3" /> resume auto-scroll
          </button>
        )}
      </div>
    </Card>
  );
}

function Header({ title }: { title: string }) {
  return <h3 className="font-display text-sm font-semibold text-ink-100">{title}</h3>;
}
