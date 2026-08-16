# Experience Report — Scenario 2 (change-flow) re-verify after stage-collapse UI fix

**Run:** `run_182a90d0` — "Add a /version endpoint to the MCP server HTTP side channel"
**Target:** http://localhost:3001 (already running; no branch checkout / launch / teardown — direct URL drive)
**Date:** 2026-08-16
**Mode:** Browser (Playwright headless Chromium, real DOM render)
**Verdict:** **FAIL**

## Launch Log

| | |
|---|---|
| Target URL | http://localhost:3001 |
| Reachability check | `GET /` → HTTP 200; `GET /runs/run_182a90d0` → HTTP 200 |
| Launch | n/a — target was already running |
| Teardown | n/a — target was already running (did not start it) |

Driver: Playwright 11.11.1 (`chromium.launch()`), `page.goto(..., {waitUntil:"networkidle"})` + 2.5s settle; `pageerror` and `console.error` listeners attached. Screenshot: `experience-evidence/scenario2-change-flow-reverify/run-182a90d0.png`. Raw shell HTML: same dir, `run-page.html`.

## Scenario 2 — steps + results

| # | Action | Expected | Observed | Result |
|---|--------|----------|----------|--------|
| 1 | Navigate to `http://localhost:3001/runs/run_182a90d0` | Page renders; no "Application error: a client-side exception" | Page rendered. `pageerror`/`console.error` captured **0 events**. Body text contains 0 "Application error" / 0 "client-side exception". | **PASS** |
| 2 | Status badge | "Shipped" | Body text shows `Shipped` (probe `Shipped`=1). `run.json` status = `shipped`. | **PASS** |
| 3 | Conductor gate_verdict | `classify_change` visible | **Not present.** Probe `classify_change`=0 / `classifyChange`=0 across rendered DOM. `conductor.json` does carry `gate_verdict: "classify_change"` in the data, but the detail view does not surface it. | **FAIL** |
| 4 | Stage rail + stage cards | ONLY `conductor` + `change` shown; the 6 build-flow stages (frame/discover/plan/spec/build/ship) collapsed/hidden as "not-reached" | **All 8 stages rendered, each marked "pass".** Aria-labels captured: `Conductor stage — pass`, `Frame stage — pass`, `Discover stage — pass`, `Plan stage — pass`, `Spec stage — pass`, `Build stage — pass`, `Ship stage — pass`, `Change stage — pass`. Body text block: `CONDUCTOR FRAME DISCOVER PLAN SPEC BUILD SHIP CHANGE` and `Conductor pass / Frame pass / Discover pass / Plan pass / Spec pass / Build pass / Ship pass / Change pass`. | **FAIL** |
| 5 | Containers | One container visible (the change agent) | `1 active` — `realcode-run_182a90d0-change-0` (role `change`). | **PASS** |

## Verdict

**FAIL** — Steps 3 and 4 fail the literal expected result.

- Step 3: the `classify_change` gate verdict (present in `conductor.json`) is not rendered on the run detail page.
- Step 4: the 6 build-flow stages are **still shown** (all marked "pass"); the stage-collapse fix did not take effect for this shipped change-flow run.

## Diagnosis (observe-only; no edits made)

### Step 4 root cause — the UI fix is dead code because the data layer never emits `not-reached` for shipped change-flow runs

The page-level collapse logic is present and correct:
- `src/dashboard/app/runs/[id]/page.tsx:169` — `isAgileFlow = stages["change"] !== undefined && stages["change"] !== "not-reached"`
- `src/dashboard/app/runs/[id]/page.tsx:170-177` — `visibleStageOrder = STAGE_ORDER.filter(...)` drops any stage whose status is `"not-reached"` when `isAgileFlow`.

The filter can only fire when `stages[name] === "not-reached"`. But the API response for this run (`GET /api/runs/run_182a90d0`) returns:

```json
"stages": {
  "conductor": "pass", "frame": "pass", "discover": "pass",
  "plan": "pass", "spec": "pass", "build": "pass",
  "ship": "pass", "change": "pass"
}
```

All 8 stages are `"pass"` — the build-flow stages are **never** `"not-reached"`. So the page's filter matches nothing, and the rail renders all 8 stages.

Upstream source: `src/dashboard/lib/engine.ts` `deriveStageStatuses` (lines 300-328). The `isShipped` branch (lines 313-316) unconditionally marks **every** stage as `"pass"`:

```ts
if (isShipped) {
  // For the agile flow (change), stages after 'change' don't apply.
  // For the full flow, 'change' and 'conductor' are just 'pass'.
  result[stage] = "pass";
}
```

The comment acknowledges the agile-flow distinction, but the code does not implement it. The `presentArtifacts` parameter (the set of stages that actually produced an artifact on disk) is passed into `deriveStageStatuses` but **not consulted** in this branch. For an agile change-flow run, only `conductor.json` + `change.json` exist on disk (`data/runs/run_182a90d0/` contains `conductor.json`, `change.json`, `containers`, `live.json`, `run.json` — **no `build-state.json`**), so `presentArtifacts` should be `{conductor, change}`. The build-flow stages are genuinely not-reached, but the function stamps them `"pass"` anyway.

**Likely fix (for the Worker — not applied here):** in `deriveStageStatuses`, when `isShipped`, mark a stage `"not-reached"` if it is not in `presentArtifacts` (rather than blanket `"pass"`). That makes the page-level collapse filter (`page.tsx:175`) actually trigger for agile-shipped runs. Distinguishing agile-shipped from full-flow-shipped via `presentArtifacts` is what the parameter is for.

### Step 3 root cause — gate_verdict is not rendered anywhere in the run detail view

`conductor.json` carries `gate_verdict: "classify_change"` (confirmed by reading the artifact), but no component on `src/dashboard/app/runs/[id]/page.tsx` renders the conductor's `gate_verdict` / `gate_notes` fields. A grep of the rendered body for `classify_change` returns 0. The Conductor stage card surfaces only the stage status (`pass`), not the gate decision that the Conductor produced. This is an upstream data-surfacing gap in the Conductor stage card, separate from the stage-collapse fix.

## Evidence

- `experience-evidence/scenario2-change-flow-reverify/run-182a90d0.png` — full-page screenshot of the rendered run detail (shows all 8 stage chips + "Conductor pass / Frame pass / … / Change pass" rail).
- `experience-evidence/scenario2-change-flow-reverify/run-page.html` — raw HTML shell fetched from the URL.
- Rendered DOM probes (from the Playwright pass):
  - `Application error` = 0, `client-side exception` = 0, JS `pageerror`/`console.error` events = 0
  - `Shipped` = 1
  - `classify_change` = 0
  - aria-labels = `["Delete run","Conductor stage — pass","Frame stage — pass","Discover stage — pass","Plan stage — pass","Spec stage — pass","Build stage — pass","Ship stage — pass","Change stage — pass","New run"]`
- API response (`GET /api/runs/run_182a90d0`): `run.status = "shipped"`; `stages` map = all 8 stages `"pass"` (quoted above).
- On-disk run artifacts: `data/runs/run_182a90d0/` contains `conductor.json`, `change.json`, `containers/`, `live.json`, `run.json`; **no `build-state.json`** — confirms the build-flow stages were never reached for this change-flow run.
