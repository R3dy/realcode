import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  const runs = engine.listRuns();
  return NextResponse.json({ runs });
}

export async function POST(request: Request) {
  const body = await request.json();
  const idea = body.idea as string;
  if (!idea || !idea.trim()) {
    return NextResponse.json({ error: "idea is required" }, { status: 400 });
  }
  const runId = `run_${randomUUID().slice(0, 8)}`;
  const DATA_DIR = process.env.REALCODE_DATA_DIR || path.resolve(process.cwd(), ".realcode-data");
  const runsDir = path.join(DATA_DIR, "runs", runId);
  fs.mkdirSync(runsDir, { recursive: true });
  const run = {
    run_id: runId,
    idea,
    status: "intake",
    spent_usd: 0,
    cap_usd: 8.0,
    created_at: Date.now(),
    workspace_path: `${DATA_DIR}/workspaces/${runId}`,
  };
  fs.writeFileSync(path.join(runsDir, "run.json"), JSON.stringify(run, null, 2));
  return NextResponse.json({ run_id: runId, run });
}
