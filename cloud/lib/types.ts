// Shared types between UI and API — mirror of skill/scripts/projects_store.py + runs_store.py

export type StepStatus = "pending" | "in_progress" | "done" | "blocked";
export type ProjectStatus = "active" | "paused" | "done" | "archived";
export type ExecutorType = "ask_zo" | "run_script" | "spawn_agent" | "manual";
export type RunStatus = "pending" | "running" | "success" | "failed";

export interface Executor { type: ExecutorType; config?: Record<string, unknown>; }
export interface ProjectStep {
  id: string;
  label: string;
  status: StepStatus;
  notes?: string;
  completed_at?: string;
  executor?: Executor;
  last_run_id?: string;
}
export interface Project {
  id: string;
  title: string;
  goal: string;
  plan: ProjectStep[];
  linked_node_ids: string[];
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  last_touched_at: string;
  ai_generated: boolean;
}
export interface Run {
  id: string;
  project_id: string;
  step_id: string;
  executor: Executor;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
  error: string | null;
}

// Context snapshot (pushed from zo-computer)
export interface ContextSnapshot {
  collected_at: string;
  workspace: string;
  sections: {
    skills: Array<{ name: string; path: string; has_scripts: boolean; script_count?: number; scripts?: string[]; last_modified: string; has_references?: boolean }>;
    activity: { git_commits: Array<{ hash: string; message: string; date: string; author: string }>; recently_modified: unknown[] };
    jobs: { queues: Record<string, unknown[]>; summary: { total: number; pending: number; completed: number; failed: number } };
    reflections: { latest: unknown; count: number; history: unknown[] };
    memory: { available: boolean; data?: unknown };
    workspace: { top_level_dirs: Array<{ name: string; file_count: number; size_mb: number }>; total_files: number; total_size_mb: number };
    automations: { scheduled: unknown[]; webhooks: unknown[]; discovered: Array<{ skill: string; type: string; hint: string }> };
  };
}

export interface SuggestionsData {
  generated_at: string;
  suggestion_count: number;
  suggestions: Array<{
    category: "act" | "build" | "explore" | "maintain";
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    action?: string;
    source?: "rules" | "ai";
  }>;
}

// A queued request for the zo-computer worker to execute
export interface QueuedRun {
  run_id: string;
  queued_at: string;
}
