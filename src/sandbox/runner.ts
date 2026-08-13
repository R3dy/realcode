import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { discoverMcpPaths } from "./mcp-discovery.js";
import { scanForSecrets } from "./secret-scan.js";
import { writeLiveState } from "../engine/live-state.js";

export interface SandboxOptions {
  workspacePath: string;
  model: string;
  agentName?: string;
  dispatchMessage: string;
  traceparent?: string;
  timeoutMs?: number;
  localMode?: boolean;
  env?: Record<string, string>;
  /**
   * Identity fields (runId/storyId/containerRole/containerAttempt) were added
   * by A4.3 for the BuildLoopRunner per-story Worker/Validator dispatch so the
   * container gets a deterministic name + cidfile capture. Today that
   * build-loop wiring is DEAD CODE: no dispatch path passes a real storyId
   * (BuildLoopRunner leaves every identity field unset — see CONVENTIONS.md
   * + issue-11 plan §2 root cause). The real-storyId branch of
   * `buildContainerName` is preserved for byte-identity + the post-merge
   * Cartographer-flagged build-loop wiring.
   *
   * The live caller is AgentStageRunner (A11.1) dispatching a NON-build stage
   * (frame/discover/plan/spec/ship): it passes `storyId:"stage"` (the non-build
   * sentinel), the identity fields, and `liveCapture:true`. When
   * `liveCapture` is true, runDocker passes --name/--cidfile, tees the sandbox
   * log to runs/{runId}/containers/, and populates live.json — for ANY
   * non-build sandbox, no matter which stage.
   *
   * When `liveCapture` is falsy (BuildLoopRunner's build sub-dispatches and
   * the local-mode path), runDocker behaves EXACTLY as before A11.1: no
   * --name, no --cidfile, no tee, no onJsonLine, no live.json writes — the
   * build spawn args stay byte-identical.
   */
  containerName?: string;
  containerRole?: string;
  containerAttempt?: number;
  storyId?: string;
  runId?: string;
  /** Non-build sentinel capture (A11.1): see the docstring above. */
  liveCapture?: boolean;
  /** Stage id for the tee log path (`stage-<stageId>-<attempt>.log`). */
  stageId?: string;
  /** In-flight JSON-line callback (A11.1), invoked per parsed stdout line. */
  onJsonLine?: (ev: unknown) => void;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  jsonEvents?: unknown[];
  timedOut: boolean;
  /**
   * The Docker container ID captured via `--cidfile`. Empty string when
   * --cidfile was not passed (non-build dispatch), when the cidfile could not
   * be read (spawn error), or when the secret-scan refused to spawn. Never
   * undefined — downstream code reading this field (BuildLoopRunner writes
   * `containers[].container_id` to build-state.json) can rely on a string.
   */
  containerId: string;
}

/**
 * Translate a container-internal path to the host path for Docker volume mounts.
 * Handles two mount prefixes:
 *   1. /data → REALCODE_HOST_DATA_DIR (the engine's data volume)
 *   2. /mission-control → REALCODE_HOST_MISSION_CONTROL_ROOT (the mission-control root)
 * The second is used by the change flow's live-mount feature, where the
 * workspace path is the REAL project repo directory (not an ephemeral copy).
 */
function translateToHostPath(containerPath: string): string {
  const containerDataDir = process.env.REALCODE_DATA_DIR || "/data";
  const hostDataDir = process.env.REALCODE_HOST_DATA_DIR || containerDataDir;
  const containerMcRoot = process.env.MISSION_CONTROL_ROOT || "/mission-control";
  const hostMcRoot = process.env.REALCODE_HOST_MISSION_CONTROL_ROOT || containerMcRoot;

  let hostPath = containerPath;
  if (hostDataDir !== containerDataDir) {
    hostPath = hostPath.replace(containerDataDir, hostDataDir);
  }
  if (hostMcRoot !== containerMcRoot) {
    hostPath = hostPath.replace(containerMcRoot, hostMcRoot);
  }
  return hostPath;
}

export class SandboxRunner {
  constructor(private opencodeBin: string = "opencode", private hostDataDir?: string) {}

  async run(opts: SandboxOptions): Promise<SandboxResult> {
    if (opts.localMode) {
      return this.runLocal(opts);
    }
    return this.runDocker(opts);
  }

  private async runLocal(opts: SandboxOptions): Promise<SandboxResult> {
    const args = [
      "run",
      "--auto",
      "--format", "json",
      "--model", opts.model,
      "--dir", opts.workspacePath,
    ];
    if (opts.agentName) {
      args.push("--agent", opts.agentName);
    }
    args.push(opts.dispatchMessage);

    const env: Record<string, string> = {
      ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>),
      ...opts.env,
    };
    if (opts.traceparent) {
      env.OTEL_TRACEPARENT = opts.traceparent;
    }

    return this.exec(this.opencodeBin, args, env, opts.timeoutMs ?? 300000, opts.workspacePath);
  }

  private async runDocker(opts: SandboxOptions): Promise<SandboxResult> {
    const image = "realcode-sandbox:latest";
    const containerWorkspace = "/workspace";
    // Translate the workspace path from container-internal to host path.
    // The engine runs inside a container with /data mounted from ./data on the host.
    // When spawning sibling containers, Docker needs the HOST path for volume mounts.
    // Also handles /mission-control → host mission-control root translation
    // (used by the change flow's live-mount feature).
    const hostWorkspacePath = translateToHostPath(opts.workspacePath);

    // ─── opencode-config inheritance (A4.3) ──────────────────────────────
    // The operator's opencode config dir (~/.config/opencode on the host) is
    // mounted read-only into the sandbox so the sandboxed opencode inherits
    // the operator's agents/skills/MCP servers/plugins. Host path comes from
    // REALCODE_HOST_OPENCODE_CONFIG_DIR (used for `docker run -v`); the
    // container-local path REALCODE_OPENCODE_CONFIG_DIR is used for in-engine
    // discovery (scanForSecrets, discoverMcpPaths).
    const hostOpencodeConfigDir = process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR;
    const containerOpencodeConfigDir = process.env.REALCODE_OPENCODE_CONFIG_DIR ?? "/root/.config/opencode";
    const hostMissionControlRoot = process.env.REALCODE_HOST_MISSION_CONTROL_ROOT;

    // Security: pre-spawn secret-scan on the mounted opencode config dir.
    // Only runs in Docker mode AND only when the container-local config-dir
    // env var is set (when the engine runs locally, the operator's config is
    // already on the host — no scan needed; when the engine runs in Docker
    // without the config mount, there's nothing to scan). On a non-empty
    // result, REFUSE to spawn — return a SandboxResult with exitCode -1 and a
    // loud warning naming the offending file + pattern family (NOT the value).
    if (process.env.REALCODE_OPENCODE_CONFIG_DIR) {
      const scanDir = containerOpencodeConfigDir;
      const hits = scanForSecrets(scanDir);
      if (hits.length > 0) {
        const first = hits[0];
        const warning = `[secret-scan] refusing to spawn sandbox: secret-like pattern '${first.pattern}' found in ${first.file}`;
        console.warn(warning);
        return {
          exitCode: -1,
          stdout: "",
          stderr: warning,
          jsonEvents: undefined,
          timedOut: false,
          containerId: "",
        };
      }
    }

    // ─── Build the docker run arg list ───────────────────────────────────
    const args: string[] = [
      "run", "--rm",
      "--cpus", "2",
      "--memory", "2g",
      "--stop-timeout", String(Math.ceil((opts.timeoutMs ?? 300000) / 1000)),
      "--network", "realcode-sandbox-net",
      "-v", `${hostWorkspacePath}:${containerWorkspace}:rw`,
      "-e", `OTEL_TRACEPARENT=${opts.traceparent ?? ""}`,
      "-e", `OPENCODE_MODEL=${opts.model}`,
      // opencode reads HOME + XDG_CONFIG_HOME to locate its config dir.
      // Force HOME=/root + XDG_CONFIG_HOME=/root/.config so the mounted
      // /root/.config/opencode is discovered.
      "-e", "HOME=/root",
      "-e", "XDG_CONFIG_HOME=/root/.config",
      ...Object.entries(opts.env || {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    ];

    // opencode-config mount (read-only — asserted by security.test.ts).
    // Skipped + logged when REALCODE_HOST_OPENCODE_CONFIG_DIR is unset (the
    // engine falls back to no config mount — current pre-A4.3 behavior).
    if (hostOpencodeConfigDir) {
      args.push("-v", `${hostOpencodeConfigDir}:/root/.config/opencode:ro`);
    } else {
      console.warn("[realcode-sandbox] REALCODE_HOST_OPENCODE_CONFIG_DIR unset — omitting opencode-config mount (sandbox will not inherit operator opencode env)");
    }

    // mission-control root mount (read-only). MCP server paths under it
    // resolve inside the container because the same host path is mounted at
    // the same container path. Skipped + logged when unset.
    if (hostMissionControlRoot) {
      args.push("-v", `${hostMissionControlRoot}:${hostMissionControlRoot}:ro`);
    } else {
      console.warn("[realcode-sandbox] REALCODE_HOST_MISSION_CONTROL_ROOT unset — omitting mission-control root mount (MCP server paths under it will not resolve)");
    }

    // Per-MCP-server path mounts: discover path-bearing commands from the
    // mounted opencode.json and mount each at the SAME host path inside the
    // container. Paths already under the mission-control root are covered by
    // the root mount above — skip + de-dup.
    const mcpPaths = discoverMcpPaths(containerOpencodeConfigDir);
    const missionRootNormalized = hostMissionControlRoot ? path.resolve(hostMissionControlRoot) : null;
    const mcpMounted = new Set<string>();
    for (const p of mcpPaths) {
      if (!p.includes("/")) continue;
      if (missionRootNormalized) {
        try {
          const resolved = path.resolve(p);
          if (resolved.startsWith(missionRootNormalized + path.sep) || resolved === missionRootNormalized) {
            continue; // covered by the mission-control root mount
          }
        } catch {
          // path.resolve never throws on string input, but guard anyway
        }
      }
      if (mcpMounted.has(p)) continue;
      mcpMounted.add(p);
      args.push("-v", `${p}:${p}:ro`);
    }

    // ─── Container naming + cidfile capture + live.json population (A11.1) ─
    // The block fires whenever a deterministic name is derivable:
    //   (a) `liveCapture === true` (every non-build AgentStageRunner dispatch
    //       — storyId:"stage" sentinel): pass `--name realcode-<runId>-<role>
    //       -<attempt>` + `--cidfile <tmpfile>`, tee the sandbox log, and write
    //       live.json.container BEFORE spawn (1-C2 pre-spawn) so the dashboard
    //       can show the container immediately;
    //   (b) the A4.3 legacy path (four identity fields present, `liveCapture`
    //       falsy — dead code today, preserved for byte-identity): --name +
    //       --cidfile only, no live.json/tee/onJsonLine — exactly today's
    //       behavior.
    // BuildLoopRunner leaves ALL identity fields unset → buildContainerName
    // returns null → this whole block is skipped → the build spawn args stay
    // byte-identical to today (no --name, no --cidfile, no tee, no onJsonLine,
    // no live.json writes).
    let cidFile: string | null = null;
    let logFilePath: string | undefined;
    const containerName = SandboxRunner.buildContainerName(opts);
    if (containerName) {
      if (opts.liveCapture === true && opts.runId) {
        const containerAttempt = opts.containerAttempt ?? 0;
        const stageId = opts.stageId ?? opts.containerRole ?? "stage";
        const storyId = opts.storyId ?? "stage";
        // Tee log path lives under the engine's data dir (container-local),
        // which is bind-mounted to the host — no host-path translation needed
        // for a file the engine writes itself (CONVENTIONS.md).
        // Include storyId in the filename so each worker/validator gets a
        // unique log file (previously all build workers shared stage-build-0.log
        // and overwrote each other's logs).
        logFilePath = path.join(
          process.env.REALCODE_DATA_DIR || "/data",
          "runs", opts.runId, "containers",
          `stage-${stageId}-${storyId}-${containerAttempt}.log`,
        );
        // Pre-spawn live.json container population (1-C2): name + log_path are
        // known now, container_id is not yet. Wrapped in try/catch — a failure
        // here must NOT prevent the spawn.
        try {
          writeLiveState(opts.runId, {
            container: {
              container_id: null,
              name: containerName,
              role: opts.containerRole ?? stageId,
              status: "running",
              started_at: Date.now(),
              log_path: `runs/${opts.runId}/containers/stage-${stageId}-${storyId}-${containerAttempt}.log`,
            },
          });
        } catch (err) {
          console.warn(`[realcode-sandbox] live-state pre-spawn write failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      args.push("--name", containerName);
      try {
        const cidDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-cid-"));
        cidFile = path.join(cidDir, "cid");
        args.push("--cidfile", cidFile);
      } catch {
        // mkdtemp failure is non-fatal — container still runs, containerId stays ""
        cidFile = null;
      }
    }

    args.push(image, "run", "--auto", "--format", "json",
      "--model", opts.model,
      "--dir", containerWorkspace,
    );
    if (opts.agentName) {
      args.push("--agent", opts.agentName);
    }
    args.push(opts.dispatchMessage);

    const execPromise = this.exec("docker", args, {}, opts.timeoutMs ?? 300000, opts.workspacePath, logFilePath, opts.onJsonLine);
    // Post-spawn cidfile poll (1-C2): a bounded fire-and-forget poll that
    // populates live.json.container.container_id as soon as Docker writes the
    // cidfile (~200ms × 25 = 5s ceiling). Runs concurrently with the exec
    // await; on timeout container_id stays null and is backfilled by the
    // post-exit cidfile read. Only meaningful when liveCapture is true (it
    // writes live.json) — gated on it so the legacy/build paths take no poll.
    // Never throws.
    const pollPromise = cidFile && opts.runId && opts.liveCapture === true
      ? this.pollCidFile(opts.runId, cidFile)
      : Promise.resolve();
    const result = await execPromise;
    await pollPromise;

    // Read the captured container ID from the cidfile (if one was written).
    // On any read failure, containerId stays "" — never undefined, never
    // crashes downstream readers (BuildLoopRunner writes containers[].container_id).
    // With liveCapture, backfill the resolved cid to live.json (1-C2 post-exit
    // backfill, in case the mid-flight poll timed out).
    if (cidFile && result.containerId === "") {
      try {
        const cid = fs.readFileSync(cidFile, "utf8").trim();
        result.containerId = cid || "";
      } catch {
        result.containerId = "";
      } finally {
        if (cidFile) {
          const cidDir = path.dirname(cidFile);
          try { fs.rmSync(cidDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      }
      if (result.containerId && opts.runId && opts.liveCapture === true) {
        try {
          writeLiveState(opts.runId, { container: { container_id: result.containerId } });
        } catch (err) {
          console.warn(`[realcode-sandbox] live-state cid backfill failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    return result;
  }

  /**
   * Bounded cidfile poll (1-C2). Polls every 200ms up to ~5s (25 iterations).
   * Once the cidfile is readable with non-empty content, writes it into
   * live.json and stops. On timeout, leaves container_id null (backfilled
   * post-exit). Fully try/catch-wrapped — never throws.
   */
  private async pollCidFile(runId: string, cidFile: string): Promise<void> {
    const pollIntervalMs = 200;
    const maxPolls = 25;
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      try {
        const cid = fs.readFileSync(cidFile, "utf8").trim();
        if (cid) {
          writeLiveState(runId, { container: { container_id: cid } });
          return;
        }
      } catch {
        // cidfile not yet written — keep polling
      }
    }
  }

  private exec(cmd: string, args: string[], env: Record<string, string>, timeoutMs: number, cwd: string, logFilePath?: string, onJsonLine?: (ev: unknown) => void): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      // Ensure the cwd exists — spawn() throws ENOENT (misleadingly suggesting
      // the binary is missing) when the cwd doesn't exist. For docker mode the
      // cwd is the workspace path, which may not have been created for orphaned
      // or re-published runs. Fall back to a temp dir if creation fails.
      let spawnCwd = cwd;
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch {
        spawnCwd = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-exec-"));
      }

      const proc = spawn(cmd, args, { env: { ...env, PATH: process.env.PATH }, cwd: spawnCwd, stdio: ["ignore", "pipe", "pipe"] });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
        setTimeout(() => proc.kill("SIGKILL"), 5000);
      }, timeoutMs);

      // Optional tee of the child's stdout+stderr to a log file (A11.1). The
      // file is written under data/runs/{runId}/containers/, already excluded
      // from workspace seeding (INV-8). Wrapped in try/catch — a tee failure
      // must NEVER crash the spawn or lose stdout (stdoutChunks stays the
      // source of truth for SandboxResult.stdout).
      let logStream: NodeJS.WritableStream | null = null;
      if (logFilePath) {
        try {
          fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
          logStream = fs.createWriteStream(logFilePath, { flags: "w" });
          proc.stdout?.pipe(logStream);
          proc.stderr?.pipe(logStream);
        } catch (err) {
          console.warn(`[realcode-sandbox] tee setup failed: ${err instanceof Error ? err.message : String(err)}`);
          logStream = null;
        }
      }

      // In-flight JSON-line buffer (A11.1): accumulates stdout chunks, splits on
      // "\n", and invokes onJsonLine per complete parsed line. Wrapped in
      // try/catch — a throw in the handler logs and continues; stdout collection
      // is unaffected.
      let lineBuffer = "";

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        if (logStream) {
          try { logStream.write(chunk); } catch (err) { console.warn(`[realcode-sandbox] tee write failed: ${err instanceof Error ? err.message : String(err)}`); }
        }
        if (onJsonLine) {
          try {
            lineBuffer += chunk.toString("utf8");
            let nl: number;
            while ((nl = lineBuffer.indexOf("\n")) !== -1) {
              const line = lineBuffer.slice(0, nl).trim();
              lineBuffer = lineBuffer.slice(nl + 1);
              if (!line) continue;
              try {
                onJsonLine(JSON.parse(line) as unknown);
              } catch {
                // skip non-JSON lines (same as parseJsonLines)
              }
            }
          } catch (err) {
            console.warn(`[realcode-sandbox] onJsonLine handler failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrChunks.push(chunk);
        if (logStream) {
          try { logStream.write(chunk); } catch { /* best effort */ }
        }
      });

      const closeLog = () => {
        if (logStream) {
          try { (logStream as { end?: () => void }).end?.(); } catch { /* best effort */ }
        }
      };

      proc.on("close", (code) => {
        clearTimeout(timer);
        closeLog();
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const jsonEvents = stdout ? this.parseJsonLines(stdout) : undefined;
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
          jsonEvents,
          timedOut,
          containerId: "",
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        closeLog();
        resolve({
          exitCode: -1,
          stdout: "",
          stderr: err.message,
          jsonEvents: undefined,
          timedOut: false,
          containerId: "",
        });
      });
    });
  }

  private parseJsonLines(raw: string): unknown[] {
    const events: unknown[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed));
      } catch {
        // skip non-JSON lines (e.g. the formatted output mode)
      }
    }
    return events;
  }

  /**
   * Build the deterministic `--name` value for a sandbox container.
   *
   * Non-build dispatch (A11.1) — `storyId === "stage"` (the non-build sentinel,
   * or `storyId` undefined with `liveCapture:true`): produces
   * `realcode-<runId>-<role>-<attempt>` (no story segment; dots → dashes on
   * runId only).
   *
   * Build-loop dispatch (a real storyId): keeps the existing 4-field form
   * `realcode-<runId>-<storyId>-<role>-<attempt>` byte-identical to the
   * pre-A11.1 output. NOTE: this branch is DEAD CODE today (no dispatch path
   * passes a real storyId — BuildLoopRunner leaves identity fields unset) but
   * is preserved for byte-identity + the post-merge Cartographer-flagged
   * build-loop wiring. Do NOT delete it.
   *
   * Returns `null` when `runId` + `containerRole` + `containerAttempt` are not
   * all present. When `liveCapture` is falsy (the build path / local mode) it
   * additionally requires `storyId` — the pre-A11.1 backward-compat contract
   * (any identity field missing → null → no --name/--cidfile).
   *
   * Deterministic naming is what A4.5/A4.6's force-delete teardown uses to
   * `docker rm -f` running containers before removing the workspace (INV-6)
   * — it reconstructs the name from run_id + role + attempt without a DB
   * lookup.
   */
  static buildContainerName(opts: SandboxOptions): string | null {
    if (!opts.runId || !opts.containerRole || opts.containerAttempt === undefined) {
      return null;
    }
    // storyId defaults to "stage" (non-build sentinel) when undefined AND
    // liveCapture is true (A11.1 non-build dispatch).
    const nonBuild = opts.storyId === "stage"
      || (opts.storyId === undefined && opts.liveCapture === true);
    if (opts.storyId === undefined && opts.liveCapture !== true) {
      // Pre-A11.1 build-path backward-compat: storyId required when liveCapture
      // is falsy (any missing identity field → null → no --name/--cidfile).
      return null;
    }
    const sanitizedRunId = opts.runId.replace(/\./g, "-");
    if (nonBuild) {
      return `realcode-${sanitizedRunId}-${opts.containerRole}-${opts.containerAttempt}`;
    }
    const sanitizedStoryId = opts.storyId!.replace(/\./g, "-");
    return `realcode-${sanitizedRunId}-${sanitizedStoryId}-${opts.containerRole}-${opts.containerAttempt}`;
  }

  static extractTokenUsage(events: unknown[]): { prompt_tokens: number; completion_tokens: number; total_tokens: number; estimated_cost_usd: number } {
    let prompt = 0, completion = 0, total = 0, cost = 0;
    for (const e of events) {
      const ev = e as Record<string, unknown>;
      const part = ev.part as Record<string, unknown> | undefined;
      if (!part) continue;
      const tokens = part.tokens as Record<string, number> | undefined;
      if (tokens) {
        prompt += tokens.input ?? 0;
        completion += tokens.output ?? 0;
        total += tokens.total ?? 0;
        cost += part.cost as number ?? 0;
      }
    }
    return {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      estimated_cost_usd: Number(cost.toFixed(6)),
    };
  }
}
