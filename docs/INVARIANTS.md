# realcode -- Invariants

**Last updated:** 2026-08-11

## INV-1: The stage graph is declarative (ADR-002)
Adding, reordering, or branching a stage is a config change to `stage-graph.yaml`, never engine code.

## INV-2: Stage artifacts are JSON-Schema-validated
Each stage's output (frame.json, discover.json, etc.) must conform to its schema in `schemas/`. The engine validates before transitioning state.

## INV-3: The dashboard uses real data, not mock (ADR-004)
The board polls the live `/api/runs` endpoint. The detail page must do the same -- read real run.json + stage artifacts from `data/runs/`. The mock data in `lib/data.ts` (`runs` array, `getRun()`) must NOT be used for live rendering; it's for type definitions only.

## INV-4: Failed runs may have only run.json
A run that failed at stage N has `run.json` + artifacts for stages 1..N-1 + NO artifact for stage N (it failed). The detail page must gracefully handle missing stage artifacts.

## INV-5: The dashboard is thin (ADR-003)
No auth, no billing, no marketing. Three screens: board, detail, settings. Dark developer-observability aesthetic.

## INV-6: Run deletion must not affect running work_items
Deleting a run from `data/runs/` should also clean up its work_items in queue.db (if any remain) and its workspace directory. A running or paused run should not be deletable without confirmation.
