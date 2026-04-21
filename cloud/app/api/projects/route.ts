import { NextRequest } from "next/server";
import { listProjects, createProject } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const include = req.nextUrl.searchParams.get("include_archived") === "true";
  const projects = await listProjects(include);
  return Response.json({ projects });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized();
  const body = (await req.json()) as {
    title: string; goal: string; plan_steps?: unknown[];
    linked_node_ids?: string[]; ai_generated?: boolean;
  };
  if (!body.title?.trim() || !body.goal?.trim()) {
    return Response.json({ error: "title and goal required" }, { status: 400 });
  }
  const project = await createProject({
    title: body.title,
    goal: body.goal,
    plan_steps: body.plan_steps,
    linked_node_ids: body.linked_node_ids,
    ai_generated: body.ai_generated,
  });
  return Response.json({ project }, { status: 201 });
}
