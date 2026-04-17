import type { Context } from "hono";
const D = "http://127.0.0.1:3456";

export default async (c: Context) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/zo-projects/, "/api/projects");
  const target = `${D}${path}${url.search}`;

  const init: RequestInit = {
    method: c.req.method,
    headers: { "Content-Type": "application/json" },
  };
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = await c.req.raw.text();
  }
  try {
    const r = await fetch(target, init);
    return new Response(r.body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return c.json({ error: `Dashboard server unavailable: ${e}` }, 502);
  }
};
