# realcode — Established Conventions

**Purpose:** Running record of patterns in this codebase for the Planner and Worker.

---

## Schema / Validation Pattern

*(none established yet)*

## Engine / Dispatcher Pattern

*(none established yet)*

## Agent Spec Pattern

### Agent specs are self-contained (INV-7)
**Established by:** Issue #3 (commit 9faa3cf)
**Pattern:** Agent spec system_prompts must NOT reference files not in the sandbox container. No "read PHASE_GUIDES/..." or "explore the workspace." Context needed by the agent is inlined in the prompt or passed via template variables.
**See:** `agent-specs/plan.yaml`, `agent-specs/build.yaml`

### fillTemplate truncation at 8000 chars
**Established by:** Issue #3 (commit 9faa3cf)
**Pattern:** `fillTemplate()` in `src/agents/runner.ts` truncates interpolated context values at 8000 chars to prevent context bloat.
**See:** `src/agents/runner.ts`

## Sandbox / Docker Pattern

### Host-path translation via REALCODE_HOST_DATA_DIR
**Established by:** Phase 4 (commit 9faa3cf)
**Pattern:** The engine runs inside a Docker container but spawns sibling sandbox containers. Bind-mount sources resolve on the HOST, not inside the engine container. Use `REALCODE_HOST_DATA_DIR` env var for the host path when constructing `docker run -v` mounts; use the container-local path (`REALCODE_DATA_DIR`) for reads inside the engine.
**See:** `src/sandbox/runner.ts:65-69`

## Dashboard Pattern

### Real data, not mock (INV-3 / ADR-004)
**Established by:** Phase 2 (ADR-004)
**Pattern:** The board polls the live `/api/runs` endpoint. The detail page reads real run.json + stage artifacts. The mock data in `lib/data.ts` is for type definitions only.
**See:** `src/dashboard/lib/data.ts`, `src/dashboard/app/runs/[id]/page.tsx`

### ink-* design tokens (not slate-*)
**Established by:** Phase 2 UX design
**Pattern:** The as-built Tailwind config renames the slate palette to `ink-*` (ink-950:#0a0b12, ink-900:#11131d, ink-700:#272b3d). Use `ink-*` for surfaces, `status-*` for status colors, `brand-*` for brand. Never use raw `slate-*` classes.
**See:** `src/dashboard/tailwind.config.js`, `src/dashboard/components/ui.tsx`

## Testing Pattern

### vitest run (unit + integration)
**Established by:** Phase 4
**Pattern:** `npm test` runs `vitest run` — all unit + integration tests. E2E tests are separate (`npm run test:e2e`). 90/90 tests as of commit 9faa3cf.
**See:** `vitest.config.ts`, `tests/`
