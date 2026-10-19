// Sigma.js canvas for a graph neighbourhood, laid out by a d3-force simulation (shared pieces in
// force.ts). Each development is pulled toward its theme's sector around the centre, so related
// news sits together. The simulation cools and stops once the layout settles, then the camera
// refits. Dragging a node reheats it, so neighbours follow and the node floats back when released.
// `data-layout` on the stage reads "running" while nodes move and "settled" once they stop;
// `data-dragging` names the node in hand. Nodes keep their positions across refetches.
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
} from "d3-force";
import type Graph from "graphology";
import type Sigma from "sigma";
import { useRef, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { FitIcon } from "@/components/ui/icons";

import { angleOf, fit, tokenColors, useSigmaStage, type BaseNodeAttrs, type SimNode } from "./force";

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

type NodeAttrs = BaseNodeAttrs & { color: string; ringSize: number; gapSize: number };
type EdgeAttrs = { size: number; color: string };
type Renderer = Sigma<NodeAttrs, EdgeAttrs>;

type GNode = SimNode & { theme: Theme | null; size: number };
type SimLink = SimulationLinkDatum<GNode> & { type: LinkType };
type Sim = Simulation<GNode, SimLink>;

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

const SIZE: Record<NodeType, number> = { topic: 12, group: 11, entity: 9, endpoint: 7, development: 5 };
// Stored relationships draw as structure; a development's links draw weaker and sit closer.
const EDGE_TOKEN: Record<LinkType, "edge" | "edge-weak"> = {
  EXPOSED_TO: "edge",
  DEPENDS_ON: "edge",
  PARTICIPATES_IN: "edge",
  OWNS: "edge",
  SUBSIDIARY_OF: "edge",
  OPERATES_IN: "edge",
  SUPERVISED_BY: "edge",
  SHAREHOLDER_OF: "edge",
  MEMBER_OF: "edge",
  LISTED_ON: "edge",
  AFFECTS: "edge-weak",
  IMPACTS: "edge-weak",
};

/** The palette from the `--g-*` tokens in styles/graph.css, resolved to rgba for WebGL. */
function readPalette(el: HTMLElement): Palette {
  const color = tokenColors(el);
  return {
    node: {
      topic: color("topic"),
      group: color("group"),
      entity: color("entity"),
      endpoint: color("dim"),
      development: color("development"),
    },
    theme: Object.fromEntries(THEMES.map((t) => [t, color(`theme-${t}`)])) as Record<Theme, string>,
    edge: Object.fromEntries(
      Object.entries(EDGE_TOKEN).map(([type, token]) => [type, color(token)]),
    ) as Record<LinkType, string>,
    ring: color("new"),
    gap: color("gap"),
    dim: color("dim"),
    label: color("label"),
  };
}

// Layout in graph units; sigma scales the result to the stage.
const SECTOR_RADIUS = 260;
const RING = 140;
const linkDistance = (type: LinkType) => (EDGE_TOKEN[type] === "edge" ? 120 : 90);

const shorten = (text: string, max = 64) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

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
  const nodes: GNode[] = graph.mapNodes((id, a) => ({
    id,
    x: a.x,
    y: a.y,
    theme: byId.get(id)?.theme ?? null,
    size: a.size,
    ...(id === data.center ? { fx: 0, fy: 0 } : {}),
  }));
  const links: SimLink[] = data.edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
  const sector = (n: GNode) => (n.theme ? sectorOf(n.theme) : { x: 0, y: 0 });
  return forceSimulation(nodes)
    .velocityDecay(0.3)
    .force("link", forceLink<GNode, SimLink>(links).id((n) => n.id).distance((l) => linkDistance(l.type)))
    .force("charge", forceManyBody<GNode>().strength((n) => (n.theme ? -60 : -240)).distanceMax(700))
    .force("collide", forceCollide<GNode>((n) => n.size * 1.6 + 6))
    .force("x", forceX<GNode>((n) => sector(n).x).strength((n) => (n.theme ? 0.1 : 0.02)))
    .force("y", forceY<GNode>((n) => sector(n).y).strength((n) => (n.theme ? 0.1 : 0.02)))
    .stop();
}

/** Where each theme's label goes: just outside its developments, on the line from the centre
 *  through their middle, in stage pixels. */
function regionAnchors(renderer: Renderer, nodes: GNode[], center: string) {
  const viewport = (id: string) => {
    const d = renderer.getNodeDisplayData(id);
    return d ? renderer.framedGraphToViewport(d) : null;
  };
  const c = viewport(center);
  const anchors = new Map<Theme, { x: number; y: number; dx: number }>();
  if (!c) return anchors;
  for (const theme of THEMES) {
    const members = nodes.flatMap((n) => (n.theme === theme ? [viewport(n.id)] : [])).filter((p) => p !== null);
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

type Props = {
  data: GraphData;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** Overlays drawn over the canvas, such as the legend. */
  children?: ReactNode;
};

export function GraphCanvas({ data, hovered, onHover, onOpen, children }: Props) {
  const regions = useRef<HTMLDivElement>(null);
  const { renderer, stage } = useSigmaStage<NodeAttrs, EdgeAttrs, GNode, Palette, GraphData>({
    data,
    hovered,
    onHover,
    onOpen,
    palette: readPalette,
    borders: (colors) => [
      { size: { attribute: "ringSize", defaultValue: 0, mode: "pixels" }, color: { value: colors.ring } },
      { size: { attribute: "gapSize", defaultValue: 0, mode: "pixels" }, color: { value: colors.gap } },
      { size: { fill: true }, color: { attribute: "color" } },
    ],
    settings: () => ({ labelRenderedSizeThreshold: 12, stagePadding: 72 }),
    dim: (attrs, colors) => ({ ...attrs, color: colors.dim, ringSize: 0, gapSize: 0 }),
    // Region labels follow their developments on every frame.
    setup: (r, { sim, center }) =>
      r.on("afterRender", () => {
        const s = sim();
        const layer = regions.current;
        if (!s || !layer) return;
        const anchors = regionAnchors(r, s.nodes(), center());
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
      }),
    layout: (g, d, positions, colors) => {
      buildGraph(g, d, positions, colors);
      return { sim: simulationOf(g, d), center: d.center };
    },
  });

  const themes = THEMES.filter((t) => data.nodes.some((n) => n.theme === t));
  return (
    <div className="graph-canvas">
      <div
        {...stage}
        className="graph-stage"
        data-testid="graph-canvas"
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
