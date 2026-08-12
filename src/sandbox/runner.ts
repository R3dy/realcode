import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { discoverMcpPaths } from "./mcp-discovery.js";
import { scanForSecrets } from "./secret-scan.js";

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
   * BuildLoopRunner (A4.2) populates the following four fields when it
   * dispatches a per-story Worker/Validator sandbox so the container gets a
   * deterministic name + cidfile capture. When undefined (the non-build
   * dispatch path — e.g. AgentStageRunner dispatching frame/discover/plan/
   * spec/ship), runDocker omits the --name/--cidfile flags so those call sites
   * keep working unchanged.
   */
  containerName?: string;
  containerRole?: string;
  containerAttempt?: number;
  storyId?: string;
  runId?: string;
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
    const containerDataDir = process.env.REALCODE_DATA_DIR || "/data";
    const hostDataDir = this.hostDataDir || process.env.REALCODE_HOST_DATA_DIR || containerDataDir;
    const hostWorkspacePath = hostDataDir === containerDataDir
      ? opts.workspacePath
      : opts.workspacePath.replace(containerDataDir, hostDataDir);

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

    // ─── Container naming + cidfile capture (A4.3) ──────────────────────
    // The BuildLoopRunner (A4.2) populates containerName/role/attempt/storyId/
    // runId on SandboxOptions when dispatching a per-story Worker/Validator
    // sandbox. When all four identity fields are present, pass `--name
    // realcode-<runId>-<storyId>-<role>-<attempt>` (dots → dashes so the value
    // is a valid Docker container name) + `--cidfile <tmpfile>` so the
    // container ID is captured into SandboxResult.containerId. When ANY of
    // the four is missing (the non-build-dispatch backward-compat path — e.g.
    // AgentStageRunner dispatching frame/discover/plan/spec/ship), omit both
    // flags so those call sites keep working unchanged.
    let cidFile: string | null = null;
    if (opts.runId && opts.storyId && opts.containerRole && opts.containerAttempt !== undefined) {
      const sanitizedStoryId = opts.storyId.replace(/\./g, "-");
      const sanitizedRunId = opts.runId.replace(/\./g, "-");
      const containerName = `realcode-${sanitizedRunId}-${sanitizedStoryId}-${opts.containerRole}-${opts.containerAttempt}`;
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

    const result = await this.exec("docker", args, {}, opts.timeoutMs ?? 300000, opts.workspacePath);

    // Read the captured container ID from the cidfile (if one was written).
    // On any read failure, containerId stays "" — never undefined, never
    // crashes downstream readers (BuildLoopRunner writes containers[].container_id).
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
    }

    return result;
  }

  private exec(cmd: string, args: string[], env: Record<string, string>, timeoutMs: number, cwd: string): Promise<SandboxResult> {
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

      proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("close", (code) => {
        clearTimeout(timer);
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
