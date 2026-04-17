/**
 * Minimal force-directed graph simulation.
 * No dependencies — just physics.
 *
 * Nodes repel each other, edges attract connected nodes,
 * and a centering force pulls everything toward the origin.
 */

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned?: boolean;
}

export interface ForceEdge {
  source: string;
  target: string;
}

interface SimConfig {
  repulsion: number;
  attraction: number;
  centering: number;
  damping: number;
  maxSpeed: number;
}

const DEFAULTS: SimConfig = {
  repulsion: 300,
  attraction: 0.06,
  centering: 0.008,
  damping: 0.82,
  maxSpeed: 2,
};

export function initPositions(count: number, spread = 120): Array<{ x: number; y: number }> {
  // Tight radial initial layout — nodes drift outward naturally via repulsion
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const r = spread * (0.4 + Math.random() * 0.4);
    return {
      x: Math.cos(angle) * r + (Math.random() - 0.5) * 10,
      y: Math.sin(angle) * r + (Math.random() - 0.5) * 10,
    };
  });
}

export function tick(
  nodes: ForceNode[],
  edges: ForceEdge[],
  config: Partial<SimConfig> = {},
): void {
  const cfg = { ...DEFAULTS, ...config };
  const n = nodes.length;
  if (n === 0) return;

  // Build adjacency lookup
  const nodeMap = new Map<string, ForceNode>();
  for (const node of nodes) nodeMap.set(node.id, node);

  // Repulsion: every node pushes every other node away
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;

      const force = cfg.repulsion / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  // Attraction: connected nodes pull toward a target distance
  const restLength = 40;
  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) continue;

    // Spring force: pulls together if beyond rest length
    const displacement = dist - restLength;
    const force = displacement * cfg.attraction;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }

  // Centering force
  for (const node of nodes) {
    if (node.pinned) continue;
    node.vx -= node.x * cfg.centering;
    node.vy -= node.y * cfg.centering;
  }

  // Apply velocity
  for (const node of nodes) {
    if (node.pinned) continue;

    node.vx *= cfg.damping;
    node.vy *= cfg.damping;

    // Clamp speed
    const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
    if (speed > cfg.maxSpeed) {
      node.vx = (node.vx / speed) * cfg.maxSpeed;
      node.vy = (node.vy / speed) * cfg.maxSpeed;
    }

    node.x += node.vx;
    node.y += node.vy;
  }
}

/**
 * Check if simulation has settled (total kinetic energy below threshold).
 */
export function isSettled(nodes: ForceNode[], threshold = 0.1): boolean {
  let energy = 0;
  for (const n of nodes) {
    energy += n.vx * n.vx + n.vy * n.vy;
  }
  return energy / nodes.length < threshold;
}
