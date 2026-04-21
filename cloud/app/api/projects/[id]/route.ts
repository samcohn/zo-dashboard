import { NextRequest } from "next/server";
import { getProject, updateProject, archiveProject } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await getProject(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json();
  const p = await updateProject(id, body?.patch || body || {});
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const p = await archiveProject(id);
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ project: p });
}
