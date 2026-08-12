import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import { readLiveState } from "../../src/engine/live-state.js";

let tmpDir: string;
let fakeDockerDir: string;
let argvPath: string;
let oldPath: string | undefined;
let oldDataDir: string | undefined;
let oldHostConfig: string | undefined;
let oldHostMissionRoot: string | undefined;

/**
 * Build a fake "docker" binary that:
 *  - dumps its argv (one path per line) to argvPath for --name/--cidfile assertions
 *  - optionally writes the cidfile after cidDelayMs
 *  - optionally sleeps sleepMs (long-running, so the mid-flight cidfile poll fires)
 *  - prints stdoutLines (verbatim) then exits 0
 * Values are interpolated into the script (no env is passed through to the child).
 */
function writeFakeDocker(opts: { cidDelayMs?: number; sleepMs?: number; stdoutLines?: string[] }) {
  const bin = path.join(fakeDockerDir, "fake-docker");
  const cidValue = "fake_live_cid_9876543210";
  const echoLines = (opts.stdoutLines ?? []).map((l) => `echo ${JSON.stringify(l)}`).join("\n");
  // `sleep` takes SECONDS; the opts are millis → divide by 1000 (coreutils
  // accepts fractional seconds like "0.4", "1.5").
  const delay = opts.cidDelayMs ? `sleep ${opts.cidDelayMs / 1000}` : "";
  const stay = opts.sleepMs ? `sleep ${opts.sleepMs / 1000}` : "";
  fs.writeFileSync(
    bin,
    `#!/usr/bin/env bash
printf '%s\\n' "$@" > "${argvPath}"
args=("$@")
cid=""
for ((i=0;i<${"${#args[@]}"};i++)); do
  if [ "${"${args[i]}"}" = "--cidfile" ]; then
    cid="${"${args[i+1]}"}"
  fi
done
${delay}
if [ -n "${"${cid}"}" ]; then printf '%s' "${cidValue}" > "${"${cid}"}"; fi
${stay}
${echoLines}
exit 0
`,
  );
  fs.chmodSync(bin, 0o755);
  fs.symlinkSync(bin, path.join(fakeDockerDir, "docker"));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livecap-"));
  fakeDockerDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-fake-docker-"));
  argvPath = path.join(fakeDockerDir, "argv.txt");
  oldPath = process.env.PATH;
  process.env.PATH = `${fakeDockerDir}:${oldPath ?? ""}`;
  oldDataDir = process.env.REALCODE_DATA_DIR;
  process.env.REALCODE_DATA_DIR = tmpDir;
  // Suppress secret-scan + host-mount warnings/env.
  oldHostConfig = process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR;
  oldHostMissionRoot = process.env.REALCODE_HOST_MISSION_CONTROL_ROOT;
  delete process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR;
  delete process.env.REALCODE_HOST_MISSION_CONTROL_ROOT;
  delete process.env.REALCODE_OPENCODE_CONFIG_DIR;
});

afterEach(() => {
  if (oldPath !== undefined) process.env.PATH = oldPath;
  if (oldDataDir !== undefined) process.env.REALCODE_DATA_DIR = oldDataDir;
  else delete process.env.REALCODE_DATA_DIR;
  if (oldHostConfig !== undefined) process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR = oldHostConfig;
  else delete process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR;
  if (oldHostMissionRoot !== undefined) process.env.REALCODE_HOST_MISSION_CONTROL_ROOT = oldHostMissionRoot;
  else delete process.env.REALCODE_HOST_MISSION_CONTROL_ROOT;
  fs.rmSync(fakeDockerDir, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function livePath(runId: string): string {
  return path.join(tmpDir, "runs", runId, "live.json");
}

describe("sandbox/runner live capture (A11.1)", () => {
  it("runDocker with liveCapture:true populates live.json.container at spawn + a non-null container_id + a tee log (1-C2)", async () => {
    // Fake docker: writes the cidfile after 400ms, stays up ~1.5s so the
    // mid-flight poll (200ms x 25) reads the cid while exec is still running.
    writeFakeDocker({
      cidDelayMs: 400,
      sleepMs: 1500,
      stdoutLines: [`{"part":{"type":"text","text":"c1","tokens":{"total":1},"cost":0.001}}`],
    });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livecap-ws-"));
    const runner = new SandboxRunner();
    const onJsonLine = vi.fn();
    const result = await runner.run({
      workspacePath: ws,
      model: "m",
      dispatchMessage: "x",
      localMode: false,
      runId: "run_live",
      stageId: "frame",
      containerRole: "frame",
      containerAttempt: 0,
      storyId: "stage",
      liveCapture: true,
      onJsonLine,
    });

    expect(result.exitCode).toBe(0);
    const state = readLiveState("run_live")!;
    expect(state).not.toBeNull();
    expect(state.container).not.toBeNull();
    expect(state.container!.name).toBe("realcode-run_live-frame-0");
    expect(state.container!.role).toBe("frame");
    // log_path + log file under the data dir (resolved from REALCODE_DATA_DIR).
    expect(state.container!.log_path).toBe("runs/run_live/containers/stage-frame-0.log");
    expect(fs.existsSync(path.join(tmpDir, "runs", "run_live", "containers", "stage-frame-0.log"))).toBe(true);
    // container_id populated non-null (by the mid-flight poll).
    expect(state.container!.container_id).toBe("fake_live_cid_9876543210");
    expect(state.container!.status).toBe("running");
    // The tee log file has content (the fake's stdout).
    const logContent = fs.readFileSync(path.join(tmpDir, "runs", "run_live", "containers", "stage-frame-0.log"), "utf8");
    expect(logContent).toContain("c1");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("exec() tees stdout to the log file + fires onJsonLine per JSON line + SandboxResult is unchanged (tee/onJsonLine fail-safe)", async () => {
    const lines = [
      `{"part":{"type":"text","text":"line-one","tokens":{"total":1},"cost":0.001}}`,
      `{"part":{"type":"text","text":"line-two","tokens":{"total":1},"cost":0.001}}`,
      `{"part":{"type":"tool_use","tool":"bash","text":"line-three","tokens":{"total":1},"cost":0.001}}`,
    ];
    writeFakeDocker({ stdoutLines: lines });
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livecap-ws-"));
    const runner = new SandboxRunner();
    const parsed: unknown[] = [];
    const result = await runner.run({
      workspacePath: ws,
      model: "m",
      dispatchMessage: "x",
      localMode: false,
      runId: "run_tee",
      stageId: "discover",
      containerRole: "discover",
      containerAttempt: 0,
      storyId: "stage",
      liveCapture: true,
      onJsonLine: (ev) => { parsed.push(ev); },
    });

    expect(result.exitCode).toBe(0);
    // onJsonLine fired once per line, with the parsed event objects.
    expect(parsed).toHaveLength(3);
    expect((parsed[0] as { part: { text: string } }).part.text).toBe("line-one");
    expect((parsed[2] as { part: { text: string } }).part.text).toBe("line-three");
    // The tee log file captured all 3 lines.
    const logContent = fs.readFileSync(path.join(tmpDir, "runs", "run_tee", "containers", "stage-discover-0.log"), "utf8");
    for (const l of lines) expect(logContent).toContain(l.slice(0, 30));
    // SandboxResult contract is unchanged: full stdout + jsonEvents still parsed.
    expect(result.stdout).toContain("line-one");
    expect(result.jsonEvents).toHaveLength(3);
    expect((result.jsonEvents![0] as { part: { text: string } }).part.text).toBe("line-one");
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("runDocker with liveCapture falsy passes no --name/--cidfile and writes no live.json (build-path byte-identity)", async () => {
    writeFakeDocker({});
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livecap-ws-"));
    const runner = new SandboxRunner();
    // Exactly the A4.3 dead-path shape: identity fields present, liveCapture falsy
    // → no --name/--cidfile because buildContainerName gate... actually the block
    // DOES fire for identity fields (buildContainerName non-null). This is the
    // BUILD path shape: NO identity fields at all.
    const result = await runner.run({
      workspacePath: ws,
      model: "m",
      dispatchMessage: "x",
      localMode: false,
      // No runId/storyId/containerRole/containerAttempt/liveCapture — build path.
    });

    expect(result.exitCode).toBe(0);
    const argv = fs.readFileSync(argvPath, "utf8");
    expect(argv).not.toContain("--name");
    expect(argv).not.toContain("--cidfile");
    // No live.json written (build path has no live capture).
    expect(fs.existsSync(livePath("none"))).toBe(false);
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it("liveCapture falsy with the A4.3 four-identity-fields shape passes --name/--cidfile but writes NO live.json or tee log", async () => {
    writeFakeDocker({});
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-livecap-ws-"));
    const runner = new SandboxRunner();
    const result = await runner.run({
      workspacePath: ws,
      model: "m",
      dispatchMessage: "x",
      localMode: false,
      runId: "run_legacy",
      storyId: "3.1",
      containerRole: "worker",
      containerAttempt: 0,
      // liveCapture: false
    });

    expect(result.exitCode).toBe(0);
    const argv = fs.readFileSync(argvPath, "utf8");
    expect(argv).toContain("--name");
    expect(argv).toContain("--cidfile");
    // No live.json and no tee log for the legacy (non-live-capture) path.
    expect(fs.existsSync(livePath("run_legacy"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "runs", "run_legacy"))).toBe(false);
    fs.rmSync(ws, { recursive: true, force: true });
  });
});