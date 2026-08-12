# realcode -- Decisions

**Last updated:** 2026-08-11 (cartographer refresh, post-issue #1/#3 + session 21)
**Code state:** 9faa3cf (master)

## Active Decisions

| ADR | Decision | Status |
|-----|----------|--------|
| ADR-001 | Headless opencode-in-sandbox as the agent invocation mechanism | Accepted |
| ADR-002 | Stage graph is declarative YAML, never engine code | Accepted |
| ADR-003 | Dashboard is thin control/observability only (agentic-harness manifest) | Accepted |
| ADR-004 | Real data, no mock placeholders in the dashboard | Accepted |
| ADR-005 | Phoenix tracing via OpenTelemetry OTLP/proto | Accepted |
| ADR-006 | Agent specs are self-contained -- no external file refs; context-discipline guards | Accepted |
| ADR-007 | Workspace seeding excludes data/tests/node_modules/lockfiles | Accepted |
| ADR-008 | fillTemplate truncates interpolated context at 8000 chars | Accepted |

---

## ADR-001: Headless opencode-in-sandbox as the agent invocation mechanism
**Status:** Accepted (2026-08-08, Phase 4 spike)
**Context:** realcode wraps anymake. Each pipeline stage needs to invoke an LLM agent (the anymake agent for that phase) with tool access (file read/write, bash) in an isolated workspace.
**Decision:** Use headless opencode running inside a Docker sandbox container. The sandbox has the workspace mounted, the agent spec's tool allowlist enforced, and network egress to the LLM provider. The AgentStageRunner spawns `opencode` as a subprocess inside the container.
**Consequences:** Isolation per run; tool allowlist enforced at the opencode level; the sandbox image must be pre-built (realcode-sandbox:latest). Alternative considered: direct API calls (rejected -- loses anymake's agent infrastructure).
**Enforced in:** `src/agents/runner.ts` (AgentStageRunner), `src/sandbox/`.

## ADR-002: Stage graph is declarative YAML, never engine code
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** The 6-stage pipeline (frame -> discover -> plan -> spec -> build -> ship) needs to be configurable without changing engine code.
**Decision:** The stage graph lives in `stage-graph.yaml`. Adding, reordering, or branching a stage is a config change, never engine code.
**Consequences:** The engine reads the YAML at startup; stage transitions are data-driven.
**Enforced in:** `stage-graph.yaml`, `src/engine/stage-graph.ts`, `src/engine/dispatcher.ts`.

## ADR-003: Dashboard is thin control/observability only (agentic-harness manifest)
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** realcode is an agentic-harness project type. The manifest specifies "Thin (control/observability only)" UI.
**Decision:** The dashboard has 3 screens: Runs board (/), Run detail (/runs/[id]), Settings (/settings). No auth, no billing, no marketing. Dark developer-observability aesthetic (Vercel/Linear/Langfuse reference).
**Consequences:** No user-facing product UI beyond the dashboard. The dashboard's job is to show what every agent did, what it cost, and where it paused.
**Enforced in:** `src/dashboard/app/` (3 routes only).

## ADR-004: Real data, no mock placeholders in the dashboard
**Status:** Accepted (2026-08-06, Phase 2 UX design)
**Context:** The dashboard must show real run data, not fake placeholders.
**Decision:** The board (page.tsx) polls the live /api/runs endpoint which reads real run.json files from data/runs/. The mock data in lib/data.ts is for type definitions and the getRun() function. The detail page must also use live data, not getRun() which returns mock.
**Consequences:** lib/data.ts contains both types AND mock data -- the mock data is NOT used by the board (which uses the live API). The detail page uses fetchRunDetail() -> live getRunDetail() (resolved post-launch, see Drift Log D-2).
**Enforced in:** `src/dashboard/lib/api.ts` (fetchRunDetail, usePoll), `src/dashboard/lib/engine.ts` (getRunDetail reads real files).

## ADR-005: Phoenix tracing via OpenTelemetry OTLP/proto
**Status:** Accepted (2026-08-11, session 17)
**Context:** Tracing was dead code (never initialized) + wrong exporter (JSON 415 -> proto 200).
**Decision:** Wire OpenTelemetry OTLP/proto exporter to Phoenix at localhost:6006. Per-stage spans.
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
**Decision:** `seedWorkspaceFromProject()` applies a filter excluding `COPY_EXCLUDE_DIRS = {node_modules, .git, dist, .next, .cache, data, tests}` and `COPY_EXCLUDE_FILES = {package-lock.json, yarn.lock, pnpm-lock.yaml}`. This filter is DUPLICATED in both the engine path (`src/engine/dispatcher.ts`) and the dashboard path (`src/dashboard/lib/engine.ts`) because each has its own createRun implementation.
**Consequences:** Workspaces are seeded leanly; no recursion; the sandbox agent's context starts small. The duplication of the exclude sets across two files is a known smell (both createRun paths must stay in sync); see INV-8.
**Enforced in:** `src/engine/dispatcher.ts` (COPY_EXCLUDE_DIRS/FILES + seedWorkspaceFromProject filter), `src/dashboard/lib/engine.ts` (duplicated).

## ADR-008: fillTemplate truncates interpolated context at 8000 chars
**Status:** Accepted (as-built, 2026-08-11; commit 9faa3cf; issue #3)
**Context:** The plan stage timed out because prior-stage artifacts interpolated into the user_prompt_template were unbounded -- a large discovery doc or PROJECT.md could push the prompt past the model's useful context window before the agent even started.
**Decision:** `AgentStageRunner.fillTemplate()` truncates every interpolated value: string values >8000 chars are sliced to 8000 + "\n...[truncated]"; JSON-stringified objects >8000 chars likewise. This is an engine-level backstop complementing the spec-level context discipline (ADR-006).
**Consequences:** No single interpolated value can exceed 8000 chars in the rendered prompt. Prior artifacts that exceed this lose their tail (the truncation marker is explicit). This guards against the plan-stage timeout root cause.
**Enforced in:** `src/agents/runner.ts` (fillTemplate, lines 202-210).
**Related:** ADR-006 (spec-level context discipline is the primary guard; this is the backstop).

---

## Superseded Decisions

_None. No decision has been overturned. ADR-004's "detail page must use live data" concern is now resolved (Drift Log D-2) but the decision itself stands._
