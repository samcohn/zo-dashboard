import { NextRequest } from "next/server";

export const runtime = "edge";

/**
 * In cloud mode, the zo-computer worker refreshes context on its own
 * schedule. Hitting this endpoint just acknowledges — the actual refresh
 * happens out-of-band. When the zo-computer is offline, this returns a
 * soft-success so the UI doesn't spin forever.
 */
export async function POST(_req: NextRequest) {
  return Response.json({
    ok: true,
    message: "Refresh is handled by the zo-computer worker on its schedule.",
  });
}
