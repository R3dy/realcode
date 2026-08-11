# Development Plan — Issue #3: Plan stage timeout

**Issue:** https://github.com/R3dy/realcode/issues/3
**Status:** Approved (autonomous mode, self-reviewed against intent layer)
**Date:** 2026-08-11

## 1. Problem

The plan stage times out (5min / 300000ms) on every run targeting a non-trivial
project. 3 consecutive runs failed at `plan` with `exit -1, timedOut true`.
Root cause: the plan agent's system_prompt references anymake files
(PHASE_GUIDES/phase-2.md, TEMPLATES/prd.md, etc.) that do NOT exist in the
sandbox Docker container. The agent burns the timeout searching for them +
exploring the workspace source tree, ballooning to 139K prompt tokens.

## 2. Root cause (3 factors)

1. `agent-specs/plan.yaml` system_prompt says "Read PHASE_GUIDES/phase-2.md,
   TEMPLATES/prd.md, TEMPLATES/adr.md, TEMPLATES/ux-design.md" — these files
   are NOT in the `realcode-sandbox:latest` image.
2. `stage-graph.yaml` plan stage `timeout_ms: 300000` (5min) — frame+discover
   were bumped to 600000 (10min) in session 19, but plan was left at 5min.
3. `src/agents/runner.ts` `fillTemplate()` truncates prior artifacts to 2000
   chars — the plan agent gets a truncated discovery doc and re-explores the
   workspace to compensate.

## 3. Design

### Change 1: stage-graph.yaml — bump plan timeout

```yaml
# plan stage: timeout_ms 300000 -> 600000
timeout_ms: 600000  # was 300000 (5min); now 10min, consistent with frame+discover
```

**Rationale:** The plan stage does MORE work than frame/discover (reads files +
generates PRD + ADRs + UX design). It should have at LEAST as much time.
10min is consistent with the session-19 bump for frame+discover.

### Change 2: agent-specs/plan.yaml — self-contained system_prompt

Rewrite the system_prompt to:
- Remove all references to files not in the sandbox (PHASE_GUIDES, TEMPLATES)
- Describe the PRD/ADR/UX format inline (what fields, what structure)
- Add explicit instruction: "Work ONLY from the prior artifacts in the prompt.
  Do NOT read or explore the workspace source tree."
- Keep the output contract (artifact JSON with gate_verdict, artifact.prd_md,
  artifact.adrs[], artifact.ux_design_md)

**Rationale:** The sandbox is an isolated Docker container. Any file the
system_prompt references must either be mounted into the container OR the
prompt must be self-contained. A self-contained prompt is simpler and more
robust than mounting files.

### Change 3: src/agents/runner.ts — increase fillTemplate truncation

```typescript
// fillTemplate: truncation limit 2000 -> 8000 chars
return val.length > 8000 ? val.slice(0, 8000) + "\n...[truncated]" : val;
// same for the object branch
```

**Rationale:** The discovery doc and PROJECT.md are the plan agent's primary
input. Truncating them to 2000 chars forces the agent to re-read the workspace
to get the full context. 8000 chars (~2000 tokens) is enough to convey the
full discovery output without excessive prompt bloat.

## 4. Intent layer check

- ADR-001 (headless opencode in sandbox): no change to invocation mechanism
- ADR-002 (declarative stage graph): fix edits stage-graph.yaml, not engine code
- INV-1 (declarative stage graph): compliant
- INV-2 (schema-validated artifacts): no schema change
- No intent conflicts.

## 5. Stories

### Story 3.1: Fix plan stage timeout + agent spec + fillTemplate

**Files:**
- `stage-graph.yaml` (line 56: timeout_ms 300000 -> 600000)
- `agent-specs/plan.yaml` (rewrite system_prompt)
- `src/agents/runner.ts` (fillTemplate truncation 2000 -> 8000)

**Acceptance criteria:**
1. `stage-graph.yaml` plan stage timeout_ms is 600000
2. `agent-specs/plan.yaml` system_prompt contains NO references to PHASE_GUIDES or TEMPLATES
3. `agent-specs/plan.yaml` system_prompt includes the PRD/ADR/UX format inline
4. `agent-specs/plan.yaml` system_prompt includes "Do NOT explore the workspace source tree"
5. `src/agents/runner.ts` fillTemplate truncates at 8000 chars (both string and object branches)
6. All existing tests pass (`npm test`)
7. A new run targeting `[target: realcode]` passes the plan stage within the timeout

**Test plan:**
- Run `npm test` — all 90 tests must pass
- Rebuild the engine container with the new stage-graph.yaml + agent-specs
- Launch a new run targeting `[target: realcode]` from the dashboard
- Verify the plan stage produces a valid PRD + ADRs and transitions to `planned`

## 6. Rollback

```bash
git revert <merge-sha>
docker compose build engine dashboard
docker compose up -d engine dashboard
```

## 7. Verification

Launch a new run targeting `[target: realcode]` and verify:
- Frame passes (already working)
- Discover passes (already working)
- Plan passes (the fix) — produces prd_md + adrs[] within 10min
- The run progresses to spec -> build -> ship (or at least to `planned`)
