/**
 * Domain helpers: ID generation, atomic project/run operations on top of storage.
 * Keyspace:
 *   context:latest              — ContextSnapshot
 *   suggestions:latest          — SuggestionsData
 *   project:<id>                — Project
 *   projects:index              — Array<project_id> (newest-first)
 *   run:<id>                    — Run
 *   runs:index:<project_id>:<step_id>  — Array<run_id> (newest-first)
 *   queue:runs                  — List of pending run_ids for the worker
 */

import { storage } from "./storage";
import type { Project, ProjectStep, Run, Executor, ContextSnapshot, SuggestionsData } from "./types";

function newId(prefix: string): string {
  const r = Math.random().toString(36).slice(2, 11);
  return `${prefix}_${r}${Date.now().toString(36).slice(-4)}`;
}
function now(): string {
  return new Date().toISOString();
}

// ─── Context ────────────────────────────────────────────────────────────────

export async function getContext(): Promise<ContextSnapshot | null> {
  return storage.get<ContextSnapshot>("context:latest");
}
export async function setContext(ctx: ContextSnapshot): Promise<void> {
  await storage.set("context:latest", ctx);
}

// ─── Suggestions ────────────────────────────────────────────────────────────

export async function getSuggestions(): Promise<SuggestionsData | null> {
  return storage.get<SuggestionsData>("suggestions:latest");
}
export async function setSuggestions(data: SuggestionsData): Promise<void> {
  await storage.set("suggestions:latest", data);
}

// ─── Projects ───────────────────────────────────────────────────────────────

async function getIndex(): Promise<string[]> {
  return (await storage.get<string[]>("projects:index")) || [];
}
async function setIndex(ids: string[]): Promise<void> {
  await storage.set("projects:index", ids);
}

export async function listProjects(includeArchived = false): Promise<Project[]> {
  const ids = await getIndex();
  const projects = (await Promise.all(ids.map((id) => storage.get<Project>(`project:${id}`))))
    .filter((p): p is Project => !!p);
  const filtered = includeArchived ? projects : projects.filter((p) => p.status !== "archived");
  filtered.sort((a, b) => (b.last_touched_at || "").localeCompare(a.last_touched_at || ""));
  return filtered;
}

export async function getProject(id: string): Promise<Project | null> {
  return storage.get<Project>(`project:${id}`);
}

function normalizeStep(s: unknown): ProjectStep | null {
  if (typeof s === "string" && s.trim()) {
    return { id: newId("step"), label: s.trim(), status: "pending" };
  }
  if (s && typeof s === "object" && "label" in s && typeof (s as any).label === "string") {
    const obj = s as Record<string, unknown>;
    const step: ProjectStep = {
      id: (obj.id as string) || newId("step"),
      label: String(obj.label).trim(),
      status: ["pending", "in_progress", "done", "blocked"].includes(obj.status as string)
        ? (obj.status as ProjectStep["status"])
        : "pending",
    };
    if (obj.notes) step.notes = String(obj.notes);
    if (obj.completed_at) step.completed_at = String(obj.completed_at);
    if (obj.last_run_id) step.last_run_id = String(obj.last_run_id);
    const ex = obj.executor as Executor | undefined;
    if (ex && ex.type && ["ask_zo", "run_script", "spawn_agent"].includes(ex.type)) {
      step.executor = { type: ex.type, config: ex.config || {} };
    }
    return step.label ? step : null;
  }
  return null;
}

export async function createProject(args: {
  title: string;
  goal: string;
  plan_steps?: unknown[];
  linked_node_ids?: string[];
  ai_generated?: boolean;
}): Promise<Project> {
  const t = now();
  const id = newId("proj");
  const project: Project = {
    id,
    title: args.title.trim(),
    goal: args.goal.trim(),
    plan: (args.plan_steps || []).map(normalizeStep).filter((s): s is ProjectStep => !!s),
    linked_node_ids: args.linked_node_ids || [],
    status: "active",
    created_at: t,
    updated_at: t,
    last_touched_at: t,
    ai_generated: !!args.ai_generated,
  };
  await storage.set(`project:${id}`, project);
  const ids = await getIndex();
  ids.unshift(id);
  await setIndex(ids);
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (patch.title) p.title = String(patch.title).trim();
  if (patch.goal) p.goal = String(patch.goal).trim();
  if (patch.status && ["active", "paused", "done", "archived"].includes(patch.status)) p.status = patch.status;
  if (Array.isArray(patch.linked_node_ids)) p.linked_node_ids = patch.linked_node_ids;
  if (Array.isArray(patch.plan)) {
    p.plan = patch.plan.map(normalizeStep).filter((s): s is ProjectStep => !!s);
  }
  p.updated_at = now();
  p.last_touched_at = p.updated_at;
  await storage.set(`project:${id}`, p);
  return p;
}

export async function updateStep(
  projectId: string,
  stepId: string,
  patch: Partial<ProjectStep>,
): Promise<Project | null> {
  const p = await getProject(projectId);
  if (!p) return null;
  const step = p.plan.find((s) => s.id === stepId);
  if (!step) return null;
  if (patch.status && ["pending", "in_progress", "done", "blocked"].includes(patch.status)) {
    step.status = patch.status;
    if (patch.status === "done") step.completed_at = now();
    else delete step.completed_at;
  }
  if (patch.label) step.label = String(patch.label).trim();
  if ("notes" in patch) step.notes = patch.notes ? String(patch.notes) : undefined;
  if (patch.last_run_id) step.last_run_id = patch.last_run_id;

  if (p.plan.length && p.plan.every((s) => s.status === "done")) p.status = "done";

  p.updated_at = now();
  p.last_touched_at = p.updated_at;
  await storage.set(`project:${projectId}`, p);
  return p;
}

export async function archiveProject(id: string): Promise<Project | null> {
  return updateProject(id, { status: "archived" });
}

export async function linkNode(projectId: string, nodeId: string): Promise<Project | null> {
  const p = await getProject(projectId);
  if (!p) return null;
  if (!p.linked_node_ids.includes(nodeId)) {
    p.linked_node_ids.push(nodeId);
    p.updated_at = now();
    p.last_touched_at = p.updated_at;
    await storage.set(`project:${projectId}`, p);
  }
  return p;
}

export async function unlinkNode(projectId: string, nodeId: string): Promise<Project | null> {
  const p = await getProject(projectId);
  if (!p) return null;
  p.linked_node_ids = p.linked_node_ids.filter((id) => id !== nodeId);
  p.updated_at = now();
  p.last_touched_at = p.updated_at;
  await storage.set(`project:${projectId}`, p);
  return p;
}

// ─── Runs ───────────────────────────────────────────────────────────────────

export async function createRun(args: {
  project_id: string;
  step_id: string;
  executor: Executor;
}): Promise<Run> {
  const t = now();
  const id = newId("run");
  const run: Run = {
    id,
    project_id: args.project_id,
    step_id: args.step_id,
    executor: args.executor,
    status: "pending",
    created_at: t,
    started_at: null,
    completed_at: null,
    output: null,
    error: null,
  };
  await storage.set(`run:${id}`, run);
  await storage.lpush(`runs:index:${args.project_id}:${args.step_id}`, id);
  await storage.lpush("queue:runs", id);
  return run;
}

export async function getRun(id: string): Promise<Run | null> {
  return storage.get<Run>(`run:${id}`);
}

export async function updateRun(id: string, patch: Partial<Run>): Promise<Run | null> {
  const r = await getRun(id);
  if (!r) return null;
  if (patch.status) {
    r.status = patch.status;
    if (patch.status === "running" && !r.started_at) r.started_at = now();
    if ((patch.status === "success" || patch.status === "failed") && !r.completed_at) r.completed_at = now();
  }
  if ("output" in patch) {
    const s = patch.output == null ? null : String(patch.output);
    r.output = s && s.length > 50_000 ? s.slice(0, 50_000) + "\n…[truncated]" : s;
  }
  if ("error" in patch) r.error = patch.error == null ? null : String(patch.error);
  await storage.set(`run:${id}`, r);

  // Remove from worker queue when done
  if (r.status === "success" || r.status === "failed") {
    await storage.lrem("queue:runs", 0, id);
  }
  return r;
}

export async function listRunsForStep(projectId: string, stepId: string): Promise<Run[]> {
  const ids = await storage.lrange(`runs:index:${projectId}:${stepId}`, 0, -1);
  const runs = await Promise.all(ids.map((rid) => storage.get<Run>(`run:${rid}`)));
  return runs.filter((r): r is Run => !!r);
}

export async function pendingQueue(): Promise<string[]> {
  return storage.lrange("queue:runs", 0, -1);
}
