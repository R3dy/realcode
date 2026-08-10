import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  const doc = engine.getControlDoc();
  return NextResponse.json(doc);
}

export async function PUT(request: Request) {
  const body = await request.json();
  const engine = getEngine();
  // cost_cap_usd is non-overridable from the dashboard (safety)
  const { cost_cap_usd, ...safe } = body;
  engine.setControlDoc(safe, "dashboard");
  return NextResponse.json({ ok: true, ...engine.getControlDoc() });
}
