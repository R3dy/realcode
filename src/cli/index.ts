import { Command } from "commander";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import { loadStageGraph, Engine, BuildLoopRunner } from "../engine/index.js";
import { SQLiteQueue, FileStorage } from "../backend/index.js";
import { SandboxRunner } from "../sandbox/index.js";
import { AgentStageRunner } from "../agents/index.js";
import type { WorkItem } from "../backend/types.js";

const program = new Command();

program
  .name("realcode")
  .description("Autonomous idea-to-shipped harness that wraps the anymake build system")
  .version("0.1.0");

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), ".realcode-data");
const DEFAULT_GRAPH = path.resolve(process.cwd(), "stage-graph.yaml");

function getEngine(dataDir?: string, graphPath?: string) {
  const dir = dataDir || DEFAULT_DATA_DIR;
  const graph = graphPath || DEFAULT_GRAPH;
  fs.mkdirSync(dir, { recursive: true });
  const stageGraph = loadStageGraph(graph);
  const queue = new SQLiteQueue(path.join(dir, "queue.db"));
  const storage = new FileStorage(dir);
  const sandbox = new SandboxRunner();
  const runner = new AgentStageRunner(sandbox, storage, stageGraph, {
    localMode: true,
    repoRoot: process.cwd(),
  });
  const buildLoop = new BuildLoopRunner(runner, storage, stageGraph, queue, { repoRoot: process.cwd() });

  return { engine: new Engine(stageGraph, queue, storage, runner, dir, buildLoop), stageGraph, queue, storage };
}

program
  .command("run <idea>")
  .description("Start a new run from a raw idea")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .option("-g, --graph <path>", "stage-graph.yaml path", DEFAULT_GRAPH)
  .action(async (idea: string, opts: { dataDir: string; graph: string }) => {
    const { engine } = getEngine(opts.dataDir, opts.graph);
    const runId = `run_${randomUUID().slice(0, 8)}`;
    const run = engine.createRun(runId, idea);
    console.log(`Started run ${runId}: "${idea}"`);
    console.log(`Status: ${run.status}`);
    console.log(`Workspace: ${run.workspace_path}`);
    console.log(`Cost cap: $${run.cap_usd.toFixed(2)}`);
    console.log(`\nRun 'realcode status' to check progress, or 'realcode trace ${runId}' for the trace.`);
  });

program
  .command("step")
  .description("Set run mode to step (advance one stage, then re-pause)")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .action((opts: { dataDir: string }) => {
    const { engine } = getEngine(opts.dataDir);
    engine.setControlDoc({ run_mode: "step" }, "cli");
    console.log("Run mode set to: step (will advance one stage then re-pause)");
  });

program
  .command("pause")
  .description("Pause the engine")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .action((opts: { dataDir: string }) => {
    const { engine } = getEngine(opts.dataDir);
    engine.setControlDoc({ run_mode: "paused" }, "cli");
    console.log("Engine paused. Run 'realcode resume' to continue.");
  });

program
  .command("resume")
  .description("Resume the engine (set to continuous mode)")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .action(async (opts: { dataDir: string }) => {
    const { engine } = getEngine(opts.dataDir);
    engine.setControlDoc({ run_mode: "continuous" }, "cli");
    console.log("Engine resumed (continuous mode). Dispatching...");
    const dispatched = await engine.dispatchCycle();
    console.log(`Dispatched ${dispatched} stage(s).`);
  });

program
  .command("status")
  .description("List all runs and their current stage/status")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .action((opts: { dataDir: string }) => {
    const { engine } = getEngine(opts.dataDir);
    const runs = engine.listRuns();
    if (runs.length === 0) {
      console.log("No runs yet. Start one with: realcode run \"your idea\"");
      return;
    }
    const control = engine.getControlDoc();
    console.log(`Engine mode: ${control.run_mode} | concurrency: ${control.concurrency}\n`);
    for (const run of runs) {
      const costPct = ((run.spent_usd / run.cap_usd) * 100).toFixed(0);
      console.log(`  ${run.run_id}  ${run.status.padEnd(20)}  $${run.spent_usd.toFixed(2)}/$${run.cap_usd.toFixed(2)} (${costPct}%)  "${run.idea.slice(0, 50)}"`);
    }
    const escalated = runs.filter((r) => r.status.endsWith("_failed") || r.status === "escalated" || r.status === "paused_cost_cap");
    if (escalated.length > 0) {
      console.log(`\n  ${escalated.length} run(s) need attention (escalated/paused).`);
    }
  });

program
  .command("trace <runId>")
  .description("Print the trace for a run")
  .option("-d, --data-dir <path>", "data directory", DEFAULT_DATA_DIR)
  .action((runId: string, opts: { dataDir: string }) => {
    const { engine } = getEngine(opts.dataDir);
    const run = engine.getRun(runId);
    if (!run) {
      console.log(`Run ${runId} doesn't exist.`);
      return;
    }
    console.log(`Run: ${run.run_id}`);
    console.log(`Idea: "${run.idea}"`);
    console.log(`Status: ${run.status}`);
    console.log(`Cost: $${run.spent_usd.toFixed(2)} / $${run.cap_usd.toFixed(2)}`);
    console.log(`\nTrace (view in dashboard for full detail):`);
    console.log(`  realcode dashboard`);
  });

program
  .command("dashboard")
  .description("Start the dashboard server")
  .option("-p, --port <port>", "port", "3000")
  .action((opts: { port: string }) => {
    console.log(`Dashboard: cd src/dashboard && npm run dev -- --port ${opts.port}`);
    console.log(`Open http://localhost:${opts.port}`);
  });

program.parse();
