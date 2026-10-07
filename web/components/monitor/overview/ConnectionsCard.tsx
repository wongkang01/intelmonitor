// The Connections card on a monitor's Overview: a small static ego graph of the subject from its
// links. An entity shows its groups above it, its peers (the other members of those groups) beside
// or below it and its topics below; a group its topics above and members below; a topic its groups. Each node opens that
// subject's monitor. "Open" leads to the Connections tab, or the full graph for a topic, which
// has no Connections tab.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { monitorLink } from "@/lib/widgets";
import { SubjectLinks } from "@/components/shell/SubjectLink";

import { Section } from "../parts";

type Subject = Schema<"SubjectDetail">;
type Ref = Schema<"SubjectRef">;
type Kind = "group" | "peer" | "topic";
type Node = { ref: Ref; kind: Kind };

// The graph's coordinate space; it scales to the card's width.
const W = 320;
const ROW = 36;
const CHAR = 5.6;
const NODE_PAD = 14;

/** A node's label, cut with an ellipsis to fit `room` units, and its box width. */
function fit(name: string, room: number): { label: string; w: number } {
  const chars = Math.floor((room - NODE_PAD) / CHAR);
  const label = name.length > chars ? `${name.slice(0, chars - 1).trimEnd()}…` : name;
  return { label, w: label.length * CHAR + NODE_PAD };
}

/** Rows of nodes under one kind: as many to a row as fit whole in equal slots. */
function chunk(refs: Ref[], kind: Kind): Node[][] {
  const rows: Node[][] = [];
  let row: Node[] = [];
  for (const ref of refs) {
    const next = [...row, { ref, kind }];
    const fits = next.every((n) => fit(n.ref.name, Infinity).w <= W / next.length - 8);
    if (fits || row.length === 0) row = next;
    else {
      rows.push(row);
      row = [{ ref, kind }];
    }
  }
  if (row.length > 0) rows.push(row);
  return rows;
}

export function ConnectionsCard({ subject }: { subject: Subject }) {
  const peers = usePeers(subject) ?? [];
  const { groups, entities, topics } = subject.links;
  // Topics sit above a group, so no edge to them crosses its rows of members.
  const above = subject.type === "entity" ? chunk(groups, "group") : subject.type === "group" ? chunk(topics, "topic") : [];
  const members = subject.type === "entity" ? peers : subject.type === "group" ? entities : [];
  // One or two peers or members sit either side of the subject; more take rows below it.
  const beside = members.length <= 2 ? members.map((ref) => ({ ref, kind: "peer" as const })) : [];
  const below =
    subject.type === "topic"
      ? chunk(groups, "group")
      : [...(beside.length > 0 ? [] : chunk(members, "peer")), ...(subject.type === "entity" ? chunk(topics, "topic") : [])];
  const open =
    subject.type === "topic" ? (
      <Link to="/monitors/$id/graph" params={{ id: subject.id }} className="link">
        Open graph
      </Link>
    ) : (
      <Link to="/monitors/$id/connections" params={{ id: subject.id }} className="link">
        Open
      </Link>
    );
  return (
    <div className="panel ov-card">
      <Section id="connections" title="Connections" meta={open}>
        {above.length + beside.length + below.length === 0 ? (
          <p className="mon-empty">No linked subjects.</p>
        ) : (
          <EgoGraph subject={subject} above={above} beside={beside} below={below} />
        )}
        {/* Topics have no Connections tab, so the entities they cover are listed here. */}
        {subject.type === "topic" && entities.length > 0 && (
          <p className="ov-related">
            <span className="meta">Entities </span>
            <SubjectLinks subjects={entities} />
          </p>
        )}
      </Section>
    </div>
  );
}

function EgoGraph({ subject, above, beside, below }: { subject: Subject; above: Node[][]; beside: Node[]; below: Node[][] }) {
  const rows = above.length + 1 + below.length;
  const H = rows * ROW + 8;
  const y = (row: number) => 4 + row * ROW + ROW / 2;
  const cy = y(above.length);
  const placed = [...above, null, ...below].flatMap((row, r) =>
    row
      ? row.map((n, i) => {
          const slot = W / row.length;
          return { ...n, ...fit(n.ref.name, slot - 8), x: slot * (i + 0.5), y: y(r) };
        })
      : [],
  );
  const centerW = Math.min(subject.name.length * 6.6 + 20, beside.length > 0 ? W / 3 : W - 40);
  // Side nodes share the subject's row, a third of the width each.
  placed.push(
    ...beside.map((n, i) => ({ ...n, ...fit(n.ref.name, W / 3 - 16), x: i === 0 ? W / 6 : (W * 5) / 6, y: cy })),
  );
  const names = placed.map((n) => n.ref.name).join(", ");
  return (
    <svg className="ego" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${subject.name}, linked to ${names}`}>
      {placed.map((n) => (
        <line key={n.ref.id} x1={W / 2} y1={cy} x2={n.x} y2={n.y} className="ego-edge" />
      ))}
      {placed.map((n) => (
        <Link key={n.ref.id} {...monitorLink(n.ref.id)} className={`ego-node ${n.kind}`} aria-label={n.ref.name}>
          <title>{n.ref.name}</title>
          <rect x={n.x - n.w / 2} y={n.y - 10} width={n.w} height={20} rx={5} />
          <text x={n.x} y={n.y + 3.5} textAnchor="middle">
            {n.label}
          </text>
        </Link>
      ))}
      <g className="ego-center">
        <rect x={W / 2 - centerW / 2} y={cy - 12} width={centerW} height={24} rx={6} />
        <text x={W / 2} y={cy + 4} textAnchor="middle">
          {subject.name}
        </text>
      </g>
    </svg>
  );
}
