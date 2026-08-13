# Experience Report — Story A4.3: Sandbox opencode env inheritance + container lifecycle + security

**Experience Runner:** Anymake Experience Runner (`AGENTS/experience-runner.md`)
**Branch:** `story/A4.3-sandbox-env-inheritance`
**Base:** `issue/4-multi-container-build-loop`
**Ran at:** 2026-08-12
**Interaction mode:** Terminal (per brief §3a — no HTTP/UI surface in A4.3)

---

## Verdict: **PASS**

All six Terminal scenarios from the brief's §3a passed. No code was edited by the Experience Runner. The Worker's RESULT notes (deviations on Dockerfile.sandbox install method + scanForSecrets pattern set) were inspected and fall within the brief's §9 "pick the more conservative option and note the choice — do NOT escalate" guidance.

---

## Scenario 1: Unit + integration suite passes (positive path)

| # | Action | Result |
|---|--------|--------|
| 1 | `npm test` (cwd = repo root) | **PASS** — exit 0. `Test Files  15 passed (15)`, `Tests  158 passed (158)`. 158 = 131 existing + 27 new (7 mcp-discovery + 10 secret-scan + 7 runner-naming + 3 new security.test.ts assertions). |
| 2 | `npm run typecheck` | **PASS** — exit 0, no `error TS` lines on stdout. |
| 3 | `npm run lint` | **PASS** — exit 0, `0 errors, 6 warnings`. All 6 warnings are pre-existing (per Worker RESULT: `ChildProcess` unused in runner.ts, plus 5 others in cli/dashboard/engine — none introduced by A4.3). |

---

## Scenario 2: Secret-scan fires on a seeded key fixture and is clean on a clean fixture

| # | Action | Result |
|---|--------|--------|
| 1 | `npx vitest run tests/sandbox/secret-scan.test.ts` | **PASS** — exit 0, `10 tests passed`. The suite covers the seeded-key fixture (`sk-test1234567890abcdef` → non-empty result with `pattern` field naming the matched family + `file` relative path, NOT the value) and the clean-fixture case (returns `[]`). |
| 2 | Inspect `src/sandbox/secret-scan.ts` | **PASS** — exports `scanForSecrets(dir: string): { file: string; pattern: string }[]`. Pattern set: `LITERAL_SECRET_PATTERN = /(?:sk-\|AKIA\|ghp_\|gho_\|xox[bap]\|AIza)[A-Za-z0-9]{16,}/` (plan §4.6.1 literal list) + `ENV_VAR_KEY_PATTERN = /(?:OPENROUTER\|OPENAI\|ANTHROPIC\|DEEPSEEK\|GROQ\|MISTRAL\|TOGETHER\|FIREWORKS\|PERPLEXITY\|COHERE\|GOOGLE\|AZURE)_(?:API_KEY\|KEY)\b/` (the `KEY_PATTERN` from `src/agents/runner.ts:183`). **Deviation noted by Worker (RESULT §2):** brief §4 task 2 paraphrased the second pattern as `/key\|secret\|token\|cred/i`; the plan §4.6.1 authoritative wording says "plus the `KEY_PATTERN` from `collectModelEnv()`". Worker used the plan's exact list. Verified: `scanForSecrets('/home/royce/.config/opencode/')` returns `[]` on the operator's real config (no false positives). Acceptable per brief §9. |

---

## Scenario 3: MCP discovery reads opencode.json and returns command paths

| # | Action | Result |
|---|--------|--------|
| 1 | `npx vitest run tests/sandbox/mcp-discovery.test.ts` | **PASS** — exit 0, `7 tests passed`. Suite builds a temp `opencode.json` with a sample `mcp` section and asserts `discoverMcpPaths` returns the expected path-bearing command entries. |
| 2 | Edge cases in same suite | **PASS** — `opencode.json` with no `mcp` section → returns `[]`; bare-name `command` (`"node"`, no `/`) → skipped from the returned array. |
| 3 | Inspect `src/sandbox/mcp-discovery.ts` | **PASS** — exports `discoverMcpPaths(configDir: string): string[]`. Reads `${configDir}/opencode.json`, returns `[]` on missing/unparseable file, handles `command` as string OR array of strings, de-duplicates, skips entries without `/` (bare PATH-resolvable binaries). |

---

## Scenario 4: Read-only opencode-config mount is asserted by the security suite

| # | Action | Result |
|---|--------|--------|
| 1 | `npx vitest run tests/integration/security.test.ts` | **PASS** — exit 0, `18 tests passed`. |

Spot-checked assertions inside the suite (file:line):
- `tests/integration/security.test.ts:90` — `expect(dockerMethod).toContain(":/root/.config/opencode:ro")` — the `:ro` suffix is mandatory ✓
- `tests/integration/security.test.ts:95` — `"scanForSecrets fires on a seeded key fixture (refuses to spawn) and is clean on a clean fixture"` — seeded `sk-test...` fixture returns non-empty, clean fixture returns `[]` ✓
- `tests/integration/security.test.ts:124` — `"runDocker refuses to spawn when scanForSecrets returns a non-empty result"` — asserts `dockerMethod` contains `scanForSecrets(`, `containerId: ""`, and `/[secret-scan] refusing to spawn/` (the refuse path: exitCode -1, loud warning, containerId "") ✓

`src/sandbox/runner.ts` confirms: line 152 `args.push("-v", \`${hostOpencodeConfigDir}:/root/.config/opencode:ro\`)`; line 114 `scanForSecrets(scanDir)` spawn guard; lines 125 + 284 + 296 `containerId: ""` on refuse/error paths; line 143-144 `-e HOME=/root` + `-e XDG_CONFIG_HOME=/root/.config`.

---

## Scenario 5: Dockerfile.sandbox + docker-compose sandbox target build

| # | Action | Result |
|---|--------|--------|
| 1 | `docker compose build sandbox` (cwd = repo root) | **PASS** — exit 0. Final output: `writing image sha256:85bfa79a3a2e1fd06318c454b8eeb5d3f84e59f77b8dde0798661e416b59a5f8` + `naming to docker.io/library/realcode-sandbox:latest done`. Image SHA non-empty. |
| 2 | Inspect `Dockerfile.sandbox` | **PASS** — exists at repo root. First non-comment line `FROM node:20-slim` (line 12). Installs `git`, `docker.io`, `procps`, `curl`, `ca-certificates`. opencode installed via `curl -fsSL https://opencode.ai/install \| bash -s -- --no-modify-path` (line 33). `ENV HOME=/root` (line 40). `WORKDIR /workspace` (line 43). **Deviation noted by Worker (RESULT §1):** brief §4 task 5 specified `RUN npm install -g opencode@latest`; opencode is NOT on the npm registry (404). Worker used the canonical install script — plan §4.12 left install method unspecified. Acceptable per brief §9. |
| 3 | Inspect `docker-compose.yml` | **PASS** — `services.sandbox` exists with `build: { context: ., dockerfile: Dockerfile.sandbox }`, `image: realcode-sandbox:latest`, `profiles: [build-only]` (lines 75-81). `engine.environment` contains `REALCODE_HOST_MISSION_CONTROL_ROOT` (line 33), `REALCODE_OPENCODE_CONFIG_DIR` (line 34), `REALCODE_HOST_OPENCODE_CONFIG_DIR` (line 35). `engine.volumes` contains `${REALCODE_HOST_OPENCODE_CONFIG_DIR:-...}:/root/.config/opencode:ro` (line 41) and the `/mission-control` mount is `${REALCODE_HOST_MISSION_CONTROL_ROOT:-...}:/mission-control:ro` (line 40) — no hardcoded `/home/royce/mission-control`. `dashboard.volumes` also uses the `${REALCODE_HOST_MISSION_CONTROL_ROOT:-...}` form (line 65). No `REALCODE_OPERATOR_HOME` anywhere. |

---

## Scenario 6: SandboxResult carries containerId; container-name sanitizer handles dotted story IDs

| # | Action | Result |
|---|--------|--------|
| 1 | `npx vitest run tests/sandbox/runner-naming.test.ts` | **PASS** — exit 0, `7 tests passed`. Suite exercises `--name`/`--cidfile` arg construction (via a pure arg-array builder helper + a fake-docker integration test that populates `containerId` from the cidfile end-to-end). Covers: dotted story IDs (`3.1` → `story-3-1`), `--cidfile <tmpfile>` flag presence, `containerId === ""` when cidfile unreadable, and the non-build-dispatch path (identity fields undefined → `--name`/`--cidfile` omitted). |

`src/sandbox/runner.ts` confirms: `SandboxResult.containerId: string` (line 45, required string — not optional); `--name realcode-<run_id>-<story_id>-<role>-<attempt>` sanitized (dots → dashes) at lines 195-207; `--cidfile` at line 207; cidfile read at lines 228-233 (`result.containerId = cid \|\| ""`).

---

## Cross-checks against acceptance criteria (no scenario in §3a missed)

- **Container log persistence** (`data/runs/<run_id>/containers/<story_id>-<role>-<attempt>.log`, `build-state.json` `containers[].log_path`): owned by A4.2's `BuildLoopRunner` (the caller). A4.3's `runDocker` only provides the `containerId` + `stdout`/`stderr` fields the caller writes. Brief §5 build-order note + RESULT §3 confirm A4.2 does NOT yet populate the identity fields; the `runDocker` plumbing correctly omits `--name`/`--cidfile` when they are undefined. The live build-loop Experience Script is owned by A4.6 (brief §3a Human-Only-coverage note) — not reproducible at A4.3 because the `inner_loop` graph flip is A4.4. Not a gap.
- **Engine startup warning for missing host-path vars** (brief §4 task 4): commit `52338a5` adds it to `src/engine-loop.ts`. The runner-naming test's stderr output shows the sandbox-side omission warnings (`[realcode-sandbox] REALCODE_HOST_OPENCODE_CONFIG_DIR unset — omitting opencode-config mount`), confirming the spawn-fallback path. Engine startup warning is unit-test-adjacent (covered by the regression sweep green).
- **`REALCODE_OPERATOR_HOME` deleted**: confirmed absent from `docker-compose.yml`.

---

## Deviations reviewed (both acceptable per brief §9)

1. **Dockerfile.sandbox opencode install method:** `curl https://opencode.ai/install` instead of `npm install -g opencode@latest`. Reason: opencode is not on the npm registry (404). Plan §4.12 left install method unspecified. Image builds, `opencode --version` prints 1.18.16. **Accepted.**
2. **scanForSecrets second-pattern choice:** plan's `KEY_PATTERN` (env-var-name regex) instead of brief's `/key|secret|token|cred/i` paraphrase. Reason: plan §4.6.1 is the authoritative source ("plus the `KEY_PATTERN` from `collectModelEnv()`"); the literal free-text match would false-positive on operator `skills/` prose and refuse-to-spawn on every sandbox. Verified no false positives on the operator's real config. **Accepted.**

Neither deviation violates an ADR or INV; both are details the plan explicitly left to the Worker's judgment.

---

## What needs Royce's eyes

This is **PR #3 for issue #4** and is **security-relevant** (opencode-config mount + secret-scan, plan §4.6.1) AND **touches Active Decision ADR-001** (headless opencode-in-sandbox). Per the arbiter's security + ADR-touching rules, **Royce's review is required** — the Product Owner Proxy cannot approve. The two noted deviations are the main items worth a human glance, plus the secret-scan pattern-set choice (it determines what the refuse-to-spawn guard actually catches).

## Next

Story A4.3 is experience-verified PASS. Ready for Royce's PR review on PR #7 (https://github.com/R3dy/realcode/pull/7), then merge to `issue/4-multi-container-build-loop`. The next story in the issue-4 backlog is **A4.4** (agent specs — flips `stage-graph.yaml` build stage to `inner_loop`, which is what makes the live build-loop pipeline reach `BuildLoopRunner` and thus A4.3's mount/naming code).
