# realcode -- System Map

**Last mapped:** 2026-08-11 (built by real-agent for agile issue #1)
**Code state:** c8037f4 (master)

> Lightweight intent layer built from planning docs + direct code reading, to
> support agile issue #1. Refresh via the Cartographer for future issues.

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
  backend/                -- queue (SQLite), run state machine, control doc
  agents/                 -- AgentStageRunner: loads AgentSpec YAML, invokes opencode-in-sandbox per stage
  agent-specs/            -- 6 YAML specs (frame/discover/plan/spec/build/ship) -- system/user prompts, tool allowlist, model tier
  sandbox/                -- Docker sandbox runner (realcode-sandbox:latest image, sandbox-net)
  schemas/                -- JSON-Schema per stage artifact (frame/discover/plan/spec/build/ship)
  cli/                    -- `realcode run "..."` CLI entry point
  dashboard/              -- Next.js control/observability dashboard (thin UI per agentic-harness manifest)
    app/
      page.tsx            -- Runs board (/) -- polls /api/runs, renders RunCard list grouped by status
      runs/[id]/          -- Run detail page (UNBUILT -- empty directory, issue #1)
      api/runs/route.ts   -- GET list runs, POST create run
      api/control/route.ts-- GET/PUT control doc (run_mode, concurrency, cost_cap)
      api/stats/route.ts  -- GET stats strip data
      settings/           -- settings page (lite)
    components/            -- RunCard, StageStepper, StatStrip, NewRunDialog, ui primitives
    lib/
      api.ts              -- usePoll hook, mapRunRecord (status mapping), RunRecord interface
      data.ts             -- TYPES + MOCK data (used by getRun; board uses live API not mock)
      engine.ts           -- server-side engine: listRuns, getRun, createRun, getControlDoc, setControlDoc
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
  workspaces/run_<id>/    -- seeded workspace (copied from target project repo)
```

## Data model

**RunRecord** (run.json): `{ run_id, idea, status, spent_usd, cap_usd, created_at, workspace_path }`

**Stage artifacts** (frame.json etc.): per-stage JSON-Schema-validated output. Failed runs may have only run.json.

**ControlDoc** (control.json): `{ run_mode, concurrency, per_stage_model_overrides, cost_cap_usd, updated_at, updated_by }`

**work_items** (queue.db): `{ id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload, created_at, updated_at }`

## Status state machine

`intake -> framed -> discovered -> planned -> specified -> built -> shipped`

Failure states: `framing_failed`, `discovery_failed`, `plan_failed`, `spec_failed`, `build_failed`, `ship_failed`

Other: `escalated`, `paused_step`, `paused_cost_cap`

## Key flows

1. **Create run:** POST /api/runs -> engine.createRun -> writes run.json + inserts work_item into queue.db -> engine-loop picks it up
2. **List runs:** GET /api/runs -> engine.listRuns -> reads data/runs/*/run.json
3. **Dashboard board:** page.tsx polls /api/runs every 3s -> mapRunRecord maps status -> RunCard with StageStepper
4. **Run detail:** RunCard links to /runs/[id] -- **DESTINATION DOES NOT EXIST** (issue #1)

## Integrations

- **Docker sandbox:** realcode-sandbox:latest image on sandbox-net; agents run headless opencode inside
- **Phoenix (Arize):** tracing at localhost:6006; OpenTelemetry OTLP/proto exporter
- **anymake:** the pipeline wraps anymake's phases 0-5; each stage delegates to the corresponding anymake phase
- **mission-control projects:** [target: <project>] tag seeds the workspace from PROJECTS/<project>/repo
