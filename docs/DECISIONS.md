# realcode -- Decisions

**Last updated:** 2026-08-15 (issue #17 — ADR-012)

## Active Decisions

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | Headless opencode-in-sandbox as the agent invocation mechanism | Accepted |
| ADR-002 | Stage graph is declarative YAML, never engine code | Accepted |
| ADR-003 | Dashboard is thin control/observability only (agentic-harness manifest) | Accepted |
| ADR-004 | Real data, no mock placeholders in the dashboard | Accepted |
| ADR-005 | Phoenix tracing via OpenTelemetry OTLP/proto | Accepted |
| ADR-006 | Agent specs are self-contained -- no external file refs; context-discipline guards | Partially superseded by ADR-012 (traversal clause stands; anymake-read prohibition removed) |
| ADR-007 | Workspace seeding excludes data/tests/node_modules/lockfiles | Accepted |
| ADR-008 | fillTemplate truncates interpolated context at 8000 chars | Accepted |
| ADR-009 | Engine-orchestrated build inner loop (supersedes ADR-001 spike refinement) | Codified by ADR-012 as the sanctioned container-per-subagent model |
| ADR-010 | Conductor + dual-flow architecture (new-project pipeline vs agile change) | Accepted |
| ADR-011 | Live-state visibility system (live.json realtime channel) | Accepted |
| ADR-012 | Agents read anymake's real templates from the opencode cache + engine-orchestrated build loop is the sanctioned container-per-subagent model + ship fast-path is intentional | Accepted |

---

## ADR-001: Headless opencode-in-sandbox as the agent invocation mechanism
**Status:** Accepted (2026-08-08, Phase 4 spike)
**Context:** realcode wraps anymake. Each pipeline stage needs to invoke an LLM agent (the anymake agent for that phase) with tool access (file read/write, bash) in an isolated workspace.
**Decision:** Use headless opencode running inside a Docker sandbox container. The sandbox has the workspace mounted, the agent spec's tool allowlist enforced, and network egress to the LLM provider. The AgentStageRunner spawns `opencode` as a subprocess inside the container.
**Consequences:** Isolation per run; tool allowlist enforced at the opencode level; the sandbox image must be pre-built (realcode-sandbox:latest). Alternative considered: direct API calls (rejected -- loses anymake's agent infrastructure).
**Enforced in:** `src/agents/runner.ts` (AgentStageRunner), `src/sandbox/`.
**Spike refinement superseded by ADR-009** (engine-orchestrated inner loop). Core Option B decision preserved.

## ADR-002: Stage graph is declarative YAML, never engine code
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** The pipeline stages need to be configurable without changing engine code.
**Decision:** The stage graph lives in `stage-graph.yaml`. Adding, reordering, or branching a stage is a config change, never engine code.
**Consequences:** The engine reads the YAML at startup; stage transitions are data-driven. The conductor + change stages (ADR-010) were added purely as YAML entries with `conductor: true` / `live_mount: true` flags -- no engine branching code was needed to add a second flow.
**Enforced in:** `stage-graph.yaml`, `src/engine/stage-graph.ts`, `src/engine/dispatcher.ts`.

## ADR-003: Dashboard is thin control/observability only (agentic-harness manifest)
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** realcode is an agentic-harness project type. The manifest specifies "Thin (control/observability only)" UI.
**Decision:** The dashboard has 3 screens: Runs board (/), Run detail (/runs/[id]), Settings (/settings). No auth, no billing, no marketing. Dark developer-observability aesthetic (Vercel/Linear/Langfuse reference). Mobile-first responsive (session 26: desktop sidebar collapses to a bottom nav on < md).
**Consequences:** No user-facing product UI beyond the dashboard. The dashboard's job is to show what every agent did, what it cost, and where it paused.
**Enforced in:** `src/dashboard/app/` (3 routes only), `src/dashboard/components/AppShell.tsx` (responsive nav).

## ADR-004: Real data, no mock placeholders in the dashboard
**Status:** Accepted (2026-08-06, Phase 2 UX design)
**Context:** The dashboard must show real run data, not fake placeholders.
**Decision:** The board (page.tsx) polls the live /api/runs endpoint which reads real run.json files from data/runs/. The mock data in lib/data.ts is for type definitions and the getRun() function. The detail page must also use live data, not getRun() which returns mock.
**Consequences:** lib/data.ts contains both types AND mock data -- the mock data is NOT used by the board (which uses the live API). The detail page uses fetchRunDetail() -> live getRunDetail() (resolved post-launch, see Drift Log D-2).
**Enforced in:** `src/dashboard/lib/api.ts` (fetchRunDetail, usePoll), `src/dashboard/lib/engine.ts` (getRunDetail reads real files).

## ADR-005: Phoenix tracing via OpenTelemetry OTLP/proto
**Status:** Accepted (2026-08-11, session 17)
**Context:** Tracing was dead code (never initialized) + wrong exporter (JSON 415 -> proto 200).
**Decision:** Wire OpenTelemetry OTLP/proto exporter to Phoenix at localhost:6006. Per-stage spans. Phoenix remains the trace collector of record -- live.json (ADR-011) is a separate realtime convenience channel, NOT a second trace store.
**Enforced in:** `src/engine/tracing.ts`.

## ADR-006: Agent specs are self-contained -- no external file refs; context-discipline guards
**Status:** Accepted (as-built, 2026-08-11; commit 9faa3cf; issues #3 + session 21)
**Context:** Post-launch e2e runs revealed that the plan and build agents were ballooning context and timing out. Root causes: (a) the plan agent tried to read external anymake files (phase guides, templates) that are not present in the sandbox; (b) the build agent traversed node_modules/data/.git/dist/.next/coverage (enormous, irrelevant) and re-read anymake docs. A 288KB lockfile alone is ~70K tokens; the build stage hit >1M tokens before the timeout killed it.
**Decision:** Every agent spec YAML must be fully self-contained -- all instructions the agent needs are inlined in the system_prompt and user_prompt_template. The agent must work ONLY from prompt-provided context. Specifically:
- plan.yaml: "Work ONLY from the prior artifacts provided in the prompt below. Do NOT read or explore the workspace source tree. Do NOT search for or read any external files (phase guides, templates, etc.)." The PRD/ADR/UX formats are inlined.
- build.yaml: a "Context discipline -- CRITICAL" section forbidding any read/list/traverse of node_modules/, data/, .git/, dist/, build, .next, coverage/ output dirs; forbidding any anymake doc reads (PHASE_GUIDES/, TEMPLATES/, AGENTS/); requiring the agent to keep context lean (read a file, act, move on).
**Consequences:** Agent specs are larger but self-contained; context bloat is bounded; the sandbox needs no anymake doc mounts. This is now an invariant (INV-7) -- new/edited agent specs must remain self-contained.
**Enforced in:** `agent-specs/plan.yaml`, `agent-specs/build.yaml` (system_prompt guards).
**Related:** ADR-008 (fillTemplate truncation is the engine-level backstop).

## ADR-007: Workspace seeding excludes data/tests/node_modules/lockfiles
**Status:** Accepted (as-built, 2026-08-11; commit 9faa3cf; workspace-seeding fix)
**Context:** When `[target: <project>]` seeds a workspace by copying the target project repo, three failure modes appeared: (a) INFINITE RECURSION -- the realcode repo's own `data/` contains `data/workspaces/<runId>/` (the workspace being created), so copying data/ recursed 138 levels deep (1.8GB); (b) CONTEXT BLOAT -- copying tests/ and lockfiles (a 288KB lockfile ~70K tokens) inflated the sandbox agent's prompt; (c) needless size from node_modules/.git/dist/.next.
**Decision:** `seedWorkspaceFromProject()` applies a filter excluding `COPY_EXCLUDE_DIRS = {node_modules, .git, dist, .next, .cache, data, tests}` and `COPY_EXCLUDE_FILES = {package-lock.json, yarn.lock, pnpm-lock.yaml}`. This filter is DUPLICATED in both the engine path (`src/engine/dispatcher.ts`) and the dashboard path (`src/dashboard/lib/engine.ts`) because each has its own createRun implementation. NOTE (ADR-010): this seeding only applies to the full pipeline flow; the agile change flow live-mounts the real repo and skips seeding entirely.
**Consequences:** Workspaces are seeded leanly; no recursion; the sandbox agent's context starts small. The duplication of the exclude sets across two files is a known smell (both createRun paths must stay in sync); see INV-8.
**Enforced in:** `src/engine/dispatcher.ts` (COPY_EXCLUDE_DIRS/FILES + seedWorkspaceFromProject filter), `src/dashboard/lib/engine.ts` (duplicated).

## ADR-008: fillTemplate truncates interpolated context at 8000 chars
**Status:** Accepted (as-built, 2026-08-11; commit 9faa3cf; issue #3)
**Context:** The plan stage timed out because prior-stage artifacts interpolated into the user_prompt_template were unbounded -- a large discovery doc or PROJECT.md could push the prompt past the model's useful context window before the agent even started.
**Decision:** `AgentStageRunner.fillTemplate()` truncates every interpolated value: string values >8000 chars are sliced to 8000 + "\n...[truncated]"; JSON-stringified objects >8000 chars likewise. This is an engine-level backstop complementing the spec-level context discipline (ADR-006).
**Consequences:** No single interpolated value can exceed 8000 chars in the rendered prompt. Prior artifacts that exceed this lose their tail (the truncation marker is explicit). This guards against the plan-stage timeout root cause.
**Enforced in:** `src/agents/runner.ts` (fillTemplate, lines 202-210).
**Related:** ADR-006 (spec-level context discipline is the primary guard; this is the backstop).

## ADR-009: Engine-orchestrated build inner loop (supersedes ADR-001 spike refinement)
**Status:** Accepted (2026-08-11, issue #4)
**Context:** ADR-001's spike refinement (planning-doc ADR-001, lines 83-85) specified that the
primary agent inside the build sandbox dispatches anymake subagents via the Task tool. This proved
infeasible: headless `opencode run --auto` mode does not expose the Task tool, so a single sandbox
cannot spawn anymake's Orchestrator/Planner/Worker/Validator. The build stage collapsed to a single
agent attempting the entire backlog in one session, escalating on non-trivial work (run_0ba334d1:
17 stories, 1.27M tokens, 20-min timeout, escalated). The `inner_loop: anymake-build-loop` field in
`stage-graph.yaml` was loaded but never acted on.
**Decision:** The realcode ENGINE orchestrates the build inner loop. For each story (serially, per
planning-doc ADR-007): the engine spawns a Worker sandbox (one container, one story), then a Validator
sandbox (one container, one story). Each sandbox is a headless `opencode run --auto` invocation
(ADR-001's core Option B decision preserved). The engine reads the spec artifact's structured
`stories[]` array, tracks per-story state in `build-state.json`, and aggregates results into the
build artifact. The Planner and Product Owner Proxy roles from `pipeline-design.md` Stage 5 are
dropped (the Worker receives the story + prior artifacts directly; there is no per-story re-planning
gate for MVP). Implementation failures escalate immediately (deviates from planning-doc ADR-007's
max-1 re-dispatch — see issue #4 plan §4.2 reconciliation note).
**Consequences:** The build stage can ship non-trivial backlogs. Per-story cost tracking, per-story
retry ceilings, and per-story container isolation are enabled. The operator's opencode environment
(config, skills, MCP servers) is inherited by each sandbox via a configurable mount (issue #4 plan
§4.6) — authorized by issue #4's explicit request, with a startup secret-scan safeguard (§4.6.1).
**Supersedes:** ADR-001's spike refinement mechanism (in-sandbox Task-tool dispatch). ADR-001's core
Option B decision (headless opencode-in-sandbox) stands.
**Enforced in:** `src/engine/build-loop.ts`, `src/engine/dispatcher.ts`, `src/engine/engine-loop.ts`,
`src/agents/runner.ts` (specOverride/schemaKey/extraContext), `stage-graph.yaml` (worker_spec/validator_spec).
**Related:** planning-doc ADR-007 (retry matrix — deviates on implementation failure),
planning-doc ADR-003 (sandbox isolation — opencode-config mount is a new surface, safeguarded by §4.6.1).

## ADR-010: Conductor + dual-flow architecture (new-project pipeline vs agile change)
**Status:** Accepted (as-built, 2026-08-13; issue #16 / session 25; commit 16f4b7b)
**Context:** The original design ran every request through the full 6-stage pipeline
(frame -> discover -> plan -> spec -> build -> ship). For a simple change to an existing
project ("add a footer to realvol"), this is wildly disproportionate -- 6 stages, 20+ minutes,
several dollars, when a human developer would make the edit in 2 minutes. Conversely, a genuinely
new project ("build a CLI that...") does need the full pipeline. The system had no way to
distinguish the two, so every run paid the full-pipeline tax.
**Decision:** Add a **conductor** stage (stage 0) that classifies each request as `new` (full
pipeline) or `change` (agile flow), then branch the stage graph:

- **Conductor** (`stage.conductor: true`): runs a direct in-process LLM call (no container, ~5s,
  ~$0.001). Hybrid classification: (1) deterministic `[target: <project>]` tag or project-name
  mention -> change; (2) LLM classification for ambiguous requests; (3) fallback to `new` (safe
  default) on missing API key or network error. Writes `conductor.json`.
- **Full pipeline flow** (`classified_new`): the original frame -> discover -> plan -> spec ->
  build -> ship pipeline, with an ephemeral seeded workspace (ADR-007).
- **Agile change flow** (`classified_change`): a single `change` stage
  (`stage.live_mount: true`). The workspace is the REAL project repo, live-mounted read-write
  (no copy/seed) via `resolveLiveWorkspace()`. The change agent
  (`agent-specs/change.yaml`) makes the change directly (budget: 12 tool calls), runs tests,
  commits. For complex changes it can delegate to the `anymake-agile` Skill inside the sandbox.

**Branching is data-driven** (ADR-002): the conductor + change stages are YAML entries with
`conductor`/`live_mount` flags. The dispatcher checks these flags; no engine branching code.
The `agent_spec`/`inner_loop` XOR requirement in stage-graph.ts is relaxed for `conductor: true`
stages (the conductor has no agent_spec -- it's a direct engine call).

**Consequences:**
- Simple changes ship in minutes, not hours; cost drops from dollars to cents for change flows.
- The change flow operates on the LIVE repo -- a sandboxed agent has read-write access to a real
  project. This is a deliberate risk trade-off (the alternative -- copy + diff + apply -- is far
  more complex for MVP). Mitigation: the agent commits its work, so changes are reversible via git.
- The `anymake_phase`/`anymake_agents` fields in stage-graph.yaml are declarative labels only --
  no anymake code is imported at runtime. This is the D-7 drift (the project was designed to wrap
  anymake as a dependency, not reimplement it).
- A third flow (e.g. "hotfix") could be added as another YAML stage branching from a new conductor
  verdict, with no engine change.

**Enforced in:** `stage-graph.yaml` (conductor + change stages with flags), `src/engine/conductor.ts`
(classifyIntent, resolveLiveWorkspace, listAvailableProjects), `src/engine/dispatcher.ts`
(conductor branch + live_mount branch), `src/engine/stage-graph.ts` (conductor/live_mount schema
fields + XOR relaxation), `agent-specs/change.yaml`, `schemas/conductor.schema.json`,
`schemas/change.schema.json`.
**Related:** ADR-002 (declarative stage graph makes branching config-only), ADR-007 (seeding is
full-flow-only; change flow skips it), D-7 drift (anymake wrapping vs reimplementation).

## ADR-011: Live-state visibility system (live.json realtime channel)
**Status:** Accepted (as-built, 2026-08-13; issue #11; commit 16f4b7b)
**Context:** The dashboard's run-detail page showed stage artifacts only after a stage completed.
During a long build or a stuck stage, the operator had no visibility into what was happening
*right now* -- which container was running, what the agent was emitting, how many tokens were
burning. Phoenix traces existed but required a separate tool (localhost:6006) and were not
inline with the run-detail view.
**Decision:** Add a `live.json` realtime channel per run, written by the engine and read by the
dashboard. Key properties:

- **NOT a stage artifact** (INV-2): live.json is derived, transient, overwritten per stage, never
  schema-validated. Phoenix (ADR-005) remains the OTel trace collector of record.
- **Written at non-build stage start/end/catch** by the dispatcher (`writeLiveState`); the build
  loop writes it per story (containers + events).
- **Rolling trace events** (`appendLiveEvent`): truncates content to 500 chars, caps the window at
  200 events (drop oldest), coalesces bursts to 1 file rewrite / 250ms via a trailing timer,
  with a forced flush at stage end (`flushLiveEvents`) so the last event is never dropped.
- **Atomic writes** (tmp + rename, same pattern as control.json).
- **Never throws** -- live-state is best-effort observability; a write failure must never crash a
  stage or the engine.
- **Dashboard** (A11.3): the run-detail page renders a Pipeline Activity section
  (CurrentActivityBar + ContainerGrid + LiveTraceStream + ContainerLogViewer) whenever a live_state
  exists -- including terminal runs, not just active ones. This unblocks realtime visibility for
  non-build stages (frame, discover, plan, etc.), which previously had no live UI.

**Consequences:** The operator sees live container status, streaming trace events, and token/cost
totals inline on the run-detail page without switching to Phoenix. The coalescing + rolling window
bound the file size and write frequency. The "never throws" contract means a corrupted live.json
degrades gracefully (readLiveState returns null, the dashboard hides the section).
**Enforced in:** `src/engine/live-state.ts` (writeLiveState, readLiveState, appendLiveEvent,
flushLiveEvents, eventFromJsonLine), `src/engine/dispatcher.ts` (stage start/end/catch writes),
`src/engine/build-loop.ts` (per-story writes), `src/dashboard/lib/engine.ts` (getLiveState +
getRunDetail includes live_state), `src/dashboard/app/runs/[id]/page.tsx` (Pipeline Activity
section), `src/dashboard/components/{CurrentActivityBar,LiveTraceStream,ContainerGrid,ContainerLogViewer}.tsx`.
**Related:** ADR-005 (Phoenix is the trace collector of record; live.json is a convenience channel),
INV-2 (live.json is not a schema-validated stage artifact).

---

## Superseded Decisions

ADR-006's "no anymake doc reads" clause is superseded by ADR-012. The traversal-discipline clause of ADR-006 stands.

---

## ADR-012: Agents read anymake's real templates from the opencode cache + engine-orchestrated build loop is the sanctioned container-per-subagent model + ship fast-path is intentional
**Status:** Accepted (2026-08-15, issue #17)
**Context:** realcode's founding intent (PROJECT.md "Relationship to anymake") says it wraps anymake as a runtime dependency -- agents use anymake's real phase guides and templates, not frozen copies. In practice, ADR-006/INV-7 forbade agents from reading anymake docs entirely (because the files weren't at a known path), forcing every agent spec to inline anymake's template formats as frozen prompt text. Container logs from run_fe2c6d9e and run_663da9e6 prove anymake's templates ARE accessible in the sandbox at `/root/.cache/opencode/packages/anymake@git+https:/.../node_modules/anymake/{TEMPLATES,PHASE_GUIDES,PROJECT_TYPES}/` -- agents already found and read them via the `read` tool, but wasted context searching because the specs forbade it and didn't tell them where to look. Separately, the engine-orchestrated build loop (ADR-009) was treated as a necessary evil ("deviates from planning-doc") when it is actually the reporter's vision: "when the initial agent would normally spawn a subagent it instead spawns a fresh container with a primary agent but it has the anymake prompt and skills and context for that phase." The build loop already does this for Worker/Validator. Finally, ship.yaml's self-contained no-skill fast-path was treated as an oversight when it is a deliberate design choice.
**Decision:**
1. Agent specs (frame, discover, plan, spec) now point agents at anymake's real template files in the opencode cache path instead of inlining frozen format descriptions. The Skill tool is also listed in the allowlist where appropriate, but the primary mechanism is direct file reads (proven to work; the Skill tool has never been observed firing in headless `opencode run --auto`).
2. The ADR-006/INV-7 prohibition on reading anymake docs is removed. The traversal guard (node_modules/data/.git/dist/.next/coverage) is load-bearing and stays. A carve-out is added: agents MAY read files under the anymake cache path (it passes through a directory named `node_modules` but is not a traversal).
3. The engine-orchestrated build loop (ADR-009) is codified as the sanctioned container-per-subagent model -- not a deviation. PROJECT.md's "literally anymake's build loop" is revised to "the engine spawns fresh containers per subagent role (Worker, Validator), each with the anymake context."
4. ship.yaml's self-contained fast-path (3 bash calls, no skill invocation) is recorded as a deliberate design choice -- not drift. The ship stage trusts build test results and emits launch artifacts quickly.
5. The dead `build.yaml` (superseded by ADR-009's worker_spec/validator_spec) is deleted.
6. The Planner role stays dropped for MVP; logged to PARKING_LOT for future re-addition as an engine-orchestrated per-story container.
**Consequences:** Agent specs delegate to anymake's real templates -- any improvement anymake ships flows into realcode automatically (rebuild the sandbox image to pull). The frozen-snapshot drift is eliminated. The engine-orchestrated build loop is honestly documented. The ship fast-path is preserved.
**Enforced in:** `agent-specs/{frame,discover,plan,spec,ship,worker,validator,change}.yaml`, `docs/INVARIANTS.md` (INV-7 revised), `docs/SYSTEM_MAP.md` (D-7 resolved).
**Related:** ADR-006 (partially superseded -- traversal clause stands), ADR-009 (codified), ADR-010 (change agent's anymake-agile delegation is now functional).
