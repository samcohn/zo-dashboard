import { NextRequest } from "next/server";
import { unlinkNode } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json();
  const p = await unlinkNode(id, body?.node_id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}
