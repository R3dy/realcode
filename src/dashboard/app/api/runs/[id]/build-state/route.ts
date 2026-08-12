import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const state = getEngine().getBuildState(params.id);
  if (!state) {
    return NextResponse.json({ error: "no build-state for this run" }, { status: 404 });
  }
  return NextResponse.json(state);
}
