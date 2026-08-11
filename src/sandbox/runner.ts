import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";

export interface SandboxOptions {
  workspacePath: string;
  model: string;
  agentName?: string;
  dispatchMessage: string;
  traceparent?: string;
  timeoutMs?: number;
  localMode?: boolean;
  env?: Record<string, string>;
}

export interface SandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  jsonEvents?: unknown[];
  timedOut: boolean;
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
    const args = [
      "run", "--rm",
      "--cpus", "2",
      "--memory", "2g",
      "--stop-timeout", String(Math.ceil((opts.timeoutMs ?? 300000) / 1000)),
      "--network", "realcode-sandbox-net",
      "-v", `${hostWorkspacePath}:${containerWorkspace}:rw`,
      "-e", `OTEL_TRACEPARENT=${opts.traceparent ?? ""}`,
      "-e", `OPENCODE_MODEL=${opts.model}`,
      ...Object.entries(opts.env || {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      image,
      "run", "--auto", "--format", "json",
      "--model", opts.model,
      "--dir", containerWorkspace,
    ];
    if (opts.agentName) {
      args.push("--agent", opts.agentName);
    }
    args.push(opts.dispatchMessage);

    return this.exec("docker", args, {}, opts.timeoutMs ?? 300000, opts.workspacePath);
  }

  private exec(cmd: string, args: string[], env: Record<string, string>, timeoutMs: number, cwd: string): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      const proc = spawn(cmd, args, { env: { ...env, PATH: process.env.PATH }, cwd, stdio: ["ignore", "pipe", "pipe"] });

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
