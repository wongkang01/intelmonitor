// Graph view around one subject: opens at 1 hop, expands to 2, with filters for node type, link
// type and time window. Clicking a subject node opens its monitor page; clicking a development
// opens its popup over the graph. Developments are coloured and grouped by theme. The In view
// list shows the same nodes as links. The page (/monitors/$id/graph) is reachable by URL only, for
// the TCRD session (prd.md section 12).
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useGraph, type GraphQuery } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import { evidenceLink } from "@/components/shell/Evidence";
import { PriorityBadge } from "@/components/developments/labels";

import { FilterMenu, toggle } from "./FilterMenu";
import { GraphCanvas, THEME_LABEL, THEMES } from "./GraphCanvas";
import { LINK_LABEL, type RelType } from "./labels";

type GraphNode = Schema<"GraphNode">;
type NodeType = GraphNode["type"];
type LinkType = Schema<"GraphEdge">["type"];

const NODE_TYPES: { value: NodeType; label: string }[] = [
  { value: "topic", label: "Topics" },
  { value: "group", label: "Groups" },
  { value: "entity", label: "Entities" },
  { value: "endpoint", label: "Linked parties" },
  { value: "development", label: "Developments" },
];
const LINK_TYPES: { value: LinkType; label: string }[] = [
  { value: "AFFECTS", label: "Affects directly" },
  { value: "IMPACTS", label: "Affects indirectly" },
  ...(Object.keys(LINK_LABEL) as RelType[]).map((t) => ({ value: t.toUpperCase() as Uppercase<RelType>, label: LINK_LABEL[t] })),
];
const WINDOWS: { days: number | null; label: string }[] = [
  { days: null, label: "All time" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];

const DEV_PREFIX = "dev:";

export function GraphView({ id }: { id: string }) {
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
  if (!g) return null;
  const center = g.nodes.find((n) => n.id === g.center);

  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>{center?.label ?? id}</h1>
          <p>
            Graph view.{" "}
            <Link {...monitorLink(id)} className="subject-link">
              Open page
            </Link>
          </p>
        </div>
      </div>
      <div className="graph-page">
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
          <GraphCanvas data={g} hovered={hovered} onHover={setHovered} onOpen={open}>
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

const ORDER: Record<NodeType, number> = { topic: 0, group: 1, entity: 2, endpoint: 3, development: 4 };
const GROUP_LABEL: Record<NodeType, string> = {
  topic: "Topics",
  group: "Groups",
  entity: "Entities",
  endpoint: "Linked parties",
  development: "Developments",
};

/** A node's link: a development opens its popup over the graph, a subject its monitor page. */
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
                      <PriorityBadge priority="High" />
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
