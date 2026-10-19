// What the sigma canvases share: GraphCanvas (the graph view) and RelatedCanvas (the Overview's
// Related card). `useSigmaStage` holds the stage's lifecycle; the pieces under it are colors read
// from the `--g-*` tokens for WebGL, a d3-force layout that animates until it cools and then stops,
// the camera fit, label placement, hover focus, and drag: a dragged node reheats the layout so its
// neighbours follow, and floats free once released.
import type { createNodeBorderProgram } from "@sigma/node-border";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import Graph from "graphology";
import type { Attributes } from "graphology-types";
import { useEffect, useRef, useState } from "react";
import type Sigma from "sigma";
import type * as SigmaRendering from "sigma/rendering";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import type { Settings } from "sigma/settings";

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
export const LABEL_SIZE = 12;
const DETAIL_SIZE = 11;
const LABEL_GAP = 4;
// Ticks the simulation needs to cool from alpha 1 to its minimum at d3's default decay.
const TICKS = 300;
// While a node is dragged the simulation stays this warm, so its neighbours keep following.
const DRAG_HEAT = 0.3;

/** What every node carries. `detail` is an optional second label line, smaller and muted. */
export type BaseNodeAttrs = { x: number; y: number; size: number; label: string; forceLabel: boolean; detail?: string };
export type SimNode = SimulationNodeDatum & { id: string };
type Sim<N extends SimNode> = Simulation<N, SimulationLinkDatum<N>>;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Resolves `--g-<name>` custom properties on `el` to rgba strings. Sigma cannot parse oklch, so a
 *  1px canvas paints the token and the pixel is read back. */
export function tokenColors(el: HTMLElement): (name: string) => string {
  const style = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  return (name) => {
    if (!ctx) return "rgba(128,128,128,1)";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = style.getPropertyValue(`--g-${name}`).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  };
}

/** A stable pseudo-random angle for a node id, so the first layout is the same on every visit. */
export function angleOf(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 3600) / 3600 * 2 * Math.PI;
}

/** Copies simulation positions onto the graph in one update, so sigma redraws once. */
function syncPositions<A extends BaseNodeAttrs, N extends SimNode>(graph: Graph<A>, sim: Sim<N>) {
  const at = new Map(sim.nodes().map((n) => [n.id, n]));
  graph.updateEachNodeAttributes((id, a) => {
    const n = at.get(id);
    return n ? { ...a, x: n.x ?? a.x, y: n.y ?? a.y } : a;
  });
}

/** Runs the simulation until it cools, animated unless motion is reduced. `done` fires each time it
 *  cools: first here, then after every drag reheats it. */
export function settle<A extends BaseNodeAttrs, N extends SimNode>(graph: Graph<A>, sim: Sim<N>, animate: boolean, done: () => void) {
  if (!animate) {
    sim.tick(TICKS);
    syncPositions(graph, sim);
    done();
    return;
  }
  sim.on("tick", () => syncPositions(graph, sim)).on("end", done).alpha(1).restart();
}

export type BBox = { x: [number, number]; y: [number, number] };

/** Fits every node in view, or the frame `around` picks from the graph's extent, then holds that
 *  frame so dragging a node to the edge does not rescale the rest. Resolves once the camera is
 *  there. */
export async function fit<A extends Attributes, E extends Attributes>(renderer: Sigma<A, E>, around?: (extent: BBox) => BBox) {
  renderer.setCustomBBox(null);
  renderer.refresh();
  const frame = around ? around(renderer.getBBox()) : null;
  if (frame) {
    renderer.setCustomBBox(frame);
    renderer.refresh();
  }
  const camera = renderer.getCamera();
  if (reducedMotion()) camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
  else await camera.animatedReset({ duration: 250 });
  renderer.setCustomBBox(frame ?? renderer.getBBox());
}

/** Reducers that focus the hovered node: it and its neighbours stay as they are, every other node
 *  takes `dim`, and only the hovered node's edges show. */
export function focusReducers<A extends BaseNodeAttrs, E extends Attributes>(
  graph: Graph<A, E>,
  hovered: () => string | null,
  dim: (attrs: A) => A,
): Pick<Settings<A, E>, "nodeReducer" | "edgeReducer"> {
  return {
    nodeReducer: (id, attrs) => {
      const h = hovered();
      if (!h || !graph.hasNode(h) || id === h || graph.areNeighbors(id, h)) {
        return id === h ? { ...attrs, highlighted: true, zIndex: 2 } : attrs;
      }
      return { ...dim(attrs), label: "", forceLabel: false, zIndex: 0 };
    },
    edgeReducer: (id, attrs) => {
      const h = hovered();
      if (!h || !graph.hasNode(h) || graph.hasExtremity(id, h)) return attrs;
      return { ...attrs, hidden: true };
    },
  };
}

type Box = { x: number; y: number; w: number; h: number };
type Disc = { x: number; y: number; r: number };

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Draws each label beside its node on the first side (right, left, below, above) where it covers
 *  no other node, no label drawn before it this frame and no edge of the stage; failing that, on
 *  the side that covers least. Forced labels always draw; any other label with no clear side is
 *  left out. A node's `detail` goes on a second line under its label. Labels get a halo in the
 *  canvas colour so edges never run through the text. */
export function labelPlacer<A extends BaseNodeAttrs, E extends Attributes>(
  renderer: Sigma<A, E>,
  colors: { label: string; gap: string; detail?: string },
): NodeLabelDrawingFunction<A, E> {
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
    // Sigma passes the node's key with its display data; the detail line is read off the graph.
    const key = "key" in data && typeof data.key === "string" ? data.key : null;
    const detail = key && renderer.getGraph().hasNode(key) ? renderer.getGraph().getNodeAttribute(key, "detail") : undefined;
    const labelFont = `${settings.labelWeight} ${LABEL_SIZE}px ${settings.labelFont}`;
    const detailFont = `400 ${DETAIL_SIZE}px ${settings.labelFont}`;
    ctx.font = labelFont;
    let w = ctx.measureText(data.label).width;
    if (detail) {
      ctx.font = detailFont;
      w = Math.max(w, ctx.measureText(detail).width);
    }
    const line = LABEL_SIZE + 2;
    const h = detail ? line + DETAIL_SIZE + 2 : line;
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
    const side = best >= 0 ? best : costs.indexOf(Math.min(...costs));
    const box = sides[side];
    placed.push(box);
    // Left of the node the lines align right, above and below they centre.
    ctx.textAlign = side === 1 ? "right" : side >= 2 ? "center" : "left";
    const x = side === 1 ? box.x + w : side >= 2 ? box.x + w / 2 : box.x;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.gap;
    const write = (text: string, font: string, color: string, baseline: number) => {
      ctx.font = font;
      ctx.strokeText(text, x, baseline);
      ctx.fillStyle = color;
      ctx.fillText(text, x, baseline);
    };
    write(data.label, labelFont, colors.label, box.y + line / 2 + LABEL_SIZE / 3);
    if (detail) write(detail, detailFont, colors.detail ?? colors.label, box.y + line + DETAIL_SIZE);
    ctx.textAlign = "left";
  };
}

/**
 * Hover, click and drag on a sigma stage. The dragged node follows the pointer while the simulation
 * stays warm, then floats free; the centre stays pinned, and with reduced motion a dropped node
 * stays where it was dropped. A press that moved more than a few pixels is a drag, so its release
 * does not open the node.
 */
export function bindPointer<A extends BaseNodeAttrs, E extends Attributes, N extends SimNode>(
  r: Sigma<A, E>,
  on: {
    sim: () => Sim<N> | null;
    center: () => string;
    hover: (id: string | null) => void;
    open: (id: string) => void;
    /** The node in hand, or null once released. */
    drag: (id: string | null) => void;
    /** A drag reheated the layout. */
    reheat: () => void;
  },
) {
  let dragged: string | null = null;
  let pressedAt: { x: number; y: number } | null = null;
  let moved = false;
  // The node under the pointer by sigma's account. The dragged node stays highlighted while
  // held, and the highlight catches up with this on release.
  let under: string | null = null;
  const simNode = (id: string) => on.sim()?.nodes().find((n) => n.id === id);
  r.on("enterNode", ({ node }) => {
    under = node;
    if (!dragged) on.hover(node);
  });
  r.on("leaveNode", () => {
    under = null;
    if (!dragged) on.hover(null);
  });
  r.on("clickNode", ({ node }) => {
    if (!moved) on.open(node);
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
      on.drag(dragged);
      if (!reducedMotion()) {
        on.reheat();
        on.sim()?.alphaTarget(DRAG_HEAT).restart();
      }
    }
    const p = r.viewportToGraph(event);
    n.fx = n.x = p.x;
    n.fy = n.y = p.y;
    if (reducedMotion()) r.getGraph().updateNodeAttributes(dragged, (a) => ({ ...a, x: p.x, y: p.y }));
  });
  const release = () => {
    if (!dragged) return;
    const n = simNode(dragged);
    if (n && dragged !== on.center() && !(moved && reducedMotion())) n.fx = n.fy = null;
    on.sim()?.alphaTarget(0);
    dragged = null;
    on.drag(null);
    on.hover(under);
  };
  r.on("upNode", release);
  r.on("upStage", release);
}

type Point = { x: number; y: number };
type Borders = NonNullable<Parameters<typeof createNodeBorderProgram>[0]>["borders"];

/** What a canvas gives `useSigmaStage`: how it colours, configures and lays out its graph. */
export type StageSpec<A extends BaseNodeAttrs, E extends Attributes, N extends SimNode, P extends { label: string; gap: string; detail?: string }, D> = {
  /** The data to lay out; the layout runs again whenever it changes, by identity. */
  data: D;
  hovered: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
  /** The colours, read from the stage's `--g-*` tokens once sigma has loaded. */
  palette: (el: HTMLElement) => P;
  /** The node border program's rings, outermost first, ending with the fill. */
  borders: (colors: P) => Borders;
  /** Settings beyond the shared font, labels, z-index and hover focus. */
  settings: (colors: P) => Partial<Settings<A, E>>;
  /** How a node looks while another is hovered. */
  dim: (attrs: A, colors: P) => A;
  /** Further wiring on the new renderer, such as overlays that follow nodes on every frame. */
  setup?: (
    renderer: Sigma<A, E>,
    stage: {
      colors: P;
      rendering: typeof SigmaRendering;
      sim: () => Sim<N> | null;
      center: () => string;
      hovered: () => string | null;
    },
  ) => void;
  /** Rebuilds the graph for `data` from the kept positions (which it may clear) and returns the
   *  simulation, the pinned centre and the frame `fit` takes. */
  layout: (
    graph: Graph<A, E>,
    data: D,
    positions: Map<string, Point>,
    colors: P,
  ) => { sim: Sim<N>; center: string; frame?: (extent: BBox) => BBox };
};

/**
 * A sigma stage over a d3-force layout. Loads sigma in the browser only (it touches WebGL), makes
 * one renderer per mount with the shared label placement, hover focus and pointer wiring, then
 * lays `data` out again whenever it changes, keeping nodes where they were, and refits the camera
 * once the new layout first settles. Spread `stage` on the stage element: its ref, `data-layout`
 * ("running" while nodes move, "settled" once they stop), `data-hovered` and `data-dragging`.
 */
export function useSigmaStage<
  A extends BaseNodeAttrs,
  E extends Attributes,
  N extends SimNode,
  P extends { label: string; gap: string; detail?: string },
  D,
>(spec: StageSpec<A, E, N, P, D>) {
  const { data, hovered } = spec;
  const el = useRef<HTMLDivElement>(null);
  const graph = useRef(new Graph<A, E>());
  const sim = useRef<Sim<N> | null>(null);
  const center = useRef("");
  const positions = useRef(new Map<string, Point>());
  const palette = useRef<P | null>(null);
  const hoveredRef = useRef(hovered);
  // The latest spec, for the renderer's callbacks and the layout.
  const latest = useRef(spec);
  const [renderer, setRenderer] = useState<Sigma<A, E> | null>(null);
  // The data whose layout has settled and been framed; new data reads as running until then.
  const [settledFor, setSettledFor] = useState<D | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // A drag reheated the layout, so nodes are moving until it cools again.
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    latest.current = spec;
  });

  useEffect(() => {
    let made: Sigma<A, E> | null = null;
    let cancelled = false;
    void (async () => {
      const [{ default: SigmaClass }, { createNodeBorderProgram }, rendering] = await Promise.all([
        import("sigma"),
        import("@sigma/node-border"),
        import("sigma/rendering"),
      ]);
      if (cancelled || !el.current) return;
      const s = latest.current;
      const colors = s.palette(el.current);
      palette.current = colors;
      const bordered = createNodeBorderProgram<A, E>({ borders: s.borders(colors) });
      const r: Sigma<A, E> = new SigmaClass(graph.current, el.current, {
        defaultNodeType: "bordered",
        nodeProgramClasses: { bordered },
        labelFont: FONT,
        labelSize: LABEL_SIZE,
        labelWeight: "500",
        labelColor: { color: colors.label },
        zIndex: true,
        ...s.settings(colors),
        ...focusReducers(graph.current, () => hoveredRef.current, (attrs) => latest.current.dim(attrs, colors)),
      });
      made = r;
      r.setSetting("defaultDrawNodeLabel", labelPlacer(r, colors));
      s.setup?.(r, {
        colors,
        rendering,
        sim: () => sim.current,
        center: () => center.current,
        hovered: () => hoveredRef.current,
      });
      bindPointer(r, {
        sim: () => sim.current,
        center: () => center.current,
        hover: (id) => latest.current.onHover(id),
        open: (id) => latest.current.onOpen(id),
        drag: setDragging,
        reheat: () => setFloating(true),
      });
      setRenderer(r);
    })();
    return () => {
      cancelled = true;
      made?.kill();
    };
  }, []);

  useEffect(() => {
    if (!renderer || !palette.current) return;
    const g = graph.current;
    g.forEachNode((id, a) => positions.current.set(id, { x: a.x, y: a.y }));
    const laid = latest.current.layout(g, data, positions.current, palette.current);
    center.current = laid.center;
    renderer.setCustomBBox(null);
    const s = laid.sim;
    sim.current = s;
    let live = true;
    let framed = false;
    settle(g, s, !reducedMotion(), () => {
      setFloating(false);
      if (framed) return;
      framed = true;
      void fit(renderer, laid.frame).then(() => live && setSettledFor(data));
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

  return {
    renderer,
    stage: {
      ref: el,
      "data-layout": settledFor === data && !floating ? ("settled" as const) : ("running" as const),
      "data-hovered": hovered ?? undefined,
      "data-dragging": dragging ?? undefined,
    },
  };
}
