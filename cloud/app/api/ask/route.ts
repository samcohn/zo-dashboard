import { NextRequest } from "next/server";
import { askZo } from "@/lib/ai";
import { getContext } from "@/lib/domain";

export const runtime = "edge";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { question?: string };
  if (!body.question) return Response.json({ error: "question required" }, { status: 400 });
  const ctx = await getContext();
  const prompt = `The user is looking at their Zo dashboard and asking: "${body.question}"

Context (latest snapshot):
${JSON.stringify(ctx, null, 2).slice(0, 4000)}

Answer concisely and actionably.`;
  const answer = await askZo(prompt);
  return Response.json({ question: body.question, answer });
}
