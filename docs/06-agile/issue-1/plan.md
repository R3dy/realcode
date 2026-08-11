# Development Plan — Issue #1: Run detail route unbuilt + no way to clear stale failed runs

**Author:** Anymake Solution Architect
**Project:** realcode — `project_type: agentic-harness`
**Issue:** https://github.com/R3dy/realcode/issues/1 — `type:bug`
**Code state analyzed:** c8037f4 (master HEAD)
**Status:** In Review (round 2)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-1/plan.md`

---

## 1. Problem Statement

Every `RunCard` on the realcode dashboard board links to `/runs/[run.id]`, but `src/dashboard/app/runs/[id]/` is an empty directory — no `page.tsx` was ever created. Clicking any run 404s / crashes the dashboard. On top of that, 9 failed runs from earlier sessions (15–16) sit alongside the one shipped run in `data/runs/`, and there is no UI affordance to clear them. The board is cluttered with dead runs the user cannot remove. Both defects are confirmed by reporter Royce and traced to the same code area (the run detail surface). The issue is the requirement; this plan is the solution.

---

## 2. Root Cause / Motivation

**Root cause (bug #1 — 404 on run click):**

- [`src/dashboard/components/RunCard.tsx:17`] — `<Link href={\`/runs/${run.id}\`}>` renders a navigation link on every run card. The href targets a route that has no page component.
- [`src/dashboard/app/runs/[id]/`] — directory exists but is EMPTY. No `page.tsx`. This is a Phase 4 build gap: the route was planned in the UX design (Screen 2) and the link was wired in `RunCard`, but the page component itself was never authored. Next.js has no file to resolve the dynamic segment to, so navigation yields a 404 / dev-crash.
- Trace: user clicks run card → `RunCard` `<Link>` navigates to `/runs/run_xxx` → Next.js app router looks for `app/runs/[id]/page.tsx` → none exists → 404 / crash.

**Root cause (bug #2 — stale failed runs unremovable):**

- [`src/dashboard/app/api/runs/route.ts`] — exposes `GET` (list) and `POST` (create) only. There is no `DELETE` handler, and no per-run `GET` handler either (needed for the detail page).
- [`src/dashboard/lib/engine.ts`] — `listRuns`, `getRun`, `createRun`, `getControlDoc`, `setControlDoc` exist; there is no `deleteRun(runId)`. The engine has no filesystem + DB cleanup path for a run.
- Net effect: failed runs accumulate in `data/runs/` with no way to remove them from the UI. INV-6 (deletion must clean up work_items + workspace) is an unimplemented invariant — this plan implements it.

**Motivation:** realcode's success model (per the agentic-harness manifest) is "a real end-to-end run ships a working increment." The dashboard is the thin observability surface that proves that. A board that crashes on every run click and fills with dead runs fails that observability contract. Fixing both restores the dashboard to its stated purpose (ADR-003, INV-5).

---

## 3. Current-State Review

What the affected part of the system looks like today, from `docs/SYSTEM_MAP.md` plus direct reading:

| Touched | Details |
|---------|---------|
| Modules | `dashboard/app/runs/[id]` (empty, to be created); `dashboard/app/api/runs/[id]` (new route); `dashboard/lib/engine.ts` (add `deleteRun`, `deriveStageStatuses`, `getRunDetail`, `RunDetailResponse`/`DetailStageStatus` types); `dashboard/lib/api.ts` (add single-run fetch + re-export detail types); `dashboard/components/*` (reuse Badge, Card, StageStepper, Button, Skeleton; inline-replicate NewRunDialog modal pattern; local EmptyState). `backend/` queue layer (DELETE must clean work_items). |
| Data model | `RunRecord` (run.json) unchanged. `work_items` (queue.db) — rows for the run must be deleted on DELETE. `data/runs/<id>/` directory + `data/workspaces/<id>/` directory — removed on DELETE. **No schema changes.** |
| Flows | (1) Click run card → detail page (new). (2) Delete run from detail → engine.deleteRun → redirect to board (new). Board `/` poll flow unchanged. |
| Integrations | none in the new path. Engine reads/writes the local filesystem (`data/`) and SQLite (`queue.db`). No third-party services in scope. |

**Intent-layer freshness:** SYSTEM_MAP last mapped 2026-08-11 (c8037f4) — current; refreshed by the Cartographer for this issue. DECISIONS.md and INVARIANTS.md updated the same date.

---

## 4. Solution Design

The chosen approach: build the missing detail page + a per-run API route, add a DELETE path through the engine, and wire a destructive delete affordance on the detail page. The full streaming `TraceTimeline` from the UX design is explicitly out of scope (see §5 — rejected for scope); this plan delivers a useful, non-crashing detail view plus delete, which is the minimum to close the issue.

### 4.1 New API route — `src/dashboard/app/api/runs/[id]/route.ts`

**Does not exist.** Create it with two handlers:

**`GET /api/runs/[id]`** →
- Calls `engine.getRun(runId)` (server-side, reads `data/runs/<id>/run.json`). Do NOT use `lib/data.ts` `getRun()` — that returns mock data (INV-3, ADR-004).
- If `run.json` is missing → `404` with body `{ error: "run not found" }`.
- If found → `200` with body:
  ```ts
  {
    run: RunRecord,                  // from run.json
    stages: {
      frame:    DetailStageStatus,    // "pass" | "fail" | "running" | "pending" | "not-reached"
      discover: DetailStageStatus,
      plan:     DetailStageStatus,
      spec:     DetailStageStatus,
      build:    DetailStageStatus,
      ship:     DetailStageStatus,
    },
    artifacts: {
      frame?:    unknown,             // parsed JSON of frame.json if present, else omitted
      discover?: unknown,
      plan?:     unknown,
      spec?:     unknown,
      build?:    unknown,
      ship?:     unknown,
    }
  }
  ```
- Stage status derivation: for each stage in `STAGE_ORDER = ["frame","discover","plan","spec","build","ship"]`, check whether `<stage>.json` exists in the run dir. If the artifact exists → `"pass"` (or `"fail"` if the run's top-level status is `<stage>_failed`, in which case the artifact may be absent — see below). If the run status is `<stage>_failed` and the artifact is missing → `"fail"`. If the run status is past this stage and the artifact is missing (shouldn't happen on a healthy run) → `"fail"`. If the run status is before this stage → `"not-reached"`. If the run status equals this stage being in-flight (`framed` means frame passed and discover running, etc.) → `"running"` for the in-flight stage, `"pass"` for completed, `"not-reached"` for later. Keep the mapping logic in a single helper `deriveStageStatuses(run, presentArtifacts)` in `lib/engine.ts` so it is testable.
- Artifacts: read each present `<stage>.json` and include the parsed object. Missing artifacts are simply omitted from the `artifacts` map (INV-4 — failed runs have only run.json + earlier artifacts).

**`DELETE /api/runs/[id]`** →
- 404 if `run.json` is missing.
- **The route owns the active-run gate.** If the run's status is `running`, `intake`, or any in-flight/active state, return `409 Conflict` with body `{ error: "run is active", status }` UNLESS the request includes `?force=1`. The detail page confirmation dialog will warn the user for active runs and pass `force=1` when they confirm anyway (INV-6). The gate is enforced here, in the route, before `deleteRun` is called — `deleteRun` itself is unconditional.
- After the gate passes (run not active, or `?force=1` present), call `engine.deleteRun(runId)` (new — see §4.3). `deleteRun` does NOT take a `force` parameter and does NOT re-check status.
- Return `200` with body `{ deleted: runId }`.

### 4.2 New page — `src/dashboard/app/runs/[id]/page.tsx`

**Does not exist (empty directory).** Create a client component (`"use client"`):

- On mount, `fetch("/api/runs/${id}")`.
- **Loading state:** `Skeleton` rows (reuse existing Skeleton component).
- **Not-found state (404):** a local `EmptyState` (re-implemented inside `runs/[id]/page.tsx`, mirroring `app/page.tsx:132`) with message `"Run ${id} doesn't exist."` + a `Button` "Back to runs" linking to `/`. (Matches the Screen 2 spec in ux-design.md.)
- **Found state:**
  - **Header card** (`Card`): run id in `JetBrains Mono`, idea as the title, `Badge` for status (reuse existing status→color mapping from `mapRunRecord` in `lib/api.ts`), `StageStepper` with the current stage glowing, cost meter (`$${spent_usd}` / `$${cap_usd}` with a progress bar — violet fill, red when ≥ cap), `created_at` timestamp in mono. Design DNA: `bg-[#11131d]` card surface, `rounded-xl`, brand violet `#7c5cff` accents.
  - **Stage list:** for each of the 6 stages in `STAGE_ORDER`, a `Card` showing:
    - Stage name (display case), status badge (pass=#3fd68a, fail=#f06161, running=#f0b440 with live-pulse, pending=#7c8cb0, not-reached=#7c8cb0 muted).
    - If `artifacts[stage]` present: pretty-print the artifact JSON in a `<pre>` block with `JetBrains Mono`, scrollable, `max-h-[400px]`, `overflow-auto`, dark surface `bg-[#0a0b12]`. (No key-field extraction in this scope — full pretty-printed JSON is the readable format. Extracting "key fields" is a future enhancement once the schemas stabilize.)
    - If absent (status `not-reached` or `fail` with no artifact): muted block `"Not reached."` or `"Failed — no artifact written."` per status.
  - **Delete button:** destructive `Button` variant ("Delete run") in the header card's right corner. On click, open a **confirmation modal inline-replicating `NewRunDialog`'s pattern** (`AnimatePresence` + `motion.div`, backdrop, `role="dialog"`, `aria-modal="true"`, Escape-to-close) confirming:
    - Message: `"Delete run ${id}? This removes its data directory, workspace, and any queued work items. This cannot be undone."`
    - If the run status is active (`running`/`intake`/in-flight), add a warning line in the dialog: `"⚠ This run is still active. Deleting it will not stop the engine from processing it. Consider pausing first."` (INV-6.)
    - Confirm → `DELETE /api/runs/${id}` (+ `?force=1` if active) → on 200, redirect to `/` via `router.push("/")`. On 409, show the warning dialog state again. On other errors, toast with the error message.
  - **Back to runs link:** in the header card, a `Button` variant="ghost" with a `ChevronLeft` Lucide icon, linking to `/`.

### 4.3 Engine — `src/dashboard/lib/engine.ts`

Add `deleteRun(runId: string): Promise<void>` — **unconditional; the caller (API route) is responsible for the active-run gate.** Throws only `RunNotFoundError` for a missing run. Steps:
1. Resolve the run dir = `data/runs/<runId>/`. If it does not exist, throw `RunNotFoundError`.
2. Remove the run directory recursively (`fs.rm(dir, { recursive: true, force: true })`).
3. Remove `data/workspaces/<runId>/` if it exists (same recursive remove, guarded by exists check). (INV-6 — workspace cleanup.)
4. Delete all `work_items` rows from `queue.db` where `run_id = runId` (`DELETE FROM work_items WHERE run_id = ?`). (INV-6 — work_items cleanup.)

Note: the active-run 409 gate (INV-6 confirmation) lives in the DELETE API route (§4.1), NOT in `deleteRun`. `deleteRun` does not take a `force` parameter and does not throw `RunActiveError`.

Add `deriveStageStatuses(run, presentArtifacts): Record<StageName, DetailStageStatus>` helper (returns the detail-page status vocabulary, including `"not-reached"`), exported for testing (see §4.1). `StageName` is imported from `./data`; `DetailStageStatus` is defined in `engine.ts` per §4.4.

Add `getRunDetail(runId): RunDetailResponse | null` that assembles the full response object (run + stages + artifacts) by reading the dir. Used by the API route.

### 4.4 Client API — `src/dashboard/lib/api.ts`

Types are defined **server-side** (in `lib/engine.ts` — see §4.3) and re-exported/imported by `lib/api.ts` for client use. Do NOT redefine `StageName`/`StageStatus` here — `lib/api.ts` already imports them from `./data`.

**In `lib/engine.ts` (server) — define:**
- `export type DetailStageStatus = StageStatus | "not-reached";` — the detail page's stage-status vocabulary. Distinct from `data.ts`'s `StageStatus` (which is `"pass" | "running" | "fail" | "pause" | "pending"`) so the board's existing `deriveStages` mapping is untouched. The detail page adds `"not-reached"` for stages the run hasn't advanced to yet.
- `export interface RunDetailResponse { run: RunRecord; stages: Record<StageName, DetailStageStatus>; artifacts: Partial<Record<StageName, unknown>>; }`
- `StageName` is NOT redefined — import it from `./data` (the six stage names are identical). `RunRecord` likewise from `./data`.

**In `lib/api.ts` (client) — add only:**
- `import type { RunDetailResponse, DetailStageStatus } from "./engine";` (and re-export if convenient: `export type { RunDetailResponse, DetailStageStatus } from "./engine";`).
- `export async function fetchRunDetail(id: string): Promise<RunDetailResponse | null>` — `fetch("/api/runs/${id}")`, return `null` on 404, throw on other non-2xx.
- (Optional) a `useRun(id)` hook is not required — a plain `useEffect` + `fetchRunDetail` in the page is enough. Keep `lib/api.ts` additions to the re-export + the fetch function.

**Direction:** `engine.ts` owns `RunDetailResponse` + `DetailStageStatus`; `api.ts` imports them. The server-side `engine.getRunDetail` returns `RunDetailResponse` without crossing the client/server boundary backwards.

### 4.5 No changes to

- `RunCard.tsx` — the existing `<Link href={\`/runs/${run.id}\`}>` is correct; the destination now exists. Do not change the card.
- `lib/data.ts` — leave as-is. The mock data stays for type definitions only (ADR-004). Do NOT import `getRun` from it in the new page.
- Board page (`app/page.tsx`), poll hook, control doc, stats route — untouched.

---

## 5. Alternatives Considered

| Option | Why not chosen |
|--------|----------------|
| **Use `getRun()` from `lib/data.ts` (mock data) for the detail page** | Violates INV-3 / ADR-004. The mock `runs` array does not contain the real run the user clicked — it would show fake data for a real run id, or 404 the real id. The detail page must read real `run.json` + stage artifacts from `data/runs/` via the live API. |
| **Build the full streaming `TraceTimeline` with turn-level spans and tool-call leaves (the complete Screen 2 spec)** | Scope. The issue is a crash + clutter bug fix. The TraceTimeline is a complex component (nested agent turns, tool calls, live token streaming, latency bars) — building it now would balloon the fix and risk shipping nothing. The minimum to close the issue is: detail page renders useful info (header + per-stage artifact viewer), no crash, and delete works. TraceTimeline is logged to PARKING_LOT as a future enhancement. |
| **Add a delete button on each `RunCard` on the board (card-level delete) instead of the detail page** | Rejected as primary. A destructive action is safer on the detail page where the user sees exactly what they're deleting (full run + artifacts). Card-level delete is a reasonable future convenience but shouldn't be the only path. Logged to PARKING_LOT. |
| **Skip the `force`/409 active-run guard and just let DELETE always succeed** | Violates INV-6's spirit ("should not be deletable without confirmation"). The 409 + confirm-with-warning flow is the explicit confirmation. Removing the guard would let a stray click delete a running run silently. |

---

## 6. Intent Constraints

Classification against the intent layer (`docs/DECISIONS.md`, `docs/INVARIANTS.md`) per the Intent Conflict Policy (`AGENTS/arbiter.md`):

**Classification:** Additive

- **ADR-001 (headless opencode-in-sandbox):** not touched. No change to agent invocation.
- **ADR-002 (stage graph is declarative YAML):** not touched. `STAGE_ORDER` in the page is a display constant, not a stage-graph change. The engine still reads `stage-graph.yaml` for transitions.
- **ADR-003 (dashboard is thin control/observability only):** respected — the new detail page is the third screen already specified by this ADR (board / detail / settings). No new screens, no auth, no billing.
- **ADR-004 (real data, no mock placeholders):** respected — the detail page uses `engine.getRunDetail` → real `run.json` + artifacts. The mock `getRun()` in `lib/data.ts` is explicitly NOT imported by the new page.
- **ADR-005 (Phoenix tracing via OTLP/proto):** not touched.

- **INV-1 (stage graph declarative):** not touched.
- **INV-2 (stage artifacts JSON-Schema-validated):** not touched — the page only reads artifacts, does not write them.
- **INV-3 (dashboard uses real data, not mock):** preserved — see ADR-004 above.
- **INV-4 (failed runs may have only run.json):** preserved — the stage list renders "not reached"/"failed" for missing artifacts. The artifact viewer checks presence before rendering.
- **INV-5 (dashboard is thin):** preserved — no new screens, dark dev-observability aesthetic per the Design DNA.
- **INV-6 (deletion cleans up work_items + workspace, active runs need confirmation):** enforced — `deleteRun` removes run dir + workspace dir + deletes work_items rows; the 409 + force flow provides the confirmation gate for active runs.

**No Contradicting items.** No conflict gate required.

---

## 7. Design Consistency

New UI must look like it was designed with the product from day one. Reference `docs/02-planning/ux-design.md` (Design DNA + component inventory):

| Question | Answer |
|----------|--------|
| Existing components reused | `Button` (incl. destructive + ghost variants), `Badge` (status→color), `Card`, `StageStepper`, `Skeleton` (loading) — all from `components/ui.tsx`. **No `Dialog`, `EmptyState`, or `Tooltip` primitive exists in the codebase** (verified: `NewRunDialog.tsx` is a one-off inline modal; `EmptyState` is a local non-exported function in `app/page.tsx:132`; `Tooltip` has zero matches in `src/dashboard/`). |
| Patterns inline-replicated | **Delete confirmation modal:** the detail page replicates `NewRunDialog`'s inline `AnimatePresence` + `motion.div` modal treatment (backdrop, `role="dialog"`, `aria-modal="true"`, Escape-to-close, destructive `Button` variant) directly inside `runs/[id]/page.tsx`. This is an established visual pattern in the app (NewRunDialog already uses it), not a new design-system component — no `ux-design.md` update required for an in-app replication of an existing pattern. No generic `<Dialog>` primitive is extracted in this issue (extraction is logged to PARKING_LOT). |
| Local (page-scoped) components | **`EmptyState`:** re-implemented as a local function inside `runs/[id]/page.tsx` (mirrors the `app/page.tsx:132` treatment: muted icon + message + optional action). Not extracted to `ui.tsx` in this issue (extraction logged to PARKING_LOT). **`StageArtifactCard`:** a small subcomponent co-located in `page.tsx` (or a sibling file) rendering each stage row — composed entirely of existing `Card` + `Badge` + `<pre>` primitives, not a new design-system component. |
| Dropped from original plan | **`Tooltip`** for the cost meter — dropped. Use a native `title` attribute on the cost meter element instead (no new component, no design-system change). |
| New components introduced | none at the design-system level. The detail page composes existing primitives + replicates the existing NewRunDialog modal pattern inline. |
| Design DNA mapping | Surfaces: header card `bg-[#11131d]`, stage cards `bg-[#11131d]`, artifact `<pre>` `bg-[#0a0b12]`. Accent: brand violet `#7c5cff` for the cost meter fill (under cap), `#f06161` red when `spent >= cap`. Status colors: pass `#3fd68a`, running `#f0b440` (+ live-pulse Framer Motion), fail `#f06161`, pending/not-reached `#7c8cb0`. Typography: run id + timestamps + artifact JSON in `JetBrains Mono`; idea title in `Inter` (or `Bricolage Grotesque` if it's a heading — match the board's RunCard title treatment for consistency). Spacing/shape: `rounded-xl` (12px) on all cards, consistent with board. Motion: 200ms ease-out on status badge pulse and dialog enter (Framer Motion), consistent with the existing dashboard motion budget and `NewRunDialog`. |
| New visual patterns | none. The cost-meter-as-progress-bar already exists in the design (Screen 2 right rail cost meter); the artifact `<pre>` viewer is a standard code block treatment; the confirmation modal replicates `NewRunDialog`'s established pattern. No `ux-design.md` update required for this plan. |

Rule check: no new visual pattern ships without a `ux-design.md` update. This plan introduces no new patterns (the confirmation modal is an inline replication of NewRunDialog's existing pattern) → no update needed. Component extractions (`Dialog`, `EmptyState` to `ui.tsx`) are logged to PARKING_LOT, not done in this issue.

---

## 8. Blast Radius & Regression Risk

What else could break, and how we know it won't:

| At risk | Why it's in the blast radius | Protection |
|---------|------------------------------|------------|
| Board (`/`) poll + RunCard links | RunCard links to `/runs/[id]`; before this fix it 404s, after it resolves. The link itself is unchanged. | Existing board test (`app/page.test.tsx` if present, or the Experience Script board-drive) must still pass. New page test asserts the route resolves. |
| `engine.ts` existing methods (`listRuns`, `getRun`, `createRun`) | `deleteRun` is a new method; `deriveStageStatuses` + `getRunDetail` are new. No existing method signature changes. | Add unit tests for `deleteRun` (does not affect list/get) + `deriveStageStatuses` (pure function). Run the existing engine test suite. |
| `queue.db` integrity | DELETE removes rows for one run_id only; parameterized query. | Regression test: DELETE a run with work_items, assert other runs' work_items untouched. |
| `data/workspaces/` | DELETE removes only the matching `<runId>` workspace dir. | Regression test: DELETE run A, assert run B's workspace still present. |
| `lib/api.ts` existing exports | New types/functions are additive; no existing export renamed/removed. | Typecheck (`tsc --noEmit`) + existing board compile must pass. |
| Active-run accidental delete | A running run could be deleted, leaving the engine processing a ghost. | 409 + force gate (INV-6). The detail page dialog warns for active runs. |

**Migrations:** none. Filesystem + SQLite only, no schema changes. `deleteRun` removes a directory and deletes rows from an existing table — no DDL.

---

## 9. Story Breakdown

The stories that implement this plan, in build order. Each becomes a task brief (`TEMPLATES/task-brief.md`) with §6a Intent Constraints filled from §6 above and design-consistency criteria from §7.

### Story A1.1 — Build the run detail page + GET /api/runs/[id] API route

**As a** realcode operator **I want** to click a run on the board and see a detail page with the run's header, stage statuses, and per-stage artifacts **so that** navigating to `/runs/[id]` shows useful information instead of 404ing.

**Acceptance criteria:**
- [ ] `GET /api/runs/[id]` returns `200` + the full `RunDetailResponse` (run + stages + artifacts) for an existing run id.
- [ ] `GET /api/runs/[id]` returns `404` with `{ error: "run not found" }` for a non-existent run id.
- [ ] `GET /api/runs/[id]` reads real `run.json` + stage artifacts from `data/runs/<id>/` via `engine.getRunDetail` — it does NOT import `getRun` from `lib/data.ts` (INV-3).
- [ ] `deriveStageStatuses` correctly returns `pass`/`fail`/`running`/`pending`/`not-reached` for each of the 6 stages, for: a shipped run (all pass), a failed run (early stages pass, failure stage = fail, later = not-reached), an in-flight run (current stage = running).
- [ ] `/runs/[id]` page renders the run header (id in mono, idea, status badge, StageStepper, cost meter, created_at) for a found run.
- [ ] `/runs/[id]` page renders a stage card for each of the 6 stages, showing the status badge and (if present) the pretty-printed artifact JSON, or "Not reached."/"Failed — no artifact written." for missing artifacts (INV-4).
- [ ] `/runs/[id]` page renders the not-found state (local `EmptyState` re-implemented in the page) ("Run run_xxx doesn't exist." + "Back to runs" button) for a non-existent run id.
- [ ] `/runs/[id]` page renders a "Back to runs" ghost button linking to `/`.
- [ ] The original repro from issue #1 no longer reproduces: click any `RunCard` on the board → the `/runs/[id]` page renders (header + stages) instead of 404 / crash.
- [ ] UI uses existing `Card`, `Badge`, `StageStepper`, `Button`, `Skeleton` components, a local `EmptyState`, and Design DNA tokens (dark slate surfaces, brand violet, JetBrains Mono for ids) per §7. No non-existent primitives (`Dialog`/`Tooltip`) are referenced.
- [ ] Typecheck (`tsc --noEmit`) passes; existing board tests still pass.

**Experience Script:** (new-flow walkthrough, `TEMPLATES/experience-script.md` format)
```
1. Open http://localhost:3000/ (board) — assert the runs list renders.
2. Click the shipped run card — assert navigation to /runs/<shipped_run_id>.
3. Assert the detail page header shows: run id (mono), idea text, a "shipped" status badge (green #3fd68a), StageStepper with all 6 stages in pass state, cost meter showing $X.XX / $8.00, created_at timestamp.
4. Assert 6 stage cards render, each with a "pass" badge and a pretty-printed JSON artifact block.
5. Click "Back to runs" — assert navigation back to / and the board renders.
6. Navigate to /runs/run_does_not_exist — assert the not-found EmptyState renders: "Run run_does_not_exist doesn't exist." + a "Back to runs" button.
7. Click "Back to runs" — assert navigation to /.
8. Click a failed run card — assert the detail page renders with early stages "pass" and the failure stage "fail" (no artifact block, "Failed — no artifact written.") and later stages "not reached".
```

### Story A1.2 — Add DELETE /api/runs/[id] + delete affordance on the detail page

**As a** realcode operator **I want** to delete a stale failed run from its detail page **so that** the board is not cluttered with dead runs I cannot remove.

**Acceptance criteria:**
- [ ] `DELETE /api/runs/[id]` returns `200` + `{ deleted: runId }` for an existing, non-active run.
- [ ] `DELETE /api/runs/[id]` returns `404` for a non-existent run id.
- [ ] `DELETE /api/runs/[id]` returns `409` + `{ error: "run is active", status }` for a run whose status is active (`running`/`intake`/in-flight) WITHOUT `?force=1`.
- [ ] `DELETE /api/runs/[id]?force=1` succeeds (200) for an active run.
- [ ] `engine.deleteRun(runId)` removes `data/runs/<id>/`, removes `data/workspaces/<id>/` if present, and deletes all `work_items` rows for `run_id = runId` from `queue.db` (INV-6).
- [ ] After a successful DELETE, `GET /api/runs/[id]` returns `404`.
- [ ] After deleting run A, `GET /api/runs` still lists run B (other runs unaffected — regression check on the delete query scoping).
- [ ] The detail page renders a destructive "Delete run" button.
- [ ] Clicking "Delete run" opens a confirmation modal (inline-replicating `NewRunDialog`'s `AnimatePresence` + `motion.div` pattern: backdrop, `role="dialog"`, `aria-modal="true"`, Escape-to-close) with the message: "Delete run <id>? This removes its data directory, workspace, and any queued work items. This cannot be undone."
- [ ] If the run status is active, the dialog shows the warning: "⚠ This run is still active. Deleting it will not stop the engine from processing it. Consider pausing first."
- [ ] Confirming the dialog calls `DELETE /api/runs/<id>` (with `?force=1` if active) and on 200 redirects to `/` (board).
- [ ] On 409, the dialog re-shows the warning (user can retry or cancel).
- [ ] On other errors, a toast displays the error message.
- [ ] The original repro from issue #1 (part 2) no longer reproduces: a stale failed run can be removed from the UI via its detail page → after delete, the board no longer shows that run.
- [ ] UI uses existing `Button` (destructive) + `Card`, the inline-replicated `NewRunDialog` modal pattern (not a `Dialog` primitive — none exists), and Design DNA per §7.
- [ ] Typecheck passes; existing board + new detail page tests still pass.

**Experience Script:**
```
1. Open http://localhost:3000/ (board) — assert the failed runs are present.
2. Click a failed run card — assert the detail page renders.
3. Click "Delete run" — assert the confirmation modal opens (inline-replicated NewRunDialog pattern) with the deletion message.
4. (For this failed run, status is not active — assert NO active-run warning is shown.)
5. Click "Confirm" — assert the DELETE request fires and the browser redirects to /.
6. Assert the board re-renders and the deleted run is NO LONGER in the runs list.
7. Navigate directly to /runs/<deleted_run_id> — assert the not-found EmptyState renders.
8. (Regression) Click a different (still-existing) run — assert its detail page still renders normally.
```

---

## 10. Test & Verification Plan

- **Automated:**
  - `src/dashboard/app/api/runs/[id]/route.test.ts` — `GET returns 200 + RunDetailResponse for existing run`; `GET returns 404 for non-existent run`; `DELETE returns 200 + { deleted } for non-active run`; `DELETE returns 409 for active run without force`; `DELETE returns 200 for active run with force=1`; `DELETE returns 404 for non-existent run`; `DELETE cleans work_items rows for that run_id only` (regression: insert rows for two runs, delete one, assert the other's rows remain).
  - `src/dashboard/lib/engine.test.ts` (extend) — `deleteRun removes run dir`; `deleteRun removes workspace dir if present`; `deleteRun throws RunNotFoundError for missing run`; `deleteRun does NOT check active status (gate lives in the route — calling deleteRun on an active run succeeds without force)`; `deriveStageStatuses` for shipped / failed / in-flight run fixtures.
  - `src/dashboard/app/runs/[id]/page.test.tsx` — `renders header + 6 stage cards with artifacts for a shipped run fixture`; `renders "not reached" for stages beyond the failure point for a failed run fixture`; `renders not-found state (local EmptyState) for a 404 fetch`; `Back to runs link present and points to /`.
- **Experience:** The two §9 Experience Scripts (A1.1 board→detail→back→not-found→failed-detail; A1.2 delete flow + regression). The Experience Runner drives the running app through each script and must return PASS before the respective story clears the build loop.
- **Regression:** board (`/`) loads + polls (existing board test); `RunCard` still links correctly; New Run flow (POST) still works; `queue.db` integrity for surviving runs (the DELETE scoping test).
- **Manual:** Royce confirms by reviewing the passing Experience Runner reports for both stories, and optionally re-drives the original repro (click a run → no crash; delete a failed run → gone from board). Autonomous mode may waive Royce's own re-click per the proxy's human-only rules, but never waives the Experience Runner pass itself.

---

## 11. Rollback Plan

Filled before execution so reverting never requires archaeology:

- **Branch:** `issue/1-run-detail-and-delete` — all commits reference `#1`.
- **Merge:** single squash merge per PR; squash SHA recorded in the issue Tracking table.
- **Revert:** `git revert -m 1 <merge SHA>` (or `git revert <squash SHA>` for a squash).
- **Migrations:** none. No schema changes — `deleteRun` only removes directories and deletes rows from an existing table. Reverting the code restores the pre-fix state (no /runs/[id] page, no DELETE endpoint, dead runs remain in `data/runs/` but no data is lost by the revert itself — deleted runs are gone, which is the user's intent).
- **Deploy rollback:** per `anymake-deploy` — previous release identifier recorded at merge time. realcode dashboard is a Next.js app; rollback is a redeploy of the prior build. No external state to roll back.

---

## 12. Review Log

Appended each round — never deleted. Review files live beside this plan.

| Round | Date | Reviewer verdict | Report | Resolution |
|-------|------|------------------|--------|------------|
| 1 | 2026-08-11 | NEEDS CHANGES | `review-round-1.md` | 1-C1 fixed in §7/§9/§4.2/§3 (option b: inline-replicate NewRunDialog modal pattern; local EmptyState; drop Tooltip for native title; component inventory corrected — no `Dialog`/`EmptyState`/`Tooltip` reuse claimed). 1-C2 fixed in §4.1/§4.3/§10 (route owns the active-run 409 gate; `deleteRun(runId)` unconditional, no `force` param, no `RunActiveError`; route calls `deleteRun` only after gate passes; engine test updated). 1-C3 fixed in §4.4/§4.3/§4.1 (types defined server-side in `engine.ts`; `StageName` reused from `./data`; distinct `DetailStageStatus` for the `"not-reached"` vocabulary; `RunDetailResponse` defined server-side, imported by `lib/api.ts`; `deriveStageStatuses` return type + GET response type updated to `DetailStageStatus`). |
