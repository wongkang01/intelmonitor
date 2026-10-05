// Sigma.js canvas for a graph neighbourhood, laid out by a d3-force simulation. Each development is
// pulled toward its theme's sector around the centre, so related news sits together. The
// simulation cools and stops once the layout settles, then the camera refits. Dragging a node
// reheats it, so neighbours follow and the node floats back when released. `data-layout` on the
// stage reads "running" while nodes move and "settled" once they stop; `data-dragging` names the
// node in hand. Nodes keep their positions across refetches.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import Graph from "graphology";
import type Sigma from "sigma";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { FitIcon } from "@/components/ui/icons";

type GraphData = Schema<"Graph">;
type GraphNode = Schema<"GraphNode">;
type NodeType = GraphNode["type"];
type LinkType = Schema<"GraphEdge">["type"];
export type Theme = NonNullable<GraphNode["theme"]>;

/** Development themes, in the order their sectors sit clockwise from the top. */
export const THEME_LABEL: Record<Theme, string> = {
  regulation: "Regulation",
  "digital-assets": "Digital assets",
  technology: "Technology and AI",
  strategy: "Strategy",
  markets: "Earnings and markets",
  macro: "Macro and geopolitics",
};
export const THEMES = Object.keys(THEME_LABEL) as Theme[];

type NodeAttrs = {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  forceLabel: boolean;
  ringSize: number;
  gapSize: number;
};
type EdgeAttrs = { size: number; color: string };
type Renderer = Sigma<NodeAttrs, EdgeAttrs>;

type SimNode = SimulationNodeDatum & { id: string; theme: Theme | null; size: number };
type SimLink = SimulationLinkDatum<SimNode> & { type: LinkType };
type Sim = Simulation<SimNode, SimLink>;

/** Colors read at mount from the `--g-*` tokens in styles/graph.css, resolved to rgba for WebGL. */
type Palette = {
  node: Record<NodeType, string>;
  theme: Record<Theme, string>;
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
    theme: Object.fromEntries(THEMES.map((t) => [t, color(`theme-${t}`)])) as Record<Theme, string>,
    edge: { MEMBER_OF: color("edge"), EXPOSED_TO: color("edge"), AFFECTS: color("edge-weak") },
    ring: color("new"),
    gap: color("gap"),
    dim: color("dim"),
    label: color("label"),
  };
}

// Layout in graph units; sigma scales the result to the stage.
const SECTOR_RADIUS = 260;
const RING = 140;
const LINK_DISTANCE: Record<LinkType, number> = { MEMBER_OF: 120, EXPOSED_TO: 120, AFFECTS: 90 };
// Ticks the simulation needs to cool from alpha 1 to its minimum at d3's default decay.
const TICKS = 300;
// While a node is dragged the simulation stays this warm, so its neighbours keep following.
const DRAG_HEAT = 0.3;

const shorten = (text: string, max = 64) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** A stable pseudo-random angle for a node id, so the first layout is the same on every visit. */
function angleOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 3600) / 3600 * 2 * Math.PI;
}

/** Where a theme's sector sits: evenly spaced clockwise from the top (sigma's y axis points up). */
function sectorOf(theme: Theme): { x: number; y: number } {
  const a = (THEMES.indexOf(theme) / THEMES.length) * 2 * Math.PI;
  return { x: SECTOR_RADIUS * Math.sin(a), y: SECTOR_RADIUS * Math.cos(a) };
}

/** A new node's first position: the centre at the origin, a development near its sector, any other
 *  node on a ring per hop. */
function startOf(n: GraphNode, center: boolean): { x: number; y: number } {
  if (center) return { x: 0, y: 0 };
  const a = angleOf(n.id);
  if (n.theme) {
    const s = sectorOf(n.theme);
    return { x: s.x + 30 * Math.cos(a), y: s.y + 30 * Math.sin(a) };
  }
  return { x: RING * n.hop * Math.cos(a), y: RING * n.hop * Math.sin(a) };
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
    const { x, y } = previous.get(n.id) ?? startOf(n, center);
    graph.addNode(n.id, {
      x: center ? 0 : x,
      y: center ? 0 : y,
      size: center ? 16 : SIZE[n.type] + (n.type === "development" ? (n.materiality_level ?? 0) * 0.6 : 0) + (n.has_new ? 2 : 0),
      color: n.theme ? palette.theme[n.theme] : palette.node[n.type],
      label: n.type === "development" ? shorten(n.label) : n.label,
      forceLabel: n.type !== "development",
      ringSize: n.has_new ? 2.5 : 0,
      gapSize: n.has_new ? 1.5 : 0,
    });
  }
  for (const e of data.edges) {
    graph.mergeEdge(e.source, e.target, { size: e.type === "AFFECTS" ? 1 : 1.6, color: palette.edge[e.type] });
  }
}

/** The simulation over the graph's current positions. The centre is pinned at the origin; links
 *  pull, nodes repel and never overlap, and each themed development is drawn to its sector. */
function simulationOf(graph: Graph<NodeAttrs, EdgeAttrs>, data: GraphData): Sim {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const nodes: SimNode[] = graph.mapNodes((id, a) => ({
    id,
    x: a.x,
    y: a.y,
    theme: byId.get(id)?.theme ?? null,
    size: a.size,
    ...(id === data.center ? { fx: 0, fy: 0 } : {}),
  }));
  const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
  const sector = (n: SimNode) => (n.theme ? sectorOf(n.theme) : { x: 0, y: 0 });
  return forceSimulation(nodes)
    .velocityDecay(0.3)
    .force("link", forceLink<SimNode, SimLink>(links).id((n) => n.id).distance((l) => LINK_DISTANCE[l.type]))
    .force("charge", forceManyBody<SimNode>().strength((n) => (n.theme ? -60 : -240)).distanceMax(700))
    .force("collide", forceCollide<SimNode>((n) => n.size * 1.6 + 6))
    .force("x", forceX<SimNode>((n) => sector(n).x).strength((n) => (n.theme ? 0.1 : 0.02)))
    .force("y", forceY<SimNode>((n) => sector(n).y).strength((n) => (n.theme ? 0.1 : 0.02)))
    .stop();
}

/** Copies simulation positions onto the graph in one update, so sigma redraws once. */
function syncPositions(graph: Graph<NodeAttrs, EdgeAttrs>, sim: Sim) {
  const at = new Map(sim.nodes().map((n) => [n.id, n]));
  graph.updateEachNodeAttributes((id, a) => {
    const n = at.get(id);
    return n ? { ...a, x: n.x ?? a.x, y: n.y ?? a.y } : a;
  });
}

/** Runs the simulation until it cools, animated unless motion is reduced. `done` fires each time it
 *  cools: first here, then after every drag reheats it. */
function settle(graph: Graph<NodeAttrs, EdgeAttrs>, sim: Sim, animate: boolean, done: () => void) {
  if (!animate) {
    sim.tick(TICKS);
    syncPositions(graph, sim);
    done();
    return;
  }
  sim.on("tick", () => syncPositions(graph, sim)).on("end", done).alpha(1).restart();
}

/** Where each theme's label goes: just outside its developments, on the line from the centre
 *  through their middle, in stage pixels. */
function regionAnchors(renderer: Renderer, sim: Sim, center: string) {
  const viewport = (id: string) => {
    const d = renderer.getNodeDisplayData(id);
    return d ? renderer.framedGraphToViewport(d) : null;
  };
  const c = viewport(center);
  const anchors = new Map<Theme, { x: number; y: number; dx: number }>();
  if (!c) return anchors;
  for (const theme of THEMES) {
    const members = sim.nodes().flatMap((n) => (n.theme === theme ? [viewport(n.id)] : [])).filter((p) => p !== null);
    if (!members.length) continue;
    const mx = members.reduce((t, m) => t + m.x, 0) / members.length;
    const my = members.reduce((t, m) => t + m.y, 0) / members.length;
    const len = Math.hypot(mx - c.x, my - c.y) || 1;
    const dx = (mx - c.x) / len;
    const dy = (my - c.y) / len;
    const reach = Math.max(...members.map((m) => (m.x - c.x) * dx + (m.y - c.y) * dy));
    anchors.set(theme, { x: c.x + dx * (reach + 20), y: c.y + dy * (reach + 20), dx });
  }
  return anchors;
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
 *  no other node, no label drawn before it this frame and no edge of the stage; failing that, on
 *  the side that covers least. Forced labels (topics, groups, entities) always draw; a development label with no clear
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
    const { width, height } = renderer.getDimensions();
    // Text that would run off the stage counts against a side, so edge labels turn inward.
    const offStage = (box: Box) => 4 * (box.w * box.h - overlap(box, { x: 0, y: 0, w: width, h: height }));
    const cost = (box: Box) =>
      offStage(box) +
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

/** Fits every node in view, then holds that frame so dragging a node to the edge does not rescale
 *  the rest. Resolves once the camera is there. */
async function fit(renderer: Renderer) {
  renderer.setCustomBBox(null);
  renderer.refresh();
  const camera = renderer.getCamera();
  if (reducedMotion()) camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  else await camera.animatedReset({ duration: 250 });
  renderer.setCustomBBox(renderer.getBBox());
}

export function GraphCanvas({ data, hovered, onHover, onOpen, children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const regions = useRef<HTMLDivElement>(null);
  const graph = useRef(new Graph<NodeAttrs, EdgeAttrs>());
  const sim = useRef<Sim | null>(null);
  const center = useRef(data.center);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const palette = useRef<Palette | null>(null);
  const hoveredRef = useRef(hovered);
  const callbacks = useRef({ onHover, onOpen });
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  // The data whose layout has settled and been framed; a new neighbourhood reads as running until then.
  const [settledFor, setSettledFor] = useState<GraphData | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A drag reheated the layout, so nodes are moving until it cools again.
  const [floating, setFloating] = useState(false);

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
      const r: Renderer = new SigmaClass(graph.current, stage.current, {
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
      sigma = r;
      r.setSetting("defaultDrawNodeLabel", labelPlacer(r, colors));

      // Region labels follow their developments on every frame.
      r.on("afterRender", () => {
        const s = sim.current;
        const layer = regions.current;
        if (!s || !layer) return;
        const anchors = regionAnchors(r, s, center.current);
        for (const el of layer.querySelectorAll<HTMLElement>("[data-region]")) {
          const a = anchors.get(el.dataset.region as Theme);
          el.hidden = !a;
          if (!a) continue;
          // Right of the anchor on the right side, left of it on the left, centred above and below,
          // and always inside the stage.
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const x = a.dx > 0.35 ? a.x : a.dx < -0.35 ? a.x - w : a.x - w / 2;
          const left = Math.min(Math.max(x, 8), layer.clientWidth - w - 8);
          const top = Math.min(Math.max(a.y - h / 2, 8), layer.clientHeight - h - 8);
          el.style.transform = `translate(${left}px, ${top}px)`;
        }
      });

      // Drag: the node follows the pointer while the simulation stays warm, then floats free. A
      // press that moved more than a few pixels is a drag, so its release does not open the node.
      let dragged: string | null = null;
      let pressedAt: { x: number; y: number } | null = null;
      let moved = false;
      // The node under the pointer by sigma's account. The dragged node stays highlighted while
      // held, and the highlight catches up with this on release.
      let under: string | null = null;
      const simNode = (id: string) => sim.current?.nodes().find((n) => n.id === id);
      r.on("enterNode", ({ node }) => {
        under = node;
        if (!dragged) callbacks.current.onHover(node);
      });
      r.on("leaveNode", () => {
        under = null;
        if (!dragged) callbacks.current.onHover(null);
      });
      r.on("clickNode", ({ node }) => {
        if (!moved) callbacks.current.onOpen(node);
      });
      r.on("downNode", ({ node, event }) => {
        const n = simNode(node);
        if (!n) return;
        dragged = node;
        pressedAt = { x: event.x, y: event.y };
        moved = false;
        n.fx = n.x;
        n.fy = n.y;
      });
      r.on("moveBody", ({ event }) => {
        if (!dragged) return;
        const n = simNode(dragged);
        if (!n) return;
        event.preventSigmaDefault();
        event.original.preventDefault();
        event.original.stopPropagation();
        // Nothing moves until the press becomes a drag, so a plain click lands where it was aimed.
        if (!moved) {
          if (!pressedAt || Math.hypot(event.x - pressedAt.x, event.y - pressedAt.y) <= 3) return;
          moved = true;
          setDragging(dragged);
          if (!reducedMotion()) {
            setFloating(true);
            sim.current?.alphaTarget(DRAG_HEAT).restart();
          }
        }
        const p = r.viewportToGraph(event);
        n.fx = n.x = p.x;
        n.fy = n.y = p.y;
        if (reducedMotion()) graph.current.mergeNodeAttributes(dragged, { x: p.x, y: p.y });
      });
      const release = () => {
        if (!dragged) return;
        const n = simNode(dragged);
        // The centre stays pinned where it is; with reduced motion a dragged node stays where dropped.
        if (n && dragged !== center.current && !(moved && reducedMotion())) n.fx = n.fy = null;
        sim.current?.alphaTarget(0);
        dragged = null;
        setDragging(null);
        callbacks.current.onHover(under);
      };
      r.on("upNode", release);
      r.on("upStage", release);
      setRenderer(r);
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
    center.current = data.center;
    renderer.setCustomBBox(null);
    const s = simulationOf(g, data);
    sim.current = s;
    let live = true;
    let framed = false;
    settle(g, s, !reducedMotion(), () => {
      setFloating(false);
      if (framed) return;
      framed = true;
      void fit(renderer).then(() => live && setSettledFor(data));
    });
    return () => {
      live = false;
      s.stop().on("tick", null).on("end", null);
    };
  }, [renderer, data]);

  useEffect(() => {
    hoveredRef.current = hovered;
    renderer?.refresh({ skipIndexation: true });
  }, [renderer, hovered]);

  const themes = THEMES.filter((t) => data.nodes.some((n) => n.theme === t));
  return (
    <div className="graph-canvas">
      <div
        ref={stage}
        className="graph-stage"
        data-testid="graph-canvas"
        data-layout={settledFor === data && !floating ? "settled" : "running"}
        data-hovered={hovered ?? undefined}
        data-dragging={dragging ?? undefined}
        role="img"
        aria-label={`Graph of ${data.nodes.length} nodes and ${data.edges.length} links around ${
          data.nodes.find((n) => n.id === data.center)?.label ?? data.center
        }`}
      />
      <div ref={regions} className="graph-regions" aria-hidden="true">
        {themes.map((t) => (
          <span key={t} data-region={t} hidden>
            <span className={`gdot t-${t}`} />
            {THEME_LABEL[t]}
          </span>
        ))}
      </div>
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
