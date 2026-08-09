# Security Review — realcode Phase 4 Step 4.5

**Date:** 2026-08-09
**Reviewer:** Claude (autonomous mode)
**Scope:** Full product (all 12 milestones, 72 tests)
**project_type:** agentic-harness

## Verdict: PASS

All agentic-harness gate criteria pass. Standard security checks pass with SaaS-specific items correctly skipped per the manifest's Gate Criteria Deltas. Two deferred hardening items (acceptable for dev/internal deployment; not blocking).

## Agentic-harness gate criteria (manifest deltas — all PASS):

1. **Declarative stage graph** — PASS. `engine.test.ts` asserts zero `if stage==` / `switch(stage)` in engine source. Stage graph is `stage-graph.yaml`, loaded + validated by Zod.
2. **Schema-validated output contract** — PASS. All 6 stages have Zod schemas with round-trip validation (14 schema tests). `AgentStageRunner` validates every artifact against its schema before advancing.
3. **Credential isolation** — PASS. `AgentStageRunner` passes no env vars to the sandbox. Docker mode inherits only PATH (not process.env). No secret-pattern env vars in Docker `-e` args. Verified by `security.test.ts`.
4. **Atomic claim/lease** — PASS. SQLiteQueue uses transactional `SELECT ... LIMIT 1` + `UPDATE` with `worker_id` + `lease_expires_at`. Verified by `backend.test.ts` ("two concurrent workers never claim the same item" — 20 items, 0 overlap).
5. **Complete trace for E2E run** — PASS. `e2e.test.ts` asserts all 6 stage artifacts carry `token_usage` + `trace_id`. OTel instrumentation (M7) emits run->stage->turn spans with traceparent injection.
6. **Cost cap circuit breaker** — PASS. `security.test.ts` verifies the breaker trips when `spent_usd >= cap_usd` and sets `paused_cost_cap`. Dispatcher honors `paused_cost_cap` (fixed this session).
7. **Control plane: pause/resume + single-step** — PASS. `e2e.test.ts` verifies step mode. CLI has `pause`/`resume`/`step` commands. ControlDoc supports all 4 modes.

## Standard security checks (adapted; SaaS items skipped per manifest):

- [x] No sensitive data in console logs — engine logs run status + cost only
- [x] API keys never in client-side code — LLM keys in env vars, not in dashboard bundle
- [x] No SQL injection — all SQLite queries use parameterized `?` placeholders
- [x] No XSS — React auto-escaping, no `dangerouslySetInnerHTML`
- [x] No hardcoded secrets — grep for API_KEY/SECRET/PASSWORD/TOKEN patterns found nothing
- [x] No `eval()` or dynamic code execution in engine/backend/agents
- [~] npm audit — 50 vulnerabilities (42 moderate, 7 high, 1 critical) in transitive deps (Next.js, OTel). Not blocking for dev/internal. Fix before any public-facing deployment.
- [N/A] Auth routes — skipped (headless engine; dashboard is internal-only)
- [N/A] HTTP security headers — skipped (dashboard is internal; deferred)
- [N/A] Core Web Vitals / performance — skipped (headless harness, not a web SaaS)

## Heightened security checks (manifest "Keep" — all PASS):

- [x] No secrets in sandbox image or mounted volume — AgentStageRunner passes no env; Docker mounts only the workspace
- [x] Resource limits per sandbox — Docker sets `--cpus 2`, `--memory 2g`, `--stop-timeout`, `--network realcode-sandbox-net`, `--rm` (verified by `security.test.ts`)
- [x] Downstream credentials scoped and revocable — no credentials mounted; LLM access via env var in engine; deploy creds via proxy (ADR-003)

## Deferred hardening items (not blocking):

1. **Tool-allowlist enforcement at sandbox boundary** — AgentSpecs declare tool allowlists (Read/Write/Bash/WebFetch/etc.), but the SandboxRunner doesn't technically enforce them at the Docker/opencode level. The allowlist is passed to the agent via the dispatch message (informational), not enforced by Docker egress rules or opencode agent config. Enforcement would require either opencode agent configuration with `allowedTools` in the sandbox's opencode.json, or Docker network egress rules per stage. **Priority: high before any untrusted work items.**

2. **Dashboard authentication** — no auth for MVP. Dashboard is internal-only (control/observability). Add auth before exposing to untrusted networks.

3. **npm audit** — 50 vulnerabilities in transitive dependencies. Run `npm audit fix` before public-facing deployment.

## Pipeline dry-run review (the agentic-harness gate replacement for the prototype gate):

The E2E integration test (`tests/integration/e2e.test.ts`, 6 tests) is the automated pipeline dry-run:
- A synthetic work item travels `intake -> framed -> discovered -> planned -> specified -> built -> shipped`
- All 6 stage artifacts exist in storage with correct schema
- Total spend stays under the $8 cost cap
- Each artifact carries token usage + trace_id
- The sandbox is called 6 times with the correct model + stage info
- Step mode advances one stage then re-pauses

All 6 tests pass. The pipeline dry-run review PASSES.
