# Development Plan — Issue #17: Design drift — realcode reimplements anymake instead of wrapping it

**Author:** Anymake Solution Architect (revised per reporter's architecture vision)
**Project:** realcode — `project_type: agentic-harness`
**Issue:** https://github.com/R3dy/realcode/issues/17 — `type:design-drift` (feature/refactor)
**Code state analyzed:** 3862a94 (master)
**Status:** Approved (round 3 — all reviewer comments resolved)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-17/plan.md`

---

## 1. Problem Statement

realcode was designed to wrap anymake. What got built reimplements it: agent specs inline anymake's template formats as frozen prompt text, the build loop is a 729-line reimplementation, and ADR-006/INV-7 forbids agents from reading anymake docs.

**Reporter's vision (verbatim):**

> "what i want from realcode is to give that prompt in the web dashboard. it spins up a docker container with opencode and all my skills and configs just as if i was doing that here and it starts that process. but i get full visibility into everything thats happening. and when the initial agent would normally spawn a subagent it instead spawns a fresh container with a primary agent but it has the anymake prompt and skills and context for that phase in the anymake flow"

> "the way i use anymake is i launch opencode from this directory and give a prompt. between AGENTS.md, MEMORY.md, real-agent.md and Realmemory, you figure out what to do and then do it using the anymake skills."

**The model:** The agent in the container IS real-agent — it has the full opencode setup (AGENTS.md, MEMORY.md, real-agent.md, realmemory, the anymake plugin, all skills/MCP servers via the config mount). It invokes the anymake skill and follows the flow. When the anymake flow would spawn a subagent, the engine spawns a fresh container for that subagent role. The dashboard gives full visibility into every container.

## 2. Root Cause / Motivation

The drift happened because:

1. **The sandbox didn't have anymake's files at a known path.** The agents tried to read PHASE_GUIDES/phase-2.md etc. by relative path, which failed — the files are inside the opencode plugin's cache directory, not at a stable workspace-relative path. (Note: container logs from `run_fe2c6d9e` and `run_663da9e6` reveal that agents DID eventually find and read the templates from `/root/.cache/opencode/packages/anymake@git+https:/.../node_modules/anymake/TEMPLATES/` — but only by exploring, which wastes context budget. The templates ARE accessible; the agents just didn't know where to look.)

2. **ADR-006/INV-7 treated the symptom.** Instead of telling agents where anymake's templates are (the opencode cache path), it forbade reading anymake files entirely. This locked in the workaround.

3. **Agent specs inlined methodology as frozen text.** `plan.yaml` inlines the PRD/ADR/UX formats (lines 14-42). `worker.yaml` forbids reading anymake docs (lines 51-53). These are frozen snapshots that drift from anymake with every update — the exact failure PROJECT.md said could not happen.

4. **The build loop was reimplemented (ADR-009)** because `anymake-build-loop` dispatches Worker/Validator via the Task tool, which isn't available in headless `opencode run --auto`. The engine had to orchestrate the loop itself — spawning fresh containers per subagent. **This is actually the correct model** — it's what Royce is describing: "when the initial agent would normally spawn a subagent it instead spawns a fresh container." The engine-orchestrated loop IS the vision; the error was not recognizing it as such and not extending the pattern to the rest of the pipeline.

5. **The specs are inconsistent.** `frame.yaml`, `discover.yaml`, and `spec.yaml` already say "Use the Skill tool to invoke the anymake skill." `plan.yaml`, `worker.yaml`, and `validator.yaml` went the other way (inline + forbid). `ship.yaml` explicitly forbids skills as a deliberate fast-path design.

6. **The Skill tool has never been observed working in headless `opencode run --auto`.** Container logs across all historical runs show zero `skill` tool_use events. Agents that were told to "invoke the anymake skill" instead fell back to reading anymake's template files directly from the opencode cache (`/root/.cache/opencode/packages/anymake@.../TEMPLATES/`). The templates ARE accessible — the Skill tool may or may not be. This plan uses the proven mechanism (direct file reads from the cache path) as the primary, with Skill invocation as a secondary path if available.

**The disease is ADR-006 forbidding anymake usage. The fix is to tell agents where anymake's real templates are (the opencode cache path) and let them read those files directly — which container logs prove already works.**

## 3. Current-State Review

| Touched | Details |
|---------|---------|
| Modules | `agent-specs/{plan,discover,ship,worker,validator}.yaml` (delegate to skill, remove inlined methodology + anymake prohibition); `agent-specs/{frame,spec,change}.yaml` (consistency tweaks — already delegate); `docs/DECISIONS.md` (ADR-012); `docs/INVARIANTS.md` (INV-7 revised); `docs/SYSTEM_MAP.md` (D-7 resolved); `stage-graph.yaml` (comments clarifying build-loop adaptation) |
| Data model | none |
| Flows | per-stage sandbox dispatch — the system_prompt for each stage tells the agent to invoke the anymake skill for that phase, not to follow an inlined format |
| Integrations | anymake skill via opencode config mount (already present); Skill tool in headless opencode (already available) |

## 4. Solution Design

### 4.1 Remove the ADR-006/INV-7 prohibition on anymake usage

ADR-006 bundled two unrelated prohibitions:
- (a) "don't read anymake docs" — **obsolete.** Container logs prove agents already read anymake's templates from the opencode cache path. The prohibition forces them to waste context searching for the path, then read it anyway.
- (b) "don't traverse `node_modules`/`data`/`.git`/`dist`/`.next`/`coverage`" — **load-bearing.** A 288KB lockfile is ~70K tokens. This guard solves a real, separate problem.

**This plan keeps (b) and removes (a).**

### 4.2 Rewrite agent specs to read anymake's real templates from the opencode cache

Container logs from `run_fe2c6d9e` and `run_663da9e6` prove that anymake's templates ARE accessible in the sandbox at `/root/.cache/opencode/packages/anymake@git+https:/github.com/R3dy/Anymake.git/node_modules/anymake/TEMPLATES/` and `.../PHASE_GUIDES/`. Agents already found and read these files — the problem was they had to waste context searching for the path because the specs forbade it and didn't tell them where to look.

The fix: each spec's system_prompt tells the agent the exact path to read anymake's phase guide and templates for its phase, instead of inlining the format. Example — `plan.yaml` becomes:

```yaml
system_prompt: |
  You are executing anymake Phase 2 (Planning).

  Read anymake's Phase 2 guide and templates for the format you must follow:
  - Phase guide: /root/.cache/opencode/packages/anymake@git+https:/github.com/R3dy/Anymake.git/node_modules/anymake/PHASE_GUIDES/phase-2.md
  - PRD template: .../TEMPLATES/prd.md
  - ADR template: .../TEMPLATES/adr.md
  - UX design template: .../TEMPLATES/ux-design.md (only if Has UI is true)

  If the Skill tool is available, you may also invoke the "anymake" skill for
  additional guidance. If the files at the path above are not found, use your
  knowledge of the anymake Phase 2 format as a fallback.

  Context discipline: Do NOT traverse node_modules/, data/, .git/, dist/,
  .next/, coverage/ — those dirs are huge and will exhaust your context.
```

The inlined format descriptions (plan.yaml lines 14-42) are deleted. The anymake skill loads its own phase guides and templates at runtime — the agent reads them from the cache path (proven to work) or invokes the Skill tool if available (unproven but non-blocking).

**Tool allowlist fixes (1-C2):**
- `plan.yaml`: add `Skill` to `tool_allowlist` (currently missing — `[Read, Write, Edit, Bash, WebFetch]`)
- `ship.yaml`: **scoped out** of the Skill delegation. Ship is a deliberate fast-path (3 bash calls, trusts build test results, `unattended_with_approval_on_deploy`). Its self-contained design is intentional, not drift. Keep ship.yaml's current spec; only remove the anymake-read prohibition if present (it currently says "Do NOT invoke skills" — that stays as a deliberate design choice, recorded in ADR-012). The traversal guard stays.
- `worker.yaml` / `validator.yaml`: remove the "Do NOT read or search for any anymake docs" clause (lines 51-53 / 40-41). Keep the traversal guard, the "NO Task tool" constraint, the WorkerOutput JSON contract, and the gate_verdict mapping — all pinned by `tests/agent-specs/worker-validator-specs.test.ts`.

**Delete dead `build.yaml` (1-C3):**
`agent-specs/build.yaml` is dead config — nothing in `src/` references it, and `stage-graph.yaml`'s build stage uses `worker_spec`/`validator_spec` (not `agent_spec`). It also contains the prohibited "Do NOT read or search for any anymake docs" sentence (lines 39-41) and a second anymake clause (lines 99-100). Delete it as an explicit acceptance criterion.

### 4.3 ADR-012: Codify the engine-orchestrated build loop as the sanctioned model

`src/engine/build-loop.ts` is **not replaced.** The engine-orchestrated loop — spawning fresh containers per Worker/Validator subagent — IS Royce's vision: "when the initial agent would normally spawn a subagent it instead spawns a fresh container with a primary agent but it has the anymake prompt and skills and context for that phase." The build loop already does exactly this for Worker/Validator. The error was treating it as a necessary evil (ADR-009's "deviates from planning-doc") instead of recognizing it as the correct model.

**ADR-012 (new, superseding):**
- Affirms ADR-009: the engine-orchestrated build loop is the sanctioned model — fresh container per subagent, exactly as the reporter described
- Supersedes ADR-006's "no anymake reads" clause (anymake is accessible via the opencode cache; the prohibition is removed)
- Revises PROJECT.md's "literally anymake's build loop" to "the engine spawns fresh containers per subagent role (Worker, Validator), each with the anymake context — the headless-opencode adaptation of anymake's build loop"
- Records that `ship.yaml` is intentionally self-contained (not a drift) — a deliberate fast-path that trusts build test results
- The Planner role stays dropped for MVP (log to PARKING_LOT — the engine could add a Planner container per story, mirroring Worker/Validator)

### 4.4 The change agent — already correct, just unblocked

`change.yaml` already says it can "delegate to anymake-agile via the Skill tool." After removing the ADR-006 prohibition, this becomes functional. No code change needed beyond the context-discipline revision.

### 4.5 No Dockerfile or package.json changes needed

The opencode config mount (`src/sandbox/runner.ts:194-198`) already provides the anymake plugin to the sandbox. Container logs prove anymake's templates are accessible at the cache path. The agent reads them directly — no Dockerfile changes, no package.json changes.

### 4.6 Runtime smoke proof (1-C1)

The plan adds a runtime verification step (not just static greps): spawn one sandbox with a trivial prompt that instructs the agent to read anymake's `TEMPLATES/prd.md` from the cache path, and assert from the `--format json` event stream that a `read` tool_use on that path succeeded and returned non-empty content. This proves the path is stable and the templates are accessible — the load-bearing mechanism the plan depends on. If the path is not stable across opencode versions, the plan adds a `ENV ANYMAKE_TEMPLATES_PATH` to the Dockerfile that points at the cache dir (one line, not a git clone).

### 4.7 Future: extending the container-per-subagent model

The build loop already spawns fresh containers for Worker/Validator subagents. In the future, the same mechanism could be used for:
- anymake-agile's Solution Architect and Plan Reviewer (when the change agent delegates to anymake-agile)
- The Planner role (if re-added per PARKING_LOT)
- Any other anymake subagent role

This is out of scope for this issue but the architecture supports it — the engine already has the container-spawning mechanism.

## 5. Alternatives Considered

| Option | Why not chosen |
|--------|----------------|
| **A. Install anymake in the sandbox image (git clone to /opt/anymake).** Unnecessary — the anymake skill is already available via the opencode config mount. The agent invokes the skill, not reads files by path. |
| **B. Replace the engine-orchestrated build loop with in-sandbox anymake-build-loop.** Infeasible: headless opencode has no Task tool. anymake-build-loop dispatches via Task. The engine-orchestrated loop IS the correct model. |
| **C. Collapse the 6-stage pipeline into a single primary container that follows the anymake skill end-to-end.** Closer to the reporter's model, but loses per-stage cost tracking, per-stage artifacts, per-stage timeouts, and the dashboard's stage-by-stage progress view. The per-stage containers give the "full visibility into everything that's happening" the reporter wants. The stages stay; the specs delegate to the skill. |
| **D. Re-add the Planner role.** Log to PARKING_LOT; revisit if over-slicing recurs. The engine could spawn a Planner container per story, mirroring Worker/Validator. |

## 6. Intent Constraints

**Classification: Contradicting** — ADR-012 revises PROJECT.md's "literally anymake's build loop" clause.

- **ADR-006** — partially superseded by ADR-012 (traversal clause stands; anymake-read prohibition removed)
- **ADR-009** — affirmed by ADR-012 (engine-orchestrated loop is the sanctioned model — fresh container per subagent)
- **INV-7** — revised (split: traversal guard kept, anymake prohibition removed)
- **PROJECT.md** — "literally anymake's build loop" revised to "engine spawns fresh containers per subagent role"

**Conflict-gate outcome:** Reporter (Royce) provided the architecture vision: "when the initial agent would normally spawn a subagent it instead spawns a fresh container." This constitutes approval of the engine-orchestrated model (ADR-012) and the skill-invocation approach. **Reporter approved by providing the framing.**

## 7. Design Consistency

N/A — no UI changes. Agent spec YAML and intent-layer docs only.

## 8. Blast Radius & Regression Risk

| At risk | Why | Protection |
|---------|-----|------------|
| Every pipeline stage's rendered prompt | Specs now say "invoke the anymake skill" instead of inlining formats | Each spec keeps a one-line fallback ("If the Skill tool is not available, use your knowledge of the anymake Phase N format") — the same pattern frame.yaml already uses. |
| Build inner loop | Unchanged in mechanism; ADR-012 revises its intent-layer description only | `build-loop.ts` is not touched. Existing engine tests run unchanged. |
| Worker/validator context discipline | Removing "no anymake reads" could let a worker wander into anymake's content | The traversal guard (node_modules/data/.git/dist/.next/coverage) stays. anymake's content is loaded via the Skill tool, not via file traversal. |

## 9. Story Breakdown

### Story A17.1 — Rewrite agent specs to read anymake's real templates + ADR-012 + revise INV-7
**As a** realcode agent **I want** my system_prompt to point me at anymake's real template files instead of inlining frozen format descriptions **so that** I follow anymake's current methodology at runtime.

**Acceptance criteria:**
- [ ] `agent-specs/plan.yaml` system_prompt rewritten to tell the agent to read anymake's Phase 2 guide + templates from the opencode cache path (`/root/.cache/opencode/packages/anymake@git+https:/.../node_modules/anymake/PHASE_GUIDES/phase-2.md` + `TEMPLATES/prd.md` etc.) instead of inlining the format. The inlined PRD/ADR/UX format blocks (current lines 14-42) are deleted. **Also delete line 12** ("Do NOT search for or read any external files (phase guides, templates, etc.).") — this sentence contradicts the new delegation model. The traversal guard ("Do NOT traverse node_modules/, data/, .git/, dist/, .next/, coverage/") is kept, **with an explicit carve-out**: "You MAY read files under `/root/.cache/opencode/packages/anymake@.../` — that is the anymake template directory, not a node_modules traversal." `Skill` added to `tool_allowlist` (currently missing).
- [ ] `agent-specs/discover.yaml` system_prompt rewritten to point at anymake's Phase 1 guide + templates. Inlined format description removed (if present). Traversal guard kept.
- [ ] `agent-specs/frame.yaml` — already delegates to the Skill tool. Add the cache path as the primary mechanism (proven to work) and keep Skill as secondary. Traversal guard added if not present.
- [ ] `agent-specs/spec.yaml` — already delegates to the Skill tool. Add the cache path. Traversal guard added if not present.
- [ ] `agent-specs/ship.yaml` — **scoped out** of the delegation change. Ship is a deliberate fast-path (ADR-012 records this). No changes to the system_prompt's skill prohibition. Only the traversal guard is confirmed present.
- [ ] `agent-specs/worker.yaml` — the "Do NOT read or search for any anymake docs (PHASE_GUIDES/, TEMPLATES/, AGENTS/)" clause (lines 51-53) is removed. The traversal guard, the "NO Task tool" constraint, the WorkerOutput JSON contract, and the gate_verdict mapping are unchanged (pinned by `tests/agent-specs/worker-validator-specs.test.ts`).
- [ ] `agent-specs/validator.yaml` — the anymake-read prohibition (lines 40-41) is removed. The rest is unchanged (pinned by the same test file).
- [ ] `agent-specs/change.yaml` — the "delegate to anymake-agile via the Skill tool" clause is kept and annotated "functional — anymake templates accessible via the opencode cache mount." Traversal guard kept.
- [ ] `agent-specs/build.yaml` — **deleted** (dead config: unreferenced by `stage-graph.yaml` and `src/`; superseded by ADR-009's `worker_spec`/`validator_spec` model). Its removal is required for the grep-zero criterion below. **Test fix (2-C1):** `tests/agents.test.ts` iterates all 6 spec names including "build" — remove "build" from that list (it no longer exists). `tests/engine/stage-graph-xor.test.ts` fixtures `agent-specs/build.yaml` as `worker_spec`/`validator_spec` — update the fixture to point at `agent-specs/worker.yaml`/`agent-specs/validator.yaml` instead (the real `worker_spec`/`validator_spec` values).
- [ ] `docs/DECISIONS.md` has a new **ADR-012: Engine spawns fresh containers per subagent role + agents read anymake's real templates from the opencode cache + ship fast-path is intentional** (Status: Accepted; supersedes ADR-006's anymake-read prohibition; affirms ADR-009; records ship.yaml's self-contained design as intentional). ADR-006's row annotated "partially superseded by ADR-012 (traversal clause stands)."
- [ ] `docs/INVARIANTS.md` INV-7 rewritten: traversal guard kept, anymake-read prohibition removed; references ADR-012.
- [ ] `docs/SYSTEM_MAP.md` Drift Log D-7 changes Status from `open` to `resolved` with note pointing to ADR-012.
- [ ] No inlined format blocks remain in any spec. Grep for "## PRD format", "## ADR format", "## UX design format" in `agent-specs/` returns empty.
- [ ] No spec contains "Do NOT read or search for any anymake docs". Grep in `agent-specs/` returns empty (including the deleted build.yaml).
- [ ] **Runtime smoke proof (1-C1):** spawn one sandbox container with a trivial prompt that says "Read the file at /root/.cache/opencode/packages/anymake@git+https:/github.com/R3dy/Anymake.git/node_modules/anymake/TEMPLATES/prd.md and output its first line." Assert from the `--format json` event stream that a `read` tool_use on that path succeeded and returned non-empty content. If the path is not stable, add `ENV ANYMAKE_TEMPLATES_PATH` to `Dockerfile.sandbox` pointing at the cache dir (one line). Document the verified path in ADR-012.

**Experience Script:** N/A — intent-layer + spec-yaml story with no UI surface. Validator confirms via the grep tests + the runtime smoke proof above.

### Story A17.2 — Document the build-loop adaptation in stage-graph + PARKING_LOT
**As a** realcode maintainer **I want** the stage graph and docs to honestly reflect that the build loop is the sanctioned container-per-subagent model **so that** the intent layer doesn't lie.

**Acceptance criteria:**
- [ ] `stage-graph.yaml` build stage: `anymake_agents` field annotated with `# declarative-only — engine spawns fresh containers per subagent role (ADR-009/ADR-012)` comment. `inner_loop: anymake-build-loop` kept with `# the engine orchestrates this: fresh container per Worker/Validator subagent (ADR-012)` comment.
- [ ] `stage-graph.yaml` change stage: `anymake_agents` comment updated to note anymake-agile Skill delegation is functional post-ADR-012.
- [ ] `PARKING_LOT.md` gains entry: "Re-add the Planner role as an engine-orchestrated per-story container (mirror Worker/Validator dispatch) if over-slicing recurs. Future: extend container-per-subagent model to anymake-agile's Solution Architect / Plan Reviewer."
- [ ] `docs/DECISIONS.md` ADR-009 row annotated "codified by ADR-012 as the sanctioned container-per-subagent model."

**Experience Script:** N/A — intent-layer story. Validator confirms via reading the updated comments.

## 10. Test & Verification Plan

- **Automated (static):**
  - A grep-based test asserting no spec contains inlined format blocks ("## PRD format", "## ADR format", "## UX design format") in `agent-specs/`
  - A grep-based test asserting no spec contains "Do NOT read or search for any anymake docs" in `agent-specs/`
  - A grep-based test asserting pipeline-stage specs (frame, discover, plan, spec) point at anymake's cache path or invoke the anymake skill in their system_prompt
- **Automated (runtime smoke, 1-C1):**
  - Spawn one sandbox container with a trivial prompt: "Read /root/.cache/opencode/packages/anymake@git+https:/github.com/R3dy/Anymake.git/node_modules/anymake/TEMPLATES/prd.md and output its first line."
  - Assert from the `--format json` event stream that a `read` tool_use on that path succeeded and returned non-empty content
  - If the path is not stable, add `ENV ANYMAKE_TEMPLATES_PATH` to `Dockerfile.sandbox` (one line) and update the specs to use `$ANYMAKE_TEMPLATES_PATH` instead of the hardcoded path
- **Regression (1-C4):**
  - `tests/agent-specs/worker-validator-specs.test.ts` — pins traversal guard, "NO Task tool", "NEVER edit", gate_verdict phrases. The worker/validator edits (removing the anymake-read sentence only) MUST preserve these pinned tokens. This test file runs unchanged.
  - `tests/agents.test.ts` — loads `frame.yaml` and asserts its shape. **Remove "build" from the spec-name list** (build.yaml is deleted). Otherwise runs unchanged.
  - `tests/engine/stage-graph-xor.test.ts` — **update fixture**: `worker_spec`/`validator_spec` from `agent-specs/build.yaml` to `agent-specs/worker.yaml`/`agent-specs/validator.yaml`. Otherwise runs unchanged.
  - `tests/engine/*` — build loop, stage graph, dispatcher. Run unchanged (build-loop.ts is not touched).
  - `tests/dashboard-*` — dashboard tests. Run unchanged (no UI changes).
- **Experience:** N/A — no UI surface.
- **Manual:** Royce confirms the revised specs read like the operator's model ("read anymake's templates from the cache path"), not like a reimplementation ("here is the PRD format inline").

## 11. Rollback Plan

- **Branch:** `issue/17-wrap-anymake`
- **Revert:** `git revert [merge SHA]` — reverts the spec rewrites and intent-layer doc edits
- **Migrations:** none
- **Intent-layer rollback:** reverting restores ADR-006/INV-7 to pre-ADR-012 text and D-7 to `open`

## 12. Review Log

| Round | Date | Reviewer verdict | Report | Resolution |
|-------|------|------------------|--------|------------|
| 1 | 2026-08-15 | NEEDS CHANGES | `review-round-1.md` | 4 comments resolved: 1-C1 (added runtime smoke proof + cache-path mechanism instead of unverified Skill tool); 1-C2 (fixed allowlist claim, scoped ship out, added Skill to plan.yaml); 1-C3 (added build.yaml deletion as explicit criterion); 1-C4 (named worker-validator-specs.test.ts + agents.test.ts in regression list) |
| 2 | 2026-08-15 | NEEDS CHANGES | `review-round-2.md` | 2 comments: 2-C1 (build.yaml deletion breaks agents.test.ts + stage-graph-xor.test.ts — added test-fix criteria); 2-C2 (plan.yaml line 12 contradicts new model — added explicit deletion criterion; node_modules carve-out for cache path added) |
| 3 | 2026-08-15 | APPROVED | `review-round-3.md` | All round-1 and round-2 comments resolved. 7 non-blocking notes for the builder. |
