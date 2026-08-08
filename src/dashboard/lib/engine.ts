import { loadStageGraph, Engine } from "@/engine";
import { SQLiteQueue, FileStorage } from "@/backend";
import { SandboxRunner } from "@/sandbox";
import type { WorkItem } from "@/backend/types";
import * as path from "path";

const DATA_DIR = path.resolve(process.cwd(), ".realcode-data");
const GRAPH_PATH = path.resolve(process.cwd(), "stage-graph.yaml");

let _engine: Engine | null = null;

export function getEngine(): Engine {
  if (_engine) return _engine;
  const graph = loadStageGraph(GRAPH_PATH);
  const queue = new SQLiteQueue(path.join(DATA_DIR, "queue.db"));
  const storage = new FileStorage(DATA_DIR);
  const sandbox = new SandboxRunner();
  const runner = {
    async run(item: WorkItem, stage: any, workspacePath: string) {
      const model = process.env.ANYMAKE_MODEL_TIER1 ?? "openrouter/z-ai/glm-5.2";
      const result = await sandbox.run({
        workspacePath,
        model,
        dispatchMessage: `Execute anymake Phase ${stage.anymake_phase} (${stage.id}). Prior: ${JSON.stringify(item.payload)}.`,
        localMode: true,
        timeoutMs: 300000,
      });
      const tokenUsage = SandboxRunner.extractTokenUsage(result.jsonEvents ?? []);
      return { output_status: "pass", artifact: {}, token_usage: tokenUsage, trace_id: item.run_id };
    },
  };
  _engine = new Engine(graph, queue, storage, runner, DATA_DIR);
  return _engine;
}
