import * as path from "path";
import * as fs from "fs";
import { loadStageGraph, Engine, BuildLoopRunner } from "./engine/index.js";
import { SQLiteQueue, FileStorage } from "./backend/index.js";
import { SandboxRunner } from "./sandbox/index.js";
import { AgentStageRunner } from "./agents/index.js";
import { initTracing, shutdownTracing } from "./engine/tracing.js";

const DATA_DIR = process.env.REALCODE_DATA_DIR || path.resolve(process.cwd(), ".realcode-data");
const GRAPH_PATH = process.env.REALCODE_GRAPH || path.resolve(process.cwd(), "stage-graph.yaml");
const INTERVAL_MS = parseInt(process.env.REALCODE_DISPATCH_INTERVAL_MS || "5000", 10);

initTracing(process.env.OTEL_SERVICE_NAME || "realcode-engine");
process.on("SIGINT", async () => { await shutdownTracing(); process.exit(0); });
process.on("SIGTERM", async () => { await shutdownTracing(); process.exit(0); });

fs.mkdirSync(DATA_DIR, { recursive: true });

const graph = loadStageGraph(GRAPH_PATH);
const queue = new SQLiteQueue(path.join(DATA_DIR, "queue.db"));
const storage = new FileStorage(DATA_DIR);
const sandbox = new SandboxRunner();
const runner = new AgentStageRunner(sandbox, storage, graph, {
  localMode: false,
  repoRoot: process.cwd(),
});
const buildLoop = new BuildLoopRunner(runner, storage, graph, queue, { repoRoot: process.cwd() });
const engine = new Engine(graph, queue, storage, runner, DATA_DIR, buildLoop);

console.log(`[realcode-engine] started`);
console.log(`  data dir:   ${DATA_DIR}`);
console.log(`  graph:      ${GRAPH_PATH} (${graph.stages.length} stages)`);
console.log(`  cost cap:   $${graph.cost_cap_usd_per_run}/run`);
console.log(`  interval:   ${INTERVAL_MS}ms`);
console.log(`  sandbox:    docker`);

// Startup warning for missing host-path env vars in Docker mode (A4.3).
// When the engine is containerized (REALCODE_DATA_DIR !== REALCODE_HOST_DATA_DIR
// — the engine sees /data inside but the host path differs), the sandbox
// runner needs REALCODE_HOST_OPENCODE_CONFIG_DIR + REALCODE_HOST_MISSION_CONTROL_ROOT
// to construct `docker run -v` mounts that resolve on the HOST. When either
// is unset, the corresponding mount is omitted (logged in runDocker); the
// sandbox spawn does not crash. Surface this once at startup so the operator
// sees the missing config before any dispatch attempts.
const engineContainerized = process.env.REALCODE_DATA_DIR !== process.env.REALCODE_HOST_DATA_DIR;
if (engineContainerized) {
  if (!process.env.REALCODE_HOST_OPENCODE_CONFIG_DIR) {
    console.warn(`[realcode-engine] WARNING: REALCODE_HOST_OPENCODE_CONFIG_DIR is unset in Docker mode — sandbox will not inherit the operator's opencode config (opencode.json, agents/, skills/, MCP servers). Set it to the host path of your ~/.config/opencode dir (e.g. /home/<you>/.config/opencode).`);
  }
  if (!process.env.REALCODE_HOST_MISSION_CONTROL_ROOT) {
    console.warn(`[realcode-engine] WARNING: REALCODE_HOST_MISSION_CONTROL_ROOT is unset in Docker mode — MCP server paths under mission-control will not resolve inside the sandbox. Set it to the host path of your mission-control checkout (e.g. /home/<you>/mission-control).`);
  }
}

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
