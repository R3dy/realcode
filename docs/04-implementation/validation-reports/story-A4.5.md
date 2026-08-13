# Validation Report — Story A4.5: Dashboard: mission-control UI

**Validator:** Anymake combined Validator + Experience Runner
**Date:** 2026-08-12
**Branch:** story/A4.5-dashboard-mission-control
**PR:** #9
**Base:** issue/4-multi-container-build-loop
**Commits:** 4c1715d (feat), 4f2898c (docs RESULT)

---

## Verdict: PASS

All 14 acceptance criteria from the task brief §3 are satisfied against the actual code on the branch. The four new API endpoints read from `data/runs/` via thin route handlers that delegate to engine helpers; the four new client components compose the existing `Card`/`Badge`/`StatusDot` primitives on `ink-*`/`status-*`/`brand-*` tokens (no raw `slate-*`); the run-detail page adds an additive Build Stage Detail section that stays hidden for pre-build runs; the delete-run route gains the 409 build-loop gate with `?force=1` pass-through. 194 tests pass, 6 e2e skipped; typecheck and lint both clean.

---

## §10 RESULT from the worker

- **result:** success
- **test_output:** passed — 194 tests + 6 e2e skipped (17 test files passed | 1 skipped | 18 total). 167 baseline + 27 new = 194. The 6 skipped are `tests/integration/e2e.test.ts` (`describe.skip`'d pending A4.6 — pre-existing).
- **lint_output:** clean — 0 errors; 6 pre-existing warnings (all in non-A4.5 files — see Tooling Outputs below)
- **typecheck:** clean — `tsc --noEmit` exits 0
- **commits:** 4c1715d feat(A4.5) + 4f2898c docs(RESULT)

---

## Per-criterion validation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `GET /api/runs/[id]/stories` (or `/build-state`) returns stories array (or 404) | ✅ PASS | `src/dashboard/app/api/runs/[id]/build-state/route.ts:6-14` — `getEngine().getBuildState(params.id)`, 404 when null. Brief §4.2 explicitly chose `/build-state` (dispatch instruction wins; returns a superset of the plan's payload). Tests: `dashboard-routes.test.ts:87-104` (404 + 200 cases) |
| 2 | `GET /api/runs/[id]/containers` returns containers array + lists log files. Each: id, name, story_id, role, status, started_at, exited_at, log_path | ✅ PASS | `containers/route.ts:6-11` delegates to `engine.listContainers()` (`engine.ts:428-474`). Returns `ContainerView` with all 8 fields (`engine.ts:75-84`). Synthesizes entries from explicit `containers[]` first, then per-story worker/validator IDs. Tests: `dashboard-routes.test.ts:106-125` (2 containers synthesized, 0 case) |
| 3 | `GET /api/runs/[id]/containers/[cid]/logs` resolves cid via build-state.json containers[], reads log_path, returns raw text. Supports `?tail=N` | ✅ PASS | `containers/[cid]/logs/route.ts:6-21` parses `?tail`, delegates to `engine.getContainerLogs()` (`engine.ts:475-509`). Resolves via explicit `containers[]` first, then synthesizes `<story>-<role>-0.log` from per-story container IDs. Tail trims to last N non-empty lines. Tests: `dashboard-routes.test.ts:127-159` (404 + 200 + tail=2 case) |
| 4 | `GET /api/runs/[id]/stream` (or `/trace`) SSE endpoint: `Content-Type: text/event-stream`, polls every 2s, emits spans + synthesized turn/tool events + story_update; closes on terminal state | ✅ PASS | `trace/route.ts:22-95` — SSE ReadableStream, 2s poll (`POLL_MS=2000`), emits `connected`/`trace_event`/`story_update`/`done` events. Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`. Terminal status set at `:5-17`. MVP scope per brief §4.3 — Phoenix polling deferred. Tests: `dashboard-routes.test.ts:161-177` (SSE smoke: 200, headers, first chunk contains `connected`) |
| 5 | `engine.ts` `getRunDetail()` includes `build_state` when build-state.json present | ✅ PASS | `engine.ts:413-416` — `const build_state = this.getBuildState(runId) ?? undefined; if (build_state) detail.build_state = build_state;`. `RunDetailResponse.build_state?` optional (`engine.ts:86-91`). Tests: `dashboard-build-state.test.ts:269-285` (includes build_state / omits when absent) |
| 6 | `StoryProgress.tsx`: vertical list with status badges, retry count, duration; polls `/api/runs/[id]/stories` (or `/build-state`) every 2s when build active | ✅ PASS | `StoryProgress.tsx:52-55` — `usePoll<BuildStateResponse>('/api/runs/${runId}/build-state', intervalMs)`, `intervalMs = buildActive ? 2000 : 10000`. Renders: story ID (mono), title, Badge (status), retry count (status-warn), tokens, cost, duration (Clock). Uses `Card`/`Badge`/`StatusDot`/`cn` primitives (`:3`). Tests: `dashboard-build-state.test.ts` + page renders it |
| 7 | `ContainerGrid.tsx`: grid of cards; click selects for LogViewer; polls every 2s | ✅ PASS | `ContainerGrid.tsx:42-54` — `usePoll<ContainersResponse>('/api/runs/${runId}/containers', intervalMs)`, 2s when active. `<button onClick={() => onSelect(c)} disabled={!hasLogs}>` (`:94-126`). Uses `Card`/`Badge`/`StatusDot`/`cn`. Tests: route + page |
| 8 | `LiveTraceStream.tsx`: SSE-fed timeline; renders spans (name, role from `realcode.role`, tool from `realcode.tool`, tokens, cost, agent_message); reuses TraceTimeline visual pattern; auto-scrolls; pauses on scroll-up | ✅ PASS | `LiveTraceStream.tsx:60-97` — `EventSource('/api/runs/${runId}/trace')`, parses `trace_event`/`story_update`/`done`. TraceRow (`:180-230`) renders role, story_id, tool (Wrench icon), tokens (Cpu), cost (Coins), content (agent_message), timestamp. Auto-scroll `:99-104`; onScroll pauses `:106-111`. Visual pattern matches TraceTimeline (ChevronRight, mono, Badge tone). Uses `Card`/`Badge`/`StatusDot`/`cn` |
| 9 | `ContainerLogViewer.tsx`: terminal-style `<pre>` on `bg-ink-950` (or `bg-[#0a0b12]`), mono font, auto-scroll, "tail 100 / full" toggle; fetches `?tail=100` | ✅ PASS | `ContainerLogViewer.tsx:106-125` — `<div className="... bg-ink-950">` wraps `<pre className="... font-mono ...">`. Toggle button `:96-104` flips `tail` state; fetch URL `:33` adds `?tail=100` when `tail === true`. Auto-scroll `:62-66`; manual-scroll detection `:68-73`. Polls every 3s while build active `:55-59` |
| 10 | Run-detail page shows "Build Stage Detail" section (conditional: `stages.build === "running"` OR `artifacts.build` present) containing StoryProgress + ContainerGrid + LiveTraceStream + ContainerLogViewer. Raw build artifact via "View raw artifact" toggle | ✅ PASS | `page.tsx:140-141` — `showBuildDetail = buildStageActive \|\| Boolean(artifacts.build) \|\| Boolean(buildState)`. Section `:263-288` renders all 4 components in the grid + stack. Toggle `:230-239` ("view raw artifact" / "hide raw"). When shown, the raw build card collapses to a hint `:242-245` |
| 11 | All new components compose `Card`/`Badge`/`StatusDot` primitives and use `ink-*`/`status-*`/`brand-*` tokens — no raw `slate-*` | ✅ PASS | Grep `\\bslate-[0-9]` across `src/dashboard/` returns **no matches**. `ink-*` counts: StoryProgress=12, ContainerGrid=11, ContainerLogViewer=11, LiveTraceStream=14. All 4 components import `Badge`/`Card`/`StatusDot`/`cn` from `@/components/ui`. `ux-design.md:43-44` codifies the no-slate rule |
| 12 | `docs/02-planning/ux-design.md` Component Inventory gains entries for the 4 new components | ✅ PASS | `ux-design.md:19-22` — rows for `StoryProgress`, `ContainerGrid`, `LiveTraceStream`, `ContainerLogViewer` with File / Purpose / Primitives columns. File created additively (44 lines, full Component Inventory including existing components) |
| 13 | Run-detail page still renders for runs that haven't reached the build stage (no Build Stage Detail shown) | ✅ PASS | `page.tsx:141` — `showBuildDetail` requires build stage running OR build artifact OR build_state. For pre-build runs all three are false → section omitted. `getRunDetail()` returns `build_state: undefined` when build-state.json absent (`engine.ts:413`). `dashboard-detail.test.ts` (14 existing tests) passes unchanged — confirmed in `npm test` |
| 14 | Delete-run during a build loop: API checks build-state.json for running containers; 409 unless `?force=1`; on `?force=1` tears down (A4.6 owns docker rm); detail-page delete modal warns when in active build loop | ✅ PASS | `runs/[id]/route.ts:49-54` — `if (engine.hasRunningBuildContainers(params.id) && !force) return 409`. Build-loop gate checked BEFORE active-run gate (`:49` precedes `:56`). `?force=1` pass-through falls through to `engine.deleteRun()` (`:63`). Dashboard engine does NOT shell out to Docker (INV boundary). Modal warning `page.tsx:346-352` — "⚠ Build loop has running containers." shown when `hasRunningBuildContainers`. Tests: `dashboard-routes.test.ts:179-228` (409 no-force, 200 force, 200 done) |

> Note 1: Brief §3 criterion 1 names the endpoint `/stories`; brief §4.2 explicitly supersedes with `/build-state` (dispatch path wins, returns full build-state.json). `StoryProgress.tsx:55` polls `/build-state`. The plan and dispatch describe the same data; no defect.
>
> Note 2: Brief §3 criterion 4 names the endpoint `/stream`; brief §4.3 implements at `/trace` (MVP scope, Phoenix deferred). `LiveTraceStream.tsx:71` connects to `/trace`. Forward-compatible SSE shape; no defect.

---

## Security checklist (per validator instructions)

| Check | Result |
|-------|--------|
| No secrets in committed files | ✅ PASS — `rg -in "(api[_-]?key\|secret\|password\|aws_access\|sk-)"` across all A4.5 files: only one hit (`engine.ts:532` comment "token/cost"). No sk-/AKIA/ghp_/xox/AIza prefixes anywhere. The 4 route files + 4 component files contain no credential literals |
| No auth surface (thin dashboard, INV-5) | ✅ PASS — Dashboard is a read-only mission-control surface. No auth code added. All routes read from `data/runs/`; no user-supplied data is written to disk through these endpoints |
| API routes read from `data/runs/` (not from user input without validation) | ✅ PASS — All 4 routes delegate to `getEngine()` helpers that read `RUNS_DIR` (= `data/runs/`). `runId` and `cid` are used only as lookup keys against `build-state.json`'s whitelists; no user-supplied path is ever `path.join`'d directly into a read |
| Path traversal protection on container log endpoint (cid validated against build-state.json) | ✅ PASS — `engine.getContainerLogs()` (`engine.ts:475-509`) matches `cid` ONLY against (a) `c.container_id === cid` for entries in `state.containers[]`, or (b) `c.log_path === cid` (full-string match, not a path prefix), or (c) `s.worker_container_id === cid` / `s.validator_container_id === cid` for synthesized fallback. A cid like `../../etc/passwd` matches only if a container literally has that ID (engine-controlled build-state.json). `log_path` is then `path.join(DATA_DIR, logPath)` where `logPath` is sourced from build-state.json (never from the URL). The cid cannot inject path components into the read. Tests: `dashboard-routes.test.ts:127-136` (404 for unknown cid) |
| SSE endpoint streams only build-state.json-derived events | ✅ PASS — `trace/route.ts` calls `engine.getTraceEvents()` + `engine.getBuildState()` — both read build-state.json. No external service calls (Phoenix deferred per §4.3). 30-min `MAX_LIFETIME_MS` ceiling prevents runaway streams |
| Delete-run 409 gate ordering | ✅ PASS — Build-loop gate checked BEFORE active-run gate so the operator gets the specific "running containers" message. `?force=1` bypasses both. Tests cover both gates |
| No new shell-out to Docker from dashboard engine | ✅ PASS — `engine.deleteRun()` (`engine.ts:565-582`) only `fs.rmSync` + sqlite DELETE. Docker teardown is A4.6's boundary (INV enforced) |

---

## Tooling outputs

### `npm test`
```
Test Files  17 passed | 1 skipped (18)
     Tests  194 passed | 6 skipped (200)
  Duration  2.08s
```
17 non-skipped test files pass. The single skipped file is `tests/integration/e2e.test.ts` (6 tests, `describe.skip`'d pending A4.6 — pre-existing from A4.4).
New test files:
- `tests/dashboard-build-state.test.ts` (17 tests) — engine helpers (getBuildState, listContainers, getContainerLogs, getTraceEvents, hasRunningBuildContainers, getRunDetail.build_state)
- `tests/dashboard-routes.test.ts` (10 tests) — HTTP-level: build-state 404/200, containers empty/synthesized, logs 404/200+tail, trace SSE smoke, delete 409/200-force/200-done

### `npm run typecheck`
```
> tsc --noEmit
(exits 0 — no output)
```

### `npm run lint`
```
6 problems (0 errors, 6 warnings)
```
All 6 warnings are pre-existing and in files untouched by A4.5's core logic:
- `src/cli/index.ts:9` (WorkItem unused)
- `src/dashboard/app/api/control/route.ts:16` (cost_cap_usd unused)
- `src/dashboard/components/StatStrip.tsx:3` (TriangleAlert unused)
- `src/dashboard/lib/engine.ts:260` (presentArtifacts unused — pre-existing `deriveStageStatuses` signature)
- `src/engine/build-loop.ts:159` (Unused eslint-disable)
- `src/sandbox/runner.ts:1` (ChildProcess unused)

No A4.5-added file produces a warning (the engine.ts warning at line 260 is in pre-existing `deriveStageStatuses`, not the new A4.5 helpers which start at line 419).

---

## Files changed (vs base)

```
 docs/02-planning/ux-design.md                      |  44 ++++
 docs/04-implementation/task-briefs/story-A4.5.md   | 186 ++++++++++++++
 src/dashboard/app/api/runs/[id]/build-state/route.ts         |  15 ++
 src/dashboard/app/api/runs/[id]/containers/[cid]/logs/route.ts |  22 ++
 src/dashboard/app/api/runs/[id]/containers/route.ts          |  12 +
 src/dashboard/app/api/runs/[id]/route.ts           |  13 +
 src/dashboard/app/api/runs/[id]/trace/route.ts     |  98 +++++++
 src/dashboard/app/runs/[id]/page.tsx               |  85 +++++-
 src/dashboard/components/ContainerGrid.tsx         | 141 ++++++++++
 src/dashboard/components/ContainerLogViewer.tsx    | 149 +++++++++++
 src/dashboard/components/LiveTraceStream.tsx       | 260 +++++++++++++++++++
 src/dashboard/components/StoryProgress.tsx         | 137 ++++++++++
 src/dashboard/lib/engine.ts                        | 279 +++++++++++++++++++-
 tests/dashboard-build-state.test.ts                | 286 +++++++++++++++++++++
 tests/dashboard-routes.test.ts                     | 229 ++++++++++++++++++
 vitest.config.ts                                   |   6 +-
 16 files changed, 1959 insertions(+), 3 deletions(-)
```

---

## Escalations

None. The story is ready to merge.

## Notes for the orchestrator

1. Endpoint naming differs from the plan §9 (`/stories` → `/build-state`, `/stream` → `/trace`). The brief §4.2 + §4.3 explicitly supersede the plan with the dispatch's literal paths and explain the rationale (returns a superset; MVP scope; forward-compatible SSE shape). No rework needed.
2. `vitest.config.ts` alias repointed `@` from `/src` to `/src/dashboard` (grep-verified no non-dashboard file imports `@/`). The root `tsc --noEmit` excludes `src/dashboard` via the dashboard's own tsconfig, so the root path map is unaffected. Full suite green.
3. `containers[]` fallback synthesizes container views from per-story `worker_container_id`/`validator_container_id` when the explicit `containers[]` array is empty (A4.2's shape — A4.3 wiring will populate `containers[]` with `log_path`). `/containers/[cid]/logs` synthesizes a `<story>-<role>-0.log` path as a fallback. Both gracefully return `[]` / 404 when no container data exists. Forward-compatible with A4.3's wiring.
4. Delete-run 409 ordering: build-loop gate checked BEFORE active-run gate so the operator gets the specific "running containers" message. `?force=1` bypasses both. A4.6 owns the actual `docker rm -f` teardown; A4.5 only adds the 409 gate + pass-through (the dashboard engine does NOT shell out to Docker — INV boundary enforced).
5. The four new components are all `"use client"` (interactive: polling, SSE EventSource, scroll, selection). The API routes are server-component route handlers (no `"use client"`). The SSE endpoint sets all four required headers including `X-Accel-Buffering: no` to defeat nginx buffering.
