import { NextResponse } from "next/server";
import { getEngine, RunNotFoundError } from "@/lib/engine";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set([
  "intake",
  "framed",
  "discovered",
  "planned",
  "specified",
  "built",
  "running",
  "claimed",
]);

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const detail = getEngine().getRunDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const engine = getEngine();
  const run = engine.getRun(params.id);
  if (!run) {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }

  // The route owns the active-run gate (INV-6).
  // deleteRun itself is unconditional — the gate is enforced here.
  const isActive = ACTIVE_STATUSES.has(run.status);
  const force = new URL(request.url).searchParams.get("force") === "1";

  if (isActive && !force) {
    return NextResponse.json(
      { error: "run is active", status: run.status },
      { status: 409 },
    );
  }

  try {
    engine.deleteRun(params.id);
  } catch (err) {
    if (err instanceof RunNotFoundError) {
      return NextResponse.json({ error: "run not found" }, { status: 404 });
    }
    throw err;
  }

  return NextResponse.json({ deleted: params.id });
}
