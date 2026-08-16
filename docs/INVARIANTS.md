# realcode -- Invariants

**Last updated:** 2026-08-15 (cartographer refresh, post-merge of PR #18 / issue #17)
**Code state:** 8456aaa (master)

## INV-1: The stage graph is declarative (ADR-002)
Adding, reordering, or branching a stage is a config change to `stage-graph.yaml`, never engine code. The conductor + change stages (ADR-010) were added as YAML entries with `conductor`/`live_mount` flags -- no engine branching code.
**Enforced in:** `stage-graph.yaml`, `src/engine/stage-graph.ts`, `src/engine/dispatcher.ts`.

## INV-2: Stage artifacts are JSON-Schema-validated; live.json is NOT a stage artifact
Each stage's output (conductor.json, frame.json, discover.json, etc.) must conform to its schema in `schemas/`. The engine validates before transitioning state. **live.json is explicitly excluded** (ADR-011): it is a derived, transient realtime channel -- overwritten per stage, never schema-validated, never counts as a stage artifact for state-transition purposes. Phoenix (ADR-005) remains the trace collector of record.
**Enforced in:** `schemas/*.schema.json`, `src/engine/dispatcher.ts` (artifact write path), `src/engine/live-state.ts` (live.json is best-effort, never validated, never throws).

## INV-3: The dashboard uses real data, not mock (ADR-004)
The board polls the live `/api/runs` endpoint. The detail page does the same -- `fetchRunDetail()` -> `getRunDetail()` reads real run.json + stage artifacts + live_state + build_state from `data/runs/`. The mock data in `lib/data.ts` (`runs` array, `getRun()`) must NOT be used for live rendering; it is for type definitions (`STAGE_ORDER`, `StageName`) only.
**Enforced in:** `src/dashboard/lib/api.ts` (fetchRunDetail -> live GET), `src/dashboard/lib/engine.ts` (getRunDetail reads real files). RESOLVED post-launch (Drift Log D-2): the detail page now uses the live API, not the mock getRun().

## INV-4: Failed runs may have only run.json
A run that failed at stage N has `run.json` + artifacts for stages 1..N-1 + NO artifact for stage N (it failed). The detail page must gracefully handle missing stage artifacts. `deriveStageStatuses()` marks the failed stage "fail" and later stages "not-reached"; the detail page renders "Failed -- no artifact written." for a failed stage and "Not reached." for not-reached stages.
**Enforced in:** `src/dashboard/lib/engine.ts` (deriveStageStatuses, getRunDetail), `src/dashboard/app/runs/[id]/page.tsx` (empty-state rendering).

## INV-5: The dashboard is thin (ADR-003)
No auth, no billing, no marketing. Three screens: board, detail, settings. Dark developer-observability aesthetic. Mobile-first responsive (desktop sidebar collapses to a bottom nav on < md, session 26).
**Enforced in:** `src/dashboard/app/` (exactly 3 routes: `/`, `/runs/[id]`, `/settings`), `src/dashboard/components/AppShell.tsx` (responsive nav).

## INV-6: Run deletion must not orphan running work_items (now enforced)
Deleting a run removes its data directory, its workspace directory, and its work_items rows in queue.db, and invalidates the board's list cache. A run whose status is in the active set (`intake`, `framed`, `discovered`, `planned`, `specified`, `built`, `running`, `claimed`, `classified_new`, `classified_change`) is NOT deletable without an explicit override: the API returns HTTP 409 `{error: "run is active"}` unless the request carries `?force=1`. A run with running build-loop containers is additionally gated (409 unless force). The detail-page UI surfaces active-run and running-container warnings in the confirm modal and sends `?force=1` only after the user confirms.
**Enforced in:** `src/dashboard/app/api/runs/[id]/route.ts` (DELETE: ACTIVE_STATUSES gate + build-loop container gate + force param, 409 response), `src/dashboard/lib/engine.ts` (deleteRun: 4-step cleanup), `src/dashboard/app/runs/[id]/page.tsx` (confirm modal + active warning + running-container warning). RESOLVED post-launch (Drift Log D-3).

## INV-7: Agent specs delegate to anymake's real templates; traversal guard stays (ADR-012)
Agent specs point agents at anymake's real template files in the opencode cache path (`/root/.cache/opencode/packages/anymake@.../`) instead of inlining frozen format descriptions. Agents MAY read anymake's phase guides, templates, and project-type manifests from that path. The traversal guard (do NOT traverse `node_modules/`, `data/`, `.git/`, `dist/`, `.next/`, `coverage/`) is load-bearing and stays -- with a carve-out for the anymake cache path (it passes through a directory named `node_modules` but is not a traversal). The "no anymake doc reads" prohibition from ADR-006 is removed (superseded by ADR-012). The `change.yaml` agent's anymake-agile Skill delegation is functional (anymake is accessible). `ship.yaml` is intentionally self-contained (deliberate fast-path, not drift).
**Enforced in:** `agent-specs/{frame,discover,plan,spec,ship,worker,validator,change}.yaml` (cache-path delegation + traversal guard).

## INV-8: Workspace seeding must exclude data/tests/node_modules/lockfiles (ADR-007)
When the full pipeline flow seeds a workspace via `[target: <project>]`, the copy must exclude `COPY_EXCLUDE_DIRS = {node_modules, .git, dist, .next, .cache, data, tests}` and `COPY_EXCLUDE_FILES = {package-lock.json, yarn.lock, pnpm-lock.yaml}`. Excluding `data/` is load-bearing -- the realcode repo's own `data/` contains the workspace being created, so copying it causes infinite recursion. The exclude sets are DUPLICATED in `src/engine/dispatcher.ts` and `src/dashboard/lib/engine.ts` (both have their own createRun); they MUST be kept in sync -- editing one without the other is a violation. NOTE (ADR-010): this applies to the full pipeline flow ONLY; the agile change flow live-mounts the real repo and skips seeding entirely.
**Enforced in:** `src/engine/dispatcher.ts` (COPY_EXCLUDE_DIRS/FILES + seedWorkspaceFromProject filter), `src/dashboard/lib/engine.ts` (duplicated -- both must stay in sync).

## INV-9: The conductor classifies every request before any stage runs (ADR-010)
Every run enters the pipeline at the `conductor` stage (stage 0). No frame/discover/plan/spec/build/ship/change stage may execute until the conductor has classified the request and branched the flow to `classified_new` (full pipeline) or `classified_change` (agile flow). The conductor runs a direct in-process LLM call (no container); if the LLM is unavailable (no API key, network error), it MUST default to `new` (full flow) -- the safe fallback, never `change`. A `[target: <project>]` tag or project-name match is a deterministic shortcut to `change` (no LLM call). The classification result (intent, target_project, flow_type) is persisted in `conductor.json` and the work_item payload.
**Enforced in:** `stage-graph.yaml` (conductor stage with `conductor: true`, `input_states: [intake]`), `src/engine/conductor.ts` (classifyIntent -- hybrid + safe fallback), `src/engine/dispatcher.ts` (conductor branch writes conductor.json + releases to classified_new/classified_change), `src/engine/stage-graph.ts` (conductor flag relaxes agent_spec/inner_loop XOR).

## INV-10: The change flow live-mounts the real project repo, never seeds a copy (ADR-010)
When the conductor classifies a request as `change` with a resolved `target_project`, the change stage MUST mount the REAL project repository (`MISSION_CONTROL_ROOT/PROJECTS/<project>/repo`) as the sandbox workspace, read-write. It must NOT copy or seed an ephemeral workspace (ADR-007's seeding path is full-flow-only). The live-mount is resolved by `resolveLiveWorkspace(target_project)` and applied by the dispatcher when `stage.live_mount` is true and `target_project` is present in the work_item payload. The change agent commits its work to the real repo's git, so changes are reversible via git revert/reset.
**Enforced in:** `stage-graph.yaml` (change stage with `live_mount: true`), `src/engine/conductor.ts` (resolveLiveWorkspace), `src/engine/dispatcher.ts` (live_mount branch sets run.workspace_path), `agent-specs/change.yaml` (commits after change).
