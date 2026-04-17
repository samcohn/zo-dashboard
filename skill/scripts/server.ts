#!/usr/bin/env bun
/**
 * Zo Dashboard Server
 *
 * Serves the dashboard UI and provides API endpoints for context/suggestions.
 * Runs on port 3456 by default.
 *
 * Usage: bun /home/workspace/Skills/zo-dashboard/scripts/server.ts
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { resolve, extname } from "path";

const PORT = Number(process.env.DASHBOARD_PORT || 3456);
const WORKSPACE = "/home/workspace";
const DASHBOARD_DIR = resolve(WORKSPACE, ".zo-dashboard");
const SCRIPTS_DIR = resolve(WORKSPACE, "Skills/zo-dashboard/scripts");
const DIST_DIR = resolve(WORKSPACE, "Skills/zo-dashboard/assets/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

function readJSON(path: string): any {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {}
  return null;
}

async function projectsCall(payload: Record<string, any>): Promise<any> {
  const proc = Bun.spawn(
    ["python3", resolve(SCRIPTS_DIR, "projects_store.py")],
    {
      cwd: WORKSPACE,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  try {
    return JSON.parse(out);
  } catch {
    const err = await new Response(proc.stderr).text();
    return { error: `projects_store error: ${err || out}` };
  }
}

async function generatePlan(title: string, goal: string, context: any): Promise<string[]> {
  const zoToken = process.env.ZO_CLIENT_IDENTITY_TOKEN;
  if (!zoToken) return [];
  const skills = (context?.sections?.skills || []).map((s: any) => s.name).join(", ");
  const recentCommits = (context?.sections?.activity?.git_commits || [])
    .slice(0, 5)
    .map((c: any) => c.message)
    .join("; ");
  const prompt = `You are breaking down a project into actionable steps for a Zo Computer user.

Project title: ${title}
Project goal: ${goal}

Context:
- Installed skills: ${skills}
- Recent commits: ${recentCommits}

Return ONLY a JSON array of 4-7 imperative action-step strings. No explanation, no markdown fences, no prose. Each step must be specific and something the user can actually do or verify. Example format:
["Set up Foo", "Wire Bar to Baz", "Test with real data", "Deploy to production"]`;
  try {
    const resp = await fetch("https://api.zo.computer/zo/ask", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zoToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: prompt }),
    });
    const data = (await resp.json()) as { output?: string };
    let text = (data.output || "").trim();
    // Strip markdown fences if present
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter((s) => typeof s === "string" && s.trim()).slice(0, 10);
    }
    return [];
  } catch {
    return [];
  }
}

async function runCollector(): Promise<any> {
  try {
    const proc = Bun.spawn(["python3", resolve(SCRIPTS_DIR, "collect_context.py")], {
      cwd: WORKSPACE,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return readJSON(resolve(DASHBOARD_DIR, "context.json"));
  } catch (e) {
    return { error: String(e) };
  }
}

async function runSuggestions(ai = false, focus?: string): Promise<any> {
  try {
    const args = ["python3", resolve(SCRIPTS_DIR, "generate_suggestions.py")];
    if (ai) args.push("--ai");
    if (focus) args.push("--focus", focus);
    const proc = Bun.spawn(args, {
      cwd: WORKSPACE,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    return readJSON(resolve(DASHBOARD_DIR, "suggestions.json"));
  } catch (e) {
    return { error: String(e) };
  }
}

async function askZo(question: string, contextData: any): Promise<string> {
  const zoToken = process.env.ZO_CLIENT_IDENTITY_TOKEN;
  if (!zoToken) return "ZO_CLIENT_IDENTITY_TOKEN not set";

  try {
    const resp = await fetch("https://api.zo.computer/zo/ask", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${zoToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: `You are the user's Zo assistant. They're looking at their dashboard and asking: "${question}"\n\nHere's their current Zo state:\n${JSON.stringify(contextData, null, 2).slice(0, 4000)}\n\nAnswer concisely and actionably.`,
      }),
    });
    const data = await resp.json() as { output?: string };
    return data.output || "No response from Zo";
  } catch (e) {
    return `Error: ${e}`;
  }
}

function serveStatic(pathname: string): Response | null {
  // Try to serve from dist (Vite build output)
  let filePath = resolve(DIST_DIR, pathname.replace(/^\//, ""));

  // SPA fallback: if no file extension, serve index.html
  if (!extname(filePath) || !existsSync(filePath)) {
    filePath = resolve(DIST_DIR, "index.html");
  }

  if (existsSync(filePath)) {
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || "application/octet-stream";
    return new Response(readFileSync(filePath), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      },
    });
  }
  return null;
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // API: Get current context
    if (url.pathname === "/api/context" && req.method === "GET") {
      const context = readJSON(resolve(DASHBOARD_DIR, "context.json"));
      if (!context) {
        // Auto-collect if no snapshot exists
        const fresh = await runCollector();
        return new Response(JSON.stringify(fresh), { headers });
      }
      return new Response(JSON.stringify(context), { headers });
    }

    // API: Get current suggestions
    if (url.pathname === "/api/suggestions" && req.method === "GET") {
      const suggestions = readJSON(resolve(DASHBOARD_DIR, "suggestions.json"));
      if (!suggestions) {
        await runCollector();
        const fresh = await runSuggestions();
        return new Response(JSON.stringify(fresh), { headers });
      }
      return new Response(JSON.stringify(suggestions), { headers });
    }

    // API: Refresh everything
    if (url.pathname === "/api/refresh" && req.method === "POST") {
      try {
        const body = req.headers.get("content-type")?.includes("json")
          ? await req.json() as { ai?: boolean; focus?: string }
          : {} as { ai?: boolean; focus?: string };
        const useAI = (body as any)?.ai === true;
        const focus = (body as any)?.focus || undefined;

        await runCollector();
        const suggestions = await runSuggestions(useAI, focus);
        const context = readJSON(resolve(DASHBOARD_DIR, "context.json"));

        return new Response(JSON.stringify({
          status: "refreshed",
          context,
          suggestions,
        }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500, headers,
        });
      }
    }

    // API: Ask Zo about your dashboard
    if (url.pathname === "/api/ask" && req.method === "POST") {
      const body = await req.json() as { question?: string };
      const question = (body as any)?.question;
      if (!question) {
        return new Response(JSON.stringify({ error: "Missing 'question' field" }), {
          status: 400, headers,
        });
      }
      const context = readJSON(resolve(DASHBOARD_DIR, "context.json")) || {};
      const answer = await askZo(question, context);
      return new Response(JSON.stringify({ question, answer }), { headers });
    }

    // ─── Projects API ─────────────────────────────────────────────────
    // GET /api/projects           — list all (non-archived)
    // POST /api/projects          — create (body: { title, goal, auto_plan?: boolean })
    // GET /api/projects/:id       — get one
    // PATCH /api/projects/:id     — update (body: { patch: {...} })
    // DELETE /api/projects/:id    — archive
    // PATCH /api/projects/:id/steps/:stepId  — update a step
    // POST /api/projects/:id/link-node       — link a node (body: { node_id })
    // POST /api/projects/:id/unlink-node     — unlink a node
    // POST /api/projects/:id/regenerate-plan — regenerate plan via AI

    if (url.pathname === "/api/projects" && req.method === "GET") {
      const include = url.searchParams.get("include_archived") === "true";
      const r = await projectsCall({ op: "list", include_archived: include });
      return new Response(JSON.stringify(r), { headers });
    }

    if (url.pathname === "/api/projects" && req.method === "POST") {
      try {
        const body = (await req.json()) as any;
        const title = String(body?.title || "").trim();
        const goal = String(body?.goal || "").trim();
        if (!title || !goal) {
          return new Response(
            JSON.stringify({ error: "title and goal are required" }),
            { status: 400, headers },
          );
        }
        let plan_steps = Array.isArray(body?.plan_steps) ? body.plan_steps : [];
        let ai_generated = false;
        if (body?.auto_plan && plan_steps.length === 0) {
          const context = readJSON(resolve(DASHBOARD_DIR, "context.json")) || {};
          plan_steps = await generatePlan(title, goal, context);
          ai_generated = plan_steps.length > 0;
        }
        const r = await projectsCall({
          op: "create",
          title,
          goal,
          plan_steps,
          ai_generated,
          linked_node_ids: body?.linked_node_ids || [],
        });
        return new Response(JSON.stringify(r), {
          status: r.error ? 400 : 201,
          headers,
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), {
          status: 500,
          headers,
        });
      }
    }

    // Nested project routes: /api/projects/:id/...
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^\/]+)(?:\/(.+))?$/);
    if (projectMatch) {
      const projectId = projectMatch[1];
      const subpath = projectMatch[2];

      if (!subpath && req.method === "GET") {
        const r = await projectsCall({ op: "get", id: projectId });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (!subpath && req.method === "PATCH") {
        const body = (await req.json()) as any;
        const r = await projectsCall({
          op: "update",
          id: projectId,
          patch: body?.patch || body || {},
        });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (!subpath && req.method === "DELETE") {
        const r = await projectsCall({ op: "archive", id: projectId });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (subpath?.startsWith("steps/") && req.method === "PATCH") {
        const stepId = subpath.slice("steps/".length);
        const body = (await req.json()) as any;
        const r = await projectsCall({
          op: "update_step",
          id: projectId,
          step_id: stepId,
          patch: body?.patch || body || {},
        });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (subpath === "link-node" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body?.node_id) {
          return new Response(
            JSON.stringify({ error: "node_id is required" }),
            { status: 400, headers },
          );
        }
        const r = await projectsCall({
          op: "link_node",
          id: projectId,
          node_id: body.node_id,
        });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (subpath === "unlink-node" && req.method === "POST") {
        const body = (await req.json()) as any;
        const r = await projectsCall({
          op: "unlink_node",
          id: projectId,
          node_id: body?.node_id,
        });
        return new Response(JSON.stringify(r), {
          status: r.error ? 404 : 200,
          headers,
        });
      }

      if (subpath === "regenerate-plan" && req.method === "POST") {
        const existing = await projectsCall({ op: "get", id: projectId });
        if (existing.error) {
          return new Response(JSON.stringify(existing), {
            status: 404,
            headers,
          });
        }
        const context = readJSON(resolve(DASHBOARD_DIR, "context.json")) || {};
        const plan = await generatePlan(
          existing.project.title,
          existing.project.goal,
          context,
        );
        if (plan.length === 0) {
          return new Response(
            JSON.stringify({ error: "Plan generation failed" }),
            { status: 502, headers },
          );
        }
        const r = await projectsCall({
          op: "update",
          id: projectId,
          patch: { plan: plan.map((label) => ({ label, status: "pending" })) },
        });
        return new Response(JSON.stringify(r), { headers });
      }
    }

    // Health check
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        port: PORT,
        dashboard_data_exists: existsSync(resolve(DASHBOARD_DIR, "context.json")),
      }), { headers });
    }

    // API catch-all: don't let unknown /api paths fall through to static
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Unknown API endpoint" }), {
        status: 404, headers,
      });
    }

    // Static file serving (Vite build output) — handles / and all asset paths
    const staticResponse = serveStatic(url.pathname);
    if (staticResponse) return staticResponse;

    // 404
    return new Response(JSON.stringify({
      error: "Not found",
      endpoints: {
        "GET /": "Dashboard page",
        "GET /api/context": "Current context snapshot",
        "GET /api/suggestions": "Current suggestions",
        "POST /api/refresh": "Refresh context + suggestions (body: {ai: true} for AI)",
        "POST /api/ask": "Ask Zo about your dashboard (body: {question: '...'})",
        "GET /health": "Health check",
      },
    }), { status: 404, headers });
  },
});

console.log(`Zo Dashboard running at http://localhost:${PORT}`);
console.log(`Open http://localhost:${PORT} in your browser`);
