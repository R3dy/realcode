# Task Brief — Story A4.1: Contracts: per-story schemas + stage-graph extensions + ADR-009 + schema export

**Created by:** Anymake Planner
**Created at:** 2026-08-11
**Project:** realcode
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## 1. Story Identity

**Story ID:** A4.1
**Story title:** Contracts: per-story schemas + stage-graph extensions + ADR-009 + schema export
**Epic:** Issue #4 — Build stage must orchestrate a multi-container anymake build loop
**Milestone:** Issue #4 build loop (Contracts layer — first of 6 stories: A4.1→A4.6)
**Priority:** Must Have (blocks A4.2–A4.6)
**This is PR #:** 1 (first PR for issue #4)

---

## 2. User Story

**As a** realcode engine
**I want** structured per-story schemas and stage-graph worker/validator spec fields
**So that** the build inner loop can parse stories, dispatch Worker/Validator sandboxes, and validate their outputs.

---

## 3. Acceptance Criteria

This is your contract. Every criterion must be satisfied before you write `result: success`. Copied verbatim from the approved Development Plan (`docs/06-agile/issue-4/plan.md` §9, Story A4.1).

**Positive paths:**
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

**Error paths:**
- [ ] Error: When `SpecArtifact` is parsed without a `stories` array (or with an empty one), validation fails (the `.refine()` also fails when `story_count !== stories.length`)
- [ ] Error: When `validateGraph()` encounters a stage with both `agent_spec` AND `inner_loop`, it pushes a validation error; when a stage has neither, it pushes a validation error; when `inner_loop` is set but `worker_spec` or `validator_spec` is missing, it pushes a validation error
- [ ] Error: When `dispatchCycle()` reaches a stage with `inner_loop` set but no `buildLoopRunner` was passed to the constructor, it throws a clear `Error` (caught by the existing try/catch → run escalates, never a `TypeError`)

**Edge cases:**
- [ ] Edge: At A4.1 the XOR rule is inert — the build stage still has `agent_spec: agent-specs/build.yaml` and no `inner_loop` branch is taken in the dispatcher. The graph loads unchanged. All 90 existing tests pass.
- [ ] Edge: The 5-arg `Engine` constructor call sites in `tests/integration/security.test.ts:166/187` stay unchanged (5-arg) and typecheck cleanly because the 6th param is optional. These tests never reach the build stage (cost-cap and pause checks fire first).

---

## 3a. Experience Script

The literal walkthrough the **Experience Runner** (`AGENTS/experience-runner.md`)
will execute against your branch, live, after the Validator passes it.

**Interaction mode:** Mixed — Terminal (Run) for the build/test/export checks; HTTP (Request) for the pipeline-run scenario. Per the agentic-harness manifest, engine/contracts stories use Request/Run against the pipeline; this story has no dashboard UI change.

**Preconditions:**
**Launch command:** `cd /home/royce/mission-control/PROJECTS/realcode/repo && npm test` (Terminal scenarios). For the HTTP scenario: `docker compose up -d` (requires the `realcode-sandbox:latest` image built externally + `.env` with `OPENROUTER_API_KEY`).
**Ready signal:** `npm test` exits 0 (Terminal). For HTTP: `GET http://localhost:3001/api/runs` returns HTTP 200; `docker logs realcode-engine` shows `graph: /app/stage-graph.yaml (6 stages)`.
**Base URL / entry point:** `http://localhost:3001/api/` (HTTP scenario only)
**Seed data / test account:** none required (realcode has no auth — INV-5)
**Starting state:** repository checked out on branch `story/A4.1-contracts-schemas-xor-rule`; dependencies installed (`npm install`)

**Note on scenario coverage:** A4.1 is a contracts/schema story with no UI change. The Human-Only criteria in §3 (the schema/XOR/engine-guard criteria) are all verifiable via Terminal checks (run tests, typecheck, export-schemas diff, read files) — no browser or subjective judgment needed. Scenario 5 (HTTP) exercises the full pipeline to confirm the graph is unchanged and the build stage still works via the old single-sandbox path; it requires Docker and is marked as such.

### Scenario 1: All test suites pass (including new schema round-trip tests)

**Verifies acceptance criteria:** Round-trip validation test; All existing suites pass at A4.1

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm test` | — | Exit code 0; stdout contains `build-loop-schemas` test file name; total test count is 90 (existing) + new schema tests (≥1 per new schema); no failing tests |

### Scenario 2: TypeScript typechecks cleanly at all Engine constructor call sites

**Verifies acceptance criteria:** Engine constructor gains optional 6th param; `tsc --noEmit` passes

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm run typecheck` | — | Exit code 0; no output (clean typecheck) |

### Scenario 3: Exported JSON schemas match zod sources (no diff on regeneration)

**Verifies acceptance criteria:** `package.json` gains `export-schemas` script; `schemas/build.schema.json` + `schemas/spec.schema.json` regenerated and committed

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `npm run export-schemas` | — | Exit code 0; stdout contains `wrote schemas/build.schema.json` and `wrote schemas/spec.schema.json` |
| 2 | Run | `git diff --exit-code schemas/` | — | Exit code 0 (no diff — committed schemas match regenerated output) |

### Scenario 4: ADR-009 is written in DECISIONS.md and ADR-001 has the supersede note

**Verifies acceptance criteria:** ADR-009 is written in `docs/DECISIONS.md`; ADR-001's entry gains a supersede note

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Run | `grep -c "ADR-009" docs/DECISIONS.md` | — | Exit code 0; stdout is `2` or more (the ADR table row + the ADR-009 section heading) |
| 2 | Run | `grep "Engine-orchestrated build inner loop" docs/DECISIONS.md` | — | Exit code 0; stdout contains `ADR-009: Engine-orchestrated build inner loop` |
| 3 | Run | `grep "superseded by ADR-009" docs/DECISIONS.md` | — | Exit code 0; stdout contains a line in ADR-001's entry noting the spike refinement is superseded by ADR-009 |

### Scenario 5: A real run progresses through the pipeline (build stage still uses old single-sandbox path)

**Verifies acceptance criteria:** All existing suites pass; the graph is unchanged (build stage still has `agent_spec`); the XOR rule is inert

**Requires:** Docker Compose running with `realcode-sandbox:latest` image + `OPENROUTER_API_KEY` in `.env`. If Docker is unavailable, this scenario is deferred to the human with a note (the Terminal scenarios above are sufficient to verify the contracts layer).

| # | Action | Target | Input | Expected Result |
|---|--------|--------|-------|-----------------|
| 1 | Request | `POST http://localhost:3001/api/runs` | `{"idea": "Build a hello-world CLI that prints greeting"}` | HTTP 200; response body contains `run_id` |
| 2 | Wait | — | Poll `GET /api/runs/<run_id>` every 10s for up to 10 min | Run status progresses through `intake` → `framed` → `discovered` → `planned` → `specified` → `built` → `shipped` |
| 3 | Request | `GET http://localhost:3001/api/runs/<run_id>` | — | HTTP 200; response `status` is `shipped` (the build stage still dispatches the old single sandbox at A4.1 — the graph is unchanged) |

---

## 4. Technical Tasks

Build in this exact order. Each task gets its own commit. The agentic-harness Phase 4 build order is: Contracts → Backend → Engine → Sandbox → Per-stage agents → Dashboard → Integration tests. A4.1 is the **Contracts** layer only — it sets up schemas and engine plumbing that A4.2–A4.6 build on. The `BuildLoopRunner` class itself is NOT created in A4.1 (that's A4.2); only the optional constructor param + guard are added.

- [ ] **Schema (new): `src/schemas/worker.ts`** — Create `WorkerArtifact` zod object with fields: `story_id: z.string()`, `result: z.enum(["success", "failed"])`, `failure_type: z.enum(["environment", "implementation"]).optional()`, `failure_description: z.string().optional()`, `branch: z.string()`, `commits: z.array(z.object({ sha: z.string(), message: z.string() })).default([])`, `test_output: z.string().default("")`, `test_passed: z.number().int().nonnegative().default(0)`, `test_failed: z.number().int().nonnegative().default(0)`, `notes: z.string().default("")`. Then `WorkerOutput = StageOutputBase.extend({ stage: z.literal("build_worker"), status: z.enum(["success", "failed", "escalated"]), artifact: WorkerArtifact })`. Export `WorkerOutput`, `WorkerArtifact`, and `workerJsonSchema = zodToJsonSchema(WorkerOutput, "WorkerOutput")`. Follow the exact pattern in `src/schemas/build.ts` (import `StageOutputBase` from `./base.js`, import `zodToJsonSchema`).

- [ ] **Schema (new): `src/schemas/validator.ts`** — Create `CriterionResult = z.object({ criterion: z.string(), result: z.string(), evidence: z.string().default("") })`, `SecurityChecklistEntry = z.object({ check: z.string(), result: z.string() })`, `ValidatorArtifact = z.object({ story_id: z.string(), verdict: z.enum(["pass", "fail", "escalate"]), escalation_type: z.string().optional(), criteria_results: z.array(CriterionResult).default([]), security_checklist: z.array(SecurityChecklistEntry).default([]), notes: z.string().default("") })`. Then `ValidatorOutput = StageOutputBase.extend({ stage: z.literal("build_validator"), status: z.enum(["pass", "fail", "escalate"]), artifact: ValidatorArtifact })`. Export `ValidatorOutput`, `ValidatorArtifact`, and `validatorJsonSchema = zodToJsonSchema(ValidatorOutput, "ValidatorOutput")`.

- [ ] **Schema (extend): `src/schemas/spec.ts`** — Add `StorySpec = z.object({ id: z.string().min(1), title: z.string().min(1), epic: z.string().default(""), acceptance_criteria: z.array(z.string().min(1)).min(1), depends_on: z.array(z.string()).default([]) })`. Add `stories: z.array(StorySpec).min(1)` as a **required** field on `SpecArtifact`. Add `.refine((data) => data.story_count === data.stories.length, { message: "story_count must equal stories.length", path: ["story_count"] })` to `SpecArtifact`. Export `StorySpec`. The `SpecOutput` schema stays otherwise unchanged. **Inferred requirement:** the spec agent producer (`agent-specs/spec.yaml`) must be updated to emit the `stories` array — see the agent-spec task below. Without it, the required `stories` field would break real spec-stage runs (the Experience Script requires spec.json to contain stories).

- [ ] **Schema (extend): `src/schemas/build.ts`** — Add `StoryBuildResult = z.object({ story_id: z.string(), status: z.enum(["done", "failed", "escalated"]), retry_count: z.number().int().nonnegative(), worker_tokens: z.number().int().nonnegative(), validator_tokens: z.number().int().nonnegative(), worker_cost_usd: z.number().nonnegative(), validator_cost_usd: z.number().nonnegative(), test_passed: z.number().int().nonnegative(), test_failed: z.number().int().nonnegative() })`. Add `stories: z.array(StoryBuildResult).optional()` to `BuildArtifact`. Export `StoryBuildResult`. This is additive/backward-compatible — the ship stage reads `repo_path` + `test_results` (unchanged).

- [ ] **Schema (export): `src/schemas/index.ts`** — Add exports: `export { WorkerOutput, WorkerArtifact, workerJsonSchema } from "./worker.js";` and `export { ValidatorOutput, ValidatorArtifact, validatorJsonSchema } from "./validator.js";` and `export { StorySpec } from "./spec.js";` and `export { StoryBuildResult } from "./build.js";`.

- [ ] **Stage-graph schema (extend): `src/engine/stage-graph.ts`** — On the `StageEntry` zod object (line 27): change `agent_spec: z.string().min(1)` → `agent_spec: z.string().min(1).optional()`. Add `worker_spec: z.string().optional()` and `validator_spec: z.string().optional()`. The `inner_loop` field (line 17) already exists as `z.string().optional()` — no change needed.

- [ ] **Stage-graph validation (extend): `validateGraph()` in `src/engine/stage-graph.ts`** — Replace the current block at lines 107-114 (the unconditional `agent_spec` path check) with the XOR rule:
  ```
  for (const stage of graph.stages) {
    if (!fs.existsSync(path.resolve(baseDir, stage.artifact_schema))) {
      errors.push(`Stage ${stage.id}: artifact_schema path '${stage.artifact_schema}' does not exist`);
    }
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
  At A4.1 this is INERT: every stage in `stage-graph.yaml` still has `agent_spec` (including the build stage at line 96). No stage has `inner_loop` set as its dispatch mode — the build stage has `inner_loop: anymake-build-loop` at line 81 BUT also has `agent_spec`, so the XOR rule's `hasAgentSpec && hasInnerLoop` branch would fire for the build stage!

  **CRITICAL — read this carefully:** The build stage in `stage-graph.yaml` (line 81) ALREADY has `inner_loop: anymake-build-loop` AND `agent_spec: agent-specs/build.yaml` (line 96). If you add the XOR rule naively, `hasAgentSpec && hasInnerLoop` would be true for the build stage → `loadStageGraph` would throw → every graph-loading test breaks → the engine won't boot. The plan §4.1 says the XOR rule is "inert at A4.1" because "no stage has `inner_loop` set." But the build stage DOES have `inner_loop` set (it was always there, just never acted on). **The resolution:** the XOR rule must treat `inner_loop` as the dispatch-mode selector — i.e., the XOR is between `agent_spec` (old dispatch path) and `inner_loop` being ACTED ON (new dispatch path). At A4.1, `inner_loop` is present on the build stage but the build stage ALSO has `agent_spec`, which is the intended A4.1 state (the flip to inner_loop-only is A4.4). So the XOR rule as written in the plan WOULD fire on the build stage at A4.1. **You must handle this:** either (a) the XOR check skips stages where `agent_spec` is present and `inner_loop` is present but `worker_spec`/`validator_spec` are absent (treating `inner_loop` as dormant until `worker_spec`+`validator_spec` are added in A4.4), OR (b) reconsider the XOR logic so a stage with `agent_spec` + a dormant `inner_loop` (no `worker_spec`/`validator_spec`) passes validation at A4.1. The plan's intent is clear: the graph must load unchanged at A4.1 (criterion: "the graph is unchanged"). The XOR rule must NOT fire on the build stage at A4.1. The cleanest implementation: only enforce the "cannot have both" error when `inner_loop` is set AND (`worker_spec` or `validator_spec` is set) — i.e., the XOR is really between `agent_spec` and the inner_loop TRIAD (`inner_loop` + `worker_spec` + `validator_spec`), not between `agent_spec` and `inner_loop` alone. A stage with `agent_spec` + a bare `inner_loop` (no worker/validator specs) is valid at A4.1 (the `inner_loop` field is dormant). **Verify:** after your change, `loadStageGraph(GRAPH_PATH)` succeeds without error on the current `stage-graph.yaml` (build stage has `inner_loop` + `agent_spec`, no `worker_spec`/`validator_spec`).

- [ ] **Engine constructor (extend): `src/engine/dispatcher.ts`** — The `Engine` class constructor (lines 85-91) gains an optional 6th parameter: `private buildLoopRunner?: StageRunner`. The `StageRunner` interface is already defined in this file (lines 62-69). This is backward-compatible: existing 5-arg call sites typecheck unchanged.

- [ ] **Dispatcher missing-runner guard (extend): `src/engine/dispatcher.ts`** — In `dispatchCycle()`, replace the current dispatch line (line 218: `const result = await this.runner.run(item, stage, run.workspace_path);`) with a branch:
  ```
  let result;
  if (stage.inner_loop && stage.worker_spec) {
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
  **Note on the branch condition:** the plan §4.2 says `if (stage.inner_loop)`. But per the stage-graph note above, the build stage at A4.1 has `inner_loop` set but is still using the `agent_spec` path (dormant `inner_loop`). If you branch on `stage.inner_loop` alone, the dispatcher would try to use `this.buildLoopRunner` (which is `undefined` at A4.1) → throw → every build-stage run escalates. That breaks the "all existing suites pass" criterion. **The branch condition must be `stage.inner_loop && stage.worker_spec`** (or equivalently, `stage.inner_loop && !stage.agent_spec`) — i.e., only enter the inner-loop path when the stage has been FULLY flipped to inner-loop mode (has `worker_spec`/`validator_spec` and no `agent_spec`). At A4.1, no stage satisfies this condition → the guard is unreachable → the old `runner.run()` path is always taken. At A4.4, the build stage is flipped (loses `agent_spec`, gains `worker_spec`+`validator_spec`) → the branch activates. **Verify:** the existing e2e test (`tests/integration/e2e.test.ts`) and security tests pass unchanged.

- [ ] **ADR-009 (write): `docs/DECISIONS.md`** — Add ADR-009 to the Active Decisions table and add the full ADR-009 section (text in plan §4.14 — copy it). Add a note to ADR-001's entry: "Spike refinement mechanism superseded by ADR-009 (engine-orchestrated inner loop). Core Option B decision preserved." ADR-001's Status stays "Accepted." Do NOT mark ADR-001 superseded — only its spike-refinement mechanism is superseded; the core decision stands.

- [ ] **Agent spec (extend): `agent-specs/spec.yaml`** — Add a `stories` field to the OUTPUT CONTRACT JSON shape in the system_prompt. The `artifact` object gains `"stories": [{"id": "3.1", "title": "...", "epic": "Epic 3", "acceptance_criteria": ["..."], "depends_on": ["3.0"]}]`. Add an instruction: "artifact.stories: a structured array of story objects, one per story in the backlog. Each story has id (string), title (string), epic (string, may be empty), acceptance_criteria (array of non-empty strings, at least 1), depends_on (array of story IDs, may be empty). The length of stories MUST equal story_count." This is required because `SpecArtifact.stories` is now required — without this update, real spec-stage runs would produce artifacts that fail schema validation. **Do NOT fix the pre-existing INV-7 violation** (spec.yaml references `PHASE_GUIDES/phase-3.md` etc.) — that is out of scope for A4.1; only add the `stories` output instruction.

- [ ] **npm script (extend): `package.json`** — Add `"export-schemas": "tsx scripts/export-schemas.ts"` to the `scripts` object. The script `scripts/export-schemas.ts` already exists and imports all schema exports — but it does NOT yet import the new `worker.ts`/`validator.ts` schemas. **Update `scripts/export-schemas.ts`** to also import and write `worker.schema.json` + `validator.schema.json`:
  ```
  import { workerJsonSchema } from "../src/schemas/worker.js";
  import { validatorJsonSchema } from "../src/schemas/validator.js";
  // add to schemas object:
  "worker.schema.json": workerJsonSchema,
  "validator.schema.json": validatorJsonSchema,
  ```
  Then run `npm run export-schemas` and commit the regenerated `schemas/build.schema.json`, `schemas/spec.schema.json`, and the new `schemas/worker.schema.json` + `schemas/validator.schema.json`.

- [ ] **Security test (extend): `tests/integration/security.test.ts`** — In the "every AgentSpec declares a non-empty tool_allowlist" test (lines 83-91): the loop `for (const stage of graph.stages)` calls `loadAgentSpec(path.resolve(REPO_ROOT, stage.agent_spec))`. Since `agent_spec` is now optional, this will be `undefined` for inner-loop stages (none exist at A4.1, but the code must tolerate it). Update the loop to load `stage.worker_spec ?? stage.agent_spec` (or skip stages with no `agent_spec` and no `worker_spec`). At A4.1 every stage still has `agent_spec`, so the assertions still run on all 6 stages unchanged. Add a new test: "every stage satisfies the XOR rule" — iterate `graph.stages`, assert each has exactly one of (`agent_spec`) OR (`inner_loop` + `worker_spec` + `validator_spec`). At A4.1 the build stage has `agent_spec` + a dormant `inner_loop` (no `worker_spec`/`validator_spec`) — per the stage-graph note above, this satisfies the XOR rule (the `inner_loop` field is dormant until the triad is complete). Assert the build stage has `agent_spec` and does NOT have `worker_spec`. The two cost-cap tests (lines 156-194) stay 5-arg `new Engine(graph, queue, storage, runner, tmpDir)` — unchanged (the 6th param is optional).

- [ ] **Test (new): `tests/schemas/build-loop-schemas.test.ts`** — Round-trip validation tests:
  - `WorkerOutput` parses a valid sample (with `result: "success"`, `gate_verdict: "pass"`, all required fields) and rejects an invalid one (missing `story_id`, or `result` not in enum, or `gate_verdict` not in enum).
  - `ValidatorOutput` parses a valid sample (with `verdict: "pass"`, `gate_verdict: "pass"`) and rejects an invalid one (missing `story_id`, or `verdict` not in enum).
  - `SpecArtifact` parses a valid sample with `stories: [{id: "3.1", title: "...", acceptance_criteria: ["..."], depends_on: []}]` and `story_count: 1` → success; rejects a sample with no `stories` field; rejects a sample with `stories: []` (min(1)); rejects a sample where `story_count !== stories.length` (the `.refine()`).
  - `BuildArtifact` parses a valid sample with optional `stories: [{story_id: "3.1", status: "done", ...}]` and also parses a sample WITHOUT `stories` (backward-compatible); `StoryBuildResult` rejects invalid `status` values.
  - `StageEntry` parses a stage with only `agent_spec` (no `inner_loop`); parses a stage with `inner_loop` + `worker_spec` + `validator_spec` (no `agent_spec`); rejects a stage with neither `agent_spec` nor `inner_loop`; (the XOR enforcement in `validateGraph()` is tested separately if feasible, or via the schema-level optionality).
  - At least 1 test per new schema (minimum per the arbiter's rule). Target: ~10-15 assertions across these cases.

- [ ] **Test (new): `tests/engine/stage-graph-xor.test.ts`** — (or add to an existing stage-graph test file if one exists) Assert that `loadStageGraph` on the real `stage-graph.yaml` succeeds at A4.1 (the build stage has `agent_spec` + dormant `inner_loop` → XOR rule does not fire). Assert that a synthetic graph with a stage having both `agent_spec` AND `inner_loop` + `worker_spec` + `validator_spec` throws `GraphValidationError` with the "cannot have both" message. Assert that a synthetic graph with a stage having neither `agent_spec` nor `inner_loop` throws with "must have either" message.

- [ ] **Test (new): `tests/engine/dispatcher-guard.test.ts`** — Assert that when `stage.inner_loop && stage.worker_spec` is true but no `buildLoopRunner` was passed (5-arg constructor), `dispatchCycle()` throws the clear error (caught by try/catch → run escalates). Use a mock stage entry with `inner_loop` + `worker_spec` set and `agent_spec` absent. Assert the run transitions to `escalated` (not a `TypeError` crash). This test constructs a synthetic graph (or mutates the loaded graph) to have an inner-loop stage — it does NOT modify `stage-graph.yaml`.

- [ ] **Integration: none** — no third-party service connections in this story.

---

## 5. Build Order Constraint

This is the first story of issue #4's 6-story build loop (A4.1→A4.6). It has no dependencies on other issue-#4 stories — it is the foundation layer. It depends only on the existing realcode codebase at commit 9faa3cf (master), which has 90 passing tests, 8 ADRs, 8 invariants, and the established patterns in `CONVENTIONS.md`.

**Must be complete before:** A4.2 (BuildLoopRunner — needs the schemas, the optional constructor param, and the dispatcher guard), A4.4 (worker.yaml/validator.yaml + stage-graph flip — needs the XOR rule and the optional `agent_spec`), A4.5 (dashboard — needs the schemas), A4.6 (integration tests — needs everything).

**No prior issue-#4 stories required.** The branch `issue/4-multi-container-build-loop` must exist (created by the Orchestrator); this PR branches off it.

---

## 6. Technical Context

Use these for patterns and consistency — do not reinvent what's already built.

**Stack (from ADRs + manifest):**
- Language: TypeScript (Node.js, ESM modules — `"type": "module"` in package.json)
- Schema validation: Zod 3.x + zod-to-json-schema (schemas defined as zod objects, exported to JSON Schema)
- Backend: SQLite (better-sqlite3) for the queue; filesystem for storage
- Testing: Vitest 2.x (`npm test` = `vitest run`; e2e separate via `vitest.e2e.config.ts`)
- Dashboard: Next.js 14 + React 18 + Tailwind (not touched in this story)
- Tracing: OpenTelemetry OTLP → Phoenix (not touched in this story)

**Existing patterns to follow:**

Pulled from `CONVENTIONS.md` where available — see that file's matching entry for each pattern before falling back to a fresh code scan.

Schema / validation pattern:
```
See: src/schemas/build.ts — the canonical pattern for a stage output schema.
     Import StageOutputBase from ./base.js, extend it with stage literal + status enum + artifact object.
     Export the zod schema, the type, and zodToJsonSchema(schema, "Name").
     CONVENTIONS.md §"Schema / Validation Pattern" says "(none established yet)" — build.ts IS the
     established pattern; follow it for worker.ts and validator.ts.
```

Engine / dispatcher pattern:
```
See: src/engine/dispatcher.ts — Engine class constructor + dispatchCycle().
     CONVENTIONS.md §"Engine / Dispatcher Pattern" says "(none established yet)" — dispatcher.ts IS
     the established pattern. The StageRunner interface is at lines 62-69. The dispatch call is at
     line 218 (inside a try/catch at line 217/257). The try/catch escalates on error (line 260-262).
```

Stage-graph loader pattern:
```
See: src/engine/stage-graph.ts — StageEntry zod schema (line 13-28), validateGraph() (line 63-144).
     The current agent_spec check is at lines 111-113 (unconditional). The inner_loop field is at
     line 17 (already optional). CONVENTIONS.md has no stage-graph entry — this file is the source.
```

Testing pattern:
```
See: CONVENTIONS.md §"Testing Pattern" — "npm test runs vitest run — all unit + integration tests.
     90/90 tests as of commit 9faa3cf." New test files go in tests/ following the existing structure
     (tests/schemas/, tests/engine/, tests/integration/). Use describe/it/expect from vitest.
```

**Current schema (relevant to this story):**

The schemas are zod objects, not SQL tables. Relevant current state:

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

// src/schemas/spec.ts — SpecArtifact (CURRENT, before A4.1):
SpecArtifact = z.object({
  epics_md: z.string().min(1),
  backlog_md: z.string().min(1),
  dependency_graph: z.string().min(1),
  story_count: z.number().int().positive(),
});
// A4.1 adds: stories: z.array(StorySpec).min(1) [REQUIRED] + .refine(story_count === stories.length)

// src/schemas/build.ts — BuildArtifact (CURRENT, before A4.1):
BuildArtifact = z.object({
  repo_path: z.string().min(1),
  test_results: TestResults,
  prs_merged: z.array(PrMerged).default([]),
  escalations: z.array(Escalation).default([]),
});
// A4.1 adds: stories: z.array(StoryBuildResult).optional()  [additive, backward-compatible]

// src/engine/stage-graph.ts — StageEntry (CURRENT, before A4.1):
StageEntry = z.object({
  id, anymake_phase, anymake_agents, inner_loop: z.string().optional(),  // already exists
  input_states, output_states, transitions, concurrency, soft_budget_tokens,
  timeout_ms, model_tier, permission_mode, artifact_schema,
  agent_spec: z.string().min(1),  // REQUIRED — A4.1 makes this .optional()
});
// A4.1 adds: worker_spec: z.string().optional(), validator_spec: z.string().optional()

// src/engine/dispatcher.ts — Engine constructor (CURRENT, before A4.1):
constructor(graph, queue, storage, runner, dataDir)  // 5 params
// A4.1 adds: buildLoopRunner?: StageRunner  (optional 6th param)
```

**Related files (read these for context before writing code):**
- `src/schemas/base.ts` — `StageOutputBase`, `GateVerdict` (the base you extend for WorkerOutput/ValidatorOutput)
- `src/schemas/build.ts` — the canonical pattern for a stage schema (follow this for worker.ts/validator.ts)
- `src/schemas/spec.ts` — where you add `StorySpec` + required `stories` + `.refine()`
- `src/schemas/index.ts` — where you add the new exports
- `src/engine/stage-graph.ts` — `StageEntry` schema (line 27: `agent_spec` → optional) + `validateGraph()` (lines 107-114: replace with XOR rule)
- `src/engine/dispatcher.ts` — `Engine` constructor (lines 85-91: add 6th param) + `dispatchCycle()` (line 218: add the inner_loop branch + guard)
- `src/backend/types.ts` — `StageRunner` interface is actually in `dispatcher.ts` (lines 62-69), not here; `types.ts` has `Queue`, `Storage`, `WorkItem`
- `src/agents/runner.ts` — `STAGE_SCHEMAS` map (line 18); A4.1 does NOT add `build_worker`/`build_validator` to this map (that's A4.4 — the Worker/Validator schemas exist but aren't wired into the runner until the specs exist)
- `tests/integration/security.test.ts` — tool-allowlist loop (lines 83-91) + cost-cap tests (lines 156-194, stay 5-arg)
- `scripts/export-schemas.ts` — add worker + validator schema exports
- `package.json` — add `export-schemas` script
- `agent-specs/spec.yaml` — add `stories` to the output contract (required so real spec runs don't fail validation)
- `stage-graph.yaml` — DO NOT MODIFY (the build-stage flip is A4.4)
- `docs/DECISIONS.md` — add ADR-009 + ADR-001 supersede note

---

## 6a. Intent Constraints

The decisions and invariants this story must respect. Filled from the project's intent layer (`docs/DECISIONS.md`, `docs/INVARIANTS.md`) — this is how the original design's intent reaches you. Implement *within* these; do not contradict one to make the story easier.

**Active decisions this story touches:**
- **ADR-001** (Headless opencode-in-sandbox): Core Option B decision PRESERVED. A4.1 writes ADR-009 which supersedes ADR-001's spike-refinement mechanism (the in-sandbox Task-tool dispatch that proved infeasible in headless `--auto` mode). ADR-001's Status stays "Accepted"; a note is added that the spike refinement is superseded. **This makes A4.1 an ADR-touching story → PR review is required regardless of PR count** (per the arbiter's ADR-touching override).
- **ADR-002** (Stage graph is declarative YAML): Respected. The `StageEntry` schema gains optional fields (`worker_spec`, `validator_spec`) — additive to the declarative config. The XOR rule is a validation constraint on the declarative graph, not engine code. `stage-graph.yaml` is NOT modified in A4.1.
- **ADR-008** (fillTemplate truncates at 8000 chars): Respected — not directly touched, but the new `extraContext` values (future A4.2) will be subject to the same truncation. A4.1 does not change `fillTemplate`.

**Invariants this story must not break:**
- **INV-1** (declarative stage graph): The `inner_loop` field is data from the graph; `worker_spec`/`validator_spec` are additive schema fields. No stage transitions are hard-coded in engine code. The dispatcher's `if (stage.inner_loop && stage.worker_spec)` branch reads graph DATA, not a hard-coded stage ID.
- **INV-2** (schema-validated outputs): New `WorkerOutput`/`ValidatorOutput` schemas are zod-validated (and JSON-Schema-exported). `SpecArtifact.stories` is required with a `.refine()`. `BuildArtifact.stories` is additive optional (backward-compatible). The round-trip test proves validation works.
- **INV-7** (agent specs self-contained): The `spec.yaml` edit in A4.1 adds the `stories` output instruction — it does NOT add any external file references. The pre-existing INV-7 violation in spec.yaml (referencing `PHASE_GUIDES/phase-3.md`) is NOT fixed in A4.1 (out of scope) but must not be made worse.

**If a criterion cannot be met without violating one of the above:** do not proceed and do not work around it. Write `result: failed / implementation` with a description naming the ADR/INV in conflict. Contradicting intent requires a superseding decision through a gate (the intent conflict gate, `AGENTS/arbiter.md`) — it is never the Worker's call.

---

## 7. Security Requirements

Check every item before writing `result: success`. An unchecked item is a validation failure.

- [x] All non-public endpoints in this story require authentication middleware — N/A: realcode has no auth (thin dashboard, INV-5); the dashboard API is intentionally unauthenticated. No new endpoints in this story.
- [x] User data access has authorization checks — N/A: no user data; realcode is a single-operator tool.
- [x] All user input is validated and sanitized before processing or storage — the new zod schemas (`WorkerOutput`, `ValidatorOutput`, `SpecArtifact.stories` with `.refine()`) validate stage artifacts before transition. The XOR rule validates the stage graph at load time.
- [x] Database queries use parameterized queries — N/A: no new database queries; the SQLite queue is unchanged.
- [x] File uploads — N/A: no file uploads.
- [x] No secrets, API keys, or connection strings in committed code — A4.1 adds schemas, validation logic, and docs. No secrets involved. The `export-schemas` script writes JSON Schema files (no secrets).
- [x] API responses do not expose stack traces or internal system fields — N/A: no new API endpoints.

Story-specific security notes:
A4.1 does NOT introduce the opencode-config mount or any new secret-handling surface (that is A4.3). The security-relevant aspect of issue #4's plan (§4.6.1 — the opencode-config/MCP mount) is NOT built in A4.1. A4.1 is purely schemas + validation + engine plumbing + ADR documentation. The `security.test.ts` updates in A4.1 are about tolerating optional `agent_spec` and asserting the XOR rule — not about new security surfaces. The existing security tests (credential isolation, tool allowlist, resource limits, cost cap, atomic claim) must all continue to pass.

---

## 8. PR Instructions

**Branch name:** `story/A4.1-contracts-schemas-xor-rule`
**PR title:** `feat(A4.1): per-story schemas + stage-graph XOR + optional BuildLoopRunner + ADR-009 (#4)`
**Base branch:** `issue/4-multi-container-build-loop`
**PR description:** Use `TEMPLATES/commit-message.md` format. Reference issue #4 in every commit footer (`Refs #4` or `Closes #4` per the agile traceability rule). The PR body should summarize: new WorkerOutput/ValidatorOutput schemas, SpecArtifact.stories required + refine, BuildArtifact.stories optional, StageEntry XOR rule (inert at A4.1), Engine optional 6th param + dispatcher guard, ADR-009, export-schemas npm script, security test updates, round-trip schema tests.

**Review Requirement:** **Review is required.** This is PR #1 (first PR in issue #4's build loop) AND it touches an Active Decision (ADR-001 — superseded spike-refinement mechanism; ADR-009 written). Per the arbiter's PR review policy, both the PR-count rule (#1-#3) and the ADR-touching override require review regardless of PR count. **In autonomous mode**, the Product Owner Proxy handles the `phase4-pr-review` gate — it reviews the PR and returns `approved` or `changes needed: [notes]`. The proxy is strict: it does not rubber-stamp.

Screenshots are required in the PR description for any story that produces UI changes — **N/A for this story** (no UI changes; A4.1 is contracts/schema only).

---

## 9. Constraints

- Do not modify files outside `src/` unless a specific config file is named in the technical tasks. Files outside `src/` that ARE named: `package.json`, `agent-specs/spec.yaml`, `docs/DECISIONS.md`, `scripts/export-schemas.ts`, `schemas/*.schema.json` (regenerated), `tests/**` (new test files). **Do NOT modify `stage-graph.yaml`** — the build-stage flip is A4.4.
- Do not modify existing migration files — N/A (no database migrations; realcode uses SQLite with a fixed schema).
- Do not add npm/pip/cargo dependencies without noting them in your RESULT notes — A4.1 adds NO new dependencies (zod, zod-to-json-schema, tsx, vitest are all already in package.json).
- Do not implement functionality not described in the acceptance criteria — specifically: do NOT create `src/engine/build-loop.ts` (that's A4.2), do NOT create `agent-specs/worker.yaml` or `agent-specs/validator.yaml` (that's A4.4), do NOT modify `stage-graph.yaml` (that's A4.4), do NOT add `build_worker`/`build_validator` to the `STAGE_SCHEMAS` map in `runner.ts` (that's A4.4), do NOT add the `specOverride`/`schemaKey`/`extraContext` 4th param to `AgentStageRunner.run()` (that's A4.2/A4.4).
- Do not push to `main` directly — use your story branch and open a PR against `issue/4-multi-container-build-loop`.
- Stop and write a `failed/implementation` result rather than guessing at ambiguous product requirements.
- **Story-specific constraint:** the XOR rule in `validateGraph()` must NOT fire on the build stage at A4.1 (the build stage has `inner_loop: anymake-build-loop` AND `agent_spec: agent-specs/build.yaml` in the current `stage-graph.yaml`). The graph must load unchanged. See the detailed note in §4 Technical Tasks (Stage-graph validation).

---

<!-- PLANNER: Fill above sections before dispatch. Leave section 10 blank. -->
<!-- WORKER: Fill section 10 when complete. Do not modify sections 1-9. -->

---

## 10. RESULT

<!-- Worker fills this section. Append below the line — do not delete existing content. -->

**result:** success
**pr_url:** https://github.com/R3dy/realcode/pull/5
**pr_number:** 5
**branch:** story/A4.1-contracts-schemas-xor-rule
**commits:**
- 98e92cc feat(A4.1): add WorkerOutput schema (per-story worker artifact)
- f5a7a0a feat(A4.1): add ValidatorOutput schema (per-story validator artifact)
- b99c44b feat(A4.1): add StorySpec + required stories[] to SpecArtifact with refine
- 1249a29 feat(A4.1): add StoryBuildResult + optional stories[] to BuildArtifact
- da9d316 feat(A4.1): export new schemas (Worker/Validator/StorySpec/StoryBuildResult)
- dd900bb feat(A4.1): agent_spec optional + worker_spec/validator_spec + XOR rule
- afd60b4 feat(A4.1): optional 6th param buildLoopRunner + missing-runner guard
- 8cfad7f docs(A4.1): ADR-009 engine-orchestrated build inner loop + ADR-001 supersede note
- 03e2335 feat(A4.1): spec.yaml emits structured stories[] array
- 5cb62c8 feat(A4.1): export-schemas npm script + worker/validator JSON schemas
- c199025 test(A4.1): security test tolerates optional agent_spec + XOR rule assertion
- a1e9078 test(A4.1): round-trip schema tests + XOR rule tests + dispatcher guard tests
**test_output:** passed (115 tests — 90 existing + 25 new)
**lint_output:** clean
**notes:**
- All 90 existing tests pass unchanged in behavior. The SpecOutput test in tests/schemas.test.ts and the spec mock in tests/integration/e2e.test.ts were updated to include the now-required `stories` array (the schema change is intentionally backward-incompatible for SpecArtifact). The security test's tool-allowlist loop was updated to tolerate optional `agent_spec` (loads `worker_spec` as fallback) + a new XOR rule assertion was added.
- The XOR rule's "cannot have both" error only fires when the inner_loop TRIAD is complete (inner_loop + worker_spec + validator_spec). A stage with agent_spec + a bare/dormant inner_loop (no worker/validator specs) is valid at A4.1 — this is the build stage's current state. The build stage flip to triad-only is A4.4.
- The dispatcher guard branches on `stage.inner_loop && stage.worker_spec` (not `inner_loop` alone) so the build stage at A4.1 (dormant inner_loop, no worker_spec) still uses the old `runner.run()` path. The guard is unreachable at A4.1.
- `src/agents/runner.ts` gained a guard for undefined `agent_spec` (type-level fix for the optional field — the dispatcher routes inner-loop stages to `buildLoopRunner` so this path is never reached for inner-loop stages). This is NOT the `specOverride`/`schemaKey`/`extraContext` 4th param (that's A4.2/A4.4).
- The base branch `issue/4-multi-container-build-loop` was pushed to the remote (it only existed locally before this PR).
