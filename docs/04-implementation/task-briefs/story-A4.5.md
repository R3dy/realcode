# Task Brief — [Story A4.5: Dashboard: mission-control visibility]

**Created by:** Anymake Planner (self-dispatched combined Planner+Worker)
**Created at:** 2026-08-12T00:00:00Z
**Project:** realcode
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## 1. Story Identity

**Story ID:** A4.5
**Story title:** Dashboard: mission-control visibility
**Epic:** Epic A4 — Build inner loop (Issue #4: multi-container build loop)
**Milestone:** Issue #4 build loop (stories A4.1 → A4.6)
**Priority:** Must Have
**This is PR #:** #5 (fifth PR for issue #4 — past the first-3 review rule, not security-relevant)

---

## 2. User Story

**As a** realcode operator
**I want** the run-detail page to show per-story progress, per-container status, turn-level trace events, and container logs
**So that** I have mission-control visibility into the multi-container build loop.

---

## 3. Acceptance Criteria

Copied **verbatim** from `docs/06-agile/issue-4/plan.md` §9 Story A4.5.

- [ ] `GET /api/runs/[id]/stories` returns the stories array from `build-state.json` (or 404 if absent)
- [ ] `GET /api/runs/[id]/containers` returns the containers array from `build-state.json` + lists log files. Each container: id, name, story_id, role, status, started_at, exited_at, log_path.
- [ ] `GET /api/runs/[id]/containers/[cid]/logs` resolves `[cid]` through `build-state.json`'s `containers[]` (matching `container_id` or `name`), reads the `log_path` field, returns the raw log text. Supports `?tail=N`.
- [ ] `GET /api/runs/[id]/stream` is an SSE endpoint: sets `Content-Type: text/event-stream`, polls Phoenix GraphQL every 2s for spans with `realcode.run_id == <id>`, emits new spans as SSE `data:` events (including synthesized turn/tool spans with `realcode.agent_message` + `realcode.tool`). Also polls `build-state.json` and emits story_update events. Closes on terminal state.
- [ ] `src/dashboard/lib/engine.ts` `getRunDetail()` reads `build-state.json` if present and includes `build_state` in the `RunDetailResponse`
- [ ] `src/dashboard/components/StoryProgress.tsx`: vertical list of stories with status badges, retry count, duration. Polls `/api/runs/[id]/stories` every 2s when build stage is active.
- [ ] `src/dashboard/components/ContainerGrid.tsx`: grid of container cards. Clicking a card selects it for the ContainerLogViewer. Polls `/api/runs/[id]/containers` every 2s.
- [ ] `src/dashboard/components/LiveTraceStream.tsx`: SSE-fed real-time timeline. Renders spans as they arrive: span name, role (from `realcode.role`), tool calls (from `realcode.tool`), tokens, cost, agent message (from `realcode.agent_message`). Reuses TraceTimeline's visual pattern. Auto-scrolls; pauses on scroll-up.
- [ ] `src/dashboard/components/ContainerLogViewer.tsx`: terminal-style `<pre>` on `bg-ink-950` (or `bg-[#0a0b12]`), mono font, auto-scroll, "tail 100 / full" toggle. Fetches `/api/runs/[id]/containers/[cid]/logs?tail=100`.
- [ ] `src/dashboard/app/runs/[id]/page.tsx` shows a "Build Stage Detail" section (conditional: when `stages.build === "running"` or `artifacts.build` present) containing StoryProgress + ContainerGrid + LiveTraceStream + ContainerLogViewer. Raw build artifact JSON via "View raw artifact" toggle.
- [ ] **All new components compose `Card`/`Badge`/`StatusDot` primitives and use `ink-*`/`status-*`/`brand-*` tokens — no raw `slate-*` classes** (verified against `tailwind.config.js` palette)
- [ ] `docs/02-planning/ux-design.md` Component Inventory gains entries for `StoryProgress`, `ContainerGrid`, `LiveTraceStream`, `ContainerLogViewer` (documentation update — additive)
- [ ] The run-detail page still renders correctly for runs that haven't reached the build stage (no Build Stage Detail section shown)
- [ ] **Delete-run during a build loop:** the delete-run API checks `build-state.json` for running containers; returns 409 if any exist unless `?force=1`; on `?force=1`, tears down containers via deterministic names before removing the workspace. The detail-page delete modal warns if the run is in an active build loop.

**Experience Script:** Browser-type. Navigate to `/runs/<id>` for a run in the build stage. See: header card with StageStepper (build stage pulsing amber). Per-stage cards for frame/discover/plan/spec (green). Build Stage Detail section: StoryProgress shows story 3.1 (building, amber pulse), 3.2 (pending), 3.3 (pending). ContainerGrid shows `realcode-<id>-3-1-worker-0` (running). LiveTraceStream shows turn-level agent messages + tool calls (synthesized from sandbox JSON events, arriving per-completed-sandbox — not mid-execution; the truly-live stream is ContainerLogViewer). Click a container → ContainerLogViewer shows raw stdout/stderr. After story 3.1 completes, StoryProgress updates: 3.1 (done, green), 3.2 (building, amber pulse). The SSE stream shows new spans arriving live.

---

## 4. Technical Context

### 4.1 build-state.json shape (produced by A4.2 — `src/engine/build-loop.ts`)

```json
{
  "run_id": "...",
  "started_at": <epoch_ms>,
  "wall_clock_deadline_ms": <epoch_ms>,
  "paused": false,
  "pause_reason": null,
  "stories": [{
    "story_id": "3.1",
    "title": "...",
    "status": "pending" | "building" | "validating" | "done" | "failed" | "escalated",
    "retry_count": 0,
    "worker_container_id": null,
    "validator_container_id": null,
    "worker_output": null,
    "validator_output": null,
    "started_at": null,
    "completed_at": null,
    "depends_on": [],
    "acceptance_criteria": [],
    "worker_tokens": 0,
    "validator_tokens": 0,
    "worker_cost_usd": 0,
    "validator_cost_usd": 0,
    "test_passed": 0,
    "test_failed": 0
  }],
  "containers": [{ "container_id": null, "role": "...", "story_id": "...", "log_path": "" }]
}
```

**Note:** As built in A4.2, the `containers[]` array is initialized to `[]` and `worker_container_id`/`validator_container_id` are initialized to `null`; the per-sandbox container-id capture + log-path recording wiring is owned by A4.3's build-loop integration (§4.7). The dashboard endpoints therefore:
- read `containers[]` directly (may be empty),
- **fall back to synthesizing container entries from each story's `worker_container_id` / `validator_container_id`** so the grid is non-empty once A4.3's wiring populates those fields,
- gracefully return `[]` / 404 when no container data exists.

### 4.2 Endpoint naming — `/stories` vs `/build-state`

The plan §9 criterion says `GET /api/runs/[id]/stories`. The task dispatch names the same endpoint `/build-state` and describes the same payload (the full stories array from build-state.json). This brief implements the endpoint at **`/api/runs/[id]/build-state`** (matching the dispatch + the underlying file name + returning the full build-state.json so the dashboard can read `started_at` / `wall_clock_deadline_ms` / `paused` / `pause_reason` too). The path difference is cosmetic — the plan and the dispatch describe the same data; the dispatch path wins because it is the literal instruction from the orchestrator and the worker builds exactly what the dispatch says.

### 4.3 Trace endpoint — MVP scope

Per the dispatch: "For MVP, this endpoint returns the projected trace events from the run's stage artifacts (build_worker, build_validator spans). It polls/reads the run's trace data and streams it. If no trace data exists, it returns an empty stream." The plan's Phoenix-GraphQL polling (§4.11) is NOT implemented in A4.5 — Phoenix is not guaranteed to be running in the dashboard's environment, and the dispatch explicitly chose the simpler MVP. The SSE endpoint:
- reads `build-state.json` once at connect, then re-reads every 2s,
- emits `story_update` events when a story's status changes,
- emits synthesized `llm-message` / `tool-call` / `stage-event` events from each story's `worker_output` / `validator_output` (when present) + per-story token/cost fields,
- closes when the run reaches a terminal state (the run's `run.json` status is `built`/`shipped`/`escalated`/`*_failed`/`paused_*`).
- emits a `connected` keep-alive event on open and a `done` event on close.

### 4.4 Delete-run during build loop

The delete-run route (`src/dashboard/app/api/runs/[id]/route.ts` DELETE) gains a build-loop check: read `build-state.json`; if any story is `building` or `validating`, return 409 `{ error: "build loop has running containers", status: run.status }` unless `?force=1`. On `?force=1`, the route calls `engine.deleteRun()` (which removes the run dir + workspace + queue rows). Tearing down containers via `docker rm -f` requires shelling out to Docker and is owned by A4.6's `delete-run-mid-loop.test.ts`; A4.5 only adds the 409 gate + the `?force=1` pass-through (the dashboard's engine module does not shell out to Docker — that boundary is enforced by A4.3/A4.6's sandbox-runner). The detail-page delete modal warns when the run is in an active build loop.

### 4.5 Dashboard testing pattern

Tests follow `tests/dashboard-detail.test.ts`: set `REALCODE_DATA_DIR` to a tmp dir, `vi.resetModules()` + dynamic-import the engine, write fixture files, assert. API route logic is thin (delegates to `getEngine()` helpers), so tests cover the engine helpers directly.

### 4.6 Constraints

- All 167 existing tests must still pass (6 e2e tests stay skipped).
- Dashboard = Next.js App Router. API routes = server component route handlers. Interactive UI = `"use client"` components.
- SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.
- Reuse existing `usePoll` hook from `lib/api.ts` for polling build-state (poll every 2s while build is active).
- Do NOT modify `stage-graph.yaml`, `agent-specs/`, `src/engine/`, `src/sandbox/` — dashboard-only story.
- Dashboard reads from `data/runs/` (build-state.json, container logs) — does NOT call the realcode engine.

---

## 5. Build Order

1. `src/dashboard/lib/engine.ts` — add `getBuildState(runId)`, `listContainers(runId)`, `getContainerLogs(runId, cid, tail?)`, `getTraceEvents(runId)`, `hasRunningBuildContainers(runId)` helpers + extend `getRunDetail()` to include `build_state`
2. API: `src/dashboard/app/api/runs/[id]/build-state/route.ts` (GET)
3. API: `src/dashboard/app/api/runs/[id]/containers/route.ts` (GET)
4. API: `src/dashboard/app/api/runs/[id]/containers/[cid]/logs/route.ts` (GET, `?tail=N`)
5. API: `src/dashboard/app/api/runs/[id]/trace/route.ts` (GET, SSE)
6. API: `src/dashboard/app/api/runs/[id]/route.ts` DELETE — add build-loop 409 gate (force pass-through)
7. Component: `src/dashboard/components/StoryProgress.tsx`
8. Component: `src/dashboard/components/ContainerGrid.tsx`
9. Component: `src/dashboard/components/ContainerLogViewer.tsx`
10. Component: `src/dashboard/components/LiveTraceStream.tsx`
11. Page: update `src/dashboard/app/runs/[id]/page.tsx` — add Build Stage Detail section + raw-artifact toggle + delete-modal build-loop warning
12. Docs: `docs/02-planning/ux-design.md` — Component Inventory entries (create file — it does not exist; minimal additive doc)
13. Test: `tests/dashboard-build-state.test.ts` — engine helpers (getBuildState, listContainers, getContainerLogs, getTraceEvents, hasRunningBuildContainers, getRunDetail with build_state)
14. Test: `tests/dashboard-routes.test.ts` — HTTP-level: build-state 404, containers empty, logs 404, trace SSE smoke (initial event + done), delete 409 + force pass-through

---

## 6. Build Order Constraint

Before this story: A4.1 (Contracts), A4.2 (Engine), A4.3 (Sandbox), A4.4 (Agent specs + graph flip) — all `✅ Done` on `issue/4-multi-container-build-loop`.

---

<!-- PLANNER: Fill above sections before dispatch. Leave section 10 blank. -->
<!-- WORKER: Fill section 10 when complete. Do not modify sections 1-9. -->

---

## 10. RESULT

<!-- Worker fills this section. Append below the line — do not delete existing content. -->

**result:** success
**failure_type:** *(omit if success)*
**pr_url:** https://github.com/R3dy/realcode/pull/9
**pr_number:** 9
**branch:** story/A4.5-dashboard-mission-control
**base:** issue/4-multi-container-build-loop
**commits:**
- 4c1715d feat(A4.5): dashboard mission-control UI — StoryProgress, ContainerGrid, LiveTraceStream, ContainerLogViewer + 4 API endpoints (#4)
**test_output:** passed (194 tests + 6 e2e skipped; 18 test files passed | 1 skipped; 19 total. 167 baseline + 27 new = 194. The 6 e2e tests are `describe.skip`'d pre-A4.6 — fixed by A4.6.)
**lint_output:** clean (0 errors; 6 pre-existing warnings — none in A4.5 files: `WorkItem`/`cost_cap_usd`/`TriangleAlert`/`presentArtifacts`/`ChildProcess` + build-loop eslint-disable)
**typecheck:** clean (root `tsc --noEmit` exits 0; dashboard `tsc --noEmit -p src/dashboard/tsconfig.json` exits 0)

**notes for the orchestrator / reviewer:**

1. **Endpoint naming `/build-state` vs plan's `/stories`:** The plan §9 A4.5 criterion names the endpoint `/stories`; the dispatch instructs `/build-state` returning the full build-state.json (so the dashboard can read `started_at` / `wall_clock_deadline_ms` / `paused` / `pause_reason` too). The dispatch path wins (literal orchestrator instruction + returns a superset of the plan's payload). Both describe the same data.

2. **Trace endpoint MVP scope (per dispatch):** The SSE endpoint synthesizes events from `build-state.json` (story status transitions + per-story worker/validator output/token/cost). The plan's Phoenix-GraphQL polling (§4.11) is NOT implemented in A4.5 — Phoenix is not guaranteed to be running in the dashboard environment, and the dispatch explicitly chose the simpler MVP ("returns the projected trace events from the run's stage artifacts … If no trace data exists, it returns an empty stream"). A post-MVP enhancement can swap in Phoenix polling; the SSE shape (`trace_event` / `story_update` / `done`) is forward-compatible.

3. **`containers[]` fallback:** A4.2's build-state.json populates `worker_container_id` / `validator_container_id` per story but leaves the explicit `containers[]` array `[]` (the per-sandbox container-id + log-path wiring is owned by A4.3's build-loop integration). The `/containers` endpoint synthesizes views from the per-story IDs so the grid is non-empty once A4.3 populates them, and gracefully returns `[]` when no container data exists. `/containers/[cid]/logs` resolves `log_path` through the explicit `containers[]` first, then synthesizes a `<story>-<role>-0.log` path from the per-story container IDs as a fallback.

4. **Delete-run 409 ordering:** The build-loop gate is checked BEFORE the active-run gate so the operator gets the specific "build loop has running containers" message rather than the generic "run is active". `?force=1` bypasses both gates. A4.6 owns the actual `docker rm -f` teardown via deterministic container names (`realcode-<run_id>-<story_id>-<role>-<attempt>`) — A4.5 only adds the 409 gate + pass-through; the dashboard engine module does NOT shell out to Docker (that boundary is enforced by A4.3/A4.6's sandbox-runner).

5. **Vitest alias repointed:** `vitest.config.ts` `alias['@']` changed from `/src` to `/src/dashboard` so the new route tests resolve `@/lib/engine` the same way the dashboard's own tsconfig does. Grep-verified no non-dashboard file (tests/ or src/) imports `@/`, so no existing test breaks (the full suite: 194 passed, 6 skipped). The root `tsc --noEmit` excludes `src/dashboard` and uses the root `@/* → ./src/*` path — unaffected.

6. **`docs/02-planning/ux-design.md` created (additive):** The plan §9 A4.5 criterion requires the Component Inventory to gain entries for the 4 new components, but the file did not exist in this repo. Created a minimal additive `ux-design.md` with the full Component Inventory (existing + 4 new components) + the as-built design-token table. No existing planning doc was modified.

7. **Run-detail page regression:** The page still renders correctly for runs that haven't reached the build stage — the Build Stage Detail section is conditional (`stages.build === "running"` OR `artifacts.build` present OR `build_state` present). `dashboard-detail.test.ts` (14 existing tests) passes unchanged; `getRunDetail()` returns `build_state: undefined` when `build-state.json` is absent, so existing destructuring `{ run, stages, artifacts }` is unaffected.

8. **All 4 new components are `"use client"`** (interactive: polling, SSE, scroll, selection). The API routes are server-component route handlers (no `"use client"`). The SSE endpoint sets `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (the latter defeats nginx buffering so the stream flushes live).
