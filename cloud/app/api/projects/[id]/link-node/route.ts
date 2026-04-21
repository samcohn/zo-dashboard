import { NextRequest } from "next/server";
import { linkNode } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json();
  if (!body?.node_id) return Response.json({ error: "node_id required" }, { status: 400 });
  const p = await linkNode(id, body.node_id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}
