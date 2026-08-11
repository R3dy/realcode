# Plan Review — Issue #1, Round 1

**Reviewer:** Anymake Plan Reviewer (fresh context — round 1)
**Plan:** `PROJECTS/realcode/repo/docs/06-agile/issue-1/plan.md` @ "In Review (round 1)", 2026-08-11
**Issue:** https://github.com/R3dy/realcode/issues/1 — `type:bug` (run detail route unbuilt + stale failed runs unremovable)
**Code state checked:** c8037f4 (master HEAD — verified by `git log`)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-1/review-round-1.md`

---

## Checklist

Every dimension gets a result. FAIL requires a numbered comment below.

| # | Dimension | Result | Evidence |
|---|-----------|--------|----------|
| 1 | **Root cause verified** | PASS | `ls src/dashboard/app/runs/[id]/` → empty directory (no `page.tsx`). `RunCard.tsx:15` renders `<Link href={`/runs/${run.id}`}>` (plan §2 says `:17`; actual line is `:15` — trivial drift, trace is correct). `api/runs/route.ts` exports only `GET` (list) + `POST` (create) — no GET-by-id, no DELETE. `engine.ts` has `listRuns`/`getRun`/`createRun`/`getControlDoc`/`setControlDoc` and no `deleteRun`. `lib/data.ts` exports a mock `runs` array + `getRun()` returning mock data (INV-3 confirmed). Failed runs verified: `run_0368916b/` (status `intake`) contains only `run.json`; `run_3201f39a/` (status `framing_failed`) contains `frame.json` + `run.json`. Both bugs and the unimplemented INV-6 are real and traced to the exact code the plan names. |
| 2 | **Solves the reported issue** | PASS | §4.1–4.4 build the missing `page.tsx` + `GET /api/runs/[id]` (fixes crash) and `DELETE /api/runs/[id]` + `engine.deleteRun` + delete affordance (fixes clutter). Both halves of issue #1 are directly resolved. |
| 3 | **Scope matches the issue** | PASS | No scope creep. The full `TraceTimeline` from the Screen 2 spec is explicitly deferred to PARKING_LOT (§5). Card-level delete is deferred. Only the two reported defects are addressed. |
| 4 | **Intent consistency** | PASS | Additive classification is correct. ADR-003/004 preserved (detail page uses `engine.getRunDetail` → real `run.json`; mock `getRun()` explicitly NOT imported). INV-3/4/5/6 respected. INV-6 (deletion cleans work_items + workspace + active-run confirmation) is implemented precisely as the invariant states. No Active Decision contradicted. |
| 5 | **Design consistency** | FAIL | §7's component-inventory table claims `Dialog`, `EmptyState`, `Tooltip` are reused existing components. Verified against code: `Tooltip` does not exist anywhere in `src/dashboard/`. `Dialog` is not a reusable primitive — `NewRunDialog.tsx` is a one-off inline modal built with `motion`/`AnimatePresence`; there is no generic `<Dialog open={}>`. `EmptyState` is a local non-exported function inside `app/page.tsx:132`, not a reusable primitive. The "no new components introduced / no `ux-design.md` update required" claim rests on this false premise. See C1. |
| 6 | **Blast radius honest** | PASS | §8 names the real shared paths verified against SYSTEM_MAP + code: `RunCard` link (unchanged), `engine.ts` existing methods (signatures unchanged — `deleteRun`/`deriveStageStatuses`/`getRunDetail` are additive), `queue.db` (parameterized `DELETE FROM work_items WHERE run_id = ?`), `data/workspaces/` (per-run subdir removal), `lib/api.ts` exports (additive). Protections named (regression tests for cross-run isolation, active-run 409 gate). No migrations — correct (filesystem + existing table only). |
| 7 | **Stories buildable** | FAIL | §9 criteria are mostly specific and testable, and both stories have Experience Scripts. But A1.2's criterion "UI uses existing … `Dialog`" is unbuildable as written — no `Dialog` primitive exists (C1). Also §4.1 vs §4.3 contradict on who owns the active-run gate (C2), and §4.4's type additions collide with existing `lib/api.ts` imports (C3). A Worker would have to improvise on all three. |
| 7a | **Experience Script present** | PASS | Both stories carry literal action/expected-result walkthroughs. A1.1's script is the bug repro rewritten (board → click → detail renders; not-found state; failed-run state). A1.2's script is the delete repro + cross-run regression (step 8). Verified the shipped run referenced in A1.1 step 2–4 exists (`run_a2e65d68`, status `shipped`, all 6 stage artifacts present) and failed runs exist for A1.2. |
| 8 | **Test plan sufficient** | PASS | §10 names specific automated tests (route tests for 200/404/409/force, `deleteRun` engine tests for dir/workspace/queue cleanup, `deriveStageStatuses` fixture tests, page render tests), the two Experience Scripts as Experience Runner replays, and named regression tests (cross-run `work_items` isolation, board still loads/polls, POST still works). No "works correctly" language. Bug repro is an acceptance criterion in both stories. |
| 9 | **Rollback complete** | PASS | §11 has a real branch (`issue/1-run-detail-and-delete`), squash-merge + SHA recording, `git revert` steps, explicit "no migrations" statement matching the no-DDL reality, and a deploy-rollback note (Next.js redeploy). |
| 10 | **Security** | PASS | No auth/authz/tenant/secret/payment surface — realcode dashboard is single-operator, no auth (ADR-003/INV-5). The destructive DELETE is gated by a confirmation dialog + 409 active-run guard (INV-6). Parameterized SQL (`WHERE run_id = ?`). No path traversal in `deleteRun` — `runId` is resolved under a fixed `RUNS_DIR` (the plan should still sanitize `runId` against `..`, but this is a hardening note, not a security escalation — the existing `getRun` already trusts `runId` the same way, and the dashboard is single-operator). |

---

## Comments *(required for every FAIL — each specific and actionable)*

### 1-C1 — §7 / §9 A1.2: `Dialog`, `EmptyState`, `Tooltip` are not reusable existing components

**Plan section:** §7 (Design Consistency table) and §9 Story A1.2 acceptance criterion "UI uses existing `Button` (destructive), `Dialog`, Design DNA per §7."

**Problem:** The plan's §7 table lists `Dialog` (delete confirmation), `EmptyState` (not-found), and `Tooltip` (cost meter) as "Existing components reused" and concludes "no new components introduced … no `ux-design.md` update required." Verified against the code:

- `Tooltip` — `grep -rn "Tooltip" src/dashboard/` returns zero hits. The component does not exist.
- `Dialog` — `grep -rn "Dialog" src/dashboard/components/` returns only `NewRunDialog.tsx`, which is a one-off form modal (inline `motion.div` + `AnimatePresence`, no exported `<Dialog>` primitive). `ui.tsx` exports `Button`, `Badge`, `Card`, `StatusDot`, `Skeleton`, `RUN_STATUS_META`, `STAGE_STATUS_TONE`, `cn` — no `Dialog`.
- `EmptyState` — exists as a local `function EmptyState()` inside `app/page.tsx:132`, not exported, not in `components/`. Not reusable without extraction.

A Worker told to "reuse existing Dialog" would discover none exists and have to improvise, contradicting the plan's "no new components" claim and the rule "no new visual pattern ships without a `ux-design.md` update." A destructive-confirmation modal IS a new pattern relative to the current design system (only `NewRunDialog`'s form modal exists, which is non-destructive).

**Required change:** Revise §7 and §9 A1.2 to reflect reality. Pick one of:

(a) **Acknowledge new pattern + update ux-design.md:** state that a generic destructive-confirmation `Dialog` pattern is being added to the design system, add it to `ux-design.md`'s component inventory (with the spec: backdrop blur, `role="dialog"`, Escape-to-close, destructive button variant — matching the established `NewRunDialog` motion budget), and extract `EmptyState` to `components/ui.tsx` as a reusable primitive (also a `ux-design.md` update). Drop `Tooltip` (use a native `title` attribute on the cost meter, or omit).

(b) **Inline-replicate, no new primitive:** explicitly state the delete confirmation will replicate `NewRunDialog`'s inline `AnimatePresence` modal treatment (an established visual pattern, not a new component), that `EmptyState` will be re-implemented locally inside `runs/[id]/page.tsx` (or extracted to `ui.tsx` as a shared primitive — pick one), and that `Tooltip` is dropped in favor of a native `title` attribute. Adjust the §7 "Existing components reused" row to remove `Dialog`/`EmptyState`/`Tooltip` and list what is actually reused (`Button`, `Badge`, `Card`, `StageStepper`, `Skeleton`) plus what is inline-replicated (`NewRunDialog` modal pattern) plus what is local (`EmptyState` body). Either way the §7 "no new components / no ux-design.md update" claim must be corrected.

Either path is acceptable; the plan must not claim reuse that doesn't exist.

### 1-C2 — §4.1 vs §4.3: Duplicated and contradictory active-run guard; `deleteRun` signature missing `force`

**Plan section:** §4.1 (`DELETE /api/runs/[id]`) and §4.3 (`engine.deleteRun`).

**Problem:** The active-run gate is specified twice, with conflicting ownership:

- §4.1 DELETE route: "If the run's status is `running`/`intake`/in-flight, return `409 Conflict` … UNLESS `?force=1` … Call `engine.deleteRun(runId)`." → The route owns the check and the 409, and calls `deleteRun` (no `force` mentioned).
- §4.3 `deleteRun` step 2: "If `status` is active … AND the caller did not pass `force`, throw `RunActiveError` (the API route translates this to 409). When `force` is set, proceed." → The engine also owns the check, references a `force` parameter, and throws `RunActiveError`.

But §4.3's `deleteRun` signature is `deleteRun(runId: string): Promise<void>` — there is no `force` parameter, yet step 2 references "the caller did not pass `force`." A Worker cannot tell who owns the gate, where `force` is threaded, or whether the route calls `deleteRun(id, {force})` or `deleteRun(id)` after pre-checking.

**Required change:** Pick a single owner and make the signatures consistent. Recommended: the **route owns the gate** (it already has `?force=1` and must return the HTTP 409 anyway), and `deleteRun(runId: string): Promise<void>` is unconditional — it deletes the dir + workspace + work_items rows, throwing only `RunNotFoundError` for a missing run. Remove §4.3 step 2's active-check and `RunActiveError` entirely; remove the "force" reference from §4.3. §9 A1.2's acceptance criteria (`DELETE returns 409 for active run without force`, `DELETE returns 200 for active run with force=1`) then map cleanly to the route layer. Update §4.1's prose to state the route does the active-check before calling `deleteRun`.

### 1-C3 — §4.4: Type additions in `lib/api.ts` collide with existing imports; `RunDetailResponse` defined on the wrong side

**Plan section:** §4.4 (Client API — `lib/api.ts`).

**Problem:** §4.4 proposes adding `export type StageName = "frame" | ...` and `export type StageStatus = "pass" | "fail" | "running" | "pending" | "not-reached"` to `lib/api.ts`. But `lib/api.ts:2` already does `import type { Run, RunStatus, StageName, Stage, StageStatus } from "./data"` and uses `StageName`/`StageStatus` throughout (`deriveStages`, `STATE_TO_STAGE: Record<string, StageName>`, etc.). Redefining `StageName`/`StageStatus` as exports in the same file is a name collision — TypeScript will reject it.

Additionally, the plan's `StageStatus` introduces `"not-reached"`, which does NOT exist in `data.ts`'s `StageStatus` (`"pass" | "running" | "fail" | "pause" | "pending"`). The detail page's stage-status vocabulary is genuinely different from the board's (the board uses `pending` for not-yet-reached; the detail page uses `not-reached`). This is a real type-design decision the plan glosses over.

Finally, §4.3 specifies `getRunDetail(runId): RunDetailResponse | null` in `engine.ts` (server-side), but §4.4 defines `RunDetailResponse` in `lib/api.ts` (client-side). The server-side engine should not import a type from the client-side api module; the definition direction is backwards.

**Required change:**

1. Define `RunDetailResponse`, the detail-page `StageStatus` (with `"not-reached"`), and any new detail types in **`lib/engine.ts`** (server) or a shared `lib/types.ts`, NOT in `lib/api.ts`. `lib/api.ts` re-exports or imports them for client use.
2. Do not redefine `StageName` — it already exists in `lib/data.ts`; import and reuse it (the six stage names are identical).
3. For the detail-page status vocabulary that adds `"not-reached"`, either (a) name it distinctly (e.g. `DetailStageStatus`) to avoid colliding with `data.ts`'s `StageStatus`, or (b) extend `data.ts`'s `StageStatus` to include `"not-reached"` and reconcile the board's `deriveStages` (which currently emits `"pending"` for unreached stages) — pick one and state it. Recommended: a distinct `DetailStageStatus` type, so the board's existing mapping is untouched.
4. Update §4.4's code block to reflect the above (import `StageName` from `./data`; define `DetailStageStatus`; import `RunDetailResponse` from `./engine` rather than re-defining it).

---

## Verdict

**VERDICT: NEEDS CHANGES** — comments 1-C1, 1-C2, 1-C3 must be resolved; architect revises and resubmits for round 2.

**Summary:** The plan is strong where it matters most: root cause is accurately traced and verified against the code, scope is tight (no creep, TraceTimeline correctly deferred), the intent classification is correct, INV-3/4/6 are faithfully enforced, blast radius is honest, rollback is complete, and both stories carry real Experience Scripts with verified fixture runs. The three required changes are all in the buildability/consistency details: §7 overclaims reusable components that don't exist (`Dialog`/`EmptyState`/`Tooltip`), §4.1 vs §4.3 contradict on who owns the active-run gate (and `deleteRun`'s signature lacks the `force` its body references), and §4.4's type additions collide with existing `lib/api.ts` imports and put `RunDetailResponse` on the wrong side of the client/server boundary. None require redesign — all are clarifications the architect can make in a revision. Resolve and resubmit.
