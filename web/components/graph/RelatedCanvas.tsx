// Sigma.js canvas for the Related card: the subject pinned in the middle and the linked nodes with
// developments in the window on a ring around it, laid out by a d3-force simulation that settles
// and stops (shared pieces in force.ts). A node's size grows with its developments, so one with 5
// is three times one with 1; it is red when one could hurt the subject and blue otherwise. Each
// node shows its count inside, following it on every frame. Nodes keep their places while the same
// ones have news. Dragging a node reheats the layout, as in the graph view. The camera stays put,
// so the page scrolls over the card. `data-layout` on the stage reads "running" while nodes move
// and "settled" once they stop.
import { forceCollide, forceSimulation, type Simulation, type SimulationLinkDatum } from "d3-force";
import type Graph from "graphology";
import { useMemo, useRef } from "react";

import type { Schema } from "@/lib/api/client";

import { tokenColors, useSigmaStage, type BaseNodeAttrs, type BBox, type SimNode } from "./force";

type LinkedNode = Schema<"RelatedNode">;
type Subject = Schema<"SubjectRef">;

type NodeAttrs = BaseNodeAttrs & { color: string; borderColor: string };
type EdgeAttrs = { size: number; color: string };
type RNode = SimNode & { size: number };
type Sim = Simulation<RNode, SimulationLinkDatum<RNode>>;

/** How a node reads: a development through it could hurt the subject, or none could. */
type Tone = "harm" | "news";
export const toneOf = (n: LinkedNode): Tone => (n.harmful > 0 ? "harm" : "news");

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
    fill: { harm: color("harm-bg"), news: color("news-bg") },
    line: { harm: color("harm"), news: color("news") },
    edge: { harm: color("harm"), news: color("news") },
    gap: color("gap"),
    dim: color("dim"),
    label: color("label"),
    detail: color("detail"),
  };
}

const CENTER_SIZE = 16;
// Radius in pixels of a node with n developments: 12 for one, growing by 6 per development to 36
// for five (three times one), then by 1.5 each up to 48, so a 90-day ring of many nodes still fits.
const sizeOf = (count: number) => (count <= 5 ? 6 + 6 * count : Math.min(36 + 1.5 * (count - 5), 48));
// The ring's radii in graph units.
const RX = 260;
const RY = 220;
const MAX_NAME = 30;

/** A name short enough for the canvas: no trailing gloss in brackets or legal suffix, then cut. */
function shortName(name: string): string {
  const short = name
    .replace(/\s*\([^)]*\)$/, "")
    .replace(/,?\s+(Corporation\s+)?(Limited|Ltd\.?|Pte\.?\s+Ltd\.?|Berhad|Bhd)$/i, "");
  return short.length > MAX_NAME ? `${short.slice(0, MAX_NAME - 1)}…` : short;
}

/** `count` points evenly spaced along the ring, starting from the bottom, so neighbours sit as far
 *  apart at the sides as at the top. */
function ellipsePoints(count: number): { x: number; y: number }[] {
  const steps = 720;
  const at = (i: number) => {
    const t = (i / steps) * 2 * Math.PI - Math.PI / 2;
    return { x: RX * Math.cos(t), y: RY * Math.sin(t) };
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
  // A new node starts evenly spaced on the ring, in the API's order (most developments first).
  const starts = ellipsePoints(nodes.length);
  nodes.forEach((n, i) => {
    const { x, y } = previous.get(n.id) ?? starts[i];
    const tone = toneOf(n);
    graph.addNode(n.id, {
      x,
      y,
      size: sizeOf(n.development_ids.length),
      color: palette.fill[tone],
      borderColor: palette.line[tone],
      label: shortName(n.name),
      detail: n.links.map((l) => l.label).join(", "),
      forceLabel: true,
    });
    graph.addEdge(center.id, n.id, { size: 1.5, color: palette.edge[tone] });
  });
}

/** Pulls each node toward the ring around the centre node, wider than tall to fit the card. It
 *  follows the centre, so dragging the centre brings every node along. */
function ringForce(center: string) {
  let nodes: RNode[] = [];
  let hub: RNode | undefined;
  const force = (alpha: number) => {
    const cx = hub?.x ?? 0;
    const cy = hub?.y ?? 0;
    for (const n of nodes) {
      if (n === hub) continue;
      const dx = (n.x ?? 0) - cx;
      const dy = (n.y ?? 0) - cy;
      const d = Math.hypot(dx / RX, dy / RY) || 1;
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
 *  other nodes held on the ring, never overlapping. Nodes start evenly spaced, so no charge is
 *  needed to spread them; one would crowd the ring toward its top and bottom. */
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
    .force("collide", forceCollide<RNode>((n) => n.size + 8))
    .stop();
}

/** A frame centred on the subject at the origin, at least as large as the ring, so the
 *  subject sits in the middle and a few nodes do not fill the card. */
const centred = ({ x, y }: BBox): BBox => {
  const w = Math.max(RX, -x[0], x[1]);
  const h = Math.max(RY, -y[0], y[1]);
  return { x: [-w, w], y: [-h, h] };
};

type Props = {
  center: Subject;
  /** The nodes with developments in the window. */
  nodes: LinkedNode[];
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
};

export function RelatedCanvas({ center, nodes, hovered, onHover, onOpen }: Props) {
  const badges = useRef<HTMLDivElement>(null);
  // The nodes the kept positions were laid out for.
  const layoutFor = useRef("");
  const data = useMemo(() => ({ center, nodes }), [center, nodes]);
  const { stage } = useSigmaStage<NodeAttrs, EdgeAttrs, RNode, Palette, typeof data>({
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
      stagePadding: 64,
      enableCameraZooming: false,
      enableCameraPanning: false,
    }),
    dim: (attrs, colors) => ({ ...attrs, color: colors.dim, borderColor: colors.dim }),
    setup: (r, view) => {
      // Every node is labelled, so hovering draws no extra label.
      r.setSetting("defaultDrawNodeHover", () => {});
      // Badges follow their nodes on every frame.
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
      });
    },
    layout: (g, d, positions, colors) => {
      // Nodes keep their places across a refetch unless the set changed, which would crowd the
      // ring; then every node starts evenly spaced again.
      const ids = d.nodes.map((n) => n.id).join(" ");
      if (ids !== layoutFor.current) positions.clear();
      layoutFor.current = ids;
      buildGraph(g, d.center, d.nodes, positions, colors);
      return { sim: simulationOf(g, d.center.id), center: d.center.id, frame: centred };
    },
  });

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
        {nodes.map((n) => (
          <span key={n.id} data-node={n.id} className={`rg-badge ${toneOf(n)}`} hidden>
            {n.development_ids.length}
          </span>
        ))}
      </div>
    </div>
  );
}
