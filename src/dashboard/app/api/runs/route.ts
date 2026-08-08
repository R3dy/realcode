import { NextResponse } from "next/server";
import { getEngine } from "@/dashboard/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  const runs = engine.listRuns();
  return NextResponse.json({ runs });
}
