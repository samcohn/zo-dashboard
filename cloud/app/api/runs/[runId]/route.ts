import { NextRequest } from "next/server";
import { getRun, updateRun } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function GET(_: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await getRun(runId);
  if (!r) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ run: r });
}

// Worker uses PATCH to push status + output back
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { runId } = await ctx.params;
  const body = await req.json();
  const r = await updateRun(runId, body?.patch || body || {});
  if (!r) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ run: r });
}
