# realcode -- System Map

**Last mapped:** 2026-08-11 (cartographer refresh, post-issue #1/#3 + session 21)
**Code state:** 9faa3cf (master)

> Lightweight intent layer built from planning docs + direct code reading.
> Refreshed by the Cartographer after issue #1 (run-detail page), issue #3
> (plan timeout + self-contained agent specs), session 21 (build context
> discipline), and the workspace-seeding recursion fix all landed.

---

## Project identity

- **project_type:** `agentic-harness`
- **Purpose:** Multi-stage pipeline of sandboxed LLM agents (frame -> discover -> plan -> spec -> build -> ship) that wraps the anymake system. Engine + dashboard + Phoenix traces.
- **Success model:** A real end-to-end run ships a working increment on a mission-control project. (Personal/operational tool for MVP, no monetization.)

## Architecture

```
src/
  engine-loop.ts          -- the main loop: dispatches work_items from queue.db to stage agents
  engine/dispatcher.ts    -- reads stage-graph.yaml, runs stages via sandboxed opencode, writes stage artifacts
                            ALSO: createRun seeds the workspace from a target project repo
                            (COPY_EXCLUDE_DIRS guards against recursion + context bloat -- ADR-007)
  backend/                -- queue (SQLite), run state machine, control doc
  agents/                 -- AgentStageRunner: loads AgentSpec YAML, invokes opencode-in-sandbox per stage
                            runner.fillTemplate() truncates each interpolated value at 8000 chars (ADR-008)
  agent-specs/            -- 6 YAML specs (frame/discover/plan/spec/build/ship) -- system/user prompts, tool allowlist, model tier
                            plan.yaml + build.yaml carry CRITICAL context-discipline guards (ADR-006):
                              the agent must work ONLY from prompt-provided context, must NOT read
                              node_modules/data/.git/dist/.next/coverage, must NOT search for anymake docs
  sandbox/                -- Docker sandbox runner (realcode-sandbox:latest image, sandbox-net)
  schemas/                -- JSON-Schema per stage artifact (frame/discover/plan/spec/build/ship)
  cli/                    -- `realcode run "..."` CLI entry point
  dashboard/              -- Next.js control/observability dashboard (thin UI per agentic-harness manifest)
    app/
      page.tsx            -- Runs board (/) -- polls /api/runs, renders RunCard list grouped by status
      runs/[id]/
        page.tsx          -- Run detail page (BUILT -- issue #1/PR #2): fetches /api/runs/[id],
                            renders header card (idea, cost meter, StageStepper), per-stage cards
                            with artifact JSON viewer, delete modal with active-run warning + ?force=1
      api/runs/
        route.ts          -- GET list runs, POST create run
        [id]/route.ts     -- GET run detail (getRunDetail), DELETE run (active-run 409 gate + ?force=1)
                            (no /api/runs/[id]/stream route exists)
      api/control/route.ts-- GET/PUT control doc (run_mode, concurrency, cost_cap)
      api/stats/route.ts  -- GET stats strip data
      settings/           -- settings page (lite)
    components/            -- AppShell, RunCard, RunControls, StageStepper, StatStrip, NewRunDialog, TraceTimeline, ui primitives
    lib/
      api.ts              -- usePoll hook, mapRunRecord (status mapping), RunRecord interface,
                            fetchRunDetail() + deleteRun() client fns (issue #1)
      data.ts             -- TYPES + MOCK data (STAGE_ORDER, StageName; mock array unused by live UI)
      engine.ts           -- server-side engine: listRuns, getRun, createRun, getControlDoc, setControlDoc,
                            getRunDetail() (reads run.json + all stage artifacts, deriveStageStatuses),
                            deleteRun() (4-step: rm run dir, rm workspace, DELETE work_items, invalidate cache),
                            deriveStageStatuses() (run status + present artifacts -> per-stage DetailStageStatus)
                            ALSO: createRun seeds workspace (COPY_EXCLUDE_DIRS duplicated here -- ADR-007)
data/                     -- runtime data (REALCODE_DATA_DIR or .realcode-data)
  control.json            -- run_mode, concurrency, cost_cap
  queue.db                -- SQLite work_items table (id, run_id, stage, status, ...)
  runs/run_<id>/
    run.json              -- RunRecord: run_id, idea, status, spent_usd, cap_usd, created_at, workspace_path
    frame.json            -- stage artifact (only present if frame stage ran)
    discover.json         -- stage artifact
    plan.json             -- stage artifact
    spec.json             -- stage artifact
    build.json            -- stage artifact
    ship.json             -- stage artifact (present on shipped runs)
  workspaces/run_<id>/    -- seeded workspace (copied from target project repo, excluding data/tests/node_modules/lockfiles)
```

## Data model

**RunRecord** (run.json): `{ run_id, idea, status, spent_usd, cap_usd, created_at, workspace_path }`

**Stage artifacts** (frame.json etc.): per-stage JSON-Schema-validated output. Failed runs may have only run.json. The detail page's `getRunDetail()` reads run.json + every present stage artifact.

**RunDetailResponse** (returned by GET /api/runs/[id] and consumed by the detail page):
`{ run: RunRecord, stages: Record<StageName, DetailStageStatus>, artifacts: Partial<Record<StageName, unknown>> }`
where `DetailStageStatus = StageStatus | "not-reached"`.

**ControlDoc** (control.json): `{ run_mode, concurrency, per_stage_model_overrides, cost_cap_usd, updated_at, updated_by }`

**work_items** (queue.db): `{ id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload, created_at, updated_at }`

## Status state machine

`intake -> framed -> discovered -> planned -> specified -> built -> shipped`

Failure states: `framing_failed`, `discovery_failed`, `plan_failed`, `spec_failed`, `build_failed`, `ship_failed`

Other: `escalated`, `paused_step`, `paused_cost_cap`

## Key flows

1. **Create run:** POST /api/runs -> engine.createRun -> parses `[target: <project>]` tag, seeds workspace (excluding data/tests/node_modules/lockfiles), writes run.json + inserts work_item into queue.db -> engine-loop picks it up
2. **List runs:** GET /api/runs -> engine.listRuns -> reads data/runs/*/run.json
3. **Dashboard board:** page.tsx polls /api/runs every 3s -> mapRunRecord maps status -> RunCard with StageStepper
4. **Run detail (BUILT, issue #1):** RunCard links to /runs/[id] -> page.tsx calls `fetchRunDetail(id)` -> GET /api/runs/[id] -> engine.getRunDetail reads run.json + all stage artifacts + deriveStageStatuses -> renders header card (idea, cost meter vs cap, StageStepper) + per-stage cards (status badge + artifact JSON viewer, with "not reached"/"failed -- no artifact" empty states) + delete modal. 404 -> NotFoundState.
5. **Delete run (BUILT, issue #1):** detail page delete button -> confirm modal (warns if run is active) -> `deleteRun(id, isActive)` sends DELETE /api/runs/[id] (+ ?force=1 if active) -> route enforces active-run gate (409 unless force) -> engine.deleteRun removes run dir + workspace + work_items rows + invalidates list cache -> redirect to /

## Stage timeouts (stage-graph.yaml)

| Stage | timeout_ms | model_tier |
|-------|-----------|------------|
| frame | 600000 | 1 |
| discover | 600000 | 2 |
| plan | 600000 | 1 |
| spec | 300000 | 2 |
| build | 1200000 | 3 |
| ship | 600000 | 2 |

Per-run cost cap: $8.00. Retry ceilings: per_stage_revision 2, per_story_build 3, per_stage_escalation 5.

## Integrations

- **Docker sandbox:** realcode-sandbox:latest image on sandbox-net; agents run headless opencode inside
- **Phoenix (Arize):** tracing at localhost:6006; OpenTelemetry OTLP/proto exporter (ADR-005)
- **anymake:** the pipeline wraps anymake's phases 0-5; each stage delegates to the corresponding anymake phase
- **mission-control projects:** `[target: <project>]` tag seeds the workspace from `PROJECTS/<project>/repo`, excluding `node_modules`, `.git`, `dist`, `.next`, `.cache`, `data`, `tests` dirs and `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml` files (ADR-007). NOTE: the realcode repo's own `data/` contains `data/workspaces/<runId>/` (the workspace being created), so copying it would cause infinite recursion.

## Drift Log

All items `resolved` -- no open drift at this mapping.

| Ref | Item | Status | Note |
|-----|------|--------|------|
| D-1 | Run-detail page was "DESTINATION DOES NOT EXIST" at c8037f4 | resolved | Built in issue #1 / PR #2 (commit dff34bf). Flow #4 now reflects the as-built page + API + delete endpoint. |
| D-2 | INV-3/ADR-004 required the detail page to use live data, not getRun() mock | resolved | Detail page uses `fetchRunDetail()` -> live `getRunDetail()` reading real run.json + artifacts. Mock in data.ts is types only. |
| D-3 | INV-6 "running/paused run should not be deletable without confirmation" was unenforced at c8037f4 | resolved | Now enforced: API returns 409 for active runs unless `?force=1`; UI shows active-run warning + confirm modal (commit dff34bf). |
| D-4 | Plan stage timed out before completing (issue #3) | resolved | plan.yaml rewritten to be self-contained (no external file reads); plan timeout 600000; fillTemplate truncation 8000 (commit 9faa3cf). Recorded as ADR-006/ADR-008. |
| D-5 | Build stage escalated from context bloat (session 21) | resolved | build.yaml "Context discipline -- CRITICAL" guard added (commit 9faa3cf). Recorded as ADR-006. |
| D-6 | Workspace seeding caused infinite recursion (data/ self-copy, 138 levels / 1.8GB) | resolved | COPY_EXCLUDE_DIRS in dispatcher.ts + engine.ts (commit 9faa3cf). Recorded as ADR-007. |
