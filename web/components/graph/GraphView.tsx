// Graph view around one subject: opens at 1 hop, expands to 2, with filters for node type, link
// type and time window. Clicking a subject node opens its monitor page; clicking a development
// opens its evidence over the graph. Developments are coloured and grouped by theme. The In view
// list shows the same nodes as links. The full page (/monitors/$id/graph) has its own head;
// `embedded` drops it and sizes the region to a monitor tab.
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useGraph, type GraphQuery } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import { evidenceLink } from "@/components/shell/Evidence";
import { ChevronDownIcon } from "@/components/ui/icons";

import { GraphCanvas, THEME_LABEL, THEMES } from "./GraphCanvas";

type GraphNode = Schema<"GraphNode">;
type NodeType = GraphNode["type"];
type LinkType = Schema<"GraphEdge">["type"];

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: "topic", label: "Topics" },
  { value: "group", label: "Groups" },
  { value: "entity", label: "Entities" },
  { value: "development", label: "Developments" },
];
const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: "MEMBER_OF", label: "Member of" },
  { value: "EXPOSED_TO", label: "Exposed to" },
  { value: "AFFECTS", label: "Affects" },
];
const WINDOWS: { days: number | null; label: string }[] = [
  { days: null, label: "All time" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const DEV_PREFIX = "dev:";

/** Toggles `item` in `list`, never leaving it empty (the API reads an empty filter as "all"). */
function toggle<T>(list: T[], item: T): T[] {
  if (!list.includes(item)) return [...list, item];
  return list.length > 1 ? list.filter((x) => x !== item) : list;
}

export function GraphView({ id, embedded = false }: { id: string; embedded?: boolean }) {
  const navigate = useNavigate();
  const [hops, setHops] = useState<1 | 2>(1);
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>(NODE_TYPES.map((t) => t.value));
  const [linkTypes, setLinkTypes] = useState<LinkType[]>(LINK_TYPES.map((t) => t.value));
  const [windowDays, setWindowDays] = useState<number | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const query: GraphQuery = {
    center: id,
    hops,
    node_type: nodeTypes,
    link_type: linkTypes,
    window_days: windowDays,
  };
  const graph = useGraph(query);
  const g = graph.data;

  const open = useCallback((nodeId: string) => void navigate(linkOf(nodeId)), [navigate]);

  if (graph.isError) return <p className="page-message">This graph could not be loaded.</p>;
  // Embedded, an empty region holds the tab's height while the graph loads.
  if (!g) return embedded ? <div className="graph-page embedded" aria-busy="true" /> : null;
  const center = g.nodes.find((n) => n.id === g.center);

  return (
    <>
      {!embedded && (
        <div className="pagehead">
          <div className="grow">
            <h1>{center?.label ?? id}</h1>
            <p>
              Graph view.{" "}
              <Link {...monitorLink(id)} className="subject-link">
                Open monitor page
              </Link>
            </p>
          </div>
        </div>
      )}
      <div className={embedded ? "graph-page embedded" : "graph-page"}>
        <div className="graph-bar" role="group" aria-label="Graph filters">
          <div className="seg" role="group" aria-label="Hops">
            {([1, 2] as const).map((h) => (
              <button key={h} type="button" aria-pressed={hops === h} onClick={() => setHops(h)}>
                {plural(h, "hop")}
              </button>
            ))}
          </div>
          <FilterMenu
            name="Nodes"
            options={NODE_TYPES}
            selected={nodeTypes}
            onToggle={(t) => setNodeTypes((list) => toggle(list, t))}
            dot
          />
          <FilterMenu
            name="Links"
            options={LINK_TYPES}
            selected={linkTypes}
            onToggle={(t) => setLinkTypes((list) => toggle(list, t))}
          />
          <div className="seg" role="group" aria-label="Developments from">
            {WINDOWS.map(({ days, label }) => (
              <button key={label} type="button" aria-pressed={windowDays === days} onClick={() => setWindowDays(days)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="graph-region">
          <GraphCanvas data={g} hovered={hovered} onHover={setHovered} onOpen={open} embedded={embedded}>
            <ul className="graph-legend" aria-label="Legend">
              {/* Themed developments are labelled beside their sectors, so only other types are listed. */}
              {NODE_TYPES.filter((t) => g.nodes.some((n) => n.type === t.value && !n.theme)).map((t) => (
                <li key={t.value}>
                  <span className={`gdot ${t.value}`} aria-hidden="true" />
                  {t.label}
                </li>
              ))}
              <li>
                <span className="gdot ring" aria-hidden="true" />
                New or updated this run
              </li>
              {g.truncated_developments > 0 && (
                <li>{plural(g.truncated_developments, "lower-priority development")} not shown</li>
              )}
            </ul>
          </GraphCanvas>
          <NodeList nodes={g.nodes.filter((n) => n.id !== g.center)} onHover={setHovered} />
        </div>
      </div>
    </>
  );
}

/** A bordered select-style button ("Nodes: All") opening a checklist; closes on Escape or outside click. */
function FilterMenu<T extends string>({
  name,
  options,
  selected,
  onToggle,
  dot = false,
}: {
  name: string;
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (value: T) => void;
  /** Show each option's graph color dot (node types). */
  dot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary =
    chosen.length === options.length
      ? "All"
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(", ")
        : `${chosen.length} of ${options.length}`;

  return (
    <div className="gmenu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="gsel"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="gsel-name">{name}:</span> {summary}
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="gmenu-pop" id={menuId} role="group" aria-label={`${name} shown`}>
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <label key={o.value} className="gmenu-item">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && selected.length === 1}
                  onChange={() => onToggle(o.value)}
                />
                {dot && <span className={`gdot ${o.value}`} aria-hidden="true" />}
                {o.label}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ORDER: Record<NodeType, number> = { topic: 0, group: 1, entity: 2, development: 3 };
const GROUP_LABEL: Record<NodeType, string> = {
  topic: "Topics",
  group: "Groups",
  entity: "Entities",
  development: "Developments",
};

/** A node's link: a development opens the evidence drawer over the graph, a subject its monitor page. */
const linkOf = (nodeId: string) =>
  nodeId.startsWith(DEV_PREFIX)
    ? evidenceLink.development(nodeId.slice(DEV_PREFIX.length))
    : { ...monitorLink(nodeId), resetScroll: false };

/** The group a node is listed under: its type, or for a development its theme when it has one. */
const groupOf = (n: GraphNode) => n.theme ?? n.type;
const groupRank = (n: GraphNode) => ORDER[n.type] + (n.theme ? THEMES.indexOf(n.theme) / THEMES.length : 0);

/** The In view list: nodes grouped by hop, then type or theme, in the shared row grammar. No date
 *  column: at 360px it would squeeze titles below 150px. */
function NodeList({
  nodes,
  onHover,
}: {
  nodes: GraphNode[];
  onHover: (id: string | null) => void;
}) {
  const sorted = [...nodes].sort(
    (a, b) =>
      a.hop - b.hop ||
      groupRank(a) - groupRank(b) ||
      Number(b.needs_attention) - Number(a.needs_attention) ||
      Number(b.has_new) - Number(a.has_new) ||
      a.label.localeCompare(b.label),
  );
  const newCount = nodes.filter((n) => n.has_new).length;
  const groupSize = (n: GraphNode) => nodes.filter((m) => m.hop === n.hop && groupOf(m) === groupOf(n)).length;
  return (
    <section className="graph-list" aria-labelledby="in-view">
      <div className="graph-list-head">
        <h2 id="in-view">In view</h2>
        <span className="row-end">
          {plural(nodes.length, "node")}, {newCount} new
        </span>
      </div>
      <div className="graph-list-body" data-testid="graph-nodes">
        {sorted.map((n, i) => {
          const prev = sorted[i - 1];
          const startsGroup = !prev || prev.hop !== n.hop || groupOf(prev) !== groupOf(n);
          return (
            <Fragment key={n.id}>
              {startsGroup && (
                <h3 className="graph-group">
                  <span className={`gdot ${n.theme ? `t-${n.theme}` : n.type}`} aria-hidden="true" />
                  {n.theme ? THEME_LABEL[n.theme] : GROUP_LABEL[n.type]}, {plural(n.hop, "hop")}
                  <span className="count">{groupSize(n)}</span>
                </h3>
              )}
              <Link
                {...linkOf(n.id)}
                className="row no-stat"
                data-node={n.id}
                onMouseEnter={() => onHover(n.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(n.id)}
                onBlur={() => onHover(null)}
              >
                <span>
                  <span className="row-title" title={n.label}>
                    {n.has_new && (
                      <>
                        <span className="new-dot" aria-hidden="true" />
                        <span className="sr-only">New: </span>
                      </>
                    )}
                    {n.label}
                  </span>
                  {n.needs_attention && (
                    <span className="row-meta">
                      <span className="badge b-attn">Needs attention</span>
                    </span>
                  )}
                </span>
              </Link>
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
