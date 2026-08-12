import * as fs from "fs";
import * as path from "path";

/**
 * Live realtime state for a pipeline run (A11.1).
 *
 * `live.json` is a derived, transient realtime channel — NOT a stage artifact
 * (INV-2): it is overwritten per stage, never schema-validated, and is a
 * dashboard convenience channel rather than a second trace store (Phoenix
 * remains the OTel collector of record — ADR-005). The engine writes it at
 * stage start/end/catch for non-build stages; the dashboard reads it (A11.2).
 */

export interface LiveContainer {
  container_id: string | null;
  name: string;
  role: string;
  status: string;
  started_at: number;
  log_path: string;
}

/**
 * A single streaming trace event persisted to live.json's rolling events[]
 * window. Canonical engine-side definition of the dashboard `TraceEvent`
 * shape (the engine produces it first; A11.2/A11.3 read it back).
 */
export interface LiveTraceEvent {
  kind: string;
  stage: string;
  agent: string;
  content: string;
  timestamp: number;
  role?: string;
  tool?: string;
  tokens?: number;
  cost_usd?: number;
}

export interface LiveState {
  run_id: string;
  stage: string | null;
  status: string;
  started_at: number;
  updated_at: number;
  container: LiveContainer | null;
  events: LiveTraceEvent[];
  tokens_total: number;
  cost_usd: number;
  failure_message?: string;
}

const MAX_EVENT_CONTENT = 500;
const MAX_EVENTS = 200;
const COALESCE_MS = 250;

function liveStatePath(runId: string): string {
  const dataDir = process.env.REALCODE_DATA_DIR || "/data";
  return path.join(dataDir, "runs", runId, "live.json");
}

function emptyState(runId: string): LiveState {
  return {
    run_id: runId,
    stage: null,
    status: "unknown",
    started_at: Date.now(),
    updated_at: Date.now(),
    container: null,
    events: [],
    tokens_total: 0,
    cost_usd: 0,
  };
}

/**
 * Atomically write (part of) a run's live state. Reads the current file,
 * merges `partial` shallowly (deep-merging `container` so callers can update
 * just `container_id` without losing `name`/`role`/`log_path`), stamps
 * `updated_at`, and rewrites via tmp+rename (same pattern as control.json).
 * Missing/corrupt file → starts from the empty state. Never throws — live
 * state is best-effort observability, a failure must never crash a stage.
 */
export function writeLiveState(
  runId: string,
  partial: Omit<Partial<LiveState>, "container"> & { container?: Partial<LiveContainer> | null },
): void {
  const fp = liveStatePath(runId);
  let state: LiveState;
  try {
    const raw = fs.readFileSync(fp, "utf8");
    state = { ...emptyState(runId), ...(JSON.parse(raw) as Partial<LiveState>) };
  } catch {
    state = emptyState(runId);
  }
  const next = { ...state, ...partial, run_id: runId, updated_at: Date.now() } as LiveState & { container?: Partial<LiveContainer> | null };
  if (partial.container !== undefined) {
    next.container = partial.container === null
      ? null
      : {
          container_id: partial.container.container_id !== undefined ? partial.container.container_id : state.container?.container_id ?? null,
          name: partial.container.name !== undefined ? partial.container.name : state.container?.name ?? "",
          role: partial.container.role !== undefined ? partial.container.role : state.container?.role ?? "",
          status: partial.container.status !== undefined ? partial.container.status : state.container?.status ?? "",
          started_at: partial.container.started_at !== undefined ? partial.container.started_at : state.container?.started_at ?? Date.now(),
          log_path: partial.container.log_path !== undefined ? partial.container.log_path : state.container?.log_path ?? "",
        };
  }

  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
  } catch {
    // dir creation failure is handled by the write below (may throw → caught by caller)
  }
  const tmp = `${fp}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, fp);
}

/**
 * Read a run's live state. Returns the parsed file, or null when absent or
 * corrupt (matches getBuildState's null-on-missing contract). Never throws.
 */
export function readLiveState(runId: string): LiveState | null {
  const fp = liveStatePath(runId);
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw) as LiveState;
  } catch {
    return null;
  }
}

// ─── Coalescing buffer ──────────────────────────────────────────────────────
// At most one file rewrite per COALESCE_MS per run. Bursts of events append to
// the in-memory buffer; a single trailing timer flushes them all. A trailing
// flush (flushLiveEvents) is invoked by the dispatcher at stage end so the
// last event of a stage is never dropped by the throttle.

const buffers = new Map<string, LiveTraceEvent[]>();
let flushTimer: NodeJS.Timeout | null = null;

function flushRun(runId: string): void {
  const buf = buffers.get(runId);
  if (!buf || buf.length === 0) return;
  buffers.delete(runId);
  try {
    const state = readLiveState(runId) ?? emptyState(runId);
    for (const ev of buf) {
      state.events.push(ev);
      state.tokens_total += ev.tokens ?? 0;
      state.cost_usd += ev.cost_usd ?? 0;
    }
    if (state.events.length > MAX_EVENTS) {
      state.events.splice(0, state.events.length - MAX_EVENTS);
    }
    writeLiveState(runId, state);
  } catch (err) {
    console.warn(`[live-state] flush failed for ${runId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function flushAll(): void {
  flushTimer = null;
  for (const runId of [...buffers.keys()]) {
    flushRun(runId);
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(flushAll, COALESCE_MS);
}

/**
 * Append a trace event to the run's live state. Truncates content to 500
 * chars, caps the rolling events[] window at 200 (drop oldest), and coalesces
 * bursts to at most one file rewrite per 250ms (trailing timer flush). Never
 * throws — called from stream callbacks where a throw would crash the sandbox
 * spawn's stdout handling.
 */
export function appendLiveEvent(runId: string, event: LiveTraceEvent): void {
  const ev: LiveTraceEvent = {
    ...event,
    content: event.content.slice(0, MAX_EVENT_CONTENT),
  };
  const buf = buffers.get(runId) ?? [];
  buf.push(ev);
  buffers.set(runId, buf);
  scheduleFlush();
}

/**
 * Immediately flush any buffered events for a run (stage end, success +
 * failure). Ensures the coalesce throttle never drops the last event.
 */
export function flushLiveEvents(runId: string): void {
  flushRun(runId);
  if (flushTimer && buffers.size === 0) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

/**
 * Convert a raw opencode JSON event line (as emitted on sandbox stdout) into
 * a LiveTraceEvent. Returns null for events with no `part` (skip them).
 * `part.type` → `kind`, `part.text` → `content` (pre-truncated to 500 here;
 * appendLiveEvent truncates again defensively), `part.tokens.total` →
 * `tokens`, `part.cost` → `cost_usd`, stage id → `stage` + `role`, `Date.now()`
 * → `timestamp`.
 */
export function eventFromJsonLine(ev: unknown, stageId: string): LiveTraceEvent | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as Record<string, unknown>;
  const part = e.part as Record<string, unknown> | undefined;
  if (!part || typeof part !== "object") return null;
  const tokens = part.tokens as Record<string, number> | undefined;
  const isToolUse = part.type === "tool_use" || part.tool !== undefined;
  const kind = part.type === "error" ? "error" : isToolUse ? "tool-call" : "llm-message";
  const ts = Date.now();
  return {
    kind,
    stage: stageId,
    agent: stageId,
    content: typeof part.text === "string" ? part.text.slice(0, MAX_EVENT_CONTENT) : "",
    timestamp: ts,
    role: stageId,
    ...(part.tool !== undefined ? { tool: String(part.tool) } : {}),
    tokens: tokens?.total ?? 0,
    cost_usd: Number(part.cost ?? 0),
  };
}
