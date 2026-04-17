import type { Context } from "hono";
const D = "http://127.0.0.1:3456";
export default async (c: Context) => {
  const body = await c.req.text();
  const r = await fetch(`${D}/api/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
};
