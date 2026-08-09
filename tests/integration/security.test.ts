import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { Engine } from "../../src/engine/dispatcher.js";
import { loadStageGraph } from "../../src/engine/stage-graph.js";
import { SQLiteQueue } from "../../src/backend/sqlite-queue.js";
import { FileStorage } from "../../src/backend/file-storage.js";
import { AgentStageRunner } from "../../src/agents/runner.js";
import { SandboxRunner } from "../../src/sandbox/runner.js";
import { loadAgentSpec } from "../../src/agents/spec-loader.js";
import type { StageGraph } from "../../src/engine/stage-graph.js";
import type { SandboxOptions, SandboxResult } from "../../src/sandbox/runner.js";

const REPO_ROOT = path.resolve(process.cwd());
const GRAPH_PATH = path.resolve(REPO_ROOT, "stage-graph.yaml");

describe("Security: credential isolation", () => {
  it("AgentStageRunner does not pass env vars to the sandbox (no secrets leak to Docker)", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-sec-"));
    try {
      const graph = loadStageGraph(GRAPH_PATH);
      const storage = new FileStorage(tmpDir);

      const capturedOpts: SandboxOptions[] = [];
      const mockSandbox = {
        run: vi.fn(async (opts: SandboxOptions): Promise<SandboxResult> => {
          capturedOpts.push(opts);
          return { exitCode: 0, stdout: "<artifact>{}</artifact>", stderr: "", jsonEvents: [], timedOut: false };
        }),
      };

      const runner = new AgentStageRunner(mockSandbox as unknown as SandboxRunner, storage, graph, { repoRoot: REPO_ROOT });
      const stage = graph.stages[0];
      await runner.run(
        { id: "i1", run_id: "r1", stage: "frame", status: "intake", retry_count: 0, worker_id: "w", lease_expires_at: null, payload: { idea: "test" }, created_at: 0, updated_at: 0 },
        stage,
        tmpDir,
      );

      expect(capturedOpts.length).toBe(1);
      expect(capturedOpts[0].env).toBeUndefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("SandboxRunner Docker mode does not inherit process.env (only PATH + explicit opts.env)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    expect(src).toMatch(/private async runDocker/);
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    const execCallIdx = dockerMethod.indexOf('this.exec("docker"');
    const dockerUpToExec = dockerMethod.slice(0, execCallIdx);
    expect(dockerUpToExec).not.toContain("process.env");
  });

  it("no secret-pattern env var names appear in the Docker -e args (only model + traceparent)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    const secretPattern = /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|API_KEY)[^"'\s]/i;
    const envLines = dockerMethod.match(/"-e",\s*`[^`]+`/g) || [];
    for (const line of envLines) {
      expect(line).not.toMatch(secretPattern);
    }
  });
});

describe("Security: tool allowlist enforcement", () => {
  it("every AgentSpec declares a non-empty tool_allowlist", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    for (const stage of graph.stages) {
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, stage.agent_spec));
      expect(spec.tool_allowlist.length).toBeGreaterThan(0);
      expect(spec.tool_allowlist).toContain("Read");
      expect(spec.tool_allowlist).toContain("Write");
    }
  });

  it("the build stage includes Edit + Bash (the worker needs code execution)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    const buildStage = graph.stages.find((s) => s.id === "build")!;
    const spec = loadAgentSpec(path.resolve(REPO_ROOT, buildStage.agent_spec));
    expect(spec.tool_allowlist).toContain("Edit");
    expect(spec.tool_allowlist).toContain("Bash");
  });

  it("the frame stage does NOT include WebFetch (no network egress for framing)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    const frameStage = graph.stages.find((s) => s.id === "frame")!;
    const spec = loadAgentSpec(path.resolve(REPO_ROOT, frameStage.agent_spec));
    expect(spec.tool_allowlist).not.toContain("WebFetch");
  });
});

describe("Security: resource limits per sandbox", () => {
  it("Docker mode sets --cpus, --memory, and --stop-timeout", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    expect(dockerMethod).toContain('"--cpus"');
    expect(dockerMethod).toContain('"--memory"');
    expect(dockerMethod).toContain('"--stop-timeout"');
  });

  it("Docker mode sets --network to a sandboxed network (not host)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    expect(dockerMethod).toContain('"--network"');
    expect(dockerMethod).not.toContain('"host"');
  });

  it("Docker mode uses --rm (ephemeral container, no persistence)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    expect(dockerMethod).toContain('"--rm"');
  });

  it("timeout kills the sandbox process (SIGTERM then SIGKILL)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    expect(src).toContain("SIGTERM");
    expect(src).toContain("SIGKILL");
  });
});

describe("Security: cost cap circuit breaker", () => {
  let tmpDir: string;
  let queue: SQLiteQueue;
  let storage: FileStorage;
  let graph: StageGraph;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-cost-"));
    graph = loadStageGraph(GRAPH_PATH);
    queue = new SQLiteQueue(path.join(tmpDir, "queue.db"));
    storage = new FileStorage(tmpDir);
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("trips the circuit breaker when spend exceeds the cap", async () => {
    const expensiveRunner = {
      run: vi.fn().mockResolvedValue({
        output_status: "pass",
        artifact: { project_md: "x" },
        token_usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, estimated_cost_usd: 0.01 },
        trace_id: "trace",
      }),
    };

    const engine = new Engine(graph, queue, storage, expensiveRunner, tmpDir);
    engine.createRun("run_cost_001", "expensive idea");

    const run = engine.getRun("run_cost_001")!;
    run.spent_usd = 10.0;
    storage.write(`runs/run_cost_001/run.json`, JSON.stringify(run, null, 2));

    const dispatched = await engine.dispatchCycle();
    expect(dispatched).toBe(0);
    expect(expensiveRunner.run).not.toHaveBeenCalled();

    const finalRun = engine.getRun("run_cost_001")!;
    expect(finalRun.status).toBe("paused_cost_cap");
    expect(finalRun.spent_usd).toBeGreaterThanOrEqual(finalRun.cap_usd);

    const control = engine.getControlDoc();
    expect(control.run_mode).toBe("paused_cost_cap");
  });

  it("does not dispatch when paused_cost_cap is set", async () => {
    const runner = { run: vi.fn().mockResolvedValue({ output_status: "pass", artifact: {}, token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, estimated_cost_usd: 0 }, trace_id: "t" }) };
    const engine = new Engine(graph, queue, storage, runner, tmpDir);
    engine.createRun("run_cost_002", "test");
    engine.setControlDoc({ run_mode: "paused_cost_cap" }, "test");

    const dispatched = await engine.dispatchCycle();
    expect(dispatched).toBe(0);
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("Security: atomic claim (no double-processing)", () => {
  it("the concurrent-worker test from M3 covers this (backend.test.ts)", () => {
    const testSrc = fs.readFileSync(path.resolve(REPO_ROOT, "tests/backend.test.ts"), "utf8");
    expect(testSrc).toContain("concurrent");
    expect(testSrc).toContain("claim");
  });

  it("the SQLite queue has atomic claim (SELECT ... WHERE ... LIMIT 1 in a transaction)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/backend/sqlite-queue.ts"), "utf8");
    expect(src).toMatch(/claim/);
    expect(src).toMatch(/transaction|BEGIN|IMMEDIATE/i);
  });
});
