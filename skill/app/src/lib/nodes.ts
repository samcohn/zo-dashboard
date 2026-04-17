/**
 * Shared node model + derivation logic.
 *
 * Nodes are the atomic units of the dashboard. Every system, skill,
 * data source, and automation becomes a node. The dashboard's job is
 * to score, rank, and surface these nodes based on what matters RIGHT NOW.
 *
 * The graph between nodes (recency, connections, suggestions) is what
 * makes the dashboard reinvent itself each time it loads.
 */

import type { ContextSnapshot, Suggestion } from './api';

export interface NodeItem {
  label: string;
  status: 'done' | 'todo' | 'explore';
}

export interface ZoNode {
  id: string;
  label: string;
  type: 'skill' | 'automation' | 'data' | 'core';
  health: 'active' | 'stale' | 'needs-attention';
  maturity: number;    // 0-1, how built-out this system is
  relevance: number;   // 0-1, how important this is RIGHT NOW
  active: boolean;     // recently touched
  detail: string;
  items: NodeItem[];
  connections: string[]; // ids of connected nodes
  lastTouched: number;   // ms since epoch
}

/**
 * Score how relevant a node is right now.
 *
 * Factors:
 * - recency: recently modified = more relevant
 * - suggestions: if the suggestion engine flagged it = more relevant
 * - health: broken/needs-attention = urgent = more relevant
 * - connections: nodes connected to other high-relevance nodes get a boost
 */
function scoreRelevance(
  node: Omit<ZoNode, 'relevance'>,
  suggestionHits: number,
  connectedRelevance: number,
): number {
  let score = 0;

  // Recency: exponential decay, peaks at 1.0 for today, ~0.3 at 7 days
  const daysSince = (Date.now() - node.lastTouched) / (1000 * 60 * 60 * 24);
  score += Math.exp(-daysSince / 5) * 0.35;

  // Health urgency
  if (node.health === 'needs-attention') score += 0.25;
  else if (node.health === 'stale') score += 0.1;

  // Suggestion density: more suggestions = more actionable
  score += Math.min(suggestionHits * 0.1, 0.2);

  // Active signals
  if (node.active) score += 0.1;

  // Connected relevance (graph propagation)
  score += connectedRelevance * 0.1;

  return Math.min(1, score);
}

export function deriveNodes(
  ctx: ContextSnapshot | null,
  suggestions: Suggestion[] = [],
): ZoNode[] {
  if (!ctx) return [];
  const nodes: ZoNode[] = [];
  const now = Date.now();
  const { sections } = ctx;

  // Track which files changed recently for cross-referencing
  const recentPaths = new Set(
    (sections.activity?.recently_modified || []).map((f: any) => f.path?.split('/')[0]),
  );

  // Track commit message tokens for connection inference
  const commitTokens = (sections.activity?.git_commits || [])
    .flatMap((c: any) => (c.message || '').toLowerCase().split(/\W+/));

  // --- Build raw nodes ---

  // Skills
  for (const skill of sections.skills || []) {
    const modified = new Date(skill.last_modified).getTime();
    const days = (now - modified) / (1000 * 60 * 60 * 24);
    const maturity = Math.min(1,
      (skill.script_count || 0) / 5 * 0.5 +
      (skill.has_scripts ? 0.3 : 0) +
      (skill.has_references ? 0.2 : 0),
    );

    const items: NodeItem[] = [];
    for (const s of skill.scripts || []) {
      items.push({ label: s, status: 'done' });
    }
    if (!skill.has_scripts) {
      items.push({ label: 'Add automation scripts', status: 'todo' });
    }

    nodes.push({
      id: `skill-${skill.name}`,
      label: skill.name,
      type: 'skill',
      health: days > 60 ? 'stale' : days > 30 ? 'needs-attention' : 'active',
      maturity,
      relevance: 0, // scored below
      active: days < 7 || recentPaths.has(skill.name),
      detail: `${skill.script_count || 0} scripts · ${Math.round(days)}d ago`,
      items,
      connections: [],
      lastTouched: modified,
    });
  }

  // Automations
  for (const auto of sections.automations?.discovered || []) {
    const parentSkill = nodes.find(n => n.label === auto.skill);
    nodes.push({
      id: `auto-${auto.skill}-${auto.type}`,
      label: `${auto.skill}`,
      type: 'automation',
      health: 'active',
      maturity: 0.6,
      relevance: 0,
      active: true,
      detail: auto.type,
      items: [
        { label: `${auto.type} automation active`, status: 'done' },
        { label: 'Review schedule & output', status: 'explore' },
      ],
      connections: parentSkill ? [parentSkill.id] : [],
      lastTouched: parentSkill?.lastTouched || now,
    });
  }

  // Data areas
  for (const dir of (sections.workspace?.top_level_dirs || []).filter((d: any) => d.file_count > 3)) {
    if (dir.name === 'Skills' || dir.name === 'node_modules') continue;

    const recentlyActive = recentPaths.has(dir.name);
    const mentionedInCommits = commitTokens.includes(dir.name.toLowerCase());

    nodes.push({
      id: `data-${dir.name}`,
      label: dir.name,
      type: 'data',
      health: 'active',
      maturity: Math.min(1, dir.file_count / 20),
      relevance: 0,
      active: recentlyActive,
      detail: `${dir.file_count} files · ${dir.size_mb}MB`,
      items: [
        { label: `${dir.file_count} files stored`, status: 'done' },
        ...(recentlyActive ? [{ label: 'Recently modified — review changes', status: 'explore' as const }] : []),
        ...(mentionedInCommits ? [{ label: 'Referenced in recent commits', status: 'explore' as const }] : []),
        { label: 'Explore connections to skills', status: 'explore' },
      ],
      connections: [],
      lastTouched: recentlyActive ? now : now - 7 * 24 * 60 * 60 * 1000,
    });
  }

  // Core: Memory
  if (sections.memory?.available) {
    nodes.push({
      id: 'core-memory',
      label: 'Memory',
      type: 'core',
      health: 'active',
      maturity: 0.9,
      relevance: 0,
      active: true,
      detail: 'Supermemory active',
      items: [
        { label: 'Knowledge graph connected', status: 'done' },
        { label: 'Profile auto-generated', status: 'done' },
        { label: 'Run memory hygiene check', status: 'explore' },
      ],
      connections: nodes.filter(n => n.type === 'skill').map(n => n.id),
      lastTouched: now,
    });
  }

  // Core: Jobs
  const jobs = sections.jobs?.summary;
  if (jobs && jobs.total > 0) {
    const jobItems: NodeItem[] = [];
    if (jobs.completed) jobItems.push({ label: `${jobs.completed} jobs completed`, status: 'done' });
    if (jobs.failed) jobItems.push({ label: `${jobs.failed} failed — investigate`, status: 'todo' });
    if (jobs.pending) jobItems.push({ label: `${jobs.pending} pending — run worker`, status: 'todo' });

    nodes.push({
      id: 'core-jobs',
      label: 'Jobs',
      type: 'core',
      health: jobs.failed > 0 ? 'needs-attention' : 'active',
      maturity: 0.7,
      relevance: 0,
      active: jobs.pending > 0 || jobs.failed > 0,
      detail: `${jobs.completed} done · ${jobs.failed} failed`,
      items: jobItems,
      connections: [],
      lastTouched: now,
    });
  }

  // --- Infer connections (build the web) ---

  // Helper: add bidirectional connection if not already present
  function connect(a: ZoNode, b: ZoNode) {
    if (a.id === b.id) return;
    if (!a.connections.includes(b.id)) a.connections.push(b.id);
    if (!b.connections.includes(a.id)) b.connections.push(a.id);
  }

  // 1. Name similarity: tokenize labels and connect nodes sharing tokens
  const stopWords = new Set(['zo', 'the', 'and', 'for', 'with', 'from', 'app']);
  function tokenize(s: string): string[] {
    return s.toLowerCase().split(/[-_\s\/]+/).filter(t => t.length > 2 && !stopWords.has(t));
  }

  for (let i = 0; i < nodes.length; i++) {
    const tokensA = tokenize(nodes[i].label);
    for (let j = i + 1; j < nodes.length; j++) {
      const tokensB = tokenize(nodes[j].label);
      if (tokensA.some(t => tokensB.includes(t))) {
        connect(nodes[i], nodes[j]);
      }
    }
  }

  // 2. Commit co-mention: nodes whose labels appear in the same commit messages
  const commits = sections.activity?.git_commits || [];
  for (const commit of commits) {
    const msg = (commit.message || '').toLowerCase();
    const mentioned = nodes.filter(n =>
      tokenize(n.label).some(t => msg.includes(t))
    );
    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        connect(mentioned[i], mentioned[j]);
      }
    }
  }

  // 3. Suggestion co-reference: nodes mentioned by the same suggestion
  for (const sug of suggestions) {
    const text = `${sug.title} ${sug.description}`.toLowerCase();
    const mentioned = nodes.filter(n =>
      tokenize(n.label).some(t => text.includes(t))
    );
    for (let i = 0; i < mentioned.length; i++) {
      for (let j = i + 1; j < mentioned.length; j++) {
        connect(mentioned[i], mentioned[j]);
      }
    }
  }

  // 4. Temporal proximity: nodes touched within 2 days of each other
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (Math.abs(nodes[i].lastTouched - nodes[j].lastTouched) < TWO_DAYS &&
          nodes[i].active && nodes[j].active) {
        connect(nodes[i], nodes[j]);
      }
    }
  }

  // 5. Type affinity: automation nodes connect to their parent skill
  for (const node of nodes) {
    if (node.type !== 'automation') continue;
    for (const other of nodes) {
      if (other.type === 'skill' && node.label === other.label) {
        connect(node, other);
      }
    }
  }

  // 6. Jobs connect to skills with job-related items
  const jobNode = nodes.find(n => n.id === 'core-jobs');
  if (jobNode) {
    for (const node of nodes) {
      if (node.type === 'skill' && node.items.some(i =>
        i.label.includes('worker') || i.label.includes('job')
      )) {
        connect(jobNode, node);
      }
    }
  }

  // --- Inject suggestion items ---

  for (const sug of suggestions) {
    for (const node of nodes) {
      const nameMatch =
        sug.title.toLowerCase().includes(node.label.toLowerCase()) ||
        sug.description.toLowerCase().includes(node.label.toLowerCase());
      if (!nameMatch) continue;

      node.items.push({
        label: sug.title,
        status: sug.category === 'act' || sug.category === 'maintain' ? 'todo' : 'explore',
      });
    }
  }

  // --- Score relevance ---

  // First pass: base scores
  const suggestionCounts = new Map<string, number>();
  for (const sug of suggestions) {
    for (const node of nodes) {
      if (sug.title.toLowerCase().includes(node.label.toLowerCase())) {
        suggestionCounts.set(node.id, (suggestionCounts.get(node.id) || 0) + 1);
      }
    }
  }

  for (const node of nodes) {
    (node as any)._baseRelevance = scoreRelevance(
      node,
      suggestionCounts.get(node.id) || 0,
      0,
    );
  }

  // Second pass: propagate through connections
  for (const node of nodes) {
    const connectedAvg = node.connections.length
      ? node.connections.reduce((sum, cid) => {
          const cn = nodes.find(n => n.id === cid);
          return sum + ((cn as any)?._baseRelevance || 0);
        }, 0) / node.connections.length
      : 0;

    node.relevance = scoreRelevance(
      node,
      suggestionCounts.get(node.id) || 0,
      connectedAvg,
    );
  }

  // Clean up temp field
  for (const node of nodes) delete (node as any)._baseRelevance;

  // Sort by relevance (most relevant first)
  nodes.sort((a, b) => b.relevance - a.relevance);

  return nodes;
}
