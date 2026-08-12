# realcode — Established Conventions

**Purpose:** The running record of patterns already established in this codebase, so the Planner can brief new stories against what exists instead of re-deriving it from scratch each time, and the Worker can build consistently with prior stories.

**Maintenance rule:** The Worker appends an entry here after a story establishes a pattern that doesn't already have one — a new pattern, not a restatement of an existing entry. Append only; never delete or rewrite another story's entry. Keep entries short and pointer-based, not prose.

**Entry format:**
```
### [Category] — [pattern name]
**Established by:** Story N.N
**Pattern:** [one or two sentences]
**See:** `[file path]` — [what to look at]
```

---

## API Endpoint Structure

*(none established yet)*

## Auth / Authorization Middleware

*(none established yet)*

## Frontend Data Fetching

*(none established yet)*

## Component Structure

*(none established yet)*

## Error Handling

*(none established yet)*

## Testing Pattern

### Testing Pattern — dashboard engine live.json read path
**Established by:** Story A11.2
**Pattern:** Dashboard engine tests that depend on `REALCODE_DATA_DIR` set the env var, `vi.resetModules()`, and re-import `../src/dashboard/lib/engine.js` via an `importEngine()` helper; fixtures write `run.json`, `build-state.json`, and `live.json` into a fresh tmp `DATA_DIR` per test.
**See:** `tests/dashboard-live-state.test.ts` — the `importEngine()` + `makeRun` + `writeJson` fixture helpers.

## Other

### Other — dashboard file-state reader for runtime artifacts (live.json)
**Established by:** Story A11.2
**Pattern:** The dashboard reads engine-written runtime artifacts (build-state.json, live.json) as file-based, realtime observability channels via `getBuildState`/`getLiveState` — identical null-on-missing/corrupt contract (INV-4). Any live/non-build reader that must mirror build behavior follows the same shape.
**See:** `src/dashboard/lib/engine.ts` — `getLiveState` mirrors `getBuildState`; `getContainerLogs` reads `live.json` first, then falls through to `build-state.json`.

## Component Structure

### Component Structure — `runActive` gate + `CurrentActivityBar` live-activity line (A11.3)
**Established by:** Story A11.3
**Pattern:** Live dashboard components that stream/poll per in-flight stage gate their connections on a `runActive` prop (derived on the page as `ACTIVE_STATUSES.has(run.status)`), NOT a build-only flag — `LiveTraceStream` (SSE) and `ContainerLogViewer` (3s poll) both use `runActive`. A slim one-line activity status uses `CurrentActivityBar`: composes only `Card` + `StatusDot` + existing `ink-*`/`status-*` tokens (no new Design DNA token), polls `GET /api/runs/[id]` at 2s via `usePoll`, reads `data?.live_state`, returns `null` when absent, and re-evaluates elapsed time from `live_state.started_at` each poll tick (pure `activityTone`/`fmtElapsed` helpers exported for gating-logic tests).
**See:** `src/dashboard/components/CurrentActivityBar.tsx` — the live-activity line; `LiveTraceStream.tsx` + `ContainerLogViewer.tsx` — the `runActive` gate; `src/dashboard/app/runs/[id]/page.tsx` — `hasLiveActivity = Boolean(live_state)` (terminal runs keep the section) + `runActive={isActive}`.
