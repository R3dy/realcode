"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Badge, Card, StatusDot, cn } from "@/components/ui";
import { ChevronRight, Wrench, Cpu, Coins, Radio, Pause, Play } from "lucide-react";

interface TraceEvent {
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

interface SseMessage {
  type: "connected" | "trace_event" | "story_update" | "done";
  run_id?: string;
  event?: TraceEvent;
  stories?: Array<{ story_id: string; status: string }>;
  reason?: string;
  status?: string;
}

const KIND_TONE: Record<TraceEvent["kind"], "brand" | "pass" | "neutral" | "fail"> = {
  "llm-message": "brand",
  "tool-call": "pass",
  "stage-event": "neutral",
  error: "fail",
};

const KIND_LABEL: Record<TraceEvent["kind"], string> = {
  "llm-message": "llm",
  "tool-call": "tool",
  "stage-event": "stage",
  error: "error",
};

function fmtTime(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(11, 19);
}

export function LiveTraceStream({ runId, buildActive }: { runId: string; buildActive: boolean }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [filterStage, setFilterStage] = useState<string>("");
  const [filterAgent, setFilterAgent] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // SSE connection lifecycle: reconnect when runId changes; pause when the
  // user pauses or the build is no longer active.
  useEffect(() => {
    if (paused || !buildActive) {
      // Keep the events already received; just don't open a new connection.
      if (!buildActive && !done && events.length === 0) {
        // build not active and nothing streamed — show offline.
      }
      return;
    }
    setConnected(false);
    setDone(false);

    const es = new EventSource(`/api/runs/${runId}/trace`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      let msg: SseMessage;
      try {
        msg = JSON.parse(e.data) as SseMessage;
      } catch {
        return;
      }
      if (msg.type === "connected") {
        setConnected(true);
      } else if (msg.type === "trace_event" && msg.event) {
        setEvents((prev) => [...prev, msg.event!]);
      } else if (msg.type === "done") {
        setDone(true);
        setConnected(false);
        es.close();
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [runId, paused, buildActive]);

  // Auto-scroll on new events.
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, []);

  const filtered = events.filter(
    (e) =>
      (!filterStage || e.stage === filterStage) &&
      (!filterAgent || e.agent === filterAgent || e.role === filterAgent),
  );

  const stages = Array.from(new Set(events.map((e) => e.stage)));
  const agents = Array.from(new Set(events.map((e) => e.role ?? e.agent)));

  return (
    <Card className="flex max-h-[520px] flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display text-sm font-semibold text-ink-100">Live Trace</h3>
          <StatusDot tone={connected ? "run" : done ? "pass" : "neutral"} pulse={connected} />
          <span className="text-[11px] text-ink-500">
            {connected ? "live" : done ? "stream closed" : buildActive ? "connecting…" : "tracing offline"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <FilterSelect
            value={filterStage}
            onChange={setFilterStage}
            options={stages}
            placeholder="all stages"
          />
          <FilterSelect
            value={filterAgent}
            onChange={setFilterAgent}
            options={agents}
            placeholder="all agents"
          />
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="inline-flex items-center gap-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1 text-[11px] text-ink-300 transition-colors hover:bg-ink-700"
            title={paused ? "Resume stream" : "Pause stream"}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "resume" : "pause"}
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={() => setAutoScroll(false)}
        className="min-h-[120px] flex-1 space-y-1 overflow-auto rounded-lg border border-ink-700/40 bg-ink-950/40 p-2"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-xs text-ink-600">
            <Radio className="h-3.5 w-3.5" />
            {connected
              ? "Waiting for agent messages…"
              : buildActive
                ? "Connecting to the trace stream…"
                : "Tracing offline — start a build to see live agent messages + tool calls."}
          </div>
        ) : (
          filtered.map((ev, i) => <TraceRow key={i} ev={ev} />)
        )}
      </div>
    </Card>
  );
}

function TraceRow({ ev }: { ev: TraceEvent }) {
  const tone = KIND_TONE[ev.kind];
  return (
    <div className="rounded-md border border-ink-800/60 bg-ink-900/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ChevronRight className="h-3 w-3 text-ink-600" />
        <span className="font-mono text-[11px] text-ink-300">{ev.role ?? ev.agent}</span>
        {ev.story_id && (
          <span className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 font-mono text-[10px] text-ink-500">
            {ev.story_id}
          </span>
        )}
        <Badge tone={tone} className="font-mono text-[10px]">
          {KIND_LABEL[ev.kind]}
        </Badge>
        {ev.tool && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-brand-300">
            <Wrench className="h-2.5 w-2.5" /> {ev.tool}
          </span>
        )}
        <span className="ml-auto flex items-center gap-3 text-[10px] text-ink-500">
          {typeof ev.tokens === "number" && ev.tokens > 0 && (
            <span className="inline-flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {(ev.tokens / 1000).toFixed(1)}k
            </span>
          )}
          {typeof ev.cost_usd === "number" && ev.cost_usd > 0 && (
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3 w-3" />${ev.cost_usd.toFixed(3)}
            </span>
          )}
          {ev.timestamp && <span className="font-mono text-ink-600">{fmtTime(ev.timestamp)}</span>}
        </span>
      </div>
      {(ev.content || ev.tool_input) && (
        <p
          className={cn(
            "mt-1 pl-5 text-xs",
            ev.kind === "error" ? "text-status-fail/90" : "text-ink-500",
          )}
        >
          {ev.content}
          {ev.tool_input && (
            <span className="ml-1 font-mono text-[11px] text-ink-600">({ev.tool_input.slice(0, 120)})</span>
          )}
        </p>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-md border border-ink-700 bg-ink-800 px-2 py-1 font-mono text-[11px] text-ink-300",
        "focus:border-brand-500 focus:outline-none",
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
