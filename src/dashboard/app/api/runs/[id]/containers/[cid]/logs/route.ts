import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { id: string; cid: string } },
) {
  const url = new URL(request.url);
  const tailParam = url.searchParams.get("tail");
  const tail = tailParam ? Number(tailParam) : undefined;
  const result = getEngine().getContainerLogs(
    params.id,
    params.cid,
    Number.isFinite(tail) && tail! > 0 ? tail : undefined,
  );
  if (!result) {
    return NextResponse.json({ error: "container or log not found" }, { status: 404 });
  }
  return NextResponse.json({ container_id: params.cid, log_path: result.log_path, text: result.text });
}
