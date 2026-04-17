import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import type { ZoNode } from '../lib/nodes';
import { tick, initPositions, isSettled } from '../lib/force';
import type { ForceNode, ForceEdge } from '../lib/force';

interface Props {
  nodes: ZoNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: string;
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

// Map ZoNodes to force simulation nodes + edges
function buildGraph(nodes: ZoNode[], filter: string) {
  const filtered = filter === 'all'
    ? nodes
    : nodes.filter(n => n.type === filter);

  const ids = new Set(filtered.map(n => n.id));
  const positions = initPositions(filtered.length, 180);

  const forceNodes: ForceNode[] = filtered.map((n, i) => ({
    id: n.id,
    x: positions[i].x,
    y: positions[i].y,
    vx: 0,
    vy: 0,
    radius: 1.5 + n.relevance * 1.5 + n.maturity * 1,
  }));

  const forceEdges: ForceEdge[] = [];
  for (const n of filtered) {
    for (const cid of n.connections) {
      if (ids.has(cid) && n.id < cid) {
        forceEdges.push({ source: n.id, target: cid });
      }
    }
  }

  return { forceNodes, forceEdges, filtered };
}

export function GrowthViz({ nodes, selectedId, onSelect, filter }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number>(0);
  const simRef = useRef<{ nodes: ForceNode[]; edges: ForceEdge[] }>({ nodes: [], edges: [] });
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{ dragging: boolean; lastX: number; lastY: number }>({
    dragging: false, lastX: 0, lastY: 0,
  });
  const [hovered, setHovered] = useState<string | null>(null);
  const zoNodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const autoFitDone = useRef(false);
  const targetCam = useRef<Camera | null>(null);

  // Rebuild simulation when nodes or filter change
  useEffect(() => {
    const { forceNodes, forceEdges } = buildGraph(nodes, filter);
    simRef.current = { nodes: forceNodes, edges: forceEdges };
    // Reset camera and allow auto-fit
    cameraRef.current = { x: 0, y: 0, zoom: 0.6 };
    autoFitDone.current = false;
    targetCam.current = null;
  }, [nodes, filter]);

  // Screen coords <-> world coords
  const screenToWorld = useCallback((sx: number, sy: number, canvas: HTMLCanvasElement) => {
    const cam = cameraRef.current;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return {
      x: (sx - cx) / cam.zoom - cam.x,
      y: (sy - cy) / cam.zoom - cam.y,
    };
  }, []);

  const findNodeAt = useCallback((wx: number, wy: number): ForceNode | null => {
    const sim = simRef.current;
    let closest: ForceNode | null = null;
    let closestDist = Infinity;
    for (const n of sim.nodes) {
      const dx = n.x - wx;
      const dy = n.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitRadius = Math.max(n.radius * 2, 8);
      if (dist < hitRadius && dist < closestDist) {
        closest = n;
        closestDist = dist;
      }
    }
    return closest;
  }, []);

  // Render loop
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
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const w = rect.width;
      const h = rect.height;
      const cam = cameraRef.current;
      const sim = simRef.current;

      // Run physics
      if (!settled) {
        tick(sim.nodes, sim.edges);
        settled = isSettled(sim.nodes, 0.05);

        // Compute auto-fit target once simulation settles
        if (settled && !autoFitDone.current && sim.nodes.length > 0) {
          autoFitDone.current = true;
          let minX = Infinity, maxX = -Infinity;
          let minY = Infinity, maxY = -Infinity;
          for (const n of sim.nodes) {
            minX = Math.min(minX, n.x - n.radius);
            maxX = Math.max(maxX, n.x + n.radius);
            minY = Math.min(minY, n.y - n.radius);
            maxY = Math.max(maxY, n.y + n.radius);
          }
          const graphW = maxX - minX;
          const graphH = maxY - minY;
          const padding = 60;
          const scaleX = (w - padding * 2) / (graphW || 1);
          const scaleY = (h - padding * 2) / (graphH || 1);
          const fitZoom = Math.min(scaleX, scaleY, 3);
          const cx = (minX + maxX) / 2;
          const cy = (minY + maxY) / 2;
          targetCam.current = { x: -cx, y: -cy, zoom: fitZoom };
        }
      }

      // Smoothly animate camera toward target
      if (targetCam.current) {
        const t = targetCam.current;
        const ease = 0.06;
        cam.x += (t.x - cam.x) * ease;
        cam.y += (t.y - cam.y) * ease;
        cam.zoom += (t.zoom - cam.zoom) * ease;
        // Stop animating once close enough
        if (Math.abs(t.x - cam.x) < 0.1 && Math.abs(t.y - cam.y) < 0.1 && Math.abs(t.zoom - cam.zoom) < 0.001) {
          cam.x = t.x; cam.y = t.y; cam.zoom = t.zoom;
          targetCam.current = null;
        }
      }

      // Clear
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      // Transform
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.translate(cam.x, cam.y);

      // Draw edges — build lookup once for performance
      const nodeById = new Map(sim.nodes.map(n => [n.id, n]));

      for (const edge of sim.edges) {
        const a = nodeById.get(edge.source);
        const b = nodeById.get(edge.target);
        if (!a || !b) continue;

        const isHighlighted = selectedId === a.id || selectedId === b.id ||
                              hovered === a.id || hovered === b.id;

        // Scale opacity with zoom — more visible as you zoom in
        const baseOpacity = Math.min(0.06 + cam.zoom * 0.04, 0.2);
        const highlightOpacity = Math.min(0.2 + cam.zoom * 0.1, 0.6);

        ctx.strokeStyle = isHighlighted
          ? `rgba(255, 255, 255, ${highlightOpacity})`
          : `rgba(255, 255, 255, ${baseOpacity})`;
        ctx.lineWidth = isHighlighted ? 0.6 / cam.zoom : 0.3 / cam.zoom;

        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const node of sim.nodes) {
        const isSelected = node.id === selectedId;
        const isHovered = node.id === hovered;
        const zoNode = zoNodeMap.get(node.id);
        const needsAttention = zoNode?.health === 'needs-attention';

        let r = node.radius;
        if (isSelected || isHovered) r *= 1.3;

        // Outer glow for active nodes
        if (zoNode?.active) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
          ctx.fill();
        }

        // Node dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSelected
          ? '#ffffff'
          : isHovered
          ? 'rgba(255, 255, 255, 0.9)'
          : needsAttention
          ? 'rgba(255, 255, 255, 0.6)'
          : 'rgba(255, 255, 255, 0.7)';
        ctx.fill();

        // Selection ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 0.5 / cam.zoom;
          ctx.stroke();
        }

        // Label (only when zoomed in enough or hovered/selected)
        if (cam.zoom > 0.8 || isHovered || isSelected) {
          const label = zoNode?.label || node.id;
          ctx.font = `${10 / cam.zoom}px "Diatype", "Inter", sans-serif`;
          ctx.fillStyle = isSelected || isHovered
            ? 'rgba(255, 255, 255, 0.9)'
            : 'rgba(255, 255, 255, 0.35)';
          ctx.textAlign = 'center';
          ctx.fillText(label, node.x, node.y + r + 12 / cam.zoom);
        }
      }

      ctx.restore();

      frameRef.current = requestAnimationFrame(render);
    }

    frameRef.current = requestAnimationFrame(render);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [nodes, filter, selectedId, hovered, zoNodeMap]);

  // Mouse handlers
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const cam = cameraRef.current;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    cam.zoom = Math.max(0.2, Math.min(5, cam.zoom * factor));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragRef.current.dragging) {
      const cam = cameraRef.current;
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      cam.x += dx / cam.zoom;
      cam.y += dy / cam.zoom;
      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;
    } else {
      // Hit test for hover
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = screenToWorld(sx, sy, canvas);
      const hit = findNodeAt(wx, wy);
      setHovered(hit?.id || null);
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  }, [screenToWorld, findNodeAt]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    const wasDragging = dragRef.current.dragging;
    const moved = Math.abs(e.clientX - dragRef.current.lastX) > 3 ||
                  Math.abs(e.clientY - dragRef.current.lastY) > 3;
    dragRef.current.dragging = false;

    // Click (not drag)
    if (wasDragging && !moved) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { x: wx, y: wy } = screenToWorld(sx, sy, canvas);
      const hit = findNodeAt(wx, wy);
      if (hit) onSelect(hit.id);
    }
  }, [screenToWorld, findNodeAt, onSelect]);

  // Also handle click directly for non-drag clicks
  const handleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy, canvas);
    const hit = findNodeAt(wx, wy);
    if (hit) {
      onSelect(hit.id === selectedId ? '' : hit.id);
    }
  }, [screenToWorld, findNodeAt, onSelect, selectedId]);

  return (
    <canvas
      ref={canvasRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 420,
        borderRadius: 12,
        cursor: 'grab',
        display: 'block',
      }}
    />
  );
}
