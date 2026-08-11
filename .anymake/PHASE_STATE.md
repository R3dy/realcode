# realcode -- Phase State

> **[AUTONOMOUS MODE / yolo] ACTIVE** -- `autonomous_mode: true` (set 2026-08-06). Proceeding through phases WITHOUT human approval gates; the Product Owner Proxy evaluates each gate strictly. Security failures + ESCALATE TO USER always pause for the human.

> **RESUME HERE NEXT SESSION** (read this first):
>
> **Next action, in order:**
>
> **Build-stage timeout fix (2026-08-11, session 21):**
> - run_0ba334d1 ("Redesign run detail view with tabs + live Phoenix log")
>   escalated at build: 20-min sandbox timeout, 1.27M prompt tokens burned
>   ($1.48). Root cause: same shape as session-20 plan-stage bug -- the build
>   agent explored the workspace source tree (incl node_modules, 2.7GB) and
>   ballooned context. The session-20 "do NOT explore" guard was applied to
>   plan.yaml only, NOT build.yaml.
> - FIX: applied the same context-discipline guard to `agent-specs/build.yaml`
>   (no exploring node_modules/data/.git/dist/.next/coverage, "ls" not
>   recursive find, read only package.json + files a story names, keep
>   context lean). 90/90 tests still pass.
> - Committed WITH session-20 changes (plan timeout fix + fillTemplate bump +
>   workspace-seeding exclude dirs) as one commit. Dead run deleted.
> - PARKING_LOT updated: escalated runs are terminal by design (MVP), but
>   dashboard should surface that to the operator (no approve button exists).
> - **NOT YET RE-RUN.** The 17-story epic (run-detail redesign with live
>   Phoenix log) is too large for a single 20-min build session even with
>   the prompt fix. Recommend: validate the fix on a small idea first, then
>   tackle the redesign (or scope the spec stage to produce fewer stories).
>
> **Agile issue #3 FIXED (2026-08-11, session 20):**
> - The plan stage was timing out (5min, 139K prompt tokens) on every run
>   targeting a non-trivial project. 3 consecutive runs failed at `plan`.
> - Root cause: `agent-specs/plan.yaml` system_prompt said "Read PHASE_GUIDES/
>   phase-2.md, TEMPLATES/prd.md, TEMPLATES/adr.md, TEMPLATES/ux-design.md"
>   but ANYMAKE IS NOT INSTALLED IN THE SANDBOX CONTAINER. The agent burned
>   the 5-min timeout searching for these files + exploring the workspace
>   source tree, ballooning to 139K prompt tokens.
> - FIX (3 files, uncommitted in working tree — awaiting Royce's commit approval):
>   1. `stage-graph.yaml`: plan `timeout_ms` 300000 -> 600000 (10min)
>   2. `agent-specs/plan.yaml`: rewrote system_prompt — self-contained, no
>      references to files not in sandbox, PRD/ADR/UX format described inline,
>      "Do NOT explore the workspace source tree"
>   3. `src/agents/runner.ts`: fillTemplate truncation 2000 -> 8000 chars
> - Verified: run_b6381e0d shipped end-to-end. Plan stage: 3.6K tokens (was
>   139K), $0.009 (was $0.11), ~1 min (was 5min timeout). Full run $0.61/$8.
> - 90/90 tests pass. Engine container rebuilt. GitHub issue #3 closed.
> - **CHANGES ARE UNCOMMITTED.** Need Royce to approve commit + push.
>
> **Phase 5 (Launch) -- COMPLETE. FULL E2E PIPELINE SHIPPED.** A real run
> (run_a2e65d68, "[target: realmemory] Add a simple health check endpoint")
> completed ALL 6 stages: frame -> discover -> plan -> spec -> build -> SHIP.
> 7 tests passed, 70.8% coverage, $0.67/$8 spent. Royce can now launch a task
> in the web UI (New Run button + project-targeting dropdown) and watch it
> work end-to-end on a mission-control project. Phoenix traces flowing.
>
> **Workspace seeding bug FIXED (2026-08-11, session 19):**
> - When targeting `[target: realcode]`, seedWorkspaceFromProject copied the
>   entire realcode repo (including data/) into the workspace. Since the
>   workspace lives inside data/workspaces/, this caused 138 levels of
>   recursive nesting (1.8GB). The discover stage agent then traversed the
>   nested tree, ballooning context to 146K prompt tokens -> 5min timeout.
> - FIX: added `data` + `tests` to COPY_EXCLUDE_DIRS, added lockfiles to
>   COPY_EXCLUDE_FILES. Applied in BOTH src/engine/dispatcher.ts (engine
>   container) AND src/dashboard/lib/engine.ts (dashboard container — the
>   one that actually creates + seeds the workspace via POST /api/runs).
> - Also bumped frame+discover stage timeouts from 5min to 10min.
> - Verified: new run run_1b51b69b frame (14K tokens, was 76K) + discover
>   (31K tokens, was 147K; pass in 3min, was timeout at 5min). Pipeline
>   progressing past discover. 90/90 tests still pass.
> - Both containers rebuilt + restarted.
>
> **Agile issue #1 FIXED (2026-08-11, session 18):**
> - Dashboard run detail route /runs/[id] was unbuilt (empty directory, every
>   run click 404'd). Built the page: header + stage cards + artifact viewer +
>   not-found state + delete confirmation modal.
> - DELETE /api/runs/[id] endpoint added (409 active-run gate in route;
>   engine.deleteRun unconditional; removes run dir + workspace + work_items).
> - 14 new tests (90/90 total). Intent layer built (SYSTEM_MAP/DECISIONS/INVARIANTS).
> - All 9 stale failed runs cleaned up. Only the shipped run remains on the board.
> - PR #2 merged (dff34bf). Issue #1 closed.
>
> **What's done (session 17, 2026-08-11):**
> - **6 parallel-agent fixes** shipped (commit 6b31a47):
>   1. Artifact extraction: strip markdown code fences + brace-match fallback
>   2. Sandbox cwd: ensure workspace dir exists before spawn
>   3. Per-stage timeout_ms in stage-graph (build=20min, ship=10min, others=5min)
>   4. Agent specs (spec/build/ship): explicit JSON output, headless-friendly
>   5. Dashboard New Run form + project targeting ([target: <project>] seeds workspace)
>   6. Phoenix tracing: was dead code (never initialized) + wrong exporter (JSON 415 -> proto 200)
> - **3 follow-up fixes** (commits ed9744e, 0f7ace5, d8ab40a, 6d362c4):
>   - build agent: MODIFY existing seeded repo, don't scaffold fresh
>   - ship agent: use {workspace} sandbox mount path (not container-internal repo_path)
>   - ship agent: drastically simplified -- trust build test_results, no re-run, fast emit
> - **76/76 tests passing** (was 72).
> - **Full e2e run** run_a2e65d68: shipped. All 6 stage artifacts produced.
> - **All committed + pushed** to https://github.com/R3dy/realcode (6d362c4).
>
> **What's left (optional polish):**
> 1. ~~Clean up old failed runs in the dashboard~~ DONE (session 18, agile #1).
> 2. Verify Phoenix UI at http://localhost:6006 shows the real spans visually.
> 3. The build agent wrote a fresh project instead of modifying realmemory's actual
>    src/ -- the "modify existing repo" instruction helped (it read package.json) but
>    the agent still created new files rather than editing realmemory's existing src/.
>    This is a prompt-engineering refinement for a future session, not a blocker.
>
> `project_type: agentic-harness`. `autonomous_mode: true`.

---

**Last updated:** 2026-08-11 (session 21)
**Updated by:** Claude (autonomous mode)
**Current phase:** Phase 5 -- Launch COMPLETE (full e2e pipeline shipped)
**Current step:** Phase 5 done. Build-stage timeout fix applied (build.yaml context-discipline guard). Awaiting re-run validation.
**project_type:** agentic-harness
**autonomous_mode:** true

---

## Phase Progress

| Phase | Status | Completed | Approved by |
|-------|--------|-----------|-------------|
| Phase 0: Foundation | ✅ Complete | 2026-08-06 | Royce |
| Phase 1: Discovery | ✅ Complete | 2026-08-06 | Royce |
| Phase 2: Planning | ✅ Complete | 2026-08-08 | Product Owner Proxy |
| Phase 3: Solutioning | ✅ Complete | 2026-08-08 | Product Owner Proxy |
| Phase 4: Implementation | ✅ Complete (12/12 milestones, security review PASS) | 2026-08-09 | Security review PASS |
| Phase 5: Launch | ✅ Complete (full e2e pipeline shipped 2026-08-11) | 2026-08-11 | Pipeline dry-run gate passed |

## Milestone Progress

| Milestone | Status | Tests |
|-----------|--------|-------|
| M0 Scaffold | ✅ Complete | -- |
| M1 Spike | ✅ Complete (Option B confirmed) | -- |
| M2 Contracts | ✅ Complete | 14 tests |
| M3 Backend | ✅ Complete | 9 tests (incl. concurrent-worker) |
| M4 Engine | ✅ Complete | 5 tests (incl. hard gate) |
| M5 Sandbox | ✅ Complete (sandbox image built 2026-08-11) | -- |
| M6 AgentSpecs | ✅ Complete (specs refined for headless e2e 2026-08-11) | 24 tests |
| M7 Tracing | ✅ Complete (wired + verified 2026-08-11) | -- |
| M8 Control Plane | ✅ Complete | -- |
| M9 Dashboard | ✅ Complete (New Run form + project targeting 2026-08-11) | -- |
| M10 Integration + Security | ✅ Complete | 20 tests (6 e2e + 14 security) |
| M11 CLI | ✅ Complete | -- |
| M12 Deploy | ✅ Complete | -- |

**Total: 76 tests passing. 12/12 milestones complete.**

---

## Session Log

| Date | Session # | Phase/Step | Work Done | Next Step |
|------|-----------|------------|-----------|-----------|
| 2026-08-06 | 1-4 | Phase 0-1 | PROJECT.md + discovery (Factory/Droid research) | Phase 2 |
| 2026-08-06 | 5-8 | Phase 2 | ADR-001 + pipeline-design + ADR-002..009 + dashboard prototype | Phase 2 gate |
| 2026-08-08 | 9 | Phase 2 gate (autonomous) | MVP_SCOPE; proxy APPROVED after stale-ref fixes | Phase 3 |
| 2026-08-08 | 10 | Phase 3 (autonomous) | 12 epics, 23 stories, backlog, DAG; proxy APPROVED 8/8 | Phase 4 |
| 2026-08-08 | 11 | Phase 4 spike | Headless-anymake spike PASSED (Option B). ADR-001 Accepted | M0 |
| 2026-08-08 | 12 | Phase 4 M0-M11 | Scaffold + M2 contracts + M3 backend + M4 engine + M5 sandbox + M7 tracing + M8 control + M9 dashboard + M11 CLI. 28/28 tests. 4 commits. | M6 AgentSpecs + M10 Integration + M12 Deploy |
| 2026-08-09 | 13 | Phase 4 M6 | AgentStageRunner + 6 AgentSpec YAMLs + CLI wired. 52/52 tests. | M10 + M12 |
| 2026-08-09 | 14 | Phase 4 M10+M12 | E2E integration tests + security tests. docker-compose + Dockerfiles. 72/72 tests. 12/12 milestones done. | Security review + Phase 5 |
| 2026-08-10 | 15 | Phase 5 | Fixed docker compose build. Wired dashboard to live API. Created GitHub repo. | Build sandbox image, e2e run |
| 2026-08-11 | 16 | Phase 5 | Tailscale serve 8301. Built realcode-sandbox:latest image + sandbox-net. Fixed 5 code bugs. Real e2e run progressing. $0.11/$8. | Complete e2e run, verify Phoenix, commit, push |
| 2026-08-11 | 17 | Phase 5 | 6 parallel-agent fixes: artifact extraction (fence+brace), sandbox cwd, per-stage timeout (build=20min), agent specs (spec/build/ship headless), dashboard New Run form + project targeting, Phoenix tracing (was dead code). 76/76 tests. Then 3 follow-up fixes (build: modify existing repo; ship: use {workspace} sandbox path; ship: trust build test_results, simplified). FULL E2E RUN run_a2e65d68 shipped: frame->discover->plan->spec->build->SHIP, 7 tests pass, 70.8% cov, $0.67/$8. Pushed to GitHub. | Phase 5 COMPLETE |
| 2026-08-11 | 19 | Phase 5 (bugfix) | Fixed workspace seeding recursion: [target: realcode] copied repo incl data/ -> 138 levels nesting (1.8GB) -> discover timeout. Fix: COPY_EXCLUDE_DIRS += data/tests, COPY_EXCLUDE_FILES for lockfiles. Applied in BOTH dispatcher.ts + dashboard/lib/engine.ts. Frame+discover timeouts 5min->10min. New run run_1b51b69b: frame pass (14K tokens, was 76K), discover pass (31K tokens, was 147K; 3min, was timeout). 90/90 tests. | Monitor run_1b51b69b through pipeline |
| 2026-08-11 | 20 | Phase 5 (agile #3) | Plan stage timeout fix. Root cause: plan.yaml system_prompt referenced anymake files (PHASE_GUIDES, TEMPLATES) not in sandbox container -> agent searched + explored workspace -> 139K tokens -> 5min timeout. 3 consecutive runs failed at plan. Fix: (1) stage-graph plan timeout 300000->600000, (2) rewrote plan.yaml system_prompt self-contained (no external file refs, PRD/ADR/UX format inline, "do NOT explore workspace"), (3) fillTemplate truncation 2000->8000. Verified run_b6381e0d shipped e2e: plan 3.6K tokens (was 139K), $0.009 (was $0.11), ~1min. Full run $0.61/$8. 90/90 tests. Issue #3 closed. CHANGES UNCOMMITTED. | Royce to approve commit + push |
| 2026-08-11 | 21 | Phase 5 (build fix) | Build-stage timeout fix. run_0ba334d1 escalated at build (20-min timeout, 1.27M prompt tokens, $1.48). Root cause: same shape as plan-stage bug -- build.yaml lacked the "do NOT explore workspace" guard. Fix: applied context-discipline guard to build.yaml (no node_modules/data/.git/dist/.next/coverage traversal, ls not recursive, read only package.json + named files). Committed WITH session-20 changes. Dead run deleted. PARKING_LOT updated (escalated=terminal UX gap). 90/90 tests. | Validate fix on small idea; then tackle 17-story redesign |

---

*Phase 5 COMPLETE. Full e2e pipeline shipped: frame->discover->plan->spec->build->ship on a real mission-control project.*
