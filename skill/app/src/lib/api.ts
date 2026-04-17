const BASE = import.meta.env.DEV ? '' : '';

export interface Skill {
  name: string;
  path: string;
  description?: string;
  has_scripts: boolean;
  script_count?: number;
  scripts?: string[];
  last_modified: string;
}

export interface JobSummary {
  total: number;
  pending: number;
  completed: number;
  failed: number;
}

export interface Commit {
  hash: string;
  message: string;
  date: string;
  author: string;
}

export interface Suggestion {
  category: 'act' | 'build' | 'explore' | 'maintain';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  action?: string;
  source?: 'rules' | 'ai';
}

export interface DirInfo {
  name: string;
  file_count: number;
  size_mb: number;
}

export interface Automation {
  skill: string;
  type: string;
  hint: string;
}

export interface ContextSnapshot {
  collected_at: string;
  workspace: string;
  sections: {
    skills: Skill[];
    activity: { git_commits: Commit[]; recently_modified: any[] };
    jobs: { queues: Record<string, any[]>; summary: JobSummary };
    reflections: { latest: any; count: number; history: any[] };
    memory: { available: boolean; data?: any; data_raw?: string };
    workspace: { top_level_dirs: DirInfo[]; total_files: number; total_size_mb: number };
    automations: { scheduled: any[]; webhooks: any[]; discovered: Automation[] };
  };
}

export interface SuggestionsData {
  generated_at: string;
  suggestion_count: number;
  suggestions: Suggestion[];
}

export async function fetchContext(): Promise<ContextSnapshot> {
  const r = await fetch(`${BASE}/api/context`);
  return r.json();
}

export async function fetchSuggestions(): Promise<SuggestionsData> {
  const r = await fetch(`${BASE}/api/suggestions`);
  return r.json();
}

export async function refreshDashboard(focus?: string) {
  const r = await fetch(`${BASE}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ai: true, focus: focus || undefined }),
  });
  return r.json();
}

export async function askZo(question: string): Promise<string> {
  const r = await fetch(`${BASE}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const data = await r.json();
  return data.answer || 'No response';
}
