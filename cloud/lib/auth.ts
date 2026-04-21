/**
 * Simple shared-secret auth for write endpoints.
 * The zo-computer worker has the secret; anonymous users get read-only access.
 *
 * For the MVP, UI writes (create project, update step, etc.) also go through
 * this same auth — users embed the secret via a browser-side input or a URL
 * param (it's a personal dashboard, not multi-tenant). You can later swap in
 * Clerk/Auth.js if you go multi-user.
 */

import { NextRequest } from "next/server";

const SECRET = process.env.ZO_SYNC_SECRET;

export function isAuthorized(req: NextRequest): boolean {
  // If no secret configured, allow writes (local/dev mode).
  if (!SECRET) return true;
  const header = req.headers.get("x-zo-secret");
  return header === SECRET;
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
