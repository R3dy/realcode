# Task Brief — [Story A4.6: Integration — un-skip e2e + build-loop integration tests + docker-compose sandbox target]

**Created by:** Anymake Planner (self-dispatched combined Planner+Worker)
**Created at:** 2026-08-12T00:00:00Z
**Project:** realcode
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## 1. Story Identity

**Story ID:** A4.6
**Story title:** Integration — un-skip e2e + build-loop integration tests + docker-compose sandbox target
**Epic:** Epic A4 — Build inner loop (Issue #4: multi-container build loop)
**Milestone:** Issue #4 build loop (stories A4.1 → A4.6)
**Priority:** Must Have
**This is PR #:** #6 (sixth PR for issue #4 — past the first-3 review rule)

---

## 2. User Story

**As a** realcode operator
**I want** the full pipeline testable end-to-end with the build loop wired in
**So that** the e2e test passes with 0 skipped and the multi-container build loop is verified through the Engine → Dispatcher → BuildLoopRunner → AgentStageRunner → mock sandbox stack.

---

## 3. Acceptance Criteria

- [ ] e2e test (`tests/integration/e2e.test.ts`) is un-skipped (`describe.skip` → `describe`) and passes
- [ ] Canned `STAGE_ARTIFACTS.spec` has a valid `stories` array (8 entries, satisfying the `.refine()` from A4.1)
- [ ] Canned `WorkerOutput` and `ValidatorOutput` artifacts (`build_worker`, `build_validator` keys in `STAGE_ARTIFACTS`)
- [ ] `makeMockSandbox` keys on `Role:\s*(\w+)` (falling back to `Stage:\s*(\w+)` for non-build stages)
- [ ] Engine gains a real `BuildLoopRunner` (6-arg constructor) wrapping the mock-sandbox `AgentStageRunner`
- [ ] Sandbox call count = 5 non-build + 8×2 build = 21 total (test updated from 6 to 21)
- [ ] `tests/integration/build-loop-e2e.test.ts` — new integration tests (full build loop, escalation, cost cap, dependency ordering, validator escalate)
- [ ] Lease-heartbeat regression test still passes
- [ ] `docker compose build sandbox` exits 0
- [ ] `npm test` — ALL tests pass (206), 0 skipped
- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — 0 errors

---

## 5. Build Order

1. Update e2e: canned build_worker/build_validator artifacts, mock sandbox Role: keying, Engine with BuildLoopRunner, sandbox call count 21
2. Un-skip the e2e (`describe.skip` → `describe`)
3. Create `tests/integration/build-loop-e2e.test.ts` (full build loop, dependency ordering, cost cap, escalation, validator escalate)
4. Verify `docker compose build sandbox` exits 0
5. Run full test suite — 0 skipped

---

## 6. Build Order Constraint

Before this story: A4.1 (Contracts), A4.2 (Engine), A4.3 (Sandbox), A4.4 (Agent specs + graph flip), A4.5 (Dashboard) — all `✅ Done` on `issue/4-multi-container-build-loop`.

---

## 10. RESULT

**result:** success
**failure_type:** *(omit if success)*
**pr_url:** https://github.com/R3dy/realcode/pull/10
**pr_number:** 10
**branch:** story/A4.6-integration-e2e
**base:** issue/4-multi-container-build-loop
**commits:**
- 6e0605e test(A4.6): un-skip e2e + build-loop integration tests + docker-compose sandbox target (#4)
**test_output:** passed (206 tests, 0 skipped; 19 test files passed. 200 original [194 + 6 un-skipped e2e] + 6 new build-loop integration = 206)
**lint_output:** clean (0 errors; 6 pre-existing warnings — none in A4.6 files)
**typecheck:** clean (root `tsc --noEmit` exits 0)

**notes for the orchestrator / reviewer:**

1. **e2e un-skipped:** The `describe.skip` from A4.4 is removed. The Engine is now constructed 6-arg with a real `BuildLoopRunner` wrapping the mock-sandbox `AgentStageRunner`. The mock sandbox keys on `Role:\s*(\w+)` first (returning `build_worker`/`build_validator` canned artifacts for build dispatches), falling back to `Stage:\s*(\w+)` for non-build stages. All 6 e2e tests pass.

2. **Canned spec stories:** The spec artifact already had a valid `stories` array with 8 entries (added in A4.4) satisfying the `.refine()` — `story_count === stories.length` (8 === 8). No change needed there.

3. **Canned worker/validator artifacts:** `STAGE_ARTIFACTS` gains `build_worker` (canned `WorkerOutput` with `result: "success"`, `gate_verdict: "pass"`) and `build_validator` (canned `ValidatorOutput` with `verdict: "pass"`, `gate_verdict: "pass"`). The mock injects the per-story `story_id` from the dispatch message (`Implement story E1.1:` / `Validate story E1.1:`) so the canned artifact matches the story being processed.

4. **Sandbox call count = 21:** The "sandbox called N times" test is updated from 6 to 21 (5 non-build stages + 8 stories × 2 worker+validator = 21). The test also verifies the Role sequence (non-build roles match stage; build alternates `build_worker`/`build_validator` 8 times each) and the Stage sequence (frame, discover, plan, spec, build×16, ship).

5. **New integration test file:** `tests/integration/build-loop-e2e.test.ts` — 6 tests exercising the full Engine → Dispatcher → BuildLoopRunner → AgentStageRunner → mock sandbox stack:
   - Full 3-story build loop happy path (specified → built, Worker→Validator per story, build-state.json, cost tracking)
   - build-state.json per-story tokens/cost written
   - Escalation on worker implementation failure (gate_verdict escalate → run escalated, 1 sandbox call)
   - Escalation on validator escalate verdict (gate_verdict pass, verdict escalate → run escalated, 2 sandbox calls)
   - Cost cap mid-loop (cap=0.15, story 1 costs 0.16 ≥ 0.15 → escalate before story 2, 1/3 done)
   - Dependency ordering (S1→S2→S3, dispatch order respects depends_on)

6. **Lease-heartbeat regression:** `tests/engine/lease-heartbeat.test.ts` (2 tests from A4.2) passes unchanged with the updated e2e.

7. **docker-compose sandbox target:** `docker compose build sandbox` exits 0 (all layers cached — the Dockerfile.sandbox and docker-compose.yml from A4.3 are correct and need no changes).

8. **Constraints respected:** No modifications to `stage-graph.yaml`, `agent-specs/`, `src/engine/build-loop.ts`, or `src/sandbox/` — this is an integration test + config story only. All changes are in `tests/integration/e2e.test.ts` (modified) and `tests/integration/build-loop-e2e.test.ts` (new).
