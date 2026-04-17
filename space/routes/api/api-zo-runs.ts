import type { Context } from "hono";
const D = "http://127.0.0.1:3456";

export default async (c: Context) => {
  const url = new URL(c.req.url);
  const path = url.pathname.replace(/^\/api\/zo-runs/, "/api/runs");
  try {
    const r = await fetch(`${D}${path}${url.search}`);
    return new Response(r.body, {
      status: r.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return c.json({ error: `Dashboard server unavailable: ${e}` }, 502);
  }
};
