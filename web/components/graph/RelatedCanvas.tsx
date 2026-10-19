// Sigma.js canvas for the Related card: the subject pinned in the middle, every node linked to it
// around it, laid out by a d3-force simulation that settles and stops (shared pieces in force.ts).
// A node's size grows with the square root of its developments in the window; it is red when one
// could hurt the subject, blue when it has developments and none could, and an outline when it has
// none. Each node with developments shows its count inside, and the open node's popover beside it;
// both follow their node on every frame. Nodes keep their places while the same ones have news.
// Dragging a node reheats the layout, as in the graph view. The camera stays put, so the page
// scrolls over the card. `data-layout` on the stage reads "running" while nodes move and
// "settled" once they stop.
import { forceCollide, forceSimulation, type Simulation, type SimulationLinkDatum } from "d3-force";
import type Graph from "graphology";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";

import { angleOf, tokenColors, useSigmaStage, type BaseNodeAttrs, type BBox, type SimNode } from "./force";

type LinkedNode = Schema<"RelatedNode">;
type Subject = Schema<"SubjectRef">;

type NodeAttrs = BaseNodeAttrs & { color: string; borderColor: string };
type EdgeAttrs = { size: number; color: string };
type RNode = SimNode & { size: number };
type Sim = Simulation<RNode, SimulationLinkDatum<RNode>>;

/** How a node reads: could hurt the subject, has other developments, or has none. */
type Tone = "harm" | "news" | "none";
export const toneOf = (n: LinkedNode): Tone => (n.harmful > 0 ? "harm" : n.development_ids.length > 0 ? "news" : "none");

/** Colors read at mount from the `--g-*` tokens on `.rg` in styles/related.css. */
type Palette = {
  center: string;
  fill: Record<Tone, string>;
  line: Record<Tone, string>;
  edge: Record<Tone, string>;
  gap: string;
  dim: string;
  label: string;
  detail: string;
};

function readPalette(el: HTMLElement): Palette {
  const color = tokenColors(el);
  return {
    center: color("center"),
    fill: { harm: color("harm-bg"), news: color("news-bg"), none: color("none-bg") },
    line: { harm: color("harm"), news: color("news"), none: color("none") },
    edge: { harm: color("harm"), news: color("news"), none: color("edge") },
    gap: color("gap"),
    dim: color("dim"),
    label: color("label"),
    detail: color("detail"),
  };
}

const CENTER_SIZE = 14;
// Radius of a node with no developments, and of one with n: 8 + 3·√n, so 11 for one, 14 for four.
const EMPTY_SIZE = 4;
const sizeOf = (count: number) => (count ? 8 + 3 * Math.sqrt(count) : EMPTY_SIZE);
// The outer ellipse's radii in graph units, and the inner one's as a share of them.
const RX = 260;
const RY = 220;
const INNER = 0.55;
const MAX_NAME = 30;

/** A name short enough for the canvas: no trailing gloss in brackets or legal suffix, then cut. */
function shortName(name: string): string {
  const short = name
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/,?\s+(Corporation\s+)?(Limited|Ltd\.?|Pte\.?\s+Ltd\.?|Berhad|Bhd)$/i, "");
  return short.length > MAX_NAME ? `${short.slice(0, MAX_NAME - 1)}…` : short;
}

/** `count` points evenly spaced along the ellipse of radii RX·k and RY·k, starting `turn` radians
 *  round from the bottom, so neighbours sit as far apart at the sides as at the top. */
function ellipsePoints(count: number, k: number, turn: number): { x: number; y: number }[] {
  const steps = 720;
  const at = (i: number) => {
    const t = (i / steps) * 2 * Math.PI - Math.PI / 2 + turn;
    return { x: RX * k * Math.cos(t), y: RY * k * Math.sin(t) };
  };
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const [a, b] = [at(i - 1), at(i)];
    lengths.push(lengths[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = lengths[steps];
  const points: { x: number; y: number }[] = [];
  for (let j = 0, i = 0; j < count; j++) {
    while (lengths[i] < (j / count) * total) i++;
    points.push(at(i));
  }
  return points;
}

function buildGraph(
  graph: Graph<NodeAttrs, EdgeAttrs>,
  center: Subject,
  nodes: LinkedNode[],
  previous: Map<string, { x: number; y: number }>,
  palette: Palette,
) {
  graph.clear();
  graph.addNode(center.id, {
    x: 0,
    y: 0,
    size: CENTER_SIZE,
    color: palette.center,
    borderColor: palette.center,
    label: center.name,
    forceLabel: true,
  });
  // A new node starts evenly spaced on its ellipse, in the API's order (most developments first);
  // the inner one is turned by a stable angle so the two rings do not line up.
  const counted = nodes.filter((n) => n.development_ids.length > 0);
  const empty = nodes.filter((n) => n.development_ids.length === 0);
  const outer = ellipsePoints(counted.length, 1, 0);
  const inner = ellipsePoints(empty.length, INNER, angleOf(center.id));
  for (const n of nodes) {
    const start = n.development_ids.length ? outer[counted.indexOf(n)] : inner[empty.indexOf(n)];
    const { x, y } = previous.get(n.id) ?? start;
    const tone = toneOf(n);
    graph.addNode(n.id, {
      x,
      y,
      size: sizeOf(n.development_ids.length),
      color: palette.fill[tone],
      borderColor: palette.line[tone],
      label: shortName(n.name),
      detail: n.links.map((l) => l.label).join(", "),
      forceLabel: tone !== "none",
    });
    graph.addEdge(center.id, n.id, { size: tone === "none" ? 1 : 1.5, color: palette.edge[tone] });
  }
}

/**
 * Pulls each node toward an ellipse around the centre node, wider than tall to fit the card:
 * nodes with developments onto the outer one, where their labels have room, the rest onto an inner
 * one. It follows the centre, so dragging the centre brings every node along.
 */
function ringForce(center: string) {
  let nodes: RNode[] = [];
  let hub: RNode | undefined;
  const force = (alpha: number) => {
    const cx = hub?.x ?? 0;
    const cy = hub?.y ?? 0;
    for (const n of nodes) {
      if (n === hub) continue;
      const k = n.size > EMPTY_SIZE ? 1 : INNER;
      const dx = (n.x ?? 0) - cx;
      const dy = (n.y ?? 0) - cy;
      const d = Math.hypot(dx / (RX * k), dy / (RY * k)) || 1;
      n.vx = (n.vx ?? 0) + (dx / d - dx) * 0.3 * alpha;
      n.vy = (n.vy ?? 0) + (dy / d - dy) * 0.3 * alpha;
    }
  };
  force.initialize = (all: RNode[]) => {
    nodes = all;
    hub = all.find((n) => n.id === center);
  };
  return force;
}

/** The simulation over the graph's current positions: the centre pinned at the origin and the
 *  other nodes held on their ellipses, never overlapping. Nodes start evenly spaced, so no charge
 *  is needed to spread them; one would crowd the outer ring toward its top and bottom. */
function simulationOf(graph: Graph<NodeAttrs, EdgeAttrs>, center: string): Sim {
  const nodes: RNode[] = graph.mapNodes((id, a) => ({
    id,
    x: a.x,
    y: a.y,
    size: a.size,
    ...(id === center ? { fx: 0, fy: 0 } : {}),
  }));
  return forceSimulation(nodes)
    .velocityDecay(0.3)
    .force("ring", ringForce(center))
    .force("collide", forceCollide<RNode>((n) => (n.size > EMPTY_SIZE ? n.size * 1.4 + 10 : n.size + 4)))
    .stop();
}

/** A frame centred on the subject at the origin, at least as large as the outer ellipse, so the
 *  subject sits in the middle and a few nodes do not fill the card. */
const centred = ({ x, y }: BBox): BBox => {
  const w = Math.max(RX, -x[0], x[1]);
  const h = Math.max(RY, -y[0], y[1]);
  return { x: [-w, w], y: [-h, h] };
};

type Props = {
  center: Subject;
  /** The nodes in view, after the card's link-type filter. */
  nodes: LinkedNode[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** The node whose popover shows; the popover is drawn beside it and follows it. */
  selected: string | null;
  popover?: ReactNode;
};

export function RelatedCanvas({ center, nodes, hovered, onHover, onOpen, selected, popover }: Props) {
  const badges = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // The nodes with developments the kept positions were laid out for.
  const outerFor = useRef("");
  const selectedRef = useRef(selected);
  const data = useMemo(() => ({ center, nodes }), [center, nodes]);
  const { renderer, stage } = useSigmaStage<NodeAttrs, EdgeAttrs, RNode, Palette, typeof data>({
    data,
    hovered,
    onHover,
    onOpen,
    palette: readPalette,
    borders: () => [
      { size: { value: 1.5, mode: "pixels" }, color: { attribute: "borderColor" } },
      { size: { fill: true }, color: { attribute: "color" } },
    ],
    settings: () => ({
      labelRenderedSizeThreshold: 0,
      stagePadding: 48,
      enableCameraZooming: false,
      enableCameraPanning: false,
    }),
    dim: (attrs, colors) => ({ ...attrs, color: colors.dim, borderColor: colors.dim }),
    setup: (r, view) => {
      // Hovering names a node whose label may be hidden; a node with news is always labelled.
      r.setSetting("defaultDrawNodeHover", (ctx, d, settings) => {
        if (!d.forceLabel) view.rendering.drawDiscNodeHover(ctx, d, settings);
      });
      // Badges and the popover follow their nodes on every frame.
      r.on("afterRender", () => {
        const at = (id: string) => {
          const d = r.getNodeDisplayData(id);
          if (!d) return null;
          const p = r.framedGraphToViewport(d);
          return { ...p, size: r.scaleSize(d.size) };
        };
        const h = view.hovered();
        for (const el of badges.current?.querySelectorAll<HTMLElement>("[data-node]") ?? []) {
          const id = el.dataset.node ?? "";
          const p = at(id);
          el.hidden = !p;
          if (!p) continue;
          // Centred in the node, so it never meets a label; dimmed with its node while another is hovered.
          el.style.transform = `translate(${p.x - el.offsetWidth / 2}px, ${p.y - el.offsetHeight / 2}px)`;
          el.toggleAttribute("data-dim", h !== null && h !== id && h !== view.center());
        }
        const box = pop.current;
        const open = selectedRef.current;
        const p = open ? at(open) : null;
        if (!box || !p) return;
        // Beside the node, on the side with more room, and always inside the stage.
        const { clientWidth: width, clientHeight: height } = r.getContainer();
        const w = box.offsetWidth;
        const hgt = box.offsetHeight;
        const gap = p.size + 8;
        const right = p.x + gap + w <= width - 8 || p.x < width / 2;
        const left = Math.min(Math.max(right ? p.x + gap : p.x - gap - w, 8), width - w - 8);
        const top = Math.min(Math.max(p.y - 24, 8), height - hgt - 8);
        box.style.transform = `translate(${left}px, ${top}px)`;
      });
    },
    layout: (g, d, positions, colors) => {
      // Nodes keep their places across a refetch unless the set with developments changed, which
      // would crowd the outer ring; then every node starts evenly spaced again.
      const outer = d.nodes.flatMap((n) => (n.development_ids.length ? [n.id] : [])).join(" ");
      if (outer !== outerFor.current) positions.clear();
      outerFor.current = outer;
      buildGraph(g, d.center, d.nodes, positions, colors);
      return { sim: simulationOf(g, d.center.id), center: d.center.id, frame: centred };
    },
  });

  useEffect(() => {
    selectedRef.current = selected;
    renderer?.refresh({ skipIndexation: true });
  }, [renderer, selected]);

  const counted = nodes.filter((n) => n.development_ids.length > 0);
  return (
    <div className="rg-canvas">
      <div
        {...stage}
        className="rg-stage"
        data-testid="related-canvas"
        role="img"
        aria-label={`${center.name} and ${nodes.length} linked ${nodes.length === 1 ? "party" : "parties"}`}
      />
      <div ref={badges} className="rg-badges" aria-hidden="true">
        {counted.map((n) => (
          <span key={n.id} data-node={n.id} className={`rg-badge ${toneOf(n)}`} hidden>
            {n.development_ids.length}
          </span>
        ))}
      </div>
      <div ref={pop} className="rg-pop-anchor" hidden={!selected || !popover}>
        {popover}
      </div>
    </div>
  );
}
