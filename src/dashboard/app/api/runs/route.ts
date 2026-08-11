import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";
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
  const run = getEngine().createRun(runId, idea);
  return NextResponse.json({ run_id: runId, run });
}
