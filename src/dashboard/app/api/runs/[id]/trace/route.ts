import { getEngine, type TraceEvent } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Runs that terminate the SSE stream. `built` is deliberately NOT in this set
// (A11.3, 1-C3) so the ship stage keeps streaming — no connect/close flicker at
// the build→ship transition. `ship_failed` and all `*_failed` remain terminal so
// a failed ship still closes the stream. (Not exported: Next.js route files only
// allow valid Route export fields, so 1-C3 is tested via route behavior instead.)
const TERMINAL_RUN_STATUSES = new Set([
  "shipped",
  "escalated",
  "framing_failed",
  "discovery_failed",
  "plan_failed",
  "spec_failed",
  "build_failed",
  "ship_failed",
  "paused_step",
  "paused_cost_cap",
]);

const POLL_MS = 2000;
const MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 min safety ceiling

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const runId = params.id;
  const encoder = new TextEncoder();
  const engine = getEngine();

  let lastEventCount = 0;
  let lastStorySig = "";

  function sse(data: unknown): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Initial keep-alive + connected event.
      controller.enqueue(sse({ type: "connected", run_id: runId }));

      const startedAt = Date.now();
      while (true) {
        if (Date.now() - startedAt > MAX_LIFETIME_MS) {
          controller.enqueue(sse({ type: "done", reason: "max_lifetime" }));
          controller.close();
          return;
        }

        const run = engine.getRun(runId);
        if (!run) {
          controller.enqueue(sse({ type: "done", reason: "run_not_found" }));
          controller.close();
          return;
        }

        // Emit synthesized trace events (engine-side synthesis from build-state).
        const events = engine.getTraceEvents(runId);
        if (events.length > lastEventCount) {
          for (const ev of events.slice(lastEventCount)) {
            controller.enqueue(sse({ type: "trace_event", event: ev }));
          }
          lastEventCount = events.length;
        }

        // Emit story_update events on build-state change.
        const state = engine.getBuildState(runId);
        if (state) {
          const sig = state.stories.map((s) => `${s.story_id}:${s.status}`).join("|");
          if (sig !== lastStorySig) {
            controller.enqueue(sse({ type: "story_update", stories: state.stories.map((s) => ({ story_id: s.story_id, status: s.status })) }));
            lastStorySig = sig;
          }
        }

        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          controller.enqueue(sse({ type: "done", reason: "terminal", status: run.status }));
          controller.close();
          return;
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// Re-export for tests that import the events type.
export type { TraceEvent };
