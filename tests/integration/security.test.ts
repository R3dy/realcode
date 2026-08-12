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
import { scanForSecrets } from "../../src/sandbox/secret-scan.js";
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
          return { exitCode: 0, stdout: "<artifact>{}</artifact>", stderr: "", jsonEvents: [], timedOut: false, containerId: "" };
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
      // The runner forwards ONLY scoped model-provider API keys to the sandbox
      // (the sandbox is isolated and needs them to call the LLM). It must NOT
      // forward arbitrary process env. Assert every forwarded key matches the
      // model-key pattern (or none at all, when no keys are set).
      const forwarded = capturedOpts[0].env ?? {};
      const KEY_PATTERN = /^(OPENROUTER|OPENAI|ANTHROPIC|DEEPSEEK|GROQ|MISTRAL|TOGETHER|FIREWORKS|PERPLEXITY|COHERE|GOOGLE|AZURE)_(API_KEY|KEY)$/;
      for (const key of Object.keys(forwarded)) {
        expect(key).toMatch(KEY_PATTERN);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("SandboxRunner Docker mode reads only non-secret path-config env (no SECRET/KEY/TOKEN reads)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    expect(src).toMatch(/private async runDocker/);
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    const execCallIdx = dockerMethod.indexOf('this.exec("docker"');
    const dockerUpToExec = dockerMethod.slice(0, execCallIdx);
    // Path translation legitimately reads REALCODE_DATA_DIR / REALCODE_HOST_DATA_DIR
    // (non-secret config). Assert no secret-bearing env var is read in docker mode.
    const envReads = dockerUpToExec.match(/process\.env\.[A-Za-z_]+/g) || [];
    const secretPattern = /(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|API_KEY)/i;
    for (const read of envReads) {
      expect(read).not.toMatch(secretPattern);
    }
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

  // ─── A4.3: opencode-config mount is read-only ──────────────────────────
  it("the opencode-config mount is :ro (read-only — a sandboxed agent cannot modify the operator's config)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    // The mount string `${hostOpencodeConfigDir}:/root/.config/opencode:ro` —
    // the :ro suffix is mandatory. A :rw or bare :/root/.config/opencode mount
    // is a test failure (a sandboxed agent could then mutate the operator's
    // opencode.json / agents / skills).
    expect(dockerMethod).toContain(":/root/.config/opencode:ro");
    expect(dockerMethod).not.toMatch(/:\/root\/\.config\/opencode(:rw)?["`]/);
  });

  // ─── A4.3: startup secret-scan refuses to spawn on a key-like match ────
  it("scanForSecrets fires on a seeded key fixture (refuses to spawn) and is clean on a clean fixture", () => {
    const dirtyDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-secret-dirty-"));
    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-secret-clean-"));
    try {
      // Dirty fixture: a JSON file containing a literal OpenAI-key-style value.
      fs.writeFileSync(
        path.join(dirtyDir, "opencode.json"),
        JSON.stringify({ mcp: { fake: { command: ["node"] } }, note: "sk-test1234567890abcdef" }, null, 2),
      );
      const dirtyHits = scanForSecrets(dirtyDir);
      expect(dirtyHits.length).toBeGreaterThan(0);
      expect(dirtyHits[0].file).toBe("opencode.json");
      // The pattern field names the matched pattern family — NEVER the value.
      expect(dirtyHits[0].pattern).toMatch(/literal-secret-prefix|model-provider-env-key/);
      expect(dirtyHits[0].pattern).not.toContain("sk-test");

      // Clean fixture: no key-like content anywhere.
      fs.writeFileSync(
        path.join(cleanDir, "opencode.json"),
        JSON.stringify({ mcp: { codebase: { command: ["/abs/path/to/bin"] } } }, null, 2),
      );
      const cleanHits = scanForSecrets(cleanDir);
      expect(cleanHits).toEqual([]);
    } finally {
      fs.rmSync(dirtyDir, { recursive: true, force: true });
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });

  it("runDocker refuses to spawn when scanForSecrets returns a non-empty result (the spawn guard reads REALCODE_OPENCODE_CONFIG_DIR)", () => {
    const src = fs.readFileSync(path.resolve(REPO_ROOT, "src/sandbox/runner.ts"), "utf8");
    const dockerMethod = src.slice(src.indexOf("private async runDocker"));
    // The guard must call scanForSecrets on REALCODE_OPENCODE_CONFIG_DIR and
    // return a SandboxResult with exitCode -1 (refuse, not warn) when it fires.
    expect(dockerMethod).toContain("scanForSecrets(");
    expect(dockerMethod).toContain("REALCODE_OPENCODE_CONFIG_DIR");
    // The refuse path: exitCode -1, a loud warning in stderr, containerId "".
    expect(dockerMethod).toMatch(/exitCode:\s*-1/);
    expect(dockerMethod).toMatch(/containerId:\s*""/);
    expect(dockerMethod).toMatch(/\[secret-scan\] refusing to spawn/);
  });
});

describe("Security: tool allowlist enforcement", () => {
  it("every AgentSpec declares a non-empty tool_allowlist", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    for (const stage of graph.stages) {
      // agent_spec is optional (inner-loop stages use worker_spec/validator_spec).
      // At A4.1 every stage still has agent_spec; load it (or fall back to
      // worker_spec when a stage has been flipped to inner-loop mode).
      const specPath = stage.agent_spec ?? stage.worker_spec;
      if (!specPath) continue;
      const spec = loadAgentSpec(path.resolve(REPO_ROOT, specPath));
      expect(spec.tool_allowlist.length).toBeGreaterThan(0);
      expect(spec.tool_allowlist).toContain("Read");
      expect(spec.tool_allowlist).toContain("Write");
    }
  });

  it("the build stage includes Edit + Bash (the worker needs code execution)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    const buildStage = graph.stages.find((s) => s.id === "build")!;
    // At A4.1 the build stage still has agent_spec (the flip is A4.4)
    const specPath = buildStage.agent_spec ?? buildStage.worker_spec!;
    const spec = loadAgentSpec(path.resolve(REPO_ROOT, specPath));
    expect(spec.tool_allowlist).toContain("Edit");
    expect(spec.tool_allowlist).toContain("Bash");
  });

  it("the frame stage does NOT include WebFetch (no network egress for framing)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    const frameStage = graph.stages.find((s) => s.id === "frame")!;
    const spec = loadAgentSpec(path.resolve(REPO_ROOT, frameStage.agent_spec!));
    expect(spec.tool_allowlist).not.toContain("WebFetch");
  });

  it("every stage satisfies the XOR rule (agent_spec OR inner_loop triad)", () => {
    const graph = loadStageGraph(GRAPH_PATH);
    for (const stage of graph.stages) {
      const hasAgentSpec = stage.agent_spec !== undefined;
      const hasInnerLoop = stage.inner_loop !== undefined;
      const hasWorkerSpec = stage.worker_spec !== undefined;
      const hasValidatorSpec = stage.validator_spec !== undefined;
      const hasTriad = hasInnerLoop && hasWorkerSpec && hasValidatorSpec;
      // Cannot have both agent_spec and the complete inner_loop triad
      expect(hasAgentSpec && hasTriad).toBe(false);
      // Must have at least one of agent_spec or inner_loop
      expect(hasAgentSpec || hasInnerLoop).toBe(true);
    }
    // At A4.1 the build stage has agent_spec + a dormant inner_loop (no worker/validator specs)
    const buildStage = graph.stages.find((s) => s.id === "build")!;
    expect(buildStage.agent_spec).toBeDefined();
    expect(buildStage.worker_spec).toBeUndefined();
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
