import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  const runs = engine.listRuns();
  const control = engine.getControlDoc();
  const activeRuns = runs.filter((r) => r.status === "running" || r.status === "intake" || r.status === "claimed").length;
  const todaySpend = runs.reduce((a, r) => a + r.spent_usd, 0);
  const shippedToday = runs.filter((r) => r.status === "shipped").length;
  const avgCost = runs.length > 0 ? todaySpend / runs.length : 0;
  const escalations = runs.filter((r) => r.status.endsWith("_failed") || r.status === "escalated" || r.status === "paused_cost_cap").length;
  return NextResponse.json({
    activeRuns, todaySpend, shippedToday, avgCost, escalations,
    runMode: control.run_mode, concurrency: control.concurrency,
  });
}
