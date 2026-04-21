import { NextRequest } from "next/server";
import { pendingQueue, getRun } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

/**
 * Worker calls this to pull pending runs. Returns runs that are still
 * 'pending' (never executed). The worker picks them up, runs them on
 * the zo-computer, and PATCHes /api/runs/:runId with the result.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized();
  const ids = await pendingQueue();
  const runs = await Promise.all(ids.map((id) => getRun(id)));
  const pending = runs.filter((r) => r && r.status === "pending");
  return Response.json({ runs: pending });
}
