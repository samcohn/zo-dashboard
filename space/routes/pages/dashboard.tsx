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
  color: { bg: '#000000', surface: '#0a0a0a', border: 'rgba(255,255,255,0.08)' },
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

async function fetchContext(): Promise<ContextSnapshot> { return (await fetch('/api/zo-context')).json(); }
async function fetchSuggestions(): Promise<SuggestionsData> { return (await fetch('/api/zo-suggestions')).json(); }
async function refreshDashboard(focus?: string) { return (await fetch('/api/zo-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai: true, focus: focus || undefined }) })).json(); }
async function askZo(question: string): Promise<string> { const d = await (await fetch('/api/zo-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) })).json(); return d.answer || 'No response'; }

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

function GrowthViz({ nodes, selectedId, onSelect, filter }: { nodes: ZoNode[]; selectedId: string | null; onSelect: (id: string) => void; filter: string }) {
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

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(cam.zoom, cam.zoom); ctx.translate(cam.x, cam.y);

      const nodeById = new Map(sim.nodes.map(n => [n.id, n]));
      for (const edge of sim.edges) {
        const a = nodeById.get(edge.source), b = nodeById.get(edge.target);
        if (!a || !b) continue;
        const hl = selectedId === a.id || selectedId === b.id || hovered === a.id || hovered === b.id;
        ctx.strokeStyle = hl ? `rgba(255,255,255,${Math.min(0.2 + cam.zoom * 0.1, 0.6)})` : `rgba(255,255,255,${Math.min(0.06 + cam.zoom * 0.04, 0.2)})`;
        ctx.lineWidth = hl ? 0.6 / cam.zoom : 0.3 / cam.zoom;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }

      for (const node of sim.nodes) {
        const isSel = node.id === selectedId, isHov = node.id === hovered;
        const zoNode = zoNodeMap.get(node.id);
        let r = node.radius; if (isSel || isHov) r *= 1.3;
        if (zoNode?.active) { ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill(); }
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? '#fff' : isHov ? 'rgba(255,255,255,0.9)' : zoNode?.health === 'needs-attention' ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.7)';
        ctx.fill();
        if (isSel) { ctx.beginPath(); ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.5 / cam.zoom; ctx.stroke(); }
        if (cam.zoom > 0.8 || isHov || isSel) {
          ctx.font = `${10 / cam.zoom}px "Diatype","Inter",sans-serif`;
          ctx.fillStyle = isSel || isHov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)';
          ctx.textAlign = 'center'; ctx.fillText(zoNode?.label || node.id, node.x, node.y + r + 12 / cam.zoom);
        }
      }
      ctx.restore();
      frameRef.current = requestAnimationFrame(render);
    }
    frameRef.current = requestAnimationFrame(render);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [nodes, filter, selectedId, hovered, zoNodeMap]);

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

  if (!context) return <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, fontFamily: tokens.font.body }}>Loading...</div>;

  const totalDone = nodes.reduce((n, nd) => n + nd.items.filter(i => i.status === 'done').length, 0);
  const totalAll = nodes.reduce((n, nd) => n + nd.items.length, 0);
  const overallPct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0;

  return (
    <div>
      <div style={{ marginBottom: 20, minHeight: 40 }}>
        {loadingBriefing ? (
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>reading your zo...</div>
        ) : briefing ? (
          <div style={{ fontSize: 14, lineHeight: 1.8, color: 'rgba(255,255,255,0.55)', fontFamily: tokens.font.body, fontWeight: 300 }}>{briefing}</div>
        ) : null}
      </div>
      <Progress.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden', marginBottom: 16 }}>
        <Progress.Indicator style={{ height: '100%', width: `${overallPct}%`, background: 'rgba(255,255,255,0.3)', transition: 'width 0.5s ease' }} />
      </Progress.Root>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', fontFamily: tokens.font.body, fontWeight: 300 }}>
        click a node to explore it · scroll to zoom · drag to pan
      </div>
    </div>
  );
}

function NodeDetail({ node, nodes, suggestions }: { node: ZoNode; nodes: ZoNode[]; suggestions: Suggestion[] }) {
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
          {loading ? <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>thinking...</div>
            : summary ? <div style={{ fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,0.5)', fontFamily: tokens.font.body, fontWeight: 300 }}>{summary}</div> : null}
        </div>
        {connectedNodes.length > 0 && <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.25)', fontFamily: tokens.font.body, marginBottom: 8 }}>connected</div>
          {connectedNodes.map(cn => <div key={cn.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: tokens.font.body, fontWeight: 300 }}>{cn.label}</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body, marginLeft: 'auto' }}>{cn.type}</span>
          </div>)}
        </div>}
        <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 16 }} />
        {relatedSuggestions.length > 0 ? <div>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.25)', fontFamily: tokens.font.body, marginBottom: 8 }}>suggestions</div>
          {relatedSuggestions.map((s, i) => <Collapsible.Root key={i}>
            <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', cursor: 'pointer', color: '#fff', fontFamily: tokens.font.body }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: s.priority === 'high' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{s.category}</span>
                <span style={{ fontSize: 12, fontWeight: 300, flex: 1 }}>{s.title}</span>
              </div>
            </button></Collapsible.Trigger>
            <Collapsible.Content><div style={{ padding: '4px 0 12px 0', fontSize: 11, lineHeight: 1.7, fontFamily: tokens.font.body, color: 'rgba(255,255,255,0.35)' }}>{s.description}</div></Collapsible.Content>
          </Collapsible.Root>)}
        </div> : <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.15)', fontFamily: tokens.font.body, fontStyle: 'italic' }}>no suggestions for this node</div>}
        {node.items.length > 0 && <>
          <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '16px 0' }} />
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.25)', fontFamily: tokens.font.body, marginBottom: 8 }}>items</div>
          {node.items.map((item, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, fontFamily: tokens.font.body }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>{item.status === 'done' ? '✓' : item.status === 'todo' ? '○' : '?'}</span>
            <span style={{ color: item.status === 'done' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)', textDecoration: item.status === 'done' ? 'line-through' : 'none', fontWeight: 300 }}>{item.label}</span>
          </div>)}
        </>}
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}><ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20 }} /></ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}

function ActivityPanel({ commits, automations, jobs }: { commits: Commit[]; automations: Automation[]; jobs: JobSummary }) {
  function ago(d: string) { const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000); if (diff < 60) return `${diff}s`; if (diff < 3600) return `${Math.floor(diff / 60)}m`; if (diff < 86400) return `${Math.floor(diff / 3600)}h`; return `${Math.floor(diff / 86400)}d`; }
  return (
    <Tabs.Root defaultValue="commits">
      <Tabs.List style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
        {['commits', 'automations', 'jobs'].map(tab => <Tabs.Trigger key={tab} value={tab} style={{ fontSize: 12, padding: '8px 16px', border: 'none', borderBottom: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase', transition: 'all 0.15s' }}>{tab}</Tabs.Trigger>)}
      </Tabs.List>
      <Tabs.Content value="commits">
        {commits.length === 0 ? <div style={{ padding: 20, color: 'rgba(255,255,255,0.15)', fontSize: 13, fontFamily: tokens.font.body }}>no recent commits</div> :
          commits.slice(0, 12).map((c, i) => <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 12, display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: tokens.font.body }}>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 11, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>{c.hash}</span>
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 300 }}>{c.message}</span>
            <span style={{ fontFamily: tokens.font.mono, fontSize: 10, color: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>{ago(c.date)}</span>
          </div>)}
      </Tabs.Content>
      <Tabs.Content value="automations">
        {automations.length === 0 ? <div style={{ padding: 20, color: 'rgba(255,255,255,0.15)', fontSize: 13, fontFamily: tokens.font.body }}>no automations</div> :
          automations.map((a, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: tokens.font.body, fontWeight: 300 }}>{a.skill}</span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body }}>{a.type}</span>
          </div>)}
      </Tabs.Content>
      <Tabs.Content value="jobs">
        {[{ label: 'total', value: jobs.total }, { label: 'completed', value: jobs.completed }, { label: 'pending', value: jobs.pending }, { label: 'failed', value: jobs.failed }].map(row =>
          <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.03)', fontFamily: tokens.font.body }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', fontWeight: 300 }}>{row.label}</span>
            <span style={{ fontSize: 13, color: row.value > 0 && row.label === 'failed' ? '#fff' : 'rgba(255,255,255,0.5)', fontFamily: tokens.font.mono }}>{row.value}</span>
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
    <div onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', cursor: 'text' }}>
      <span style={{ fontFamily: tokens.font.display, fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>zo</span>
      <span style={{ fontFamily: tokens.font.body, fontSize: 13, color: 'rgba(255,255,255,0.15)', fontWeight: 300 }}>ask about your dashboard...</span>
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.15)', fontFamily: tokens.font.mono, border: '1px solid rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: 4 }}>/</span>
    </div>
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', zIndex: 100 }} />
        <Dialog.Content style={{ position: 'fixed', top: '15%', left: '50%', transform: 'translateX(-50%)', width: '90%', maxWidth: 560, background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24, zIndex: 101, maxHeight: '70vh', overflow: 'auto' }}>
          <Dialog.Title style={{ fontFamily: tokens.font.display, fontSize: 18, fontWeight: 400, marginBottom: 16, color: '#fff' }}>zo</Dialog.Title>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input autoFocus value={question} onChange={e => setQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAsk()} placeholder="what should I focus on today?" style={{ flex: 1, fontFamily: tokens.font.body, fontSize: 14, padding: '10px 14px', background: '#000', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', outline: 'none', fontWeight: 300 }} />
            <button onClick={handleAsk} disabled={loading || !question.trim()} style={{ fontFamily: tokens.font.body, fontSize: 13, padding: '10px 18px', background: '#fff', border: 'none', borderRadius: 8, color: '#000', cursor: loading ? 'wait' : 'pointer', fontWeight: 500, opacity: loading ? 0.5 : 1 }}>{loading ? '...' : 'ask'}</button>
          </div>
          {answer && <div style={{ padding: 14, background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: tokens.font.body, fontWeight: 300, color: 'rgba(255,255,255,0.6)' }}>{answer}</div>}
          <Dialog.Close asChild><button style={{ position: 'absolute', top: 14, right: 14, background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', fontSize: 16, cursor: 'pointer' }}>x</button></Dialog.Close>
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
        <span style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 400, color: '#fff' }}>suggestions</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body }}>{suggestions.length}</span>
        <ToggleGroup.Root type="single" value={filter} onValueChange={v => v && setFilter(v)} style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
          {categories.map(cat => <ToggleGroup.Item key={cat} value={cat} style={{ fontSize: 11, padding: '3px 10px', border: 'none', borderRadius: 20, background: filter === cat ? 'rgba(255,255,255,0.08)' : 'transparent', color: filter === cat ? '#fff' : 'rgba(255,255,255,0.25)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase' }}>{cat}</ToggleGroup.Item>)}
        </ToggleGroup.Root>
      </div>
      {filtered.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.15)', fontSize: 13, fontFamily: tokens.font.body }}>nothing here</div> :
        filtered.map((s, i) => <Collapsible.Root key={i}>
          <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0', cursor: 'pointer', color: '#fff', fontFamily: tokens.font.body, transition: 'opacity 0.15s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(255,255,255,0.25)', width: 60, flexShrink: 0 }}>{s.category}</span>
              <span style={{ fontSize: 13, fontWeight: 300, flex: 1 }}>{s.title}</span>
              {s.source === 'ai' && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.1)', padding: '1px 6px', borderRadius: 10 }}>ai</span>}
            </div>
          </button></Collapsible.Trigger>
          <Collapsible.Content><div style={{ padding: '4px 0 16px 70px', fontSize: 12, lineHeight: 1.7, fontFamily: tokens.font.body }}>
            <div style={{ color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{s.description}</div>
            {s.action && <div style={{ fontFamily: tokens.font.mono, fontSize: 11, color: 'rgba(255,255,255,0.3)', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>{s.action}</div>}
          </div></Collapsible.Content>
        </Collapsible.Root>)}
    </div>
  );
}

function ZoView({ nodes, suggestions = [] }: { nodes: ZoNode[]; suggestions?: Suggestion[] }) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNode = nodes.find(n => n.id === selectedId) || null;
  const types = ['all', ...new Set(nodes.map(n => n.type))];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selectedNode ? '1fr 300px' : '1fr', gap: 20 }}>
      <div style={{ background: '#000', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
          <ToggleGroup.Root type="single" value={mode} onValueChange={v => v && setMode(v as any)} style={{ display: 'flex', gap: 2 }}>
            {['graph', 'list'].map(m => <ToggleGroup.Item key={m} value={m} style={{ fontSize: 11, padding: '4px 12px', border: '1px solid', borderColor: mode === m ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)', borderRadius: 20, background: mode === m ? 'rgba(255,255,255,0.06)' : 'transparent', color: mode === m ? '#fff' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase', letterSpacing: '0.5px' }}>{m}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
          <Separator.Root orientation="vertical" style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)' }} />
          <ToggleGroup.Root type="single" value={filter} onValueChange={v => v && setFilter(v)} style={{ display: 'flex', gap: 2 }}>
            {types.map(t => <ToggleGroup.Item key={t} value={t} style={{ fontSize: 11, padding: '4px 10px', border: 'none', borderRadius: 20, background: filter === t ? 'rgba(255,255,255,0.1)' : 'transparent', color: filter === t ? '#fff' : 'rgba(255,255,255,0.3)', cursor: 'pointer', fontFamily: tokens.font.body, textTransform: 'lowercase' }}>{t === 'all' ? 'all' : t === 'data' ? 'data' : t + 's'}</ToggleGroup.Item>)}
          </ToggleGroup.Root>
        </div>
        <div style={{ flex: 1, minHeight: 420 }}>
          {mode === 'graph' ? <GrowthViz nodes={nodes} selectedId={selectedId} onSelect={id => setSelectedId(id === selectedId ? null : id)} filter={filter} /> :
            <ScrollArea.Root style={{ height: 420, overflow: 'hidden' }}><ScrollArea.Viewport style={{ width: '100%', height: '100%', padding: 16 }}>
              {(filter === 'all' ? nodes : nodes.filter(n => n.type === filter)).map(node => (
                <Collapsible.Root key={node.id} open={node.id === selectedId} onOpenChange={() => setSelectedId(node.id === selectedId ? null : node.id)}>
                  <Collapsible.Trigger asChild><button style={{ width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '10px 0', cursor: 'pointer', color: '#fff', fontFamily: tokens.font.body }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 300, flex: 1 }}>{node.label}</span>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.mono }}>{node.items.filter(i => i.status === 'done').length}/{node.items.length}</span>
                    </div>
                  </button></Collapsible.Trigger>
                  <Collapsible.Content><div style={{ padding: '4px 0 16px 20px', fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: tokens.font.body }}>{node.detail}</div></Collapsible.Content>
                </Collapsible.Root>
              ))}
            </ScrollArea.Viewport><ScrollArea.Scrollbar orientation="vertical" style={{ width: 6, padding: 1 }}><ScrollArea.Thumb style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 20 }} /></ScrollArea.Scrollbar></ScrollArea.Root>}
        </div>
      </div>
      {selectedNode && <div style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontFamily: tokens.font.display, fontSize: 16, fontWeight: 400, color: '#fff' }}>{selectedNode.label}</span>
          <button onClick={() => setSelectedId(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 14, fontFamily: tokens.font.body }}>x</button>
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontFamily: tokens.font.body, marginBottom: 14 }}>{selectedNode.type} · {selectedNode.health} · {selectedNode.detail}</div>
        <Separator.Root style={{ height: 1, background: 'rgba(255,255,255,0.06)', marginBottom: 14 }} />
        <NodeDetail node={selectedNode} nodes={nodes} suggestions={suggestions} />
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
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#000', zIndex: 1000 }}>
      <img src="/pegasus.gif" alt="" style={{ width: 260, height: 'auto', opacity: 0.7, filter: 'grayscale(100%) brightness(1.2)' }} />
      <div style={{ marginTop: 24, fontFamily: tokens.font.display, fontSize: 13, fontWeight: 400, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.5px', minHeight: 20 }}>{text.slice(0, charIndex)}</div>
    </div>
  );
}

const MIN_LOAD_MS = 4000;

export default function Dashboard() {
  const [context, setContext] = useState<ContextSnapshot | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionsData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ctx, sug] = await Promise.all([fetchContext(), fetchSuggestions()]);
      setContext(ctx); setSuggestions(sug); setError(null);
    } catch (e) { setError(`Failed to load: ${e}`); }
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
        html, body, #root { margin: 0; padding: 0; background: #000; color: #fff; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
      <div style={{ animation: 'fadeIn 0.8s ease-out', maxWidth: 1100, margin: '0 auto', padding: '20px 24px 80px', minHeight: '100vh' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 0', marginBottom: tokens.space.xl }}>
          <div style={{ fontFamily: tokens.font.display, fontSize: 22, fontWeight: 400, letterSpacing: '-0.3px', color: '#fff' }}>sam's zo</div>
          <Popover.Root open={promptOpen} onOpenChange={setPromptOpen}>
            <Popover.Trigger asChild>
              <button disabled={refreshing} style={{ fontFamily: tokens.font.body, fontSize: 12, padding: '7px 20px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 20, background: 'transparent', color: refreshing ? 'rgba(255,255,255,0.3)' : '#fff', cursor: refreshing ? 'wait' : 'pointer', fontWeight: 400, letterSpacing: '0.5px', transition: 'all 0.2s' }}>{refreshing ? 'reflecting...' : 'reflect'}</button>
            </Popover.Trigger>
            <Popover.Portal><Popover.Content side="bottom" align="end" sideOffset={8} style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 16, width: 340, zIndex: 50, boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }} onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: tokens.font.body, marginBottom: 10 }}>What do you want to understand?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={inputRef} value={focus} onChange={e => setFocus(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleReflect(focus || undefined); }} placeholder="what should I ship next..." style={{ flex: 1, fontFamily: tokens.font.body, fontSize: 13, padding: '8px 12px', background: '#000', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', outline: 'none' }} />
                <button onClick={() => handleReflect(focus || undefined)} style={{ fontFamily: tokens.font.body, fontSize: 12, padding: '8px 16px', background: '#fff', border: 'none', borderRadius: 8, color: '#000', cursor: 'pointer', fontWeight: 500 }}>go</button>
              </div>
              <button onClick={() => handleReflect()} style={{ width: '100%', fontFamily: tokens.font.body, fontSize: 11, padding: '8px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', marginTop: 6 }}>or just reflect</button>
              <Popover.Arrow style={{ fill: '#0a0a0a' }} />
            </Popover.Content></Popover.Portal>
          </Popover.Root>
        </header>

        {error && <div style={{ padding: '10px 14px', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, fontSize: 13, fontFamily: tokens.font.body, color: 'rgba(255,255,255,0.6)', marginBottom: tokens.space.lg }}>{error}</div>}

        <Summary context={context} nodes={nodes} suggestions={suggestions} />
        <div style={{ height: tokens.space.xl }} />
        <ZoView nodes={nodes} suggestions={suggestions?.suggestions} />
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
