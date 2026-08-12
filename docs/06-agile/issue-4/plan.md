# Development Plan — Issue #4: Build stage must orchestrate a multi-container anymake build loop

**Author:** Anymake Solution Architect
**Project:** realcode — `project_type: agentic-harness`
**Issue:** https://github.com/R3dy/realcode/issues/4 — `type:feature`
**Code state analyzed:** 9faa3cf (master)
**Status:** Ready for Gate (round 3 adjudicated — all 3 orchestrator rulings applied)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-4/plan.md`

---

## 1. Problem Statement

The build stage collapses anymake's multi-agent build loop (Orchestrator → Planner → Worker → Validator, one story at a time) into a single headless opencode session in a single Docker sandbox. A single agent tries to implement the entire backlog within the stage timeout (20 min). For any backlog larger than ~2-3 stories, the run escalates. This violates realcode's stated success model (≥85% of runs ship with zero human edits). The architecture was never completed: ADR-001 and `pipeline-design.md` §1.1 always specified the build stage contains an inner loop (`inner_loop: anymake-build-loop`) — the implementation ignored that field and dispatched one sandbox doing everything.

The fix: the realcode **engine** becomes the orchestrator of the build inner loop. For each story (serially, per planning-doc ADR-007): the engine spawns a Worker sandbox (one container, one story), then a Validator sandbox (one container, one story), merges on PASS, retries on FAIL, escalates on ceiling. Each sandbox inherits the operator's opencode environment (config, skills, MCP servers) via a configurable mount. The dashboard shows mission-control visibility: per-story progress, per-container status, per-story turn-level trace events synthesized from sandbox JSON output (via SSE), and a container log view (the truly-live stream).

> **Scope note on issue requirement #4 ("real-time agent messages + tool calls from the Phoenix traces"):** Phoenix today receives only engine-side run/stage spans (`tracing.ts`; `dispatcher.ts:216` calls `startStageSpan`). The per-turn `startTurnSpan`/`recordTokenUsage` helpers are defined but never called (grep-verified), and the sandbox has no OTLP exporter endpoint (`sandbox/runner.ts:77` passes only `OTEL_TRACEPARENT`). Per §4.10, this plan delivers turn-level trace events by **engine-side synthesis from each sandbox's captured `jsonEvents`** (which already record tool calls + token usage per the ADR-001 spike). This is per-completed-sandbox granularity (not mid-execution streaming); the truly-live stream is the container log view (`ContainerLogViewer`), which tails the sandbox's raw stdout as it runs. This satisfies the issue's intent (the operator sees agent messages + tool calls in the dashboard trace timeline) via a mechanism that works with the existing exporter and network topology, and is explicitly scoped as such in A4.5's Experience Script.

---

## 2. Root Cause / Motivation

**This is a feature — motivation grounded in the success model.**

The agentic-harness manifest's success model: "Reliable, observable, cost-bounded throughput is first-class." `PROJECT.md` §Success Definition quantifies: "≥85% of the first 50 runs reach `shipped` with zero human code edits." The current build stage makes this impossible for non-trivial work because:

- [`agent-specs/build.yaml:12-14`] — The system prompt explicitly says: "There is NO Task tool — you CANNOT spawn anymake subagents (orchestrator, planner, worker, validator, experience runner). Do not attempt to delegate; do the entire build yourself in this single session." This is the root architectural defect: the build stage was supposed to delegate to anymake's build loop (ADR-001, `pipeline-design.md` §1.1 stage 5 `inner_loop: anymake-build-loop`), but the implementation has no delegation mechanism.
- [`src/engine/dispatcher.ts:192-264`] — `dispatchCycle()` claims one work_item in `specified` status, finds the `build` stage, calls `this.runner.run(item, stage, run.workspace_path)` once. One dispatch, one sandbox, one artifact. The `inner_loop` field on the stage entry is loaded by `stage-graph.ts` but never read by the dispatcher.
- [`src/agents/runner.ts:53-139`] — `AgentStageRunner.run()` loads `agent-specs/build.yaml`, fills the template with the ENTIRE backlog + epics + dependency graph + PRD + ADRs (all truncated at 8000 chars each per ADR-008), spawns ONE opencode sandbox, extracts ONE `<artifact>` block.
- [`src/sandbox/runner.ts:59-91`] — `runDocker()` spawns ONE `docker run --rm` container with the workspace mounted. No opencode config is mounted; no skills or MCP servers are available inside the sandbox.
- Evidence from the issue: "run_0ba334d1: 17 stories, 1.27M tokens, 20-min timeout, $1.48, escalated." A single agent trying to implement 17 stories in one session hits the timeout and escalates. This is the exact failure mode anymake's multi-agent architecture (separate Worker/Validator per story) exists to prevent.

**Why now:** The success model is the product's core promise. Without a working build loop, realcode cannot ship non-trivial work — it's a demo that escalates on anything real. This is the single highest-impact change to make realcode fulfill its value proposition.

---

## 3. Current-State Review

| Touched | Details |
|---------|---------|
| Modules | `src/engine/dispatcher.ts` (Engine.DispatchCycle — the single-dispatch loop), `src/engine/stage-graph.ts` (StageGraph loader — `inner_loop` field exists but unused; `StageEntry.agent_spec` is required at line 27, validated at line 111), `src/engine/engine-loop.ts` (constructs `AgentStageRunner` + `Engine`), `src/agents/runner.ts` (AgentStageRunner — one sandbox per stage; schema lookup keys on `stage.id` at line 109; `fillTemplate` passes unresolved placeholders through literally at line 199), `src/sandbox/runner.ts` (SandboxRunner — Docker spawn, no opencode config mount; host-path translation via `REALCODE_HOST_DATA_DIR` at lines 65-69), `src/backend/sqlite-queue.ts` (`LEASE_DEFAULT_MS = 10min` at line 6; `annotate()` is a no-op at line 76; `expire_leases()` clears lease + increments retry_count at lines 96-116), `src/schemas/spec.ts` + `src/schemas/build.ts` (artifact schemas), `src/schemas/base.ts` (`GateVerdict = z.enum(["pass","needs_changes","escalate"])` at line 14 — no "fail" value), `agent-specs/build.yaml` (the broken single-agent spec), `stage-graph.yaml` (build stage config), `src/engine/tracing.ts` (`startTurnSpan`/`recordTokenUsage` defined but never called), `src/dashboard/tailwind.config.js` (palette is `ink-*`/`status-*`/`brand-*` — no `slate-*`), `src/dashboard/components/ui.tsx` (Card uses `bg-ink-900 border-ink-700/60`), `scripts/export-schemas.ts` (regenerates `schemas/*.schema.json` — not wired into npm scripts), `docker-compose.yml` (engine on `realcode-net`; sandbox uses external `realcode-sandbox-net`; `MISSION_CONTROL_ROOT=/mission-control`) |
| Data model | `RunRecord` (run.json), `WorkItem` (queue.db: id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload), `SpecArtifact` ({ epics_md, backlog_md, dependency_graph, story_count }), `BuildArtifact` ({ repo_path, test_results, prs_merged, escalations }), `ControlDoc` (control.json). No per-story state, no container tracking, no structured story array. |
| Flows | Create run → seed workspace → dispatch frame → ... → dispatch spec → dispatch build (ONE sandbox, entire backlog) → dispatch ship. The build dispatch is synchronous: `runner.run()` blocks until the sandbox exits, then the artifact is validated and the transition fires. |
| Integrations | Docker sandbox (`realcode-sandbox:latest` image — no Dockerfile.sandbox exists in repo; image must be built externally), Phoenix (Arize) tracing at localhost:6006 (GraphQL API with spans queryable by `realcode.run_id` attribute — but only run/stage spans exist today), opencode (headless `opencode run --auto --format json`), anymake plugin (loaded by opencode from `~/.config/opencode/opencode.json` — NOT available inside the sandbox currently) |

**Intent-layer freshness:** SYSTEM_MAP last mapped 2026-08-11 (cartographer refresh at 9faa3cf) — **current**. The intent layer of record is `docs/DECISIONS.md` (8 ADRs: ADR-001 headless opencode-in-sandbox, ADR-002 declarative stage graph, ADR-003 dashboard is thin, ADR-004 real data no mock, ADR-005 Phoenix tracing, ADR-006 self-contained agent specs, ADR-007 workspace seeding, ADR-008 fillTemplate truncation) and `docs/INVARIANTS.md` (8 invariants: INV-1…INV-8). The planning-doc ADRs (`PROJECTS/realcode/docs/02-planning/architecture/ADR-001…009`) are the design record; where this plan references them, they are cited by full title (e.g. "planning-doc ADR-003, Sandbox/Isolation Mechanism") to distinguish from the intent-layer ADRs. This plan writes a new intent-layer ADR-009 as part of its scope (§4.15).

---

## 4. Solution Design

The engine becomes the build-loop orchestrator. The build stage stays as one entry in `stage-graph.yaml` (respecting intent-layer ADR-002/INV-1), but the dispatcher detects the `inner_loop` field and delegates to a new `BuildLoopRunner` instead of `AgentStageRunner`. Each per-story sandbox is a single-purpose headless opencode-in-sandbox invocation (intent-layer ADR-001 core decision preserved). Each sandbox inherits the operator's opencode environment via a configurable mount.

**Wiring decision (resolved — see §4.2):** `BuildLoopRunner` is constructed once in `src/engine-loop.ts` (the production entry point — note: the file is `src/engine-loop.ts`, NOT `src/engine/engine-loop.ts`; the round-2 review caught the wrong path), wraps the `AgentStageRunner` instance, and is passed to the `Engine` constructor. The dispatcher checks `stage.inner_loop` to decide which runner to call. The `BuildLoopRunner` parameter is **optional** on the `Engine` constructor (6th param, `buildLoopRunner?: StageRunner`) so the 5-arg call sites that don't exercise the build stage (`security.test.ts:166/187`) stay unchanged. When `stage.inner_loop` is set but `buildLoopRunner` is undefined, the dispatcher escalates with a clear error (never crashes with a `TypeError`).

### 4.1 Stage-graph config changes (`stage-graph.yaml` + `src/engine/stage-graph.ts`)

The `StageEntry` zod schema changes: `agent_spec` becomes **optional**, and two new optional fields are added:

```typescript
// src/engine/stage-graph.ts — StageEntry schema (currently agent_spec: z.string().min(1) at line 27):
agent_spec: z.string().min(1).optional(),       // CHANGED: required → optional
worker_spec: z.string().optional(),             // NEW: path to worker agent spec YAML (inner_loop stages)
validator_spec: z.string().optional(),          // NEW: path to validator agent spec YAML (inner_loop stages)
```

The `validateGraph()` function in `stage-graph.ts` gets a new XOR check replacing the current unconditional `agent_spec` path resolution (line 111):

```typescript
// In validateGraph(), replace the current block at lines 107-114:
for (const stage of graph.stages) {
  if (!fs.existsSync(path.resolve(baseDir, stage.artifact_schema))) {
    errors.push(`Stage ${stage.id}: artifact_schema path '${stage.artifact_schema}' does not exist`);
  }
  // XOR: exactly one of (agent_spec) OR (inner_loop + worker_spec + validator_spec)
  const hasAgentSpec = stage.agent_spec !== undefined;
  const hasInnerLoop = stage.inner_loop !== undefined;
  const hasWorkerSpec = stage.worker_spec !== undefined;
  const hasValidatorSpec = stage.validator_spec !== undefined;
  if (hasAgentSpec && hasInnerLoop) {
    errors.push(`Stage ${stage.id}: cannot have both agent_spec and inner_loop (use one or the other)`);
  }
  if (!hasAgentSpec && !hasInnerLoop) {
    errors.push(`Stage ${stage.id}: must have either agent_spec or inner_loop`);
  }
  if (hasInnerLoop) {
    if (!hasWorkerSpec || !hasValidatorSpec) {
      errors.push(`Stage ${stage.id}: inner_loop requires both worker_spec and validator_spec`);
    } else {
      if (!fs.existsSync(path.resolve(baseDir, stage.worker_spec!))) {
        errors.push(`Stage ${stage.id}: worker_spec path '${stage.worker_spec}' does not exist`);
      }
      if (!fs.existsSync(path.resolve(baseDir, stage.validator_spec!))) {
        errors.push(`Stage ${stage.id}: validator_spec path '${stage.validator_spec}' does not exist`);
      }
    }
  }
  if (hasAgentSpec) {
    if (!fs.existsSync(path.resolve(baseDir, stage.agent_spec!))) {
      errors.push(`Stage ${stage.id}: agent_spec path '${stage.agent_spec}' does not exist`);
    }
  }
}
```

The `stage-graph.yaml` build stage entry:

```yaml
- id: build
  # ... existing fields unchanged ...
  inner_loop: anymake-build-loop          # already present — now ACTED ON by the dispatcher
  worker_spec: agent-specs/worker.yaml    # NEW
  validator_spec: agent-specs/validator.yaml  # NEW
  # agent_spec: agent-specs/build.yaml is REMOVED — replaced by worker_spec + validator_spec per the XOR rule
```

**Sequencing (3-C1):** The `StageEntry` zod-schema field additions (`agent_spec` optional + `worker_spec`/`validator_spec` optional) and the `validateGraph()` XOR rule are made in **A4.1** — but the XOR rule is **inert** at A4.1 (no stage has `inner_loop` set; the build stage still has `agent_spec`; the graph loads unchanged). The `stage-graph.yaml` build-stage edit above (removing `agent_spec`, adding `inner_loop`+`worker_spec`+`validator_spec`) is owned by **A4.4**, which also creates `agent-specs/worker.yaml` + `agent-specs/validator.yaml` — so the `fs.existsSync` path enforcement never fires against a missing file. Moving the yaml edit to A4.1 would make `loadStageGraph` throw at A4.1 (referencing spec files A4.4 creates) and break every graph-loading suite + engine boot; the A4.1→A4.4 split keeps the graph loadable at every story boundary.

**Schema export regeneration:** `scripts/export-schemas.ts` generates `schemas/*.schema.json` from the zod sources. Since `stage-graph.yaml`'s `artifact_schema` field references these exports (and the build/spec schemas change in §4.4/§4.5), Story A4.1 adds an `export-schemas` npm script to `package.json` and regenerates the committed `schemas/build.schema.json` + `schemas/spec.schema.json`. The script currently exists but is not wired into `package.json` scripts (verified) — A4.1 wires it.

### 4.2 Engine: BuildLoopRunner (`src/engine/build-loop.ts` — new file)

**Wiring (decided — no draft alternatives):** `BuildLoopRunner` is constructed once in `src/engine-loop.ts`, receives the existing `AgentStageRunner` instance (for dispatching individual Worker/Validator sandboxes) + the storage + graph + queue, and is passed to the `Engine` constructor. The `Engine` class gains an **optional 6th constructor parameter** `buildLoopRunner?: StageRunner`; `dispatchCycle()` checks `stage.inner_loop` to decide which runner to call:

```typescript
// src/engine-loop.ts — construction (resolved, single decision):
// NOTE: the file is src/engine-loop.ts (NOT src/engine/engine-loop.ts).
const sandbox = new SandboxRunner();
const runner = new AgentStageRunner(sandbox, storage, graph, { localMode: false, repoRoot: process.cwd() });
const buildLoop = new BuildLoopRunner(runner, sandbox, storage, graph, queue, { repoRoot: process.cwd() });
const engine = new Engine(graph, queue, storage, runner, DATA_DIR, buildLoop);

// src/engine/dispatcher.ts — Engine constructor gains an OPTIONAL 6th param:
export class Engine {
  constructor(
    private graph: StageGraph,
    private queue: Queue,
    private storage: Storage,
    private runner: StageRunner,
    private dataDir: string,
    private buildLoopRunner?: StageRunner,  // NEW — optional; undefined for call sites that don't exercise build
  ) {}

  // In dispatchCycle(), after finding the stage (replaces the current line 218):
  let result;
  if (stage.inner_loop) {
    if (!this.buildLoopRunner) {
      throw new Error(
        `Stage '${stage.id}' has inner_loop but no BuildLoopRunner configured — ` +
        `cannot dispatch. Pass a BuildLoopRunner to the Engine constructor (6th param).`,
      );
    }
    result = await this.buildLoopRunner.run(item, stage, run.workspace_path);
  } else {
    result = await this.runner.run(item, stage, run.workspace_path);
  }
```

**Constructor call-site inventory (2-C1a — all named in §8 blast radius):**
- `src/engine-loop.ts:27` — **UPDATED to 6-arg** (constructs `BuildLoopRunner`, passes it). This is the production entry point.
- `src/cli/index.ts:34` — **UPDATED to 6-arg** (`getEngine()` constructs a `BuildLoopRunner` wrapping its `AgentStageRunner`, so `realcode resume` works for build-stage runs; without this, `realcode resume` on a `specified` run would escalate with the "no BuildLoopRunner configured" error).
- `tests/integration/e2e.test.ts:151` — **UPDATED to 6-arg** (constructs a `BuildLoopRunner` wrapping the mock-sandbox `AgentStageRunner`; see 2-C1b below + A4.6).
- `tests/integration/security.test.ts:166` — **stays 5-arg** (this test sets `run.spent_usd = 10.0` over cap then dispatches; the cost-cap check at dispatcher line 203 fires BEFORE dispatching → `paused_cost_cap`; the build stage is never reached).
- `tests/integration/security.test.ts:187` — **stays 5-arg** (this test sets `run_mode: "paused_cost_cap"` then dispatches; the pause check at dispatcher line 178 fires → returns 0; the build stage is never reached).

The optional parameter means the two security-test call sites typecheck unchanged; if either ever hits the build stage, the dispatcher's `buildLoopRunner` check escalates with a clear error rather than crashing.

**Control-doc responsiveness (addresses 1-C8; resolved per 2-C2 — terminal escalation):** `BuildLoopRunner.run()` re-reads the control doc between stories (not between sandboxes — the inner loop is one `dispatchCycle()` call, so the dispatcher's top-of-cycle pause check doesn't fire mid-loop). Before dispatching each story's Worker, the loop calls `engine.getControlDoc()`; if `run_mode === "paused"` or `run_mode === "paused_cost_cap"`, the loop exits immediately, leaves remaining stories `pending`, writes `build-state.json` with a `paused: true` flag + a `pause_reason` field, and returns `{ output_status: "escalate", gate_notes: "paused by operator mid-build-loop (N/M stories done)" }`. The dispatcher calls `applyTransition(graph, "build", "specified", "escalate")` → `escalated` (stage-graph.yaml: `{ from: specified, on: escalate, to: escalated }` — terminal). The run ends `escalated`; `claim()`'s safety net (`sqlite-queue.ts:44`) filters out `escalated`, so the work_item is never re-claimed. **Pausing the engine mid-build-loop is a terminal action for that run** — the operator must start a new run (the dead run's `build-state.json` records which stories completed, useful for debugging). Resumable suspension (make `BuildLoopRunner` idempotent/resumable + add a `paused` transition + dispatcher special-case) is a post-MVP enhancement, logged to `PARKING_LOT.md`. The same terminal-escalation path covers a mid-loop cost-cap hit (`run.spent_usd >= run.cap_usd` between stories): the loop returns `escalate` → `escalated`. (Note: a cost-cap hit BEFORE the build stage dispatches — caught by the dispatcher's top-of-cycle check at line 203 — still goes to `paused_cost_cap`, unchanged; the inconsistency is acceptable: before-dispatch = clean pause, mid-loop = terminal.)

**`BuildLoopRunner.run()` method:**

1. **Read the spec artifact:** `storage.read("runs/<run_id>/spec.json")` → parse `artifact.stories` (the structured array — see §4.4, now **required**). If `stories` is absent or empty, escalate immediately with a clear error ("spec artifact lacks structured stories array — cannot build"). Parse `artifact.dependency_graph`.

2. **Initialize build state:** Write `data/runs/<run_id>/build-state.json`:
   ```json
   {
     "run_id": "<run_id>",
     "started_at": <epoch_ms>,
     "wall_clock_deadline_ms": <started_at + stage.timeout_ms>,
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
   This file is updated after every state transition (not batched) so the dashboard can poll it. Each `containers[]` entry includes a `log_path` field (see §4.7).

3. **Inner loop** (serial, 1 story at a time per planning-doc ADR-007). The pseudocode branches on **artifact fields** (not `output_status`, which can only be `pass`/`needs_changes`/`escalate` per `base.ts:14`):

   ```
   while true:
     # Control-doc check between stories (1-C8, 2-C2: terminal escalation on pause)
     control = engine.getControlDoc()
     if control.run_mode in ("paused", "paused_cost_cap"):
       writeBuildState(paused=true, pause_reason="operator paused")
       return escalate("paused by operator mid-build-loop (N/M stories done)")

     story = nextReadyStory()  # status=pending AND all depends_on are done
     if no story ready AND stories remain not-done → ESCALATE("all remaining blocked")
     if all stories done → break (success)

     # Cost cap check between stories (2-C2: terminal escalation)
     if run.spent_usd >= run.cap_usd → return escalate("cost cap hit mid-loop (N/M stories done)")

     # Wall-clock bound check (1-C9)
     if now() > build_state.wall_clock_deadline_ms → ESCALATE("wall-clock bound exceeded")

     # Lease heartbeat before Worker (1-C9, 2-C3)
     queue.heartbeat(item.id, stage.timeout_ms)

     # Dispatch Worker
     story.status = "building"; writeBuildState()
     workerResult = dispatchWorker(story, workspacePath)
     story.worker_output = workerResult.artifact
     story.worker_container_id = workerResult.container_id
     run.spent_usd += workerResult.token_usage.estimated_cost_usd
     updateRun(run); writeBuildState()

     # Worker result mapping (see table below)
     match workerResult.artifact:
       case result == "success":
         # proceed to validator
       case result == "failed" AND failure_type == "environment":
         story.retry_count++
         if story.retry_count >= 3: story.status = "escalated"; break
         else: continue  # retry same story (re-dispatch worker)
       case result == "failed" AND failure_type == "implementation":
         story.status = "escalated"; break  # immediate escalate (deviates from ADR-007 max-1 — see note)
       case workerResult.output_status == "escalate":
         story.status = "escalated"; break  # immediate, no retry (matches ADR-007)

     # Lease heartbeat before Validator (2-C3: prevents mid-Validator lease expiry)
     queue.heartbeat(item.id, stage.timeout_ms)

     # Dispatch Validator
     story.status = "validating"; writeBuildState()
     validatorResult = dispatchValidator(story, workspacePath)
     story.validator_output = validatorResult.artifact
     story.validator_container_id = validatorResult.container_id
     run.spent_usd += validatorResult.token_usage.estimated_cost_usd
     updateRun(run); writeBuildState()

     # Validator result mapping (see table below)
     match validatorResult.artifact:
       case verdict == "pass":
         story.status = "done"; story.completed_at = now(); writeBuildState()
       case verdict == "fail":
         story.retry_count++
         if story.retry_count >= 3: story.status = "escalated"; break
         else: story.status = "pending"; continue  # retry (re-dispatch worker)
       case verdict == "escalate" OR validatorResult.output_status == "escalate":
         story.status = "escalated"; break  # immediate (matches ADR-007)
   ```

   **Mapping table — Worker/Validator output → BuildLoopRunner action** (reconciles §4.2 pseudocode, §4.8/§4.9 contracts, and A4.2 criteria with `base.ts:14`'s `GateVerdict` enum):

   | Worker `artifact.result` | Worker `failure_type` | Worker `gate_verdict` emitted | → BuildLoopRunner action |
   |---|---|---|---|
   | `success` | (n/a) | `pass` | proceed to Validator |
   | `failed` | `environment` | `needs_changes` | retry worker (max `per_story_build: 3`); if ceiling → escalate story |
   | `failed` | `implementation` | `escalate` | escalate story immediately |
   | (sandbox crash/timeout/no artifact) | (n/a) | `escalate` (set by `AgentStageRunner` lines 76-97) | escalate story immediately |

   | Validator `artifact.verdict` | Validator `gate_verdict` emitted | → BuildLoopRunner action |
   |---|---|---|
   | `pass` | `pass` | story done |
   | `fail` | `pass` | retry worker (max `per_story_build: 3`); if ceiling → escalate story |
   | `escalate` | `escalate` | escalate story immediately |
   | (sandbox crash/timeout/no artifact) | `escalate` (set by `AgentStageRunner`) | escalate story immediately |

   **ADR-007 reconciliation note:** Planning-doc ADR-007's retry matrix says "implementation failure → re-dispatch max 1." This plan escalates implementation failures immediately (max 0 re-dispatch) because (a) the Worker has already attempted the story once and an implementation failure means the code it wrote is wrong — re-dispatching the same Worker with the same prompt is unlikely to produce a different result without a Planner re-brief, which this plan does not include (the Planner role is dropped — see §4.15 ADR-009); (b) the issue's success model prioritizes correctness over throughput; (c) the `per_story_build: 3` ceiling still applies to environment failures (the retryable class). This deviation is recorded in ADR-009 (§4.15).

4. **On completion (all stories done):** Write `build.json` artifact (aggregated):
   ```json
   {
     "schema_version": 1,
     "run_id": "<run_id>",
     "stage": "build",
     "status": "built",
     "gate_verdict": "pass",
     "gate_notes": "All N stories built and validated.",
     "revisions_used": 0,
     "escalation_count": 0,
     "token_usage": { ... aggregated ... },
     "trace_id": "<run_id>",
     "artifact": {
       "repo_path": "<workspace_path>",
       "test_results": { passed: N, failed: N, skipped: N, coverage_pct: N },
       "prs_merged": [],
       "escalations": [],
       "stories": [ ... per-story results ... ]
     }
   }
   ```
   Return `{ output_status: "pass", artifact: ..., token_usage: ..., trace_id: ... }` so the dispatcher transitions `specified → built`.

5. **On escalation:** Return `{ output_status: "escalate", artifact: { ..., status: "escalated", escalations: [...] }, ... }` so the dispatcher transitions `specified → escalated`.

**Worker dispatch** (`dispatchWorker`): Calls `agentStageRunner.run(item, stage, workspacePath, { specOverride: stage.worker_spec, schemaKey: "build_worker", extraContext: { story_id, story_title, acceptance_criteria, worker_output: undefined, role: "build_worker" } })`. The `extraContext` is merged into the `fillTemplate` context (see §4.3 for the signature change). `{acceptance_criteria}` (an array) is serialized as a joined string (`"\n".join(acceptance_criteria)`) before interpolation, so the worker prompt sees a numbered list, not a JSON array. The `role: "build_worker"` value directly matches the canned artifact key `STAGE_ARTIFACTS.build_worker` and the schema key `build_worker` (3-C3: no normalization needed).

**Validator dispatch** (`dispatchValidator`): Same pattern with `specOverride: stage.validator_spec, schemaKey: "build_validator", extraContext: { story_id, story_title, acceptance_criteria, worker_output: <WorkerArtifact JSON>, role: "build_validator" }`. The `role: "build_validator"` value directly matches the canned artifact key `STAGE_ARTIFACTS.build_validator` and the schema key `build_validator` (3-C3).

**Dispatch-message `Role:` marker (2-C1b, 3-C3):** `AgentStageRunner.buildDispatchMessage()` stamps `Role: ${opts?.extraContext?.role ?? stage.id}` into the dispatch message (in addition to the existing `Stage: ${stage.id}` line — verified at `runner.ts:315`). Worker dispatches carry `Role: build_worker`; Validator dispatches carry `Role: build_validator` (the `extraContext.role` values from §4.2 — these directly match the canned artifact keys `STAGE_ARTIFACTS.build_worker`/`build_validator` and the `STAGE_SCHEMAS` keys, so no normalization is needed). This lets the e2e's mock sandbox (`makeMockSandbox`) distinguish the two dispatch types (both carry `Stage: build` under `specOverride`) by keying on `Role:\s*(\w+)` and doing a direct `STAGE_ARTIFACTS[role]` lookup — see A4.6 for the e2e update. Non-build stages (no `role` in `extraContext`) fall back to `Role: <stage.id>` (e.g. `Role: frame`), so a pure `Role:` keying covers all stages with no `Stage:` fallback required.

### 4.3 AgentStageRunner signature change (`src/agents/runner.ts`)

`AgentStageRunner.run()` gains an optional 4th parameter (addresses 1-C2 — schema lookup + template context):

```typescript
// Current signature (runner.ts:53):
//   async run(item: WorkItem, stage: StageEntry, workspacePath: string)
// New signature:
async run(
  item: WorkItem,
  stage: StageEntry,
  workspacePath: string,
  opts?: {
    specOverride?: string;       // path to an alternate agent spec YAML (overrides stage.agent_spec)
    schemaKey?: string;          // key into STAGE_SCHEMAS (overrides stage.id for schema lookup)
    extraContext?: Record<string, unknown>;  // merged into fillTemplate context
  },
)
```

Three mechanical changes inside `run()`:

1. **Spec loading** (line 54): `const specPath = opts?.specOverride ? path.resolve(this.options.repoRoot, opts.specOverride) : path.resolve(this.options.repoRoot, stage.agent_spec);`

2. **Schema lookup** (lines 59, 109, 299-303): `const schemaKey = opts?.schemaKey ?? stage.id;` — used in `STAGE_SCHEMAS[schemaKey]` (line 109) and `getStageSchemaJson(schemaKey)` (lines 59, 299). This ensures a Worker dispatch validates against `WorkerOutput` (registered as `build_worker`) and the prompt shows the worker output schema, not `BuildOutput`.

3. **Template context** (lines 57-58): `const priorArtifacts = this.gatherPriorArtifacts(...); const ctx = { ...priorArtifacts, ...(opts?.extraContext ?? {}) };` then `this.fillTemplate(spec.user_prompt_template, ctx)`. Unresolved placeholders (e.g. `{story_id}` when `extraContext` is not provided) still pass through literally (line 199) — but with `extraContext` providing `story_id`/`story_title`/`acceptance_criteria`/`worker_output`, the worker/validator prompts resolve correctly.

4. **Dispatch-message `Role:` marker** (line ~315, addresses 2-C1b, 3-C3): `buildDispatchMessage()` stamps `Role: ${opts?.extraContext?.role ?? stage.id}` into the dispatch message, in addition to the existing `Stage: ${stage.id}` line. Worker dispatches carry `Role: build_worker`; Validator dispatches carry `Role: build_validator` (the `extraContext.role` values — directly matching the canned artifact keys and `STAGE_SCHEMAS` keys, so the e2e mock does a direct `STAGE_ARTIFACTS[role]` lookup with no normalization). This lets the e2e's mock sandbox distinguish the two build-stage dispatch types (both carry `Stage: build` under `specOverride`) by keying on `Role:\s*(\w+)`. Non-build stages have no `role` in `extraContext`, so they stamp `Role: <stage.id>` (e.g. `Role: frame`) — a pure `Role:` keying covers all stages.

The `STAGE_SCHEMAS` map (line 18) gains `build_worker: WorkerOutput` and `build_validator: ValidatorOutput` (registered in `src/schemas/index.ts`).

### 4.4 Spec artifact extension (`src/schemas/spec.ts`)

Add a **required** structured `stories` array to `SpecArtifact` (addresses 1-C11 — drop the fallback, make `stories` required):

```typescript
export const StorySpec = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  epic: z.string().default(""),
  acceptance_criteria: z.array(z.string().min(1)).min(1),
  depends_on: z.array(z.string()).default([]),
});

export const SpecArtifact = z.object({
  epics_md: z.string().min(1),
  backlog_md: z.string().min(1),
  dependency_graph: z.string().min(1),
  story_count: z.number().int().positive(),
  stories: z.array(StorySpec).min(1),   // REQUIRED (was optional in round 1)
}).refine(
  (data) => data.story_count === data.stories.length,
  { message: "story_count must equal stories.length", path: ["story_count"] },
);
```

The `agent-specs/spec.yaml` system_prompt gets a new output instruction: emit `artifact.stories` as a structured array alongside the existing markdown fields. Each story has `id`, `title`, `acceptance_criteria[]`, `depends_on[]`. The `.refine()` enforces `story_count === stories.length`.

**No fallback parser.** If `stories` is absent or empty, `SpecArtifact` validation fails at the spec stage (the spec agent must emit it), and `BuildLoopRunner.run()` escalates with a clear error if it somehow receives a spec artifact lacking `stories`. This repo controls the only spec producer (`agent-specs/spec.yaml`), so a fallback parser serving legacy artifacts is unnecessary (there are no legacy spec artifacts worth preserving post-launch of this change).

### 4.5 Build artifact extension (`src/schemas/build.ts`)

Add an optional `stories` array to `BuildArtifact` (additive — backward compatible with the ship stage which reads `repo_path` + `test_results`):

```typescript
export const StoryBuildResult = z.object({
  story_id: z.string(),
  status: z.enum(["done", "failed", "escalated"]),
  retry_count: z.number().int().nonnegative(),
  worker_tokens: z.number().int().nonnegative(),
  validator_tokens: z.number().int().nonnegative(),
  worker_cost_usd: z.number().nonnegative(),
  validator_cost_usd: z.number().nonnegative(),
  test_passed: z.number().int().nonnegative(),
  test_failed: z.number().int().nonnegative(),
});

export const BuildArtifact = z.object({
  repo_path: z.string().min(1),
  test_results: TestResults,
  prs_merged: z.array(PrMerged).default([]),
  escalations: z.array(Escalation).default([]),
  stories: z.array(StoryBuildResult).optional(),
});
```

The committed `schemas/build.schema.json` + `schemas/spec.schema.json` are regenerated by `npm run export-schemas` (wired in A4.1 — see §4.1).

### 4.6 Opencode environment inheritance + Security (`src/sandbox/runner.ts`)

**Host-path translation (addresses 1-C5):** The engine runs inside a container where `MISSION_CONTROL_ROOT=/mission-control` (docker-compose.yml:32). When the engine spawns sibling sandbox containers via `docker run`, Docker resolves bind-mount sources on the **host**. The existing codebase solves this for workspaces via `REALCODE_HOST_DATA_DIR` (sandbox/runner.ts:65-69). This plan mirrors that pattern for the two new mounts:

New config env vars (all set in docker-compose.yml from host-side `.env`):
- `REALCODE_HOST_MISSION_CONTROL_ROOT` — host path to mission-control root (e.g. `/home/royce/mission-control`). Used as the `docker run -v` source for sandbox mission-control mounts.
- `REALCODE_HOST_OPENCODE_CONFIG_DIR` — host path to the operator's opencode config dir (e.g. `/home/royce/.config/opencode`). Used as the `docker run -v` source for sandbox opencode-config mounts.

The engine reads its own **container-local** paths (`MISSION_CONTROL_ROOT=/mission-control`, `REALCODE_OPENCODE_CONFIG_DIR=/root/.config/opencode`) for discovery (`discoverMcpPaths()` reads `/root/.config/opencode/opencode.json`); the host-path env vars are only used when constructing `docker run -v` commands for sandboxes. `REALCODE_OPERATOR_HOME` (introduced in round 1) is **deleted** — it was never used.

The `SandboxRunner.runDocker()` method gains:

1. **Mount the opencode config dir** read-only at `/root/.config/opencode/` inside the sandbox, sourcing from the **host** path:
   ```
   -v ${REALCODE_HOST_OPENCODE_CONFIG_DIR}:/root/.config/opencode:ro
   ```

2. **Set `HOME=/root`** + `XDG_CONFIG_HOME=/root/.config` in the sandbox env so opencode finds `~/.config/opencode/`.

3. **Mount the mission-control root** at the **host** path (so MCP server paths under it resolve inside the sandbox), sourcing from the **host** path:
   ```
   -v ${REALCODE_HOST_MISSION_CONTROL_ROOT}:${REALCODE_HOST_MISSION_CONTROL_ROOT}:ro
   ```
   (The existing `/mission-control` mount for the engine container's own use — `seedWorkspaceFromProject` — is kept separately in docker-compose.yml.)

4. **Discover and mount MCP server paths.** The engine reads `opencode.json` from its container-local mount (`/root/.config/opencode/opencode.json`), finds the `mcp` section, extracts each server's `command` path (e.g. `/home/royce/.local/bin/codebase-memory-mcp`, `/home/royce/mission-control/PROJECTS/realmemory/repo/dist/bin.js`), and mounts each path read-only at the SAME host path inside the sandbox:
   ```
   -v /home/royce/.local/bin/codebase-memory-mcp:/home/royce/.local/bin/codebase-memory-mcp:ro
   -v /home/royce/mission-control/PROJECTS/realmemory/repo/dist:/home/royce/mission-control/PROJECTS/realmemory/repo/dist:ro
   ```
   The mission-control root mount (step 3) covers paths under it; standalone binary paths are mounted individually.

5. **Network egress:** The sandbox needs network access to: the LLM provider (OpenRouter), npm registry (for opencode plugin fetching), GitHub (for anymake plugin git clone). The `realcode-sandbox-net` network already exists. The egress allowlist is NOT tightened in this change (post-MVP hardening per planning-doc ADR-003).

**Config discovery:** A new helper `discoverMcpPaths(configDir: string): string[]` reads `opencode.json`, parses the `mcp` section, and returns the set of file/directory paths referenced by each server's `command` array. The sandbox runner mounts each discovered path read-only.

#### 4.6.1 Security: trust boundary + secret-scan (addresses 1-C6)

**Trust boundary being crossed:** The opencode-config mount brings the operator's config (`opencode.json`), `agent/` directory, `skills/` directory, and MCP server definitions into every sandbox. MCP server configs commonly carry API keys or connection strings; realmemory exposes `store`/`update`/`forget` (write access to the operator's cross-project memory store); codebase-memory indexes all projects. A sandboxed agent with Bash can invoke the mounted MCP servers or simply `cat /root/.config/opencode/opencode.json`. The mount is specified read-only, and today's `opencode.json` contains no key-like values (verified — two local MCP server definitions only); model API keys reach the sandbox via env through `collectModelEnv()` (pre-existing, covered by `security.test.ts`). But config drift could introduce secrets into the mounted directory.

**Reporter authorization:** The reporter (Royce) explicitly requested this exact inheritance mechanism in issue #4 ("inherit the operator's opencode env"). This is a single-operator personal tool, so the trust boundary is acceptable — but the plan must say so explicitly and add safeguards.

**Safeguards:**

1. **Startup secret-scan:** The engine runs a scan at startup (and before each sandbox spawn) over the mounted config directory (at minimum `opencode.json`, plus any `*.json`/`*.yaml`/`*.yml`/`*.env` files in the config dir). The scan matches values against a secret-pattern regex (e.g. `/(?:sk-|AKIA|ghp_|gho_|xox[bap]|AIza)[A-Za-z0-9]{16,}/` plus the `KEY_PATTERN` from `collectModelEnv()`). On a match: **refuse to spawn** the sandbox and log a loud warning with the offending file + pattern name (not the value). The scan is a new function `scanForSecrets(dir: string): { file: string; pattern: string }[]` in `src/sandbox/secret-scan.ts`.

2. **Subpath mounting (considered, not adopted for MVP):** Mounting only `opencode.json` + `agent/` + `skills/` (excluding `node_modules/`, `plugins/`, and anything else in the config dir) would reduce the surface. However, opencode's plugin resolution needs the full config dir structure, and subpath mounting requires enumerating every needed file (fragile to config changes). The whole-dir mount + secret-scan is the MVP approach; subpath mounting is a post-MVP hardening item (logged to `PARKING_LOT.md`).

3. **Read-only enforcement:** The mount is `:ro` (verified in the spec). The security test suite (§10) asserts this.

4. **Approval gate:** Per the arbiter's security rule ("security-relevant plan → final approval is always the real user"), this plan's final approval **must be the real user (Royce) in every mode** — the Product Owner Proxy cannot approve this plan. This is noted in §6 and §11.

### 4.7 Container lifecycle + log capture (`src/sandbox/runner.ts` + `src/engine/build-loop.ts`)

**Container naming:** Each sandbox container gets a deterministic name: `realcode-<run_id>-<story_id>-<role>-<attempt>` (e.g. `realcode-run_abc-story-3-1-worker-0`; dots in story IDs are replaced with dashes for Docker name validity). The `--name` flag is passed to `docker run`. This makes containers identifiable in `docker ps` and allows `docker logs <name>`.

**Container ID capture:** The `--cidfile` flag writes the container ID to a temp file. The `SandboxResult` gains a `containerId: string` field. The `BuildLoopRunner` records this in `build-state.json`.

**Container log persistence (addresses 1-C12 — log addressing consistency):** The `SandboxRunner.exec()` already captures stdout/stderr into `SandboxResult`. The `BuildLoopRunner` writes the full stdout+stderr to `data/runs/<run_id>/containers/<story_id>-<role>-<attempt>.log` after each sandbox completes. The log file path is recorded in `build-state.json`'s `containers[]` array as `log_path`:

```json
"containers": [
  {
    "container_id": "abc123...",
    "name": "realcode-run_abc-story-3-1-worker-0",
    "story_id": "3.1",
    "role": "worker",
    "attempt": 0,
    "status": "exited",
    "started_at": <epoch_ms>,
    "exited_at": <epoch_ms>,
    "log_path": "data/runs/run_abc/containers/3.1-worker-0.log"
  }
]
```

The log file contains the raw JSON event stream (from `--format json`) + stderr, prefixed with a header line:
```
=== realcode-run_abc-story-3-1-worker-0 ===
=== started 2026-08-11T22:00:00Z ===
<raw stdout/stderr>
=== exited code=0, duration=45s ===
```

**Log endpoint resolution (addresses 1-C12):** The `GET /api/runs/[id]/containers/[cid]/logs` endpoint resolves `[cid]` through `build-state.json`'s `containers[]` array — it finds the entry whose `container_id` (or `name`) matches `[cid]`, reads that entry's `log_path`, and returns the file contents. This makes §4.7 (which writes `<story_id>-<role>-<attempt>.log`) and §4.11 (which reads by `[cid]`) consistent. The `?tail=N` query param returns the last N lines for large logs.

**Crash detection:** The `SandboxRunner` already detects non-zero exit codes and timeouts. The `BuildLoopRunner` treats a crash (non-zero exit, timeout, or spawn error) as an environment failure → `AgentStageRunner.run()` returns `output_status: "escalate"` (lines 76-97) → the loop escalates the story immediately (per the mapping table in §4.2).

### 4.8 Worker agent spec (`agent-specs/worker.yaml` — new file)

Self-contained (INV-7). Receives ONE story, implements it, commits, returns WorkerOutput. The output contract emits `gate_verdict` values that the §4.2 mapping table expects:

```yaml
stage: build_worker
anymake_phase: 4
model_tier: 3
permission_mode: unattended
system_prompt: |
  You are a Worker agent for realcode's build inner loop. You implement EXACTLY ONE story.
  You have the Read, Write, Edit, and Bash tools. The workspace directory is the target repo.

  ## Your job
  1. Read the story's acceptance criteria (in the prompt below).
  2. Implement working, runnable code that satisfies each criterion — not stubs.
  3. Write automated tests for every runtime-verifiable acceptance criterion.
  4. Run the project's test command (check package.json scripts.test).
  5. Commit: git add -A && git commit -m "feat(story-N.N): <title>"
  6. Emit the WorkerOutput JSON artifact wrapped in <artifact>...</artifact> tags.

  ## Context discipline (INV-7)
  - Do NOT read, list, or traverse node_modules/, data/, .git/, dist/, .next/, coverage/.
  - Do NOT read anymake docs (PHASE_GUIDES/, TEMPLATES/, AGENTS/).
  - Work ONLY from the prompt-provided context. Keep your context lean.

  ## Output contract
  Emit gate_verdict as follows:
  - "pass" if you successfully implemented the story (artifact.result == "success")
  - "needs_changes" if you hit an ENVIRONMENT failure (artifact.result == "failed", artifact.failure_type == "environment") — the engine will retry you
  - "escalate" if you hit an IMPLEMENTATION failure (artifact.result == "failed", artifact.failure_type == "implementation") or cannot proceed

  <artifact>
  {
    "gate_verdict": "pass" | "needs_changes" | "escalate",
    "gate_notes": "...",
    "status": "success" | "failed" | "escalated",
    "artifact": {
      "story_id": "<from prompt>",
      "result": "success" | "failed",
      "failure_type": "environment" | "implementation",
      "failure_description": "...",
      "branch": "main",
      "commits": [{"sha": "...", "message": "..."}],
      "test_output": "...",
      "test_passed": N,
      "test_failed": N,
      "notes": "..."
    }
  }
  </artifact>
user_prompt_template: |
  Implement story {story_id}: {story_title}

  Acceptance criteria:
  {acceptance_criteria}

  Workspace: {workspace}
  Project type: {frame.project_type}

  PRD (for context):
  {plan.prd_md}

  ADRs (for context):
  {plan.adrs}

  Implement the story, write tests, run tests, commit, and emit the WorkerOutput artifact.
tool_allowlist:
  - Read
  - Write
  - Edit
  - Bash
```

**`{acceptance_criteria}` serialization:** The `BuildLoopRunner` serializes the `acceptance_criteria` array as a joined string before passing it in `extraContext`: `acceptance_criteria: story.acceptance_criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")`. The `fillTemplate` function then interpolates this string normally (it handles string values at line 202).

### 4.9 Validator agent spec (`agent-specs/validator.yaml` — new file)

Self-contained (INV-7). Receives ONE story + the worker's output, validates, returns ValidatorOutput. The output contract carries the verdict in `artifact.verdict` and emits `gate_verdict` per the §4.2 mapping table:

```yaml
stage: build_validator
anymake_phase: 4
model_tier: 2
permission_mode: unattended
system_prompt: |
  You are a Validator agent for realcode's build inner loop. You check ONE story's
  implementation against its acceptance criteria. You NEVER edit code. You have Read + Bash.

  ## Your job
  1. Read the acceptance criteria (in the prompt below).
  2. Read the worker's output (what they built, test results).
  3. For each criterion: classify as code-verifiable, runtime-verifiable, or human-only.
  4. Run the test suite (npm test or equivalent). Record pass/fail per criterion.
  5. Run the security checklist (scan for secrets, check auth, etc.).
  6. Emit the ValidatorOutput JSON artifact.

  ## Verdict decision tree
  - Any security FAIL → verdict "escalate", gate_verdict "escalate"
  - Any runtime-verifiable criterion with no test → verdict "fail", gate_verdict "pass"
  - Any criterion FAIL → verdict "fail", gate_verdict "pass"
  - All criteria PASS → verdict "pass", gate_verdict "pass"

  ## gate_verdict semantics (for the engine's control flow)
  - "pass": the sandbox ran successfully; read artifact.verdict for the actual pass/fail/escalate result
  - "escalate": the sandbox itself failed (crash, timeout, no artifact) OR verdict is "escalate"

  ## Output contract
  <artifact>
  {
    "gate_verdict": "pass" | "escalate",
    "gate_notes": "...",
    "status": "pass" | "fail" | "escalate",
    "artifact": {
      "story_id": "<from prompt>",
      "verdict": "pass" | "fail" | "escalate",
      "escalation_type": "...",
      "criteria_results": [{"criterion": "...", "result": "pass|fail|...", "evidence": "..."}],
      "security_checklist": [{"check": "...", "result": "..."}],
      "notes": "..."
    }
  }
  </artifact>
user_prompt_template: |
  Validate story {story_id}: {story_title}

  Acceptance criteria:
  {acceptance_criteria}

  Worker output:
  {worker_output}

  Workspace: {workspace}

  Check each criterion against the implementation. Run tests. Emit the ValidatorOutput artifact.
tool_allowlist:
  - Read
  - Bash
```

### 4.10 Tracing: engine-side synthesis from sandbox JSON events (`src/engine/build-loop.ts` + `src/engine/tracing.ts`) (addresses 1-C4)

**Chosen mechanism: engine-side synthesis.** Phoenix today receives only engine-side run/stage spans. The per-turn `startTurnSpan`/`recordTokenUsage` helpers in `tracing.ts` are defined but never called (grep-verified). The sandbox has no OTLP exporter endpoint (`sandbox/runner.ts:77` passes only `OTEL_TRACEPARENT`), and the sandbox runs on `realcode-sandbox-net` while Phoenix is on `realcode-net` (docker-compose.yml defines only `realcode-net`; the sandbox network is external) — so even a configured exporter couldn't resolve `phoenix:6006`. Sandbox-side OTLP export (option b) would require network changes and evidence that headless opencode emits OTLP spans with propagatable custom attributes (the ADR-001 spike documented tool calls in the JSON event stream, not OTel).

**Engine-side synthesis:** After each Worker/Validator sandbox completes, `BuildLoopRunner` converts the sandbox's captured `jsonEvents` (already in `SandboxResult`, parsed by `parseJsonLines`) into per-turn OTel spans. Each JSON event with a `part.tokens` field becomes a turn span; each event with a `part.type === "tool_use"` or `part.tool` field becomes a tool-call span (child of the turn). The synthesis logic:

```typescript
// In BuildLoopRunner, after each sandbox completes:
function emitTurnSpans(runId: string, storyId: string, role: string, jsonEvents: unknown[], stageSpan: Span): void {
  let turnIndex = 0;
  for (const e of jsonEvents) {
    const ev = e as Record<string, unknown>;
    const part = ev.part as Record<string, unknown> | undefined;
    if (!part) continue;

    // Turn boundary: events with token usage
    if (part.tokens) {
      const turnSpan = startTurnSpan(runId, `${role}_${storyId}`, turnIndex, role, "");
      turnSpan.setAttributes({
        "realcode.story_id": storyId,
        "realcode.role": role,
        "realcode.turn": turnIndex,
        "realcode.tokens.prompt": (part.tokens as any).input ?? 0,
        "realcode.tokens.completion": (part.tokens as any).output ?? 0,
        "realcode.tokens.total": (part.tokens as any).total ?? 0,
        "realcode.cost.usd": part.cost ?? 0,
      });
      // Extract agent message text (part.text if present)
      if (typeof part.text === "string") {
        turnSpan.setAttribute("realcode.agent_message", part.text.slice(0, 2000));
      }
      turnSpan.end();
      turnIndex++;
    }

    // Tool call: events with tool_use
    if (part.type === "tool_use" || part.tool) {
      const toolSpan = trace.getTracer("realcode").startSpan(`tool:${part.tool ?? "unknown"}`, {
        attributes: {
          "realcode.run_id": runId,
          "realcode.story_id": storyId,
          "realcode.role": role,
          "realcode.tool": part.tool ?? "unknown",
          "realcode.tool_input": JSON.stringify(part.input ?? {}).slice(0, 1000),
        },
      });
      toolSpan.end();
    }
  }
}
```

These spans carry `realcode.run_id`, `realcode.story_id`, `realcode.role`, `realcode.turn`, `realcode.tool`, `realcode.tokens.*`, `realcode.cost.usd`, and `realcode.agent_message`. The `realcode.role` attribute carries `build_worker` or `build_validator` (the `role` value passed from §4.2's `dispatchWorker`/`dispatchValidator` `extraContext` — 3-C3), matching the canned artifact keys and `STAGE_SCHEMAS` keys. They land in Phoenix via the existing exporter and are queryable by `realcode.run_id` — the dashboard's SSE stream consumes them.

**Granularity:** This is per-completed-sandbox turn granularity (the `jsonEvents` are only available after the sandbox exits). Mid-execution streaming of agent messages is NOT delivered by this mechanism; the truly-live stream is the container log view (`ContainerLogViewer`), which can tail the sandbox's raw stdout as it runs (the `SandboxResult.stdout` is captured incrementally by `exec()` at lines 118-119 — the `ContainerLogViewer` polls the log file, which the `BuildLoopRunner` writes incrementally during execution if it adopts a streaming-write path, or after completion if buffered). For MVP, container logs are written after completion; a post-MVP enhancement (logged to `PARKING_LOT.md`) would stream stdout to the log file during execution for true real-time visibility.

### 4.11 Dashboard: mission-control visibility

**New API endpoints** (in `src/dashboard/app/api/runs/[id]/`):

1. `GET /api/runs/[id]/stories` — reads `data/runs/<id>/build-state.json`, returns the stories array with status, retry_count, worker/validator output summaries, timestamps. Returns 404 if no build-state.json (run hasn't reached build yet).

2. `GET /api/runs/[id]/containers` — reads `data/runs/<id>/build-state.json`, returns the containers array (container_id, name, story_id, role, status, started_at, exited_at, log_path). Plus lists log files in `data/runs/<id>/containers/`.

3. `GET /api/runs/[id]/containers/[cid]/logs` — resolves `[cid]` through `build-state.json`'s `containers[]` array (matching `container_id` or `name`), reads the `log_path` field, returns the raw text. Supports a `?tail=N` query param for the last N lines (for large logs). (Addresses 1-C12 — the endpoint is keyed by `[cid]` but resolves through `log_path` in `build-state.json`, not by reading a `<cid>.log` file that doesn't exist.)

4. `GET /api/runs/[id]/stream` (SSE) — Server-Sent Events endpoint that:
   - Sets `Content-Type: text/event-stream`
   - Polls Phoenix GraphQL every 2s: queries `Project.spans` filtered by `attributes['realcode.run_id'] == '<id>'`, sorted by `startTime`
   - Tracks the last-seen span count; on each poll, emits new spans as SSE events: `data: {"type":"span","span_name":"...","span_kind":"...","start_time":"...","attributes":{...},"output":"..."}\n\n`
   - Also emits build-state updates: polls `build-state.json` and emits `data: {"type":"story_update","story_id":"...","status":"..."}\n\n` on state changes
   - Closes when the run reaches a terminal state (`built`, `build_failed`, `escalated`, `shipped`)

The Phoenix GraphQL query (verified against the running Phoenix at localhost:6006):
```graphql
{
  projects(first: 1) {
    edges {
      node {
        spans(first: 500, filterCondition: "attributes['realcode.run_id'] == '<run_id>'") {
          edges {
            node {
              name
              spanKind
              startTime
              endTime
              attributes
              output
              events
            }
          }
        }
      }
    }
  }
}
```

The spans rendered include the synthesized turn/tool spans from §4.10 (which carry `realcode.agent_message`, `realcode.tool`, `realcode.tokens.*`). The `LiveTraceStream` component renders these as "agent messages + tool calls" — satisfying the issue's requirement via the engine-side synthesis mechanism.

**New components** (in `src/dashboard/components/`):

1. `StoryProgress.tsx` — a vertical list of stories (from `GET /api/runs/[id]/stories`). Each row: story ID (mono), title, status badge (pending=neutral, building=amber pulse, validating=amber, done=green, failed=red), retry count, duration. Reuses `Badge`, `StatusDot`, `cn` from `ui.tsx`. Polls every 2s when the run is in the build stage.

2. `ContainerGrid.tsx` — a grid of container cards (from `GET /api/runs/[id]/containers`). Each card: container name (mono), story ID, role (Worker/Validator badge), status (running=amber pulse / exited=green / failed=red), duration. Clicking a card selects it in the `ContainerLogViewer`. Reuses `Card`, `Badge`.

3. `LiveTraceStream.tsx` — consumes the SSE endpoint (`GET /api/runs/[id]/stream`), renders a live-updating timeline of agent messages + tool calls. Each event: span name, agent/role (from `realcode.role` attribute), tool calls (from `realcode.tool`), tokens, cost, agent message text (from `realcode.agent_message`). Reuses the `TraceTimeline` visual pattern (ChevronRight, Wrench icon, mono font) but fed by real SSE data instead of mock data. Auto-scrolls; pauses on manual scroll-up. Renders spans as they arrive (per-completed-sandbox granularity — see §4.10).

4. `ContainerLogViewer.tsx` — a terminal-style log viewer. Fetches `GET /api/runs/[id]/containers/[cid]/logs`, renders in a `<pre>` with mono font on `bg-ink-950` (or `bg-[#0a0b12]` — see §7), auto-scroll to bottom, a "tail" toggle (last 100 lines / full). Reuses `Card` shell.

**Updated run-detail page** (`src/dashboard/app/runs/[id]/page.tsx`):

The page gains a conditional "Build Stage Detail" section, shown when `stages.build === "running"` or when `artifacts.build` is present:

```
[Existing header card with StageStepper]
[Existing per-stage cards for frame/discover/plan/spec]
[NEW: Build Stage Detail section — shown when build stage is active or complete]
  [StoryProgress]  [ContainerGrid]
  [LiveTraceStream]
  [ContainerLogViewer — below the grid, shows the selected container's logs]
[Existing per-stage card for ship]
```

The Build Stage Detail section replaces the current build stage's plain artifact JSON viewer with the mission-control view. The artifact JSON is still accessible via a "View raw artifact" toggle.

**Updated `getRunDetail()`** (`src/dashboard/lib/engine.ts`): reads `build-state.json` if present and includes it in the `RunDetailResponse` as `build_state?: { stories: [...], containers: [...] }`.

### 4.12 Config: Dockerfile.sandbox + docker-compose.yml

**New `Dockerfile.sandbox`** (the `realcode-sandbox:latest` image — currently nonexistent in the repo):

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    git docker.io procps && rm -rf /var/lib/apt/lists/*
RUN npm install -g opencode@latest
WORKDIR /workspace
ENV HOME=/root
# The opencode config, MCP servers, and workspace are mounted at runtime
CMD ["opencode"]
```

The image is minimal — it provides opencode + node + git. The opencode config (plugins, skills, MCP servers) is mounted at runtime from the operator's environment (§4.6).

**Updated `docker-compose.yml`** (addresses 1-C5 host-path translation, 1-C12 sandbox service):

```yaml
services:
  engine:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: realcode-engine
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - ANYMAKE_MODEL_TIER1=${ANYMAKE_MODEL_TIER1:-openrouter/z-ai/glm-5.2}
      - ANYMAKE_MODEL_TIER2=${ANYMAKE_MODEL_TIER2:-openrouter/z-ai/glm-5.2}
      - ANYMAKE_MODEL_TIER3=${ANYMAKE_MODEL_TIER3:-openrouter/z-ai/glm-5.2}
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY:?OPENROUTER_API_KEY must be set in .env}
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://phoenix:6006/v1/traces
      - OTEL_SERVICE_NAME=realcode-engine
      - REALCODE_DATA_DIR=/data
      - REALCODE_HOST_DATA_DIR=${PWD}/data
      - REALCODE_GRAPH=/app/stage-graph.yaml
      - REALCODE_DISPATCH_INTERVAL_MS=${REALCODE_DISPATCH_INTERVAL_MS:-5000}
      - MISSION_CONTROL_ROOT=/mission-control
      - REALCODE_HOST_MISSION_CONTROL_ROOT=${REALCODE_HOST_MISSION_CONTROL_ROOT:-/home/royce/mission-control}
      - REALCODE_OPENCODE_CONFIG_DIR=/root/.config/opencode
      - REALCODE_HOST_OPENCODE_CONFIG_DIR=${REALCODE_HOST_OPENCODE_CONFIG_DIR:-/home/royce/.config/opencode}
    volumes:
      - ./data:/data
      - /var/run/docker.sock:/var/run/docker.sock
      - /usr/bin/docker:/usr/local/bin/docker:ro
      - ${REALCODE_HOST_MISSION_CONTROL_ROOT:-/home/royce/mission-control}:/mission-control:ro
      - ${REALCODE_HOST_OPENCODE_CONFIG_DIR:-/home/royce/.config/opencode}:/root/.config/opencode:ro
    depends_on:
      phoenix:
        condition: service_started
    networks:
      - realcode-net
    command: ["node", "dist/engine-loop.js"]

  sandbox:
    build:
      context: .
      dockerfile: Dockerfile.sandbox
    image: realcode-sandbox:latest
    profiles: ["build-only"]   # not started by `docker compose up`; built via `docker compose build sandbox`

  dashboard:
    build:
      context: .
      dockerfile: Dockerfile.dashboard
    container_name: realcode-dashboard
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      - NODE_ENV=production
      - REALCODE_DATA_DIR=/data
      - REALCODE_GRAPH=/app/stage-graph.yaml
      - OTEL_EXPORTER_OTLP_ENDPOINT=http://phoenix:6006/v1/traces
      - MISSION_CONTROL_ROOT=/mission-control
    volumes:
      - ./data:/data
      - ${REALCODE_HOST_MISSION_CONTROL_ROOT:-/home/royce/mission-control}:/mission-control:ro
    depends_on:
      - engine
    networks:
      - realcode-net

  phoenix:
    image: arizephoenix/phoenix:latest
    container_name: realcode-phoenix
    restart: unless-stopped
    ports:
      - "6006:6006"
    volumes:
      - phoenix-data:/data
    networks:
      - realcode-net

volumes:
  phoenix-data:

networks:
  realcode-net:
    driver: bridge
```

Key changes: (a) the hardcoded `/home/royce/mission-control:/mission-control:ro` is replaced with `${REALCODE_HOST_MISSION_CONTROL_ROOT:-...}:/mission-control:ro`; (b) the engine gets the opencode config mount (container-local path `/root/.config/opencode` for discovery, sourced from the host path `REALCODE_HOST_OPENCODE_CONFIG_DIR`); (c) the engine gets `REALCODE_HOST_MISSION_CONTROL_ROOT` + `REALCODE_HOST_OPENCODE_CONFIG_DIR` env vars (host paths, passed to sandbox `docker run -v` commands); (d) a `sandbox` service with `build: { dockerfile: Dockerfile.sandbox }` is added (under a `build-only` profile so `docker compose up` doesn't try to start it — it's built via `docker compose build sandbox`); (e) `REALCODE_OPERATOR_HOME` is removed (was never used).

### 4.13 Lease/timeout model (addresses 1-C9)

**Lease mechanism (decided): heartbeat via a new `Queue.heartbeat()` method.** The `Queue` interface (`src/backend/types.ts`) and `SQLiteQueue` (`src/backend/sqlite-queue.ts`) gain:

```typescript
// Queue interface — new method:
heartbeat(item_id: string, lease_ms: number): void;

// SQLiteQueue implementation:
heartbeat(item_id: string, lease_ms: number): void {
  const now = Date.now();
  this.db.prepare(
    `UPDATE work_items SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND worker_id IS NOT NULL`,
  ).run(now + lease_ms, now, item_id);
}
```

`BuildLoopRunner.run()` calls `queue.heartbeat(item.id, stage.timeout_ms)` before **BOTH the Worker and Validator dispatches** (see §4.2 pseudocode — two heartbeat calls per story, not one). This is the 2-C3 fix: one story can run up to 2 × `stage.timeout_ms` (Worker 20 min + Validator 20 min = 40 min worst case). Heartbeating only before the Worker (with `lease_ms = stage.timeout_ms` = 20 min) would expire the lease mid-Validator; `expire_leases()` (`sqlite-queue.ts:96-116`) would clear `worker_id`/`lease_expires_at`, leave status `specified` (retry_count 0→1, below the escalate threshold of 2), and the next `dispatchCycle()` would re-claim the item → a second `BuildLoopRunner` (double-spend, duplicate containers). Heartbeating before both sandboxes keeps the lease fresh across the full story cycle: each heartbeat extends the lease by `stage.timeout_ms` (20 min), and each sandbox takes at most `stage.timeout_ms` (20 min), so the lease never expires mid-story. If the runner dies during a sandbox, the lease expires within 20 min (not 40 min) — tighter than the alternative `2 × stage.timeout_ms` lease, which would delay dead-runner detection. The `queue.annotate()` method (a no-op at line 76) is NOT used — it doesn't touch leases.

**Per-sandbox timeout:** Each Worker/Validator sandbox dispatch uses `stage.timeout_ms` (1200000ms = 20 min) as its `timeoutMs`, passed through `AgentStageRunner.run()` → `SandboxRunner.run()` → `exec()`. This is the existing mechanism (runner.ts:69). A 20-min per-sandbox ceiling is generous but bounded; a story that takes longer is killed by the timeout and treated as an environment failure (→ escalate per the mapping table). A new optional graph field `per_sandbox_timeout_ms` is NOT added for MVP — the stage's `timeout_ms` is reused. (If per-sandbox tuning is needed later, it's a config addition, not an architecture change.)

**Overall wall-clock bound:** `BuildLoopRunner.run()` sets `wall_clock_deadline_ms = started_at + stage.timeout_ms` (20 min from loop start). Before each story, it checks `now() > wall_clock_deadline_ms` → escalate. This bounds the entire inner loop to the stage's timeout (20 min), regardless of story count. A 17-story loop that can't complete in 20 min escalates rather than running indefinitely. (Note: this is tighter than the sum of per-sandbox timeouts — a 17-story loop × 2 sandboxes × 20 min = 11 hours would be absurd; the wall-clock bound prevents that. The per-sandbox timeout is the kill switch for a single stuck sandbox; the wall-clock bound is the kill switch for the whole loop.)

**Note on the 17-story case:** A 17-story loop cannot complete in 20 min (the stage's `timeout_ms`). That's correct and intentional: the issue's example (run_0ba334d1, 17 stories, 20-min timeout, escalated) is the failure mode this plan fixes by making each story a separate sandbox — but the stage's `timeout_ms` is still the ceiling. For a 17-story backlog, the operator must raise `stage.timeout_ms` in `stage-graph.yaml` (a config change, not an engine change). The plan does not auto-scale the timeout; it makes the loop observable and bounded. A post-MVP enhancement (logged to `PARKING_LOT.md`) could derive `wall_clock_deadline_ms` from `story_count × per_story_estimate`.

### 4.14 ADR-009: Engine-orchestrated build inner loop (addresses 1-C7)

**Written as part of this plan's scope (Story A4.1), not deferred to post-ship.** Per the arbiter's rule ("when an override is approved, the superseding ADR is written FIRST — only then is the change buildable"), this plan adds a new ADR-009 to `docs/DECISIONS.md`:

```markdown
## ADR-009: Engine-orchestrated build inner loop (supersedes ADR-001 spike refinement)
**Status:** Accepted (2026-08-11, issue #4)
**Context:** ADR-001's spike refinement (planning-doc ADR-001, lines 83-85) specified that the
primary agent inside the build sandbox dispatches anymake subagents via the Task tool. This proved
infeasible: headless `opencode run --auto` mode does not expose the Task tool, so a single sandbox
cannot spawn anymake's Orchestrator/Planner/Worker/Validator. The build stage collapsed to a single
agent attempting the entire backlog in one session, escalating on non-trivial work (run_0ba334d1:
17 stories, 1.27M tokens, 20-min timeout, escalated). The `inner_loop: anymake-build-loop` field in
`stage-graph.yaml` was loaded but never acted on.
**Decision:** The realcode ENGINE orchestrates the build inner loop. For each story (serially, per
planning-doc ADR-007): the engine spawns a Worker sandbox (one container, one story), then a Validator
sandbox (one container, one story). Each sandbox is a headless `opencode run --auto` invocation
(ADR-001's core Option B decision preserved). The engine reads the spec artifact's structured
`stories[]` array, tracks per-story state in `build-state.json`, and aggregates results into the
build artifact. The Planner and Product Owner Proxy roles from `pipeline-design.md` Stage 5 are
dropped (the Worker receives the story + prior artifacts directly; there is no per-story re-planning
gate for MVP). Implementation failures escalate immediately (deviates from planning-doc ADR-007's
max-1 re-dispatch — see §4.2 reconciliation note).
**Consequences:** The build stage can ship non-trivial backlogs. Per-story cost tracking, per-story
retry ceilings, and per-story container isolation are enabled. The operator's opencode environment
(config, skills, MCP servers) is inherited by each sandbox via a configurable mount (§4.6) —
authorized by issue #4's explicit request, with a startup secret-scan safeguard (§4.6.1).
**Supersedes:** ADR-001's spike refinement mechanism (in-sandbox Task-tool dispatch). ADR-001's core
Option B decision (headless opencode-in-sandbox) stands.
**Enforced in:** `src/engine/build-loop.ts`, `src/engine/dispatcher.ts`, `src/engine/engine-loop.ts`,
`src/agents/runner.ts` (specOverride/schemaKey/extraContext), `stage-graph.yaml` (worker_spec/validator_spec).
**Related:** planning-doc ADR-007 (retry matrix — deviates on implementation failure),
planning-doc ADR-003 (sandbox isolation — opencode-config mount is a new surface, safeguarded by §4.6.1).
```

ADR-001's Status in `DECISIONS.md` stays "Accepted" (the core decision stands); a note is added to ADR-001's entry: "Spike refinement mechanism superseded by ADR-009 (engine-orchestrated inner loop). Core Option B decision preserved."

---

## 5. Alternatives Considered

| Option | Why not chosen |
|--------|----------------|
| **A — Give the sandbox Task/subagent capability.** Instead of engine orchestration, make headless `opencode run --auto` support the Task tool so a single opencode session can spawn anymake subagents (Orchestrator→Planner→Worker→Validator) in-session, as ADR-001's spike refinement described. | Requires either (a) an opencode upstream change to support Task tool in headless `--auto` mode (not in realcode's control — the spike flagged this as the "known-fragile surface"), or (b) realcode building its own opencode runner with subagent dispatch (ADR-001 Option D — explicitly rejected as more build work). A single long-lived session accumulating context across all stories is the exact failure mode anymake's architecture splits into separate agents to avoid (ADR-001 eliminated Option A for this reason). No per-story cost tracking, no per-story retry ceilings, no per-story container isolation. The issue explicitly requires "The realcode ENGINE is the orchestrator -- not the sandbox." |
| **B — Multiple top-level stages instead of an inner loop.** Explode the build stage into multiple top-level stages (one per story). | Violates INV-1/ADR-002: the number of stages would be data-dependent (varies per run based on backlog size), but `stage-graph.yaml` is loaded once at startup. `pipeline-design.md` §1 explicitly says the inner loop "is contained inside stage 5 and does not appear in the top-level transitions." Each run has a different backlog size — dynamic stage counts break the declarative model. |
| **C — Keep single sandbox, increase timeout + tighter context discipline.** The "simplify build stage" approach (informal next-work item #4). | Doesn't fix the fundamental problem: a single agent implementing 17 stories in one session will always hit context limits. The issue explicitly rejects this: "the right fix is NOT to simplify/degrade the build stage, but to properly orchestrate the multi-agent loop." Violates the success model (≥85% ship with zero human edits). No per-story validation (Worker/Validator split). |

---

## 6. Intent Constraints

**Classification: Modifying** — this change completes the intended (but never implemented) build stage inner loop, adds new per-story artifacts/schemas, and extends the dashboard with mission-control visibility. It changes the build stage's documented runtime behavior (from single-sandbox to multi-container) and supersedes ADR-001's spike-refinement mechanism (recorded in the new ADR-009, §4.14, written as part of this plan's scope). It does NOT violate any core Active Decision or invariant.

Intent-layer ADR/invariant citations (re-mapped to `docs/DECISIONS.md` IDs per 1-C7):

- **ADR-001** (Headless opencode-in-sandbox): **Core decision preserved; spike-refinement mechanism superseded by ADR-009.** The core Option B decision (headless opencode-in-sandbox per stage-run) is preserved — each per-story Worker/Validator sandbox is still a headless `opencode run --auto` inside an ephemeral Docker container. ADR-001's spike refinement (planning-doc ADR-001, lines 83-85) said "the primary agent dispatches anymake subagents via the Task tool" — this proved infeasible in headless `--auto` mode (the Task tool is not available). ADR-009 (§4.14) records the engine-orchestration approach, superseding the spike refinement. This is Modifying, not Contradicting: the core decision stands, and the change makes the implementation match what `pipeline-design.md` §1.1 always described (`inner_loop: anymake-build-loop`).
- **ADR-002** (Stage graph is declarative YAML): **Respected.** The build stage stays as one entry in `stage-graph.yaml`. The `inner_loop` field (already in the schema) is now acted on. New optional `worker_spec`/`validator_spec` fields are additive to the StageEntry schema (with an XOR rule against `agent_spec`). No stage transitions are hard-coded in engine code — the `BuildLoopRunner` is a `StageRunner` implementation, same as `AgentStageRunner`.
- **ADR-003** (Dashboard is thin): **Respected.** New endpoints are sub-paths of `/api/runs/[id]/`. No new top-level routes. The 3-screen structure (board, detail, settings) is unchanged.
- **ADR-004** (Real data, no mock): **Respected.** All new dashboard components read real data (build-state.json, container logs, Phoenix spans). No mock data.
- **ADR-005** (Phoenix tracing): **Respected — extended.** The engine-side synthesis (§4.10) emits per-turn/per-tool-call spans to Phoenix via the existing OTLP exporter. No new exporter or tracing infrastructure.
- **ADR-006** (Agent specs self-contained): **Respected — must be preserved by design.** `worker.yaml` and `validator.yaml` are fully self-contained (all instructions inlined, no external file refs, context-discipline guards). See §4.8/§4.9.
- **ADR-007** (Workspace seeding): **Respected.** The build inner loop uses the same seeded workspace (seeded once at `createRun`). Each worker modifies it in place, committing per story. No re-seeding.
- **ADR-008** (fillTemplate truncation): **Respected.** Each per-story dispatch's user_prompt_template is filled via `fillTemplate()`, which truncates at 8000 chars. The new `extraContext` values (story_id, acceptance_criteria, worker_output) are subject to the same truncation.
- **INV-1** (declarative stage graph): **Preserved.** The `inner_loop` field is data from the graph, not engine code. Adding `worker_spec`/`validator_spec` is a schema extension to the declarative config.
- **INV-2** (schema-validated outputs): **Preserved.** New `WorkerOutput`/`ValidatorOutput` schemas are JSON-Schema-validated. `SpecArtifact.stories` is required (with a `.refine()`); `BuildArtifact.stories` is additive optional (backward-compatible).
- **INV-3** (real data, no mock): **Preserved.** All new dashboard components read real data. No mock data.
- **INV-5** (dashboard is thin): **Preserved.** New endpoints are sub-paths of `/api/runs/[id]/`. No new top-level routes.
- **INV-6** (run deletion must not orphan running work_items): **Addressed in §8 blast radius.** Delete-run during an inner loop is a new interaction (N running containers against a workspace being deleted). §8 specifies the protection: force-delete is blocked while `build-state.json` shows running containers (or, if forced, the containers are torn down via their deterministic names before the workspace is removed).
- **INV-7** (agent specs self-contained): **Preserved by design.** `worker.yaml` and `validator.yaml` are fully self-contained with context-discipline guards.
- **INV-8** (workspace seeding excludes): **Preserved.** The build inner loop uses the same seeded workspace. No re-seeding.

**Planning-doc ADR references** (design record, cited by full title):
- Planning-doc ADR-001 (Headless anymake invocation) — spike refinement superseded by ADR-009.
- Planning-doc ADR-003 (Sandbox/Isolation Mechanism) — the opencode-config mount is a new surface; the "no real secret is ever mounted" hard gate is addressed by §4.6.1 (startup secret-scan + read-only mount + subpath-mounting as post-MVP).
- Planning-doc ADR-007 (Orchestration & Concurrency Model) — retry matrix respected, with one documented deviation (implementation failure escalates immediately rather than max-1 re-dispatch — see §4.2 reconciliation note + ADR-009).
- Planning-doc ADR-009 (LLM Provider/Model Routing) — Worker = Tier 3 (economy), Validator = Tier 2 (capable — backstop must be at least as capable as what it checks).

**Conflict gate:** This is Modifying, not Contradicting. The one ADR mechanism that changes (ADR-001's spike-refinement orchestration locus) is superseded by ADR-009 (§4.14), written as part of this plan's scope — not deferred to a post-ship cartographer refresh.

**Security-relevant plan — real-user approval required:** Per the arbiter's security rule, this plan is security-relevant (the opencode-config/MCP mount is a secret-handling and trust-boundary surface — §4.6.1). **Final approval is the real user's (Royce) in every mode** — the Product Owner Proxy cannot approve this plan. This is noted in §11.

---

## 7. Design Consistency

This change touches the dashboard UI (new components, updated run-detail page). All new UI follows the existing Design DNA from `docs/02-planning/ux-design.md`, using the **as-built** token names (`ink-*`/`status-*`/`brand-*`), not the `slate-*` names in the ux-design doc (which were renamed in `tailwind.config.js`).

| Question | Answer |
|----------|--------|
| Existing components reused | `Card`, `Badge`, `StatusDot`, `Skeleton`, `cn`, `Button` (from `ui.tsx`); `StageStepper` (unchanged); `TraceTimeline` visual pattern (ChevronRight, Wrench icon, mono font, cost/token badges) reused by `LiveTraceStream` |
| New components introduced | `StoryProgress` — no existing component fits (it's a per-story list, not a stage stepper or a run card); `ContainerGrid` — no existing component fits (it's a per-container status grid); `LiveTraceStream` — extends TraceTimeline but needs SSE consumption (TraceTimeline is mock-data only); `ContainerLogViewer` — no existing component fits (terminal-style log viewer is a new visual pattern) |
| Design DNA mapping (as-built tokens) | All new components use: **`Card` primitive** (`bg-ink-900 border-ink-700/60` — verified at `ui.tsx:77`) for card surfaces; **`bg-ink-950`** (or `bg-[#0a0b12]` — verified at `page.tsx:199`) for the log viewer terminal surface; **`font-mono`** (JetBrains token) for story IDs / container names / token counts; **`text-ink-300`/`text-ink-500`** text hierarchy (verified at `RunCard.tsx:29`); **`status-*`** badge tones (`status-pass:#3fd68a` done, `status-run:#f0b440` building, `status-fail:#f06161` failed, `status-pause:#7c8cb0` pending — verified at `tailwind.config.js:11`); **`rounded-xl`** radius; **`p-5`** card padding; **150ms** hover transitions; amber `animate-pulseDot` on running containers/stories. **No raw `slate-*` classes** — they resolve to Tailwind's default slate (`#0f172a`), visibly different from `ink-*` (`#11131d`). |
| New visual patterns | The container log viewer is a new visual pattern (terminal-style raw text on near-black). This is consistent with the Design DNA's "dark-dramatic with technical precision" archetype and the reference to "Docker Desktop's container logs pane" (the issue's own reference). No `ux-design.md` update needed for a new visual pattern — the pattern is a natural extension of the existing `bg-ink-950` app background + `font-mono` token, applied to a `<pre>` block. The component inventory in `ux-design.md` gains entries for the four new components as part of this plan's scope (Story A4.5). |

**Rule check:** no new visual pattern ships without a `ux-design.md` update. The container log viewer IS a new UI element, but it uses only existing Design DNA tokens (dark surface, mono font, status colors) — it's a new component, not a new visual pattern. The `ux-design.md` Component Inventory gains entries for `StoryProgress`, `ContainerGrid`, `LiveTraceStream`, `ContainerLogViewer` as part of this plan's scope (a documentation update to `ux-design.md` is included in Story A4.5).

---

## 8. Blast Radius & Regression Risk

| At risk | Why it's in the blast radius | Protection |
|---------|------------------------------|------------|
| Non-build stages (frame/discover/plan/spec/ship) | The dispatcher's new `inner_loop` branch could break the non-build path if the branch condition is wrong | The branch checks `if (stage.inner_loop)` — only the build stage has this field. Non-build stages continue through `AgentStageRunner.run()` unchanged. Regression test: existing e2e test (frame→ship) — **updated in A4.6** (spec artifact gains `stories`; mock sandbox distinguishes worker/validator; Engine gains BuildLoopRunner) and passes. |
| **`Engine` constructor call sites (2-C1a)** | The `Engine` constructor gains an optional 6th param `buildLoopRunner?: StageRunner`. Five existing call sites: `src/engine-loop.ts:27` (production), `src/cli/index.ts:34` (CLI), `tests/integration/e2e.test.ts:151`, `tests/integration/security.test.ts:166`, `tests/integration/security.test.ts:187` — all currently 5-arg. | The param is **optional** so the 2 security-test call sites (which never reach the build stage — cost-cap and pause checks fire first) stay 5-arg, typechecking unchanged. **UPDATED to 6-arg:** `src/engine-loop.ts:27` (constructs `BuildLoopRunner`, passes it), `src/cli/index.ts:34` (`getEngine()` constructs `BuildLoopRunner` so `realcode resume` works for build-stage runs), `tests/integration/e2e.test.ts:151` (see A4.6). If a call site without a `BuildLoopRunner` ever hits an `inner_loop` stage, the dispatcher's explicit check throws a clear error → caught by try/catch → run escalates (never crashes with `TypeError`). Regression test: `tsc --noEmit` passes (no type errors); the e2e exercises the build stage with a `BuildLoopRunner`. |
| **`src/cli/index.ts` CLI entry point (2-C1a)** | `getEngine()` at line 34 constructs `new Engine(stageGraph, queue, storage, runner, dir)` — 5-arg. The CLI's `resume` command calls `engine.dispatchCycle()`; if a run is in `specified` status, the dispatcher hits the build stage, finds `stage.inner_loop` set, and with no `BuildLoopRunner` escalates with a clear error (regression: `realcode resume` on a build-stage run would die). | `getEngine()` is updated to construct a `BuildLoopRunner` wrapping its `AgentStageRunner` and pass it as the 6th arg — so `realcode resume` works for build-stage runs. Regression test: the e2e (which constructs `Engine` the same way) passes; the CLI's `resume` on a build-stage run dispatches the `BuildLoopRunner` (not an escalate). |
| **Existing e2e test (`tests/integration/e2e.test.ts`) (2-C1)** | The e2e asserts `stageSequence = [framed, discovered, planned, specified, built, shipped]` and `mockSandbox.run` called 6 times. It breaks three ways: (1) the canned spec artifact (`STAGE_ARTIFACTS.spec`, lines 58-69) has `story_count: 8` but no `stories` array → `SpecArtifact` validation fails → run escalates at spec; (2) the e2e `Engine` (line 151) is 5-arg with no `BuildLoopRunner` → dispatcher's `inner_loop` branch dereferences undefined → caught by try/catch → run escalates at build; (3) `makeMockSandbox` (lines 100-131) keys on `Stage:\s*(\w+)` which stays `build` under `specOverride` → worker dispatches receive canned `BuildOutput` → fail `WorkerOutput` validation → escalate. | The e2e is **updated in A4.6** (not "still passes"): (a) canned spec artifact gains a valid `stories` array (8 `StorySpec` entries matching the backlog, satisfying the `.refine()`); (b) `STAGE_ARTIFACTS` gains `build_worker` (canned `WorkerOutput` with `result: "success"`, `gate_verdict: "pass"`) and `build_validator` (canned `ValidatorOutput` with `verdict: "pass"`, `gate_verdict: "pass"`); (c) `makeMockSandbox` keys on `Role:\s*(\w+)` (falling back to `Stage:\s*(\w+)` for non-build stages) to return the appropriate canned artifact; (d) the e2e `Engine` construction (line 151) gains a real `BuildLoopRunner` wrapping the mock-sandbox `AgentStageRunner` (6-arg constructor); (e) the "sandbox called 6 times" test (lines 240-261) is updated: call count increases (5 non-build (frame/discover/plan/spec/ship) + 8 stories × 2 (worker+validator) = 21 total), stage/role sequence includes `build_worker`/`build_validator` pairs. The `stageSequence` assertion stays the same (the `BuildLoopRunner` returns `output_status: "pass"` when all stories done). Regression test: updated e2e passes (A4.6 criterion). |
| Spec stage output | The `SpecArtifact` schema gains a **required** `stories` field. A spec agent that doesn't emit it will fail validation. | The field is required with a `.refine()` enforcing `story_count === stories.length`. `agent-specs/spec.yaml` is updated to emit it. `BuildLoopRunner` escalates with a clear error on a spec artifact lacking `stories`. Regression test: spec schema round-trip test with valid `stories`; rejection test for missing `stories`. |
| Build artifact consumers (ship stage) | The `BuildArtifact` gains an optional `stories` field. The ship stage reads `built.repo_path` and `built.test_results` — unchanged. | The field is optional/additive. Ship stage's `AgentStageRunner.gatherPriorArtifacts()` reads `artifact.repo_path` and `artifact.test_results` — both unchanged. Regression test: ship stage still reads build artifact correctly. |
| Cost cap circuit breaker | Per-story cost aggregation changes how `spent_usd` accumulates (per-story instead of per-stage). A bug could let cost exceed the cap. | The `BuildLoopRunner` checks `run.spent_usd >= run.cap_usd` before EACH story dispatch (same pattern as `dispatchCycle()`). Each sandbox's token usage is extracted by `SandboxRunner.extractTokenUsage()` and added to `run.spent_usd` after each sandbox completes. Per 2-C2, a mid-loop cap hit returns `escalate` → `escalated` (terminal). Regression test: a run with a $0.01 cap escalates after the first sandbox (A4.6 `build-loop-cost-cap.test.ts` asserts `escalated`). |
| **`tests/integration/security.test.ts` (1-C1, 3-C1)** | The test suite iterates `graph.stages` calling `loadAgentSpec(stage.agent_spec)` (line 86) and reads `buildStage.agent_spec` directly (line 96). Removing `agent_spec` from the build stage breaks these assertions. The blanket `toContain("Write")` assertion (line 89) would fail for `validator.yaml` (Read+Bash only). | `security.test.ts` is updated in **A4.1** (XOR rule + optional `agent_spec` tolerance — the tool-allowlist loop loads `worker_spec`/`validator_spec` when present, falling back to `agent_spec`; a new assertion verifies the XOR rule) and **A4.4** (build-stage tool-allowlist assertions: worker has Read/Write/Edit/Bash, validator has Read+Bash and NO Write; `buildStage.agent_spec` repointed to `buildStage.worker_spec`; XOR-rule assertion verifies the build stage has no `agent_spec`). At end of A4.1 the build stage still has `agent_spec` (the flip is in A4.4), so the build-stage tool-allowlist assertions still load `buildStage.agent_spec` unchanged. Regression test: updated `security.test.ts` passes at both A4.1 and A4.4. |
| **Delete-run during an inner loop (INV-6) (1-C8)** | Today, force-deleting an active run removes the run dir + workspace + work_items. Post-change, a build-stage run can have a serial succession of containers running against that workspace; deletion mid-loop orphans the running containers (workspace deleted underneath them) and `BuildLoopRunner` keeps writing `build-state.json` into a deleted directory. | The delete-run API (`DELETE /api/runs/[id]`) checks `build-state.json` for containers with `status: "running"`; if any exist, the API returns HTTP 409 `{error: "build loop has running containers"}` unless `?force=1`. On `?force=1`, the API tears down running containers via their deterministic names (`docker rm -f realcode-<run_id>-<story_id>-<role>-<attempt>`) before removing the workspace. Regression test: a force-delete during a build loop tears down containers (test with a mock container registry). |
| **Control-doc responsiveness (1-C8, 2-C2)** | `dispatchCycle()` re-reads the control doc each cycle, but the inner loop runs inside one cycle — a user pause/step request is ignored for the entire multi-story loop. | `BuildLoopRunner.run()` re-reads `engine.getControlDoc()` between stories (see §4.2); if `run_mode` is `paused`/`paused_cost_cap`, the loop exits, leaves remaining stories `pending`, writes `build-state.json` with `paused: true`, and returns `{ output_status: "escalate", gate_notes: "paused by operator mid-build-loop" }` → dispatcher transitions `specified → escalated` (terminal — `stage-graph.yaml: { from: specified, on: escalate, to: escalated }`; `claim()` safety net at `sqlite-queue.ts:44` filters out `escalated`, so the item is never re-claimed). **Pause mid-loop = terminal escalation** (resumable suspension is post-MVP — `PARKING_LOT.md`). Regression test: a pause request issued mid-loop causes the run to transition to `escalated` (not "exits cleanly" into an undefined state) — A4.6/§10 assert `escalated`. |
| **Exported JSON schemas (1-C8)** | `schemas/build.schema.json` + `schemas/spec.schema.json` are committed artifacts generated by `scripts/export-schemas.ts`; §4.4/§4.5 extend the zod sources, but no story regenerates the exports (and the export script is not wired into `package.json` scripts). | A4.1 wires an `export-schemas` npm script into `package.json` and regenerates `schemas/build.schema.json` + `schemas/spec.schema.json`. Regression test: `npm run export-schemas` produces no diff when run on a clean checkout (the committed exports match the zod sources). |
| **Lease/double-dispatch race (1-C9, 2-C3)** | The lease default is 10 min (`sqlite-queue.ts:6`); a 17-story loop runs far longer. On expiry, `expire_leases()` clears `worker_id`/`lease_expires_at` and increments `retry_count`; the work_item's status stays `specified` (eligible) → the next `dispatchCycle` re-claims it and starts a second `BuildLoopRunner` (double spend, duplicate containers). The 2-C3 fix: one story can run 2 × `stage.timeout_ms` (Worker 20 min + Validator 20 min = 40 min); heartbeating only before the Worker (lease = 20 min) expires the lease mid-Validator. | `BuildLoopRunner.run()` calls `queue.heartbeat(item.id, stage.timeout_ms)` before **BOTH the Worker and Validator dispatches** (§4.13 — two heartbeats per story, not one), keeping the lease fresh across the full story cycle. Each heartbeat extends the lease by `stage.timeout_ms` (20 min); each sandbox takes at most `stage.timeout_ms` (20 min); so the lease never expires mid-story. If the runner dies during a sandbox, the lease expires within 20 min (tighter than a `2 × stage.timeout_ms` lease). The `Queue` interface + `SQLiteQueue` gain a real `heartbeat()` method (not the no-op `annotate()`). Regression test: `tests/engine/lease-heartbeat.test.ts` uses **fake timers** — a 3-story build where each Worker and Validator sandbox runs a full `stage.timeout_ms` (20 min each, 40 min per story, 120 min total); asserts `expire_leases()` is called between stories but **never clears the lease mid-story** (the heartbeat refreshed it before each sandbox); the build completes without a second dispatch of the same work_item. |
| Dashboard run-detail page | The new Build Stage Detail section replaces the build stage's artifact JSON viewer. Existing artifact viewing must still work. | The artifact JSON is accessible via a "View raw artifact" toggle. The new section is conditional (shown only when build stage is active/complete). Non-build runs are unaffected. Regression test: run-detail page still renders for a run that hasn't reached build. |
| Sandbox image (`realcode-sandbox:latest`) | Currently nonexistent (no Dockerfile.sandbox). Creating it changes the Docker build. | New `Dockerfile.sandbox` is additive (new file). The engine's `Dockerfile` is unchanged. `docker-compose.yml` gains a `sandbox` build target (§4.12). |
| `MISSION_CONTROL_ROOT` hardcoded path | The current docker-compose.yml hardcodes `/home/royce/mission-control:/mission-control:ro`. Replacing with `${REALCODE_HOST_MISSION_CONTROL_ROOT}:/mission-control:ro` changes the mount source. | The env var `REALCODE_HOST_MISSION_CONTROL_ROOT` defaults to `/home/royce/mission-control` (backward-compatible). The same-path mount (`${REALCODE_HOST_MISSION_CONTROL_ROOT}:${REALCODE_HOST_MISSION_CONTROL_ROOT}:ro`) is added for sandbox MCP server path resolution. The `/mission-control` mount is kept for the engine's own use (`seedWorkspaceFromProject`). |

**Migrations:** none — no database schema changes. The SQLite `work_items` table is unchanged (the build stage's work_item stays in `specified` status). `build-state.json` and container log files are new runtime artifacts (not migrations); they're ignored on revert (the engine simply doesn't write them). The `Queue` interface gains a `heartbeat()` method (a code change, not a DB migration — the `work_items` table already has `lease_expires_at`).

---

## 9. Story Breakdown

Stories in agentic-harness Phase 4 build order: Contracts → Engine → Sandbox → Per-stage agents → Dashboard → Integration tests.

### Story A4.1 — Contracts: per-story schemas + stage-graph extensions + ADR-009 + schema export

**As a** realcode engine **I want** structured per-story schemas and stage-graph worker/validator spec fields **so that** the build inner loop can parse stories, dispatch Worker/Validator sandboxes, and validate their outputs.

**Acceptance criteria:**
- [ ] `src/schemas/worker.ts` exports `WorkerOutput` (zod schema) with `WorkerArtifact` ({ story_id, result, failure_type?, failure_description?, branch, commits[], test_output, test_passed, test_failed, notes }) + `WorkerOutput` (StageOutputBase extended with `stage: "build_worker"`, `status: success|failed|escalated`)
- [ ] `src/schemas/validator.ts` exports `ValidatorOutput` with `ValidatorArtifact` ({ story_id, verdict, escalation_type?, criteria_results[], security_checklist[], notes }) + `ValidatorOutput` (StageOutputBase extended with `stage: "build_validator"`, `status: pass|fail|escalate`)
- [ ] `src/schemas/spec.ts` `SpecArtifact` gains **required** `stories: z.array(StorySpec).min(1)` where `StorySpec = { id, title, epic?, acceptance_criteria[], depends_on[] }`, with a `.refine()` enforcing `story_count === stories.length`
- [ ] `src/schemas/build.ts` `BuildArtifact` gains optional `stories: z.array(StoryBuildResult).optional()` where `StoryBuildResult = { story_id, status, retry_count, worker_tokens, validator_tokens, worker_cost_usd, validator_cost_usd, test_passed, test_failed }`
- [ ] `src/schemas/index.ts` exports the new schemas
- [ ] `src/engine/stage-graph.ts` `StageEntry` zod schema: `agent_spec` becomes `z.string().min(1).optional()`; adds `worker_spec: z.string().optional()` + `validator_spec: z.string().optional()`
- [ ] `validateGraph()` in `stage-graph.ts` enforces the XOR rule: exactly one of `agent_spec` OR (`inner_loop` + `worker_spec` + `validator_spec`); all referenced paths must resolve (replaces the unconditional `agent_spec` check at line 111). **The XOR rule's `fs.existsSync` enforcement for `worker_spec`/`validator_spec` paths is INERT at A4.1** — no stage has `inner_loop` set yet (the build stage still has `agent_spec`); the build-stage flip to `inner_loop`+`worker_spec`+`validator_spec` is owned by A4.4. The `stage-graph.yaml` build-stage edit is NOT made in A4.1 (3-C1: moving it here would make the graph unloadable until A4.4 creates the spec files).
- [ ] **ADR-009 is written in `docs/DECISIONS.md`** (§4.14): records the engine-orchestrated build inner loop, supersedes ADR-001's spike-refinement mechanism, notes the planning-doc ADR-007 deviation (implementation failure escalates immediately), references issue #4. ADR-001's entry gains a "Spike refinement superseded by ADR-009" note.
- [ ] **`package.json` gains an `export-schemas` npm script** (`"export-schemas": "tsx scripts/export-schemas.ts"`); `schemas/build.schema.json` + `schemas/spec.schema.json` are regenerated and committed
- [ ] `tests/integration/security.test.ts` is updated for the optional `agent_spec` + XOR rule (A4.1 scope only — 3-C1): the tool-allowlist loop tolerates stages with no `agent_spec` (loads `worker_spec`/`validator_spec` when present, falling back to `agent_spec` otherwise); a new assertion verifies the XOR rule (a stage must have exactly one of `agent_spec` OR (`inner_loop`+`worker_spec`+`validator_spec`)). **The build stage STILL has `agent_spec` at A4.1** (the build-stage flip is in A4.4), so the build-stage tool-allowlist assertions still load `buildStage.agent_spec` unchanged at A4.1. The build-stage tool-allowlist assertions for `worker_spec`/`validator_spec` (worker has Read/Write/Edit/Bash; validator has Read+Bash and NO Write) are added in A4.4.
- [ ] Round-trip validation test: each new schema parses a valid sample and rejects an invalid one (test file: `tests/schemas/build-loop-schemas.test.ts`)
- [ ] **Engine constructor gains optional 6th param `buildLoopRunner?: StageRunner`** (2-C1a) — just the param addition (backward-compatible: existing 5-arg calls typecheck unchanged). The dispatcher's missing-runner guard is added at A4.1: when `stage.inner_loop` is set but `this.buildLoopRunner` is undefined, `dispatchCycle()` throws `new Error("Stage '<id>' has inner_loop but no BuildLoopRunner configured")` — caught by the existing try/catch → run escalates with a clear `gate_notes` (never crashes with `TypeError`). The call sites that PASS a `BuildLoopRunner` (`src/engine-loop.ts:27`, `src/cli/index.ts:34`) are updated in A4.2 (after the `BuildLoopRunner` class exists). `tests/integration/security.test.ts:166/187` stay 5-arg permanently (these tests never reach the build stage). `tsc --noEmit` passes (no type errors at any call site).
- [ ] **Dispatcher's missing-runner guard:** when `stage.inner_loop` is set but `this.buildLoopRunner` is undefined, `dispatchCycle()` throws `new Error("Stage '<id>' has inner_loop but no BuildLoopRunner configured")` — caught by the existing try/catch → run escalates with a clear `gate_notes` (never crashes with `TypeError`)
- [ ] **All existing suites pass at A4.1 (3-C1):** the graph is unchanged — the build stage still has `agent_spec`; the XOR rule is inert (no stage has `inner_loop` yet); the Engine constructor's optional 6th param is backward-compatible (5-arg call sites typecheck unchanged); the dispatcher's missing-runner guard is unreachable (no `inner_loop` stage exists). The e2e stays green until A4.4 (when the build stage is flipped to `inner_loop`+`worker_spec`+`validator_spec`). Non-build stages are unaffected (all new fields on non-build schemas are optional; `agent_spec` is still present on non-build stages). `tsc --noEmit` passes (no type errors at any call site).

**Experience Script:** Request-type. `POST /api/runs` with a trivial idea. The run progresses through frame→spec→build→ship (the build stage still dispatches the old single sandbox at A4.1 — the graph is unchanged). The spec artifact (spec.json) now contains a required `stories` array. The build stage's stage-graph entry STILL has `agent_spec: agent-specs/build.yaml` at A4.1 (the flip to `worker_spec`+`validator_spec` is in A4.4; the XOR rule is inert). `npm run export-schemas` produces no diff. ADR-009 is in `DECISIONS.md`. (Full multi-container build-loop execution is exercised in A4.6.)

### Story A4.2 — Engine: build inner loop orchestration

**As a** realcode engine **I want** the BuildLoopRunner to orchestrate per-story Worker→Validator sandboxes serially **so that** non-trivial backlogs ship instead of escalating.

**Acceptance criteria:**
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

**Experience Script:** Request-type. A synthetic run with a 3-story spec artifact (mocked or real spec stage). The build stage dispatches 3 Worker→Validator pairs serially. `build-state.json` shows story progression. `build.json` is written with all 3 stories done.

### Story A4.3 — Sandbox: opencode environment inheritance + container lifecycle + security

**As a** realcode operator **I want** each sandbox container to inherit my full opencode environment (config, skills, MCP servers) via a configurable mount **so that** working from the dashboard is indistinguishable from working in an opencode session at my machine.

**Acceptance criteria:**
- [ ] New env vars `REALCODE_OPENCODE_CONFIG_DIR` (container-local path, e.g. `/root/.config/opencode`) + `REALCODE_HOST_OPENCODE_CONFIG_DIR` (host path, e.g. `/home/royce/.config/opencode`) + `REALCODE_HOST_MISSION_CONTROL_ROOT` (host path, e.g. `/home/royce/mission-control`). The engine warns at startup if the host-path vars are unset in Docker mode.
- [ ] `src/sandbox/runner.ts` `runDocker()` mounts `${REALCODE_HOST_OPENCODE_CONFIG_DIR}:/root/.config/opencode:ro` (host path → container path)
- [ ] `src/sandbox/runner.ts` `runDocker()` mounts `${REALCODE_HOST_MISSION_CONTROL_ROOT}:${REALCODE_HOST_MISSION_CONTROL_ROOT}:ro` (same host path mount so MCP server paths under it resolve)
- [ ] `src/sandbox/runner.ts` sets `HOME=/root` + `XDG_CONFIG_HOME=/root/.config` in the container env
- [ ] New helper `discoverMcpPaths(configDir: string): string[]` reads `opencode.json` from the config dir, parses the `mcp` section, returns each server's `command` binary/script path. (file: `src/sandbox/mcp-discovery.ts`)
- [ ] `runDocker()` mounts each discovered MCP server path read-only at the SAME host path inside the container
- [ ] Container naming: each sandbox gets `--name realcode-<run_id>-<story_id>-<role>-<attempt>` (sanitized: dots replaced with dashes)
- [ ] Container ID capture: `--cidfile <tmpfile>` is passed; the `SandboxResult` gains `containerId: string`
- [ ] Container log persistence: the caller (BuildLoopRunner) writes `SandboxResult.stdout` + `stderr` to `data/runs/<run_id>/containers/<story_id>-<role>-<attempt>.log`; the path is recorded in `build-state.json`'s `containers[].log_path`
- [ ] **Security: startup secret-scan** — new `src/sandbox/secret-scan.ts` exports `scanForSecrets(dir: string): { file: string; pattern: string }[]`. The engine calls it before each sandbox spawn on the mounted config dir; on a match, refuses to spawn + logs a loud warning (file + pattern name, not the value).
- [ ] **Security: read-only mount** — the opencode config mount is `:ro` (asserted in `security.test.ts`)
- [ ] New `Dockerfile.sandbox` builds `realcode-sandbox:latest`: node:20-slim + git + opencode (global npm install) + docker.io. `ENV HOME=/root`. `WORKDIR /workspace`.
- [ ] `docker-compose.yml` updates: engine env gains `REALCODE_HOST_MISSION_CONTROL_ROOT` + `REALCODE_HOST_OPENCODE_CONFIG_DIR` + `REALCODE_OPENCODE_CONFIG_DIR`; the hardcoded `/home/royce/mission-control:/mission-control:ro` is replaced with `${REALCODE_HOST_MISSION_CONTROL_ROOT:-...}:/mission-control:ro`; the engine volume `${REALCODE_HOST_OPENCODE_CONFIG_DIR:-...}:/root/.config/opencode:ro` is added; a `sandbox` service with `build: { dockerfile: Dockerfile.sandbox }` is added (under a `build-only` profile). `REALCODE_OPERATOR_HOME` is NOT introduced (deleted from round 1).
- [ ] The opencode plugin (anymake) is available inside the sandbox: when `opencode run` starts, it reads the mounted `opencode.json`, finds `plugin: ["anymake@git+...", "realmemory@git+..."]`, and fetches them (network egress to npm + GitHub required). The sandbox's `--network realcode-sandbox-net` allows this.
- [ ] Test: `scanForSecrets` fires on a seeded key-containing fixture (e.g. a file with `sk-test1234567890abcdef`) and returns a match; on a clean fixture returns empty. (test file: `tests/sandbox/secret-scan.test.ts`)
- [ ] Test: `discoverMcpPaths` on a sample `opencode.json` returns the expected command paths. (test file: `tests/sandbox/mcp-discovery.test.ts`)

**Experience Script:** Run-type. `docker compose build sandbox` builds the sandbox image. Start a run. When the build stage dispatches a Worker sandbox, `docker ps` shows a container named `realcode-<run_id>-<story_id>-worker-0`. The container has the opencode config mounted (read-only). The Worker agent has access to anymake skills + MCP servers (codebase-memory-mcp, realmemory). The startup secret-scan runs before the spawn.

### Story A4.4 — Agent specs: worker.yaml + validator.yaml

**As a** BuildLoopRunner **I want** self-contained Worker and Validator agent specs **so that** each per-story sandbox knows exactly what to do.

**Acceptance criteria:**
- [ ] `agent-specs/worker.yaml` exists and is valid per `AgentSpecSchema` (zod parse passes)
- [ ] `worker.yaml` system_prompt is self-contained (INV-7): all instructions inlined, no external file refs, context-discipline guards (no node_modules/data/.git/dist/.next/coverage traversal, no anymake doc reads)
- [ ] `worker.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{workspace}`, `{plan.prd_md}`, `{frame.project_type}` — all resolvable by `AgentStageRunner.fillTemplate()` + `gatherPriorArtifacts()` + `extraContext`
- [ ] `worker.yaml` tool_allowlist: Read, Write, Edit, Bash. model_tier: 3. permission_mode: unattended.
- [ ] `worker.yaml` output contract: emits `<artifact>` JSON matching `WorkerOutput` schema; `gate_verdict` is `pass` (success), `needs_changes` (environment failure), or `escalate` (implementation failure / cannot proceed) — per the §4.2 mapping table
- [ ] `agent-specs/validator.yaml` exists and is valid per `AgentSpecSchema`
- [ ] `validator.yaml` system_prompt is self-contained (INV-7): inlined instructions, no code editing, verdict decision tree, security checklist
- [ ] `validator.yaml` user_prompt_template uses `{story_id}`, `{story_title}`, `{acceptance_criteria}`, `{worker_output}`, `{workspace}`
- [ ] `validator.yaml` tool_allowlist: Read, Bash (NO Write). model_tier: 2. permission_mode: unattended.
- [ ] `validator.yaml` output contract: emits `<artifact>` JSON matching `ValidatorOutput` schema; `gate_verdict` is `pass` (sandbox ran, read `artifact.verdict` for result) or `escalate` (sandbox crash / verdict=escalate) — per the §4.2 mapping table
- [ ] The old `agent-specs/build.yaml` is kept (for backward compat) but no longer referenced by `stage-graph.yaml`
- [ ] **`stage-graph.yaml` build-stage edit is owned by A4.4 (3-C1):** the build stage entry removes `agent_spec: agent-specs/build.yaml` and adds `inner_loop: anymake-build-loop` (already present — now acted on), `worker_spec: agent-specs/worker.yaml`, `validator_spec: agent-specs/validator.yaml`. At end of A4.4 the `validateGraph()` XOR rule (added in A4.1, inert until now) becomes active — the build stage now satisfies the `inner_loop`+`worker_spec`+`validator_spec` branch, and the spec files created above pass the `fs.existsSync` enforcement.
- [ ] **`tests/integration/security.test.ts` build-stage assertions are owned by A4.4 (3-C1):** the tool-allowlist loop now loads `worker_spec`/`validator_spec` for the build stage (asserting worker has Read/Write/Edit/Bash, validator has Read+Bash and NO Write); the `buildStage.agent_spec` assertion is repointed to `buildStage.worker_spec`; the XOR-rule assertion now verifies the build stage has no `agent_spec` and has `inner_loop`+`worker_spec`+`validator_spec`. (The XOR-rule scaffolding + optional-`agent_spec` tolerance was added in A4.1; A4.4 flips the build stage and tightens its assertions.)
- [ ] **At end of A4.4 the existing e2e goes red (acknowledged, fixed in A4.6):** the build stage is now flipped, so the e2e's 5-arg `Engine` (no `BuildLoopRunner`), canned spec artifact (no `stories` array), and `Stage:`-keyed mock sandbox all break the build-stage path. These three breakages are fixed in A4.6 (2-C1b/2-C1c). Non-build stages and all non-e2e suites stay green at A4.4.
- [ ] `AgentStageRunner.run()` with `{ specOverride: "agent-specs/worker.yaml", schemaKey: "build_worker", extraContext: {...} }` loads the worker spec, fills the template (resolving `{story_id}` etc. from `extraContext`), dispatches the sandbox, extracts the `<artifact>` block, validates against `WorkerOutput` schema (via `schemaKey`). The `STAGE_SCHEMAS` map gains `build_worker: WorkerOutput` + `build_validator: ValidatorOutput`.
- [ ] Test: `loadAgentSpec("agent-specs/worker.yaml")` parses successfully; `loadAgentSpec("agent-specs/validator.yaml")` parses successfully. (test file: `tests/agent-specs/worker-validator-specs.test.ts`)

**Experience Script:** Request-type. `loadAgentSpec` on both specs succeeds. A Worker sandbox dispatch (via `AgentStageRunner.run()` with `specOverride`/`schemaKey`/`extraContext`) produces a valid `WorkerOutput` artifact. A Validator sandbox dispatch produces a valid `ValidatorOutput` artifact.

### Story A4.5 — Dashboard: mission-control visibility

**As a** realcode operator **I want** the run-detail page to show per-story progress, per-container status, turn-level trace events from Phoenix, and container logs **so that** I have mission-control visibility into the multi-container build loop.

**Acceptance criteria:**
- [ ] `GET /api/runs/[id]/stories` returns the stories array from `build-state.json` (or 404 if absent)
- [ ] `GET /api/runs/[id]/containers` returns the containers array from `build-state.json` + lists log files. Each container: id, name, story_id, role, status, started_at, exited_at, log_path.
- [ ] `GET /api/runs/[id]/containers/[cid]/logs` resolves `[cid]` through `build-state.json`'s `containers[]` (matching `container_id` or `name`), reads the `log_path` field, returns the raw log text. Supports `?tail=N`.
- [ ] `GET /api/runs/[id]/stream` is an SSE endpoint: sets `Content-Type: text/event-stream`, polls Phoenix GraphQL every 2s for spans with `realcode.run_id == <id>`, emits new spans as SSE `data:` events (including synthesized turn/tool spans with `realcode.agent_message` + `realcode.tool`). Also polls `build-state.json` and emits story_update events. Closes on terminal state.
- [ ] `src/dashboard/lib/engine.ts` `getRunDetail()` reads `build-state.json` if present and includes `build_state` in the `RunDetailResponse`
- [ ] `src/dashboard/components/StoryProgress.tsx`: vertical list of stories with status badges, retry count, duration. Polls `/api/runs/[id]/stories` every 2s when build stage is active.
- [ ] `src/dashboard/components/ContainerGrid.tsx`: grid of container cards. Clicking a card selects it for the ContainerLogViewer. Polls `/api/runs/[id]/containers` every 2s.
- [ ] `src/dashboard/components/LiveTraceStream.tsx`: SSE-fed real-time timeline. Renders spans as they arrive: span name, role (from `realcode.role`), tool calls (from `realcode.tool`), tokens, cost, agent message (from `realcode.agent_message`). Reuses TraceTimeline's visual pattern. Auto-scrolls; pauses on scroll-up.
- [ ] `src/dashboard/components/ContainerLogViewer.tsx`: terminal-style `<pre>` on `bg-ink-950` (or `bg-[#0a0b12]`), mono font, auto-scroll, "tail 100 / full" toggle. Fetches `/api/runs/[id]/containers/[cid]/logs?tail=100`.
- [ ] `src/dashboard/app/runs/[id]/page.tsx` shows a "Build Stage Detail" section (conditional: when `stages.build === "running"` or `artifacts.build` present) containing StoryProgress + ContainerGrid + LiveTraceStream + ContainerLogViewer. Raw build artifact JSON via "View raw artifact" toggle.
- [ ] **All new components compose `Card`/`Badge`/`StatusDot` primitives and use `ink-*`/`status-*`/`brand-*` tokens — no raw `slate-*` classes** (verified against `tailwind.config.js` palette)
- [ ] `docs/02-planning/ux-design.md` Component Inventory gains entries for `StoryProgress`, `ContainerGrid`, `LiveTraceStream`, `ContainerLogViewer` (documentation update — additive)
- [ ] The run-detail page still renders correctly for runs that haven't reached the build stage (no Build Stage Detail section shown)
- [ ] **Delete-run during a build loop:** the delete-run API checks `build-state.json` for running containers; returns 409 if any exist unless `?force=1`; on `?force=1`, tears down containers via deterministic names before removing the workspace. The detail-page delete modal warns if the run is in an active build loop.

**Experience Script:** Browser-type. Navigate to `/runs/<id>` for a run in the build stage. See: header card with StageStepper (build stage pulsing amber). Per-stage cards for frame/discover/plan/spec (green). Build Stage Detail section: StoryProgress shows story 3.1 (building, amber pulse), 3.2 (pending), 3.3 (pending). ContainerGrid shows `realcode-<id>-3-1-worker-0` (running). LiveTraceStream shows turn-level agent messages + tool calls (synthesized from sandbox JSON events, arriving per-completed-sandbox — not mid-execution; the truly-live stream is ContainerLogViewer). Click a container → ContainerLogViewer shows raw stdout/stderr. After story 3.1 completes, StoryProgress updates: 3.1 (done, green), 3.2 (building, amber pulse). The SSE stream shows new spans arriving live.

### Story A4.6 — Integration test + config: end-to-end build inner loop

**As a** realcode developer **I want** an end-to-end integration test of the build inner loop + final config **so that** I can verify the multi-container orchestration works and ships non-trivial work.

**Acceptance criteria:**
- [ ] `docker-compose.yml` is updated with all new env vars, same-path `MISSION_CONTROL_ROOT` mount, sandbox image build target (§4.12)
- [ ] `Dockerfile.sandbox` builds successfully (`docker compose build sandbox`)
- [ ] Integration test (`tests/integration/build-loop-e2e.test.ts`): creates a run with a mocked 3-story spec artifact (bypasses frame→spec stages), runs `BuildLoopRunner.run()` against the real sandbox (Docker mode), asserts:
  - 3 Worker containers spawned (names: `realcode-<run_id>-<story_id>-worker-0`)
  - 3 Validator containers spawned
  - `build-state.json` shows all 3 stories `done`, `containers[]` entries have `log_path`
  - `build.json` artifact has `status: "built"`, `stories` array with 3 entries, aggregated `test_results`
  - Container log files exist at the `log_path` recorded in `build-state.json`
  - Per-story turn/tool-call OTel spans in Phoenix (queryable by `realcode.run_id`, carrying `realcode.story_id` + `realcode.agent_message` + `realcode.tool`)
  - `run.spent_usd` equals the sum of all sandbox costs
  - Lease heartbeat was called (no double-dispatch of the work_item)
- [ ] Integration test: a run with a 2-story spec where story 2 depends on story 1 — story 2 does not start until story 1 is `done`
- [ ] Integration test: a run where a story's Worker fails (returns `failed/implementation`) — the story is escalated immediately, `build.json` has `status: "escalated"`
- [ ] Integration test: a run where a story's Worker hits an environment failure (returns `failed/environment`) — the story is retried (max 3), then escalated if still failing
- [ ] Integration test: a run with a $0.01 cost cap — the build hits the cap mid-loop before story 2 (after story 1 completes and `spent_usd` exceeds the cap); the `BuildLoopRunner` returns `escalate("cost cap hit mid-loop (1/N stories done)")` → run transitions to `escalated` (terminal per 2-C2; NOT `paused_cost_cap` — that status is only for before-dispatch cap hits caught by the dispatcher's top-of-cycle check)
- [ ] Integration test: a build loop that exceeds the old 10-min lease default completes without a second dispatch of the same work_item (lease heartbeat before BOTH Worker and Validator works)
- [ ] Integration test: the control-doc pause between stories works — a pause request issued mid-loop causes the loop to exit and the run to transition to `escalated` (terminal per 2-C2 — NOT "exits cleanly" into an undefined state); `build-state.json` shows `paused: true` with remaining stories `pending`
- [ ] Integration test: force-delete of a run with running build-loop containers tears down the containers (via deterministic names) before removing the workspace
- [ ] **The existing e2e test (`tests/integration/e2e.test.ts`) is updated and passes (2-C1b/2-C1c):** (a) the canned `STAGE_ARTIFACTS.spec` artifact (lines 58-69) gains a valid `stories` array (8 `StorySpec` entries matching the backlog_md, satisfying the `.refine()`); (b) `STAGE_ARTIFACTS` gains `build_worker` (canned `WorkerOutput`: `result: "success"`, `gate_verdict: "pass"`) and `build_validator` (canned `ValidatorOutput`: `verdict: "pass"`, `gate_verdict: "pass"`); (c) `makeMockSandbox` (lines 100-131) keys on `Role:\s*(\w+)` (falling back to `Stage:\s*(\w+)` for non-build stages) to return the appropriate canned artifact; (d) the `Engine` construction (line 151) gains a real `BuildLoopRunner` wrapping the mock-sandbox `AgentStageRunner` (6-arg constructor); (e) the "sandbox called 6 times" test (lines 240-261) is updated: call count increases (5 non-build (frame/discover/plan/spec/ship) + 8 stories × 2 (worker+validator) = 21 total), stage/role sequence includes `build_worker`/`build_validator` pairs. The `stageSequence` assertion (lines 177-184) stays the same (framed→discovered→planned→specified→built→shipped — the `BuildLoopRunner` returns `output_status: "pass"` when all 8 stories done).
- [ ] `npm run export-schemas` produces no diff on a clean checkout (committed schemas match zod sources)
- [ ] Manual smoke test: start a real run with a non-trivial idea (e.g. "Build a todo CLI with add/list/done commands"), watch the dashboard show per-story progress + live trace + container logs, verify the run ships with zero human edits

**Experience Script:** Mixed (Request + Browser). `POST /api/runs` with idea "Build a todo CLI with add/list/done commands" (or a `[target: <project>]` tag). Navigate to `/runs/<id>`. Watch the run progress through frame→spec. When the build stage starts, the dashboard shows per-story progress, container status, live trace, and container logs. Each story goes Worker→Validator→done. All stories complete → build passes → ship stage → run ships. The end result is a working todo CLI in the workspace, shipped with zero human edits.

---

## 10. Test & Verification Plan

- **Automated:**
  - `tests/schemas/build-loop-schemas.test.ts` — round-trip validation for WorkerOutput, ValidatorOutput, SpecArtifact.stories (required + refine), BuildArtifact.stories, StageEntry XOR rule (Story A4.1)
  - `tests/agent-specs/worker-validator-specs.test.ts` — loadAgentSpec parses worker.yaml + validator.yaml (Story A4.4)
  - `tests/sandbox/secret-scan.test.ts` — `scanForSecrets` fires on a seeded key-containing fixture; returns empty on clean fixture (Story A4.3)
  - `tests/sandbox/mcp-discovery.test.ts` — `discoverMcpPaths` on a sample `opencode.json` returns expected paths (Story A4.3)
  - `tests/engine/build-loop.test.ts` — BuildLoopRunner with mock AgentStageRunner: 3 stories serial, dependency ordering, retry on environment fail, immediate escalate on implementation fail, cost aggregation, escalation paths, pause control-doc honored (returns escalate → `escalated`, 2-C2), lease heartbeat called before BOTH Worker and Validator (2-C3), wall-clock bound enforced (Story A4.2)
  - `tests/engine/lease-heartbeat.test.ts` — **fake timers (2-C3):** a 3-story build where each Worker and Validator sandbox runs a full `stage.timeout_ms` (20 min each, 40 min per story, 120 min total); asserts `expire_leases()` is called between stories but **never clears the lease mid-story** (the heartbeat before each sandbox refreshed it); the build completes without a second dispatch of the same work_item. This catches the double-dispatch race that instant-mock tests miss. (Story A4.2/A4.6)
  - `tests/integration/security.test.ts` — UPDATED: tool-allowlist loop loads `worker_spec`/`validator_spec` for inner-loop stages; `buildStage.agent_spec` assertion repointed to `worker_spec`; XOR rule asserted; opencode-config mount is `:ro`; startup secret-scan fires on seeded fixture (Story A4.1 — XOR rule + optional `agent_spec` tolerance; Story A4.4 — build-stage tool-allowlist assertions for worker/validator specs; Story A4.3 — mount-ro + secret-scan)
  - `tests/integration/build-loop-e2e.test.ts` — real sandbox dispatch: 3-story build loop, container naming, log persistence at `log_path`, Phoenix spans with `realcode.story_id`+`agent_message`+`tool`, cost aggregation, lease heartbeat before both Worker and Validator (Story A4.6)
  - `tests/integration/build-loop-dependency.test.ts` — story 2 waits for story 1 (Story A4.6)
  - `tests/integration/build-loop-escalation.test.ts` — worker implementation failure → immediate escalation; environment failure → retry then escalate (Story A4.6)
  - `tests/integration/build-loop-cost-cap.test.ts` — $0.01 cap hit mid-loop → `BuildLoopRunner` returns escalate → run transitions to `escalated` (terminal per 2-C2; NOT `paused_cost_cap`) (Story A4.6)
  - `tests/integration/build-loop-control-doc.test.ts` — pause between stories: run transitions to `escalated` (terminal per 2-C2); `build-state.json` shows `paused: true` + remaining stories `pending` (Story A4.6)
  - `tests/integration/delete-run-mid-loop.test.ts` — force-delete with running containers tears them down (Story A4.5/A4.6)
  - `tests/integration/export-schemas-freshness.test.ts` — `npm run export-schemas` produces no diff (Story A4.1/A4.6)
  - Existing e2e test (frame→ship) — **updated in A4.6** (2-C1b/2-C1c: spec artifact gains `stories`; mock sandbox distinguishes worker/validator via `Role:` marker; Engine gains `BuildLoopRunner`); regression, non-build stages unaffected (all stories)
- **Experience:** The §9 Experience Scripts — the Experience Runner drives a real run through the build inner loop and verifies the dashboard shows per-story progress, container status, live trace, and container logs. Must return PASS before the issue closes.
- **Regression:** The existing frame→ship e2e test (updated in A4.6 — spec artifact gains `stories`, mock sandbox gains worker/validator dispatch via `Role:` marker, Engine gains `BuildLoopRunner`) protects the non-build stages AND the full build loop. The spec schema round-trip test protects the required `stories` field. The run-detail page regression test protects the existing UI. The updated `security.test.ts` protects the tool-allowlist + mount-ro + secret-scan surface. `tsc --noEmit` protects the Engine constructor call sites (5 named in §8).
- **Manual:** The reporter (Royce) confirms by starting a real run with a non-trivial prompt and watching the dashboard show the multi-container build loop. The success criterion: the run ships with zero human edits. **This plan is security-relevant (§4.6.1) — final approval is the real user's (Royce) in every mode, per the arbiter's security rule.** The Product Owner Proxy cannot approve this plan.

---

## 11. Rollback Plan

- **Branch:** `issue/4-multi-container-build-loop` — all commits reference `#4`
- **Merge:** single merge (or squash) commit per PR; SHA recorded in the issue Tracking table
- **Revert:** `git revert -m 1 [merge SHA]` (or `git revert [squash SHA]`)
- **Migrations:** none — no database schema changes. `build-state.json` and container log files are runtime artifacts (not migrations); they're ignored on revert (the engine simply doesn't write them). The `stage-graph.yaml` change (adding `worker_spec`/`validator_spec`, removing `agent_spec`) is reverted with the branch — the build stage goes back to `agent_spec: agent-specs/build.yaml` (the old single-sandbox path). The old `build.yaml` is kept in the repo (not deleted in this change), so the revert path is clean. The `Queue.heartbeat()` method addition is reverted with the branch (no DB column change — `lease_expires_at` already exists).
- **ADR-009:** Reverting the code does NOT revert ADR-009 — ADRs are immutable once accepted. A revert would be recorded as a new ADR (ADR-010: "Revert engine-orchestrated build inner loop") superseding ADR-009, with ADR-001's spike-refinement mechanism restored as the documented approach (and the known infeasibility re-noted). For MVP, the revert path is: revert the code, leave ADR-009 as a historical record, open a new issue for the next attempt.
- **Deploy rollback:** per `anymake-deploy` — previous release identifier. `docker compose down && docker compose up -d` with the previous image tag. The `realcode-sandbox:latest` image is rebuilt from the previous state (no `Dockerfile.sandbox` → the old image, if it existed externally, is used).
- **Security-relevant plan — real-user approval:** This plan is security-relevant (the opencode-config/MCP mount is a secret-handling and trust-boundary surface — §4.6.1). Per the arbiter's security rule, **final approval is the real user's (Royce) in every mode** — the Product Owner Proxy cannot approve this plan. The approval gate is the real user, not the proxy.

---

## 12. Review Log

Appended each round — never deleted. Review files live beside this plan.

| Round | Date | Reviewer verdict | Report | Resolution |
|-------|------|------------------|--------|------------|
| 1 | 2026-08-11 | NEEDS CHANGES | `docs/06-agile/issue-4/review-round-1.md` | All 12 comments addressed in this revision (round 2): **1-C1** fixed in §4.1 (agent_spec optional + XOR rule), §8 (security test suite blast radius), §10 (updated security tests), A4.1 (criteria). **1-C2** fixed in §4.2 (dispatchWorker/dispatchValidator with extraContext), §4.3 (full `run()` signature change with specOverride/schemaKey/extraContext), §4.8 (`{acceptance_criteria}` serialization), A4.2/A4.4 (criteria). **1-C3** fixed in §4.2 (mapping table + rewritten pseudocode branching on artifact fields), §4.8/§4.9 (gate_verdict values per mapping table), §4.14/ADR-009 (ADR-007 reconciliation note), A4.2 (criteria). **1-C4** fixed in §4.10 (engine-side synthesis from jsonEvents — chosen mechanism, fully specified), §4.11 (LiveTraceStream renders synthesized spans), §1 (scope note), A4.5/A4.6 (criteria). **1-C5** fixed in §4.6 (REALCODE_HOST_MISSION_CONTROL_ROOT + REALCODE_HOST_OPENCODE_CONFIG_DIR host-path vars), §4.12 (compose YAML), A4.3 (criteria); REALCODE_OPERATOR_HOME deleted. **1-C6** fixed in §4.6.1 (Security: trust boundary + startup secret-scan + read-only + subpath-mounting post-MVP), §6 (real-user approval note), §10 (security tests), §11 (real-user approval gate), A4.3 (criteria). **1-C7** fixed in §3 (freshness sentence re-mapped to DECISIONS.md IDs), §4.14 (ADR-009 written in scope), §6 (re-mapped citations + planning-doc ADR full-title references), A4.1 (ADR-009 criterion). **1-C8** fixed in §8 (4 missing items: security test suite, delete-run mid-loop INV-6, control-doc responsiveness, exported schemas), §4.2 (control-doc between stories), §4.1/A4.1 (export-schemas npm script), A4.5 (delete-run during build loop), §10 (tests). **1-C9** fixed in §4.13 (lease heartbeat via new Queue.heartbeat(), per-sandbox timeout = stage.timeout_ms, wall-clock bound, regression test), §8 (lease row), A4.2/A4.6 (criteria), §10 (lease-heartbeat test). **1-C10** fixed in §7 (Design DNA rewritten in ink-*/status-*/brand-* tokens), A4.5 (token criterion). **1-C11** fixed in §4.4 (stories required with .refine(), no fallback), A4.1/A4.2 (criteria). **1-C12** fixed in §4.7 (log_path in containers[] + endpoint resolution), §4.2 (Wait — passage resolved: BuildLoopRunner constructed once in engine-loop.ts wrapping AgentStageRunner), §4.12 (Wait — passage resolved + sandbox service added to compose YAML), A4.6 (criteria). |
| 2 | 2026-08-11 | NEEDS CHANGES | `docs/06-agile/issue-4/review-round-2.md` | All 12 round-1 comments verified FIXED. 3 new comments addressed in this revision (round 3): **2-C1** fixed in §4.2 (BuildLoopRunner parameter OPTIONAL 6th param on Engine constructor; dispatcher missing-runner guard — escalate with clear error, never crash; corrected path `src/engine-loop.ts` not `src/engine/engine-loop.ts`; `Role:` marker in dispatch message via `buildDispatchMessage`), §4.3 (4th mechanical change — Role marker), §8 (3 new rows: Engine constructor call sites, CLI entry point, existing e2e test — all 5 call sites named), A4.1 (constructor + guard criteria; e2e "still passes" reworded to "does not pass at A4.1, updated in A4.6"), A4.2 (role in extraContext, dispatcher branch, engine-loop path), A4.6 (e2e update: spec artifact stories, mock sandbox Role marker, BuildLoopRunner, sandbox-call-count assertion), §10 (e2e regression + tsc --noEmit). **2-C2** fixed in §4.2 (control-doc prose: terminal escalation — deleted "pending resume" language; pseudocode pause return reworded; cost-cap mid-loop also terminal), §8 (control-doc row: asserts `escalated`), A4.2 (criterion: returns escalate → `escalated`), A4.6 (criterion + §10 test assert `escalated` not "exits cleanly"), PARKING_LOT.md (resumable suspension deferred). **2-C3** fixed in §4.2 (pseudocode: heartbeat before BOTH Worker and Validator), §4.13 (lease text: two heartbeats per story, keeps lease fresh across 2×timeout story cycle; tighter than 2×lease alternative), §8 (lease row: fake-timer test), A4.2 (criterion: heartbeat before both), §10 (lease-heartbeat.test.ts: fake timers, Worker+Validator each full timeout, expire_leases never clears mid-story). |
| 3 | 2026-08-11 | NEEDS CHANGES (escalated to orchestrator) | `docs/06-agile/issue-4/review-round-3.md` | All 3 round-2 comments verified FIXED. 3 new comments (3-C1/3-C2/3-C3) escalated to the orchestrator per the arbiter's round limit; the orchestrator ruled on all 3. Fixes applied in this revision (round 3, adjudicated): **3-C1** (option b — A4.4 owns the graph flip): §4.1 sequencing note added (XOR rule inert at A4.1; build-stage yaml edit owned by A4.4); A4.1 stage-graph.yaml-edit criterion removed (moved to A4.4); A4.1 security.test.ts criterion rescoped to XOR-rule + optional-agent_spec tolerance only (build stage still has agent_spec at A4.1); A4.1 last criterion rewritten ("All existing suites pass at A4.1 — graph unchanged, XOR rule inert, e2e stays green until A4.4"); A4.1 Experience Script made runnable (build stage still dispatches old single sandbox); A4.4 criteria gained the stage-graph.yaml build-stage edit + security.test.ts build-stage tool-allowlist assertions + an acknowledged "e2e goes red at A4.4, fixed in A4.6" criterion; §8 security.test.ts row rewritten (updated in A4.1 + A4.4); §10 security.test.ts attribution updated (A4.1 XOR + A4.4 build-stage + A4.3 mount/secret-scan). **3-C2** (arithmetic 22 → 21): §8 e2e row + A4.6 criterion (e) corrected to "5 non-build (frame/discover/plan/spec/ship) + 8 stories × 2 (worker+validator) = 21 total". **3-C3** (option a — stamp `build_worker`/`build_validator`): §4.2 dispatchWorker (`role: "build_worker"`) + dispatchValidator (`role: "build_validator"`); §4.2 Role-marker paragraph + §4.3 change #4 note the values are `build_worker`/`build_validator` (direct match to canned artifact keys + STAGE_SCHEMAS keys, no normalization); §4.10 trace-attributes note `realcode.role` carries `build_worker`/`build_validator`; A4.2 dispatch criteria + Role-marker criterion updated. All 3 comments resolved per orchestrator rulings; plan advances to the approval gate. |
