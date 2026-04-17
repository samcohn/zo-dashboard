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
