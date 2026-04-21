import { NextRequest } from "next/server";
import { getContext, setContext } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { ContextSnapshot } from "@/lib/types";

export const runtime = "edge";

export async function GET() {
  const ctx = await getContext();
  if (!ctx) {
    return Response.json({
      collected_at: new Date(0).toISOString(),
      workspace: "(awaiting first sync)",
      sections: {
        skills: [], activity: { git_commits: [], recently_modified: [] },
        jobs: { queues: {}, summary: { total: 0, pending: 0, completed: 0, failed: 0 } },
        reflections: { latest: null, count: 0, history: [] },
        memory: { available: false },
        workspace: { top_level_dirs: [], total_files: 0, total_size_mb: 0 },
        automations: { scheduled: [], webhooks: [], discovered: [] },
      },
    });
  }
  return Response.json(ctx);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized();
  const body = (await req.json()) as ContextSnapshot;
  if (!body?.sections) return Response.json({ error: "invalid snapshot" }, { status: 400 });
  await setContext(body);
  return Response.json({ ok: true });
}
