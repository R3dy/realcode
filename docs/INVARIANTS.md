# realcode -- Invariants

**Last updated:** 2026-08-11 (cartographer refresh, post-issue #1/#3 + session 21)
**Code state:** 9faa3cf (master)

## INV-1: The stage graph is declarative (ADR-002)
Adding, reordering, or branching a stage is a config change to `stage-graph.yaml`, never engine code.
**Enforced in:** `stage-graph.yaml`, `src/engine/stage-graph.ts`, `src/engine/dispatcher.ts`.

## INV-2: Stage artifacts are JSON-Schema-validated
Each stage's output (frame.json, discover.json, etc.) must conform to its schema in `schemas/`. The engine validates before transitioning state.
**Enforced in:** `schemas/*.schema.json`, `src/engine/dispatcher.ts` (artifact write path).

## INV-3: The dashboard uses real data, not mock (ADR-004)
The board polls the live `/api/runs` endpoint. The detail page does the same -- `fetchRunDetail()` -> `getRunDetail()` reads real run.json + stage artifacts from `data/runs/`. The mock data in `lib/data.ts` (`runs` array, `getRun()`) must NOT be used for live rendering; it is for type definitions (`STAGE_ORDER`, `StageName`) only.
**Enforced in:** `src/dashboard/lib/api.ts` (fetchRunDetail -> live GET), `src/dashboard/lib/engine.ts` (getRunDetail reads real files). RESOLVED post-launch (Drift Log D-2): the detail page now uses the live API, not the mock getRun().

## INV-4: Failed runs may have only run.json
A run that failed at stage N has `run.json` + artifacts for stages 1..N-1 + NO artifact for stage N (it failed). The detail page must gracefully handle missing stage artifacts. `deriveStageStatuses()` marks the failed stage "fail" and later stages "not-reached"; the detail page renders "Failed -- no artifact written." for a failed stage and "Not reached." for not-reached stages.
**Enforced in:** `src/dashboard/lib/engine.ts` (deriveStageStatuses, getRunDetail), `src/dashboard/app/runs/[id]/page.tsx` (empty-state rendering).

## INV-5: The dashboard is thin (ADR-003)
No auth, no billing, no marketing. Three screens: board, detail, settings. Dark developer-observability aesthetic.
**Enforced in:** `src/dashboard/app/` (exactly 3 routes: `/`, `/runs/[id]`, `/settings`).

## INV-6: Run deletion must not orphan running work_items (now enforced)
Deleting a run removes its data directory, its workspace directory, and its work_items rows in queue.db, and invalidates the board's list cache. A run whose status is in the active set (`intake`, `framed`, `discovered`, `planned`, `specified`, `built`, `running`, `claimed`) is NOT deletable without an explicit override: the API returns HTTP 409 `{error: "run is active"}` unless the request carries `?force=1`. The detail-page UI surfaces an active-run warning in the confirm modal and sends `?force=1` only after the user confirms.
**Enforced in:** `src/dashboard/app/api/runs/[id]/route.ts` (DELETE: ACTIVE_STATUSES gate + force param, 409 response), `src/dashboard/lib/engine.ts` (deleteRun: 4-step cleanup), `src/dashboard/app/runs/[id]/page.tsx` (confirm modal + active warning). RESOLVED post-launch (Drift Log D-3).

## INV-7: Agent specs must be self-contained (ADR-006)
Every `agent-specs/*.yaml` must be fully self-contained: all instructions the agent needs are inlined in the `system_prompt` and `user_prompt_template`. The agent must work ONLY from prompt-provided context -- it must NOT read or search for any external files (anymake phase guides, templates, AGENTS/*.md) and must NOT traverse `node_modules/`, `data/`, `.git/`, `dist/`, `.next/`, `coverage/` directories. New or edited agent specs must preserve this property; adding an external-file reference is a violation.
**Enforced in:** `agent-specs/plan.yaml` + `agent-specs/build.yaml` (system_prompt context-discipline guards). Backstopped by ADR-008 (fillTemplate truncation) in `src/agents/runner.ts`.

## INV-8: Workspace seeding must exclude data/tests/node_modules/lockfiles (ADR-007)
When `[target: <project>]` seeds a workspace, the copy must exclude `COPY_EXCLUDE_DIRS = {node_modules, .git, dist, .next, .cache, data, tests}` and `COPY_EXCLUDE_FILES = {package-lock.json, yarn.lock, pnpm-lock.yaml}`. Excluding `data/` is load-bearing -- the realcode repo's own `data/` contains the workspace being created, so copying it causes infinite recursion. The exclude sets are DUPLICATED in `src/engine/dispatcher.ts` and `src/dashboard/lib/engine.ts` (both have their own createRun); they MUST be kept in sync -- editing one without the other is a violation.
**Enforced in:** `src/engine/dispatcher.ts` (COPY_EXCLUDE_DIRS/FILES + seedWorkspaceFromProject filter), `src/dashboard/lib/engine.ts` (duplicated -- both must stay in sync).
