'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import * as Separator from '@radix-ui/react-separator';
import * as Dialog from '@radix-ui/react-dialog';
import * as Collapsible from '@radix-ui/react-collapsible';
import * as Tabs from '@radix-ui/react-tabs';
import * as Progress from '@radix-ui/react-progress';

const tokens = {
  color: { bg: '#000000', surface: 'var(--surface)', border: 'rgba(var(--fg-rgb),0.08)' },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  font: {
    display: '"Cardinal", Georgia, "Times New Roman", serif',
    body: '"Diatype", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
    mono: '"SF Mono", "Fira Code", "JetBrains Mono", monospace',
  },
} as const;

interface Skill { name: string; path: string; has_scripts: boolean; script_count?: number; scripts?: string[]; last_modified: string; has_references?: boolean; }
interface JobSummary { total: number; pending: number; completed: number; failed: number; }
interface Commit { hash: string; message: string; date: string; author: string; }
interface Suggestion { category: 'act'|'build'|'explore'|'maintain'; priority: 'high'|'medium'|'low'; title: string; description: string; action?: string; source?: 'rules'|'ai'; }
interface Automation { skill: string; type: string; hint: string; }
interface DirInfo { name: string; file_count: number; size_mb: number; }
interface ContextSnapshot { collected_at: string; workspace: string; sections: { skills: Skill[]; activity: { git_commits: Commit[]; recently_modified: any[] }; jobs: { queues: Record<string, any[]>; summary: JobSummary }; reflections: { latest: any; count: number; history: any[] }; memory: { available: boolean; data?: any }; workspace: { top_level_dirs: DirInfo[]; total_files: number; total_size_mb: number }; automations: { scheduled: any[]; webhooks: any[]; discovered: Automation[] }; }; }
interface SuggestionsData { generated_at: string; suggestion_count: number; suggestions: Suggestion[]; }
interface NodeItem { label: string; status: 'done'|'todo'|'explore'; }
interface ZoNode { id: string; label: string; type: 'skill'|'automation'|'data'|'core'; health: 'active'|'stale'|'needs-attention'; maturity: number; relevance: number; active: boolean; detail: string; items: NodeItem[]; connections: string[]; lastTouched: number; }

function getSecret(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('zo-secret');
}
function setSecret(s: string) { window.localStorage.setItem('zo-secret', s); }
function authHeaders(): Record<string, string> {
  const s = getSecret();
  return s ? { 'x-zo-secret': s } : {};
}

async function fetchContext(): Promise<ContextSnapshot> { return (await fetch('/api/context')).json(); }
async function fetchSuggestions(): Promise<SuggestionsData> { return (await fetch('/api/suggestions')).json(); }
async function refreshDashboard(focus?: string) { return (await fetch('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ ai: true, focus: focus || undefined }) })).json(); }
async function askZo(question: string): Promise<string> { const d = await (await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ question }) })).json(); return d.answer || 'No response'; }

type ExecutorType = 'ask_zo' | 'run_script' | 'spawn_agent' | 'manual';
interface Executor { type: ExecutorType; config?: Record<string, any>; }
interface ProjectStep { id: string; label: string; status: 'pending' | 'in_progress' | 'done' | 'blocked'; notes?: string; completed_at?: string; executor?: Executor; last_run_id?: string; }
interface Project { id: string; title: string; goal: string; plan: ProjectStep[]; linked_node_ids: string[]; status: 'active' | 'paused' | 'done' | 'archived'; created_at: string; updated_at: string; last_touched_at: string; ai_generated: boolean; }
interface Run { id: string; project_id: string; step_id: string; executor: Executor; status: 'pending' | 'running' | 'success' | 'failed'; created_at: string; started_at: string | null; completed_at: string | null; output: string | null; error: string | null; }

async function fetchProjects(): Promise<Project[]> {
  const r = await fetch('/api/projects');
  return (await r.json()).projects || [];
}
async function createProject(title: string, goal: string, autoPlan = true): Promise<Project | null> {
  const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ title, goal, auto_plan: autoPlan }) });
  return (await r.json()).project || null;
}
async function updateStep(pid: string, sid: string, patch: Partial<ProjectStep>): Promise<Project | null> {
  const r = await fetch(`/api/projects/${pid}/steps/${sid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ patch }) });
  return (await r.json()).project || null;
}
async function archiveProject(id: string) { await fetch(`/api/projects/${id}`, { method: 'DELETE', headers: authHeaders() }); }
async function linkNodeToProject(pid: string, nid: string): Promise<Project | null> {
  const r = await fetch(`/api/projects/${pid}/link-node`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ node_id: nid }) });
  return (await r.json()).project || null;
}
async function unlinkNodeFromProject(pid: string, nid: string): Promise<Project | null> {
  const r = await fetch(`/api/projects/${pid}/unlink-node`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ node_id: nid }) });
  return (await r.json()).project || null;
}
async function regeneratePlan(id: string): Promise<Project | null> {
  const r = await fetch(`/api/projects/${id}/regenerate-plan`, { method: 'POST', headers: authHeaders() });
  return (await r.json()).project || null;
}
async function runStep(projectId: string, stepId: string): Promise<Run | null> {
  const r = await fetch(`/api/projects/${projectId}/steps/${stepId}/run`, { method: 'POST', headers: authHeaders() });
  return (await r.json()).run || null;
}
async function getRun(runId: string): Promise<Run | null> {
  const r = await fetch(`/api/runs/${runId}`);
  return (await r.json()).run || null;
}
async function runToday(projectId: string): Promise<Run[]> {
  const r = await fetch(`/api/projects/${projectId}/run-today`, { method: 'POST', headers: authHeaders() });
  return (await r.json()).runs || [];
}

interface ForceNode { id: string; x: number; y: number; vx: number; vy: number; radius: number; pinned?: boolean; }
interface ForceEdge { source: string; target: string; }

function initPositions(count: number, spread = 120) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = spread * (0.4 + Math.random() * 0.4);
    return { x: Math.cos(angle) * r + (Math.random() - 0.5) * 10, y: Math.sin(angle) * r + (Math.random() - 0.5) * 10 };
  });
}

function tick(nodes: ForceNode[], edges: ForceEdge[]) {
  const cfg = { repulsion: 300, attraction: 0.06, centering: 0.008, damping: 0.82, maxSpeed: 2 };
  const n = nodes.length;
  if (n === 0) return;
  const nodeMap = new Map<string, ForceNode>();
  for (const node of nodes) nodeMap.set(node.id, node);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = nodes[i], b = nodes[j];
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) dist = 1;
    const force = cfg.repulsion / (dist * dist);
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
    if (!b.pinned) { b.vx += fx; b.vy += fy; }
  }
  const restLength = 40;
  for (const edge of edges) {
    const a = nodeMap.get(edge.source), b = nodeMap.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;
    const force = (dist - restLength) * cfg.attraction;
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }
  for (const node of nodes) {
    if (node.pinned) continue;
    node.vx -= node.x * cfg.centering;
    node.vy -= node.y * cfg.centering;
    node.vx *= cfg.damping; node.vy *= cfg.damping;
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > cfg.maxSpeed) { node.vx = (node.vx / speed) * cfg.maxSpeed; node.vy = (node.vy / speed) * cfg.maxSpeed; }
    node.x += node.vx; node.y += node.vy;
  }
}

function isSettled(nodes: ForceNode[], threshold = 0.1) {
  let energy = 0;
  for (const n of nodes) energy += n.vx * n.vx + n.vy * n.vy;
  return energy / nodes.length < threshold;
}

function scoreRelevance(node: Omit<ZoNode, 'relevance'>, suggestionHits: number, connectedRelevance: number) {
  let score = 0;
  const daysSince = (Date.now() - node.lastTouched) / (1000 * 60 * 60 * 24);
  score += Math.exp(-daysSince / 5) * 0.35;
  if (node.health === 'needs-attention') score += 0.25;
  else if (node.health === 'stale') score += 0.1;
  score += Math.min(suggestionHits * 0.1, 0.2);
  if (node.active) score += 0.1;
  score += connectedRelevance * 0.1;
  return Math.min(1, score);
}

function deriveNodes(ctx: ContextSnapshot | null, suggestions: Suggestion[] = []): ZoNode[] {
  if (!ctx) return [];
  const nodes: ZoNode[] = [];
  const now = Date.now();
  const { sections } = ctx;
  const recentPaths = new Set((sections.activity?.recently_modified || []).map((f: any) => f.path?.split('/')[0]));
  const commitTokens = (sections.activity?.git_commits || []).flatMap((c: any) => (c.message || '').toLowerCase().split(/\W+/));

  for (const skill of sections.skills || []) {
    const modified = new Date(skill.last_modified).getTime();
    const days = (now - modified) / (1000 * 60 * 60 * 24);
    const maturity = Math.min(1, (skill.script_count || 0) / 5 * 0.5 + (skill.has_scripts ? 0.3 : 0) + (skill.has_references ? 0.2 : 0));
    const items: NodeItem[] = [];
    for (const s of skill.scripts || []) items.push({ label: s, status: 'done' });
    if (!skill.has_scripts) items.push({ label: 'Add automation scripts', status: 'todo' });
    nodes.push({ id: `skill-${skill.name}`, label: skill.name, type: 'skill', health: days > 60 ? 'stale' : days > 30 ? 'needs-attention' : 'active', maturity, relevance: 0, active: days < 7 || recentPaths.has(skill.name), detail: `${skill.script_count || 0} scripts · ${Math.round(days)}d ago`, items, connections: [], lastTouched: modified });
  }

  for (const auto of sections.automations?.discovered || []) {
    const parentSkill = nodes.find(n => n.label === auto.skill);
    nodes.push({ id: `auto-${auto.skill}-${auto.type}`, label: auto.skill, type: 'automation', health: 'active', maturity: 0.6, relevance: 0, active: true, detail: auto.type, items: [{ label: `${auto.type} automation active`, status: 'done' }, { label: 'Review schedule & output', status: 'explore' }], connections: parentSkill ? [parentSkill.id] : [], lastTouched: parentSkill?.lastTouched || now });
  }

  for (const dir of (sections.workspace?.top_level_dirs || []).filter((d: any) => d.file_count > 3)) {
    if (dir.name === 'Skills' || dir.name === 'node_modules') continue;
    const recentlyActive = recentPaths.has(dir.name);
    const mentionedInCommits = commitTokens.includes(dir.name.toLowerCase());
    nodes.push({ id: `data-${dir.name}`, label: dir.name, type: 'data', health: 'active', maturity: Math.min(1, dir.file_count / 20), relevance: 0, active: recentlyActive, detail: `${dir.file_count} files · ${dir.size_mb}MB`, items: [{ label: `${dir.file_count} files stored`, status: 'done' }, ...(recentlyActive ? [{ label: 'Recently modified', status: 'explore' as const }] : []), ...(mentionedInCommits ? [{ label: 'Referenced in commits', status: 'explore' as const }] : []), { label: 'Explore connections', status: 'explore' }], connections: [], lastTouched: recentlyActive ? now : now - 7 * 86400000 });
  }

  if (sections.memory?.available) {
    nodes.push({ id: 'core-memory', label: 'Memory', type: 'core', health: 'active', maturity: 0.9, relevance: 0, active: true, detail: 'Supermemory active', items: [{ label: 'Knowledge graph connected', status: 'done' }, { label: 'Profile auto-generated', status: 'done' }, { label: 'Run memory hygiene check', status: 'explore' }], connections: nodes.filter(n => n.type === 'skill').map(n => n.id), lastTouched: now });
  }

  const jobs = sections.jobs?.summary;
  if (jobs && jobs.total > 0) {
    const jobItems: NodeItem[] = [];
    if (jobs.completed) jobItems.push({ label: `${jobs.completed} jobs completed`, status: 'done' });
    if (jobs.failed) jobItems.push({ label: `${jobs.failed} failed — investigate`, status: 'todo' });
    if (jobs.pending) jobItems.push({ label: `${jobs.pending} pending`, status: 'todo' });
    nodes.push({ id: 'core-jobs', label: 'Jobs', type: 'core', health: jobs.failed > 0 ? 'needs-attention' : 'active', maturity: 0.7, relevance: 0, active: jobs.pending > 0 || jobs.failed > 0, detail: `${jobs.completed} done · ${jobs.failed} failed`, items: jobItems, connections: [], lastTouched: now });
  }

  function connect(a: ZoNode, b: ZoNode) { if (a.id === b.id) return; if (!a.connections.includes(b.id)) a.connections.push(b.id); if (!b.connections.includes(a.id)) b.connections.push(a.id); }
  const stopWords = new Set(['zo', 'the', 'and', 'for', 'with', 'from', 'app']);
  function tokenize(s: string) { return s.toLowerCase().split(/[-_\s\/]+/).filter(t => t.length > 2 && !stopWords.has(t)); }

  for (let i = 0; i < nodes.length; i++) { const ta = tokenize(nodes[i].label); for (let j = i + 1; j < nodes.length; j++) { const tb = tokenize(nodes[j].label); if (ta.some(t => tb.includes(t))) connect(nodes[i], nodes[j]); } }
  for (const commit of sections.activity?.git_commits || []) { const msg = (commit.message || '').toLowerCase(); const mentioned = nodes.filter(n => tokenize(n.label).some(t => msg.includes(t))); for (let i = 0; i < mentioned.length; i++) for (let j = i + 1; j < mentioned.length; j++) connect(mentioned[i], mentioned[j]); }
  for (const sug of suggestions) { const text = `${sug.title} ${sug.description}`.toLowerCase(); const mentioned = nodes.filter(n => tokenize(n.label).some(t => text.includes(t))); for (let i = 0; i < mentioned.length; i++) for (let j = i + 1; j < mentioned.length; j++) connect(mentioned[i], mentioned[j]); }
  const TWO_DAYS = 2 * 86400000;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (Math.abs(nodes[i].lastTouched - nodes[j].lastTouched) < TWO_DAYS && nodes[i].active && nodes[j].active) connect(nodes[i], nodes[j]);
  for (const node of nodes) { if (node.type !== 'automation') continue; for (const other of nodes) if (other.type === 'skill' && node.label === other.label) connect(node, other); }
  const jobNode = nodes.find(n => n.id === 'core-jobs');
  if (jobNode) for (const node of nodes) if (node.type === 'skill' && node.items.some(i => i.label.includes('worker') || i.label.includes('job'))) connect(jobNode, node);

  for (const sug of suggestions) for (const node of nodes) if (sug.title.toLowerCase().includes(node.label.toLowerCase()) || sug.description.toLowerCase().includes(node.label.toLowerCase())) node.items.push({ label: sug.title, status: sug.category === 'act' || sug.category === 'maintain' ? 'todo' : 'explore' });

  const suggestionCounts = new Map<string, number>();
  for (const sug of suggestions) for (const node of nodes) if (sug.title.toLowerCase().includes(node.label.toLowerCase())) suggestionCounts.set(node.id, (suggestionCounts.get(node.id) || 0) + 1);
  for (const node of nodes) (node as any)._br = scoreRelevance(node, suggestionCounts.get(node.id) || 0, 0);
  for (const node of nodes) { const ca = node.connections.length ? node.connections.reduce((s, cid) => s + ((nodes.find(n => n.id === cid) as any)?._br || 0), 0) / node.connections.length : 0; node.relevance = scoreRelevance(node, suggestionCounts.get(node.id) || 0, ca); }
  for (const node of nodes) delete (node as any)._br;
  nodes.sort((a, b) => b.relevance - a.relevance);
  return nodes;
}

interface Camera { x: number; y: number; zoom: number; }

function buildGraph(nodes: ZoNode[], filter: string) {
  const filtered = filter === 'all' ? nodes : nodes.filter(n => n.type === filter);
  const ids = new Set(filtered.map(n => n.id));
  const positions = initPositions(filtered.length, 180);
  const forceNodes: ForceNode[] = filtered.map((n, i) => ({ id: n.id, x: positions[i].x, y: positions[i].y, vx: 0, vy: 0, radius: 1.5 + n.relevance * 1.5 + n.maturity * 1 }));
  const forceEdges: ForceEdge[] = [];
  for (const n of filtered) for (const cid of n.connections) if (ids.has(cid) && n.id < cid) forceEdges.push({ source: n.id, target: cid });
  return { forceNodes, forceEdges };
}

function GrowthViz({ nodes, selectedId, onSelect, filter, theme }: { nodes: ZoNode[]; selectedId: string | null; onSelect: (id: string) => void; filter: string; theme: 'dark' | 'light' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const simRef = useRef<{ nodes: ForceNode[]; edges: ForceEdge[] }>({ nodes: [], edges: [] });
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const zoNodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const autoFitDone = useRef(false);
  const targetCam = useRef<Camera | null>(null);

  useEffect(() => {
    const { forceNodes, forceEdges } = buildGraph(nodes, filter);
    simRef.current = { nodes: forceNodes, edges: forceEdges };
    cameraRef.current = { x: 0, y: 0, zoom: 0.6 };
    autoFitDone.current = false;
    targetCam.current = null;
  }, [nodes, filter]);

  const screenToWorld = useCallback((sx: number, sy: number, canvas: HTMLCanvasElement) => {
    const cam = cameraRef.current;
    const rect = canvas.getBoundingClientRect();
    return { x: (sx - rect.width / 2) / cam.zoom - cam.x, y: (sy - rect.height / 2) / cam.zoom - cam.y };
  }, []);

  const findNodeAt = useCallback((wx: number, wy: number): ForceNode | null => {
    let closest: ForceNode | null = null, closestDist = Infinity;
    for (const n of simRef.current.nodes) { const d = Math.sqrt((n.x - wx) ** 2 + (n.y - wy) ** 2); if (d < Math.max(n.radius * 2, 8) && d < closestDist) { closest = n; closestDist = d; } }
    return closest;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let settled = false;

    function render() {
      if (!canvas || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = rect.width, h = rect.height, cam = cameraRef.current, sim = simRef.current;

      if (!settled) {
        tick(sim.nodes, sim.edges);
        settled = isSettled(sim.nodes, 0.05);
        if (settled && !autoFitDone.current && sim.nodes.length > 0) {
          autoFitDone.current = true;
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const n of sim.nodes) { minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius); minY = Math.min(minY, n.y - n.radius); maxY = Math.max(maxY, n.y + n.radius); }
          const padding = 60;
          targetCam.current = { x: -(minX + maxX) / 2, y: -(minY + maxY) / 2, zoom: Math.min((w - padding * 2) / ((maxX - minX) || 1), (h - padding * 2) / ((maxY - minY) || 1), 3) };
        }
      }

      if (targetCam.current) {
        const t = targetCam.current, ease = 0.06;
        cam.x += (t.x - cam.x) * ease; cam.y += (t.y - cam.y) * ease; cam.zoom += (t.zoom - cam.zoom) * ease;
        if (Math.abs(t.x - cam.x) < 0.1 && Math.abs(t.y - cam.y) < 0.1 && Math.abs(t.zoom - cam.zoom) < 0.001) { cam.x = t.x; cam.y = t.y; cam.zoom = t.zoom; targetCam.current = null; }
      }

      // Canvas can't use CSS vars — resolve theme to concrete RGB values
      const fgRgb = theme === 'light' ? '20,20,20' : '255,255,255';
      const bgColor = theme === 'light' ? '#fafafa' : '#000000';
      const fgColor = theme === 'light' ? '#111111' : '#ffffff';

      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(cam.zoom, cam.zoom); ctx.translate(cam.x, cam.y);

      const nodeById = new Map(sim.nodes.map(n => [n.id, n]));
      for (const edge of sim.edges) {
        const a = nodeById.get(edge.source), b = nodeById.get(edge.target);
        if (!a || !b) continue;
        const hl = selectedId === a.id || selectedId === b.id || hovered === a.id || hovered === b.id;
        ctx.strokeStyle = hl ? `rgba(${fgRgb},${Math.min(0.2 + cam.zoom * 0.1, 0.6)})` : `rgba(${fgRgb},${Math.min(0.06 + cam.zoom * 0.04, 0.2)})`;
        ctx.lineWidth = hl ? 0.6 / cam.zoom : 0.3 / cam.zoom;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      for (const node of sim.nodes) {
        const isSel = node.id === selectedId, isHov = node.id === hovered;
        const zoNode = zoNodeMap.get(node.id);
        let r = node.radius; if (isSel || isHov) r *= 1.3;
        if (zoNode?.active) { ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2); ctx.fillStyle = `rgba(${fgRgb},0.03)`; ctx.fill(); }
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? fgColor : isHov ? `rgba(${fgRgb},0.9)` : zoNode?.health === 'needs-attention' ? `rgba(${fgRgb},0.6)` : `rgba(${fgRgb},0.7)`;
        ctx.fill();
        if (isSel) { ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2); ctx.strokeStyle = `rgba(${fgRgb},0.5)`; ctx.lineWidth = 0.5 / cam.zoom; ctx.stroke(); }
        if (cam.zoom > 0.8 || isHov || isSel) {
          ctx.font = `${10 / cam.zoom}px "Diatype","Inter",sans-serif`;
          ctx.fillStyle = isSel || isHov ? `rgba(${fgRgb},0.9)` : `rgba(${fgRgb},0.35)`;
          ctx.textAlign = 'center'; ctx.fillText(zoNode?.label || node.id, node.x, node.y + r + 12 / cam.zoom);
        }
      }
      ctx.restore();
      frameRef.current = requestAnimationFrame(render);
    }
    frameRef.current = requestAnimationFrame(render);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [nodes, filter, selectedId, hovered, zoNodeMap, theme]);

  const handleWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); const cam = cameraRef.current; cam.zoom = Math.max(0.2, Math.min(5, cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); }, []);
  const handleMouseDown = useCallback((e: React.MouseEvent) => { dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY }; }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    if (dragRef.current.dragging) { const cam = cameraRef.current; cam.x += (e.clientX - dragRef.current.lastX) / cam.zoom; cam.y += (e.clientY - dragRef.current.lastY) / cam.zoom; dragRef.current.lastX = e.clientX; dragRef.current.lastY = e.clientY; }
    else { const rect = canvas.getBoundingClientRect(); const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas); const hit = findNodeAt(x, y); setHovered(hit?.id || null); canvas.style.cursor = hit ? 'pointer' : 'grab'; }
  }, [screenToWorld, findNodeAt]);
  const handleMouseUp = useCallback(() => { dragRef.current.dragging = false; }, []);
  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, canvas);
    const hit = findNodeAt(x, y);
    if (hit) onSelect(hit.id === selectedId ? '' : hit.id);
  }, [screenToWorld, findNodeAt, onSelect, selectedId]);

  return <canvas ref={canvasRef} onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onClick={handleClick} style={{ width: '100%', height: '100%', minHeight: 420, borderRadius: 12, cursor: 'grab', display: 'block' }} />;
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`; if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`; return `${Math.floor(diff / 86400)}d ago`;
}

// ─── ProjectsPanel ───────────────────────────────────────────────────────────

function StepRow({ project, step, onChange }: { project: Project; step: ProjectStep; onChange: () => void }) {
  const [run, setRun] = useState<Run | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(!!step.last_run_id);
  const [outputExpanded, setOutputExpanded] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Fetch initial run if step has a last_run_id
  useEffect(() => {
    if (!step.last_run_id) { setRun(null); setLoadingInitial(false); return; }
    let cancelled = false;
    getRun(step.last_run_id).then(r => { if (!cancelled) { setRun(r); setLoadingInitial(false); } });
    return () => { cancelled = true; };
  }, [step.last_run_id]);

  // Poll while running
  useEffect(() => {
    if (!run || (run.status !== 'pending' && run.status !== 'running')) return;
    const runId = run.id;
    pollRef.current = window.setInterval(async () => {
      const r = await getRun(runId);
      if (r) {
        setRun(r);
        if (r.status === 'success' || r.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current);
          // If success, auto-mark step done
          if (r.status === 'success' && step.status !== 'done') {
            await updateStep(project.id, step.id, { status: 'done' });
            onChange();
          }
        }
      }
    }, 1200);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [run?.id, run?.status]);

  async function toggle() {
    await updateStep(project.id, step.id, { status: step.status === 'done' ? 'pending' : 'done' });
    onChange();
  }

  async function kickoff() {
    const r = await runStep(project.id, step.id);
    setRun(r);
  }

  const isExecutable = step.executor && step.executor.type !== 'manual';
  const isRunning = run && (run.status === 'pending' || run.status === 'running');
  const hasResult = run && (run.status === 'success' || run.status === 'failed');

  return (
    <div style={{ padding: '6px 0', fontFamily: tokens.font.body }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={(e) => { e.stopPropagation(); toggle(); }} style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid rgba(var(--fg-rgb),0.3)', background: step.status === 'done' ? 'rgba(var(--fg-rgb),0.9)' : 'transparent', cursor: 'pointer', color: 'var(--bg)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
          {step.status === 'done' ? '✓' : ''}
        </button>
        <span style={{ fontSize: 14, color: step.status === 'done' ? 'rgba(var(--fg-rgb),0.25)' : 'rgba(var(--fg-rgb),0.7)', textDecoration: step.status === 'done' ? 'line-through' : 'none', fontWeight: 400, flex: 1 }}>{step.label}</span>
        {isExecutable && step.executor && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: tokens.font.mono, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{step.executor.type.replace('_', ' ')}</span>
        )}
        {isExecutable && !isRunning && (
          <button onClick={(e) => { e.stopPropagation(); kickoff(); }} disabled={loadingInitial} style={{ fontSize: 11, padding: '2px 8px', border: '1px solid rgba(var(--fg-rgb),0.15)', borderRadius: 10, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: tokens.font.body }}>
            {run ? 'rerun' : 'run ▸'}
          </button>
        )}
        {isRunning && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>
            running…
          </span>
        )}
        {hasResult && run && (
          <button onClick={(e) => { e.stopPropagation(); setOutputExpanded(x => !x); }} style={{ fontSize: 11, padding: '2px 8px', border: 'none', background: 'transparent', color: run.status === 'failed' ? 'rgba(var(--fg-rgb),0.6)' : 'rgba(var(--fg-rgb),0.35)', cursor: 'pointer', fontFamily: tokens.font.body }}>
            {run.status === 'failed' ? '⚠ failed' : outputExpanded ? 'hide' : 'show result'}
          </button>
        )}
      </div>
      {hasResult && run && outputExpanded && (
        <div style={{ marginTop: 6, marginLeft: 22, padding: 10, background: 'rgba(var(--fg-rgb),0.03)', borderRadius: 6, fontSize: 12, lineHeight: 1.6, color: run.status === 'failed' ? 'rgba(var(--fg-rgb),0.5)' : 'rgba(var(--fg-rgb),0.55)', fontFamily: tokens.font.mono, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
          {run.error ? `Error: ${run.error}\n\n` : ''}
          {run.output || '(no output)'}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, nodes, onChange }: { project: Project; nodes: ZoNode[]; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [runningToday, setRunningToday] = useState(false);
  const doneCount = project.plan.filter(s => s.status === 'done').length;
  const totalCount = project.plan.length;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const nextStep = project.plan.find(s => s.status !== 'done');
  const linkedNodes = project.linked_node_ids.map(id => nodes.find(n => n.id === id)).filter((n): n is ZoNode => !!n);
  const executableCount = project.plan.filter(s => s.status === 'pending' && s.executor && s.executor.type !== 'manual').length;

  async function handleRegenerate() {
    setRegenerating(true);
    await regeneratePlan(project.id);
    setRegenerating(false);
    onChange();
  }
  async function handleArchive() {
    if (!confirm(`Archive "${project.title}"?`)) return;
    await archiveProject(project.id);
    onChange();
  }
  async function handleRunToday() {
    if (executableCount === 0) return;
    setRunningToday(true);
    await runToday(project.id);
    setRunningToday(false);
    onChange();
  }

  return (
    <Collapsible.Root open={expanded} onOpenChange={setExpanded}>
      <div style={{ border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, padding: 16, marginBottom: 10, background: 'rgba(var(--fg-rgb),0.01)' }}>
        <Collapsible.Trigger asChild>
          <button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--fg)', fontFamily: tokens.font.body, padding: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: tokens.font.display, fontSize: 15, fontWeight: 400, color: 'var(--fg)', flex: 1 }}>{project.title}</span>
              {project.ai_generated && <span style={{ fontSize: 11, color: 'var(--text-faint)', border: '1px solid rgba(var(--fg-rgb),0.1)', padding: '1px 5px', borderRadius: 8 }}>ai</span>}
              <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: 'var(--text-dim)' }}>{doneCount}/{totalCount}</span>
              <span style={{ fontSize: 13, color: 'var(--text-faint)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>›</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-subtle)', fontWeight: 400, marginBottom: 8, lineHeight: 1.5 }}>{project.goal}</div>
            <Progress.Root style={{ height: 1, background: 'rgba(var(--fg-rgb),0.06)', borderRadius: 1, overflow: 'hidden', marginBottom: 8 }}>
              <Progress.Indicator style={{ height: '100%', width: `${pct}%`, background: 'rgba(var(--fg-rgb),0.35)', transition: 'width 0.4s ease' }} />
            </Progress.Root>
            {nextStep && !expanded && <div style={{ fontSize: 12, color: 'var(--text-subtle)', fontFamily: tokens.font.body }}><span style={{ color: 'var(--text-faint)', marginRight: 6 }}>next:</span>{nextStep.label}</div>}
          </button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(var(--fg-rgb),0.04)' }}>
            {project.plan.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-faint)', fontStyle: 'italic', fontFamily: tokens.font.body }}>No plan yet.</div>
            ) : (
              project.plan.map(step => (
                <StepRow key={step.id} project={project} step={step} onChange={onChange} />
              ))
            )}
            {linkedNodes.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid rgba(var(--fg-rgb),0.04)' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-faint)', marginBottom: 6, fontFamily: tokens.font.body }}>linked</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {linkedNodes.map(n => <span key={n.id} style={{ fontSize: 12, padding: '2px 8px', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, color: 'var(--text-muted)', fontFamily: tokens.font.body }}>{n.label}</span>)}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              {executableCount > 0 && (
                <button onClick={handleRunToday} disabled={runningToday} style={{ fontSize: 12, padding: '4px 12px', border: '1px solid rgba(var(--fg-rgb),0.3)', borderRadius: 14, background: 'rgba(var(--fg-rgb),0.06)', color: 'var(--fg)', cursor: runningToday ? 'wait' : 'pointer', fontFamily: tokens.font.body, fontWeight: 400 }}>
                  {runningToday ? 'dispatching…' : `run today (${executableCount})`}
                </button>
              )}
              <button onClick={handleRegenerate} disabled={regenerating} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 14, background: 'transparent', color: 'var(--text-subtle)', cursor: regenerating ? 'wait' : 'pointer', fontFamily: tokens.font.body }}>
                {regenerating ? 'regenerating...' : 'regenerate plan'}
              </button>
              <button onClick={handleArchive} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 14, background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: tokens.font.body, marginLeft: 'auto' }}>
                archive
              </button>
            </div>
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!title.trim() || !goal.trim() || creating) return;
    setCreating(true);
    await createProject(title.trim(), goal.trim(), true);
    setCreating(false);
    setTitle(''); setGoal('');
    onOpenChange(false);
    onCreated();
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
        <Dialog.Content style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: 520, background: 'var(--surface)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 14, padding: 24, zIndex: 101 }}>
          <Dialog.Title style={{ fontFamily: tokens.font.display, fontSize: 18, fontWeight: 400, marginBottom: 6, color: 'var(--fg)' }}>New project</Dialog.Title>
          <Dialog.Description style={{ fontSize: 13, fontFamily: tokens.font.body, color: 'var(--text-subtle)', marginBottom: 16 }}>
            A project gets an AI-generated plan based on your current zo state.
          </Dialog.Description>
          <input autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="title (short, specific)" style={{ width: '100%', fontFamily: tokens.font.body, fontSize: 14, padding: '10px 14px', background: 'var(--bg)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 8, color: 'var(--fg)', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
          <textarea value={goal} onChange={e => setGoal(e.target.value)} placeholder="what's the goal? one or two sentences." rows={3} style={{ width: '100%', fontFamily: tokens.font.body, fontSize: 14, padding: '10px 14px', background: 'var(--bg)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 8, color: 'var(--fg)', outline: 'none', marginBottom: 16, resize: 'vertical', boxSizing: 'border-box', fontWeight: 400 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => onOpenChange(false)} style={{ fontFamily: tokens.font.body, fontSize: 13, padding: '8px 16px', background: 'transparent', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 8, color: 'var(--text-muted)', cursor: 'pointer' }}>cancel</button>
            <button onClick={handleCreate} disabled={creating || !title.trim() || !goal.trim()} style={{ fontFamily: tokens.font.body, fontSize: 13, padding: '8px 16px', background: 'var(--fg)', border: 'none', borderRadius: 8, color: 'var(--bg)', cursor: creating ? 'wait' : 'pointer', fontWeight: 500, opacity: creating ? 0.5 : 1 }}>
              {creating ? 'creating...' : 'create with ai plan'}
            </button>
          </div>
          <Dialog.Close asChild><button style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 16, cursor: 'pointer' }}>x</button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ProjectsPanel({ projects, nodes, onChange }: { projects: Project[]; nodes: ZoNode[]; onChange: () => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const active = projects.filter(p => p.status === 'active' || p.status === 'paused');
  const completed = projects.filter(p => p.status === 'done');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <span style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 400, color: 'var(--fg)' }}>projects</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.body }}>{active.length} active{completed.length > 0 ? ` · ${completed.length} done` : ''}</span>
        <button onClick={() => setDialogOpen(true)} style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 12px', border: '1px dashed rgba(var(--fg-rgb),0.15)', borderRadius: 20, background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', fontFamily: tokens.font.body }}>
          + new project
        </button>
      </div>
      {active.length === 0 && completed.length === 0 ? (
        <div style={{ padding: '20px 0', color: 'var(--text-faint)', fontSize: 14, fontFamily: tokens.font.body, fontStyle: 'italic' }}>
          No projects yet. Create one and zo will generate a plan from your current state.
        </div>
      ) : (
        <>
          {active.map(p => <ProjectCard key={p.id} project={p} nodes={nodes} onChange={onChange} />)}
          {completed.length > 0 && <div style={{ marginTop: 16, fontSize: 11, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-faint)', fontFamily: tokens.font.body, marginBottom: 8 }}>completed</div>}
          {completed.map(p => <ProjectCard key={p.id} project={p} nodes={nodes} onChange={onChange} />)}
        </>
      )}
      <NewProjectDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={onChange} />
    </div>
  );
}

function Summary({ context, nodes, suggestions }: { context: ContextSnapshot | null; nodes: ZoNode[]; suggestions: SuggestionsData | null }) {
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const briefingFetched = useRef(false);

  useEffect(() => {
    if (!context || briefingFetched.current) return;
    briefingFetched.current = true;
    setLoadingBriefing(true);
    const { sections } = context;
    const jobs = sections.jobs?.summary;
    const commits = sections.activity?.git_commits || [];
    const skills = sections.skills || [];
    const automations = sections.automations?.discovered || [];
    const sugs = suggestions?.suggestions || [];
    const snapshot = [
      `${skills.length} skills installed: ${skills.map(s => s.name).join(', ')}`,
      `${automations.length} automations running`,
      jobs ? `Jobs: ${jobs.completed} completed, ${jobs.pending} pending, ${jobs.failed} failed` : 'No jobs',
      commits.length ? `Last ${Math.min(commits.length, 5)} commits: ${commits.slice(0, 5).map(c => c.message).join('; ')}` : 'No recent commits',
      sugs.length ? `${sugs.length} suggestions generated, ${sugs.filter(s => s.priority === 'high').length} high priority` : 'No suggestions',
      `Most active: ${nodes.slice(0, 3).map(n => n.label).join(', ')}`,
    ].join('\n');
    askZo(`You are summarizing the current state of a Zo computer for its owner. Write a 2-3 sentence natural language briefing of what's going on right now. Be conversational and specific — mention what's active, what needs attention, and what the user has been working on recently. Don't use bullet points or lists. Here's the snapshot:\n\n${snapshot}`)
      .then(r => setBriefing(r)).catch(() => setBriefing(null)).finally(() => setLoadingBriefing(false));
  }, [context]);

  if (!context) return <div style={{ color: 'var(--text-faint)', fontSize: 14, fontFamily: tokens.font.body }}>Loading...</div>;

  const totalDone = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'done').length, 0);
  const totalAll = nodes.reduce((n, nd) => n + nd.items.length, 0);
  const overallPct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: 20, minHeight: 40 }}>
        {loadingBriefing ? (
          <div style={{ fontSize: 14, color: 'var(--text-faint)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>reading your zo...</div>
        ) : briefing ? (
          <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-muted)', fontFamily: tokens.font.body, fontWeight: 400 }}>{briefing}</div>
        ) : null}
      </div>
      <Progress.Root style={{ height: 1, background: 'rgba(var(--fg-rgb),0.06)', borderRadius: 1, overflow: 'hidden' }}>
        <Progress.Indicator style={{ height: '100%', width: `${overallPct}%`, background: 'rgba(var(--fg-rgb),0.3)', transition: 'width 0.5s ease' }} />
      </Progress.Root>
    </div>
  );
}

function NodeDetail({ node, nodes, suggestions, projects = [], onProjectsChange }: { node: ZoNode; nodes: ZoNode[]; suggestions: Suggestion[]; projects?: Project[]; onProjectsChange?: () => void }) {
  const linkedToProjects = projects.filter(p => p.linked_node_ids.includes(node.id) && p.status !== 'archived');
  const unlinkedProjects = projects.filter(p => !p.linked_node_ids.includes(node.id) && p.status === 'active');
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);

  async function link(pid: string) {
    await linkNodeToProject(pid, node.id);
    setLinkMenuOpen(false);
    onProjectsChange?.();
  }
  async function unlink(pid: string) {
    await unlinkNodeFromProject(pid, node.id);
    onProjectsChange?.();
  }
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (node.id === lastId.current) return;
    lastId.current = node.id;
    setSummary(null); setLoading(true);
    const connectedLabels = node.connections.map(cid => nodes.find(n => n.id === cid)?.label).filter(Boolean);
    askZo(`Summarize what "${node.label}" is in 2-3 sentences. It's a ${node.type} in a Zo workspace. Details: ${node.detail}. Connected to: ${connectedLabels.join(', ') || 'nothing'}. Be concise.`)
      .then(r => setSummary(r)).catch(() => setSummary(null)).finally(() => setLoading(false));
  }, [node.id]);

  const connectedNodes = node.connections.map(cid => nodes.find(n => n.id === cid)).filter((n): n is ZoNode => !!n);
  const nodeTokens = node.label.toLowerCase().split(/[-_\s]+/).filter(t => t.length > 2);
  const relatedSuggestions = suggestions.filter(s => { const text = `${s.title} ${s.description}`.toLowerCase(); return nodeTokens.some(t => text.includes(t)); });

  return (
    <ScrollArea.Root style={{ flex: 1, overflow: 'hidden', maxHeight: 500 }}>
      <ScrollArea.Viewport style={{ width: '100%', height: '100%' }}>
        <div style={{ marginBottom: 16 }}>
          {loading ? <div style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>thinking...</div>
            : summary ? <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-muted)', fontFamily: tokens.font.body, fontWeight: 400 }}>{summary}</div> : null}
        </div>
        {connectedNodes.length > 0 && <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontFamily: tokens.font.body, marginBottom: 8 }}>connected</div>
          {connectedNodes.map(cn => <div key={cn.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.04)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(var(--fg-rgb),0.3)' }} />
            <span style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.6)', fontFamily: tokens.font.body, fontWeight: 400 }}>{cn.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: tokens.font.body, marginLeft: 'auto' }}>{cn.type}</span>
          </div>)}
        </div>}

        {/* Project linking */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontFamily: tokens.font.body }}>projects</div>
            {unlinkedProjects.length > 0 && (
              <Popover.Root open={linkMenuOpen} onOpenChange={setLinkMenuOpen}>
                <Popover.Trigger asChild>
                  <button style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', border: '1px dashed rgba(var(--fg-rgb),0.15)', borderRadius: 10, background: 'transparent', color: 'var(--text-subtle)', cursor: 'pointer', fontFamily: tokens.font.body }}>+ link</button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content side="left" sideOffset={6} style={{ background: 'var(--surface)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, padding: 6, zIndex: 60, minWidth: 180, maxHeight: 240, overflow: 'auto' }}>
                    {unlinkedProjects.map(p => (
                      <button key={p.id} onClick={() => link(p.id)} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 10px', fontSize: 13, color: 'rgba(var(--fg-rgb),0.7)', cursor: 'pointer', fontFamily: tokens.font.body, borderRadius: 6 }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg-rgb),0.06)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                        {p.title}
                      </button>
                    ))}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            )}
          </div>
          {linkedToProjects.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>not linked to any project</div>
          ) : (
            linkedToProjects.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontFamily: tokens.font.body }}>
                <span style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.6)', fontWeight: 400, flex: 1 }}>{p.title}</span>
                <span style={{ fontSize: 11, fontFamily: tokens.font.mono, color: 'var(--text-faint)' }}>{p.plan.filter(s => s.status === 'done').length}/{p.plan.length}</span>
                <button onClick={() => unlink(p.id)} style={{ fontSize: 11, padding: 0, border: 'none', background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', fontFamily: tokens.font.body }}>unlink</button>
              </div>
            ))
          )}
        </div>

        <Separator.Root style={{ height: 1, background: 'rgba(var(--fg-rgb),0.06)', marginBottom: 16 }} />
        {relatedSuggestions.length > 0 ? <div>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontFamily: tokens.font.body, marginBottom: 8 }}>suggestions</div>
          {relatedSuggestions.map((s, i) => <Collapsible.Root key={i}>
            <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(var(--fg-rgb),0.04)', padding: '8px 0', cursor: 'pointer', color: 'var(--fg)', fontFamily: tokens.font.body }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', color: s.priority === 'high' ? 'rgba(var(--fg-rgb),0.5)' : 'rgba(var(--fg-rgb),0.2)', flexShrink: 0 }}>{s.category}</span>
                <span style={{ fontSize: 13, fontWeight: 400, flex: 1 }}>{s.title}</span>
              </div>
            </button></Collapsible.Trigger>
            <Collapsible.Content><div style={{ padding: '4px 0 12px 0', fontSize: 12, lineHeight: 1.7, fontFamily: tokens.font.body, color: 'var(--text-subtle)' }}>{s.description}</div></Collapsible.Content>
          </Collapsible.Root>)}
        </div> : <div style={{ fontSize: 13, color: 'var(--text-faint)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>no suggestions for this node</div>}
        {node.items.length > 0 && <>
          <Separator.Root style={{ height: 1, background: 'rgba(var(--fg-rgb),0.06)', margin: '16px 0' }} />
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', fontFamily: tokens.font.body, marginBottom: 8 }}>items</div>
          {node.items.map((item, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13, fontFamily: tokens.font.body }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{item.status === 'done' ? '✓' : item.status === 'todo' ? '○' : '?'}</span>
            <span style={{ color: item.status === 'done' ? 'rgba(var(--fg-rgb),0.2)' : 'rgba(var(--fg-rgb),0.55)', textDecoration: item.status === 'done' ? 'line-through' : 'none', fontWeight: 400 }}>{item.label}</span>
          </div>)}
        </>}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}><ScrollArea.Thumb style={{ background: 'rgba(var(--fg-rgb),0.15)', borderRadius: 20 }} /></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function ActivityPanel({ commits, automations, jobs }: { commits: Commit[]; automations: Automation[]; jobs: JobSummary }) {
  function ago(d: string) { const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000); if (diff < 60) return `${diff}s`; if (diff < 3600) return `${Math.floor(diff / 60)}m`; if (diff < 86400) return `${Math.floor(diff / 3600)}h`; return `${Math.floor(diff / 86400)}d`; }
  return (
    <Tabs.Root defaultValue="commits">
      <Tabs.List style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(var(--fg-rgb),0.06)', marginBottom: 16 }}>
        {['commits', 'automations', 'jobs'].map(tab => <Tabs.Trigger key={tab} value={tab} style={{ fontSize: 13, padding: '8px 16px', border: 'none', borderBottom: '1px solid transparent', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase', transition: 'all 0.15s' }}>{tab}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="commits">
        {commits.length === 0 ? <div style={{ padding: 20, color: 'var(--text-faint)', fontSize: 14, fontFamily: tokens.font.body }}>no recent commits</div> :
          commits.slice(0, 12).map((c, i) => <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.03)', fontSize: 13, display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: tokens.font.body }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>{c.hash}</span>
            <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400 }}>{c.message}</span>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: 'var(--text-faint)', flexShrink: 0 }}>{ago(c.date)}</span>
          </div>)}
      </Tabs.Content>
      <Tabs.Content value="automations">
        {automations.length === 0 ? <div style={{ padding: 20, color: 'var(--text-faint)', fontSize: 14, fontFamily: tokens.font.body }}>no automations</div> :
          automations.map((a, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.03)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(var(--fg-rgb),0.3)' }} />
            <span style={{ fontSize: 14, color: 'rgba(var(--fg-rgb),0.6)', fontFamily: tokens.font.body, fontWeight: 400 }}>{a.skill}</span>
            <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.body }}>{a.type}</span>
          </div>)}
      </Tabs.Content>
      <Tabs.Content value="jobs">
        {[{ label: 'total', value: jobs.total }, { label: 'completed', value: jobs.completed }, { label: 'pending', value: jobs.pending }, { label: 'failed', value: jobs.failed }].map(row =>
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.03)', fontFamily: tokens.font.body }}>
            <span style={{ fontSize: 14, color: 'var(--text-subtle)', fontWeight: 400 }}>{row.label}</span>
            <span style={{ fontSize: 14, color: row.value > 0 && row.label === 'failed' ? 'var(--fg)' : 'rgba(var(--fg-rgb),0.5)', fontFamily: tokens.font.mono }}>{row.value}</span>
          </div>)}
      </Tabs.Content>
    </Tabs.Root>
  );
}

function AskBar() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAsk() {
    if (!question.trim() || loading) return;
    setLoading(true); setAnswer('');
    try { setAnswer(await askZo(question.trim())); } catch (e) { setAnswer(`Error: ${e}`); }
    setLoading(false);
  }

  return <>
    <div onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)', cursor: 'text' }}>
      <span style={{ fontFamily: tokens.font.display, fontSize: 14, color: 'var(--text-dim)' }}>zo</span>
      <span style={{ fontFamily: tokens.font.body, fontSize: 14, color: 'var(--text-faint)', fontWeight: 400 }}>ask about your dashboard...</span>
      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)', fontFamily: tokens.font.mono, border: '1px solid rgba(var(--fg-rgb),0.08)', padding: '1px 5px', borderRadius: 4 }}>/</span>
    </div>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
        <Dialog.Content style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: 560, background: 'var(--surface)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 14, padding: 24, zIndex: 101, maxHeight: '70vh', overflow: 'auto' }}>
          <Dialog.Title style={{ fontFamily: tokens.font.display, fontSize: 18, fontWeight: 400, marginBottom: 16, color: 'var(--fg)' }}>zo</Dialog.Title>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input autoFocus value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()} placeholder="what should I focus on today?" style={{ flex: 1, fontFamily: tokens.font.body, fontSize: 14, padding: '10px 14px', background: 'var(--bg)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 8, color: 'var(--fg)', outline: 'none', fontWeight: 400 }} />
            <button onClick={handleAsk} disabled={loading || !question.trim()} style={{ fontFamily: tokens.font.body, fontSize: 14, padding: '10px 18px', background: 'var(--fg)', border: 'none', borderRadius: 8, color: 'var(--bg)', cursor: loading ? 'wait' : 'pointer', fontWeight: 500, opacity: loading ? 0.5 : 1 }}>{loading ? '...' : 'ask'}</button>
          </div>
          {answer && <div style={{ padding: 14, background: 'rgba(var(--fg-rgb),0.03)', borderRadius: 8, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: tokens.font.body, fontWeight: 400, color: 'rgba(var(--fg-rgb),0.6)' }}>{answer}</div>}
          <Dialog.Close asChild><button style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 16, cursor: 'pointer' }}>x</button></Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>;
}

function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  const [filter, setFilter] = useState('all');
  const categories = ['all', ...new Set(suggestions.map(s => s.category))];
  const filtered = filter === 'all' ? suggestions : suggestions.filter(s => s.category === filter);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 400, color: 'var(--fg)' }}>suggestions</span>
        <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.body }}>{suggestions.length}</span>
        <ToggleGroup.Root type="single" value={filter} onValueChange={v => v && setFilter(v)} style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {categories.map(cat => <ToggleGroup.Item key={cat} value={cat} style={{ fontSize: 12, padding: '3px 10px', border: 'none', borderRadius: 20, background: filter === cat ? 'rgba(var(--fg-rgb),0.08)' : 'transparent', color: filter === cat ? 'var(--fg)' : 'rgba(var(--fg-rgb),0.25)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase' }}>{cat}</ToggleGroup.Item>)}
        </ToggleGroup.Root>
      </div>
      {filtered.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-faint)', fontSize: 14, fontFamily: tokens.font.body }}>nothing here</div> :
        filtered.map((s, i) => <Collapsible.Root key={i}>
          <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(var(--fg-rgb),0.04)', padding: '12px 0', cursor: 'pointer', color: 'var(--fg)', fontFamily: tokens.font.body, transition: 'opacity 0.15s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', width: 60, flexShrink: 0 }}>{s.category}</span>
              <span style={{ fontSize: 14, fontWeight: 400, flex: 1 }}>{s.title}</span>
              {s.source === 'ai' && <span style={{ fontSize: 11, color: 'var(--text-faint)', border: '1px solid rgba(var(--fg-rgb),0.1)', padding: '1px 6px', borderRadius: 10 }}>ai</span>}
            </div>
          </button></Collapsible.Trigger>
          <Collapsible.Content><div style={{ padding: '4px 0 16px 70px', fontSize: 13, lineHeight: 1.7, fontFamily: tokens.font.body }}>
            <div style={{ color: 'var(--text-subtle)', marginBottom: 8 }}>{s.description}</div>
            {s.action && <div style={{ fontFamily: tokens.font.mono, fontSize: 12, color: 'var(--text-dim)', padding: '6px 10px', background: 'rgba(var(--fg-rgb),0.03)', borderRadius: 6 }}>{s.action}</div>}
          </div></Collapsible.Content>
        </Collapsible.Root>)}
    </div>
  );
}

function ZoView({ nodes, suggestions = [], projects = [], onProjectsChange, theme = 'dark' }: { nodes: ZoNode[]; suggestions?: Suggestion[]; projects?: Project[]; onProjectsChange?: () => void; theme?: 'dark' | 'light' }) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = nodes.find(n => n.id === selectedId) || null;
  const types = ['all', ...new Set(nodes.map(n => n.type))];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedNode ? '1fr 300px' : '1fr', gap: 20 }}>
      <div style={{ background: 'var(--bg)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)', flexWrap: 'wrap' }}>
          <ToggleGroup.Root type="single" value={mode} onValueChange={v => v && setMode(v as any)} style={{ display: 'flex', gap: 2 }}>
            {['graph', 'list'].map(m => <ToggleGroup.Item key={m} value={m} style={{ fontSize: 12, padding: '4px 12px', border: '1px solid', borderColor: mode === m ? 'rgba(var(--fg-rgb),0.3)' : 'rgba(var(--fg-rgb),0.08)', borderRadius: 20, background: mode === m ? 'rgba(var(--fg-rgb),0.06)' : 'transparent', color: mode === m ? 'var(--fg)' : 'rgba(var(--fg-rgb),0.4)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase', letterSpacing: '0.5px' }}>{m}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
          <Separator.Root orientation="vertical" style={{ width: 1, height: 16, background: 'rgba(var(--fg-rgb),0.08)' }} />
          <ToggleGroup.Root type="single" value={filter} onValueChange={v => v && setFilter(v)} style={{ display: 'flex', gap: 2 }}>
            {types.map(t => <ToggleGroup.Item key={t} value={t} style={{ fontSize: 12, padding: '4px 10px', border: 'none', borderRadius: 20, background: filter === t ? 'rgba(var(--fg-rgb),0.1)' : 'transparent', color: filter === t ? 'var(--fg)' : 'rgba(var(--fg-rgb),0.3)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase' }}>{t === 'all' ? 'all' : t === 'data' ? 'data' : t + 's'}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
        </div>
        <div style={{ flex: 1, minHeight: 420, position: 'relative' }}>
          {mode === 'graph' && (
            <div style={{ position: 'absolute', bottom: 12, left: 16, zIndex: 1, fontSize: 11, color: 'var(--text-faint)', fontFamily: tokens.font.body, fontWeight: 400, pointerEvents: 'none', letterSpacing: '0.2px' }}>
              click a node to explore it · scroll to zoom · drag to pan
            </div>
          )}
          {mode === 'graph' ? <GrowthViz nodes={nodes} selectedId={selectedId} onSelect={id => setSelectedId(id === selectedId ? null : id)} filter={filter} theme={theme} /> :
            <ScrollArea.Root style={{ height: 420, overflow: 'hidden' }}><ScrollArea.Viewport style={{ width: '100%', height: '100%', padding: 16 }}>
              {(filter === 'all' ? nodes : nodes.filter(n => n.type === filter)).map(node => (
                <Collapsible.Root key={node.id} open={node.id === selectedId} onOpenChange={() => setSelectedId(node.id === selectedId ? null : node.id)}>
                  <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(var(--fg-rgb),0.04)', padding: '10px 0', cursor: 'pointer', color: 'var(--fg)', fontFamily: tokens.font.body }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 400, flex: 1 }}>{node.label}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.mono }}>{node.items.filter(i => i.status === 'done').length}/{node.items.length}</span>
                    </div>
                  </button></Collapsible.Trigger>
                  <Collapsible.Content><div style={{ padding: '4px 0 16px 20px', fontSize: 12, color: 'var(--text-faint)', fontFamily: tokens.font.body }}>{node.detail}</div></Collapsible.Content>
                </Collapsible.Root>
              ))}
            </ScrollArea.Viewport><ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}><ScrollArea.Thumb style={{ background: 'rgba(var(--fg-rgb),0.15)', borderRadius: 20 }} /></ScrollArea.Scrollbar></ScrollArea.Root>}
        </div>
      </div>
      {selectedNode && <div style={{ background: 'var(--bg)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 400, color: 'var(--fg)' }}>{selectedNode.label}</span>
          <button onClick={() => setSelectedId(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 14, fontFamily: tokens.font.body }}>x</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', fontFamily: tokens.font.body, marginBottom: 14 }}>{selectedNode.type} · {selectedNode.health} · {selectedNode.detail}</div>
        <Separator.Root style={{ height: 1, background: 'rgba(var(--fg-rgb),0.06)', marginBottom: 14 }} />
        <NodeDetail node={selectedNode} nodes={nodes} suggestions={suggestions} projects={projects} onProjectsChange={onProjectsChange} />
      </div>}
    </div>
  );
}

function LoadingScreen() {
  const text = 'building your zo...';
  const [charIndex, setCharIndex] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setCharIndex(prev => prev + 1 > text.length + 6 ? 0 : prev + 1), 90);
    return () => clearInterval(interval);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', zIndex: 1000 }}>
      <img src="/pegasus.gif" alt="" style={{ width: 260, height: 'auto', opacity: 0.7, filter: 'grayscale(100%) brightness(1.2) var(--pegasus-invert, none)' }} />
      <div style={{ marginTop: 24, fontFamily: tokens.font.display, fontSize: 14, fontWeight: 400, color: 'var(--text-dim)', letterSpacing: '0.5px', minHeight: 20 }}>{text.slice(0, charIndex)}</div>
    </div>
  );
}

const MIN_LOAD_MS = 4000;

export default function Dashboard() {
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsData | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (window.localStorage.getItem('zo-dashboard-theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { window.localStorage.setItem('zo-dashboard-theme', theme); } catch {}
  }, [theme]);

  function toggleTheme() { setTheme(t => t === 'dark' ? 'light' : 'dark'); }

  const load = useCallback(async () => {
    try {
      const [ctx, sug, projs] = await Promise.all([fetchContext(), fetchSuggestions(), fetchProjects()]);
      setContext(ctx); setSuggestions(sug); setProjects(projs); setError(null);
    } catch (e) { setError(`Failed to load: ${e}`); }
  }, []);

  const loadProjects = useCallback(async () => {
    try { setProjects(await fetchProjects()); } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    const start = Date.now();
    load().then(() => setTimeout(() => setReady(true), Math.max(0, MIN_LOAD_MS - (Date.now() - start))));
    const interval = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  const nodes = useMemo(() => deriveNodes(context, suggestions?.suggestions), [context, suggestions]);

  async function handleReflect(focusText?: string) {
    setRefreshing(true); setPromptOpen(false);
    try { await refreshDashboard(focusText); await load(); } catch (e) { setError(`Refresh failed: ${e}`); }
    setRefreshing(false); setFocus('');
  }

  const sections = context?.sections;
  if (!ready) return <LoadingScreen />;

  return (
    <Tooltip.Provider delayDuration={300}>
      <style>{`
        :root {
          --fg-rgb: 255, 255, 255;
          --bg: #000000;
          --surface: #0a0a0a;
          --fg: #ffffff;
          /* semantic text tiers — tuned for white-on-black */
          --text-faint: rgba(var(--fg-rgb), 0.38);
          --text-dim:   rgba(var(--fg-rgb), 0.5);
          --text-subtle:rgba(var(--fg-rgb), 0.62);
          --text-muted: rgba(var(--fg-rgb), 0.75);
        }
        [data-theme="light"] {
          --fg-rgb: 0, 0, 0;
          --bg: #fafafa;
          --surface: #ffffff;
          --fg: #000000;
          --pegasus-invert: invert(1);
          /* lifted for readability against off-white */
          --text-faint: rgba(var(--fg-rgb), 0.55);
          --text-dim:   rgba(var(--fg-rgb), 0.68);
          --text-subtle:rgba(var(--fg-rgb), 0.78);
          --text-muted: rgba(var(--fg-rgb), 0.88);
        }
        html, body, #root { margin: 0; padding: 0; background: var(--bg); color: var(--fg); transition: background 0.2s ease, color 0.2s ease; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <div style={{ animation: 'fadeIn 0.8s ease-out', maxWidth: 1100, margin: '0 auto', padding: '20px 24px 80px', minHeight: '100vh' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0', marginBottom: tokens.space.xl }}>
          <div style={{ fontFamily: tokens.font.display, fontSize: 22, fontWeight: 400, letterSpacing: '-0.3px', color: 'var(--fg)' }}>sam's zo</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleTheme} aria-label="Toggle theme" style={{ fontFamily: tokens.font.body, fontSize: 14, width: 32, height: 32, border: '1px solid rgba(var(--fg-rgb),0.15)', borderRadius: 20, background: 'transparent', color: 'var(--fg)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
            {theme === 'dark' ? '☀' : '☽'}
          </button>
          <Popover.Root open={promptOpen} onOpenChange={setPromptOpen}>
            <Popover.Trigger asChild>
              <button disabled={refreshing} style={{ fontFamily: tokens.font.body, fontSize: 13, padding: '7px 20px', border: '1px solid rgba(var(--fg-rgb),0.15)', borderRadius: 20, background: 'transparent', color: refreshing ? 'rgba(var(--fg-rgb),0.3)' : 'var(--fg)', cursor: refreshing ? 'wait' : 'pointer', fontWeight: 400, letterSpacing: '0.5px', transition: 'all 0.2s' }}>{refreshing ? 'reflecting...' : 'reflect'}</button>
            </Popover.Trigger>
            <Popover.Portal><Popover.Content side="bottom" align="end" sideOffset={8} style={{ background: 'var(--surface)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 14, padding: 16, width: 340, zIndex: 50, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }} onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}>
              <div style={{ fontSize: 13, color: 'var(--text-dim)', fontFamily: tokens.font.body, marginBottom: 10 }}>What do you want to understand?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={inputRef} value={focus} onChange={e => setFocus(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleReflect(focus || undefined); }} placeholder="what should I ship next..." style={{ flex: 1, fontFamily: tokens.font.body, fontSize: 14, padding: '8px 12px', background: 'var(--bg)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 8, color: 'var(--fg)', outline: 'none' }} />
                <button onClick={() => handleReflect(focus || undefined)} style={{ fontFamily: tokens.font.body, fontSize: 13, padding: '8px 16px', background: 'var(--fg)', border: 'none', borderRadius: 8, color: 'var(--bg)', cursor: 'pointer', fontWeight: 500 }}>go</button>
              </div>
              <button onClick={() => handleReflect()} style={{ width: '100%', fontFamily: tokens.font.body, fontSize: 12, padding: '8px', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', marginTop: 6 }}>or just reflect</button>
              <Popover.Arrow style={{ fill: 'var(--surface)' }} />
            </Popover.Content></Popover.Portal>
          </Popover.Root>
          </div>
        </header>

        {error && <div style={{ padding: '10px 14px', border: '1px solid rgba(var(--fg-rgb),0.15)', borderRadius: 10, fontSize: 14, fontFamily: tokens.font.body, color: 'rgba(var(--fg-rgb),0.6)', marginBottom: tokens.space.lg }}>{error}</div>}

        <Summary context={context} nodes={nodes} suggestions={suggestions} />
        <div style={{ height: tokens.space.xl }} />
        <ProjectsPanel projects={projects} nodes={nodes} onChange={loadProjects} />
        <div style={{ height: tokens.space.xl }} />
        <ZoView nodes={nodes} suggestions={suggestions?.suggestions} projects={projects} onProjectsChange={loadProjects} theme={theme} />
        <div style={{ height: tokens.space.xl }} />
        <AskBar />
        <div style={{ height: tokens.space.xl }} />
        <SuggestionList suggestions={(() => {
          const alerts: Suggestion[] = [];
          const jobs = sections?.jobs?.summary;
          if (jobs?.failed) alerts.push({ category: 'act', priority: 'high', title: `${jobs.failed} failed job${jobs.failed > 1 ? 's' : ''} — investigate`, description: `There ${jobs.failed === 1 ? 'is' : 'are'} ${jobs.failed} failed job${jobs.failed > 1 ? 's' : ''} in the queue. Review the errors and retry or clear them.`, action: 'Check job queue for failures' });
          if (jobs?.pending) alerts.push({ category: 'act', priority: 'medium', title: `${jobs.pending} pending job${jobs.pending > 1 ? 's' : ''} waiting`, description: `${jobs.pending} job${jobs.pending > 1 ? 's are' : ' is'} queued and waiting to be processed.` });
          return [...alerts, ...(suggestions?.suggestions || [])];
        })()} />
        <div style={{ height: tokens.space.xl }} />
        <ActivityPanel commits={sections?.activity?.git_commits || []} automations={sections?.automations?.discovered || []} jobs={sections?.jobs?.summary || { total: 0, pending: 0, completed: 0, failed: 0 }} />
      </div>
    </Tooltip.Provider>
  );
}
