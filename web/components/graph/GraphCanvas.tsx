"use client";

// Sigma.js canvas for a graph neighbourhood. ForceAtlas2 runs when the data changes and stops once
// the layout settles; `data-layout` on the stage reads "running" or "settled". Nodes keep their
// positions across refetches, so changing a filter only moves what it adds.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type Sigma from "sigma";
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";

type GraphData = Schema<"Graph">;
type NodeType = Schema<"GraphNode">["type"];

type NodeAttrs = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  forceLabel: boolean;
  fixed: boolean;
  ringSize: number;
  gapSize: number;
};
type EdgeAttrs = { size: number; color: string };
type Renderer = Sigma<NodeAttrs, EdgeAttrs>;

/** Node fill per type: ui-ux.md topic, group and entity colors, provider teal for developments. */
export const NODE_COLOR: Record<NodeType, string> = {
  topic: "#6B4FD8",
  group: "#0A64D8",
  entity: "#3A3A40",
  development: "#0E7C7B",
};
const NEW_RING = "#0A56BC";
const DIMMED = "#E4E4EA";
const SIZE: Record<NodeType, number> = { topic: 12, group: 11, entity: 9, development: 5 };
const EDGE_COLOR = { MEMBER_OF: "#C4C4CC", EXPOSED_TO: "#C4C4CC", AFFECTS: "#E1E1E7" } as const;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';

const MAX_ITERATIONS = 1500;
const ITERATIONS_PER_FRAME = 10;
// Settled when nodes move on average less than this share of the layout's extent per iteration.
const SETTLED = 0.0005;

const shorten = (text: string, max = 64) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A stable pseudo-random angle for a node id, so the first layout is the same on every visit. */
function angleOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 3600) / 3600 * 2 * Math.PI;
}

function buildGraph(graph: Graph<NodeAttrs, EdgeAttrs>, data: GraphData, previous: Map<string, { x: number; y: number }>) {
  graph.clear();
  for (const n of data.nodes) {
    const center = n.id === data.center;
    const kept = previous.get(n.id);
    const radius = n.hop * 10 + 2;
    graph.addNode(n.id, {
      x: center ? 0 : (kept?.x ?? radius * Math.cos(angleOf(n.id))),
      y: center ? 0 : (kept?.y ?? radius * Math.sin(angleOf(n.id))),
      size: center ? 16 : SIZE[n.type] + (n.type === "development" ? (n.materiality_level ?? 0) * 0.6 : 0) + (n.has_new ? 2 : 0),
      color: NODE_COLOR[n.type],
      label: n.type === "development" ? shorten(n.label) : n.label,
      forceLabel: n.type !== "development",
      fixed: center,
      ringSize: n.has_new ? 2.5 : 0,
      gapSize: n.has_new ? 1.5 : 0,
    });
  }
  for (const e of data.edges) {
    graph.mergeEdge(e.source, e.target, { size: e.type === "AFFECTS" ? 1 : 1.6, color: EDGE_COLOR[e.type] });
  }
}

/** Runs ForceAtlas2 until nodes stop moving, animated per frame unless motion is reduced. */
function settle(graph: Graph<NodeAttrs, EdgeAttrs>, animate: boolean, done: () => void): () => void {
  const settings = { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: false };
  let iterations = 0;
  let frame = 0;
  const step = () => {
    const before = new Map(graph.mapNodes((id, a) => [id, { x: a.x, y: a.y }] as const));
    forceAtlas2.assign(graph, { iterations: ITERATIONS_PER_FRAME, settings });
    iterations += ITERATIONS_PER_FRAME;
    let moved = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    graph.forEachNode((id, a) => {
      const b = before.get(id);
      if (b) moved += Math.hypot(a.x - b.x, a.y - b.y);
      minX = Math.min(minX, a.x);
      maxX = Math.max(maxX, a.x);
      minY = Math.min(minY, a.y);
      maxY = Math.max(maxY, a.y);
    });
    const extent = Math.max(maxX - minX, maxY - minY, 1);
    return moved / graph.order / ITERATIONS_PER_FRAME < extent * SETTLED || iterations >= MAX_ITERATIONS;
  };
  if (graph.order < 2) {
    done();
    return () => {};
  }
  if (!animate) {
    while (!step());
    done();
    return () => {};
  }
  const tick = () => {
    if (step()) done();
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

type Props = {
  data: GraphData;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
};

export function GraphCanvas({ data, hovered, onHover, onOpen }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const graph = useRef(new Graph<NodeAttrs, EdgeAttrs>());
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const hoveredRef = useRef(hovered);
  const callbacks = useRef({ onHover, onOpen });
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  // The data whose layout has settled; a new neighbourhood reads as running until it settles.
  const [settledFor, setSettledFor] = useState<GraphData | null>(null);

  useEffect(() => {
    callbacks.current = { onHover, onOpen };
  }, [onHover, onOpen]);

  // One sigma instance per mount; sigma touches WebGL, so it loads in the browser only.
  useEffect(() => {
    let sigma: Renderer | null = null;
    let cancelled = false;
    void (async () => {
      const [{ default: SigmaClass }, { createNodeBorderProgram }] = await Promise.all([
        import("sigma"),
        import("@sigma/node-border"),
      ]);
      if (cancelled || !stage.current) return;
      const ring = createNodeBorderProgram<NodeAttrs, EdgeAttrs>({
        borders: [
          { size: { attribute: "ringSize", defaultValue: 0, mode: "pixels" }, color: { value: NEW_RING } },
          { size: { attribute: "gapSize", defaultValue: 0, mode: "pixels" }, color: { value: "#FFFFFF" } },
          { size: { fill: true }, color: { attribute: "color" } },
        ],
      });
      sigma = new SigmaClass(graph.current, stage.current, {
        defaultNodeType: "ring",
        nodeProgramClasses: { ring },
        labelFont: FONT,
        labelSize: 12,
        labelWeight: "600",
        labelColor: { color: "#1C1C1E" },
        labelRenderedSizeThreshold: 12,
        stagePadding: 40,
        zIndex: true,
        nodeReducer: (id, attrs) => {
          const h = hoveredRef.current;
          if (!h || !graph.current.hasNode(h) || id === h || graph.current.areNeighbors(id, h)) {
            return id === h ? { ...attrs, highlighted: true, zIndex: 2 } : attrs;
          }
          return { ...attrs, color: DIMMED, label: "", forceLabel: false, ringSize: 0, gapSize: 0, zIndex: 0 };
        },
        edgeReducer: (id, attrs) => {
          const h = hoveredRef.current;
          if (!h || !graph.current.hasNode(h) || graph.current.hasExtremity(id, h)) return attrs;
          return { ...attrs, hidden: true };
        },
      });
      sigma.on("enterNode", ({ node }) => callbacks.current.onHover(node));
      sigma.on("leaveNode", () => callbacks.current.onHover(null));
      sigma.on("clickNode", ({ node }) => callbacks.current.onOpen(node));
      setRenderer(sigma);
    })();
    return () => {
      cancelled = true;
      sigma?.kill();
    };
  }, []);

  // Rebuild and lay out whenever the neighbourhood changes.
  useEffect(() => {
    if (!renderer) return;
    const g = graph.current;
    g.forEachNode((id, a) => positions.current.set(id, { x: a.x, y: a.y }));
    buildGraph(g, data, positions.current);
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return settle(g, animate, () => {
      // Keep the current subject in the middle of the view.
      const at = renderer.getNodeDisplayData(data.center);
      if (at) renderer.getCamera().setState({ x: at.x, y: at.y });
      setSettledFor(data);
    });
  }, [renderer, data]);

  useEffect(() => {
    hoveredRef.current = hovered;
    renderer?.refresh({ skipIndexation: true });
    if (stage.current) stage.current.style.cursor = hovered ? "pointer" : "";
  }, [renderer, hovered]);

  return (
    <div
      ref={stage}
      className="graph-stage"
      data-testid="graph-canvas"
      data-layout={settledFor === data ? "settled" : "running"}
      role="img"
      aria-label={`Graph of ${data.nodes.length} nodes and ${data.edges.length} links around ${
        data.nodes.find((n) => n.id === data.center)?.label ?? data.center
      }`}
    />
  );
}
