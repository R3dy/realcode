# Task Brief — Story A4.2: Engine: build inner loop orchestration

**Created by:** Anymake Planner
**Created at:** 2026-08-11
**Project:** realcode
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## 1. Story Identity

**Story ID:** A4.2
**Story title:** Engine: build inner loop orchestration
**Epic:** Issue #4 — Build stage must orchestrate a multi-container anymake build loop
**Milestone:** Issue #4 build loop (Engine layer — second of 6 stories: A4.1→A4.6)
**Priority:** Must Have (blocks A4.3–A4.6; the BuildLoopRunner is the heart of issue #4)
**This is PR #:** 2 (second PR for issue #4; PR #5 overall in realcode's Phase 4 — A4.1 was PR #5)

---

## 2. User Story

**As a** realcode engine
**I want** the BuildLoopRunner to orchestrate per-story Worker→Validator sandboxes serially
**So that** non-trivial backlogs ship instead of escalating.

---

## 3. Acceptance Criteria

This is your contract. Every criterion must be satisfied before you write `result: success`. Copied verbatim from the approved Development Plan (`docs/06-agile/issue-4/plan.md` §9, Story A4.2).

**Positive paths:**
- [ ] `src/engine/build-loop.ts` exports `BuildLoopRunner` implementing `StageRunner` (the same interface as `AgentStageRunner`: `run(item, stage, workspacePath) → { output_status, artifact, token_usage, trace_id }`)
- [ ] `BuildLoopRunner.run()` reads `spec.json` from storage, parses `artifact.stories` (required structured array — escalates with a clear error if absent)
- [ ] `BuildLoopRunner` writes `data/runs/<run_id>/build-state.json` after every story state transition (pending→building→validating→done/failed/escalated); each `containers[]` entry includes `log_path`
- [ ] Stories execute serially (1 at a time) in dependency order — a story whose `depends_on` are not all `done` is skipped until they are
- [ ] For each story: dispatches Worker sandbox (via `AgentStageRunner.run()` with `{ specOverride: stage.worker_spec, schemaKey: "build_worker", extraContext: { story_id, story_title, acceptance_criteria, role: "build_worker" } }`), then Validator sandbox (with `{ specOverride: stage.validator_spec, schemaKey: "build_validator", extraContext: { story_id, story_title, acceptance_criteria, worker_output, role: "build_validator" } }`)
- [ ] `AgentStageRunner.run()` gains the optional 4th parameter `{ specOverride?, schemaKey?, extraContext? }` — spec loading uses `specOverride ?? stage.agent_spec`; schema lookup uses `schemaKey ?? stage.id`; `extraContext` is merged into the `fillTemplate` context
- [ ] `{acceptance_criteria}` is serialized as a joined string (`"\n".join(acceptance_criteria)`) before interpolation
- [ ] **Result mapping per the §4.2 table:** Worker `result=success` → proceed; Worker `result=failed/environment` → retry (max 3); Worker `result=failed/implementation` → escalate immediately; Worker escalate → escalate immediately. Validator `verdict=pass` → done; Validator `verdict=fail` → retry (max 3); Validator `verdict=escalate` → escalate immediately.
- [ ] Per-story cost tracking: each sandbox's `token_usage.estimated_cost_usd` is added to `run.spent_usd` after the sandbox completes. The cap is checked before each story dispatch (`run.spent_usd >= run.cap_usd` → return escalate("cost cap hit mid-loop") → run transitions `specified → escalated`, terminal per 2-C2).
- [ ] **Control-doc responsiveness (2-C2 — terminal escalation):** `BuildLoopRunner.run()` re-reads `engine.getControlDoc()` between stories; if `run_mode` is `paused`/`paused_cost_cap`, exits, leaves remaining stories `pending`, writes `build-state.json` with `paused: true`, and returns `{ output_status: "escalate", gate_notes: "paused by operator mid-build-loop (N/M stories done)" }` → dispatcher transitions `specified → escalated` (terminal). The run ends `escalated` — pausing mid-loop kills the run (resumable suspension is post-MVP, `PARKING_LOT.md`).
- [ ] **Lease heartbeat (2-C3 — before BOTH Worker and Validator):** `BuildLoopRunner.run()` calls `queue.heartbeat(item.id, stage.timeout_ms)` before the Worker dispatch AND before the Validator dispatch (two heartbeats per story, not one). This keeps the lease fresh across the full 2 × `stage.timeout_ms` story cycle. The `Queue` interface + `SQLiteQueue` gain a real `heartbeat()` method.
- [ ] **Wall-clock bound:** `BuildLoopRunner.run()` sets `wall_clock_deadline_ms = started_at + stage.timeout_ms`; checks before each story; escalates if exceeded
- [ ] On all stories done: writes `build.json` with aggregated `test_results` + `stories` array. Returns `{ output_status: "pass", ... }`.
- [ ] On escalation: writes `build.json` with `status: "escalated"` + `escalations` array. Returns `{ output_status: "escalate", ... }`.
- [ ] `src/engine/dispatcher.ts` `dispatchCycle()` branches: `if (stage.inner_loop)` → if `this.buildLoopRunner` is undefined, throw a clear error (escalate, never crash — guard added at A4.1); else `buildLoopRunner.run()`. Else → `runner.run()`. (2-C1a)
- [ ] `src/engine-loop.ts` (NOTE: the file is `src/engine-loop.ts`, NOT `src/engine/engine-loop.ts`) constructs `BuildLoopRunner` (wrapping `AgentStageRunner`) and passes it to `Engine` as the 6th arg (2-C1a). **`src/cli/index.ts:34` `getEngine()` is also updated** to construct `BuildLoopRunner` and pass it as the 6th arg, so `realcode resume` works for build-stage runs (2-C1a).
- [ ] Per-story turn/tool-call OTel spans emitted via engine-side synthesis from `jsonEvents` (§4.10), stamped with `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.agent_message`, `realcode.tool`, `realcode.tokens.*`
- [ ] `AgentStageRunner.buildDispatchMessage()` stamps `Role: ${opts?.extraContext?.role ?? stage.id}` into the dispatch message (2-C1b, 3-C3) — worker dispatches carry `Role: build_worker`, validator dispatches carry `Role: build_validator` (matching the canned artifact keys + `STAGE_SCHEMAS` keys, so the e2e mock does a direct `STAGE_ARTIFACTS[role]` lookup with no normalization)
- [ ] Unit test: `BuildLoopRunner` with a mock `AgentStageRunner` (returns canned Worker/Validator outputs) processes 3 stories serially, respects dependencies, retries on fail, aggregates costs, honors pause control-doc (returns escalate → `escalated`), heartbeats the lease before BOTH Worker and Validator. (test file: `tests/engine/build-loop.test.ts`)
- [ ] Unit test: a build whose inner loop exceeds the old 10-min lease default completes without a second dispatch of the same work_item (mock `expire_leases` + verify `heartbeat` was called before both Worker and Validator dispatches)

**Error paths:**
- [ ] Error: When `spec.json` is absent or its `artifact.stories` is absent/empty, `BuildLoopRunner.run()` escalates immediately with a clear error message (e.g. "spec artifact lacks structured stories array — cannot build")
- [ ] Error: When the control doc is `paused`/`paused_cost_cap` between stories, the loop exits with `output_status: "escalate"` and `gate_notes: "paused by operator mid-build-loop (N/M stories done)"` → terminal `escalated` (NOT a clean exit into an undefined state)
- [ ] Error: When `run.spent_usd >= run.cap_usd` between stories (mid-loop cost cap hit), the loop returns `escalate("cost cap hit mid-loop (N/M stories done)")` → terminal `escalated` (NOT `paused_cost_cap` — that status is only for before-dispatch cap hits caught by the dispatcher's top-of-cycle check)
- [ ] Error: When a story's Worker returns `result=failed/implementation`, the story is escalated immediately (no retry) — `build-state.json` marks the story `escalated`, the loop returns `escalate`
- [ ] Error: When a story's Worker returns `result=failed/environment`, the story is retried (max 3 attempts per `per_story_build`); after the 3rd failure, the story is escalated
- [ ] Error: When a story's Validator returns `verdict=escalate`, the story is escalated immediately (no retry)
- [ ] Error: When the wall-clock deadline (`started_at + stage.timeout_ms`) is exceeded before a story, the loop escalates

**Edge cases:**
- [ ] Edge: A story whose `depends_on` are not all `done` is skipped (held `pending`) until its dependencies complete; if all remaining stories are blocked (no ready story, but stories remain not-done), the loop escalates with "all remaining blocked"
- [ ] Edge: At A4.2 the `inner_loop` branch in the dispatcher is **unreachable** — no stage in `stage-graph.yaml` has `worker_spec` (the build-stage flip is A4.4). The BuildLoopRunner is constructed and passed to Engine (6-arg) but never invoked by `dispatchCycle()`. All 115 existing tests pass unchanged. A4.2 is tested via direct unit tests with a mock `AgentStageRunner` (not real Docker runs).
- [ ] Edge: The `token_usage.estimated_cost_usd` returned by `BuildLoopRunner.run()` is the **loop increment** (sum of all per-sandbox costs during the loop), NOT the total run cost — so the dispatcher's existing `run.spent_usd += result.token_usage.estimated_cost_usd` computes the correct total without double-counting (see §4 Technical Tasks for the cost-tracking design)

---

## 3a. Experience Script

The literal walkthrough the **Experience Runner** (`AGENTS/experience-runner.md`)
will execute against your branch, live, after the Validator passes it.

**Interaction mode:** Mixed — Terminal (Run) for the build/test/typecheck checks; the agentic-harness manifest specifies Request/Run for engine/backend stories. A4.2 has no dashboard UI change and no new HTTP endpoints. The BuildLoopRunner is not invoked by the dispatcher at A4.2 (the `inner_loop` branch is unreachable — no stage has `worker_spec`), so there is no live-pipeline scenario to drive; the Experience Script is Terminal-only.

**Preconditions:**
**Launch command:** `cd /home/royce/mission-control/PROJECTS/realcode/repo && npm test` (Terminal scenarios). Typecheck: `npm run typecheck`. Lint: `npm run lint`.
**Ready signal:** `npm test` exits 0; `npm run typecheck` exits 0.
**Base URL / entry point:** N/A for this story (no HTTP endpoints, no UI — the BuildLoopRunner is tested via unit tests, not via the live pipeline at A4.2).
**Seed data / test account:** none required (realcode has no auth — INV-5).
**Starting state:** repository checked out on branch `story/A4.2-engine-build-loop-runner`; dependencies installed (`npm install`); A4.1 is merged (commit d9c5582 / PR #5 on `issue/4-multi-container-build-loop`).

**Note on scenario coverage:** A4.2 is an engine-layer story with no UI change and no live-pipeline invocation (the dispatcher's `inner_loop` branch is unreachable at A4.2). Every acceptance criterion is verifiable via Terminal checks: run the test suite, typecheck, lint, and inspect the new source files. The Human-Only criteria (BuildLoopRunner behavior, result mapping, heartbeat, control-doc responsiveness, cost tracking, wall-clock bound) are all covered by `tests/engine/build-loop.test.ts` and `tests/engine/lease-heartbeat.test.ts` — the test assertions ARE the checkable facts. There is no subjective aesthetic judgment and no browser/HTTP surface to drive. A live end-to-end pipeline drive-through (real Docker sandboxes, real Worker/Validator agents) is deferred to A4.6's Experience Script (which requires the A4.3 sandbox + A4.4 agent specs to be built first).

### Scenario 1: All test suites pass (including new BuildLoopRunner + lease-heartbeat tests)

**Verifies acceptance criteria:** Unit test (BuildLoopRunner with mock AgentStageRunner); Unit test (lease heartbeat); All existing suites pass at A4.2

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm test` | — | Exit code 0; stdout contains `build-loop.test.ts` and `lease-heartbeat.test.ts`; total test count is 115 (existing from A4.1) + new BuildLoopRunner tests (≥10 assertions across serial/dependency/retry/cost/pause/heartbeat) + new lease-heartbeat tests (≥3 assertions); no failing tests |

### Scenario 2: TypeScript typechecks cleanly at all Engine constructor call sites (now 6-arg at engine-loop.ts + cli/index.ts)

**Verifies acceptance criteria:** `src/engine-loop.ts` constructs BuildLoopRunner and passes it to Engine as 6th arg; `src/cli/index.ts:34` getEngine() updated; AgentStageRunner.run() gains optional 4th param

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm run typecheck` | — | Exit code 0; no output (clean typecheck — the optional 4th param on `AgentStageRunner.run()` and the 6-arg `Engine` call sites all typecheck) |

### Scenario 3: Lint is clean

**Verifies acceptance criteria:** All existing suites pass at A4.2 (lint is part of CI)

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm run lint` | — | Exit code 0; no errors (new files `src/engine/build-loop.ts` and test files follow existing eslint rules) |

### Scenario 4: BuildLoopRunner implements StageRunner and the result-mapping table is enforced

**Verifies acceptance criteria:** BuildLoopRunner exports + implements StageRunner; result mapping per §4.2 table; control-doc responsiveness; cost tracking; wall-clock bound; lease heartbeat before both; spec.json stories parse; build-state.json written after every transition

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "processes 3 stories serially"` | — | Exit code 0; stdout shows the test passing (3 stories processed in order, each Worker→Validator→done, build-state.json written at each transition, aggregated cost in returned token_usage) |
| 2 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "respects dependencies"` | — | Exit code 0; story with `depends_on` does not start until its dependency is `done` |
| 3 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "retries on environment failure"` | — | Exit code 0; Worker `failed/environment` retried up to 3 times, then story escalated |
| 4 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "escalates immediately on implementation failure"` | — | Exit code 0; Worker `failed/implementation` → story escalated immediately (0 retries) |
| 5 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "honors pause"` | — | Exit code 0; control-doc `paused` between stories → returns `escalate` with `gate_notes` containing "paused by operator mid-build-loop"; build-state.json has `paused: true` |
| 6 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "cost cap"` | — | Exit code 0; `spent_usd >= cap_usd` between stories → returns `escalate` with "cost cap hit mid-loop" |
| 7 | Run | `npx vitest run tests/engine/build-loop.test.ts -t "heartbeat"` | — | Exit code 0; `queue.heartbeat` called before BOTH Worker and Validator dispatches (2 calls per story, verified via mock call assertion) |

### Scenario 5: Lease heartbeat prevents double-dispatch across a long loop (fake timers)

**Verifies acceptance criteria:** Unit test (lease heartbeat — build exceeds old 10-min lease, no second dispatch)

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npx vitest run tests/engine/lease-heartbeat.test.ts` | — | Exit code 0; a 3-story build where each Worker and Validator runs a full `stage.timeout_ms` (20 min each) completes without a second dispatch of the same work_item; `expire_leases()` is called between stories but never clears the lease mid-story (heartbeat refreshed it before each sandbox) |

### Scenario 6: The dispatcher's inner_loop branch is unreachable at A4.2 (graph unchanged)

**Verifies acceptance criteria:** All existing suites pass at A4.2; the graph is unchanged (build stage still has `agent_spec`, no `worker_spec`)

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `grep -c "worker_spec" stage-graph.yaml` | — | Exit code 1 (no matches — `worker_spec` is NOT in `stage-graph.yaml` at A4.2; the build-stage flip is A4.4) |
| 2 | Run | `grep "agent_spec: agent-specs/build.yaml" stage-graph.yaml` | — | Exit code 0; the build stage still has `agent_spec: agent-specs/build.yaml` (unchanged from A4.1) |
| 3 | Run | `npx vitest run tests/integration/e2e.test.ts` | — | Exit code 0; the existing e2e (frame→ship) passes unchanged — the dispatcher takes the old `runner.run()` path for the build stage |

---

## 4. Technical Tasks

Build in this exact order. Each task gets its own commit. The agentic-harness Phase 4 build order is: Contracts → Backend → Engine → Sandbox → Per-stage agents → Dashboard → Integration tests. A4.2 is the **Backend + Engine** layer. A4.1 (Contracts) is complete (PR #5 merged). A4.2 builds the `BuildLoopRunner` class, the `AgentStageRunner.run()` signature change, the `Queue.heartbeat()` method, and the wiring — but does NOT create `worker.yaml`/`validator.yaml` (A4.4) or modify `stage-graph.yaml` (A4.4). At A4.2 the dispatcher's `inner_loop` branch is unreachable (no stage has `worker_spec`); the BuildLoopRunner is tested via direct unit tests with a mock `AgentStageRunner`.

- [ ] **Backend (extend): `src/backend/types.ts`** — Add `heartbeat(item_id: string, lease_ms: number): void;` to the `Queue` interface (after `annotate` at line 20). This is a new method that extends the lease for a claimed work item by `lease_ms` from now.

- [ ] **Backend (extend): `src/backend/sqlite-queue.ts`** — Implement `heartbeat()` on `SQLiteQueue`:
  ```typescript
  heartbeat(item_id: string, lease_ms: number): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE work_items SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND worker_id IS NOT NULL`,
    ).run(now + lease_ms, now, item_id);
  }
  ```
  Place it after `annotate()` (line 78). The `WHERE worker_id IS NOT NULL` guard ensures we only heartbeat items that are currently claimed (no-op for unclaimed items — prevents accidentally leasing a released item). This matches plan §4.13. Do NOT use `annotate()` (it's a no-op at line 76).

- [ ] **Engine (extend): `src/agents/runner.ts` — `AgentStageRunner.run()` 4th param** — Change the signature from `async run(item, stage, workspacePath)` to:
  ```typescript
  async run(
    item: WorkItem,
    stage: StageEntry,
    workspacePath: string,
    opts?: {
      specOverride?: string;
      schemaKey?: string;
      extraContext?: Record<string, unknown>;
    },
  )
  ```
  Three mechanical changes inside `run()` + one in `buildDispatchMessage()`:

  1. **Spec loading** (currently line 60: `const specPath = path.resolve(this.options.repoRoot, stage.agent_spec);`): change to `const specPath = path.resolve(this.options.repoRoot, opts?.specOverride ?? stage.agent_spec);`. The existing guard at lines 54-59 (throws if `!stage.agent_spec`) must be updated: only throw if `!stage.agent_spec && !opts?.specOverride` (so a BuildLoopRunner dispatch with `specOverride` works even when `stage.agent_spec` is undefined for an inner-loop stage). The guard message should mention both paths.

  2. **Schema lookup** (currently line 115: `const schema = STAGE_SCHEMAS[stage.id];`): change to `const schemaKey = opts?.schemaKey ?? stage.id; const schema = STAGE_SCHEMAS[schemaKey];`. Also update `getStageSchemaJson(stage.id)` (line 65) to use `opts?.schemaKey ?? stage.id` — pass the resolved key into `getStageSchemaJson`. This ensures a Worker dispatch validates against `WorkerOutput` (key `build_worker`) and the prompt shows the worker output schema, not `BuildOutput`.

  3. **Template context** (currently lines 63-64): `const priorArtifacts = this.gatherPriorArtifacts(...); const userPrompt = this.fillTemplate(spec.user_prompt_template, priorArtifacts);` — change to merge extraContext: `const ctx = { ...priorArtifacts, ...(opts?.extraContext ?? {}) }; const userPrompt = this.fillTemplate(spec.user_prompt_template, ctx);`. Unresolved placeholders (e.g. `{story_id}` when `extraContext` is not provided) still pass through literally (line 199 unchanged) — but with `extraContext` providing `story_id`/`story_title`/`acceptance_criteria`/`worker_output`, the worker/validator prompts resolve correctly.

  4. **`buildDispatchMessage()` Role: marker** — The `buildDispatchMessage()` method (line 311) currently stamps `Stage: ${stage.id}`. Add a `Role:` line: the method needs access to the role value. The cleanest approach: pass `opts?.extraContext?.role` into `buildDispatchMessage` as a 5th param (or read it from a new param). Add `Role: ${role ?? stage.id}` on the line after `Stage: ${stage.id} (anymake Phase ${spec.anymake_phase})`. Worker dispatches carry `Role: build_worker`; Validator dispatches carry `Role: build_validator` (these directly match the canned artifact keys + `STAGE_SCHEMAS` keys, so the e2e mock in A4.6 does a direct `STAGE_ARTIFACTS[role]` lookup with no normalization). Non-build stages (no `role` in `extraContext`) fall back to `Role: <stage.id>` (e.g. `Role: frame`).

  **Important:** the existing non-build stages (frame/discover/plan/spec/ship) call `run()` WITHOUT the 4th param — `opts` is `undefined`, so `specOverride`/`schemaKey`/`extraContext` are all `undefined`, and the fallbacks (`opts?.specOverride ?? stage.agent_spec`, `opts?.schemaKey ?? stage.id`, `...(opts?.extraContext ?? {})`) reproduce the exact current behavior. The 115 existing tests must pass unchanged.

- [ ] **Engine (extend): `src/agents/runner.ts` — `STAGE_SCHEMAS` map** — Add `build_worker: WorkerOutput` and `build_validator: ValidatorOutput` to the `STAGE_SCHEMAS` map (line 18). Import `WorkerOutput` and `ValidatorOutput` from `../schemas/index.js` (add to the existing import block at lines 9-16). At A4.2 no stage uses these keys (the dispatcher's inner_loop branch is unreachable), but they must exist so that when A4.4 flips the build stage, the schema lookup works. This is harmless (map entries that are never queried).

- [ ] **Engine (new): `src/engine/build-loop.ts`** — Create the `BuildLoopRunner` class. This is the core of A4.2. It implements the `StageRunner` interface (defined in `src/engine/dispatcher.ts` lines 62-69):
  ```typescript
  interface StageRunner {
    run(item: WorkItem, stage: StageEntry, workspacePath: string): Promise<{
      output_status: string;
      artifact: Record<string, unknown>;
      token_usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number };
      trace_id: string;
    }>;
  }
  ```

  **Constructor** (per plan §4.2):
  ```typescript
  export interface BuildLoopRunnerOptions {
    repoRoot: string;
  }

  export class BuildLoopRunner implements StageRunner {
    constructor(
      private runner: AgentStageRunner,
      private storage: Storage,
      private graph: StageGraph,
      private queue: Queue,
      private options: BuildLoopRunnerOptions,
    ) {}
  }
  ```
  Note: `SandboxRunner` is NOT a direct dependency of `BuildLoopRunner` (it dispatches via `AgentStageRunner.run()`, which internally uses `SandboxRunner`). The plan §4.2 construction signature includes `sandbox` but `BuildLoopRunner` does not call `sandbox` directly — omit it unless you find you need it for container log writing (you should NOT need it; logs come from `AgentStageRunner.run()`'s return, which wraps `SandboxResult`). Import `AgentStageRunner` from `../agents/runner.js`, `Storage`/`Queue`/`WorkItem` from `../backend/types.js`, `StageGraph`/`StageEntry` from `./stage-graph.js`, `StageRunner` from `./dispatcher.js`.

  **`run(item, stage, workspacePath)` method** — implement the plan §4.2 pseudocode. The detailed algorithm:

  1. **Read the spec artifact:** `const specRaw = this.storage.read(\`runs/${item.run_id}/spec.json\`);`. Parse it. If absent, escalate: `return { output_status: "escalate", artifact: { error: "spec artifact not found" }, token_usage: zeroTokens, trace_id: item.run_id }`. Parse `specRaw.artifact.stories` (the structured array — required per A4.1's `SpecArtifact`). If `stories` is absent or empty, escalate: `return { output_status: "escalate", artifact: { error: "spec artifact lacks structured stories array — cannot build" }, ... }`. Also parse `specRaw.artifact.dependency_graph` (a string — not used for ordering at A4.2; ordering is derived from each story's `depends_on` array).

  2. **Read the run record:** `const runRaw = this.storage.read(\`runs/${item.run_id}/run.json\`);` → parse to get `preLoopSpentUsd = run.spent_usd` and `cap_usd = run.cap_usd`. The run record is the pre-loop snapshot (the dispatcher read it before calling `run()`).

  3. **Read the control doc:** `const control = this.readControlDoc();` — read `control.json` from storage (same logic as `Engine.getControlDoc()` — replicate the read + default logic, or extract a shared helper). Check `control.run_mode` — if `paused`/`paused_cost_cap`, escalate immediately before starting any story.

  4. **Initialize build state:** Write `data/runs/<run_id>/build-state.json`:
     ```json
     {
       "run_id": "<run_id>",
       "started_at": <epoch_ms>,
       "wall_clock_deadline_ms": <started_at + stage.timeout_ms>,
       "paused": false,
       "pause_reason": null,
       "stories": [
         {
           "story_id": "3.1",
           "title": "...",
           "status": "pending",
           "retry_count": 0,
           "worker_container_id": null,
           "validator_container_id": null,
           "worker_output": null,
           "validator_output": null,
           "started_at": null,
           "completed_at": null
         }
       ],
       "containers": []
     }
     ```
     Use a private `writeBuildState(state)` helper that serializes + writes via `this.storage.write(\`runs/${item.run_id}/build-state.json\`, ...)`. Call it after every state transition (not batched) so the dashboard can poll it.

  5. **Inner loop** (serial, 1 story at a time per ADR-009/planning-doc ADR-007):
     ```
     loopCostUsd = 0  // local accumulator — the loop increment
     while true:
       // Control-doc check between stories (2-C2: terminal escalation)
       control = this.readControlDoc()
       if control.run_mode in ("paused", "paused_cost_cap"):
         buildState.paused = true
         buildState.pause_reason = "operator paused"
         this.writeBuildState(buildState)
         return escalate("paused by operator mid-build-loop (N/M stories done)")

       story = nextReadyStory()  // status=pending AND all depends_on are done
       if no story ready AND stories remain not-done:
         return escalate("all remaining blocked (N/M stories done)")
       if all stories done:
         break  // success

       // Cost cap check between stories (2-C2: terminal escalation)
       if preLoopSpentUsd + loopCostUsd >= cap_usd:
         return escalate("cost cap hit mid-loop (N/M stories done)")

       // Wall-clock bound check
       if Date.now() > buildState.wall_clock_deadline_ms:
         return escalate("wall-clock bound exceeded (N/M stories done)")

       // Lease heartbeat before Worker (2-C3)
       this.queue.heartbeat(item.id, stage.timeout_ms)

       // Dispatch Worker
       story.status = "building"; story.started_at = Date.now(); writeBuildState()
       workerResult = await this.runner.run(item, stage, workspacePath, {
         specOverride: stage.worker_spec,
         schemaKey: "build_worker",
         extraContext: {
           story_id: story.id,
           story_title: story.title,
           acceptance_criteria: story.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n"),
           role: "build_worker",
         },
       })
       story.worker_output = workerResult.artifact
       // Container ID capture: workerResult does not directly carry container_id at A4.2
       // (the SandboxResult.containerId field is added in A4.3). At A4.2, set worker_container_id = null
       // or omit it. A4.3 adds real container ID capture via --cidfile.
       loopCostUsd += workerResult.token_usage.estimated_cost_usd
       // Emit per-turn spans (§4.10)
       this.emitTurnSpans(item.run_id, story.id, "build_worker", workerResult.jsonEvents ?? [], stageSpan)
       writeBuildState()

       // Worker result mapping (§4.2 table)
       const workerArtifact = workerResult.artifact as { result?: string; failure_type?: string }
       if workerResult.output_status === "escalate":
         story.status = "escalated"; writeBuildState()
         return escalate("story ${story.id} worker escalated")
       if workerArtifact.result === "success":
         // proceed to validator
       else if workerArtifact.result === "failed" && workerArtifact.failure_type === "environment":
         story.retry_count++
         if story.retry_count >= 3:  // per_story_build ceiling
           story.status = "escalated"; writeBuildState()
           return escalate("story ${story.id} worker environment failure (3 retries)")
         else:
           story.status = "pending"; writeBuildState()
           continue  // retry same story (re-dispatch worker)
       else if workerArtifact.result === "failed" && workerArtifact.failure_type === "implementation":
         story.status = "escalated"; writeBuildState()
         return escalate("story ${story.id} worker implementation failure")
       else:
         // unknown result — escalate
         story.status = "escalated"; writeBuildState()
         return escalate("story ${story.id} worker unknown result")

       // Lease heartbeat before Validator (2-C3)
       this.queue.heartbeat(item.id, stage.timeout_ms)

       // Dispatch Validator
       story.status = "validating"; writeBuildState()
       validatorResult = await this.runner.run(item, stage, workspacePath, {
         specOverride: stage.validator_spec,
         schemaKey: "build_validator",
         extraContext: {
           story_id: story.id,
           story_title: story.title,
           acceptance_criteria: story.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n"),
           worker_output: workerResult.artifact,  // JSON object — fillTemplate will JSON.stringify it (truncated at 8000 per ADR-008)
           role: "build_validator",
         },
       })
       story.validator_output = validatorResult.artifact
       loopCostUsd += validatorResult.token_usage.estimated_cost_usd
       this.emitTurnSpans(item.run_id, story.id, "build_validator", validatorResult.jsonEvents ?? [], stageSpan)
       writeBuildState()

       // Validator result mapping (§4.2 table)
       const validatorArtifact = validatorResult.artifact as { verdict?: string }
       if validatorResult.output_status === "escalate":
         story.status = "escalated"; writeBuildState()
         return escalate("story ${story.id} validator escalated")
       if validatorArtifact.verdict === "pass":
         story.status = "done"; story.completed_at = Date.now(); writeBuildState()
         // continue to next story
       else if validatorArtifact.verdict === "fail":
         story.retry_count++
         if story.retry_count >= 3:  // per_story_build ceiling
           story.status = "escalated"; writeBuildState()
           return escalate("story ${story.id} validator fail (3 retries)")
         else:
           story.status = "pending"; writeBuildState()
           continue  // retry (re-dispatch worker)
       else:  // verdict === "escalate"
         story.status = "escalated"; writeBuildState()
         return escalate("story ${story.id} validator escalate verdict")
     ```

     **`nextReadyStory()`** helper: iterate `buildState.stories`, return the first story with `status === "pending"` AND every `depends_on` ID is a story with `status === "done"`. If no story is ready but stories remain not-done (pending/building/validating/failed), return null → the loop escalates "all remaining blocked". If all stories are `done`, return a sentinel indicating success.

     **Cost-tracking design (CRITICAL — avoids double-counting):** `BuildLoopRunner.run()` does NOT write `run.json` during the loop. It reads `run.json` once at the start to get `preLoopSpentUsd`. It tracks `loopCostUsd` locally. The mid-loop cap check is `preLoopSpentUsd + loopCostUsd >= cap_usd`. It returns `token_usage.estimated_cost_usd = loopCostUsd` (the loop increment, NOT the total run cost). The dispatcher's existing code at `dispatcher.ts:238` does `run.spent_usd += result.token_usage.estimated_cost_usd` — where `run` is the pre-loop snapshot (read at line 197 before `run()` was called). So `run.spent_usd` becomes `preLoopSpentUsd + loopCostUsd` = the correct total. The dispatcher then writes `run.json` once at line 239 (`this.updateRun(run)`). This is the authoritative write. Do NOT write `run.json` from inside `BuildLoopRunner.run()` — that would create a stale-run overwrite race (the dispatcher's in-memory `run` object was read before the loop started and would overwrite your intermediate writes with a stale value at the end). The per-sandbox cost breakdown is recorded in `build-state.json`'s per-story `worker_cost_usd`/`validator_cost_usd` fields (for dashboard visibility) — that file IS written during the loop.

     **`emitTurnSpans()` helper** (§4.10): After each Worker/Validator sandbox completes, convert the sandbox's `jsonEvents` into per-turn OTel spans. Each JSON event with a `part.tokens` field becomes a turn span; each event with `part.type === "tool_use"` or `part.tool` becomes a tool-call span. Use the existing `startTurnSpan` helper from `src/engine/tracing.ts` (or a new `startBuildTurnSpan` if the signature doesn't fit — `startTurnSpan(runId, stageId, turnIndex, agent, model)` can be reused with `stageId = \`${role}_${storyId}\``). Stamp spans with `realcode.run_id`, `realcode.story_id`, `realcode.role` (`build_worker`/`build_validator`), `realcode.turn`, `realcode.tokens.*`, `realcode.cost.usd`, `realcode.agent_message` (from `part.text`, truncated to 2000 chars), `realcode.tool` (from `part.tool`). End each span immediately (these are per-completed-sandbox, not long-lived). See plan §4.10 for the full synthesis pseudocode.

     **Note on `jsonEvents`:** The `StageRunner.run()` return type (defined in `dispatcher.ts:62-69`) does NOT include `jsonEvents` — it returns `{ output_status, artifact, token_usage, trace_id }`. But `AgentStageRunner.run()` internally has `result.jsonEvents` (from `SandboxRunner`). For A4.2's unit tests with a mock `AgentStageRunner`, the mock returns canned outputs WITHOUT `jsonEvents`. For real dispatches (A4.4+), `AgentStageRunner.run()` would need to expose `jsonEvents` in its return for `BuildLoopRunner` to synthesize spans. **Resolution for A4.2:** extend the `StageRunner` return type to include an optional `jsonEvents?: unknown[]` field (additive — existing returns don't include it, which is fine for optional). `AgentStageRunner.run()` should include `jsonEvents: result.jsonEvents` in its return (it already has `result.jsonEvents` at line 79). The mock in unit tests omits it (undefined → `?? []`). This is a minimal, backward-compatible extension. Update the `StageRunner` interface in `dispatcher.ts` (lines 62-69) to add `jsonEvents?: unknown[]` to the return type.

  6. **On completion (all stories done):** Build the aggregated `BuildArtifact`:
     ```typescript
     const aggregatedTokens = { prompt_tokens: sum, completion_tokens: sum, total_tokens: sum, estimated_cost_usd: loopCostUsd };
     const buildArtifact = {
       repo_path: workspacePath,
       test_results: { passed: sumTestPassed, failed: sumTestFailed, skipped: 0, coverage_pct: 0 },
       prs_merged: [],
       escalations: [],
       stories: buildState.stories.map(s => ({
         story_id: s.story_id,
         status: s.status === "done" ? "done" : "escalated",
         retry_count: s.retry_count,
         worker_tokens: s.worker_tokens ?? 0,
         validator_tokens: s.validator_tokens ?? 0,
         worker_cost_usd: s.worker_cost_usd ?? 0,
         validator_cost_usd: s.validator_cost_usd ?? 0,
         test_passed: s.test_passed ?? 0,
         test_failed: s.test_failed ?? 0,
       })),
     };
     return { output_status: "pass", artifact: buildArtifact, token_usage: aggregatedTokens, trace_id: item.run_id, jsonEvents: [] };
     ```
     The dispatcher writes `build.json` from this return (at `dispatcher.ts:242-250`) and transitions `specified → built`.

  7. **On escalation:** Return `{ output_status: "escalate", artifact: { ...buildArtifact, status: "escalated", escalations: [{story: story_id, reason: ...}] }, token_usage: aggregatedTokens, trace_id: item.run_id, jsonEvents: [] }`. The dispatcher transitions `specified → escalated` (terminal per stage-graph.yaml).

- [ ] **Engine (extend): `src/engine/dispatcher.ts` — `StageRunner` interface** — Add `jsonEvents?: unknown[]` to the return type of `StageRunner.run()` (lines 63-68). This is additive/optional — existing returns (from `AgentStageRunner.run()`) should include `jsonEvents` (add `jsonEvents: result.jsonEvents` to the return at line 139-144), and the mock returns in tests omit it (undefined is valid for an optional field). The dispatcher's existing handling of `result` (lines 231-260) does not read `jsonEvents` — it's only consumed by `BuildLoopRunner.emitTurnSpans()`.

  **Note:** The dispatcher's `dispatchCycle()` inner_loop branch (lines 220-227) was already added in A4.1. It branches on `stage.inner_loop && stage.worker_spec`. At A4.2 no stage has `worker_spec`, so this branch is unreachable — the BuildLoopRunner is never invoked by the dispatcher. The branch + guard are correct as-is (verified in `tests/engine/dispatcher-guard.test.ts`). Do NOT modify the dispatcher's branch logic in A4.2.

- [ ] **Engine (extend): `src/engine-loop.ts`** — Construct `BuildLoopRunner` and pass it to `Engine` as the 6th arg. NOTE: the file is `src/engine-loop.ts` (NOT `src/engine/engine-loop.ts`). Currently line 27: `const engine = new Engine(graph, queue, storage, runner, DATA_DIR);`. Change to:
  ```typescript
  import { BuildLoopRunner } from "./engine/build-loop.js";
  // ... after constructing runner (line 23-26):
  const buildLoop = new BuildLoopRunner(runner, storage, graph, queue, { repoRoot: process.cwd() });
  const engine = new Engine(graph, queue, storage, runner, DATA_DIR, buildLoop);
  ```
  The `BuildLoopRunner` wraps the existing `AgentStageRunner` instance (passed as `runner`). It does NOT need `SandboxRunner` directly (it dispatches via `AgentStageRunner.run()`).

- [ ] **Engine (extend): `src/cli/index.ts`** — Update `getEngine()` (line 21-35) to construct `BuildLoopRunner` and pass it as the 6th arg. Currently line 34: `return { engine: new Engine(stageGraph, queue, storage, runner, dir), stageGraph, queue, storage };`. Change to:
  ```typescript
  import { BuildLoopRunner } from "../engine/build-loop.js";
  // ... inside getEngine(), after constructing runner:
  const buildLoop = new BuildLoopRunner(runner, storage, stageGraph, queue, { repoRoot: process.cwd() });
  return { engine: new Engine(stageGraph, queue, storage, runner, dir, buildLoop), stageGraph, queue, storage };
  ```
  This ensures `realcode resume` works for build-stage runs (without it, a `specified` run would hit the dispatcher's inner_loop guard and escalate with "no BuildLoopRunner configured").

- [ ] **Engine (extend): `src/engine/index.ts`** — Export `BuildLoopRunner` and `BuildLoopRunnerOptions`:
  ```typescript
  export { BuildLoopRunner } from "./build-loop.js";
  export type { BuildLoopRunnerOptions } from "./build-loop.js";
  ```

- [ ] **Engine (extend): `src/engine/tracing.ts`** — The existing `startTurnSpan(runId, stageId, turnIndex, agent, model)` (line 60) can be reused for build_worker/build_validator turn spans. If the signature fits (pass `stageId = \`${role}_${storyId}\``, `agent = role`, `model = ""`), no new function is needed — `BuildLoopRunner.emitTurnSpans()` calls `startTurnSpan` directly and adds the extra attributes (`realcode.story_id`, `realcode.role`, `realcode.tokens.*`, `realcode.agent_message`, `realcode.tool`) via `span.setAttributes()`. If you need a dedicated helper, add `startBuildTurnSpan(runId, storyId, role, turnIndex)` that wraps `startTurnSpan` + sets the build-specific attributes. Either approach is fine — the key requirement is that per-turn spans land in Phoenix with `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.agent_message`, `realcode.tool`, `realcode.tokens.*`. Import `trace` from `@opentelemetry/api` (already imported in tracing.ts). Use `trace.getTracer("realcode").startSpan(...)` for tool-call spans (child of the turn span). See plan §4.10 for the full synthesis pseudocode.

- [ ] **Test (new): `tests/engine/build-loop.test.ts`** — Unit tests for `BuildLoopRunner` with a mock `AgentStageRunner`. The mock returns canned `WorkerOutput`/`ValidatorOutput`-shaped results (the mock doesn't go through schema validation — it returns `{ output_status, artifact, token_usage, trace_id }` directly, where `artifact` has the `result`/`verdict`/`failure_type` fields the mapping table reads). Test cases:
  - **Serial processing:** 3 stories (no dependencies), all succeed (Worker `result: "success"` → Validator `verdict: "pass"`). Assert: stories processed in order, `build-state.json` written at each transition (pending→building→validating→done), returned `output_status: "pass"`, `artifact.stories` has 3 entries all `status: "done"`, `token_usage.estimated_cost_usd` = sum of all 6 sandbox costs.
  - **Dependency ordering:** 3 stories where story 2 `depends_on: ["1"]` and story 3 `depends_on: ["2"]`. Assert: story 2 does not start until story 1 is `done`; story 3 does not start until story 2 is `done`. Use story IDs like "1", "2", "3".
  - **Environment failure retry:** Worker returns `result: "failed", failure_type: "environment"` on attempt 1, then `result: "success"` on attempt 2. Assert: `retry_count` increments to 1, story completes on 2nd attempt.
  - **Environment failure ceiling:** Worker returns `result: "failed", failure_type: "environment"` 3 times. Assert: story `escalated` after 3rd failure, loop returns `escalate`.
  - **Implementation failure:** Worker returns `result: "failed", failure_type: "implementation"`. Assert: story `escalated` immediately (0 retries), loop returns `escalate`.
  - **Validator fail retry:** Worker succeeds, Validator returns `verdict: "fail"` on attempt 1, then `verdict: "pass"` on attempt 2. Assert: `retry_count` increments, story completes on 2nd attempt (worker re-dispatched).
  - **Validator escalate:** Worker succeeds, Validator returns `verdict: "escalate"`. Assert: story `escalated` immediately, loop returns `escalate`.
  - **Control-doc pause:** Set `control.json` to `run_mode: "paused"` before the 2nd story. Assert: loop returns `escalate` with `gate_notes` containing "paused by operator mid-build-loop", `build-state.json` has `paused: true`, remaining stories `pending`.
  - **Cost cap mid-loop:** Set `cap_usd` low (e.g. $0.01), Worker+Validator cost exceeds it after story 1. Assert: loop returns `escalate` with "cost cap hit mid-loop", `preLoopSpent + loopCost >= cap`.
  - **Wall-clock bound:** Set `stage.timeout_ms` very low (e.g. 1ms) or use fake timers to advance past the deadline. Assert: loop returns `escalate` with "wall-clock bound exceeded".
  - **Heartbeat before both:** Assert the mock `queue.heartbeat` was called exactly twice per story (once before Worker, once before Validator) — verify via `vi.fn()` call count.
  - **Missing spec stories:** `spec.json` has no `stories` array. Assert: loop returns `escalate` with "spec artifact lacks structured stories array".
  - **All blocked:** 2 stories where story 2 depends on story 1, story 1's Worker escalates. Assert: story 1 is `escalated`, loop returns `escalate` (story 2 never starts).
  - **Cost increment returned:** Assert `result.token_usage.estimated_cost_usd` equals the sum of per-sandbox costs (the loop increment), NOT including the pre-loop `spent_usd` (no double-counting).

  Setup: construct `BuildLoopRunner` with a mock `AgentStageRunner` (vi.fn returning canned results per dispatch — use a queue of return values so the 1st call returns the Worker result, 2nd returns Validator, etc., keyed on `opts.schemaKey`), a real `SQLiteQueue` (temp dir) + `FileStorage` (temp dir) + the real `stage-graph.yaml` (or a synthetic graph with a build stage that has `worker_spec`/`validator_spec` set — do NOT modify the real `stage-graph.yaml`). Write a `spec.json` + `run.json` + `control.json` to the temp storage before calling `run()`. Use `item = { id: "test-item", run_id: "run_test", stage: "build", status: "specified", ... }`.

- [ ] **Test (new): `tests/engine/lease-heartbeat.test.ts`** — Fake-timer test (2-C3). Use `vi.useFakeTimers()`. A 3-story build where each Worker and Validator sandbox "runs" a full `stage.timeout_ms` (20 min = 1,200,000ms each, 40 min per story, 120 min total). The mock `AgentStageRunner.run()` advances the clock by `stage.timeout_ms` before returning. Assert: `queue.heartbeat` was called before BOTH Worker and Validator for each story (6 total calls for 3 stories). Call `queue.expire_leases()` between stories (simulating the dispatcher's `expire_leases()` call) — assert it does NOT clear the lease mid-story (the heartbeat refreshed it). The build completes without a second dispatch of the same work_item (verify `queue.claim` returns null for the item's status while the loop is running, or verify the item's `worker_id` is still set throughout). Restore real timers in `afterEach`.

- [ ] **Integration: none** — no third-party service connections in this story. The BuildLoopRunner is tested via unit tests with mocks; real Docker sandbox integration is A4.6.

---

## 5. Build Order Constraint

This is the second story of issue #4's 6-story build loop (A4.1→A4.6). It depends on A4.1 (Contracts — complete, PR #5 merged at commit d9c5582).

**Must be complete first (A4.1 — ✅ Done):**
- `WorkerOutput`/`ValidatorOutput` schemas exist in `src/schemas/worker.ts`/`src/schemas/validator.ts` (A4.1)
- `SpecArtifact.stories` is required with `.refine()` (A4.1) — `BuildLoopRunner.run()` reads it
- `BuildArtifact.stories` is optional (A4.1) — `BuildLoopRunner` writes it on completion
- `StageEntry.agent_spec` is optional; `worker_spec`/`validator_spec` exist as optional fields (A4.1)
- `Engine` constructor has optional 6th param `buildLoopRunner?: StageRunner` (A4.1)
- Dispatcher's `inner_loop` branch + missing-runner guard exist (A4.1 — branches on `stage.inner_loop && stage.worker_spec`)
- ADR-009 is written in `docs/DECISIONS.md` (A4.1)
- 115 tests pass at A4.1 (90 original + 25 new from A4.1)

**Must be complete before:** A4.3 (Sandbox — opencode env inheritance; needs `BuildLoopRunner` to call it), A4.4 (Agent specs — worker.yaml/validator.yaml + stage-graph flip; needs the `specOverride`/`schemaKey`/`extraContext` 4th param + `STAGE_SCHEMAS` entries), A4.5 (Dashboard — needs `build-state.json` shape), A4.6 (Integration tests — needs everything).

**Branch:** `story/A4.2-engine-build-loop-runner` off `issue/4-multi-container-build-loop` (which now contains A4.1 at commit d9c5582).

---

## 6. Technical Context

Use these for patterns and consistency — do not reinvent what's already built.

**Stack (from ADRs + manifest):**
- Language: TypeScript (Node.js, ESM modules — `"type": "module"` in package.json)
- Schema validation: Zod 3.x + zod-to-json-schema
- Backend: SQLite (better-sqlite3) for the queue; filesystem (`FileStorage`) for storage
- Testing: Vitest 2.x (`npm test` = `vitest run`); fake timers via `vi.useFakeTimers()`
- Tracing: OpenTelemetry OTLP → Phoenix (`@opentelemetry/api`, `@opentelemetry/sdk-node`)
- Dashboard: Next.js 14 + React 18 + Tailwind (NOT touched in this story)

**Existing patterns to follow:**

Pulled from `CONVENTIONS.md` where available — see that file's matching entry for each pattern before falling back to a fresh code scan.

Engine / dispatcher pattern:
```
See: src/engine/dispatcher.ts — the Engine class, StageRunner interface (lines 62-69), dispatchCycle() (lines 177-278).
      CONVENTIONS.md §"Engine / Dispatcher Pattern" says "(none established yet)" — dispatcher.ts IS the
      established pattern. The dispatch call is at line 218-230 (the inner_loop branch, added in A4.1).
      The try/catch at line 218/269 escalates on error. The cost-cap check is at line 204 (before dispatch).
      BuildLoopRunner follows the same StageRunner interface — it's a drop-in alternative to AgentStageRunner
      for inner-loop stages.
```

Stage-runner / agent dispatch pattern:
```
See: src/agents/runner.ts — AgentStageRunner.run() (lines 53-145). This is the pattern BuildLoopRunner
      delegates to (it calls agentStageRunner.run() with specOverride/schemaKey/extraContext).
      The existing run() loads the spec, fills the template, dispatches the sandbox, extracts the <artifact>,
      validates against STAGE_SCHEMAS. The 4th param (opts) extends this without changing the non-build path.
      CONVENTIONS.md §"Agent Spec Pattern" — fillTemplate truncates at 8000 chars (ADR-008).
```

Stage-graph loader pattern:
```
See: src/engine/stage-graph.ts — StageEntry schema (lines 13-30), validateGraph() with the XOR rule (lines 108-145,
      added in A4.1). The inner_loop/worker_spec/validator_spec fields are optional. At A4.2 no stage uses them.
```

Backend / queue pattern:
```
See: src/backend/sqlite-queue.ts — SQLiteQueue (claim at line 42, release at line 69, expire_leases at line 96).
      CONVENTIONS.md §"Sandbox / Docker Pattern" covers host-path translation (not relevant to A4.2).
      The heartbeat() method follows the same prepared-statement pattern as the other queue methods.
      The Queue interface is in src/backend/types.ts (lines 16-26).
```

Tracing pattern:
```
See: src/engine/tracing.ts — startStageSpan (line 47), startTurnSpan (line 60), recordTokenUsage (line 75).
      The per-turn helpers are defined but never called (grep-verified in the plan). A4.2 is the first story
      to actually call startTurnSpan (from BuildLoopRunner.emitTurnSpans). Follow the existing span-attribute
      naming convention: "realcode.run_id", "realcode.story_id", "realcode.role", "realcode.tokens.*".
```

Testing pattern:
```
See: CONVENTIONS.md §"Testing Pattern" — "npm test runs vitest run — all unit + integration tests.
      115/115 tests as of A4.1 (commit d9c5582)." New test files go in tests/engine/.
      Use describe/it/expect/vi from vitest. For fake-timer tests: vi.useFakeTimers() / vi.useRealTimers().
      See tests/engine/dispatcher-guard.test.ts (added in A4.1) for the temp-dir + SQLiteQueue + FileStorage
      setup pattern used in engine tests.
```

**Current schema (relevant to this story):**

The schemas are zod objects, not SQL tables. Relevant current state (post-A4.1):

```typescript
// src/schemas/base.ts — StageOutputBase (the base every stage output extends):
StageOutputBase = z.object({
  schema_version: z.literal(1),
  run_id: z.string().min(1),
  trace_id: z.string().min(1),
  gate_verdict: z.enum(["pass", "needs_changes", "escalate"]),
  gate_notes: z.string().default(""),
  token_usage: z.object({ prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd }),
});
// NOTE: GateVerdict is "pass" | "needs_changes" | "escalate" — there is NO "fail" value.
// The Worker/Validator result mapping branches on ARTIFACT fields (result/verdict), NOT gate_verdict.

// src/schemas/worker.ts (created in A4.1):
WorkerArtifact = { story_id, result: "success"|"failed", failure_type?: "environment"|"implementation",
                   failure_description?, branch, commits[], test_output, test_passed, test_failed, notes }
WorkerOutput = StageOutputBase + { stage: "build_worker", status: "success"|"failed"|"escalated", artifact: WorkerArtifact }

// src/schemas/validator.ts (created in A4.1):
ValidatorArtifact = { story_id, verdict: "pass"|"fail"|"escalate", escalation_type?,
                      criteria_results[], security_checklist[], notes }
ValidatorOutput = StageOutputBase + { stage: "build_validator", status: "pass"|"fail"|"escalate", artifact: ValidatorArtifact }

// src/schemas/spec.ts (extended in A4.1):
StorySpec = { id, title, epic, acceptance_criteria: string[] (min 1), depends_on: string[] }
SpecArtifact = { epics_md, backlog_md, dependency_graph, story_count, stories: StorySpec[] (REQUIRED, min 1) }
// .refine(story_count === stories.length)

// src/schemas/build.ts (extended in A4.1):
StoryBuildResult = { story_id, status: "done"|"failed"|"escalated", retry_count, worker_tokens,
                     validator_tokens, worker_cost_usd, validator_cost_usd, test_passed, test_failed }
BuildArtifact = { repo_path, test_results, prs_merged[], escalations[], stories?: StoryBuildResult[] }

// src/engine/stage-graph.ts (extended in A4.1):
StageEntry = { id, ..., inner_loop?: string, agent_spec?: string, worker_spec?: string, validator_spec?: string }
// XOR rule: agent_spec XOR (inner_loop + worker_spec + validator_spec). At A4.2 all stages have agent_spec.

// src/engine/dispatcher.ts (extended in A4.1):
Engine constructor: (graph, queue, storage, runner, dataDir, buildLoopRunner?: StageRunner)
dispatchCycle() branch: if (stage.inner_loop && stage.worker_spec) → buildLoopRunner.run() [UNREACHABLE at A4.2]
StageRunner interface: run(item, stage, workspacePath) → { output_status, artifact, token_usage, trace_id }
// A4.2 adds: jsonEvents?: unknown[] to the return type (additive/optional)

// src/backend/types.ts (current — A4.2 extends):
Queue = { publish, claim, release, annotate, get, list_by_run, list_by_status, expire_leases, close }
// A4.2 adds: heartbeat(item_id, lease_ms): void
```

**Related files (read these for context before writing code):**
- `src/engine/dispatcher.ts` — `StageRunner` interface (lines 62-69 — you add `jsonEvents?`), `Engine` constructor (lines 85-92 — 6th param already exists from A4.1), `dispatchCycle()` inner_loop branch (lines 220-227 — already added in A4.1, unreachable at A4.2)
- `src/agents/runner.ts` — `AgentStageRunner.run()` (lines 53-145 — you add the 4th `opts` param), `STAGE_SCHEMAS` map (line 18 — you add `build_worker`/`build_validator`), `buildDispatchMessage()` (line 311 — you add `Role:` marker), `fillTemplate()` (line 197 — you merge `extraContext` into the context), `gatherPriorArtifacts()` (line 171 — unchanged)
- `src/backend/types.ts` — `Queue` interface (lines 16-26 — you add `heartbeat()`), `Storage` interface (lines 28-35), `WorkItem` (lines 3-14)
- `src/backend/sqlite-queue.ts` — `SQLiteQueue` (lines 8-135 — you add `heartbeat()` impl after `annotate()` at line 78), `expire_leases()` (lines 96-116 — the race A4.2 prevents via heartbeat)
- `src/schemas/worker.ts` — `WorkerOutput`/`WorkerArtifact` (created in A4.1 — import for `STAGE_SCHEMAS`)
- `src/schemas/validator.ts` — `ValidatorOutput`/`ValidatorArtifact` (created in A4.1 — import for `STAGE_SCHEMAS`)
- `src/schemas/spec.ts` — `StorySpec`/`SpecArtifact` (extended in A4.1 — `BuildLoopRunner.run()` reads `artifact.stories`)
- `src/schemas/build.ts` — `BuildArtifact`/`StoryBuildResult` (extended in A4.1 — `BuildLoopRunner` writes the `stories` array on completion)
- `src/schemas/base.ts` — `StageOutputBase`, `GateVerdict` (lines 14: `"pass" | "needs_changes" | "escalate"` — NO "fail" value; the mapping branches on artifact fields, not gate_verdict)
- `src/engine/stage-graph.ts` — `StageEntry` (lines 13-30 — `worker_spec`/`validator_spec` optional, added in A4.1), `StageGraph` (line 32 — has `retry_ceilings.per_story_build` = 3)
- `src/engine-loop.ts` — Engine construction (line 27 — you update to 6-arg, passing `BuildLoopRunner`)
- `src/cli/index.ts` — `getEngine()` (lines 21-35 — you update to construct + pass `BuildLoopRunner`)
- `src/engine/tracing.ts` — `startTurnSpan` (line 60 — reused for build span synthesis), `recordTokenUsage` (line 75)
- `src/engine/index.ts` — exports (you add `BuildLoopRunner`)
- `tests/engine/dispatcher-guard.test.ts` — the temp-dir + queue + storage setup pattern (added in A4.1 — follow this for `build-loop.test.ts`)
- `stage-graph.yaml` — DO NOT MODIFY (the build-stage flip to `worker_spec`/`validator_spec` is A4.4)
- `docs/06-agile/issue-4/plan.md` §4.2 (BuildLoopRunner design), §4.3 (AgentStageRunner signature), §4.10 (tracing synthesis), §4.13 (lease heartbeat), §4.14 (ADR-009) — the authoritative design references

---

## 6a. Intent Constraints

The decisions and invariants this story must respect. Filled from the project's intent layer (`docs/DECISIONS.md`, `docs/INVARIANTS.md`) — this is how the original design's intent reaches you. Implement *within* these; do not contradict one to make the story easier.

**Active decisions this story touches:**
- **ADR-001** (Headless opencode-in-sandbox): Core Option B decision PRESERVED. The `BuildLoopRunner` dispatches each per-story Worker/Validator sandbox via `AgentStageRunner.run()` — each sandbox is still a headless `opencode run --auto` inside an ephemeral Docker container. ADR-001's spike-refinement mechanism was superseded by ADR-009 (written in A4.1). **This makes A4.2 an ADR-touching story → PR review is required regardless of PR count** (per the arbiter's ADR-touching override).
- **ADR-002** (Stage graph is declarative YAML): Respected. The `BuildLoopRunner` is a `StageRunner` implementation (same interface as `AgentStageRunner`), not hard-coded stage logic. The dispatcher reads `stage.inner_loop`/`stage.worker_spec` from the graph DATA. `stage-graph.yaml` is NOT modified in A4.2.
- **ADR-005** (Phoenix tracing via OTLP/proto): Respected — extended. The `emitTurnSpans()` helper emits per-turn/per-tool-call spans via the existing OTLP exporter (no new exporter or tracing infrastructure). The spans carry `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.agent_message`, `realcode.tool`, `realcode.tokens.*`.
- **ADR-008** (fillTemplate truncates at 8000 chars): Respected. The `extraContext` values (`worker_output` is a JSON object, `acceptance_criteria` is a joined string) are interpolated via `fillTemplate()`, which truncates at 8000 chars. The `worker_output` object is JSON-stringified by `fillTemplate` (line 215) and truncated if >8000 chars.
- **ADR-009** (Engine-orchestrated build inner loop — written in A4.1): **This story IS the enforcement of ADR-009.** The `BuildLoopRunner` class is listed in ADR-009's "Enforced in" field (`src/engine/build-loop.ts`). Implementation failures escalate immediately (deviates from planning-doc ADR-007's max-1 re-dispatch — recorded in ADR-009). The Planner and Product Owner Proxy roles are dropped (the Worker receives the story + prior artifacts directly via `extraContext`).

**Invariants this story must not break:**
- **INV-1** (declarative stage graph): The `BuildLoopRunner` is a `StageRunner` implementation; the dispatcher reads `stage.inner_loop`/`stage.worker_spec` from graph data. No stage transitions are hard-coded. `stage-graph.yaml` is NOT modified.
- **INV-2** (schema-validated outputs): The `BuildLoopRunner` returns a `BuildArtifact`-shaped result (validated by the dispatcher's existing artifact-write path). The Worker/Validator dispatches validate against `WorkerOutput`/`ValidatorOutput` via `schemaKey` (now in `STAGE_SCHEMAS`). The `StageRunner` return-type extension (`jsonEvents?: unknown[]`) is additive/optional — does not affect schema validation.
- **INV-7** (agent specs self-contained): A4.2 does NOT create or modify agent specs (`worker.yaml`/`validator.yaml` is A4.4). The `extraContext` mechanism passes story context into the template — the agent spec itself remains self-contained (no external file refs added by A4.2).
- **INV-8** (workspace seeding excludes): Not touched — `BuildLoopRunner` uses the already-seeded workspace (seeded once at `createRun`).

**If a criterion cannot be met without violating one of the above:** do not proceed and do not work around it. Write `result: failed / implementation` with a description naming the ADR/INV in conflict. Contradicting intent requires a superseding decision through a gate (the intent conflict gate, `AGENTS/arbiter.md`) — it is never the Worker's call.

---

## 7. Security Requirements

Check every item before writing `result: success`. An unchecked item is a validation failure.

- [x] All non-public endpoints in this story require authentication middleware — N/A: realcode has no auth (thin dashboard, INV-5); no new HTTP endpoints in this story.
- [x] User data access has authorization checks — N/A: no user data; realcode is a single-operator tool.
- [x] All user input is validated and sanitized before processing or storage — the `BuildLoopRunner` reads `spec.json` (already schema-validated at the spec stage per INV-2) and parses `artifact.stories` (required `StorySpec[]` with `.refine()`). The Worker/Validator outputs are validated via `STAGE_SCHEMAS[schemaKey]` in `AgentStageRunner.run()`. The `extraContext` values are interpolated via `fillTemplate` (which truncates at 8000 chars per ADR-008 — no unbounded string interpolation).
- [x] Database queries use parameterized queries — the `heartbeat()` method uses a prepared statement with `?` placeholders (no string interpolation with user input): `this.db.prepare("UPDATE work_items SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND worker_id IS NOT NULL").run(now + lease_ms, now, item_id)`.
- [x] File uploads — N/A: no file uploads.
- [x] No secrets, API keys, or connection strings in committed code — A4.2 adds engine logic, queue method, and tests. No secrets involved. The `BuildLoopRunner` does NOT touch the opencode-config mount (that is A4.3).
- [x] API responses do not expose stack traces or internal system fields — N/A: no new API endpoints.

Story-specific security notes:
A4.2 does NOT introduce the opencode-config mount, the secret-scan, or any new secret-handling surface (that is A4.3). A4.2 is purely engine orchestration logic + a queue method + tracing spans + tests. The security-relevant aspect of issue #4's plan (§4.6.1 — the opencode-config/MCP mount) is NOT built in A4.2. The existing security tests (`tests/integration/security.test.ts` — credential isolation, tool allowlist, resource limits, cost cap, atomic claim) must all continue to pass. The `heartbeat()` method does not introduce a new attack surface (it's an internal queue operation on an already-claimed work item, guarded by `WHERE worker_id IS NOT NULL`). The cost-cap check inside `BuildLoopRunner.run()` (mid-loop) is a security-relevant control (prevents unbounded spend) — the test suite verifies it fires.

---

## 8. PR Instructions

**Branch name:** `story/A4.2-engine-build-loop-runner`
**PR title:** `feat(A4.2): BuildLoopRunner engine orchestration + AgentStageRunner 4th param + Queue.heartbeat (#4)`
**Base branch:** `issue/4-multi-container-build-loop`
**PR description:** Use `TEMPLATES/commit-message.md` format. Reference issue #4 in every commit footer (`Refs #4` or `Closes #4` per the agile traceability rule). The PR body should summarize: new `BuildLoopRunner` class (`src/engine/build-loop.ts`) implementing the per-story Worker→Validator serial loop with result mapping, retry ceilings, cost tracking, control-doc responsiveness, lease heartbeat (before both Worker and Validator), wall-clock bound, build-state.json tracking, and engine-side trace span synthesis; `AgentStageRunner.run()` optional 4th param (`specOverride`/`schemaKey`/`extraContext`) + `Role:` marker in dispatch message; `STAGE_SCHEMAS` gains `build_worker`/`build_validator`; `Queue.heartbeat()` interface + SQLite impl; `engine-loop.ts` + `cli/index.ts` wiring (6-arg Engine); `StageRunner` return type gains optional `jsonEvents`; unit tests (`build-loop.test.ts` + `lease-heartbeat.test.ts` with fake timers).

**Review Requirement:** **Review is required.** This is PR #2 for issue #4 (PR #6 overall in realcode's Phase 4 — A4.1 was PR #5). More importantly, **A4.2 touches Active Decisions** (ADR-001 — core decision preserved, spike refinement superseded by ADR-009 which A4.2 enforces; ADR-005 — tracing extended; ADR-008 — fillTemplate truncation applied to extraContext; ADR-009 — `BuildLoopRunner` IS the enforcement, listed in its "Enforced in" field). Per the arbiter's ADR-touching override, **review is required regardless of PR count**. **In autonomous mode**, the Product Owner Proxy handles the `phase4-pr-review` gate — it reviews the PR and returns `approved` or `changes needed: [notes]`. The proxy is strict: it does not rubber-stamp.

Screenshots are required in the PR description for any story that produces UI changes — **N/A for this story** (no UI changes; A4.2 is engine/backend only).

---

## 9. Constraints

- Do not modify files outside `src/` unless a specific config file is named in the technical tasks. Files outside `src/` that ARE named: `tests/**` (new test files). **Do NOT modify `stage-graph.yaml`** — the build-stage flip to `worker_spec`/`validator_spec` is A4.4. **Do NOT modify `docs/DECISIONS.md`** — ADR-009 was written in A4.1. **Do NOT modify `agent-specs/*.yaml`** — worker.yaml/validator.yaml are A4.4.
- Do not modify existing migration files — N/A (no database migrations; realcode uses SQLite with a fixed schema; `heartbeat()` is a code method, not a DB migration — the `work_items` table already has `lease_expires_at`).
- Do not add npm/pip/cargo dependencies without noting them in your RESULT notes — A4.2 adds NO new dependencies (zod, vitest, better-sqlite3, @opentelemetry/api are all already in package.json).
- Do not implement functionality not described in the acceptance criteria — specifically: do NOT create `agent-specs/worker.yaml` or `agent-specs/validator.yaml` (that's A4.4), do NOT modify `stage-graph.yaml` (that's A4.4), do NOT add the opencode-config mount or secret-scan (that's A4.3), do NOT add `containerId` to `SandboxResult` or `--cidfile`/`--name` to docker run (that's A4.3), do NOT add dashboard components or API endpoints (that's A4.5), do NOT update the existing e2e test (that's A4.6).
- Do not push to `main` directly — use your story branch and open a PR against `issue/4-multi-container-build-loop`.
- Stop and write a `failed/implementation` result rather than guessing at ambiguous product requirements.
- **Story-specific constraint:** the dispatcher's `inner_loop` branch (added in A4.1) is UNREACHABLE at A4.2 — no stage in `stage-graph.yaml` has `worker_spec`. The `BuildLoopRunner` is constructed and passed to `Engine` (6-arg) in `engine-loop.ts` + `cli/index.ts`, but never invoked by `dispatchCycle()`. All 115 existing tests must pass unchanged. A4.2 is tested via direct unit tests with a mock `AgentStageRunner` (not real Docker runs). Do NOT add `worker_spec` to the build stage in `stage-graph.yaml` to "test it end-to-end" — that's A4.4's scope and would break the graph (no `agent-specs/worker.yaml` exists yet).
- **Cost-tracking constraint:** `BuildLoopRunner.run()` must return `token_usage.estimated_cost_usd` = the loop increment (sum of per-sandbox costs during the loop), NOT the total run cost. The dispatcher's existing `run.spent_usd += result.token_usage.estimated_cost_usd` (at `dispatcher.ts:238`) adds this increment to the pre-loop `spent_usd` (read at line 197 before `run()` was called) — producing the correct total. Do NOT write `run.json` from inside `BuildLoopRunner.run()` — that would create a stale-run overwrite race. See §4 Technical Tasks for the full cost-tracking design.

---

<!-- PLANNER: Fill above sections before dispatch. Leave section 10 blank. -->
<!-- WORKER: Fill section 10 when complete. Do not modify sections 1-9. -->

---

## 10. RESULT

<!-- Worker fills this section. Append below the line — do not delete existing content. -->

**result:** success | failed
**failure_type:** environment | implementation *(omit if success)*
**classification_uncertain:** true *(omit if certain)*
**failure_description:** *(if failed — specific, not vague)*
**pr_url:**
**pr_number:**
**branch:**
**commits:**
- [SHA] [conventional commit message]
- [SHA] [conventional commit message]
**test_output:** passed ([N] tests) | failed ([N] tests, failure output below)
*(— "no test suite" is never acceptable — minimum 1 test per runtime-verifiable criterion)*
**lint_output:** clean | [N] warnings fixed
**notes:** *(optional — anything the orchestrator should know)*
