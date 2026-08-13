# Plan Review — Issue #15, Round 1

**Reviewer:** Anymake Plan Reviewer (fresh context — round 1)
**Plan:** `docs/06-agile/issue-15/plan.md` @ "In Review (round 1)", 2026-08-13
**Issue:** https://github.com/R3dy/realcode/issues/15 — `[Feature] Dashboard: parse container logs into collapsible structured rows`
**Code state checked:** f9948dd (main) — verified against working tree
**Location:** `PROJECTS/realcode/docs/06-agile/issue-15/review-round-1.md`

---

## Checklist

Every dimension gets a result. FAIL requires a numbered comment below.

| # | Dimension | Result | Evidence |
|---|-----------|--------|----------|
| 1 | **Root cause verified** — the file:line trace in plan §2 was checked against the actual code and genuinely produces the reported symptom (bugs) / motivation is real (features) | PASS | `ContainerLogViewer.tsx:123` renders the raw `text` string as the else-branch child of `<pre>` (lines 109-125) — verified. The ~70KB JSONL is unreadable; motivation is real. |
| 2 | **Solves the reported issue** — plan §4 demonstrably resolves the §1 problem statement, not an adjacent one | PASS | Pure client-side parser + collapsible-row UI modeled on `TraceRow` matches the issue's requested behavior exactly. |
| 3 | **Scope matches the issue** — nothing built beyond what the issue needs; no "while we're in here" | PASS | Only `ContainerLogViewer.tsx` (render rewrite) + new `parseContainerLogs.ts`. §4.3 explicitly excludes API/engine/build-loop/`LiveTraceStream`. Verified `route.ts` returns `{container_id, log_path, text}` — no backend change needed or planned. |
| 4 | **Intent consistency** — §6 classification is correct; no Active Decision or invariant contradicted without a resolved conflict gate | PASS | Additive classification is correct for a pure UI addition. `docs/DECISIONS.md` and `docs/INVARIANTS.md` do not exist; no ADR in `docs/02-planning/architecture/` touches the log-viewer render path. No invariant violated (read-only, no API change). |
| 5 | **Design consistency** — §7 complete for UI-touching changes; reuses existing components; any new pattern updates `ux-design.md` | PASS | Verified `ui.tsx` exports `Badge` (line 44, with `tone`), `StatusDot` (line 83), `cn` (line 6), `Card` (line 69). `LiveTraceStream` uses `ChevronRight`/`Wrench`/`Cpu`/`Coins` from lucide-react (line 4) — all available. Design DNA (ink tokens, `font-mono`, `text-[11px]`) matches `TraceRow` (lines 180-230). The quoted `FilterSelect` styling (`bg-ink-900...`) doesn't exactly match the real `FilterSelect` (`bg-ink-800`, line 248) but this is a hint, not a quotation — not a deficiency. |
| 6 | **Blast radius honest** — §8 names the real shared paths (spot-checked against SYSTEM_MAP and code); protections exist | PASS | `LiveTraceStream.tsx` is not modified (scope boundary confirmed). Polling/tail behavior preserved — the `useMemo` over `text` re-parses on each poll; expanded-state `Set` keyed by post-dedup index. Reasoning is sound. |
| 7 | **Stories buildable** — §9 criteria are specific and testable; a Worker could build from these + the plan alone | FAIL | See 1-C1 — the parser dispatch instruction is wrong and would produce a non-functional parser if followed literally. |
| 7a | **Experience Script present** — every story in §9 has a literal Experience Script scenario; for a bug, the scenario is the repro rewritten as action/expected-result steps | PASS | Steps 1-17 with specific ASSERTs (collapsed-by-default, click expands, filter narrows, expand-all/collapse-all, malformed→amber raw row). Literal and replayable. |
| 8 | **Test plan sufficient** — repro becomes a regression test; the Experience Script scenario is named in §10 as what the Experience Runner replays; blast-radius tests named; no "works correctly" language | FAIL | See 1-C2 — the dedup test "does not deduplicate non-consecutive identical entries" enshrines behavior that contradicts the real log data, where non-consecutive (interleaved) duplicates are the actual SDK pattern for ~half the events. |
| 9 | **Rollback complete** — §11 has real branch/revert/migration-down steps, not placeholders | PASS | Branch `issue/15-collapsible-container-logs`, `git revert <squash-sha>`, no migrations. Specific and real. |
| 10 | **Security** — no auth/authz/tenant-isolation/secret/payment surface weakened; security-relevant plans flagged for real-user approval | PASS | Pure client-side render change; no auth, no API, no secret surface. No escalation needed. |

---

## Comments *(required for every FAIL — each specific and actionable)*

### 1-C1 — Parser dispatches on the wrong discriminator (`part.type` vs top-level `type`)

**Plan section:** §4.1 (Parsing algorithm, step 2) and §9 acceptance criterion 2

**Problem:** The plan instructs the Worker to "Dispatch on `part.type` (the SDK's discriminator) to populate `kind`" and says "Unknown `part.type` → `kind: "raw"`". But the `LogKind` enum is `"step_start" | "step_finish" | "tool_use" | "text" | "raw"` (underscores), while the actual `part.type` values in the real log file are `"step-start"`, `"step-finish"`, `"tool"`, `"text"` (hyphens, and `tool` not `tool_use`). Verified in `data/runs/run_b03d63bc/containers/stage-discover-stage-0.log`:

| Top-level `type` (matches `LogKind`) | `part.type` (plan says dispatch here) |
|---------------------------------------|---------------------------------------|
| `"step_start"` | `"step-start"` |
| `"step_finish"` | `"step-finish"` |
| `"tool_use"` | `"tool"` |
| `"text"` | `"text"` |

A Worker following the plan literally would check `part.type === "step_start"` — which never matches (real value is `"step-start"`) — so every `step_start`, `step_finish`, and `tool_use` entry falls through to `kind: "raw"`. Only `text` survives (coincidentally `part.type === "text"` matches). The parser would be effectively non-functional: ~all entries rendered as amber "raw" rows, no type badges, no tool names, no token/cost summaries. The acceptance criteria ("Parser correctly handles each SDK kind: `step_start`, `step_finish`...`tool_use`...`text`") would be unmeetable as written.

**Required change:** The plan must specify unambiguously which field is the discriminator and reconcile the naming. The top-level `type` field uses the exact underscore values that match `LogKind` — the plan should dispatch on top-level `type`, not `part.type`. (Alternatively, provide an explicit `part.type`→`LogKind` mapping table: `"step-start"`→`step_start`, `"step-finish"`→`step_finish`, `"tool"`→`tool_use`, `"text"`→`text`.) The field-extraction paths (`part.tool`, `part.callID`, `part.state.input`, `part.state.output`, `part.tokens`, `part.cost`, `part.reason`, `part.text`) are all correct as written — only the discriminator is wrong.

### 1-C2 — Dedup algorithm does not handle the real interleaved duplicate pattern

**Plan section:** §4.1 (Parsing algorithm, step 3 — Deduplication) and §10 (test: "does not deduplicate non-consecutive identical entries")

**Problem:** The plan states "the OpenCode SDK emits each event twice (verified in actual log files — **consecutive identical lines**)" and specifies a consecutive-only dedup: "drop an entry when it is identical to the **immediately preceding** entry by the tuple `(kind, timestamp, callID | messageID | "")`." This claim is only half-true. The real log file (`data/runs/run_b03d63bc/containers/stage-discover-stage-0.log`) has two distinct duplication patterns:

1. **Consecutive** (lines 1-2, 3-4, 9-10): `[step_start, step_start]` — the plan's algorithm catches these. ✓
2. **Interleaved** (lines 5-8, 11-14): `[tool_use, step_finish, tool_use, step_finish]` where entry 1≡3 and 2≡4 (same `callID`/`messageID`, same `timestamp`, byte-identical). The plan's consecutive-only algorithm does NOT catch these — entry 3's immediately-preceding entry is entry 2 (different kind), so entry 3 is kept; likewise entry 4. ✗

Concretely, for lines 5-8 (all `timestamp: 1786595289041`):
- Line 5: `tool_use`, `callID: call_767ef...` → kept (first)
- Line 6: `step_finish`, `messageID: msg_ff96...` → kept (different tuple from line 5)
- Line 7: `tool_use`, `callID: call_767ef...` → **kept (BUG — identical to line 5, but not consecutive)**
- Line 8: `step_finish`, `messageID: msg_ff96...` → **kept (BUG — identical to line 6, but not consecutive)**

The same interleaved pattern repeats at lines 11-14 (`[text, step_finish, text, step_finish]`). Of 14 lines in the real file, the true unique count is 7; the plan's consecutive dedup produces 11 (catches 3 duplicates, misses 4). The plan's claim "This collapses the SDK double-emit" is false for ~half the events.

Worse, §10 enshrines the wrong behavior as a test: "does not deduplicate non-consecutive identical entries — same event separated by a different event stays as three entries." This test would PASS on the broken implementation and GUARANTEE the interleaved duplicates remain visible — the exact problem the feature exists to solve.

**Required change:** Replace the consecutive-only dedup with an algorithm that handles the SDK's batch-emit pattern. Two viable options:
- **Seen-set dedup:** track seen `(kind, timestamp, callID | messageID | "")` tuples in a `Set`; drop any entry whose tuple is already in the set. This catches both consecutive and interleaved duplicates.
- **Windowed dedup:** check the last N (e.g. 4-8) entries for a matching tuple, accommodating the interleaved batch size.

Either way, the §10 test "does not deduplicate non-consecutive identical entries" must be removed or inverted — non-consecutive duplicates that share the same `(kind, timestamp, callID|messageID)` tuple ARE the SDK double-emit and MUST be deduplicated. (If the concern is false-positive dedup of two genuinely-separate tool calls that happen to share a callID — that cannot happen: a `callID` is unique per tool invocation. The tuple is a safe identity key.) Update §8's blast-radius note ("expanded-state `Set` is keyed by post-dedup index, which is stable across re-parses") — still valid, but the re-indexing step must reference the new algorithm.

---

## Verdict

**VERDICT: NEEDS CHANGES** — comments 1-C1 and 1-C2 must be resolved; architect revises and resubmits for round 2.

**Summary:** The plan is well-structured, scope-disciplined, and its UI design, experience script, and rollback are sound. But two evidence-backed defects in the parser design would prevent the feature from working on real data: (1) the discriminator dispatch references `part.type` values that don't match the `LogKind` enum, which would route nearly all entries to `raw`; (2) the consecutive-only dedup algorithm misses the interleaved duplicate pattern present in the actual log file, leaving ~half the duplicates visible — and a test enshrines that wrong behavior. Both are fixable with targeted edits to §4.1 and §10; no structural rework is needed.
