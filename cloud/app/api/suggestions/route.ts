import { NextRequest } from "next/server";
import { getSuggestions, setSuggestions } from "@/lib/domain";
import { isAuthorized, unauthorized } from "@/lib/auth";
import type { SuggestionsData } from "@/lib/types";

export const runtime = "edge";

export async function GET() {
  const d = await getSuggestions();
  return Response.json(d || { generated_at: new Date(0).toISOString(), suggestion_count: 0, suggestions: [] });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return unauthorized();
  const body = (await req.json()) as SuggestionsData;
  await setSuggestions(body);
  return Response.json({ ok: true });
}
