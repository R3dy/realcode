# Task Brief — [Story A4.4: Agent specs: worker.yaml + validator.yaml]

**Created by:** Anymake Planner (self-dispatched combined Planner+Worker)
**Created at:** 2026-08-12T00:00:00Z
**Project:** realcode
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## 1. Story Identity

**Story ID:** A4.4
**Story title:** Agent specs: worker.yaml + validator.yaml
**Epic:** Epic A4 — Build inner loop (Issue #4: multi-container build loop)
**Milestone:** Issue #4 build loop (stories A4.1 → A4.6)
**Priority:** Must Have
**This is PR #:** #4 (fourth PR for issue #4)

---

## 2. User Story

**As a** BuildLoopRunner
**I want** self-contained Worker and Validator agent specs
**So that** each per-story sandbox knows exactly what to do.

---

## 3. Acceptance Criteria

Copied **verbatim** from `docs/06-agile/issue-4/plan.md` §9 Story A4.4.

- [x] `agent-specs/worker.yaml` exists and is valid per `AgentSpecSchema` (zod parse passes)
- [x] `worker.yaml` system_prompt is self-contained (INV-7): all instructions inlined, no external file refs, context-discipline guards (no node_modules/data/.git/dist/.next/coverage traversal, no anymake doc reads)
- [x] `worker.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{workspace}`, `{plan.prd_md}`, `{frame.project_type}` — all resolvable by `AgentStageRunner.fillTemplate()` + `gatherPriorArtifacts()` + `extraContext`
- [x] `worker.yaml` tool_allowlist: Read, Write, Edit, Bash. model_tier: 3. permission_mode: unattended.
- [x] `worker.yaml` output contract: emits `<artifact>` JSON matching `WorkerOutput` schema; `gate_verdict` is `pass` (success), `needs_changes` (environment failure), or `escalate` (implementation failure / cannot proceed) — per the §4.2 mapping table
- [x] `agent-specs/validator.yaml` exists and is valid per `AgentSpecSchema`
- [x] `validator.yaml` system_prompt is self-contained (INV-7): inlined instructions, no code editing, verdict decision tree, security checklist
- [x] `validator.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{worker_output}`, `{workspace}`
- [x] `validator.yaml` tool_allowlist: Read, Bash (NO Write). model_tier: 2. permission_mode: unattended.
- [x] `validator.yaml` output contract: emits `<artifact>` JSON matching `ValidatorOutput` schema; `gate_verdict` is `pass` (sandbox ran, read `artifact.verdict` for result) or `escalate` (sandbox crash / verdict=escalate) — per the §4.2 mapping table
- [x] The old `agent-specs/build.yaml` is kept (for backward compat) but no longer referenced by `stage-graph.yaml`
- [x] **`stage-graph.yaml` build-stage edit is owned by A4.4 (3-C1):** the build stage entry removes `agent_spec: agent-specs/build.yaml` and adds `inner_loop: anymake-build-loop` (already present — now acted on), `worker_spec: agent-specs/worker.yaml`, `validator_spec: agent-specs/validator.yaml`. At end of A4.4 the `validateGraph()` XOR rule (added in A4.1, inert until now) becomes active — the build stage now satisfies the `inner_loop`+`worker_spec`+`validator_spec` branch, and the spec files created above pass the `fs.existsSync` enforcement.
- [x] **`tests/integration/security.test.ts` build-stage assertions are owned by A4.4 (3-C1):** the tool-allowlist loop now loads `worker_spec`/`validator_spec` for the build stage (asserting worker has Read/Write/Edit/Bash, validator has Read+Bash and NO Write); the `buildStage.agent_spec` assertion is repointed to `buildStage.worker_spec`; the XOR-rule assertion now verifies the build stage has no `agent_spec` and has `inner_loop`+`worker_spec`+`validator_spec`.
- [x] **At end of A4.4 the existing e2e goes red (acknowledged, fixed in A4.6):** the build stage is now flipped, so the e2e's 5-arg `Engine` (no `BuildLoopRunner`), canned spec artifact (no `stories` array), and `Stage:`-keyed mock sandbox all break the build-stage path. These three breakages are fixed in A4.6 (2-C1b/2-C1c). Non-build stages and all non-e2e suites stay green at A4.4. → e2e is `describe.skip`'d with a clear comment pointing to A4.6.
- [x] `AgentStageRunner.run()` with `{ specOverride: "agent-specs/worker.yaml", schemaKey: "build_worker", extraContext: {...} }` loads the worker spec, fills the template (resolving `{story_id}` etc. from `extraContext`), dispatches the sandbox, extracts the `<artifact>` block, validates against `WorkerOutput` schema (via `schemaKey`). The `STAGE_SCHEMAS` map gains `build_worker: WorkerOutput` + `build_validator: ValidatorOutput`. (Already present from A4.1/A4.2 — verified unchanged by `tests/agent-specs/worker-validator-specs.test.ts` dispatch-compatibility cases.)
- [x] Test: `loadAgentSpec("agent-specs/worker.yaml")` parses successfully; `loadAgentSpec("agent-specs/validator.yaml")` parses successfully. (test file: `tests/agent-specs/worker-validator-specs.test.ts`)

**Experience Script:** Request-type. `loadAgentSpec` on both specs succeeds. A Worker sandbox dispatch (via `AgentStageRunner.run()` with `specOverride`/`schemaKey`/`extraContext`) produces a valid `WorkerOutput` artifact. A Validator sandbox dispatch produces a valid `ValidatorOutput` artifact. (The fully-live build-loop Experience Script is owned by A4.6.)

---

## 4. Technical Tasks

Built in this order (combined Planner+Worker single-session execution):

1. Created `agent-specs/worker.yaml` — self-contained (INV-7), Read/Write/Edit/Bash, model_tier 3, context-discipline guard, WorkerOutput JSON artifact contract, `{story_id}`/`{story_title}`/`{acceptance_criteria}`/`{workspace}`/`{plan.prd_md}`/`{plan.adrs}`/`{frame.project_type}` placeholders, `gate_verdict` mapping (pass/needs_changes/escalate per §4.2).
2. Created `agent-specs/validator.yaml` — self-contained (INV-7), Read+Bash (NO Write), model_tier 2, verdict decision tree, security checklist, ValidatorOutput JSON artifact contract, `{story_id}`/`{story_title}`/`{acceptance_criteria}`/`{worker_output}`/`{workspace}` placeholders, `gate_verdict` mapping (pass/escalate per §4.2).
3. Edited `stage-graph.yaml` build stage: removed `agent_spec: agent-specs/build.yaml`, kept `inner_loop: anymake-build-loop` (moved adjacent to the triad), added `worker_spec: agent-specs/worker.yaml` + `validator_spec: agent-specs/validator.yaml`. The XOR rule (A4.1, inert until now) becomes active; `fs.existsSync` enforcement passes (both spec files exist).
4. Updated `tests/integration/security.test.ts`: tool-allowlist loop loads `worker_spec`/`validator_spec` for the build stage; new `it` asserts worker has Read/Write/Edit/Bash; new `it` asserts validator has Read+Bash and NO Write/Edit; XOR-rule assertion verifies the build stage has no `agent_spec` and has the `inner_loop` triad.
5. Updated `tests/engine/stage-graph-xor.test.ts`: the "loads real stage-graph" test now asserts the A4.4 state (build stage flipped to triad, no agent_spec).
6. Updated `tests/engine/dispatcher-guard.test.ts`: the "guard condition is `inner_loop && worker_spec`" test mutates the loaded graph to simulate a dormant inner_loop stage (the real graph's build stage now has `worker_spec`, so the test can no longer rely on the real graph's A4.1 shape).
7. Updated `tests/agents.test.ts`: the two `resolveModel` tests for the build stage load `stage.worker_spec` (the build stage no longer has `agent_spec`).
8. Updated `tests/integration/e2e.test.ts`: `describe.skip`'d the e2e suite with a clear comment explaining the three breakages fixed in A4.6 (no BuildLoopRunner, no canned worker/validator artifacts, `Stage:`-keyed mock sandbox).
9. Created `tests/agent-specs/worker-validator-specs.test.ts` (13 tests): load + AgentSpecSchema parse for both specs; tool-allowlist assertions; INV-7 self-containment (no positive external-file read instructions — negative mentions like "Do NOT read PHASE_GUIDES/" are allowed and match build.yaml's pattern); placeholder presence; output-contract field-name compatibility with `WorkerOutput`/`ValidatorOutput` zod schemas.

---

## 5. Build Order Constraint

Before this story: A4.1 (Contracts), A4.2 (Engine), A4.3 (Sandbox) — all `✅ Done` on `issue/4-multi-container-build-loop`.

---

<!-- PLANNER: Fill above sections before dispatch. Leave section 10 blank. -->
<!-- WORKER: Fill section 10 when complete. Do not modify sections 1-9. -->

---

## 10. RESULT

<!-- Worker fills this section. Append below the line — do not delete existing content. -->

**result:** success
**failure_type:** *(omit if success)*
**pr_url:** https://github.com/R3dy/realcode/pull/8
**pr_number:** 8
**branch:** story/A4.4-agent-specs-graph-flip
**base:** issue/4-multi-container-build-loop
**commits:**
- 62265e5 feat(A4.4): worker.yaml + validator.yaml + stage-graph build-stage flip + security tests (#4)
**test_output:** passed (167 tests + 6 e2e skipped; 15 test files passed | 1 skipped; 16 total. 158 baseline + 9 new agent-spec tests = 167. The 6 e2e tests are `describe.skip`'d — they go red at A4.4 because the build stage now uses `inner_loop` but the e2e's mock sandbox has no BuildLoopRunner / canned WorkerOutput/ValidatorOutput. Fixed in A4.6.)
**lint_output:** clean (0 errors; 6 pre-existing warnings unchanged — none in A4.4 files)
**typecheck:** clean (tsc --noEmit exits 0)

**notes for the orchestrator / reviewer:**

1. **e2e is `describe.skip`'d (expected-to-fail at A4.4, fixed in A4.6):** Per the plan §9 A4.4 criterion ("At end of A4.4 the existing e2e goes red (acknowledged, fixed in A4.6)"), the `tests/integration/e2e.test.ts` suite is skipped via `describe.skip` with a clear comment naming the three breakages: (a) the e2e `Engine` is 5-arg (no `BuildLoopRunner`), so the dispatcher's missing-runner guard fires → run escalates at build; (b) the mock sandbox keys on `Stage:` and returns the canned `build` artifact, not worker/validator artifacts; (c) there are no canned `WorkerOutput`/`ValidatorOutput` artifacts. A4.6 fixes all three (per plan §9 A4.6 criterion (e)): constructs a `BuildLoopRunner`, adds canned `build_worker`/`build_validator` artifacts, keys the mock sandbox on `Role:`. The `describe.skip` is the documented A4.4 state — non-build stages and all non-e2e suites stay green.

2. **INV-7 self-containment check (negative mentions allowed):** The worker/validator `system_prompt`s contain negative mentions of `PHASE_GUIDES/`, `TEMPLATES/`, `AGENTS/` in the context-discipline guard ("Do NOT read or search for any anymake docs (`PHASE_GUIDES/`, `TEMPLATES/`, `AGENTS/`)"). This matches `build.yaml`'s existing pattern (build.yaml lines 38-41). The INV-7 requirement is that the spec does not INSTRUCT the agent to read external files (e.g. "Read PHASE_GUIDES/phase-4.md"); negative mentions telling the agent what NOT to look for are allowed and good practice. The test `tests/agent-specs/worker-validator-specs.test.ts` checks for positive-read instructions (`/Read (?:the )?PHASE_GUIDES/i`, `/Required reading/i`) — both specs pass.

3. **`stage-graph.yaml` duplicate `inner_loop` removed:** The build stage previously had `inner_loop: anymake-build-loop` at line 81 (the dormant A4.1 field) AND the new triad's `inner_loop` would have been a duplicate. The A4.1 dormant `inner_loop` line was removed; the triad's `inner_loop` (now adjacent to `worker_spec`/`validator_spec`) is the single occurrence. The graph loads cleanly.

4. **`dispatcher-guard.test.ts` "dormant inner_loop" test now mutates the graph:** The test "the guard condition is `stage.inner_loop && stage.worker_spec` (not inner_loop alone)" previously relied on the real graph's build stage having `inner_loop` but no `worker_spec` (the A4.1 dormant state). At A4.4 the real build stage has `worker_spec`, so the test now mutates the loaded graph to simulate the dormant state (sets `agent_spec: agent-specs/build.yaml`, clears `worker_spec`/`validator_spec`, keeps `inner_loop`). This preserves the test's intent (verifying the guard checks `worker_spec`, not just `inner_loop`) without depending on the real graph's A4.4 shape.

5. **`agents.test.ts` `resolveModel` tests use `worker_spec`:** The two `resolveModel` tests that load the build stage's spec now load `stage.worker_spec!` (the build stage no longer has `agent_spec`). The worker spec has `model_tier: 3`, so the tier-3 env-var resolution assertions are unchanged.

6. **`build.yaml` kept for backward compat (not deleted):** Per the plan §9 A4.4 criterion ("The old `agent-specs/build.yaml` is kept (for backward compat) but no longer referenced by `stage-graph.yaml`"), `agent-specs/build.yaml` is unchanged on disk; only `stage-graph.yaml` no longer references it. The `stage-graph-xor.test.ts` `innerLoopStage` helper still uses `BUILD_SPEC` (which points at `build.yaml`) as a stand-in for `worker_spec`/`validator_spec` in synthetic graphs — this is fine (the test only checks the XOR rule, not the spec's content).

7. **No schema exports regenerated:** A4.4 does not change any zod schema (`WorkerOutput`/`ValidatorOutput` were added in A4.1; `SpecArtifact.stories` in A4.1). `npm run export-schemas` produces no diff. A4.4 only adds agent-spec YAML files + flips `stage-graph.yaml` + updates tests.
