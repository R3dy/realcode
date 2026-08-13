# Experience Report — Story A4.6

**Story:** A4.6 — Integration: E2E test un-skip + docker-compose sandbox target
**Branch:** story/A4.6-integration-e2e
**PR:** #10
**Experience Runner:** Claude (combined Validator + Experience Runner)
**Date:** 2026-08-12
**Mode:** Terminal scenarios (no UI for this story — it is a test+config integration story)

## Verdict: PASS

All 6 terminal scenarios executed against the live branch and produced the expected results.

## Scenarios

### Scenario 1: `npm test` → 206 pass, 0 skipped
**Command:** `npm test`
**Expected:** 206 tests pass, 0 skipped, 19 test files pass
**Actual:**
```
 Test Files  19 passed (19)
      Tests  206 passed (206)
   Start at  08:36:51
   Duration  2.41s
```
**Result:** ✅ PASS — 206 passed, 0 skipped, no failures.

### Scenario 2: `npm run typecheck` → clean
**Command:** `npm run typecheck`
**Expected:** `tsc --noEmit` exits 0, no output
**Actual:** Exits 0 with no output.
**Result:** ✅ PASS

### Scenario 3: `npm run lint` → 0 errors
**Command:** `npm run lint`
**Expected:** 0 errors (warnings OK)
**Actual:** `6 problems (0 errors, 6 warnings)` — all warnings pre-existing in non-A4.6 files.
**Result:** ✅ PASS

### Scenario 4: `docker compose build sandbox` → exits 0
**Command:** `docker compose build sandbox`
**Expected:** Exit code 0
**Actual:**
```
#8 [sandbox] exporting to image
#8 naming to docker.io/library/realcode-sandbox:latest done
#8 DONE 0.0s
EXIT=0
```
All 4 Dockerfile layers CACHED; image `realcode-sandbox:latest` written successfully.
**Result:** ✅ PASS

### Scenario 5: e2e test is NOT skipped
**Command:** `grep -rn "describe.skip" tests/`
**Expected:** No matches (e2e uses bare `describe`)
**Actual:** No output — no `describe.skip` anywhere under `tests/`. Specifically `tests/integration/e2e.test.ts:186` reads `describe("E2E: synthetic run through all 6 stages", () => {`.
**Result:** ✅ PASS

### Scenario 6: sandbox call count assertion is 21
**Command:** `grep -n "toHaveBeenCalledTimes(21)" tests/integration/e2e.test.ts`
**Expected:** Match at the sandbox-call-count test
**Actual:** `tests/integration/e2e.test.ts:303: expect(mockSandbox.run).toHaveBeenCalledTimes(21);` with comment `// 5 non-build stages (frame/discover/plan/spec/ship) + 8 stories × 2 (worker+validator) = 21`.
**Result:** ✅ PASS

## Notes

- The 6 build-loop-e2e integration tests all pass under `tests/integration/build-loop-e2e.test.ts` (visible in the `npm test` output: `tests/integration/build-loop-e2e.test.ts (6 tests) 195ms`).
- The 6 un-skipped e2e tests all pass: `tests/integration/e2e.test.ts (6 tests) 346ms`.
- Lease-heartbeat regression (`tests/engine/lease-heartbeat.test.ts`, 2 tests) passes unchanged.
- This story has no user-facing UI surface; the Experience Script is terminal-only, matching the story's nature (test + config integration).

## Result

**PASS** — every Experience Script scenario produced the expected result on the live branch. Story A4.6 is verified end-to-end through the actual application/toolchain.
