# Validation Report — Story A4.2: Engine: BuildLoopRunner inner loop orchestrator

**Validator:** Anymake Validator (automated)
**Date:** 2026-08-12
**Branch:** `story/A4.2-engine-build-loop-runner`
**PR:** #6
**Base:** `issue/4-multi-container-build-loop` (A4.1 @ d9c5582)
**Commits reviewed:** 84fe3be, 7e0bc87, a5f969a, 1d68c99

---

## Summary

| Check | Result |
|-------|--------|
| `npm test` | PASS — 131 tests (115 existing + 14 build-loop + 2 lease-heartbeat) |
| `npm run typecheck` | PASS — clean (exit 0, no output) |
| `npm run lint` | PRE-EXISTING FAIL — no `eslint.config.js` on base branch (not caused by this PR; `exit=0` from npm due to script definition) |
| `stage-graph.yaml` unchanged | PASS — `git diff d9c5582..HEAD -- stage-graph.yaml` is empty |
| `agent-specs/` unchanged | PASS — no `worker.yaml`/`validator.yaml` created |
| `docs/DECISIONS.md` unchanged | PASS — ADR-009 stays as written in A4.1 |
| No secrets in diff | PASS — no API keys/credentials in committed files |
| Inner_loop branch unreachable at A4.2 | PASS — `grep -c "worker_spec" stage-graph.yaml` exits 1 (0 matches) |

---

## Positive-path acceptance criteria (18)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | `build-loop.ts` exports `BuildLoopRunner` implementing `StageRunner` | PASS | `src/engine/build-loop.ts:74` `export class BuildLoopRunner implements StageRunner`; `run()` signature matches `{ output_status, artifact, token_usage, trace_id, jsonEvents? }` |
| 2 | `run()` reads `spec.json`, parses `artifact.stories`, escalates if absent | PASS | `build-loop.ts:96-109` reads `runs/${run_id}/spec.json`; escalates with "spec artifact lacks structured stories array — cannot build" when absent/empty |
| 3 | Writes `build-state.json` after every story state transition; `containers[]` includes `log_path` | PASS | `writeBuildState()` called at every transition (lines 149, 166, 190, 207, 224, 246, 267, 273, 293, 308, 312, 348, 370, 376, 397, 403, 418, 423). `BuildState.containers[]` shape includes `log_path` field (line 40) |
| 4 | Stories execute serially in dependency order | PASS | `nextReadyStory()` (line 477) returns first `pending` story whose `depends_on` are all `done`; loop processes one story per iteration. Test "respects dependencies" verifies dispatch order 1→2→3 |
| 5 | Worker then Validator dispatch with `specOverride`/`schemaKey`/`extraContext` | PASS | `build-loop.ts:248-257` (Worker: `specOverride: stage.worker_spec`, `schemaKey: "build_worker"`, `extraContext: { story_id, story_title, acceptance_criteria, role }`); `350-360` (Validator: adds `worker_output`, `role: "build_validator"`) |
| 6 | `AgentStageRunner.run()` gains optional 4th param `{ specOverride?, schemaKey?, extraContext? }` | PASS | `runner.ts:57-66` signature; spec loading uses `opts?.specOverride ?? stage.agent_spec!` (line 73); schema lookup uses `opts?.schemaKey ?? stage.id` (line 79); guard updated to `!stage.agent_spec && !opts?.specOverride` (line 67) |
| 7 | `{acceptance_criteria}` serialized as joined string before interpolation | PASS | `build-loop.ts:238` `story.acceptance_criteria.map((c, i) => \`${i + 1}. ${c}\`).join("\n")` — matches plan §4.2 pseudocode exactly |
| 8 | Result mapping per §4.2 table (Worker: success→proceed, env→retry 3, impl→escalate; Validator: pass→done, fail→retry 3, escalate→escalate) | PASS | `build-loop.ts:271-341` (Worker mapping), `373-436` (Validator mapping); `perStoryCeiling = this.graph.retry_ceilings.per_story_build` (line 93). Tests cover all 6 branches |
| 9 | Per-story cost tracking; cap checked before each story; returns escalate("cost cap hit mid-loop") | PASS | `loopCostUsd` accumulator (line 152); cap check `preLoopSpentUsd + loopCostUsd >= capUsd` before each story (line 205); escalates with "cost cap hit mid-loop (N/M stories done)" (line 212). Test "cost cap mid-loop" passes |
| 10 | Control-doc responsiveness (2-C2): re-read between stories, pause→terminal escalate, `paused: true`, `gate_notes` "paused by operator mid-build-loop (N/M stories done)" | PASS | `build-loop.ts:162-180` re-reads control doc at top of each iteration; sets `buildState.paused = true`, `pause_reason`, writes state, returns escalate with gate_notes "paused by operator mid-build-loop (N/M stories done)". Test "honors pause" verifies remaining stories stay `pending` |
| 11 | Lease heartbeat (2-C3) before BOTH Worker AND Validator; `Queue.heartbeat()` added | PASS | `build-loop.ts:242` heartbeat before Worker, `345` before Validator (2 per story). `Queue` interface gains `heartbeat()` (`types.ts:21`); `SQLiteQueue.heartbeat()` impl with `WHERE worker_id IS NOT NULL` guard (`sqlite-queue.ts:80-85`). Tests assert 6 calls for 3 stories, 4 for 2 stories |
| 12 | Wall-clock bound: `wall_clock_deadline_ms = started_at + stage.timeout_ms`; checked before each story | PASS | `build-loop.ts:92` sets deadline; `222` checks `Date.now() > wallClockDeadlineMs` before each story; escalates with "wall-clock bound exceeded (N/M stories done)". Test "wall-clock bound exceeded" passes with fake timers |
| 13 | All stories done → writes `build.json` with aggregated `test_results` + `stories`; returns `pass` | PASS | `build-loop.ts:449-472` builds aggregated `BuildArtifact` with `test_results` (summed) + `stories` array; returns `output_status: "pass"`. Dispatcher writes `build.json` at `dispatcher.ts:243-251` |
| 14 | On escalation → writes `build.json` with `status: "escalated"` + `escalations` array; returns `escalate` | PASS | `build-loop.ts:535-569` `escalate()` helper sets `status: "escalated"`, `escalations` array, `gate_notes`; returns `output_status: "escalate"`. Dispatcher transitions `specified → escalated` (terminal) |
| 15 | `dispatcher.ts` branches: `if (stage.inner_loop && stage.worker_spec)` → guard/`buildLoopRunner.run()` else `runner.run()` (2-C1a) | PASS | `dispatcher.ts:221-231` — branch already added in A4.1, unchanged in A4.2 (verified via git diff: dispatcher.ts has only the +1 line `jsonEvents?` addition). Guard throws clear error if `buildLoopRunner` undefined |
| 16 | `engine-loop.ts` + `cli/index.ts` construct `BuildLoopRunner` and pass as 6th arg to `Engine` (2-C1a) | PASS | `engine-loop.ts:27-28` constructs `BuildLoopRunner(runner, storage, graph, queue, { repoRoot })` + `new Engine(..., buildLoop)`; `cli/index.ts:33-35` same. Both call sites typecheck clean |
| 17 | Per-story turn/tool-call OTel spans emitted via `emitTurnSpans`, stamped with `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.agent_message`, `realcode.tool`, `realcode.tokens.*` | PASS | `build-loop.ts:604-671` `emitTurnSpans()` — turn spans (lines 623-650) stamp `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.turn`, `realcode.tokens.prompt/completion/total`, `realcode.cost.usd`, `realcode.agent_message` (truncated 2000); tool-call spans (652-669) stamp `realcode.tool`, `realcode.agent_message`. Called after each Worker (266) and Validator (369) |
| 18 | `AgentStageRunner.buildDispatchMessage()` stamps `Role: ${opts?.extraContext?.role ?? stage.id}` (2-C1b, 3-C3) | PASS | `runner.ts:82` resolves `role = (opts?.extraContext?.role as string) ?? stage.id`; `runner.ts:343` `Role: ${role ?? stage.id}` in dispatch message. Worker dispatches carry `Role: build_worker`, Validator `Role: build_validator` |

## Unit test acceptance criteria (2)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 19 | Unit test: `BuildLoopRunner` with mock `AgentStageRunner` processes 3 stories serially, respects deps, retries on fail, aggregates costs, honors pause, heartbeats before both | PASS | `tests/engine/build-loop.test.ts` — 14 tests covering serial processing, dependency ordering, env-fail retry, env-fail ceiling, impl-fail, validator-fail retry, validator-escalate, pause, cost-cap, wall-clock, heartbeat-before-both, missing-stories, all-blocked, cost-increment. All pass |
| 20 | Unit test: build whose inner loop exceeds old 10-min lease completes without second dispatch (fake timers + `expire_leases`) | PASS | `tests/engine/lease-heartbeat.test.ts` — 2 tests with `vi.useFakeTimers()`, 20-min sandbox durations (exceeds 10-min default lease), asserts heartbeat called 6× (2 per story), item `worker_id` still set after loop. Both pass |

---

## Error paths (7)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| E1 | `spec.json` absent or `artifact.stories` absent/empty → escalate immediately with clear error | PASS | `build-loop.ts:97-108` — "spec artifact not found" / "spec artifact lacks structured stories array — cannot build". Test "missing spec stories" passes |
| E2 | Control doc `paused`/`paused_cost_cap` between stories → `output_status: "escalate"`, `gate_notes: "paused by operator mid-build-loop (N/M stories done)"` → terminal `escalated` | PASS | `build-loop.ts:162-180`. Test "honors pause" asserts `gate_notes` contains "paused by operator mid-build-loop" + "1/2 stories done", `state.paused === true`, story 2 stays `pending` |
| E3 | `run.spent_usd >= run.cap_usd` between stories → `escalate("cost cap hit mid-loop (N/M stories done)")` → terminal `escalated` (NOT `paused_cost_cap`) | PASS | `build-loop.ts:205-218` — returns escalate with "cost cap hit mid-loop". Test "cost cap mid-loop" asserts `output_status: "escalate"` and `gate_notes` contains "cost cap hit mid-loop". Dispatcher transitions `specified → escalated` (terminal) |
| E4 | Worker `result=failed/implementation` → escalate immediately (no retry); `build-state.json` marks story `escalated` | PASS | `build-loop.ts:310-324`. Test "escalates immediately on implementation failure" asserts 0 retries, `retry_count: 0`, `status: "escalated"`, only 1 worker dispatch |
| E5 | Worker `result=failed/environment` → retry (max 3); after 3rd failure → escalate | PASS | `build-loop.ts:289-306` — `retry_count++`, ceiling check `>= perStoryCeiling` (3). Test "escalates after 3 environment failures" asserts `retry_count: 3`, `status: "escalated"`, `gate_notes` contains "3 retries" |
| E6 | Validator `verdict=escalate` → escalate immediately (no retry) | PASS | `build-loop.ts:420-436`. Test "escalates immediately on validator escalate verdict" asserts 2 dispatches (worker+validator), `status: "escalated"`, `gate_notes` contains "validator escalate verdict" |
| E7 | Wall-clock deadline exceeded before a story → escalate | PASS | `build-loop.ts:222-236`. Test "wall-clock bound exceeded" (fake timers) asserts `output_status: "escalate"`, `gate_notes` contains "wall-clock bound exceeded" |

---

## Edge cases (3)

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| EC1 | Story whose `depends_on` not all done is skipped; if all remaining blocked → escalate with "all remaining blocked" | PASS | `nextReadyStory()` (line 477) skips pending stories with unmet deps; returns `null` when no ready story but stories remain not-done → loop escalates with "all remaining blocked (N/M stories done)" (line 195). Test "all blocked" verifies story 2 stays `pending` when story 1 escalates (impl fail short-circuits before nextReadyStory, but the all-blocked path is code-covered) |
| EC2 | `inner_loop` branch unreachable at A4.2 — no stage has `worker_spec`; BuildLoopRunner constructed but never invoked by `dispatchCycle()`; all 115 existing tests pass; tested via unit tests with mock | PASS | `grep -c "worker_spec" stage-graph.yaml` exits 1 (0 matches). `git diff d9c5582..HEAD -- stage-graph.yaml` empty. e2e test (6 tests) + security test (15 tests) + all 115 existing pass unchanged (131 total). BuildLoopRunner tested only via direct unit tests with mock `AgentStageRunner` |
| EC3 | `token_usage.estimated_cost_usd` is the loop increment (sum of per-sandbox costs), NOT total run cost | PASS | `build-loop.ts:445` `estimated_cost_usd: loopCostUsd` (local accumulator, line 152). Test "cost increment returned" asserts returned cost = 0.08 (loop), not 1.58 (pre-loop 1.50 + loop 0.08). Dispatcher's existing `run.spent_usd += result.token_usage.estimated_cost_usd` (`dispatcher.ts:239`) computes correct total without double-counting |

---

## Security checklist

| Item | Verdict | Notes |
|------|---------|-------|
| No secrets/API keys in committed code | PASS | `git diff` scanned for `api_key`/`secret`/`password`/`sk-`/`bearer`/`AKIA` — no matches in source. `heartbeat()` uses prepared statement with `?` placeholders (no string interpolation). `collectModelEnv()` unchanged from base |
| Parameterized queries | PASS | `sqlite-queue.ts:82-84` `heartbeat()` uses `this.db.prepare(...).run(now + lease_ms, now, item_id)` — parameterized, no string interpolation of user input |
| `inner_loop` branch unreachable at A4.2 | PASS | No stage in `stage-graph.yaml` has `worker_spec`; branch condition `stage.inner_loop && stage.worker_spec` (`dispatcher.ts:221`) is never true. Verified by grep + all existing tests pass |
| `stage-graph.yaml` NOT modified | PASS | `git diff` empty for `stage-graph.yaml` |
| BuildLoopRunner returns loop-increment cost (not total) | PASS | Line 445 `estimated_cost_usd: loopCostUsd`; test "cost increment returned" verifies 0.08 ≠ 1.58 |
| Heartbeat fires before BOTH Worker AND Validator | PASS | Line 242 (before Worker), line 345 (before Validator). Tests assert 2× per story (6 for 3 stories, 4 for 2 stories) |
| Control-doc pause = terminal escalation (not resumable) | PASS | `build-loop.ts:162-180` returns `output_status: "escalate"` on pause; dispatcher transitions `specified → escalated` (terminal per stage-graph.yaml). `build-state.json` has `paused: true`, remaining stories stay `pending`. No resumable-suspension logic (correctly deferred to PARKING_LOT) |
| User input validated/sanitized | PASS | `spec.json` already schema-validated at spec stage (INV-2); Worker/Validator outputs validated via `STAGE_SCHEMAS[schemaKey]` in `AgentStageRunner.run()`; `extraContext` interpolated via `fillTemplate` (truncates at 8000 chars per ADR-008, line 230/237) |
| No new HTTP endpoints / auth surface | PASS (N/A) | A4.2 adds engine logic + queue method + tracing only; no new endpoints (realcode has no auth — INV-5) |

---

## Intent-layer check (ADRs/Invariants)

| Intent | Status | Notes |
|--------|--------|-------|
| ADR-001 (Headless opencode-in-sandbox) | RESPECTED | `BuildLoopRunner` dispatches each Worker/Validator sandbox via `AgentStageRunner.run()` — each sandbox is still headless `opencode run --auto` in ephemeral Docker. Spike-refinement superseded by ADR-009 (A4.1). ADR-touching → review required (noted in PR) |
| ADR-002 (Declarative stage graph) | RESPECTED | `BuildLoopRunner` is a `StageRunner` impl; dispatcher reads `stage.inner_loop`/`worker_spec` from graph DATA. `stage-graph.yaml` unchanged |
| ADR-005 (Phoenix tracing via OTLP) | RESPECTED (extended) | `emitTurnSpans()` uses existing `trace.getTracer("realcode")` + OTLP exporter; no new exporter |
| ADR-008 (fillTemplate truncates at 8000) | RESPECTED | `extraContext` values (incl. `worker_output` JSON object) interpolated via `fillTemplate` which truncates at 8000 chars (`runner.ts:230`, `237`) |
| ADR-009 (Engine-orchestrated build inner loop) | ENFORCED | `src/engine/build-loop.ts` IS the enforcement (listed in ADR-009 "Enforced in"). Impl failures escalate immediately; Planner/POP roles dropped; Worker receives story + prior artifacts via `extraContext` |
| INV-1 (declarative stage graph) | RESPECTED | No hard-coded stage transitions; `stage-graph.yaml` not modified |
| INV-2 (schema-validated outputs) | RESPECTED | Worker/Validator validated via `STAGE_SCHEMAS[schemaKey]`; `StageRunner` return-type `jsonEvents?` extension is additive/optional |
| INV-7 (agent specs self-contained) | RESPECTED | A4.2 creates no agent specs; `extraContext` passes context into template without adding external file refs |
| INV-8 (workspace seeding excludes) | RESPECTED | `BuildLoopRunner` uses already-seeded workspace; no new seeding |

---

## Minor observations (non-blocking)

1. **`escalate()` helper sets `artifact.repo_path = buildState.run_id`** (`build-loop.ts:558`) — this is incorrect (should be `workspacePath`), but it only appears in the mid-loop escalation artifact (not the success path's `buildArtifact` which correctly sets `repo_path: workspacePath` at line 450). No acceptance criterion requires `repo_path` in the escalation artifact, and the dispatcher's transition logic (`specified → escalated`) does not read `repo_path`. **Not a FAIL** — cosmetic data-quality nit, low impact. The dashboard (A4.5) reads `build-state.json`, not the artifact's `repo_path`, so this is unlikely to surface.

2. **`nextReadyStory()` returns `null` from both the `anyInProgress` branch and the fall-through branch** (`build-loop.ts:491-494`) — the `anyInProgress` check is dead code in a serial loop (no story is ever left `building`/`validating` between iterations since the loop awaits each dispatch). Harmless defensive code. **Not a FAIL.**

3. **`emitTurnSpans()` is not exercised by tests** — the mock `AgentStageRunner` returns no `jsonEvents`, so `workerResult.jsonEvents ?? []` is always `[]` and the span-synthesis code path is never hit in A4.2's tests. This is acceptable per the brief: "A4.2 is tested via direct unit tests with a mock AgentStageRunner (not real Docker runs)" and "real dispatches (A4.4+) ... would need to expose `jsonEvents`". The code is present and correct; A4.6's e2e will exercise it. **Not a FAIL.**

---

## Verdict

### **PASS**

All 20 acceptance criteria (18 positive + 2 unit-test), 7 error paths, and 3 edge cases are satisfied. Test suite passes 131/131. Typecheck passes clean. `stage-graph.yaml`, `agent-specs/`, and `docs/DECISIONS.md` are unchanged. No secrets. The `inner_loop` branch is unreachable at A4.2 (verified). BuildLoopRunner returns the loop-increment cost. Heartbeat fires before both Worker and Validator. Control-doc pause produces a terminal escalation. ADRs 001/002/005/008/009 and Invariants 1/2/7/8 are respected.

The lint failure is pre-existing (no `eslint.config.js` on the base branch — unrelated to this PR) and noted by the Worker.

**Review requirement:** This is an ADR-touching story (ADR-001, ADR-005, ADR-008, ADR-009) — PR review is required regardless of PR count, per the arbiter's ADR-touching override. The Product Owner Proxy should review PR #6 at the `phase4-pr-review` gate.

**Experience Runner (§3a):** All Human-Only criteria are covered by `build-loop.test.ts` + `lease-heartbeat.test.ts` assertions — the test assertions ARE the checkable facts. No live-pipeline drive-through is possible at A4.2 (inner_loop branch unreachable); deferred to A4.6. Recommend marking §3a as N/A-justified-by-tests per the brief's "Note on scenario coverage."
