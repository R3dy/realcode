import * as path from "path";
import * as fs from "fs";
import { loadStageGraph, Engine } from "./engine/index.js";
import { SQLiteQueue, FileStorage } from "./backend/index.js";
import { SandboxRunner } from "./sandbox/index.js";
import { AgentStageRunner } from "./agents/index.js";

const DATA_DIR = process.env.REALCODE_DATA_DIR || path.resolve(process.cwd(), ".realcode-data");
const GRAPH_PATH = process.env.REALCODE_GRAPH || path.resolve(process.cwd(), "stage-graph.yaml");
const INTERVAL_MS = parseInt(process.env.REALCODE_DISPATCH_INTERVAL_MS || "5000", 10);

fs.mkdirSync(DATA_DIR, { recursive: true });

const graph = loadStageGraph(GRAPH_PATH);
const queue = new SQLiteQueue(path.join(DATA_DIR, "queue.db"));
const storage = new FileStorage(DATA_DIR);
const sandbox = new SandboxRunner();
const runner = new AgentStageRunner(sandbox, storage, graph, {
  localMode: false,
  repoRoot: process.cwd(),
});
const engine = new Engine(graph, queue, storage, runner, DATA_DIR);

console.log(`[realcode-engine] started`);
console.log(`  data dir:   ${DATA_DIR}`);
console.log(`  graph:      ${GRAPH_PATH} (${graph.stages.length} stages)`);
console.log(`  cost cap:   $${graph.cost_cap_usd_per_run}/run`);
console.log(`  interval:   ${INTERVAL_MS}ms`);
console.log(`  sandbox:    docker`);

async function loop() {
  try {
    const control = engine.getControlDoc();
    if (control.run_mode === "paused" || control.run_mode === "paused_cost_cap") {
      // just wait — don't dispatch
    } else {
      const dispatched = await engine.dispatchCycle();
      if (dispatched > 0) {
        const runs = engine.listRuns();
        for (const run of runs) {
          console.log(`  [${new Date().toISOString()}] ${run.run_id}: ${run.status} ($${run.spent_usd.toFixed(2)}/$${run.cap_usd.toFixed(2)})`);
        }
      }
    }
  } catch (err) {
    console.error(`[realcode-engine] dispatch error:`, err instanceof Error ? err.message : String(err));
  }
  setTimeout(loop, INTERVAL_MS);
}

loop();
