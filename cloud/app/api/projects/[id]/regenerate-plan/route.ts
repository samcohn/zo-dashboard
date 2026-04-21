import { NextRequest } from "next/server";
import { getProject, updateProject, getContext } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";
import { generatePlan } from "@/lib/ai";

export const runtime = "edge";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const p = await getProject(id);
  if (!p) return Response.json({ error: "project not found" }, { status: 404 });
  const context = await getContext();
  const plan = await generatePlan(p.title, p.goal, context);
  if (plan.length === 0) {
    return Response.json({ error: "plan generation failed" }, { status: 502 });
  }
  const updated = await updateProject(id, {
    plan: plan.map((s) => (typeof s === "string" ? { label: s, status: "pending" as const } : { ...s, status: "pending" as const })) as any,
  });
  return Response.json({ project: updated });
}
