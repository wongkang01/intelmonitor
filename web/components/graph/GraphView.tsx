"use client";

// Graph view around one subject: opens at 1 hop, expands to 2, with filters for node type, link
// type and time window. Clicking a subject node opens its monitor page; clicking a development
// opens its evidence over the graph. The side list shows the same nodes as links.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useGraph, type GraphQuery } from "@/lib/api/queries";
import { plural, TYPE_LABEL } from "@/lib/format";
import { monitorHref } from "@/lib/widgets";
import { useEvidenceHref } from "@/components/shell/Evidence";

import { GraphCanvas, NODE_COLOR } from "./GraphCanvas";

type GraphNode = Schema<"GraphNode">;
type NodeType = GraphNode["type"];
type LinkType = Schema<"GraphEdge">["type"];

const NODE_TYPES: { type: NodeType; label: string }[] = [
  { type: "topic", label: "Topics" },
  { type: "group", label: "Groups" },
  { type: "entity", label: "Entities" },
  { type: "development", label: "Developments" },
];
const LINK_TYPES: { type: LinkType; label: string }[] = [
  { type: "MEMBER_OF", label: "Member of" },
  { type: "EXPOSED_TO", label: "Exposed to" },
  { type: "AFFECTS", label: "Affects" },
];
const WINDOWS = [7, 14, 30] as const;

const DEV_PREFIX = "dev:";

/** Toggles `item` in `list`, never leaving it empty (the API reads an empty filter as "all"). */
function toggle<T>(list: T[], item: T): T[] {
  if (!list.includes(item)) return [...list, item];
  return list.length > 1 ? list.filter((x) => x !== item) : list;
}

export function GraphView({ id }: { id: string }) {
  const router = useRouter();
  const evidence = useEvidenceHref();
  const [hops, setHops] = useState<1 | 2>(1);
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>(NODE_TYPES.map((t) => t.type));
  const [linkTypes, setLinkTypes] = useState<LinkType[]>(LINK_TYPES.map((t) => t.type));
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

  const hrefOf = useCallback(
    (nodeId: string) =>
      nodeId.startsWith(DEV_PREFIX) ? evidence.development(nodeId.slice(DEV_PREFIX.length)) : monitorHref(nodeId),
    [evidence],
  );
  const open = useCallback((nodeId: string) => router.push(hrefOf(nodeId), { scroll: false }), [router, hrefOf]);

  if (graph.isError) return <p className="page-message">This graph could not be loaded.</p>;
  if (!g) return null;
  const center = g.nodes.find((n) => n.id === g.center);
  const newCount = g.nodes.filter((n) => n.has_new && n.id !== g.center).length;

  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>{center?.label ?? id}</h1>
          <p>
            Graph view.{" "}
            <Link href={monitorHref(id)} className="subject-link">
              Open monitor page
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
          <div className="filter" role="group" aria-label="Node types">
            {NODE_TYPES.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                className="fchip"
                aria-pressed={nodeTypes.includes(type)}
                onClick={() => setNodeTypes((list) => toggle(list, type))}
              >
                <span className="dot" style={{ background: NODE_COLOR[type] }} />
                {label}
              </button>
            ))}
          </div>
          <div className="filter" role="group" aria-label="Link types">
            {LINK_TYPES.map(({ type, label }) => (
              <button
                key={type}
                type="button"
                className="fchip"
                aria-pressed={linkTypes.includes(type)}
                onClick={() => setLinkTypes((list) => toggle(list, type))}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="window">
            <span className="cap">Developments from</span>
            <select
              value={windowDays ?? ""}
              onChange={(e) => setWindowDays(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">All time</option>
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  Last {d} days
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="graph-main">
          <section className="panel graph-panel" aria-label="Graph">
            <GraphCanvas data={g} hovered={hovered} onHover={setHovered} onOpen={open} />
            <p className="graph-legend cap">
              <span className="ring" aria-hidden="true" /> New or updated this run
              {g.truncated_developments > 0 && (
                <span> · {plural(g.truncated_developments, "lower-priority development")} not shown</span>
              )}
            </p>
          </section>
          <NodeList
            nodes={g.nodes.filter((n) => n.id !== g.center)}
            newCount={newCount}
            hrefOf={hrefOf}
            onHover={setHovered}
          />
        </div>
      </div>
    </>
  );
}

const ORDER: Record<NodeType, number> = { topic: 0, group: 1, entity: 2, development: 3 };

function NodeList({
  nodes,
  newCount,
  hrefOf,
  onHover,
}: {
  nodes: GraphNode[];
  newCount: number;
  hrefOf: (id: string) => string;
  onHover: (id: string | null) => void;
}) {
  const sorted = [...nodes].sort(
    (a, b) =>
      a.hop - b.hop ||
      ORDER[a.type] - ORDER[b.type] ||
      Number(b.has_new) - Number(a.has_new) ||
      Number(b.needs_attention) - Number(a.needs_attention) ||
      a.label.localeCompare(b.label),
  );
  return (
    <section className="panel graph-list" aria-labelledby="in-view">
      <div className="panel-head">
        <h2 id="in-view">In view</h2>
        <span className="cap">
          {plural(nodes.length, "node")}, {newCount} new
        </span>
      </div>
      <div className="rows scroll" data-testid="graph-nodes">
        {sorted.map((n) => (
          <Link
            key={n.id}
            href={hrefOf(n.id)}
            scroll={false}
            className="row"
            data-node={n.id}
            onMouseEnter={() => onHover(n.id)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(n.id)}
            onBlur={() => onHover(null)}
          >
            <span className="dot" style={{ background: NODE_COLOR[n.type] }} />
            <span className="tx">
              <b title={n.label}>{n.label}</b>
              <span>
                {n.type === "development" ? "Development" : TYPE_LABEL[n.type]}, {plural(n.hop, "hop")}
              </span>
            </span>
            {(n.needs_attention || n.has_new) && (
              <span className="badges">
                {n.has_new && <span className="badge b-new">New</span>}
                {n.needs_attention && <span className="badge b-attn">Needs attention</span>}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
