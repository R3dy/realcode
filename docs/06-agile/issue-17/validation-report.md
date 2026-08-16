# Validation Report — Issue #17: Design drift — realcode reimplements anymake instead of wrapping it (Stories A17.1 + A17.2)

**Created by:** Anymake Validator
**Created at:** 2026-08-15T19:14:00Z
**Story:** A17.1 + A17.2 (issue #17)
**Branch:** issue/17-wrap-anymake
**PR:** (not yet opened — changes are uncommitted in the working tree; HEAD is still master `3862a94`)
**Validation attempt:** 1

> Note on git state: all changes for issue #17 are present in the working tree
> on branch `issue/17-wrap-anymake` but are **uncommitted** (`git status` shows
> modified/deleted files, no staged commit). The validation below was performed
> against the working-tree contents. Committing + opening the PR is a required
> follow-up but is not itself an acceptance criterion, so it does not affect the
> verdict.

---

## VERDICT: FAIL

One acceptance criterion — the runtime smoke proof (A17.1, criterion 1-C1) — was
not executed. It is a runtime-verifiable criterion requiring a dedicated sandbox
spawn; no automated test covers it and no dedicated smoke run was performed for
this issue. All other criteria pass, the full test suite is green (271/271), and
the security + intent-consistency checks pass. The failure is narrow and
fixable: spawn one sandbox with the trivial read-`prd.md` prompt, capture the
JSONL event stream, and document the verified result in ADR-012 (or add the
`ENV ANYMAKE_TEMPLATES_PATH` fallback if the path proves unstable).

---

## Acceptance Criteria Results

### Story A17.1 — Rewrite agent specs to read anymake's real templates + ADR-012 + revise INV-7

| # | Criterion | Type | Result | Evidence |
|---|-----------|------|--------|---------|
| 1 | `plan.yaml` rewritten: cache path added, inlined PRD/ADR/UX blocks deleted, line 12 ("Do NOT search for or read any external files") deleted, traversal guard kept with node_modules carve-out, `Skill` added to `tool_allowlist` | Code | PASS | `agent-specs/plan.yaml:8-12` lists the 4 cache-path template reads; `:18-21` keeps traversal guard + carve-out ("You MAY read files under /root/.cache/opencode/packages/anymake@.../"); `:40` adds `Skill` to `tool_allowlist`. No inlined format blocks and no "Do NOT search for or read any external files" sentence present (grep confirms). |
| 2 | `discover.yaml` rewritten: cache path added, inlined format removed, traversal guard kept | Code | PASS | `agent-specs/discover.yaml:9-10` points at Phase 1 guide + discovery template; `:16-19` traversal guard + carve-out. No inlined format. |
| 3 | `frame.yaml` — cache path added as primary, Skill secondary, traversal guard added | Code | PASS | `agent-specs/frame.yaml:9-10` cache-path reads; `:12-14` Skill as secondary ("If the Skill tool is available..."); `:16-19` traversal guard + carve-out. |
| 4 | `spec.yaml` — cache path added, traversal guard added | Code | PASS | `agent-specs/spec.yaml:9-11` cache-path reads; `:19-22` traversal guard + carve-out. |
| 5 | `ship.yaml` — scoped out of delegation; only traversal guard confirmed; header references ADR-012 | Code | PASS | `agent-specs/ship.yaml:2-4` header comment records the deliberate fast-path and references ADR-012; `:16` retains "Do NOT invoke skills"; tool_allowlist is `Read, Write, Bash` (`:10-13`); `:14-17` self-contained system prompt. No skill delegation added. |
| 6 | `worker.yaml` — anymake-read prohibition (old lines 51-53) removed; traversal guard, "NO Task tool", WorkerOutput contract, gate_verdict mapping unchanged; header updated | Code | PASS | `agent-specs/worker.yaml:4-6` header references ADR-012; old "Do NOT read or search for any anymake docs" clause absent (grep confirms); `:40-44` traversal guard kept; `:13` "NO Task tool" preserved; `:84-106` WorkerOutput JSON contract intact; `:60-71` gate_verdict mapping (pass/needs_changes/escalate) preserved. |
| 7 | `validator.yaml` — anymake-read prohibition (old lines 40-41) removed; rest unchanged; header updated | Code | PASS | `agent-specs/validator.yaml:5-6` header references ADR-012; old prohibition absent (grep confirms); `:36-43` traversal guard kept; `:14` "NEVER edit code" + "NO Task tool" preserved; `:69-91` ValidatorOutput contract intact. |
| 8 | `change.yaml` — anymake-agile delegation annotated as functional; traversal guard kept | Code | PASS | `agent-specs/change.yaml:11-12` annotates "functional per ADR-012 (anymake templates accessible via the opencode config mount)"; `:49` traversal guard (node_modules/.git/dist/.next/coverage/data) kept. |
| 9 | `build.yaml` — deleted | Code | PASS | `ls agent-specs/` shows no `build.yaml`; `git status` lists `deleted: agent-specs/build.yaml`. |
| 10 | `docs/DECISIONS.md` — ADR-012 present; ADR-006 annotated "partially superseded by ADR-012"; ADR-009 annotated "codified by ADR-012" | Code | PASS | `docs/DECISIONS.md:20` ADR-012 row (Accepted); `:14` ADR-006 row "Partially superseded by ADR-012 (traversal clause stands; anymake-read prohibition removed)"; `:17` ADR-009 row "Codified by ADR-012 as the sanctioned container-per-subagent model"; ADR-012 full text at `:205-217`; superseded-decisions note at `:201`. |
| 11 | `docs/INVARIANTS.md` — INV-7 rewritten | Code | PASS | `docs/INVARIANTS.md:30-32` INV-7 retitled "Agent specs delegate to anymake's real templates; traversal guard stays (ADR-012)"; body keeps traversal guard, removes anymake-read prohibition, adds carve-out, references ADR-012; `:32` Enforced-in line lists the 8 specs. |
| 12 | `docs/SYSTEM_MAP.md` — D-7 Status `open` → `resolved` with ADR-012 note | Code | PASS | `docs/SYSTEM_MAP.md:262` D-7 row Status `resolved`, Note "Resolved by ADR-012 (issue #17). Agent specs now point at anymake's real templates..."; also `:27` "anymake (D-7 resolved by ADR-012)" + `:248` integration note. |
| 13 | Grep "## PRD format" / "## ADR format" / "## UX design format" in `agent-specs/` returns empty | Code | PASS | `rg -n "## PRD format\|## ADR format\|## UX design format" agent-specs/` → exit 1 (no matches). |
| 14 | Grep "Do NOT read or search for any anymake docs" in `agent-specs/` returns empty | Code | PASS | `rg -n "Do NOT read or search for any anymake docs" agent-specs/` → exit 1 (no matches). |
| 15 | `tests/agents.test.ts` — "build" removed from spec-name list | Code | PASS | `tests/agents.test.ts:71-72` test renamed "loads and validates all 5 agent specs (build.yaml deleted per ADR-012)" with `stages = ["frame", "discover", "plan", "spec", "ship"]` — "build" absent. |
| 16 | `tests/engine/stage-graph-xor.test.ts` — fixture updated to worker.yaml/validator.yaml | Code | PASS | `tests/engine/stage-graph-xor.test.ts:35` `BUILD_SPEC = path.resolve(REPO_ROOT, "agent-specs/worker.yaml")`; `:79` `validator_spec: path.resolve(REPO_ROOT, "agent-specs/validator.yaml")`. |
| 17 | **Runtime smoke proof (1-C1):** spawn one sandbox container with trivial prompt "Read .../TEMPLATES/prd.md and output its first line"; assert `read` tool_use succeeded with non-empty content; if path unstable add `ENV ANYMAKE_TEMPLATES_PATH` to `Dockerfile.sandbox`; document verified path in ADR-012 | Runtime | FAIL | No dedicated smoke sandbox was spawned for this issue — `ls -lt data/runs/` shows no runs created on 2026-08-15 (most recent is `run_fe2c6d9e` from Aug 14); no new run directory or smoke artifact exists. `Dockerfile.sandbox` has no `ENV ANYMAKE_TEMPLATES_PATH` (`rg` exit 1). ADR-012 (`docs/DECISIONS.md:207`) documents the cache path as verified, but cites **pre-existing** container logs (`run_fe2c6d9e`, `run_663da9e6`) rather than a fresh dedicated smoke proof with the specified trivial prompt. The criterion's literal requirement — "spawn one sandbox container with a trivial prompt that says 'Read the file at .../TEMPLATES/prd.md and output its first line'" — was not performed. No automated test covers this criterion either. (Note: the underlying path-stability claim IS independently supported — `data/runs/run_663da9e6/containers/stage-spec-0.log` contains completed `read` tool_use events on anymake cache paths — so the fix is narrow: run the dedicated smoke and record the result, or add an explicit note in ADR-012 that the criterion is satisfied by equivalent existing evidence.) |

### Story A17.2 — Document the build-loop adaptation in stage-graph + PARKING_LOT

| # | Criterion | Type | Result | Evidence |
|---|-----------|------|--------|---------|
| 1 | `stage-graph.yaml` build stage: `anymake_agents` comment + `inner_loop` comment | Code | PASS | `stage-graph.yaml:96` `# declarative-only — engine spawns fresh containers per subagent role (ADR-009/ADR-012)` above `anymake_agents`; `:112` `# the engine orchestrates this: fresh container per Worker/Validator subagent (ADR-012)` above `inner_loop: anymake-build-loop` (`:113`). |
| 2 | `stage-graph.yaml` change stage: `anymake_agents` comment updated re functional anymake-agile delegation | Code | PASS | `stage-graph.yaml:135` `# anymake-agile Skill delegation is functional post-ADR-012 (anymake accessible via opencode cache)` above `anymake_agents` (`:136`). |
| 3 | `PARKING_LOT.md` — Planner role entry added | Code | PASS | `PARKING_LOT.md:17-20` "Re-add the Planner role as an engine-orchestrated per-story container" entry, logged by Issue #17 (ADR-012), with the mirror-Worker/Validator reason and the SA/Plan Reviewer future extension. |
| 4 | `docs/DECISIONS.md` ADR-009 row — "codified by ADR-012" | Code | PASS | `docs/DECISIONS.md:17` ADR-009 Status column: "Codified by ADR-012 as the sanctioned container-per-subagent model". |

### Regression

| # | Criterion | Type | Result | Evidence |
|---|-----------|------|--------|---------|
| R1 | All tests pass (271/271) | Runtime | PASS | `npx vitest run` → "Test Files 26 passed (26); Tests 271 passed (271); Duration 2.92s". |
| R2 | `tests/agent-specs/worker-validator-specs.test.ts` — worker/validator specs still pass (traversal guard, "NO Task tool", gate_verdict phrases preserved) | Runtime | PASS | Part of the 271 passing tests. File asserts (lines 44-54, 108-122) `node_modules`/`.git`/`dist`/`coverage`, `NO Task tool`, `NEVER edit`, and the `"pass"`/`"needs_changes"`/`"escalate"` gate_verdict phrases — all present in the rewritten specs and validated green. |

**Type key:** `Code` — verified statically against the branch; `Runtime` — verified by running tests or a sandbox.

**Result key:** PASS / FAIL (specific evidence above).

---

## Security Checklist Results

| Check | Result | Evidence |
|-------|--------|---------|
| Non-public endpoints require authentication | N/A | Issue #17 touches only agent-spec YAML + intent-layer docs + stage-graph comments. No HTTP endpoints added or modified. |
| User data access has authorization checks | N/A | No user-data access paths touched. |
| User input validated and sanitized | N/A | No request-handling code touched. |
| Database queries use parameterized queries | N/A | No DB-touching code touched. |
| File upload validation (if applicable) | N/A | No upload paths touched. |
| No secrets in committed code | PASS | Agent specs reference only the public anymake opencode-cache path (`/root/.cache/opencode/packages/anymake@.../`) and `opencode run` invocation patterns. `rg` for `sk_\|AKIA\|ghp_\|xox\|AIza` in the changed files returns no secrets. |
| API responses don't expose internal fields | N/A | No API response code touched. |

---

## Intent-Consistency Results

Checked against the story's Intent Constraints (plan §6a) and the project intent layer (`docs/DECISIONS.md`, `docs/INVARIANTS.md`).

- [x] No Active Decision in `DECISIONS.md` is contradicted by this change without a superseding ADR.
  - ADR-006's "no anymake doc reads" clause IS contradicted, but **ADR-012 is the superseding Active Decision** (`DECISIONS.md:20`, full text `:205-217`); the superseded-decisions note at `:201` records it. Not a conflict — superseding ADR exists. ADR-006's traversal clause explicitly stands.
- [x] No invariant in `INVARIANTS.md` (especially INV-7, named in §6a) is broken.
  - INV-7 (`:30-32`) is rewritten to match ADR-012 — delegation + traversal guard + carve-out. The rewrite is consistent with the change.
- [x] The change does not undercut the project type's success model.
  - realcode is `agentic-harness`; success = end-to-end run ships a working increment. Pointing agents at anymake's real templates (vs frozen inline copies) directly serves this — anymake improvements flow in via sandbox-image rebuild.

**Intent-consistency verdict: PASS.** The single contradiction (ADR-006's anymake-read prohibition) is covered by the superseding ADR-012, which the reporter approved by providing the architecture vision (plan §6 conflict-gate outcome).

---

## Summary

- **14/15** A17.1 criteria PASS; the runtime smoke proof (criterion 17) FAILS.
- **4/4** A17.2 criteria PASS.
- **2/2** regression checks PASS (271/271 tests green; worker-validator-specs test green).
- Security checklist: PASS (no relevant surfaces; no secrets).
- Intent-consistency: PASS (ADR-012 supersedes the contradicted ADR-006 clause).

**The single failure** is the runtime smoke proof (A17.1 criterion 17 / plan §4.6, 1-C1). The criterion required spawning a dedicated sandbox container with the trivial "read `TEMPLATES/prd.md` and output its first line" prompt and asserting a completed, non-empty `read` tool_use from the `--format json` event stream. No such dedicated smoke was performed for this issue, and no automated test covers it. ADR-012 documents the cache path as verified but borrows evidence from pre-existing runs rather than the fresh smoke the criterion mandated. The path-stability claim itself is independently credible (existing container logs show completed cache-path reads), so the remediation is narrow:

  1. Spawn one sandbox with the specified trivial prompt (or run an equivalent scripted check), AND
  2. Either record the fresh smoke result in ADR-012, or add an explicit note that criterion 1-C1 is satisfied by the equivalent existing `run_663da9e6` evidence (completed `read` tool_use events on anymake cache paths are present in `data/runs/run_663da9e6/containers/stage-spec-0.log`), AND
  3. If the path is not stable across opencode versions, add `ENV ANYMAKE_TEMPLATES_PATH` to `Dockerfile.sandbox`.

**Recommended action:** Return to the worker to execute the runtime smoke proof (criterion 17) and document the result. Once that single criterion passes, the story should move to PASS — all other criteria, regression, security, and intent-consistency checks already pass. Additionally, the worker should commit the working-tree changes and open the PR (the changes are currently uncommitted).

## Runtime Smoke Proof — COMPLETED POST-VALIDATION

**Date:** 2026-08-15
**Command:** `docker run --rm -v ~/.config/opencode:/root/.config/opencode:ro -e OPENROUTER_API_KEY=<redacted> -e HOME=/root realcode-sandbox:latest run --auto --format json --model openrouter/z-ai/glm-5.2 "Read the file at /root/.cache/opencode/packages/anymake@git+https:/github.com/R3dy/Anymake.git/node_modules/anymake/TEMPLATES/prd.md and output its first line"`

**Result:** PASS
- 1 `tool_use` event in the JSON stream
- Tool: `read` on `/root/.cache/opencode/packages/anymake@git+https:/.../node_modules/anymake/TEMPLATES/prd.md`
- Status: `completed`
- Output: `"# PRD - Template"` (non-empty, first line of anymake's real PRD template)
- Exit code: 0

The anymake template cache path is stable and accessible in the sandbox container. The load-bearing mechanism for ADR-012 (agents read anymake's real templates from the opencode cache) is verified at runtime.
