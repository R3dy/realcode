# Validation Report — Story A4.4: Agent specs: worker.yaml + validator.yaml

**Validator:** Anymake combined Validator + Experience Runner
**Date:** 2026-08-12
**Branch:** story/A4.4-agent-specs-graph-flip
**PR:** #8
**Base:** issue/4-multi-container-build-loop
**Commits:** 62265e5, bc15abf

---

## Verdict: PASS

All 14 acceptance criteria from the task brief §3 are satisfied against the actual code on the branch. The build-stage flip is complete, both agent specs are self-contained and schema-valid, the security allowlist holds, and the e2e is correctly `describe.skip`'d pending A4.6.

---

## §10 RESULT from the worker

- **result:** success
- **test_output:** passed — 167 tests + 6 e2e skipped (15 test files passed | 1 skipped | 16 total)
- **lint_output:** clean — 0 errors; 6 pre-existing warnings (all in non-A4.4 files: dashboard route, StatStrip, engine.ts, build-loop.ts, sandbox/runner.ts)
- **typecheck:** clean — `tsc --noEmit` exits 0
- **commits:** 62265e5 feat(A4.4) + bc15abf docs(RESULT)

---

## Per-criterion validation

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `agent-specs/worker.yaml` exists, valid per `AgentSpecSchema` | ✅ PASS | File present (110 lines); `tests/agent-specs/worker-validator-specs.test.ts:23-28` parses via `AgentSpecSchema.safeParse`; `npm test` green |
| 2 | `worker.yaml` system_prompt self-contained (INV-7): inlined, no external file refs, context-discipline guard | ✅ PASS | worker.yaml:25-40 inlines the guard (`node_modules`, `.git`, `dist`, `.next`, `coverage`, `data/`) + negative anymake-doc mentions only. Test at `worker-validator-specs.test.ts:38-55` asserts no `/Read (?:the )?PHASE_GUIDES\|TEMPLATES\|AGENTS/i` and no `/Required reading/i`. Matches build.yaml pattern (negative mentions allowed) |
| 3 | `worker.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{workspace}`, `{plan.prd_md}`, `{frame.project_type}` | ✅ PASS | worker.yaml:90-104 contains all required placeholders; `{plan.adrs}` also present. Test at `worker-validator-specs.test.ts:57-67` asserts each |
| 4 | `worker.yaml` tool_allowlist: Read, Write, Edit, Bash; model_tier 3; permission_mode unattended | ✅ PASS | worker.yaml:8-9 + 106-110. Test at `worker-validator-specs.test.ts:30-36` + `:15-21` |
| 5 | `worker.yaml` output contract emits `<artifact>` JSON matching `WorkerOutput`; `gate_verdict` ∈ {pass, needs_changes, escalate} per §4.2 | ✅ PASS | worker.yaml:42-88 specifies all three gate_verdict values + mapping to result/failure_type. Test at `worker-validator-specs.test.ts:69-80` asserts each literal; `:148-178` confirms a sample artifact parses against `WorkerOutput` zod schema |
| 6 | `agent-specs/validator.yaml` exists, valid per `AgentSpecSchema` | ✅ PASS | File present (107 lines); `worker-validator-specs.test.ts:92-97` |
| 7 | `validator.yaml` system_prompt self-contained (INV-7): inlined, no code editing, verdict tree, security checklist | ✅ PASS | validator.yaml:11-90 inlines the verdict decision tree (§44-50), security checklist (§25-28), and "NEVER edit" constraint. Test at `worker-validator-specs.test.ts:108-123` |
| 8 | `validator.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{worker_output}`, `{workspace}` | ✅ PASS | validator.yaml:92-100. Test at `worker-validator-specs.test.ts:125-132` |
| 9 | `validator.yaml` tool_allowlist: Read, Bash (NO Write); model_tier 2; permission_mode unattended | ✅ PASS | validator.yaml:8-9 + 105-107. Test at `worker-validator-specs.test.ts:99-106` |
| 10 | `validator.yaml` output contract emits `<artifact>` matching `ValidatorOutput`; `gate_verdict` ∈ {pass, escalate} per §4.2 | ✅ PASS | validator.yaml:52-90. Test at `worker-validator-specs.test.ts:134-145` + `:180-204` (sample parses via `ValidatorOutput`) |
| 11 | `agent-specs/build.yaml` kept for backward compat, no longer referenced by `stage-graph.yaml` | ✅ PASS | `stage-graph.yaml` build stage (lines 78-97) has no `agent_spec`; `grep agent_spec` shows only frame/discover/plan/spec/ship. `build.yaml` still on disk (unchanged) |
| 12 | `stage-graph.yaml` build-stage flip: remove `agent_spec`, keep `inner_loop`, add `worker_spec` + `validator_spec`; XOR rule now active | ✅ PASS | stage-graph.yaml:95-97 has the triad (`inner_loop: anymake-build-loop`, `worker_spec`, `validator_spec`); no `agent_spec` on build. `tests/integration/security.test.ts:193-212` asserts XOR rule across all stages + build-stage flip |
| 13 | `tests/integration/security.test.ts` build-stage assertions: loads `worker_spec`/`validator_spec`; XOR rule asserts no `agent_spec` + triad present | ✅ PASS | security.test.ts:138-212 covers: (a) `tool_allowlist.length > 0` loop loads `stage.agent_spec ?? stage.worker_spec`; (b) build-stage worker has Read/Write/Edit/Bash; (c) build-stage validator has Read+Bash, no Write/Edit; (d) XOR rule on every stage + build stage specifically flipped |
| 14 | Existing e2e goes red at A4.4 → `describe.skip`'d with comment pointing to A4.6 | ✅ PASS | `tests/integration/e2e.test.ts:144-155` contains a 12-line block comment explaining the three breakages (no BuildLoopRunner, Stage-keyed mock sandbox, no canned WorkerOutput/ValidatorOutput) and that A4.6 fixes them. `describe.skip` at line 155. `npm test` reports "6 skipped" |

> Note: the task brief §4 step 9 says the new test file has "13 tests" but the actual file (`tests/agent-specs/worker-validator-specs.test.ts`) contains **14 `it()` blocks** — 6 worker + 6 validator + 2 dispatch-compat. `npm test` reports `tests/agent-specs/worker-validator-specs.test.ts (14 tests)`. The worker's RESULT §test_output says "158 baseline + 9 new agent-spec tests = 167" — the delta is actually 14 new (158 + 14 - 5 retuned other-suite deltas = 167). The brief's count is a documentation slip, not a code defect; the test file itself is comprehensive. **No action required.**

---

## Security checklist (per A4.4 prompt)

| Check | Result |
|-------|--------|
| `worker.yaml` has Read/Write/Edit/Bash (can modify code — its job) | ✅ PASS — worker.yaml:106-110 |
| `validator.yaml` has Read+Bash ONLY (NO Write/Edit — validator never modifies code) | ✅ PASS — validator.yaml:105-107, no Write/Edit in allowlist |
| No secrets in committed files (worker.yaml, validator.yaml, stage-graph.yaml) | ✅ PASS — scanned via `scanForSecrets` (security.test.ts:95-122); the new YAMLs contain only prompt prose, schema literals, and placeholder tokens (`{story_id}` etc.). No sk-/AKIA/ghp_/xox/AIza prefixes |
| Both specs are self-contained (no external file refs per INV-7) | ✅ PASS — `worker-validator-specs.test.ts:38-55, 108-123` assert no positive-read instructions. Negative mentions (`Do NOT read PHASE_GUIDES/`) match build.yaml's established pattern |
| `STAGE_SCHEMAS` map has `build_worker: WorkerOutput` + `build_validator: ValidatorOutput` | ✅ PASS — `src/agents/runner.ts:20-28` |
| `loadAgentSpec` parses both specs | ✅ PASS — `worker-validator-specs.test.ts:15-21, 84-90` |
| `build.yaml` retained for backward compat | ✅ PASS — file on disk unchanged |
| `e2e` is `describe.skip`'d with A4.6 comment (not deleted) | ✅ PASS — e2e.test.ts:144-155 |
| No schema exports regenerated (A4.4 adds no zod schemas) | ✅ PASS — diff contains no changes under `src/schemas/` |

---

## Tooling outputs

### `npm test`
```
Test Files  15 passed | 1 skipped (16)
     Tests  167 passed | 6 skipped (173)
  Duration  2.11s
```
All 15 non-skipped test files pass. The single skipped file is `tests/integration/e2e.test.ts` (6 tests), as required by criterion 14.

### `npm run typecheck`
```
> tsc --noEmit
(exits 0 — no output)
```

### `npm run lint`
```
6 problems (0 errors, 6 warnings)
```
All 6 warnings are pre-existing and in files untouched by A4.4:
- `src/dashboard/app/api/control/route.ts:16` (cost_cap_usd)
- `src/dashboard/app/api/control/route.ts:9` (WorkItem) — line may differ slightly
- `src/dashboard/components/StatStrip.tsx:3` (TriangleAlert)
- `src/dashboard/lib/engine.ts:133` (presentArtifacts)
- `src/engine/build-loop.ts:159` (Unused eslint-disable)
- `src/sandbox/runner.ts:1` (ChildProcess)

No A4.4-touched file produces a warning.

---

## Files changed (vs base)

```
 agent-specs/validator.yaml                       | 107 ++++++++++++
 agent-specs/worker.yaml                          | 110 ++++++++++++
 docs/04-implementation/task-briefs/story-A4.4.md | 111 ++++++++++++
 stage-graph.yaml                                 |   5 +-
 tests/agent-specs/worker-validator-specs.test.ts | 205 +++++++++++++++++++++++
 tests/agents.test.ts                             |   6 +-
 tests/engine/dispatcher-guard.test.ts            |  18 +-
 tests/engine/stage-graph-xor.test.ts             |  14 +-
 tests/integration/e2e.test.ts                    |  14 +-
 tests/integration/security.test.ts               |  48 ++++--
 10 files changed, 611 insertions(+), 27 deletions(-)
```

---

## Escalations

None. The story is ready to merge.

## Notes for the orchestrator

1. The build stage is now flipped — A4.5 (security review pass) and A4.6 (live build loop with BuildLoopRunner + canned artifacts + Role-keyed mock sandbox) are unblocked.
2. The `dispatcher-guard.test.ts` "dormant inner_loop" test now mutates the loaded graph to simulate the pre-A4.4 state; this preserves its intent without depending on the real graph's shape. Documented in worker's RESULT note 4.
3. `agents.test.ts` `resolveModel` tests were repointed to `stage.worker_spec!`. Documented in worker's RESULT note 5.
