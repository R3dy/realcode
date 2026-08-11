# realcode -- Phase State

> **[AUTONOMOUS MODE / yolo] ACTIVE** -- `autonomous_mode: true` (set 2026-08-06). Proceeding through phases WITHOUT human approval gates; the Product Owner Proxy evaluates each gate strictly. Security failures + ESCALATE TO USER always pause for the human.

> **RESUME HERE NEXT SESSION** (read this first):
>
> **Next action, in order:**
>
> **Phase 5 (Launch) -- SANDBOX BUILT, E2E RUN IN PROGRESS.** The sandbox image
> (`realcode-sandbox:latest`) is built and working. A real e2e run is progressing
> through stages (intake -> framed -> discovered -> planned -> spec -> build -> ship).
> Dashboard is live AND served via tailscale at https://open-claw01.tail9058f7.ts.net:8301/
>
> **What's done (this session, 2026-08-10/11):**
> - **Tailscale serve on port 8301** -- persistent (--bg), routes to 127.0.0.1:3001
>   (realcode dashboard). All pre-existing routes intact (443, 8333, 8456). Docker
>   compose has restart: unless-stopped + docker enabled on boot = survives reboot.
> - **Sandbox image built** (`realcode-sandbox:latest`): node:20-slim + opencode v1.18.16
>   binary + anymake skill (pre-populated cache) + git. ~184MB. Verified: opencode runs
>   inside, calls OpenRouter, returns results.
> - **realcode-sandbox-net** docker network created.
> - **5 code bugs fixed** (uncommitted -- all in src/ + docker-compose.yml + next.config.mjs):
>   1. Dashboard POST /api/runs didn't publish to queue -- added better-sqlite3 to
>      Next.js serverExternalPackages + createRun() method in lib/engine.ts
>   2. Engine Docker CLI too old (API 1.41 vs daemon 1.52) -- mounted host's docker
>      binary: /usr/bin/docker:/usr/local/bin/docker:ro
>   3. Double ENTRYPOINT "opencode" in sandbox runner -- removed redundant "opencode"
>      from docker args (ENTRYPOINT ["opencode"] already provides it)
>   4. Artifact extraction from JSON-lines format -- extractArtifact now parses JSON
>      events and collects text content before searching for <artifact> tags
>   5. Workspace path translation -- added REALCODE_HOST_DATA_DIR env var so the engine
>      translates /data/workspaces/X (container) to $PWD/data/workspaces/X (host) for
>      Docker volume mounts
> - **Real e2e run** (run_47166ba9, "A simple CLI tool that converts JSON to YAML"):
>   intake -> framed ($0.03) -> discovered ($0.06) -> planned ($0.11) -> [continuing
>   through spec -> build -> ship]. Artifacts being produced and validated at each stage.
>
> **What's NOT done (Phase 5 remaining):**
> 1. **Commit the code changes** -- 5 bug fixes are uncommitted in the repo. Royce
>    should be asked before committing.
> 2. **Complete the e2e run** -- the current run is still progressing. Check if it
>    reaches "shipped" status. If it does, the pipeline dry-run gate is passed.
> 3. **Metrics dashboard** -- Phoenix traces wired but not yet verified with a real
>    run's trace. Check http://localhost:6006 after the run completes.
> 4. **Growth loop / launch checklist** -- per the agentic-harness guide, the pipeline
>    dry-run gate (run one synthetic work item end-to-end) is the gate before declaring
>    Phase 5 done.
> 5. **Push to GitHub** -- the code changes need to be pushed to https://github.com/R3dy/realcode
>
> `project_type: agentic-harness`. `autonomous_mode: true`.

---

**Last updated:** 2026-08-11
**Updated by:** Claude (autonomous mode)
**Current phase:** Phase 5 -- Launch (sandbox built, e2e run in progress)
**Current step:** Phase 5 -- wait for e2e run to complete, verify metrics, commit code
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
| Phase 5: Launch | 🔄 In progress (sandbox built, e2e run progressing) | -- | -- |

## Milestone Progress

| Milestone | Status | Tests |
|-----------|--------|-------|
| M0 Scaffold | ✅ Complete | -- |
| M1 Spike | ✅ Complete (Option B confirmed) | -- |
| M2 Contracts | ✅ Complete | 14 tests |
| M3 Backend | ✅ Complete | 9 tests (incl. concurrent-worker) |
| M4 Engine | ✅ Complete | 5 tests (incl. hard gate) |
| M5 Sandbox | ✅ Complete (sandbox image built 2026-08-11) | -- |
| M6 AgentSpecs | ✅ Complete | 24 tests |
| M7 Tracing | ✅ Complete | -- |
| M8 Control Plane | ✅ Complete | -- |
| M9 Dashboard | ✅ Complete (wired to backend) | -- |
| M10 Integration + Security | ✅ Complete | 20 tests (6 e2e + 14 security) |
| M11 CLI | ✅ Complete | -- |
| M12 Deploy | ✅ Complete | -- |

**Total: 72 tests passing. 12/12 milestones complete.**

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
| 2026-08-11 | 16 | Phase 5 | Tailscale serve 8301. Built realcode-sandbox:latest image + sandbox-net. Fixed 5 code bugs (queue publish, docker CLI, ENTRYPOINT, artifact extraction, workspace path). Real e2e run progressing: intake -> framed -> discovered -> planned -> [spec -> build -> ship]. $0.11/$8 spent. | Complete e2e run, verify Phoenix traces, commit code, push to GitHub |

---

*Phase 5 in progress. Sandbox image built. E2E run active. Next: complete e2e run, verify metrics, commit.*
