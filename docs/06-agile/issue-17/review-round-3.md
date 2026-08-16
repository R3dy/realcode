# Plan Review — Issue #17, Round 3

**Reviewer:** Anymake Plan Reviewer (fresh context — round 3)
**Plan:** `docs/06-agile/issue-17/plan.md` @ In Review (round 3 — addresses reviewer round 2 comments 2-C1 and 2-C2) — 2026-08-15
**Issue:** https://github.com/R3dy/realcode/issues/17
**Code state checked:** 3862a94 (master) — matches plan header (verified via `git rev-parse --short HEAD`)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-17/review-round-3.md`

---

## Checklist

| # | Dimension | Result | Evidence |
|---|-----------|--------|----------|
| 1 | **Root cause verified** | PASS | Unchanged from round 2's verification (58/58 completed cache-path reads in the container logs, zero `skill` tool_use events, plan.yaml:14-42 inlined blocks, allowlist without `Skill`). Round 3 adds no new root-cause claims. Re-verified HEAD is still 3862a94. |
| 2 | **Solves the reported issue** | PASS | Unchanged from round 2. The cache-path-read mechanism + runtime smoke proof directly resolves the drift the issue reports. |
| 3 | **Scope matches the issue** | PASS | Unchanged from round 2. The added test-fix criteria (2-C1) are strictly in-scope: they are the blast radius OF the build.yaml deletion the issue requires, not new work. |
| 4 | **Intent consistency** | PASS | Unchanged from round 2. ADR-012 supersedes ADR-006's read-clause only; INV-7 revision; D-7 resolution; conflict gate stays "reporter approved by providing the framing." |
| 5 | **Design consistency** | N/A | No UI surface. |
| 6 | **Blast radius honest** | PASS | The round-2 FAIL is closed: §9/A17.1 (line 173) now names both breaking test consumers with their exact fixes (verified correct below — see 2-C1 verification), and §10 marks both files as edited (lines 206-207) rather than "run unchanged." Re-grepped the whole repo for `build.yaml` consumers to check nothing new was missed: the only code/test consumers are the two fixed files plus the three round-2-verified survivors (`build-loop.test.ts:29-30`, `dispatcher-guard.test.ts:41-42,101`, `lease-heartbeat.test.ts:29-30` — in-memory fixtures with mocked runners, never hit disk). Two stale *doc* references remain (`CONVENTIONS.md:23`, `SYSTEM_MAP.md:81`); they break nothing and are listed as build-time cleanup in the notes below. |
| 7 | **Stories buildable** | PASS | The round-2 FAIL is closed: A17.1 criterion 1 (line 165) now explicitly requires deletion of plan.yaml line 12 — I verified `agent-specs/plan.yaml:12` contains exactly the quoted sentence ("Do NOT search for or read any external files (phase guides, templates, etc.).") and a repo-wide grep confirms it is the ONLY occurrence in `agent-specs/`. The criterion also mandates the node_modules carve-out wording verbatim for plan.yaml. See 2-C2 verification for the residual wording latitude, which I judge non-blocking. |
| 7a | **Experience Script present** | PASS | N/A justified on both stories; grep tests + runtime smoke proof are the substitute. |
| 8 | **Test plan sufficient** | PASS | The round-2 FAIL is closed: §10 lines 206-207 carry the two required edits. Static greps + runtime smoke proof (verified implementable against the JSONL event format in round 2) + pinned-token note for `worker-validator-specs.test.ts` all stand. |
| 9 | **Rollback complete** | PASS | Unchanged. Real branch `issue/17-wrap-anymake`, single `git revert`, no migrations; the build.yaml deletion reverts with the same revert. |
| 10 | **Security** | PASS | No auth/authz/tenant/secret/payment surface. Cache-path reads are read-only inside the sandbox. |

---

## Round-2 comment verification

### 2-C1 (build.yaml deletion breaks `tests/agents.test.ts` + `tests/engine/stage-graph-xor.test.ts`) — **RESOLVED**

Verified the plan's prescribed fixes against the actual test files at 3862a94:

1. **`tests/agents.test.ts`** — the plan's criterion ("remove 'build' from that list (it no longer exists)") is exactly the right minimal fix. Verified lines 71-80: `"loads and validates all 6 agent specs"` iterates `["frame", "discover", "plan", "spec", "build", "ship"]`, calls `loadAgentSpec(path.resolve(REPO_ROOT, \`agent-specs/${stage}.yaml\`))` per entry, and its assertions are shape checks (`stage`, `system_prompt.length > 50`, `user_prompt_template.length > 10`, non-empty allowlist) with no build-specific coupling. Removing `"build"` from the array leaves a green test over the 5 surviving stage specs. The other tests in this file (`resolveModel`, `fillTemplate`, `extractArtifact`, e2e frame/plan runs) never touch build.yaml — the build-stage model-tier tests load `stage.worker_spec!` (agent-specs/worker.yaml via the graph), unaffected.

2. **`tests/engine/stage-graph-xor.test.ts`** — the plan's criterion ("update the fixture to point at `agent-specs/worker.yaml`/`agent-specs/validator.yaml`") is correct and complete. Verified `BUILD_SPEC` (line 35) has exactly two consumption sites: `innerLoopStage()` lines 78-79 (the "accepts the inner_loop triad" test, lines 149-156 — passes post-repoint because `worker.yaml` and `validator.yaml` exist on disk, satisfying the `fs.existsSync` enforcement that round 2 traced to `stage-graph.ts:138-148`) and the "rejects both agent_spec AND triad" test (lines 106-119 — still throws the XOR error, which is collected independently of the existsSync branch since `hasAgentSpec` is true and `FRAME_SPEC` exists). Both surviving engine-test files confirmed by grep to use the `agent-specs/build.yaml` string only in post-validation in-memory fixtures with mocked runners — genuinely unchanged, so plan §10's "run unchanged" claim for them holds.

3. **§10 regression list** — lines 206-207 now name both files with their required edits ("Remove 'build' from the spec-name list" / "update fixture"). Substance of the 2-C1 requirement met (see nit 5 below for residual phrasing).

### 2-C2 (plan.yaml line 12 contradiction + traversal guard bans the instructed path) — **RESOLVED**

1. **plan.yaml:12** — A17.1 criterion 1 now says, explicitly: '**Also delete line 12** ("Do NOT search for or read any external files (phase guides, templates, etc.).")'. I verified the sentence is present at `agent-specs/plan.yaml:12` exactly as quoted, and greped the repo: it is the only occurrence in `agent-specs/` (the other hits are the intent-layer docs — DECISIONS.md:63 is ADR-006's historical record, correctly left standing; INVARIANTS.md:31 is INV-7's current text, rewritten by the INV-7 criterion). The sharpest self-contradiction vector is now covered by an explicit, mechanically checkable criterion.

2. **node_modules carve-out** — criterion 1 mandates the wording verbatim for plan.yaml: "You MAY read files under `/root/.cache/opencode/packages/anymake@.../` — that is the anymake template directory, not a node_modules traversal." This resolves the guard-instructs-conflict for the file 2-C2 was about. The residual latitude (carve-out wording not mandated for discover/frame/spec; §4.2's example guard unchanged) is analyzed and dispositioned in the notes below — non-blocking.

Two components of 2-C2's "required change" text were not taken literally (the belt-and-braces grep for the external-files phrase, and deleting plan.yaml lines 10-11 alongside line 12). Both are dispositioned below as non-blocking: the phrase's only `agent-specs/` occurrence is the line the criterion now deletes (validator-verifiable by reading the final plan.yaml), and §4.2's stated target shape ("plan.yaml becomes:") omits lines 10-11 entirely, so a faithful rewrite drops them regardless.

---

## Notes for the builder (non-blocking — fold into the same build, no plan revision required)

These are wording/hygiene items within the worker's normal execution discretion. None can produce a functionally broken outcome; all are one-line choices while executing the approved criteria.

1. **plan.yaml residual sentences (2-C2a intent):** when rewriting plan.yaml per the §4.2 example, drop lines 10-11 ("Work ONLY from the prior artifacts provided in the prompt below… all the context you need is in the prompt") along with line 12. "Do NOT read or explore the workspace source tree" may stay; the "ONLY from prior artifacts" framing contradicts the cache-path read instruction and the §4.2 target shape already omits it.
2. **Carve-out wording reuse:** apply criterion 1's carve-out sentence verbatim to the traversal guards added to `discover.yaml`, `frame.yaml`, and `spec.yaml` (all three currently have no node_modules guard — verified by grep — so "kept"/"added if not present" resolves to *added*). Every spec that instructs cache-path reads should carry the exemption so no spec relies on "traverse a directory" being read as distinct from "read a named file under it."
3. **Optional belt-and-braces grep:** add `Grep for "Do NOT search for or read any external files" in agent-specs/ returns empty` to §10's static block (one line; the phrase is unique to plan.yaml:12 today and is deleted by criterion 1 — the grep only guards against partial execution).
4. **Stale doc references after build.yaml deletion:** `CONVENTIONS.md:23` ("See: `agent-specs/plan.yaml`, `agent-specs/build.yaml`") and `SYSTEM_MAP.md:81` ("plan.yaml + build.yaml carry CRITICAL context-discipline guards (ADR-006)"). Clean both up in the same commit — SYSTEM_MAP.md is already being edited for D-7. DECISIONS.md:63-66 is ADR-006's historical record and stays (ADR-012's annotation criterion supersedes it going forward).
5. **Cosmetics:** retitle the `agents.test.ts` test "loads and validates all 6 agent specs" → 5; §10 line 208's wildcard "tests/engine/* … run unchanged" would read more precisely as "all other tests/engine tests" (lines 206-207 already override it for the two edited files, so execution order is unambiguous).
6. **ship.yaml criterion wording:** ship.yaml has no node_modules traversal guard today (verified). Read criterion 5's "the traversal guard is confirmed present" as "ship.yaml is otherwise untouched" — do not add machinery to the deliberate fast path; §4.2 line 89 and ADR-012's ship criterion control.
7. **Plan-text nits carried from round 2 (no execution impact, frozen with the plan):** §3's module list omits `agent-specs/build.yaml` and the Integrations row still says "Skill tool in headless opencode (already available)" against §2 bullet 6's "unproven." The criteria and design sections are correct; only the §3 summary table is stale.

---

## Verdict

**VERDICT: APPROVED** — all dimensions PASS; near-certainty this plan (1) resolves the reported issue (the cache-path mechanism is empirically proven in the container logs and guarded by a runtime smoke proof), (2) breaks nothing in the blast radius (the two tests the build.yaml deletion breaks are now named with verified-correct fixes; all other consumers confirmed unaffected by grep), (3) is cleanly revertible (single `git revert`, no migrations). N/A on UI coherence.

**Summary:** Both round-2 comments are genuinely resolved with criterion-level edits I verified line-by-line against the real test files at 3862a94. The remaining items — carve-out wording reuse in three guard-less specs, plan.yaml lines 10-11 residue, the skipped redundant grep, and two stale doc references — are one-line wording choices squarely within worker execution discretion, enumerated above as build-time notes so they are applied rather than discovered. The plan is ready for the approval gate.
