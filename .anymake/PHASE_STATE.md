# realcode -- Phase State

> **[AUTONOMOUS MODE / yolo] ACTIVE** -- `autonomous_mode: true` (set 2026-08-06). Proceeding through phases WITHOUT human approval gates; the Product Owner Proxy evaluates each gate strictly. Security failures + ESCALATE TO USER always pause for the human.

> **RESUME HERE NEXT SESSION** (read this first):
>
> **Next action, in order:**
>
> **Issue #19 COMPLETE (2026-08-16, session 28) — realcode works end-to-end via the web UI:**
> - 8 commits pushed (56ead22 through 4e6bb01) fixing 5 root-cause bugs + ship-persistence + UI stage-collapse.
> - **All 3 scenarios verified from the WEB UI (Playwright + chromium, PASS):**
>   - Scenario 1 (net-new project, full flow): run_51d4a52f SHIPPED — all 6 stages, 4 stories, $0.197, 8 traceable docker containers.
>   - Scenario 2 (add feature to existing project, agile change): run_182a90d0 SHIPPED — conductor `classify_change` (deterministic), single change container, committed `d3e5afa Add /version endpoint` to realmemory. $0.043. UI shows only conductor + change.
>   - Scenario 3 (fix in existing project, agile change): run_f611b509 SHIPPED — committed `33076bf Add /health endpoint` to realmemory. $0.054.
> - **Ship-persistence** (bb4fa50): ship stage copies workspace to `PROJECTS/<name>/repo` (name from frame.json). docker-compose overlays PROJECTS/ as rw. Smoke-tested.
> - **UI stage-collapse** (7feda93+134c3f3+4e6bb01): agile runs show only conductor + change; 6 build-flow stages hidden.
> - 271/271 tests pass. tsc clean. Engine + dashboard rebuilt + restarted.
> - Issue #19: https://github.com/R3dy/realcode/issues/19
>
> **What's next:**
> 1. Close issue #19 (3 scenarios pass from the web UI; vision met).
> 2. (Optional) glm-5.2 spec agent generates multi-file projects with test-race conditions (parallel vitest). Future: instruct agents to use `pool: 'forks'` to avoid the race.
> 3. (Optional) Add `/runs` index route (board lives at `/`).
> 4. After closing #19: spawn Cartographer to refresh intent layer.
>
> **Issue #17 SHIPPED (2026-08-15, session 27) — realcode wraps anymake instead of reimplementing it:**
> - Royce asked: "use anymake agile to figure out how this project has shifted so far off course. its supposed to be a wrapper for anymake." The anymake-agile pipeline ran the full flow: Cartographer (intent layer refresh) → Solution Architect (development plan) → 3 Plan Review rounds (NEEDS CHANGES → NEEDS CHANGES → APPROVED) → direct build → Validator → runtime smoke proof.
> - Root cause: ADR-006/INV-7 forbade agents from reading anymake docs, forcing every agent spec to inline frozen copies of anymake's template formats. The anymake templates were always accessible in the sandbox at the opencode cache path (`/root/.cache/opencode/packages/anymake@.../`) — container logs proved agents already found and read them, but wasted context searching because the specs forbade it and didn't tell them where to look.
> - ADR-012: agent specs now point at anymake's real template files in the opencode cache path. The engine-orchestrated build loop is the sanctioned container-per-subagent model (the reporter's vision: "spawn a fresh container per subagent"). ship.yaml's fast-path is intentional.
> - 22 files changed: 6 agent specs rewritten (frame, discover, plan, spec, worker, validator), 2 updated (ship, change), build.yaml deleted, ADR-012 + revised INV-7 + resolved D-7, stage-graph comments, test fixes. 271/271 tests pass. Runtime smoke proof verified.
> - **PR #18 open — ADR-touching, requires Royce's review before merge.**
>
> **What's next:**
> 1. Royce to review + merge PR #18 (https://github.com/R3dy/realcode/pull/18).
> 2. After merge: spawn Cartographer to refresh intent layer.
> 3. Test with a real run that exercises the new cache-path delegation (does the
>    plan stage produce artifacts that match anymake's current PRD template?).
> 4. Consider re-adding the Planner role as an engine-orchestrated per-story
>    container (PARKING_LOT) if over-slicing recurs.
>
> **Dashboard mobile-first audit + fixes SHIPPED (2026-08-14, session 26):**
> - Royce asked for a full mobile-first design audit of the dashboard and to
>   address everything that didn't follow mobile-first theory. A prior
>   change-agent pass (commit b4fed98) had only scratched the surface
>   (viewport + a few flex-wraps). This session did the deep audit + fixes.
> - **Mobile navigation:** the desktop sidebar (`hidden md:flex`) had NO mobile
>   replacement, so Runs/Settings were unreachable on phones. Added a fixed
>   bottom nav bar (`md:hidden`) with Runs / New-run FAB / Settings, plus
>   `pb-safe` so content clears it and the home indicator.
> - **Dead link removed:** NAV had a `/traces` entry but no /traces route exists
>   -> 404 on all devices. Removed (live tracing lives on the run-detail page
>   via LiveTraceStream; comment left to re-add when a standalone traces view
>   ships).
> - **Duplicate components fixed:** the run-detail page rendered
>   ContainerGrid + LiveTraceStream + ContainerLogViewer TWICE when
>   hasLiveActivity && showBuildDetail (double polling, double SSE connection,
>   visual duplication). The Build Stage Detail section now renders the trio
>   ONLY when there is no live_state (StoryProgress stays unique).
> - **Consolidated New Run flow:** AppShell had its own NewRunSheet (no project
>   targeting) while the board page used NewRunDialog (with targeting). Removed
>   NewRunSheet; the header + mobile nav now open the canonical NewRunDialog.
> - **Touch targets:** filter buttons, trace filter selects, log tail toggle,
>   resume-scroll button, per-stage model selects all bumped to min-h 32-36px
>   (was ~24-28px, below the 44px floor).
> - **Safe-area insets:** added `.pt-safe`/`.pb-safe` utilities in globals.css;
>   applied to the sticky header (top) and mobile bottom nav (bottom) so
>   notched/home-indicator phones don't lose content under the chrome.
> - **StageStepper:** 8 stages overflow on mobile; the hidden scrollbar gave no
>   affordance. Added a `scroll-fade-r` right-edge mask so users can see more
>   stages scroll. Bumped stage-label text from 10px -> 11px and pill height.
> - **Run-detail header:** back-button + run_id + badge row now wraps and the
>   run_id truncates instead of overflowing on narrow screens.
> - **Tiny text:** bumped the worst text-[10px] offenders (stage labels, retry
>   count) to 11px minimum.
> - Verified: `tsc --noEmit` clean, `next build` clean (all routes), 61/61
>   dashboard tests pass. Dashboard container rebuilt + restarted; live at
>   localhost:3001 returning HTTP 200 with the new markup (`pb-safe`,
>   `aria-label="New run"`, bottom nav) confirmed in served HTML.
> - **CHANGES ARE UNCOMMITTED** (working tree). Need Royce to approve commit +
>   push. Rebuilt docker image is running the new code already.
>
> **What's next:**
> 1. Royce to approve commit + push of session 25 (conductor) + session 26
>    (this audit) changes.
> 2. Optionally drive the dashboard on a real phone-width viewport to
>    subjectively confirm the bottom nav + safe areas + stage stepper.
> 3. A standalone /traces route is a PARKING_LOT item (if a cross-run trace
>    timeline view is wanted later, re-add the NAV entry then).
>
> **Issue #16 SHIPPED (2026-08-13, session 25) — Conductor + dual-flow architecture:**
> - Royce identified the root disease: realcode forced every request through the
>   same 6-stage greenfield pipeline (frame→discover→plan→spec→build→ship). A
>   one-line change took 20 minutes. The workspace-copy model caused empty-
>   workspace crashes. And despite PROJECT.md saying realcode "wraps anymake,"
>   stage specs inlined methodology as frozen prompts.
> - **Conductor (stage 0):** A direct LLM call (NOT a container spawn) in the
>   engine process that classifies requests as new_project vs change. Uses
>   hybrid approach: deterministic project-name matching first (instant, $0),
>   LLM fallback for ambiguous cases. Determines flow_type: full | agile.
> - **Dual flows:** full (new_project) = existing 6-stage pipeline. agile
>   (change) = single "change" stage with one container spawn.
> - **Live-mount:** For the agile flow, the REAL project directory
>   (MISSION_CONTROL_ROOT/PROJECTS/<target>/repo) is mounted read-write at
>   /workspace. No copy, no seeding, no empty-workspace crashes. The sandbox
>   runner translates /mission-control → host mission-control root for Docker -v.
> - **Change agent spec:** Strict 8-tool-call budget. "Find what you need, edit
>   it, test it, commit it. Done." Model tier 1, 15-min timeout.
> - **Stage graph:** 8 stages now (conductor + frame + discover + plan + spec +
>   build + ship + change). The conductor branches: intake → classified_new
>   (full flow) or classified_change (agile flow → change → shipped).
> - 271 tests pass (256 original + 15 new for conductor + change flow).
> - E2E VERIFIED: "Add a footer to realvol" → conductor classified as change
>   (deterministic match, $0) → change agent found footer already exists → ran
>   tests → shipped. Total: ~2 min, $0.023. (vs old: 20+ min, $0.60+)
>
> **Changes are UNCOMMITTED.** Need Royce to approve commit + push.
>
> **What's next:**
> 1. Royce to approve commit + push of all session 25 changes.
> 2. Test with a change that actually requires editing (e.g., "add a health
>    check endpoint to realmemory") — the footer test found the feature already
>    present, so no files were modified.
> 3. Fix the anymake path references in frame/discover/spec agent specs (they
>    reference relative paths like PHASE_GUIDES/phase-0.md that don't resolve
>    from /workspace — should reference the anymake plugin path inside the
>    sandbox image).
> 4. Consider allowing the change agent to use the Task/Skill tools for
>    anymake-agile delegation on more complex changes.
> - Royce reported: realcode run failed AND dashboard crashed with
>   "Application error: a client-side exception has occurred" when viewing the
>   failed run. This was unacceptable.
> - ROOT CAUSE: CurrentActivityBar.tsx:48 did `(data as ...).live_state` where
>   `data` is null on first render (usePoll returns null until first fetch).
>   TypeScript cast is erased at runtime -> `null.live_state` -> crash. Fixed
>   with optional chaining: `data?.live_state ?? liveState`.
> - BUILT VISIBILITY FOR BUILD WORKERS: the A11.1 design intentionally disabled
>   liveCapture for build worker/validator sandboxes. This made worker timeouts
>   completely invisible (no container logs, no trace events, no container_id).
>   Enabled liveCapture for ALL dispatches. BuildLoopRunner now stores
>   worker_container_id + validator_container_id in build-state.json and pushes
>   container entries. Container log files now include storyId for uniqueness.
> - ADDED jsonrepair: LLMs emit literal newlines + unescaped quotes inside JSON
>   string values (especially in multi-line markdown fields like epics_md).
>   JSON.parse rejects these. Added 3-layer fallback: JSON.parse -> control-char
>   sanitizer -> jsonrepair library. This was causing spec/discover stages to
>   fail with "No <artifact> JSON block found" even though the artifact WAS
>   present in the output.
> - STRENGTHENED WORKER PROMPT: workers now create code files FIRST (not
>   explore), run `npm install` if node_modules doesn't exist, run ONLY their
>   specific test file (not `npm test` which runs all 256 tests including
>   Docker-based ones), and have a stronger node_modules traversal guard.
> - PER-WORKER TIMEOUT: 10 min for workers, 5 min for validators (was inheriting
>   the full 20-min stage timeout).
> - SPEC TIMEOUT: 5 min -> 8 min (spec agent generates long responses).
> - LIVE-STATE FROM BUILD LOOP: the build stage now writes live-state
>   (stage="build", status="running") so the dashboard shows activity during
>   the build.
> - 256 tests pass (1 test updated to reflect new liveCapture behavior).
>
> **End-to-end run result (run_b03d63bc):**
> - Frame -> Discover -> Plan -> Spec -> Build all passed (jsonrepair fix
>   unblocked spec/discover).
> - 4 of 7 stories shipped: Footer component, AppShell mount, route audit,
>   footer-presence tests. 39 tests pass.
> - Footer.tsx created with exact tagline, mounted in AppShell, committed.
> - Run escalated at 20-min wall-clock deadline (3 QA stories didn't run).
>   $0.56/$8 spent. The footer IS working end-to-end.
>
> **CHANGES ARE UNCOMMITTED.** Need Royce to approve commit + push.
>
> **What's next:**
> 1. Royce to approve commit + push of all session 24 changes.
> 2. The spec agent generates too many stories (7 for a simple footer) -- the
>    20-min build budget can only handle ~4. Spec prompt engineering needed.
> 3. Consider increasing build wall-clock timeout from 20 min to 30 min for
>    larger spec outputs.
>
> **Issue #11 SHIPPED (2026-08-12, session 23):**
> - Realtime visibility across ALL pipeline stages (not just build).
> - 3 stories via anymake-agile (A11.1 engine → A11.2 API → A11.3 UI):
>   - A11.1 (PR #12, ee10e1c): Engine writes live.json during every non-build
>     stage — container ID, log path, trace events, token usage, cost.
>     Spawn-time cidfile poll so container appears mid-stage. Catch path
>     writes status:"failed". Build loop untouched (liveCapture flag).
>   - A11.2 (PR #13, c6094ed): Dashboard API surfaces live.json —
>     getLiveState(), listContainers merge, getTraceEvents merge,
>     getContainerLogs reads live FIRST (1-C6), remove "built" from
>     TERMINAL_RUN_STATUSES so ship stage streams (1-C3).
>   - A11.3 (PR #14, b70ae32): Dashboard UI — new Pipeline Activity section
>     with CurrentActivityBar, LiveTraceStream, ContainerGrid,
>     ContainerLogViewer. hasLiveActivity = Boolean(live_state). buildActive
>     → runActive prop. Terminal runs show last-known state.
> - 256 tests (206 baseline + 50 new). 4 plan review rounds. Validator PASS
>   on all 3. Experience Runner PASS — drove real run run_663da9e6 from
>   frame through spec, verified live visibility at every stage.
> - Also fixed pre-existing engine.ts TypeScript errors (non-null assertions
>   in getTraceEvents) that broke next build.
> - Tag: issue-11. Revert: git revert b70ae32 (or all 3 squash commits).
>
> **Schema validation fix SHIPPED (2026-08-12, session 23):**
> - run_323c3c93 failed at story 3.2 because the worker's artifact had
>   `"failure_type": null` (result was "success") and Zod's `.optional()`
>   rejects `null` (only accepts `undefined`). The worker ACTUALLY SUCCEEDED
>   (21 tests, committed code) but the schema rejection caused
>   `output_status: "escalate"` which killed the build loop.
> - FIX: changed `.optional()` to `.nullish()` (accepts both `null` AND
>   `undefined`) across ALL realcode schemas that parse LLM-emitted JSON:
>   worker.ts (failure_type, failure_description), validator.ts
>   (escalation_type), ship.ts (live_url, repo_url), plan.ts (ux_design_md,
>   prototype_path), build.ts (stories).
> - 206 tests pass. Engine container rebuilt + restarted.
> - Committed + pushed (session 23).
>
> **Dashboard features NOT hardcoded (2026-08-12):**
> - Royce reported a new run (run_e655ced9) was missing StoryProgress /
>   ContainerGrid / LiveTraceStream / ContainerLogViewer. This is NOT a bug --
>   those components render conditionally when `showBuildDetail` is true
>   (build stage running, OR build artifact exists, OR build_state.json
>   exists). run_e655ced9 failed at the `plan` stage (artifact extraction
>   failed: "No <artifact> JSON block found"), so it never reached build.
>   Any run that reaches the build stage will show the mission-control UI.
>
> **Issue #4 SHIPPED (2026-08-12, session 22):**
> - The build stage now orchestrates a real multi-agent, multi-container
>   anymake build loop (BuildLoopRunner). No more single-sandbox collapse.
> - 6 stories shipped via anymake-agile (PRs #5-#10, merge 56af385):
>   A4.1 Contracts (schemas + XOR + ADR-009), A4.2 Engine (BuildLoopRunner),
>   A4.3 Sandbox (opencode env inheritance + secret-scan), A4.4 Agent Specs
>   (worker.yaml + validator.yaml + graph flip), A4.5 Dashboard (mission-control
>   UI), A4.6 Integration (e2e un-skipped + build-loop tests).
> - 206 tests, 0 skipped. Dashboard shows per-story progress, container grid,
>   live trace stream, container log viewer.
> - Each sandbox container inherits operator's full opencode env (config,
>   skills, MCP servers) — read-only mount + startup secret-scan.
> - 3 plan review rounds, 18 comments resolved. A4.3 security gate approved
>   by Royce.
> - Tag: issue-4. Revert: `git revert -m 1 56af385`.
>
> **What's next:**
> 1. Rebuild + restart the engine + dashboard containers (docker compose
>    up -d --build) so the new code is live.
> 2. Do a REAL end-to-end run from the dashboard: click "New Run", type a
>    prompt like "Add a simple health check endpoint to realmemory", and
>    watch the multi-container build loop work. Verify the dashboard shows
>    per-story progress + container logs + live traces.
> 3. If the real run works, the success model (>=85% ship rate) is testable.
> 4. If it escalates, check which story failed — the BuildLoopRunner's
>    build-state.json has the per-story status.
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

**Last updated:** 2026-08-16 (session 28 — issue #19 complete: 8 commits, 3 scenarios ship via web UI)
**Updated by:** Claude (anymake-agile: Cartographer → Architect → 3 review rounds → build → Validator → smoke proof)
**Current phase:** Phase 5 -- Launch (issue #17 design-drift correction shipped, PR #18 awaiting Royce review)
**Current step:** Issue #19 complete. Close #19, then optional follow-ups.
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
| 2026-08-14 | 26 | Phase 5 (agile UX) | Dashboard mobile-first design audit + fixes. Prior pass (b4fed98) was shallow. Deep fixes: mobile bottom nav (sidebar was unreachable on phones), removed dead /traces link (no route), deduped ContainerGrid/LiveTraceStream/ContainerLogViewer (rendered twice -> double polling/SSE), consolidated New Run flows (NewRunSheet -> NewRunDialog), touch targets 24-28px -> 32-36px, safe-area insets (.pt-safe/.pb-safe), StageStepper scroll-fade affordance + 10px->11px text, run-detail header wraps/truncates. tsc clean, next build clean, 61/61 dashboard tests pass. Dashboard container rebuilt + live (HTTP 200). CHANGES UNCOMMITTED. | Royce to approve commit + push; optional phone-viewport smoke |

---

*Phase 5 COMPLETE. Full e2e pipeline shipped: frame->discover->plan->spec->build->ship on a real mission-control project.*
