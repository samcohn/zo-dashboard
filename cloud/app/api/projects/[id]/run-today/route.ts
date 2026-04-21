import { NextRequest } from "next/server";
import { getProject, updateStep, createRun } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { Run } from "@/lib/types";

export const runtime = "edge";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isAuthorized(req)) return unauthorized();
  const { id } = await ctx.params;
  const p = await getProject(id);
  if (!p) return Response.json({ error: "project not found" }, { status: 404 });
  const executable = p.plan.filter(
    (s) => s.status === "pending" && s.executor && s.executor.type !== "manual",
  );
  const runs: Run[] = [];
  for (const step of executable) {
    const run = await createRun({ project_id: id, step_id: step.id, executor: step.executor! });
    await updateStep(id, step.id, { last_run_id: run.id });
    runs.push(run);
  }
  return Response.json({ runs }, { status: 202 });
}
