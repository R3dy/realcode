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

### opencode-config inheritance + host-path env vars (A4.3)
**Established by:** Story A4.3 / issue #4 (commit on branch `story/A4.3-sandbox-env-inheritance`)
**Pattern:** The operator's opencode config dir (`~/.config/opencode` on the host) + mission-control root are bind-mounted read-only into every sandbox so the sandboxed opencode inherits the operator's agents/skills/MCP servers/plugins. Three new env var pairs follow the SAME shape as `REALCODE_DATA_DIR`/`REALCODE_HOST_DATA_DIR` (container-local var for in-engine discovery, `REALCODE_HOST_*` var for `docker run -v` source):
- `REALCODE_OPENCODE_CONFIG_DIR` (container-local, e.g. `/root/.config/opencode`) + `REALCODE_HOST_OPENCODE_CONFIG_DIR` (host, e.g. `/home/<you>/.config/opencode`)
- `REALCODE_HOST_MISSION_CONTROL_ROOT` (host, e.g. `/home/<you>/mission-control`) — no container-local pair (the mission-control root is mounted at the SAME path inside the container so MCP server paths under it resolve).
The engine warns at startup when either host-path var is unset in Docker mode (`REALCODE_DATA_DIR !== REALCODE_HOST_DATA_DIR`). `runDocker` falls back gracefully (omits the corresponding mount, logs the omission). `REALCODE_OPERATOR_HOME` is NOT a var (deleted in round 1 — do not reintroduce).
**See:** `src/sandbox/runner.ts` `runDocker()`, `src/engine-loop.ts` startup-warning block, `docker-compose.yml` `engine.environment` + `engine.volumes`

### Deterministic sandbox container naming (A4.3)
**Established by:** Story A4.3 / issue #4
**Pattern:** When `BuildLoopRunner` dispatches a per-story Worker/Validator sandbox, it populates `SandboxOptions.{runId, storyId, containerRole, containerAttempt}` so `runDocker` can pass `--name realcode-<runId>-<storyId>-<role>-<attempt>` (dots → dashes so the value is a valid Docker container name) + `--cidfile <tmpfile>` (read after spawn close into `SandboxResult.containerId`, `""` on read failure, never `undefined`). The deterministic name is what A4.5/A4.6's force-delete teardown uses to `docker rm -f` running containers before removing the workspace (INV-6) — it reconstructs the name from run_id + story_id + role + attempt without a DB lookup. When ANY of the four identity fields is missing (the non-build-dispatch backward-compat path — e.g. `AgentStageRunner` dispatching frame/discover/plan/spec/ship), both `--name` and `--cidfile` are omitted so those call sites keep working unchanged. The pure helper `SandboxRunner.buildContainerName(opts)` returns the name or `null` (testable without spawning docker).
**See:** `src/sandbox/runner.ts` `buildContainerName()` + `runDocker()` container-naming block, `tests/sandbox/runner-naming.test.ts`

### scanForSecrets-before-spawn guard (A4.3)
**Established by:** Story A4.3 / issue #4
**Pattern:** Before each sandbox spawn, `runDocker` calls `scanForSecrets(process.env.REALCODE_OPENCODE_CONFIG_DIR)` (only in Docker mode AND only when the config-dir env var is set — local mode and unset-var mode skip the scan). On a non-empty result, `runDocker` REFUSES to spawn (not "warns and continues") — returns a `SandboxResult` with `exitCode: -1`, a loud `[secret-scan] refusing to spawn sandbox: secret-like pattern '<pattern>' found in <file>` warning in stderr, `stdout: ""`, `containerId: ""`. The warning names the offending file + pattern family name, NEVER the matched value. The pattern set is the plan §4.6.1 exact list: literal-secret-prefix regex (`/(?:sk-|AKIA|ghp_|gho_|xox[bap]|AIza)[A-Za-z0-9]{16,}/`) + the `KEY_PATTERN` from `collectModelEnv()` (model-provider env-var-name regex, matches `OPENAI_API_KEY` etc. anywhere in a file — catches config files that REFERENCE a secret-bearing env var by name). The brief's `/key|secret|token|cred/i` "value-pattern family" is the planner's paraphrase; the plan §4.6.1 is the authoritative source ("plus the `KEY_PATTERN` from `collectModelEnv()`") — a literal free-text `/key|secret|token|cred/i` match would false-positive on prose in the operator's `skills/` dir and refuse-to-spawn on every sandbox.
**See:** `src/sandbox/secret-scan.ts`, `src/sandbox/runner.ts` `runDocker()` secret-scan gate, `tests/sandbox/secret-scan.test.ts`, `tests/integration/security.test.ts`

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
