import { NextRequest } from "next/server";
import { getProject, updateStep, createRun } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

/**
 * Kicks off a run for a step. In cloud mode, we can't directly spawn
 * executors (no zo-computer access). Instead, we create a pending Run
 * and enqueue it for the zo-computer worker to pick up. When the worker
 * is online, it'll drain the queue and execute.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; stepId: string }> },
) {
  if (!isAuthorized(req)) return unauthorized();
  const { id, stepId } = await ctx.params;
  const p = await getProject(id);
  if (!p) return Response.json({ error: "project not found" }, { status: 404 });
  const step = p.plan.find((s) => s.id === stepId);
  if (!step) return Response.json({ error: "step not found" }, { status: 404 });
  if (!step.executor || step.executor.type === "manual") {
    return Response.json({ error: "step has no executor" }, { status: 400 });
  }
  const run = await createRun({ project_id: id, step_id: stepId, executor: step.executor });
  await updateStep(id, stepId, { last_run_id: run.id });
  return Response.json({ run }, { status: 202 });
}
