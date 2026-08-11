# Plan Review — Issue #1, Round 2

**Reviewer:** Anymake Plan Reviewer (fresh context — round 2)
**Plan:** `PROJECTS/realcode/repo/docs/06-agile/issue-1/plan.md` @ "In Review (round 2)", 2026-08-11
**Issue:** https://github.com/R3dy/realcode/issues/1 — `type:bug` (run detail route unbuilt + stale failed runs unremovable)
**Code state checked:** c8037f4 (master HEAD — same commit analyzed by round 1; plan §3 confirms the Cartographer refreshed the intent layer against this SHA on 2026-08-11)
**Location:** `PROJECTS/realcode/repo/docs/06-agile/issue-1/review-round-2.md`

---

## Round 1 Resolution Verification

All three round-1 comments verified against the revised plan text.

### 1-C1 (§7/§9 A1.2: non-existent reusable components) — RESOLVED

- §7 "Existing components reused" row now lists only `Button`, `Badge`, `Card`, `StageStepper`, `Skeleton` (all genuinely in `components/ui.tsx`), and explicitly states: **"No `Dialog`, `EmptyState`, or `Tooltip` primitive exists in the codebase"** with the exact evidence (NewRunDialog is one-off; EmptyState is local in `app/page.tsx:132`; Tooltip zero matches).
- §7 "Patterns inline-replicated" row specifies the delete confirmation replicates `NewRunDialog`'s `AnimatePresence` + `motion.div` treatment with backdrop, `role="dialog"`, `aria-modal="true"`, Escape-to-close — exactly the required accessibility attributes.
- §7 "Local (page-scoped) components" row re-implements `EmptyState` inside `runs/[id]/page.tsx` (not claimed as reused); `StageArtifactCard` is composed of existing primitives.
- §7 "Dropped from original plan" row drops `Tooltip` in favor of a native `title` attribute.
- §4.2 (line 106) confirmation modal spec mirrors §7: "inline-replicating `NewRunDialog`'s pattern … `role="dialog"`, `aria-modal="true"`, Escape-to-close."
- A1.1 criterion (line 237): "No non-existent primitives (`Dialog`/`Tooltip`) are referenced."
- A1.2 criterion (line 271): "UI uses existing `Button` (destructive) + `Card`, the inline-replicated `NewRunDialog` modal pattern (not a `Dialog` primitive — none exists)."
- §7 rule check (line 198) correctly concludes no `ux-design.md` update is needed because no *new* visual pattern ships (the modal is an inline replication of an established pattern, not a new design-system component), and extractions are logged to PARKING_LOT.

Clean resolution via option (b) from round 1.

### 1-C2 (§4.1 vs §4.3: 409 gate ownership + missing force param) — RESOLVED

- §4.1 DELETE route (line 89): **"The route owns the active-run gate."** Explicitly states the 409 is returned by the route when status is active unless `?force=1`, and "The gate is enforced here, in the route, before `deleteRun` is called — `deleteRun` itself is unconditional."
- §4.1 (line 90): "After the gate passes … call `engine.deleteRun(runId)`. `deleteRun` does NOT take a `force` parameter and does NOT re-check status."
- §4.3 (line 114): `deleteRun(runId: string): Promise<void>` — **"unconditional; the caller (API route) is responsible for the active-run gate."** Throws only `RunNotFoundError`.
- §4.3 steps (lines 115–118): resolve dir → remove run dir → remove workspace dir → delete work_items rows. No active-check step, no `force` reference, no `RunActiveError`.
- §4.3 note (line 120): "The active-run 409 gate (INV-6 confirmation) lives in the DELETE API route (§4.1), NOT in `deleteRun`. `deleteRun` does not take a `force` parameter and does not throw `RunActiveError`."
- §10 engine test (line 292): "`deleteRun` does NOT check active status (gate lives in the route — calling deleteRun on an active run succeeds without force)."

Single owner (route), unconditional `deleteRun`, no force param — exactly the recommended fix. §4.1 and §4.3 are now consistent.

### 1-C3 (§4.4: type redefinition collision) — RESOLVED

- §4.4 (line 128): "Types are defined **server-side** (in `lib/engine.ts` — see §4.3) and re-exported/imported by `lib/api.ts` for client use. Do NOT redefine `StageName`/`StageStatus` here."
- §4.4 (line 131): `export type DetailStageStatus = StageStatus | "not-reached";` — distinct name, avoids collision with `data.ts`'s `StageStatus`. The board's existing `deriveStages` (which emits `"pending"`) is untouched.
- §4.4 (line 132): `export interface RunDetailResponse { … }` defined in `engine.ts` (server-side) — correct direction.
- §4.4 (line 133): "StageName is NOT redefined — import it from `./data` (the six stage names are identical). `RunRecord` likewise from `./data`."
- §4.4 (line 136): `lib/api.ts` only does `import type { RunDetailResponse, DetailStageStatus } from "./engine";` — no redefinition.
- §4.3 (line 122): `deriveStageStatuses` return type is `Record<StageName, DetailStageStatus>`; `StageName` imported from `./data`; `DetailStageStatus` defined in `engine.ts` per §4.4.
- §4.1 GET response body (line 67) uses `DetailStageStatus` for each stage — consistent with the new type.

Types server-side in `engine.ts`, `StageName` reused from `data.ts`, distinct `DetailStageStatus` name, `RunDetailResponse` defined server-side and imported by `api.ts`. All four sub-requirements met.

### §12 Review Log verification

Line 316–318: Round 1 row present with verdict `NEEDS CHANGES`, report file `review-round-1.md`, and a resolution cell describing all three fixes with their section locations. ✓

---

## Checklist

Every dimension gets a result. FAIL requires a numbered comment below.

| # | Dimension | Result | Evidence |
|---|-----------|--------|----------|
| 1 | **Root cause verified** | PASS | Unchanged from round 1. §2 traces verified against c8037f4: `src/dashboard/app/runs/[id]/` is empty (no `page.tsx`); `RunCard.tsx` renders `<Link href={`/runs/${run.id}`}>` → 404; `api/runs/route.ts` exports only GET+POST (no GET-by-id, no DELETE); `engine.ts` has no `deleteRun`; `lib/data.ts` exports mock `getRun()` (INV-3). INV-6 (deletion cleanup) unimplemented. Both bugs real. |
| 2 | **Solves the reported issue** | PASS | §4.1–4.4 build the missing `page.tsx` + `GET /api/runs/[id]` (fixes crash) and `DELETE /api/runs/[id]` + `engine.deleteRun` + delete affordance (fixes clutter). Both halves of issue #1 directly resolved. |
| 3 | **Scope matches the issue** | PASS | No creep. Full `TraceTimeline` deferred to PARKING_LOT (§5). Card-level delete deferred. Only the two reported defects addressed. |
| 4 | **Intent consistency** | PASS | Additive classification correct. ADR-003/004 preserved (detail page uses `engine.getRunDetail` → real `run.json`; mock `getRun()` explicitly NOT imported). INV-3/4/5/6 respected. INV-6 implemented precisely (route-side 409 + force gate; `deleteRun` cleans dir + workspace + work_items). No Active Decision contradicted. |
| 5 | **Design consistency** | PASS | §7 corrected per 1-C1. Only real components listed as reused (`Button`, `Badge`, `Card`, `StageStepper`, `Skeleton`); modal is inline-replicated from `NewRunDialog` with full a11y attributes; `EmptyState` is local; `Tooltip` dropped for native `title`. Rule check correctly concludes no `ux-design.md` update needed (no new pattern — inline replication of an established one). Extractions logged to PARKING_LOT. |
| 6 | **Blast radius honest** | PASS | §8 names real shared paths: `RunCard` link (unchanged), `engine.ts` existing methods (signatures unchanged — `deleteRun`/`deriveStageStatuses`/`getRunDetail` additive), `queue.db` (parameterized `DELETE FROM work_items WHERE run_id = ?`), `data/workspaces/` (per-run subdir), `lib/api.ts` exports (additive). Protections named (cross-run isolation regression test, active-run 409 gate). No migrations — correct. |
| 7 | **Stories buildable** | PASS | 1-C1/1-C2/1-C3 resolved. §9 criteria are specific and testable. A1.1 criteria reference only real components + local EmptyState; A1.2 criteria reference the inline-replicated NewRunDialog modal pattern (not a non-existent `Dialog` primitive). §4.1 vs §4.3 now agree on gate ownership. §4.4 types are server-side with no collision. A Worker can build from the plan alone. |
| 7a | **Experience Script present** | PASS | Both stories carry literal action/expected-result walkthroughs. A1.1: board → click → detail renders → stage cards → back → not-found → failed-detail. A1.2: board → failed run → delete → confirm modal → redirect → gone from board → not-found on direct nav → regression (other run still renders). Bug repro is an acceptance criterion in both stories. |
| 8 | **Test plan sufficient** | PASS | §10 names specific automated tests (route 200/404/409/force; `deleteRun` dir/workspace/queue cleanup + the unconditional-no-active-check test; `deriveStageStatuses` fixtures; page render tests), the two Experience Scripts as Experience Runner replays, and named regression tests (cross-run `work_items` isolation, board still loads/polls, POST still works). No "works correctly" language. |
| 9 | **Rollback complete** | PASS | §11 has real branch (`issue/1-run-detail-and-delete`), squash-merge + SHA recording, `git revert` steps, explicit "no migrations" matching the no-DDL reality, deploy-rollback note (Next.js redeploy). |
| 10 | **Security** | PASS | Single-operator dashboard, no auth/authz/tenant/secret/payment surface (ADR-003/INV-5). Destructive DELETE gated by confirmation dialog + 409 active-run guard (INV-6). Parameterized SQL. `runId` resolved under fixed `RUNS_DIR` (same trust model as existing `getRun` — hardening note, not an escalation). No security surface weakened. |

---

## Comments

No FAIL dimensions. No new comments.

The three round-1 comments (1-C1, 1-C2, 1-C3) are all cleanly resolved in the revised plan text, verified section-by-section above. No new issues were introduced by the revision. Per the verdict rules, a clean revision that resolves all prior comments and breaks nothing new deserves approval — no new issues are invented.

---

## Verdict

**VERDICT: APPROVED** — all three round-1 comments resolved; all 10 dimensions PASS; near-certainty this plan (1) resolves the reported issue (run detail 404 + stale-run removal), (2) breaks nothing in the blast radius (cross-run isolation tested, existing engine methods untouched, additive `lib/api.ts` exports), (3) keeps the UI coherent with the design system (only real primitives reused, modal pattern inline-replicated from the established `NewRunDialog`, no new design-system component or `ux-design.md` change required), and (4) is cleanly revertible (single squash-merge, no migrations).

**Summary:** The architect addressed all three round-1 comments precisely as recommended — §7's component inventory now reflects reality (option b: inline-replicate NewRunDialog, local EmptyState, drop Tooltip), §4.1/§4.3 now agree that the route owns the 409 gate and `deleteRun` is unconditional, and §4.4's types are server-side in `engine.ts` with a distinct `DetailStageStatus` name and `StageName` reused from `data.ts`. The plan is ready for the build loop.
