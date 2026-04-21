import { NextRequest } from "next/server";
import { updateStep } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; stepId: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id, stepId } = await ctx.params;
  const body = await req.json();
  const p = await updateStep(id, stepId, body?.patch || body || {});
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}
