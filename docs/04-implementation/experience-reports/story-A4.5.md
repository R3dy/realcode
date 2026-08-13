# Experience Report — Story A4.5: Dashboard: mission-control UI

**Experience Runner:** Anymake combined Validator + Experience Runner
**Date:** 2026-08-12
**Branch:** story/A4.5-dashboard-mission-control
**PR:** #9
**Scenario type:** Terminal (per validator instructions — the brief's §3 Browser experience script is not drivable in this environment; the 8 terminal scenarios below verify the same acceptance surface from the command line)

---

## Verdict: PASS

All 8 terminal scenarios pass. The story's build/test/lint/typecheck surface is green, the 4 API routes and 4 components exist on disk and are wired into the run-detail page, the design-token discipline (ink-* not slate-*) is honored, and the SSE endpoint emits the required headers.

---

## Scenario results

### 1. `npm test` → 194 pass, 6 skipped ✅
```
Test Files  17 passed | 1 skipped (18)
     Tests  194 passed | 6 skipped (200)
  Duration  2.08s
```
- 194 passed matches the brief's expected "194 pass".
- 6 skipped = `tests/integration/e2e.test.ts` (`describe.skip`'d pending A4.6 — pre-existing from A4.4).
- New test files green: `tests/dashboard-build-state.test.ts` (17 tests), `tests/dashboard-routes.test.ts` (10 tests).

### 2. `npm run typecheck` → clean ✅
```
> realcode@0.1.0 typecheck
> tsc --noEmit
(exits 0 — no output)
```

### 3. `npm run lint` → 0 errors ✅
```
6 problems (0 errors, 6 warnings)
```
All 6 warnings are pre-existing in files untouched by A4.5's core logic (`src/cli/index.ts`, `src/dashboard/app/api/control/route.ts`, `src/dashboard/components/StatStrip.tsx`, `src/dashboard/lib/engine.ts:260` pre-existing `deriveStageStatuses`, `src/engine/build-loop.ts:159`, `src/sandbox/runner.ts:1`). No A4.5-added file produces a warning.

### 4. The 4 new API route files exist ✅
```
src/dashboard/app/api/runs/[id]/build-state/route.ts
src/dashboard/app/api/runs/[id]/containers/[cid]/logs/route.ts
src/dashboard/app/api/runs/[id]/containers/route.ts
src/dashboard/app/api/runs/[id]/trace/route.ts
```
All four files present on disk in the dashboard App Router tree.

### 5. The 4 new component files exist ✅
```
src/dashboard/components/StoryProgress.tsx
src/dashboard/components/ContainerGrid.tsx
src/dashboard/components/ContainerLogViewer.tsx
src/dashboard/components/LiveTraceStream.tsx
```
All four components present. All four begin with `"use client";` (interactive: polling, SSE, scroll, selection).

### 6. Page imports and renders the new components ✅
`src/dashboard/app/runs/[id]/page.tsx` imports all four:
```
18: import { StoryProgress } from "@/components/StoryProgress";
19: import { ContainerGrid } from "@/components/ContainerGrid";
20: import { ContainerLogViewer } from "@/components/ContainerLogViewer";
21: import { LiveTraceStream } from "@/components/LiveTraceStream";
```
Renders them in the conditional Build Stage Detail section (`page.tsx:263-288`):
- `<StoryProgress runId={params.id} buildActive={buildStageActive} />` (line 266)
- `<ContainerGrid ... onSelect={(c) => setSelectedContainer({...})} />` (lines 267-279)
- `<LiveTraceStream runId={params.id} buildActive={buildStageActive} />` (line 281)
- `<ContainerLogViewer runId={params.id} container={selectedContainer} buildActive={buildStageActive} />` (lines 282-286)

Section is gated by `showBuildDetail = buildStageActive || Boolean(artifacts.build) || Boolean(buildState)` (line 141) — invisible for pre-build runs (criterion 13 regression-check satisfied).

### 7. `ink-*` tokens used, `slate-*` NOT used ✅
`ink-*` token counts in the new components:
```
src/dashboard/components/LiveTraceStream.tsx:14
src/dashboard/components/ContainerLogViewer.tsx:11
src/dashboard/components/ContainerGrid.tsx:11
src/dashboard/components/StoryProgress.tsx:12
```
`rg -n "\bslate-[0-9]" src/dashboard/` → **no matches**. The dashboard's entire `src/dashboard/` tree is free of raw `slate-*` classes. `ux-design.md:43-44` codifies the rule ("never use raw `slate-*` classes"). The 4 components also import `Badge`/`Card`/`StatusDot`/`cn` primitives from `@/components/ui` (verified via `rg -l "@/components" src/dashboard/components/`).

### 8. SSE endpoint sets proper headers (`Content-Type: text/event-stream`) ✅
`src/dashboard/app/api/runs/[id]/trace/route.ts:87-94`:
```
87:  return new Response(stream, {
88:    headers: {
89:      "Content-Type": "text/event-stream",
90:      "Cache-Control": "no-cache, no-transform",
91:      Connection: "keep-alive",
92:      "X-Accel-Buffering": "no",
93:    },
94:  });
```
All four SSE headers present, including the `X-Accel-Buffering: no` override that defeats nginx buffering so the stream flushes live. `Cache-Control` includes `no-transform` per the brief §4.6. The route also emits a `connected` keep-alive event on stream open (`trace/route.ts:40`), polls every `POLL_MS=2000`ms (`:19, 82`), and emits a `done` event on terminal status (`:76-79`) — verified by `tests/dashboard-routes.test.ts:161-177` (SSE smoke test: 200 status, `content-type === "text/event-stream"`, `cache-control` contains `no-cache`, first chunk contains `connected`).

---

## Escalations

None.

## Notes for the orchestrator

- The brief's §3 Browser experience script (drive `/runs/<id>` for a run in the build stage, watch StoryProgress/ContainerGrid/LiveTraceStream update live, click a container, watch logs stream) was not executable in this environment — there is no live build loop running against a real run directory, and the validator instructions explicitly redefined §3a as the 8 Terminal scenarios above. The 8 terminal scenarios cover the same acceptance surface: route/component existence, wiring, token discipline, and SSE headers. The remaining live-interaction assertions (polling cadence, SSE event flow, click-to-select, auto-scroll) are covered by the component source (verified in the validation report) + the new test files (27 new tests green). A future staging experience check (Phase 4 Step 4.6) can drive the browser flow against a live build loop once A4.6 wires the sandbox.
