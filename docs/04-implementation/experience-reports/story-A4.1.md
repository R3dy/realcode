# Experience Report — Story A4.1: Contracts: per-story schemas + stage-graph extensions + ADR-009 + schema export

**Created by:** Anymake Experience Runner
**Story:** A4.1 — Contracts: per-story schemas + stage-graph extensions + ADR-009 + schema export
**Branch:** story/A4.1-contracts-schemas-xor-rule
**PR:** #5
**Experience attempt:** 1
**Interaction mode:** Terminal (Scenarios 1–4) + HTTP (Scenario 5)

---

## Launch Log

**Terminal scenarios (1–4):** no app launch required — `npm test` / `npm run typecheck` / `npm run export-schemas` / `grep` run directly against the checked-out branch.

**HTTP scenario (5):**
- **Launch command:** `docker compose up -d --build engine` (engine image rebuilt to pick up the A4.1 branch code — see note below)
- **Started at:** 02:24 UTC — **Ready at:** 02:25 UTC (`GET http://localhost:3001/api/runs` → HTTP 200; `docker logs realcode-engine` shows `graph: /app/stage-graph.yaml (6 stages)`)
- **Teardown:** left running (other runs may be in progress; engine is a long-running dispatch loop)

**Important environment note:** the `realcode-engine` container was originally built at 19:30 UTC on 2026-08-11 — BEFORE the A4.1 commits (which continued until 01:55 UTC on 2026-08-12). The running container held stale pre-A4.1 code (`dist/schemas/spec.js` had no `stories`/`StorySpec`/`.refine`). The Experience Runner rebuilt the engine image (`docker compose up -d --build engine`) so the container ran the actual A4.1 branch code. After rebuild, `docker exec realcode-engine grep stories /app/dist/schemas/spec.js` confirmed `StorySpec`, `stories: z.array(StorySpec).min(1)`, and the `.refine()` are present in the running container. No source code was edited — only the Docker image was rebuilt (standard launch procedure).

---

## VERDICT: PASS

All four Terminal scenarios (1–4) PASS — they are the scenarios that actually verify the A4.1 contracts layer, and the brief states "the Terminal scenarios above are sufficient to verify the contracts layer." Scenario 5 (HTTP pipeline run) is DEFERRED: the spec stage sandbox timed out before producing any artifact (environment/LLM-latency issue, not an A4.1 code defect), so the run never reached the build stage. The A4.1 schema changes were never the cause of — and were never exercised by — the failure.

---

## Scenario Results

| Scenario | Step # | Action | Expected | Actual | Result |
|----------|--------|--------|----------|--------|--------|
| 1 | 1 | `npm test` | Exit 0; stdout contains `build-loop-schemas`; ≥115 tests; no failures | Exit 0; `tests/schemas/build-loop-schemas.test.ts (16 tests)` printed; `Tests  115 passed (115)`; 10 test files all passed | PASS |
| 2 | 1 | `npm run typecheck` | Exit 0; no output (clean typecheck) | Exit 0; no output (clean) | PASS |
| 3 | 1 | `npm run export-schemas` | Exit 0; stdout contains `wrote schemas/build.schema.json` and `wrote schemas/spec.schema.json` | Exit 0; stdout contains `wrote schemas/build.schema.json` and `wrote schemas/spec.schema.json` (also worker/validator/frame/discover/plan/ship) | PASS |
| 3 | 2 | `git diff --exit-code schemas/` | Exit 0 (no diff — committed schemas match regenerated output) | Exit 0 (no diff) | PASS |
| 4 | 1 | `grep -c "ADR-009" docs/DECISIONS.md` | Exit 0; stdout is `2` or more | Exit 0; stdout `3` (table row + section heading + body reference) | PASS |
| 4 | 2 | `grep "Engine-orchestrated build inner loop" docs/DECISIONS.md` | Exit 0; stdout contains `ADR-009: Engine-orchestrated build inner loop` | Exit 0; stdout contains `## ADR-009: Engine-orchestrated build inner loop (supersedes ADR-001 spike refinement)` and the ADR-table row | PASS |
| 4 | 3 | `grep "superseded by ADR-009" docs/DECISIONS.md` | Exit 0; stdout contains a line in ADR-001 noting spike refinement superseded by ADR-009 | Exit 0; stdout: `**Spike refinement superseded by ADR-009** (engine-orchestrated inner loop). Core Option B decision preserved.` | PASS |
| 5 | 1 | `POST http://localhost:3001/api/runs` with `{"idea":"Build a hello-world CLI that prints greeting"}` | HTTP 200; body contains `run_id` | HTTP 200; body `{"run_id":"run_604833d3",...}` | PASS |
| 5 | 2 | Poll `GET /api/runs/<run_id>` every 10s for up to 10 min | Status progresses `intake → framed → discovered → planned → specified → built → shipped` | Status progressed `intake → framed → discovered → planned → spec_failed` (spec sandbox timed out: `exit -1, timedOut true`); never reached `specified` or `built` | FAIL (environment) |
| 5 | 3 | `GET /api/runs/<run_id>` | HTTP 200; `status` is `shipped` | HTTP 200; `status` is `spec_failed` | BLOCKED (depends on step 2) |

**Scenario 5 reclassified to DEFERRED** — see Failure Diagnosis. The spec-stage sandbox timeout is an environment/LLM-latency issue, not an A4.1 code defect. Per the brief: "the Terminal scenarios above are sufficient to verify the contracts layer."

---

## Failure Diagnosis *(Scenario 5)*

### Scenario 5 Step 2: spec stage sandbox timeout

**What was expected:** run status progresses through `intake → framed → discovered → planned → specified → built → shipped` within 10 minutes.

**What actually happened:** run `run_604833d3` progressed `intake → framed → discovered → planned → spec_failed`. The spec stage never produced a validated `SpecArtifact` — `/data/runs/run_604833d3/spec.json` contains:

```json
{
  "output_status": "escalate",
  "artifact": {
    "error": "Stage spec sandbox failed: exit -1, timedOut true",
    "stderr": ""
  },
  "token_usage": { "prompt_tokens": 9374, "completion_tokens": 828, "total_tokens": 43191, "estimated_cost_usd": 0.009061 },
  "stage": "spec",
  "run_id": "run_604833d3",
  "schema_version": 1
}
```

The spec agent's sandboxed container (`opencode --auto` against model tier `openrouter/z-ai/glm-5.2`) timed out before emitting any artifact. The `artifact` field is the engine's error envelope (`{error, stderr}`), NOT a zod-validated `SpecArtifact` — so the A4.1 `SpecArtifact.stories` required-field + `.refine()` change was never exercised. The run never reached the build stage.

**Recurrence:** the prior run `run_0947abc7` (against the stale pre-A4.1 image) ALSO failed at spec with the same `timedOut true` signature. Two earlier runs (`run_b6381e0d`, `run_a2e65d68`) did ship successfully — the sandbox timeout is intermittent and predates the A4.1 branch. This is consistent with an LLM-latency / sandbox-resource issue, not a schema or code regression.

**Likely cause:** not an A4.1 code defect. The spec stage's sandboxed LLM call exceeds the stage timeout (`timeout_ms` in `stage-graph.yaml`) when the model tier responds slowly. The A4.1 changes (required `stories` on `SpecArtifact`, `StorySpec`, `.refine()`) are not on the failure path — the spec agent never returned an artifact for validation. Pointer: the timeout originates in the sandbox runner that wraps the spec agent (`src/agents/runner.ts` / `src/sandbox/`), not in `src/schemas/spec.ts`.

**Why DEFERRED, not FAIL:** the brief explicitly says "the Terminal scenarios above are sufficient to verify the contracts layer," and Scenario 5's stated purpose is to confirm "the graph is unchanged (build stage still has `agent_spec`); the XOR rule is inert" — both of which are already verified by:
- Scenario 1: all 115 tests pass, including `tests/engine/stage-graph-xor.test.ts` (XOR rule does not fire on the real graph) and `tests/integration/e2e.test.ts` (loads the real `stage-graph.yaml`, exercises the build stage via the old single-sandbox path).
- The engine boot log: `graph: /app/stage-graph.yaml (6 stages)` — the graph loads cleanly under the A4.1 validator.
- The dispatcher guard is unreachable at A4.1 (no stage has `inner_loop && worker_spec`), confirmed by `tests/engine/dispatcher-guard.test.ts` passing.

The spec-stage sandbox timeout blocks the run from reaching the build stage, but that is an environment issue outside A4.1's scope. Deferring to a human with a note; no A4.1 code change would unblock it.

---

## Summary

**Scenarios run:** 5 **Steps executed:** 10 **Passed:** 7 **Failed:** 1 (reclassified DEFERRED) **Blocked:** 1 **Skipped:** 0
**Notes:**
- Scenarios 1–4 (the contracts-layer verification) all PASS cleanly: 115/115 tests, clean typecheck, schema export is idempotent (no diff), ADR-009 + ADR-001 supersede note present.
- Scenario 5 (HTTP pipeline run) is DEFERRED: the spec stage sandbox timed out (`exit -1, timedOut true`) on both the stale pre-A4.1 image AND the rebuilt A4.1 image — the failure is intermittent and predates this branch. The run never reached the build stage, so the A4.1 "graph unchanged / XOR inert / old single-sandbox path" claims are verified by the Terminal scenarios instead (per the brief's sufficiency note).
- The `realcode-engine` Docker image was rebuilt mid-run to pick up the A4.1 branch code (the original container held stale pre-A4.1 code). After rebuild, the running container's `dist/schemas/spec.js` confirmed `StorySpec`, `stories: z.array(StorySpec).min(1)`, and the `.refine()` are present. No source code was edited by the Experience Runner.
- Overall verdict: **PASS** — the contracts layer is verified; the deferred HTTP scenario is an environment issue, not an A4.1 regression.
