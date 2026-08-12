import { describe, it, expect } from "vitest";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("sandbox/runner: container naming + cidfile (A4.3)", () => {
  it("buildContainerName produces realcode-<runId>-<storyId>-<role>-<attempt>", () => {
    const name = SandboxRunner.buildContainerName({
      workspacePath: "/data/runs/r1/ws",
      model: "m",
      dispatchMessage: "x",
      runId: "run_abc",
      storyId: "3.1",
      containerRole: "worker",
      containerAttempt: 0,
    });
    // Format: realcode-<run_id>-<story_id>-<role>-<attempt> (dots → dashes).
    // story_id "3.1" → "3-1". No "story-" prefix.
    expect(name).toBe("realcode-run_abc-3-1-worker-0");
  });

  it("sanitizes dots in BOTH runId AND storyId (valid Docker container names)", () => {
    const name = SandboxRunner.buildContainerName({
      workspacePath: "/x",
      model: "m",
      dispatchMessage: "x",
      runId: "run.2026.08.12",
      storyId: "A.4.3",
      containerRole: "validator",
      containerAttempt: 2,
    });
    expect(name).toBe("realcode-run-2026-08-12-A-4-3-validator-2");
    expect(name).not.toContain(".");
  });

  it("returns null when ANY of the four identity fields is missing (non-build-dispatch backward-compat)", () => {
    const base = {
      workspacePath: "/x",
      model: "m",
      dispatchMessage: "x",
      runId: "r1",
      storyId: "s1",
      containerRole: "worker",
      containerAttempt: 0,
    } as const;
    expect(SandboxRunner.buildContainerName({ ...base, runId: undefined })).toBeNull();
    expect(SandboxRunner.buildContainerName({ ...base, storyId: undefined })).toBeNull();
    expect(SandboxRunner.buildContainerName({ ...base, containerRole: undefined })).toBeNull();
    expect(SandboxRunner.buildContainerName({ ...base, containerAttempt: undefined })).toBeNull();
    // No identity fields at all (the common AgentStageRunner frame/discover/plan/spec/ship case).
    expect(SandboxRunner.buildContainerName({
      workspacePath: "/x",
      model: "m",
      dispatchMessage: "x",
    })).toBeNull();
  });

  it("SandboxResult interface has a containerId: string field (never undefined)", () => {
    // Source-level assertion: the field is declared on the interface.
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/sandbox/runner.ts"), "utf8");
    // The interface declares containerId: string (required, not optional).
    const ifaceMatch = src.match(/export interface SandboxResult[\s\S]*?\}/);
    expect(ifaceMatch).not.toBeNull();
    expect(ifaceMatch![0]).toMatch(/containerId:\s*string/);
    // The exec() close + error handlers both set containerId: "".
    const closeMatch = src.match(/proc\.on\("close"[\s\S]*?\}\);/);
    expect(closeMatch).not.toBeNull();
    expect(closeMatch![0]).toContain('containerId: ""');
    const errorMatch = src.match(/proc\.on\("error"[\s\S]*?\}\);/);
    expect(errorMatch).not.toBeNull();
    expect(errorMatch![0]).toContain('containerId: ""');
  });

  it("runDocker passes --name and --cidfile when identity fields are present (source-level)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    expect(dockerMethod).toContain('args.push("--name", containerName)');
    expect(dockerMethod).toContain('args.push("--cidfile", cidFile)');
  });

  it("runDocker reads the cidfile after spawn close and falls back to \"\" on read failure (source-level)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    expect(dockerMethod).toContain("readFileSync(cidFile");
    // The fallback: on read failure, containerId stays "".
    expect(dockerMethod).toMatch(/catch[\s\S]*?result\.containerId\s*=\s*""/);
  });

  it("a real runDocker call with identity fields populates containerId from the cidfile (integration: mock docker via a fake script)", async () => {
    // We can't spawn real docker in a unit test, but we CAN verify the
    // containerId-population logic by pointing runDocker at a fake "docker"
    // binary that writes a known cid to the cidfile. This exercises the
    // mkdtemp → --cidfile → readFileSync → containerId path end-to-end.
    const fakeDockerDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-fake-docker-"));
    const fakeDockerBin = path.join(fakeDockerDir, "fake-docker");
    // The fake docker script: writes the cidfile arg's path's content, then
    // echoes a fake stdout so the rest of runDocker's parsing doesn't crash.
    const cidfileFlag = "--cidfile";
    fs.writeFileSync(
      fakeDockerBin,
      `#!/usr/bin/env bash
# Find the --cidfile <path> argument and write a fake container ID to it.
# Capture arg count up front so shrinking \$# via shift doesn't terminate the
# loop early.
total=$#
for ((i=0; i<total; i++)); do
  arg="$1"; shift
  if [ "$arg" = "${cidfileFlag}" ]; then
    echo "fakecontainerid1234567890" > "$1"; shift
  fi
done
echo '{"part":{"tokens":{"input":0,"output":0,"total":0},"cost":0}}'
exit 0
`,
    );
    fs.chmodSync(fakeDockerBin, 0o755);

    try {
      // SandboxRunner constructor takes (opencodeBin, hostDataDir). We override
      // the docker binary by setting the PATH to include our fake-docker dir,
      // and naming the binary "docker" — but runDocker calls exec("docker", ...).
      // Simplest: symlink "docker" → fake-docker in the temp dir.
      const fakeDockerSymlink = path.join(fakeDockerDir, "docker");
      fs.symlinkSync(fakeDockerBin, fakeDockerSymlink);

      const oldPath = process.env.PATH;
      process.env.PATH = `${fakeDockerDir}:${oldPath ?? ""}`;
      // Prevent the secret-scan gate from firing: unset REALCODE_OPENCODE_CONFIG_DIR.
      const oldConfig = process.env.REALCODE_OPENCODE_CONFIG_DIR;
      delete process.env.REALCODE_OPENCODE_CONFIG_DIR;

      const runner = new SandboxRunner();
      const result = await runner.run({
        workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), "realcode-ws-")),
        model: "m",
        dispatchMessage: "x",
        localMode: false,
        runId: "run_test",
        storyId: "3.1",
        containerRole: "worker",
        containerAttempt: 0,
      });

      process.env.PATH = oldPath;
      if (oldConfig !== undefined) process.env.REALCODE_OPENCODE_CONFIG_DIR = oldConfig;

      expect(result.exitCode).toBe(0);
      expect(result.containerId).toBe("fakecontainerid1234567890");
    } finally {
      fs.rmSync(fakeDockerDir, { recursive: true, force: true });
    }
  });
});
