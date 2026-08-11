# realcode -- Decisions

**Last updated:** 2026-08-11

## ADR-001: Headless opencode-in-sandbox as the agent invocation mechanism
**Status:** Accepted (2026-08-08, Phase 4 spike)
**Context:** realcode wraps anymake. Each pipeline stage needs to invoke an LLM agent (the anymake agent for that phase) with tool access (file read/write, bash) in an isolated workspace.
**Decision:** Use headless opencode running inside a Docker sandbox container. The sandbox has the workspace mounted, the agent spec's tool allowlist enforced, and network egress to the LLM provider. The AgentStageRunner spawns `opencode` as a subprocess inside the container.
**Consequences:** Isolation per run; tool allowlist enforced at the opencode level; the sandbox image must be pre-built (realcode-sandbox:latest). Alternative considered: direct API calls (rejected -- loses anymake's agent infrastructure).

## ADR-002: Stage graph is declarative YAML, never engine code
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** The 6-stage pipeline (frame -> discover -> plan -> spec -> build -> ship) needs to be configurable without changing engine code.
**Decision:** The stage graph lives in `stage-graph.yaml`. Adding, reordering, or branching a stage is a config change, never engine code.
**Consequences:** The engine reads the YAML at startup; stage transitions are data-driven.

## ADR-003: Dashboard is thin control/observability only (agentic-harness manifest)
**Status:** Accepted (2026-08-06, Phase 2)
**Context:** realcode is an agentic-harness project type. The manifest specifies "Thin (control/observability only)" UI.
**Decision:** The dashboard has 3 screens: Runs board (/), Run detail (/runs/[id]), Settings (/settings). No auth, no billing, no marketing. Dark developer-observability aesthetic (Vercel/Linear/Langfuse reference).
**Consequences:** No user-facing product UI beyond the dashboard. The dashboard's job is to show what every agent did, what it cost, and where it paused.

## ADR-004: Real data, no mock placeholders in the dashboard
**Status:** Accepted (2026-08-06, Phase 2 UX design)
**Context:** The dashboard must show real run data, not fake placeholders.
**Decision:** The board (page.tsx) polls the live /api/runs endpoint which reads real run.json files from data/runs/. The mock data in lib/data.ts is for type definitions and the getRun() function (which should be replaced with live API calls in the detail page).
**Consequences:** lib/data.ts contains both types AND mock data -- the mock data is NOT used by the board (which uses the live API). The detail page must also use live data, not getRun() which returns mock.

## ADR-005: Phoenix tracing via OpenTelemetry OTLP/proto
**Status:** Accepted (2026-08-11, session 17)
**Context:** Tracing was dead code (never initialized) + wrong exporter (JSON 415 -> proto 200).
**Decision:** Wire OpenTelemetry OTLP/proto exporter to Phoenix at localhost:6006. Per-stage spans.
