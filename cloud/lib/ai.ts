/**
 * AI helpers: plan generation + ask. Uses Zo's /zo/ask endpoint.
 * Token is ZO_CLIENT_IDENTITY_TOKEN in env.
 */

import type { ContextSnapshot } from "./types";

const ZO_TOKEN = process.env.ZO_CLIENT_IDENTITY_TOKEN;
const ZO_ENDPOINT = "https://api.zo.computer/zo/ask";

export async function askZo(prompt: string): Promise<string> {
  if (!ZO_TOKEN) return "(ZO_CLIENT_IDENTITY_TOKEN not configured on server)";
  try {
    const r = await fetch(ZO_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${ZO_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: prompt }),
    });
    const data = (await r.json()) as { output?: string };
    return data.output || "(empty response)";
  } catch (e) {
    return `Error: ${e}`;
  }
}

export async function generatePlan(
  title: string,
  goal: string,
  context: ContextSnapshot | null,
): Promise<Array<string | { label: string; executor?: { type: string; config?: unknown } }>> {
  const skills = (context?.sections?.skills || []).map((s) => s.name).join(", ");
  const recent = (context?.sections?.activity?.git_commits || [])
    .slice(0, 5)
    .map((c) => c.message)
    .join("; ");
  const prompt = `Break down a project into 4-7 actionable steps. Each step should include an executor hint so Zo can help run it automatically.

Project title: ${title}
Project goal: ${goal}

Context:
- Installed skills: ${skills}
- Recent commits: ${recent}

Available executor types:
- "ask_zo": ask Zo a question to research/draft/summarize (fast, synchronous)
- "spawn_agent": delegate a multi-step task to an autonomous Claude agent (slow, powerful)
- "manual": user does it themselves (default for physical/external tasks)

Return ONLY a JSON array of step objects:
[{"label": "...", "executor": {"type": "ask_zo"|"spawn_agent"|"manual", "config": {...}}}]

For ask_zo, config: {"prompt": "..."}. For spawn_agent, config: {"task": "..."}. For manual, omit config.
No prose, no markdown fences. Just JSON.`;

  const raw = await askZo(prompt);
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 10);
  } catch {
    return [];
  }
}
