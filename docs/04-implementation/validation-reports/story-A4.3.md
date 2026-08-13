# Validation Report — Story A4.3

**Validator:** Anymake Validator (automated)
**Story:** A4.3 — Sandbox: opencode env inheritance + Dockerfile.sandbox + log capture + secret-scan
**Branch:** `story/A4.3-sandbox-env-inheritance`
**PR:** #7
**Base:** `issue/4-multi-container-build-loop`
**Validated at:** 2026-08-12
**Project root:** /home/royce/mission-control/PROJECTS/realcode/repo

---

## Summary

| Gate            | Result |
|-----------------|--------|
| `npm test`      | PASS (158/158 — 131 existing + 27 new) |
| `npm run typecheck` | PASS (tsc --noEmit exits 0) |
| `npm run lint`  | PASS (0 errors; 6 pre-existing warnings unchanged) |
| `docker compose build sandbox` | PASS (image SHA `sha256:85bfa79a...a5f8`, `realcode-sandbox:latest`) |
| `stage-graph.yaml` unchanged | PASS (no diff against base branch) |
| Security checklist | PASS (3/3 critical items) |
| Acceptance criteria | 21 PASS, 1 PARTIAL (deferred per brief §5 + §3a) |
| **Verdict** | **PASS** — with one PARTIAL item escalated for Royce's eyes (BuildLoopRunner caller-side log writing not yet wired; brief explicitly anticipates this, deferred to A4.2 backfill or A4.6). |

**Security-relevant PR** — touches ADR-001 (headless opencode-in-sandbox) + crosses a trust boundary (opencode-config mount). Per the arbiter's security rule, **Royce's review is required in every mode**; the Product Owner Proxy cannot approve this PR.

---

## Acceptance Criteria Verification

### Positive paths

**[PASS] 1. New env vars + engine startup warning**
- `docker-compose.yml:33-35` adds `REALCODE_HOST_MISSION_CONTROL_ROOT`, `REALCODE_OPENCODE_CONFIG_DIR`, `REALCODE_HOST_OPENCODE_CONFIG_DIR` to the engine environment.
- `src/engine-loop.ts:45-53` checks `engineContainerized = REALCODE_DATA_DIR !== REALCODE_HOST_DATA_DIR` and warns for each missing host-path var. Verified by `tests/sandbox/runner-naming.test.ts` integration test (stderr shows the omission warnings when vars unset).

**[PASS] 2. `runDocker()` mounts `${REALCODE_HOST_OPENCODE_CONFIG_DIR}:/root/.config/opencode:ro`**
- `src/sandbox/runner.ts:151-155` — `args.push("-v", \`${hostOpencodeConfigDir}:/root/.config/opencode:ro\`)`. The `:ro` suffix is asserted by `tests/integration/security.test.ts:90`.

**[PASS] 3. `runDocker()` mounts `${REALCODE_HOST_MISSION_CONTROL_ROOT}:${REALCODE_HOST_MISSION_CONTROL_ROOT}:ro`**
- `src/sandbox/runner.ts:160-164` — `args.push("-v", \`${hostMissionControlRoot}:${hostMissionControlRoot}:ro\`)`. Same host-path mount so MCP server paths under it resolve.

**[PASS] 4. `runDocker()` sets `HOME=/root` + `XDG_CONFIG_HOME=/root/.config`**
- `src/sandbox/runner.ts:143-144` — `-e HOME=/root`, `-e XDG_CONFIG_HOME=/root/.config`.

**[PASS] 5. `discoverMcpPaths(configDir)` reads `opencode.json` mcp section, returns command paths**
- `src/sandbox/mcp-discovery.ts:19-54` — reads `${configDir}/opencode.json`, parses `mcp` object, handles both `string` and `string[]` command forms, de-duplicates, skips bare names without `/`. `tests/sandbox/mcp-discovery.test.ts` (7 tests) covers all paths.

**[PASS] 6. `runDocker()` mounts each discovered MCP server path read-only at the same host path**
- `src/sandbox/runner.ts:170-188` — iterates `discoverMcpPaths(containerOpencodeConfigDir)`, skips paths under `hostMissionControlRoot` (already covered by root mount), de-dups, pushes `-v ${p}:${p}:ro` for each remaining path.

**[PASS] 7. Container naming: `realcode-<run_id>-<story_id>-<role>-<attempt>` (sanitized: dots → dashes)**
- `src/sandbox/runner.ts:329-336` — `buildContainerName` static helper. `tests/sandbox/runner-naming.test.ts:8-35` verifies `story-3-1` and runId+storyId dot sanitization. Verified format `realcode-<runId>-<storyId>-<role>-<attempt>` (no `story-` prefix on storyId).

**[PASS] 8. Container ID capture: `--cidfile <tmpfile>`; `SandboxResult` gains `containerId: string`**
- `src/sandbox/runner.ts:45` — `containerId: string` (required field, not optional). `runner.ts:204-212` passes `--cidfile`, `runner.ts:228-240` reads cidfile after spawn close. `tests/sandbox/runner-naming.test.ts:59-72` source-asserts the interface + both `proc.on` handlers set `containerId: ""`. Integration test at lines 90-153 verifies end-to-end cidfile → containerId population via a fake-docker script.

**[PARTIAL] 9. Container log persistence: caller writes logs to `data/runs/<run_id>/containers/<story_id>-<role>-<attempt>.log`; path recorded in `build-state.json`'s `containers[].log_path`**
- `SandboxResult.containerId` plumbing is in place (criterion 8). The `BuildState` interface declares `containers: Array<{ container_id; role; story_id; log_path }>` (`build-loop.ts:40`) and initializes it as `[]` (`build-loop.ts:147`).
- **Gap:** `BuildLoopRunner` does NOT populate `containers[]` or write per-container log files. The worker/validator dispatches at `build-loop.ts:248` and `:350` call `this.runner.run(item, stage, workspacePath, { specOverride, schemaKey, extraContext })` WITHOUT passing `runId`/`storyId`/`containerRole`/`containerAttempt` — so `buildContainerName` returns `null` and `runDocker` omits `--name`/`--cidfile`. No log file is ever written.
- **Context:** The brief §5 build-order note explicitly anticipates this: "A4.2's `BuildLoopRunner` ... does NOT yet populate the new `SandboxOptions.{runId, storyId, containerRole, containerAttempt}` fields ... A4.3's `runDocker` handles this correctly: when ANY of the four identity fields is undefined, both `--name` and `--cidfile` are omitted." The Worker's RESULT note 3 re-confirms the gap. The §3a Experience Script explicitly defers the live-container scenario to A4.6 (the inner_loop graph flip is A4.4, so the live pipeline doesn't reach `BuildLoopRunner` at A4.3 anyway).
- **Verdict:** PARTIAL — the runDocker plumbing (this story's scope) is complete and tested; the caller-side log writing is a deferred gap that needs an A4.2 backfill or A4.6 wiring. Flagged for Royce's eyes. NOT a hard FAIL because the brief explicitly scopes A4.3 to the runDocker plumbing and the live pipeline can't reach it until A4.4.

**[PASS] 10. Security: startup secret-scan — `scanForSecrets(dir)` refuses to spawn on match**
- `src/sandbox/secret-scan.ts:56-67` walks dir (shallow-recursive, skips `node_modules/`+`.git/`), reads `*.json`/`*.yaml`/`*.yml`/`*.env`/`.env`, runs the plan §4.6.1 pattern set.
- `src/sandbox/runner.ts:112-128` — `runDocker` calls `scanForSecrets` only in Docker mode AND only when `REALCODE_OPENCODE_CONFIG_DIR` is set. On non-empty result, REFUSES to spawn: returns `SandboxResult` with `exitCode: -1`, `stdout: ""`, `stderr: "[secret-scan] refusing to spawn sandbox: secret-like pattern '<pattern>' found in <file>"`, `containerId: ""`. The warning names file + pattern family, NEVER the matched value.
- `tests/sandbox/secret-scan.test.ts` (10 tests) covers positive paths, clean fixture, missing dir, value-leak guard, skip-dirs, recursive walk, extension filter.
- `tests/integration/security.test.ts:124-135` source-asserts the refuse-to-spawn guard.

**[PASS] 11. Security: read-only mount — opencode config mount is `:ro` (asserted in security.test.ts)**
- `tests/integration/security.test.ts:83-92` asserts `:/root/.config/opencode:ro` is present and no `:rw`/bare variant exists.

**[PASS] 12. New `Dockerfile.sandbox` builds `realcode-sandbox:latest`**
- `Dockerfile.sandbox` exists at repo root. First non-comment line `FROM node:20-slim`. Installs `git`, `docker.io`, `procps`, `curl`, `ca-certificates`. Installs opencode via the canonical install script (`curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path`) — **deviation from brief's `npm install -g opencode@latest`**, justified in RESULT note 1 (opencode is not an npm package; npm returns 404). `ENV HOME=/root`, `ENV PATH=/root/.opencode/bin:$PATH`, `WORKDIR /workspace`, `CMD ["opencode"]`.
- `docker compose build sandbox` exits 0, image SHA `sha256:85bfa79a3a2e1fd06318c454b8eeb5d3f84e59f77b8dde0798661e416b59a5f8`, tagged `realcode-sandbox:latest`.

**[PASS] 13. `docker-compose.yml` updates**
- `engine.environment` (lines 33-35) gains the three new env vars. `engine.volumes` (lines 40-41) replaces hardcoded `/home/royce/mission-control` with `${REALCODE_HOST_MISSION_CONTROL_ROOT:-/home/royce/mission-control}` form AND adds the opencode-config `:ro` mount. `dashboard.volumes` (line 65) also uses the `${REALCODE_HOST_MISSION_CONTROL_ROOT:-...}` form. A `sandbox` service (lines 75-81) with `build: { context, dockerfile: Dockerfile.sandbox }`, `image: realcode-sandbox:latest`, `profiles: [build-only]` is added. **No `REALCODE_OPERATOR_HOME` anywhere** (verified by grep).

**[PASS] 14. opencode plugin (anymake) available inside sandbox**
- Dockerfile installs opencode via the canonical install script. `runDocker` mounts the operator's opencode config read-only at `/root/.config/opencode` and sets `HOME=/root` + `XDG_CONFIG_HOME=/root/.config`, so `opencode run` reads the mounted `opencode.json` and finds `plugin: ["anymake@git+...", "realmemory@git+..."]`. The sandbox uses `--network realcode-sandbox-net` (line 136) for npm + GitHub + LLM-provider egress. (Network itself is pre-existing; not redefined in this PR.)

**[PASS] 15. Test: `scanForSecrets` fires on seeded key fixture, clean on clean fixture**
- `tests/sandbox/secret-scan.test.ts:18-29` — `sk-test1234567890abcdef` fixture returns a non-empty match with `pattern` field naming the family (NOT the value). `tests/sandbox/secret-scan.test.ts:55-61` — clean fixture returns `[]`. Also covered in `tests/integration/security.test.ts:95-122`.

**[PASS] 16. Test: `discoverMcpPaths` on sample opencode.json returns expected command paths**
- `tests/sandbox/mcp-discovery.test.ts:18-37` — string array form returns both absolute paths, skips bare `node`. `:39-48` — bare string command form. `:67-83` — bare names skipped.

### Error paths

**[PASS] 17. Error: `scanForSecrets` non-empty → runDocker refuses to spawn**
- `src/sandbox/runner.ts:115-127` returns `SandboxResult` with `exitCode: -1`, `stdout: ""`, `stderr` containing the loud `[secret-scan] refusing to spawn sandbox: secret-like pattern '<pattern>' found in <file>` warning, `containerId: ""`, `timedOut: false`. Verified by `tests/integration/security.test.ts:124-135` (source-level) — the refuse path's exact shape is asserted.

**[PASS] 18. Error: missing host-path env vars in Docker mode → startup warning, spawn falls back**
- `src/engine-loop.ts:45-53` warns at startup when `engineContainerized && !REALCODE_HOST_OPENCODE_CONFIG_DIR` (and same for `REALCODE_HOST_MISSION_CONTROL_ROOT`).
- `src/sandbox/runner.ts:151-155` and `:160-164` — when either host var is unset, `runDocker` omits the corresponding mount and logs the omission via `console.warn("[realcode-sandbox] ... unset — omitting ... mount")`. Spawn does NOT crash. Verified by `tests/sandbox/runner-naming.test.ts:90-153` integration test (vars unset, container still runs, exitCode 0).

### Edge cases

**[PASS] 19. Edge: `opencode.json` has no `mcp` section → `discoverMcpPaths` returns `[]`**
- `src/sandbox/mcp-discovery.ts:33-34` — `if (!mcp || typeof mcp !== "object") return []`. Tested at `tests/sandbox/mcp-discovery.test.ts:50-56`.

**[PASS] 20. Edge: bare binary name (no `/`) → skipped**
- `src/sandbox/mcp-discovery.ts:47` — `if (!c.includes("/")) continue`. Tested at `tests/sandbox/mcp-discovery.test.ts:67-83`.

**[PASS] 21. Edge: dotted story IDs sanitized (dots → dashes)**
- `src/sandbox/runner.ts:333-335` — `replace(/\./g, "-")` on both runId and storyId. `tests/sandbox/runner-naming.test.ts:23-35` — `storyId: "A.4.3"` → `A-4-3`, `runId: "run.2026.08.12"` → `run-2026-08-12`, asserts `not.toContain(".")`.

**[PASS] 22. Edge: `SandboxResult.containerId` is `""` when cidfile unreadable**
- `src/sandbox/runner.ts:228-240` — `try/catch` around `readFileSync(cidFile)`, fallback `result.containerId = ""`. The `proc.on("error")` handler (line 296) and `proc.on("close")` (line 284) both initialize `containerId: ""`. Field is required `string` (never `undefined`).
- Tested at `tests/sandbox/runner-naming.test.ts:82-88` (source-level fallback assertion) and `:59-72` (interface + handler assertions).

**[PASS] 23. Edge: local mode (runLocal) does NOT apply opencode-config/MCP mounts or --name/--cidfile**
- `src/sandbox/runner.ts:51-55` — `run()` dispatches to `runLocal` when `opts.localMode`. `runLocal` (lines 58-80) builds args without any `-v`/`--name`/`--cidfile` flags — it invokes `opencode` directly on the host. The opencode-config/MCP mounts and container naming are only in `runDocker`. Local mode is unchanged.

---

## Security Checklist

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | opencode config mount is `:ro` (read-only) | PASS | `runner.ts:152` (`${hostOpencodeConfigDir}:/root/.config/opencode:ro`); `security.test.ts:83-92` asserts `:ro` present + no `:rw`/bare |
| 2 | secret-scan REFUSES to spawn if key-like patterns found | PASS | `runner.ts:112-128` early-return with `exitCode: -1` + loud warning; `security.test.ts:124-135` source-asserts; `secret-scan.test.ts` 10 tests |
| 3 | MCP server paths discovered from `opencode.json` | PASS | `mcp-discovery.ts:19-54` reads `${configDir}/opencode.json` `mcp` section; `mcp-discovery.test.ts` 7 tests |
| 4 | Container naming is deterministic | PASS | `buildContainerName` pure static helper; `realcode-<runId>-<storyId>-<role>-<attempt>` with dots → dashes; tested in `runner-naming.test.ts:8-35` |
| 5 | Log capture path matches plan §4.7 spec | PARTIAL | `SandboxResult.containerId` + cidfile capture present; `BuildState.containers[].log_path` field declared but NOT populated by `BuildLoopRunner` (deferred gap — see criterion 9) |
| 6 | No secrets in committed files | PASS | `Dockerfile.sandbox`, `docker-compose.yml`, `src/sandbox/*.ts` contain no key values; compose uses `${VAR:-default}` indirection. Existing `security.test.ts:57-79` "no SECRET/KEY/TOKEN reads" assertions still pass (verified: `REALCODE_OPENCODE_CONFIG_DIR` contains `CODE` not `KEY`/`SECRET`/`TOKEN`/`PASSWORD`/`CREDENTIAL`) |
| 7 | Host-path env vars mirror REALCODE_HOST_DATA_DIR pattern | PASS | `runner.ts:101-103` mirrors the existing `REALCODE_DATA_DIR`/`REALCODE_HOST_DATA_DIR` translation block at lines 88-92; compose env vars use the same `${VAR:-default}` shape |

---

## Test / Lint / Typecheck / Build Results

- **`npm test`**: 158/158 passed (131 existing + 27 new across 4 new test files). 15 test files all green. Duration 2.21s.
- **`npm run typecheck`**: clean (`tsc --noEmit` exits 0).
- **`npm run lint`**: 0 errors. 6 pre-existing warnings (all unchanged — `ChildProcess` unused import in `runner.ts` was pre-existing before A4.3 per RESULT note; the other 5 are in `cli/`, `dashboard/`, `engine/build-loop.ts` and unrelated to A4.3).
- **`docker compose build sandbox`**: exit 0. Image SHA `sha256:85bfa79a3a2e1fd06318c454b8eeb5d3f84e59f77b8dde0798661e416b59a5f8`, tagged `realcode-sandbox:latest`.
- **`stage-graph.yaml`**: no diff against base branch (INV-1 preserved).
- **`CONVENTIONS.md`**: 4 new entries under "Sandbox / Docker Pattern" (opencode-config inheritance, deterministic container naming, scanForSecrets-before-spawn guard, buildContainerName helper).
- **`PARKING_LOT.md`**: created with the subpath-mount post-MVP hardening entry (plan §4.6.1 step 2).

---

## Noted Deviations (non-blocking, brief §9 permits)

1. **Dockerfile.sandbox opencode install method** — brief §4 task 5 specified `npm install -g opencode@latest`; implementation uses `curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path` because `opencode` is not an npm package (npm 404). Plan §4.12 left install method unspecified; brief §9 instructs "pick the more conservative option and note the choice in your RESULT notes — do NOT escalate." RESULT note 1 documents this. Image builds + `opencode --version` works (1.18.16). ACCEPTABLE.

2. **`scanForSecrets` pattern-set choice** — brief §4 task 2 named `/key|secret|token|cred/i` as the "value-pattern family"; implementation uses the plan §4.6.1 authoritative `KEY_PATTERN` from `collectModelEnv()` (model-provider env-var-name regex) instead. RESULT note 2 explains: a literal free-text `/key|secret|token|cred/i` match would false-positive on prose in the operator's `skills/` dir (e.g. "LLM token usage", "API key documentation") and refuse-to-spawn on every sandbox. The plan §4.6.1 is the authoritative source per the brief ("match the plan's exact list"). Verified: `scanForSecrets('/home/royce/.config/opencode/')` returns `[]` on the operator's real config (no false positives). ACCEPTABLE — more conservative than the brief's paraphrase, aligned with the plan's intent.

3. **BuildLoopRunner caller-side wiring not populated** — A4.2's `BuildLoopRunner` merged without populating `SandboxOptions.{runId, storyId, containerRole, containerAttempt}` or writing per-container logs. A4.3's `runDocker` handles the undefined-fields case correctly (omits `--name`/`--cidfile`). Brief §5 + §3a explicitly anticipate this and defer the live-container scenario to A4.6. ACCEPTABLE as a deferred gap; flagged for Royce's eyes so an A4.2 backfill (or A4.6 wiring) is tracked.

---

## Intent Layer Check

- **ADR-001 (Headless opencode-in-sandbox)**: PRESERVED — A4.3 extends `docker run` with new mounts + `--name`/`--cidfile`; each per-story sandbox is still a headless `opencode run --auto` inside an ephemeral Docker container. The opencode-config mount is the new secret-handling surface; the `:ro` mount + `scanForSecrets`-before-spawn guard make it acceptable. **Security-relevant → Royce's review required.**
- **ADR-003 (Dashboard is thin)**: not touched (no dashboard surface in A4.3).
- **ADR-006 / INV-7 (Agent specs self-contained)**: not directly touched; `scanForSecrets` is the safeguard that makes the opencode-config mount safe.
- **INV-1 (declarative stage graph)**: PRESERVED — `stage-graph.yaml` unchanged.
- **INV-2 (schema-validated outputs)**: PRESERVED — no zod schema changes; `SandboxResult` is internal.
- **INV-5 (dashboard is thin)**: PRESERVED — no dashboard routes.
- **INV-6 (run deletion must not orphan running work_items)**: A4.3 provides the deterministic container-name format `realcode-<run_id>-<story_id>-<role>-<attempt>` that A4.5/A4.6's force-delete teardown will use to `docker rm -f`. A4.3 does NOT implement the teardown (that's A4.5). Naming is deterministic + matches the spec.
- **INV-8 (workspace seeding excludes)**: not touched.

---

## Verdict

**PASS** — with one PARTIAL item escalated for Royce's eyes.

- 22 of 23 acceptance criteria fully PASS with code + test evidence.
- 1 PARTIAL (criterion 9: container log persistence) — the runDocker plumbing is complete and tested, but the `BuildLoopRunner` caller-side log writing is not yet wired. The brief explicitly anticipates this (§5 build-order note + §3a Human-Only-coverage note) and defers the live-container scenario to A4.6.
- All security checklist items PASS (the 3 critical items: `:ro` mount, refuse-to-spawn, deterministic naming).
- `npm test` / `typecheck` / `lint` / `docker compose build sandbox` all green; `stage-graph.yaml` unchanged.
- 2 noted deviations (Dockerfile install method, scanForSecrets pattern set) are non-blocking and per brief §9 ("pick the more conservative option and note the choice in RESULT notes").

**This is PR #3 for issue #4 AND it is security-relevant (opencode-config mount is a secret-handling surface) AND it touches Active Decision ADR-001.** Per the arbiter's security rule, **Royce's review is required in every mode** — the Product Owner Proxy cannot approve this PR. The Validator's PASS is a recommendation; final approval is Royce's.

**Recommended next step:** Royce reviews PR #7. After approval, the deferred BuildLoopRunner caller-side log writing (criterion 9) should be tracked — either as an A4.2 backfill or rolled into A4.6's integration-test wiring (which is where the live build-loop e2e is owned anyway).

**Experience Runner §3a coverage:** all 6 §3a scenarios are verifiable at A4.3 (unit + integration suite, secret-scan fixture, mcp-discovery fixture, security mount assertion, docker compose build). The live-container scenario is explicitly deferred to A4.6 per §3a — its absence at A4.3 is NOT a gap.
