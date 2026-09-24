"use client";

// Sigma.js canvas for a graph neighbourhood. ForceAtlas2 runs when the data changes and stops once
// the layout settles, then the camera refits; `data-layout` on the stage reads "running" or "settled".
// Nodes keep their positions across refetches, so changing a filter only moves what it adds.
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type Sigma from "sigma";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { FitIcon } from "@/components/ui/icons";

type GraphData = Schema<"Graph">;
type NodeType = Schema<"GraphNode">["type"];
type LinkType = Schema<"GraphEdge">["type"];

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

/** Colors read at mount from the `--g-*` tokens in styles/graph.css, resolved to rgba for WebGL. */
type Palette = {
  node: Record<NodeType, string>;
  edge: Record<LinkType, string>;
  ring: string;
  gap: string;
  dim: string;
  label: string;
};

const SIZE: Record<NodeType, number> = { topic: 12, group: 11, entity: 9, development: 5 };
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/** Resolves each `--g-*` custom property on `el` to an rgba string. Sigma cannot parse oklch, so a
 *  1px canvas paints the token and the pixel is read back. */
function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const color = (name: string) => {
    if (!ctx) return "rgba(128,128,128,1)";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = style.getPropertyValue(`--g-${name}`).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  };
  return {
    node: { topic: color("topic"), group: color("group"), entity: color("entity"), development: color("development") },
    edge: { MEMBER_OF: color("edge"), EXPOSED_TO: color("edge"), AFFECTS: color("edge-weak") },
    ring: color("new"),
    gap: color("gap"),
    dim: color("dim"),
    label: color("label"),
  };
}

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

function buildGraph(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  data: GraphData,
  previous: Map<string, { x: number; y: number }>,
  palette: Palette,
) {
  graph.clear();
  for (const n of data.nodes) {
    const center = n.id === data.center;
    const kept = previous.get(n.id);
    const radius = n.hop * 10 + 2;
    graph.addNode(n.id, {
      x: center ? 0 : (kept?.x ?? radius * Math.cos(angleOf(n.id))),
      y: center ? 0 : (kept?.y ?? radius * Math.sin(angleOf(n.id))),
      size: center ? 16 : SIZE[n.type] + (n.type === "development" ? (n.materiality_level ?? 0) * 0.6 : 0) + (n.has_new ? 2 : 0),
      color: palette.node[n.type],
      label: n.type === "development" ? shorten(n.label) : n.label,
      forceLabel: n.type !== "development",
      fixed: center,
      ringSize: n.has_new ? 2.5 : 0,
      gapSize: n.has_new ? 1.5 : 0,
    });
  }
  for (const e of data.edges) {
    graph.mergeEdge(e.source, e.target, { size: e.type === "AFFECTS" ? 1 : 1.6, color: palette.edge[e.type] });
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

type Box = { x: number; y: number; w: number; h: number };
type Disc = { x: number; y: number; r: number };

const LABEL_SIZE = 12;
const LABEL_GAP = 4;

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Draws each label beside its node on the first side (right, left, below, above) where it covers
 *  no other node and no label drawn before it this frame; failing that, on the side that covers
 *  least. Forced labels (topics, groups, entities) always draw; a development label with no clear
 *  side is left out. Labels get a halo in the canvas colour so edges never run through the text. */
function labelPlacer(renderer: Renderer, colors: Palette): NodeLabelDrawingFunction<NodeAttrs, EdgeAttrs> {
  let discs: Disc[] | null = null;
  let placed: Box[] = [];
  renderer.on("beforeRender", () => {
    discs = null;
    placed = [];
  });
  const nodeDiscs = () =>
    (discs ??= renderer.getGraph().mapNodes((id) => {
      const d = renderer.getNodeDisplayData(id);
      if (!d || d.hidden) return { x: 0, y: 0, r: 0 };
      const { x, y } = renderer.framedGraphToViewport(d);
      return { x, y, r: renderer.scaleSize(d.size) + 2 };
    }));

  return (ctx, data, settings) => {
    if (!data.label) return;
    ctx.font = `${settings.labelWeight} ${LABEL_SIZE}px ${settings.labelFont}`;
    const w = ctx.measureText(data.label).width;
    const h = LABEL_SIZE + 2;
    const r = data.size + LABEL_GAP;
    const sides: Box[] = [
      { x: data.x + r, y: data.y - h / 2, w, h },
      { x: data.x - r - w, y: data.y - h / 2, w, h },
      { x: data.x - w / 2, y: data.y + r, w, h },
      { x: data.x - w / 2, y: data.y - r - h, w, h },
    ];
    const cost = (box: Box) =>
      nodeDiscs().reduce(
        // The node's own disc sits at the label's anchor.
        (sum, n) => (!n.r || Math.hypot(n.x - data.x, n.y - data.y) < 0.5 ? sum : sum + overlap(box, { x: n.x - n.r, y: n.y - n.r, w: 2 * n.r, h: 2 * n.r })),
        0,
      ) + placed.reduce((sum, b) => sum + 2 * overlap(box, b), 0);
    const costs = sides.map(cost);
    const best = costs.findIndex((c) => c === 0);
    if (best < 0 && !data.forceLabel) return;
    const box = sides[best >= 0 ? best : costs.indexOf(Math.min(...costs))];
    placed.push(box);
    const baseline = box.y + h / 2 + LABEL_SIZE / 3;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.gap;
    ctx.strokeText(data.label, box.x, baseline);
    ctx.fillStyle = colors.label;
    ctx.fillText(data.label, box.x, baseline);
  };
}

type Props = {
  data: GraphData;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** Overlays drawn over the canvas, such as the legend. */
  children?: ReactNode;
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fits every node in view: sigma's default camera frames the whole graph. Resolves once it is there. */
async function fit(renderer: Renderer) {
  const camera = renderer.getCamera();
  if (reducedMotion()) camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  else await camera.animatedReset({ duration: 250 });
}

export function GraphCanvas({ data, hovered, onHover, onOpen, children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const graph = useRef(new Graph<NodeAttrs, EdgeAttrs>());
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const palette = useRef<Palette | null>(null);
  const hoveredRef = useRef(hovered);
  const callbacks = useRef({ onHover, onOpen });
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  // The data whose layout has settled and been framed; a new neighbourhood reads as running until then.
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
      const colors = readPalette(stage.current);
      palette.current = colors;
      const ring = createNodeBorderProgram<NodeAttrs, EdgeAttrs>({
        borders: [
          { size: { attribute: "ringSize", defaultValue: 0, mode: "pixels" }, color: { value: colors.ring } },
          { size: { attribute: "gapSize", defaultValue: 0, mode: "pixels" }, color: { value: colors.gap } },
          { size: { fill: true }, color: { attribute: "color" } },
        ],
      });
      sigma = new SigmaClass(graph.current, stage.current, {
        defaultNodeType: "ring",
        nodeProgramClasses: { ring },
        labelFont: FONT,
        labelSize: LABEL_SIZE,
        labelWeight: "500",
        labelColor: { color: colors.label },
        labelRenderedSizeThreshold: 12,
        stagePadding: 72,
        zIndex: true,
        nodeReducer: (id, attrs) => {
          const h = hoveredRef.current;
          if (!h || !graph.current.hasNode(h) || id === h || graph.current.areNeighbors(id, h)) {
            return id === h ? { ...attrs, highlighted: true, zIndex: 2 } : attrs;
          }
          return { ...attrs, color: colors.dim, label: "", forceLabel: false, ringSize: 0, gapSize: 0, zIndex: 0 };
        },
        edgeReducer: (id, attrs) => {
          const h = hoveredRef.current;
          if (!h || !graph.current.hasNode(h) || graph.current.hasExtremity(id, h)) return attrs;
          return { ...attrs, hidden: true };
        },
      });
      sigma.setSetting("defaultDrawNodeLabel", labelPlacer(sigma, colors));
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

  // Rebuild and lay out whenever the neighbourhood changes, then refit the camera once it settles.
  useEffect(() => {
    if (!renderer || !palette.current) return;
    const g = graph.current;
    g.forEachNode((id, a) => positions.current.set(id, { x: a.x, y: a.y }));
    buildGraph(g, data, positions.current, palette.current);
    let live = true;
    const stop = settle(g, !reducedMotion(), () => {
      void fit(renderer).then(() => live && setSettledFor(data));
    });
    return () => {
      live = false;
      stop();
    };
  }, [renderer, data]);

  useEffect(() => {
    hoveredRef.current = hovered;
    renderer?.refresh({ skipIndexation: true });
    if (stage.current) stage.current.style.cursor = hovered ? "pointer" : "";
  }, [renderer, hovered]);

  return (
    <div className="graph-canvas">
      <div
        ref={stage}
        className="graph-stage"
        data-testid="graph-canvas"
        data-layout={settledFor === data ? "settled" : "running"}
        data-hovered={hovered ?? undefined}
        role="img"
        aria-label={`Graph of ${data.nodes.length} nodes and ${data.edges.length} links around ${
          data.nodes.find((n) => n.id === data.center)?.label ?? data.center
        }`}
      />
      <button
        type="button"
        className="btn-icon lg graph-fit"
        aria-label="Fit graph to view"
        title="Fit to view"
        disabled={!renderer}
        onClick={() => renderer && void fit(renderer)}
      >
        <FitIcon />
      </button>
      {children}
    </div>
  );
}
