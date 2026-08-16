# realcode -- System Map

**Last mapped:** 2026-08-15 (cartographer refresh, post-merge of PR #18 / issue #17)
**Code state:** 8456aaa (master)

> Lightweight intent layer built from planning docs + direct code reading.
> Refreshed by the Cartographer after:
>   - issue #1 (run-detail page), issue #3 (plan timeout + self-contained specs),
>     session 21 (build context discipline), workspace-seeding recursion fix
>   - issue #4 (engine-orchestrated build inner loop, ADR-009)
>   - issue #11 (live-state visibility system, ADR-011)
>   - issue #16 / session 25 (conductor + dual-flow architecture, ADR-010)
>   - session 26 (dashboard mobile-first audit)
>   - issue #17 / PR #18 (ADR-012: agents delegate to anymake's real templates via cache path;
>     build.yaml deleted; engine-orchestrated build loop codified; ship fast-path intentional;
>     D-7 resolved)

---

## Project identity

- **project_type:** `agentic-harness`
- **Purpose:** Multi-stage pipeline of sandboxed LLM agents that wraps the anymake
  methodology. A **conductor** classifies each request as a *new project* (full
  6-stage pipeline: frame -> discover -> plan -> spec -> build -> ship) or a
  *change to an existing project* (agile flow: a single sandbox with the real
  project repo live-mounted). Engine + dashboard + Phoenix traces.
- **Success model:** A real end-to-end run ships a working increment on a
  mission-control project. (Personal/operational tool for MVP, no monetization.)
- **anymake (D-7 resolved by ADR-012):** agent specs now point at anymake's real templates in the opencode cache path. See Drift Log D-7.

## Architecture

```
src/
  engine-loop.ts          -- the main loop: dispatches work_items from queue.db to stage agents
  engine/
    dispatcher.ts         -- reads stage-graph.yaml, runs stages via sandboxed opencode, writes stage artifacts
                            ALSO: createRun seeds the workspace from a target project repo
                            (COPY_EXCLUDE_DIRS guards against recursion + context bloat -- ADR-007)
                            CONDUCTOR STAGE (ADR-010): when stage.conductor is true, runs classifyIntent()
                            directly in-process (no container) and branches the flow:
                              classify_new    -> classified_new  -> frame stage (full pipeline)
                              classify_change -> classified_change -> change stage (agile flow)
                            LIVE-MOUNT (ADR-010): when stage.live_mount is true + target_project set,
                              resolves workspace_path to the REAL project repo (no copy/seed).
                            LIVE-STATE (ADR-011): for non-build stages, writes live.json at stage
                            start/end/catch (writeLiveState); appends trace events (appendLiveEvent)
                            with a 250ms coalescing buffer flushed at stage end (flushLiveEvents).
    conductor.ts          -- [NEW, ADR-010] stage-0 intent classifier. Hybrid:
                              1. deterministic: [target: <project>] tag or project-name mention -> "change"
                              2. LLM: lightweight OpenRouter classification call for ambiguous requests
                              3. fallback: no API key / network error -> "new" (safe default)
                            Does NOT spawn a container. Returns ClassificationResult
                            {intent, target_project, flow_type, clean_idea, reasoning, token_usage}.
                            resolveLiveWorkspace(project) -> MISSION_CONTROL_ROOT/PROJECTS/<project>/repo
                            listAvailableProjects() scans PROJECTS/*/repo.
    build-loop.ts         -- BuildLoopRunner: per-story Worker->Validator serial loop (ADR-009).
                            Implements StageRunner interface (drop-in for AgentStageRunner on stages
                            with inner_loop + worker_spec). Per-story state in build-state.json.
                            Worker timeout 600s, validator timeout 300s. Heartbeats lease before both
                            dispatches. Re-reads control doc between stories (terminal escalation
                            breaks the loop). Writes live-state per story (containers + events).
    live-state.ts         -- [NEW, ADR-011] live.json realtime channel. writeLiveState (atomic tmp+rename,
                            shallow-merge with deep container merge), readLiveState (null on missing),
                            appendLiveEvent (truncates content to 500 chars, rolling window MAX_EVENTS=200,
                            coalesces to 1 rewrite / 250ms via trailing timer), flushLiveEvents (stage-end
                            forced flush), eventFromJsonLine (converts opencode JSON stdout lines ->
                            LiveTraceEvent). Never throws (best-effort observability).
    stage-graph.ts        -- zod schema for stage-graph.yaml. StageEntry now includes:
                            `conductor: boolean` (stage-0 direct-LLM classifier, relaxes agent_spec/
                            inner_loop XOR), `live_mount: boolean` (change-flow real-repo mount).
    tracing.ts            -- OpenTelemetry OTLP/proto -> Phoenix (ADR-005)
  backend/                -- queue (SQLite), run state machine, control doc
  agents/                 -- AgentStageRunner: loads AgentSpec YAML, invokes opencode-in-sandbox per stage
                            runner.fillTemplate() truncates each interpolated value at 8000 chars (ADR-008)
  agent-specs/            -- 6 YAML specs (build.yaml deleted by ADR-012; build stage uses
                            worker_spec/validator_spec per ADR-009):
                              frame / discover / plan / spec / ship  (full pipeline -- ADR-012:
                                point agents at anymake's real templates in the opencode cache path
                                /root/.cache/opencode/packages/anymake@.../ instead of inlining
                                frozen copies)
                              change  (agile flow -- ADR-010; live-mount, direct edit+test+commit,
                                       can delegate to anymake-agile Skill for complex changes -- now
                                       functional per ADR-012 since anymake is accessible in-sandbox)
                              [worker.yaml + validator.yaml are inner-loop specs, not pipeline stages]
                            Traversal guard (ADR-006 -- traversal clause stands, anymake-read prohibition
                              removed by ADR-012): the agent must NOT traverse node_modules/data/.git/
                              dist/.next/coverage, with a carve-out for the anymake cache path (passes
                              through a node_modules dir but is not a traversal)
  sandbox/                -- Docker sandbox runner (realcode-sandbox:latest image, sandbox-net)
  schemas/                -- JSON-Schema per stage artifact (conductor, frame, discover, plan, spec, build, ship, change)
  cli/                    -- `realcode run "..."` CLI entry point
  dashboard/              -- Next.js control/observability dashboard (thin UI per agentic-harness manifest)
    app/
      page.tsx            -- Runs board (/) -- polls /api/runs, renders RunCard list grouped by status
      runs/[id]/
        page.tsx          -- Run detail page: header card (idea, cost meter, StageStepper),
                            PIPELINE ACTIVITY section (A11.3 -- renders whenever live_state exists):
                              CurrentActivityBar + ContainerGrid + LiveTraceStream + ContainerLogViewer
                            per-stage cards with artifact JSON viewer (build stage gets "view raw" toggle),
                            Build Stage Detail section (StoryProgress + container trio when no live_state),
                            delete modal with active-run + running-build-container warnings + ?force=1
      api/runs/
        route.ts          -- GET list runs, POST create run
        [id]/route.ts     -- GET run detail (getRunDetail -- now includes live_state + build_state),
                            DELETE run (active-run 409 gate + build-loop container gate + ?force=1)
        [id]/trace/route.ts        -- GET Phoenix trace events for a run
        [id]/build-state/route.ts  -- GET build-state.json (per-story Worker/Validator state)
        [id]/containers/route.ts   -- GET live containers (from live.json / build-state)
        [id]/containers/[cid]/logs/route.ts -- GET container log tail
      api/control/route.ts-- GET/PUT control doc (run_mode, concurrency, cost_cap)
      api/stats/route.ts  -- GET stats strip data
      settings/           -- settings page (lite)
    components/            -- AppShell (desktop sidebar + mobile bottom nav, session 26),
                            RunCard, RunControls, StageStepper, StatStrip, NewRunDialog,
                            TraceTimeline,
                            CurrentActivityBar (A11.3 -- live stage/container summary bar),
                            LiveTraceStream (A11.3 -- rolling SSE trace event stream from live.json),
                            ContainerGrid (A11 -- live + build container cards, click to select),
                            ContainerLogViewer (A11 -- tail logs for a selected container),
                            StoryProgress (issue #4 -- per-story build progress table),
                            ui primitives
    lib/
      api.ts              -- usePoll hook, mapRunRecord (status mapping), RunRecord interface,
                            fetchRunDetail() + deleteRun() client fns
      data.ts             -- TYPES + MOCK data. StageName now includes "conductor" + "change";
                            STAGE_ORDER = [conductor, frame, discover, plan, spec, build, ship, change]
                            (mock array unused by live UI)
      engine.ts           -- server-side engine: listRuns, getRun, createRun, getControlDoc, setControlDoc,
                            getRunDetail() (reads run.json + all stage artifacts + live_state + build_state,
                            deriveStageStatuses), getLiveState() (readLiveState wrapper),
                            deleteRun() (4-step: rm run dir, rm workspace, DELETE work_items, invalidate cache),
                            deriveStageStatuses() (run status + present artifacts -> per-stage DetailStageStatus)
                            ALSO: createRun seeds workspace (COPY_EXCLUDE_DIRS duplicated here -- ADR-007)
data/                     -- runtime data (REALCODE_DATA_DIR or .realcode-data)
  control.json            -- run_mode, concurrency, cost_cap
  queue.db                -- SQLite work_items table (id, run_id, stage, status, ...)
  runs/run_<id>/
    run.json              -- RunRecord: run_id, idea, status, spent_usd, cap_usd, created_at, workspace_path
    live.json             -- [NEW, ADR-011] transient realtime state (NOT a stage artifact -- INV-2):
                            {run_id, stage, status, container, events[], tokens_total, cost_usd}.
                            Overwritten per stage, never schema-validated, rolling 200-event window.
    conductor.json        -- [NEW, ADR-010] conductor artifact (intent, target_project, flow_type, reasoning)
    frame.json            -- stage artifact (full flow only)
    discover.json         -- stage artifact
    plan.json             -- stage artifact
    spec.json             -- stage artifact
    build.json            -- stage artifact
    build-state.json      -- per-story Worker/Validator state (ADR-009)
    ship.json             -- stage artifact
    change.json           -- [NEW, ADR-010] change-flow artifact (files_modified, tests, commit_sha)
  workspaces/run_<id>/    -- seeded workspace (full flow only; change flow live-mounts the real repo instead)
```

## Dual-flow architecture (ADR-010)

The conductor (stage 0) branches every run into one of two flows:

### Full pipeline flow (`classify_new` -> `classified_new`)
The original 6-stage pipeline runs: `frame -> discover -> plan -> spec -> build -> ship`.
The workspace is an ephemeral seeded copy (ADR-007 excludes data/tests/node_modules/lockfiles).
The build stage uses the engine-orchestrated inner loop (ADR-009): per-story
Worker -> Validator sandboxes, serially, tracked in build-state.json.

### Agile change flow (`classify_change` -> `classified_change`)
A single `change` stage runs. The workspace is the REAL project repo, live-mounted
read-write (no copy/seed) via `resolveLiveWorkspace()`. The change agent
(`agent-specs/change.yaml`) reads the project, makes the change directly (budget:
12 tool calls), runs tests, commits. For complex changes it can delegate to the
`anymake-agile` Skill. Emits `change.json` with files_modified, tests, commit_sha.

**Branching is data-driven** (ADR-002): the conductor + change stages are
declared in `stage-graph.yaml` with `conductor: true` and `live_mount: true`
flags. The engine reads these flags; no engine code change is needed to add a
third flow.

## Data model

**RunRecord** (run.json): `{ run_id, idea, status, spent_usd, cap_usd, created_at, workspace_path }`

**LiveState** (live.json -- ADR-011, NOT a stage artifact): `{ run_id, stage, status, started_at,
updated_at, container: LiveContainer|null, events: LiveTraceEvent[], tokens_total, cost_usd, failure_message? }`
where `LiveContainer = { container_id, name, role, status, started_at, log_path }` and
`LiveTraceEvent = { kind, stage, agent, content, timestamp, role?, tool?, tokens?, cost_usd? }`.

**ConductorArtifact** (conductor.json -- ADR-010): `{ schema_version, run_id, trace_id, stage,
gate_verdict: "classify_new"|"classify_change", gate_notes, token_usage, status, revisions_used,
artifact: { intent, target_project, flow_type, clean_idea, classification_reasoning, available_projects } }`

**ChangeArtifact** (change.json -- ADR-010): `{ gate_verdict, gate_notes, status, revisions_used,
artifact: { changes_summary, files_modified, files_created, tests_run, tests_passed, test_output,
commit_sha, commit_message, target_project } }`

**Stage artifacts** (frame.json etc.): per-stage JSON-Schema-validated output. Failed runs may have only run.json.

**BuildState** (build-state.json -- ADR-009): `{ run_id, started_at, wall_clock_deadline_ms, paused,
pause_reason, stories: StoryState[], containers: [{container_id, role, story_id, log_path}] }`
where `StoryState = { story_id, title, status, retry_count, worker_container_id, validator_container_id,
worker_output, validator_output, started_at, completed_at, depends_on, acceptance_criteria,
worker_tokens?, validator_tokens?, worker_cost_usd?, validator_cost_usd?, test_passed?, test_failed? }`.

**RunDetailResponse** (GET /api/runs/[id]): `{ run, stages: Record<StageName, DetailStageStatus>,
artifacts: Partial<Record<StageName, unknown>>, live_state?: LiveState, build_state?: BuildState }`
where `DetailStageStatus = StageStatus | "not-reached"`.

**ControlDoc** (control.json): `{ run_mode, concurrency, per_stage_model_overrides, cost_cap_usd, updated_at, updated_by }`

**work_items** (queue.db): `{ id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload, created_at, updated_at }`

## Status state machine

The conductor introduces new branch states. The full map:

```
intake --[conductor]-->
  classified_new   --> framed --> discovered --> planned --> specified --> built --> shipped
  classified_change --> (change stage) --> shipped
  conductor_failed
```

Full-flow failure states: `framing_failed`, `discovery_failed`, `plan_failed`, `spec_failed`, `build_failed`, `ship_failed`
Change-flow failure states: `change_failed`, `conductor_failed`
Other: `escalated`, `paused_step`, `paused_cost_cap`

## Key flows

1. **Create run:** POST /api/runs -> engine.createRun -> writes run.json + inserts work_item (stage=conductor) into queue.db -> engine-loop picks it up
2. **Conductor (stage 0, ADR-010):** dispatcher sees `stage.conductor` -> calls `classifyIntent(idea)` in-process (no container). Deterministic `[target: <project>]` tag or project-name match -> change; else LLM classification; else fallback to new. Writes conductor.json, sets run.workspace_path (live repo for change), releases work_item to `classified_new` or `classified_change`.
3. **Full pipeline:** classified_new -> frame -> discover -> plan -> spec -> build (engine-orchestrated inner loop, ADR-009) -> ship. Workspace is a seeded copy (ADR-007).
4. **Agile change (ADR-010):** classified_change -> change stage. Dispatcher sees `stage.live_mount` -> resolves workspace_path to real project repo. Single sandbox container runs `agent-specs/change.yaml` (direct edit + test + commit, or delegate to anymake-agile Skill). Emits change.json.
5. **List runs:** GET /api/runs -> engine.listRuns -> reads data/runs/*/run.json
6. **Dashboard board:** page.tsx polls /api/runs every 3s -> mapRunRecord maps status -> RunCard with StageStepper
7. **Run detail:** RunCard links to /runs/[id] -> page.tsx calls `fetchRunDetail(id)` -> GET /api/runs/[id] -> engine.getRunDetail reads run.json + all stage artifacts + live_state + build_state + deriveStageStatuses -> renders header card + Pipeline Activity section (CurrentActivityBar + ContainerGrid + LiveTraceStream + ContainerLogViewer, when live_state exists) + per-stage cards + Build Stage Detail (StoryProgress) + delete modal.
8. **Live-state visibility (ADR-011):** dispatcher writes live.json at non-build stage start/end/catch; build-loop writes it per story. Dashboard reads it via getRunDetail().live_state. The Pipeline Activity section renders for ANY stage with live_state (including terminal runs), not just active builds.
9. **Delete run:** detail page delete button -> confirm modal (warns if active OR has running build containers) -> `deleteRun(id, isActive)` sends DELETE /api/runs/[id] (+ ?force=1 if active) -> route enforces active-run gate (409 unless force) + build-loop container gate -> engine.deleteRun removes run dir + workspace + work_items rows + invalidates list cache -> redirect to /

## Stage timeouts (stage-graph.yaml)

| Stage | timeout_ms | model_tier | notes |
|-------|-----------|------------|-------|
| conductor | 30000 | 3 | direct LLM call, no container (ADR-010) |
| frame | 600000 | 1 | |
| discover | 600000 | 2 | |
| plan | 600000 | 1 | |
| spec | 480000 | 2 | |
| build | 1200000 | 3 | inner loop: worker 600s + validator 300s per story (ADR-009) |
| ship | 600000 | 2 | |
| change | 900000 | 1 | single sandbox, live-mount (ADR-010) |

Per-run cost cap: $8.00. Retry ceilings: per_stage_revision 2, per_story_build 3, per_stage_escalation 5.

## Integrations

- **Docker sandbox:** realcode-sandbox:latest image on sandbox-net; agents run headless opencode inside. The conductor stage does NOT use the sandbox (direct in-process LLM call).
- **Phoenix (Arize):** tracing at localhost:6006; OpenTelemetry OTLP/proto exporter (ADR-005). live.json is NOT a second trace store -- Phoenix remains the collector of record.
- **anymake (D-7 resolved by ADR-012):** agent specs now point at anymake's real templates in the opencode cache path instead of inlining frozen copies. The engine-orchestrated build loop is the sanctioned container-per-subagent model. The `anymake_phase` / `anymake_agents` fields in stage-graph.yaml are declarative labels (the engine orchestrates roles), but agents read anymake's real content at runtime. See Drift Log D-7.
- **mission-control projects:** `[target: <project>]` tag is now consumed by the conductor (ADR-010) to classify a run as a change flow and live-mount `PROJECTS/<project>/repo`. For full-flow new-project runs, the workspace is seeded from the target repo, excluding `node_modules`, `.git`, `dist`, `.next`, `.cache`, `data`, `tests` dirs and `package-lock.json`/`yarn.lock`/`pnpm-lock.yaml` files (ADR-007). NOTE: the realcode repo's own `data/` contains `data/workspaces/<runId>/` (the workspace being created), so copying it would cause infinite recursion.
- **OpenRouter:** the conductor's LLM classification call (ADR-010) hits `openrouter.ai/api/v1/chat/completions` directly using `OPENROUTER_API_KEY` and `ANYMAKE_MODEL_TIER3`/`ANYMAKE_MODEL_TIER1`.

## Drift Log

| Ref | Item | Status | Note |
|-----|------|--------|------|
| D-1 | Run-detail page was "DESTINATION DOES NOT EXIST" at c8037f4 | resolved | Built in issue #1 / PR #2 (commit dff34bf). Flow #7 now reflects the as-built page + API + delete endpoint. |
| D-2 | INV-3/ADR-004 required the detail page to use live data, not getRun() mock | resolved | Detail page uses `fetchRunDetail()` -> live `getRunDetail()` reading real run.json + artifacts. Mock in data.ts is types only. |
| D-3 | INV-6 "running/paused run should not be deletable without confirmation" was unenforced at c8037f4 | resolved | Now enforced: API returns 409 for active runs unless `?force=1`; UI shows active-run warning + confirm modal (commit dff34bf). |
| D-4 | Plan stage timed out before completing (issue #3) | resolved | plan.yaml rewritten to be self-contained (no external file reads); plan timeout 600000; fillTemplate truncation 8000 (commit 9faa3cf). Recorded as ADR-006/ADR-008. |
| D-5 | Build stage escalated from context bloat (session 21) | resolved | build.yaml "Context discipline -- CRITICAL" guard added (commit 9faa3cf). Recorded as ADR-006. |
| D-6 | Workspace seeding caused infinite recursion (data/ self-copy, 138 levels / 1.8GB) | resolved | COPY_EXCLUDE_DIRS in dispatcher.ts + engine.ts (commit 9faa3cf). Recorded as ADR-007. |
| D-7 | realcode was designed to *wrap anymake as a runtime dependency* but instead reimplements anymake's methodology in agent specs and the build loop | resolved | Resolved by ADR-012 (issue #17). Agent specs now point at anymake's real templates in the opencode cache path instead of inlining frozen copies. The engine-orchestrated build loop (ADR-009) is codified as the sanctioned container-per-subagent model. ship.yaml's fast-path is intentional. The `anymake_phase`/`anymake_agents` fields remain declarative labels (the engine orchestrates roles), but the agents now read anymake's real content at runtime. |
