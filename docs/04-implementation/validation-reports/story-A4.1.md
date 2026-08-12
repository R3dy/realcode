# Validation Report — Story A4.1: Contracts: per-story schemas + stage-graph XOR + optional BuildLoopRunner + ADR-009

**Created by:** Anymake Validator
**Created at:** 2026-08-11
**Story:** A4.1 — Contracts: per-story schemas + stage-graph XOR + optional BuildLoopRunner + ADR-009
**Branch:** story/A4.1-contracts-schemas-xor-rule
**PR:** #5
**Validation attempt:** 1

---

## Verdict Decision Tree

Worked through in order:
1. Any security check = FAIL? → NO (all security checks PASS)
1b. Any intent-consistency conflict, no superseding ADR? → NO (ADR-001 spike refinement superseded BY ADR-009, written in this PR; ADR-002/INV-1/INV-2/INV-7 all respected)
2. Any criterion = Human-Only with NO §3a scenario (SKIP)? → NO (all criteria are Code/Runtime; §3a Scenario 5 HTTP is environment-deferred, not human-only-skip)
3. Any criterion = SKIP (environment)? → NO (Docker scenario deferred to human per brief §3a Scenario 5 note, but its underlying acceptance criteria — "all existing suites pass", "graph unchanged", "XOR inert" — are already verified via Terminal scenarios 1-4)
4. Any criterion = FAIL? → NO
5. All criteria = PASS, DEFERRED (experience), or N/A? → YES → verdict = PASS

---

## VERDICT: PASS

---

## Acceptance Criteria Results

| # | Criterion | Type | Result | Evidence |
|---|-----------|------|--------|---------|
| 1 | `src/schemas/worker.ts` exports `WorkerOutput` + `WorkerArtifact` | Code | PASS | `src/schemas/worker.ts:5-29` — `WorkerArtifact` zod object with all required fields (story_id, result, failure_type?, failure_description?, branch, commits[], test_output, test_passed, test_failed, notes); `WorkerOutput = StageOutputBase.extend({ stage: z.literal("build_worker"), status: z.enum(["success","failed","escalated"]), artifact: WorkerArtifact })`; exports `workerJsonSchema` |
| 2 | `src/schemas/validator.ts` exports `ValidatorOutput` + `ValidatorArtifact` | Code | PASS | `src/schemas/validator.ts:5-37` — `ValidatorArtifact` with story_id, verdict, escalation_type?, criteria_results[], security_checklist[], notes; `ValidatorOutput` with `stage: "build_validator"`, `status: pass\|fail\|escalate`; exports `validatorJsonSchema` |
| 3 | `src/schemas/spec.ts` `SpecArtifact` gains required `stories: z.array(StorySpec).min(1)` + `.refine()` | Code | PASS | `src/schemas/spec.ts:5-24` — `StorySpec` zod object (id, title, epic?, acceptance_criteria[], depends_on[]); `stories: z.array(StorySpec).min(1)` is required (no `.optional()`); `.refine((data) => data.story_count === data.stories.length, { path: ["story_count"] })` |
| 4 | `src/schemas/build.ts` `BuildArtifact` gains optional `stories: z.array(StoryBuildResult).optional()` | Code | PASS | `src/schemas/build.ts:23-41` — `StoryBuildResult` with all required fields; `stories: z.array(StoryBuildResult).optional()` is additive (backward-compatible) |
| 5 | `src/schemas/index.ts` exports the new schemas | Code | PASS | `src/schemas/index.ts:4,5,7,8` — exports `StorySpec`, `StoryBuildResult`, `WorkerOutput/WorkerArtifact/workerJsonSchema`, `ValidatorOutput/ValidatorArtifact/validatorJsonSchema` |
| 6 | `src/engine/stage-graph.ts` `StageEntry`: `agent_spec` optional + `worker_spec`/`validator_spec` added | Code | PASS | `src/engine/stage-graph.ts:27-29` — `agent_spec: z.string().min(1).optional()`, `worker_spec: z.string().optional()`, `validator_spec: z.string().optional()` |
| 7 | `validateGraph()` enforces XOR rule (inert at A4.1) | Code | PASS | `src/engine/stage-graph.ts:108-145` — XOR between `agent_spec` and the inner_loop TRIAD (`inner_loop` + `worker_spec` + `validator_spec`); a stage with `agent_spec` + bare/dormant `inner_loop` (no worker/validator) is valid. `stage-graph.yaml` build stage still has `agent_spec: agent-specs/build.yaml` (line 96) + `inner_loop: anymake-build-loop` (line 81) — `git diff 9faa3cf..HEAD -- stage-graph.yaml` = empty (unchanged). `loadStageGraph(REAL_GRAPH)` succeeds (test: "loads the real stage-graph.yaml at A4.1") |
| 8 | ADR-009 written + ADR-001 supersede note | Code | PASS | `docs/DECISIONS.md:18` (table row), `:82-109` (full ADR-009 section: "Engine-orchestrated build inner loop", references issue #4, notes ADR-007 deviation); `:28` ADR-001 gains "Spike refinement superseded by ADR-009 (engine-orchestrated inner loop). Core Option B decision preserved." ADR-001 Status stays "Accepted" |
| 9 | `package.json` gains `export-schemas` script + schemas regenerated & committed | Runtime | PASS | `package.json:17` — `"export-schemas": "tsx scripts/export-schemas.ts"`. `npm run export-schemas` exits 0, writes 8 schema files including `worker.schema.json` + `validator.schema.json`. `git diff --exit-code schemas/` exits 0 (committed schemas match regenerated output) |
| 10 | `tests/integration/security.test.ts` updated for optional `agent_spec` + XOR rule assertion | Code | PASS | `tests/integration/security.test.ts:85-95` — tool-allowlist loop loads `stage.agent_spec ?? stage.worker_spec`, skips if neither. `:115-132` — new "every stage satisfies the XOR rule" test asserts no stage has both `agent_spec` AND the complete triad; build stage has `agent_spec` + no `worker_spec`. Cost-cap tests at `:192` and `:213` stay 5-arg `new Engine(graph, queue, storage, runner, tmpDir)` |
| 11 | Round-trip validation test (`tests/schemas/build-loop-schemas.test.ts`) | Runtime | PASS | `tests/schemas/build-loop-schemas.test.ts` — 16 tests pass. Covers: WorkerOutput valid/invalid (missing story_id, bad result enum, bad gate_verdict); ValidatorOutput valid/invalid; SpecArtifact with stories / no stories / empty / story_count mismatch; BuildArtifact with/without stories; StoryBuildResult invalid status; StorySpec valid/empty acceptance_criteria |
| 12 | Engine constructor gains optional 6th param `buildLoopRunner?: StageRunner` | Code | PASS | `src/engine/dispatcher.ts:91` — `private buildLoopRunner?: StageRunner` (optional). `tsc --noEmit` passes (exit 0). Existing 5-arg call sites typecheck: `src/engine-loop.ts:27`, `src/cli/index.ts:34`, `tests/integration/security.test.ts:192,213` |
| 13 | Dispatcher's missing-runner guard | Code | PASS | `src/engine/dispatcher.ts:220-226` — `if (stage.inner_loop && stage.worker_spec)` (NOT `inner_loop` alone) → throws `Error("Stage '<id>' has inner_loop but no BuildLoopRunner configured...")`. Caught by existing try/catch at `:269-275` → run escalates (never TypeError) |
| 14 | All existing suites pass at A4.1 (graph unchanged, XOR inert, 6th param backward-compatible, guard unreachable) | Runtime | PASS | `npm test` → 115/115 tests pass (90 existing + 25 new). `tests/schemas.test.ts:140,158` and `tests/integration/e2e.test.ts:68` updated to include required `stories` array (intentional backward-incompatible SpecArtifact change, noted in worker RESULT). `npm run typecheck` exits 0 |
| 15 | Error: SpecArtifact without `stories` / empty / `story_count` mismatch fails | Runtime | PASS | `tests/schemas/build-loop-schemas.test.ts:141-173` — "rejects a sample with no stories field", "rejects an empty stories array (min 1)", "rejects when story_count !== stories.length (refine)" all pass |
| 16 | Error: `validateGraph()` errors on both agent_spec AND triad; neither; inner_loop without worker/validator | Runtime | PASS | `tests/engine/stage-graph-xor.test.ts:104-145` — "rejects a stage with both agent_spec AND the inner_loop triad" (msg contains "cannot have both agent_spec and inner_loop"); "rejects a stage with neither agent_spec nor inner_loop" (msg contains "must have either agent_spec or inner_loop"); "rejects inner_loop without worker_spec/validator_spec" (msg contains "inner_loop requires both worker_spec and validator_spec") |
| 17 | Error: `dispatchCycle()` throws clear Error (not TypeError) when inner_loop + worker_spec but no buildLoopRunner | Runtime | PASS | `tests/engine/dispatcher-guard.test.ts:32-90` — 5-arg constructor, mutated build stage (agent_spec=undefined, inner_loop+worker_spec+validator_spec set); `dispatched === 1`, `runner.run` NOT called, `finalRun.status === "escalated"` (caught by try/catch) |
| 18 | Edge: XOR rule inert at A4.1 — build stage still has `agent_spec`, all 90 existing tests pass | Runtime | PASS | `stage-graph.yaml` unchanged (`git diff 9faa3cf..HEAD` = empty). `npm test` → all tests pass. `tests/engine/stage-graph-xor.test.ts:92-102` asserts real graph loads with build stage having `agent_spec` + dormant `inner_loop` + no `worker_spec` |
| 19 | Edge: 5-arg `Engine` call sites in `tests/integration/security.test.ts:166/187` stay 5-arg and typecheck | Code | PASS | `tests/integration/security.test.ts:192` and `:213` — both `new Engine(graph, queue, storage, runner, tmpDir)` (5-arg). `npm run typecheck` exits 0 |

---

## Security Checklist Results

| Check | Result | Evidence |
|-------|--------|---------|
| Non-public endpoints require authentication | N/A | realcode has no auth (INV-5); no new endpoints in A4.1 |
| User data access has authorization checks | N/A | no user data; single-operator tool |
| User input validated and sanitized | PASS | New zod schemas (`WorkerOutput`, `ValidatorOutput`, `SpecArtifact.stories` + `.refine()`) validate stage artifacts; XOR rule validates stage graph at load time |
| Database queries use parameterized queries | N/A | no new DB queries; SQLite queue unchanged |
| File upload validation | N/A | no file uploads |
| No secrets in committed code | PASS | Secret-pattern scan of `src/ tests/ scripts/ agent-specs/ docs/ schemas/` found no committed secrets; A4.1 adds schemas/validation/docs only |
| API responses don't expose internal fields | N/A | no new API endpoints |
| **Story-specific:** No new dependencies with vulnerabilities | PASS | `git diff 9faa3cf..HEAD -- package.json package-lock.json` — only the `export-schemas` script line added; no new dependencies (zod, zod-to-json-schema, tsx, vitest all pre-existing) |
| **Story-specific:** Optional constructor param truly optional (5-arg calls typecheck) | PASS | `tsc --noEmit` exits 0; `src/engine-loop.ts:27`, `src/cli/index.ts:34`, `tests/integration/security.test.ts:192,213` all use 5-arg constructor |
| **Story-specific:** XOR rule inert at A4.1 (build stage still has agent_spec in stage-graph.yaml) | PASS | `stage-graph.yaml` unchanged; build stage at line 96 has `agent_spec: agent-specs/build.yaml`; XOR's "cannot have both" only fires when triad is complete (line 121-124); build stage has no `worker_spec`/`validator_spec` → triad incomplete → no error |
| **Story-specific:** Dispatcher guard condition is `stage.inner_loop && stage.worker_spec` (NOT `inner_loop` alone) | PASS | `src/engine/dispatcher.ts:220` — `if (stage.inner_loop && stage.worker_spec)`. Confirmed by `tests/engine/dispatcher-guard.test.ts:92-130` — build stage at A4.1 (inner_loop set, no worker_spec) takes old `runner.run()` path |

---

## Intent-Consistency Results

| ADR / INV | Statement | Result | Evidence |
|-----------|-----------|--------|----------|
| ADR-001 | Headless opencode-in-sandbox (Option B) | RESPECTED | `docs/DECISIONS.md:28` — "Spike refinement superseded by ADR-009... Core Option B decision preserved." Status stays "Accepted". ADR-009 (`:104-105`) explicitly preserves the core decision |
| ADR-002 | Stage graph is declarative YAML | RESPECTED | `src/engine/stage-graph.ts:27-29` — additive optional fields on `StageEntry`; XOR rule is a validation constraint on declarative data; `stage-graph.yaml` NOT modified in A4.1 |
| ADR-008 | fillTemplate truncates at 8000 chars | N/A | not touched in A4.1 |
| INV-1 | Declarative stage graph (no hard-coded stage transitions in engine) | RESPECTED | `src/engine/dispatcher.ts:220` — branch reads graph DATA (`stage.inner_loop && stage.worker_spec`), not a hard-coded stage ID |
| INV-2 | Schema-validated outputs | RESPECTED | `src/schemas/worker.ts`, `validator.ts`, `spec.ts` (.refine), `build.ts` — all zod-validated; JSON Schema exported via `scripts/export-schemas.ts` |
| INV-7 | Agent specs self-contained | RESPECTED | `agent-specs/spec.yaml:39-47,64-68` — adds `stories` output instruction (no new external file references). Pre-existing INV-7 violation (references `PHASE_GUIDES/phase-3.md`) NOT fixed (out of scope) and NOT made worse |

---

## Environment / Test Run Summary

**Test suite result:** passed 115/115 tests (10 test files: 90 existing + 25 new across `tests/schemas/build-loop-schemas.test.ts` [16], `tests/engine/stage-graph-xor.test.ts` [6], `tests/engine/dispatcher-guard.test.ts` [2], + 1 new XOR assertion in `security.test.ts`)
**Lint result:** clean (worker reported; not re-run — `npm run lint` targets `src/` only and typecheck passed)
**Typecheck result:** `npm run typecheck` (tsc --noEmit) exits 0 — clean
**Schema export result:** `npm run export-schemas` exits 0; `git diff --exit-code schemas/` exits 0 (committed schemas match regenerated output)
**Notes:**
- §3a Scenario 5 (HTTP pipeline run) requires Docker Compose + `realcode-sandbox:latest` + `OPENROUTER_API_KEY` — deferred to the human per brief §3a Scenario 5 note ("If Docker is unavailable, this scenario is deferred to the human"). Its underlying acceptance criteria (graph unchanged, XOR inert, all suites pass) are already verified via Terminal Scenarios 1-4.
- Worker added a defensive guard in `src/agents/runner.ts:54-59` (throws if `stage.agent_spec` is undefined) — this is a type-level fix for the now-optional field, NOT the `specOverride`/`schemaKey`/`extraContext` 4th param (correctly deferred to A4.2/A4.4). Acceptable.
- `tests/schemas.test.ts` and `tests/integration/e2e.test.ts` were updated to include the now-required `stories` array in SpecArtifact mocks — necessary because SpecArtifact.stories is intentionally backward-incompatible (noted in worker RESULT).
- Base branch `issue/4-multi-container-build-loop` was pushed to remote by the worker (noted in RESULT) — informational, no validation concern.
