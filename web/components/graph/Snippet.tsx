// A small piece of the relationship graph that backs one claim: the news on the left, the thing it
// is about, any company in between, and the tracked entities it reaches on the right, each edge
// labelled with its link in plain words. Columns run from the news outward; an entity reached in
// one step still sits in the last column, so every entity lines up on the right.
import type { Schema } from "@/lib/api/client";

type Link = Schema<"RelationshipLink">;

/** One route: the entity it reaches and its stored links, from the entity outward. */
export type SnippetPath = { entityId: string; entityName: string; links: Link[] };

const ROW = 40;
const NODE_H = 24;
const PAD_X = 8;
const CHAR_W = 6.8; // 12px system font at 500, average
const BOLD_CHAR_W = 7.6;
const LABEL_CHAR_W = 6;
const MIN_GAP = 56;

const pct = (w: number) => `${(w * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** A link as an edge label, read from the news toward the entity. */
export function edgeLabel(l: Link): string {
  switch (l.type) {
    case "exposed_to":
      // The label ends with the share: "lends to, 12.2% of loans", "holds reserves in, 84.9% of reserves".
      if (l.weight !== null) return l.label.split(", ").at(-1) ?? "";
      return l.label.startsWith("lends") ? "lends there" : l.label.split(",")[0];
    case "depends_on":
      return l.label.includes(", for ") ? l.label.split(", for ")[1] : "supplier";
    case "participates_in":
      return "takes part";
    case "owns":
      return l.weight === null ? "owned" : `${pct(l.weight)} owned`;
    case "subsidiary_of":
      return "parent";
    default:
      return l.label.split(",")[0];
  }
}

type Node = { id: string; name: string; col: number; y: number; kind: "dev" | "mid" | "ent" };
type Edge = { from: string; to: string; label: string };

export function Snippet({ paths, source = "This news", label }: { paths: SnippetPath[]; source?: string; label: string }) {
  const depth = Math.max(1, ...paths.map((p) => p.links.length));
  const last = depth + 1;
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const rows = new Map<string, number>();

  const add = (id: string, name: string, col: number, kind: Node["kind"]) => {
    if (!nodes.has(id)) nodes.set(id, { id, name, col, y: 0, kind });
  };
  add("dev", source, 0, "dev");
  // Walk each route from the entity outward: each link's other end is the next node.
  const chains = paths.map((p) => {
    const chain = [{ id: p.entityId, name: p.entityName }];
    for (const l of p.links) {
      const here = chain.at(-1)!.id;
      chain.push(l.from_id === here ? { id: l.to_id, name: l.to_name } : { id: l.from_id, name: l.from_name });
    }
    return { p, chain };
  });
  // Routes to the same thing sit in adjacent rows, so the nodes in between never overlap. An entity
  // reached by two routes gets a row for each.
  chains.sort((a, b) => a.chain.at(-1)!.id.localeCompare(b.chain.at(-1)!.id));
  for (const { p, chain } of chains) {
    if (rows.has(chain[0].id)) chain[0] = { ...chain[0], id: `${chain[0].id}#${rows.size}` };
    rows.set(chain[0].id, rows.size);
    const k = p.links.length;
    chain.forEach((n, j) => add(n.id, n.name, j === 0 ? last : 1 + (k - j), j === 0 ? "ent" : "mid"));
    p.links.forEach((l, j) => edges.push({ from: chain[j + 1].id, to: chain[j].id, label: edgeLabel(l) }));
    edges.push({ from: "dev", to: chain[k].id, label: "about" });
  }
  // Entities take one row each; every other node sits at the middle of what it leads to.
  for (const n of nodes.values()) if (n.kind === "ent") n.y = (rows.get(n.id) ?? 0) * ROW;
  for (let col = last - 1; col >= 0; col--) {
    for (const n of nodes.values()) {
      if (n.col !== col) continue;
      const ys = edges.filter((e) => e.from === n.id).map((e) => nodes.get(e.to)!.y);
      n.y = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
    }
  }
  const unique = edges.filter((e, i) => edges.findIndex((x) => x.from === e.from && x.to === e.to) === i);

  // Entity names are set in 600, a little wider.
  const width = (n: Node) => Math.ceil(n.name.length * (n.kind === "ent" ? BOLD_CHAR_W : CHAR_W)) + 2 * PAD_X;
  const colW = Array.from({ length: last + 1 }, (_, c) => Math.max(0, ...[...nodes.values()].filter((n) => n.col === c).map(width)));
  // The gap before a column fits the labels of the edges that end in it.
  const gapW = colW.map((_, c) =>
    Math.max(MIN_GAP, ...unique.filter((e) => nodes.get(e.to)!.col === c).map((e) => e.label.length * LABEL_CHAR_W + 24)),
  );
  const colX: number[] = [];
  let x = 0;
  for (let c = 0; c <= last; c++) {
    if (c > 0) x += gapW[c];
    colX.push(x);
    x += colW[c];
  }
  const totalW = x + 1;
  const totalH = (rows.size - 1) * ROW + NODE_H + 20;
  const top = 16; // room for the first row's edge label

  const left = (n: Node) => colX[n.col] + (n.kind === "ent" ? 0 : colW[n.col] - width(n));
  const midY = (n: Node) => top + n.y + NODE_H / 2;

  return (
    <svg className="snippet" viewBox={`0 0 ${totalW} ${totalH}`} role="img" aria-label={label} style={{ maxWidth: totalW }}>
      {unique.map((e) => {
        const a = nodes.get(e.from)!;
        const b = nodes.get(e.to)!;
        const x1 = left(a) + width(a);
        const x2 = left(b);
        const bend = x1 + 12;
        const d = `M${x1} ${midY(a)}H${bend}V${midY(b)}H${x2}`;
        return (
          <g key={`${e.from}-${e.to}`}>
            <path className="e" d={d} />
            <text className="l" x={(bend + x2) / 2} y={midY(b) - 6} textAnchor="middle">
              {e.label}
            </text>
          </g>
        );
      })}
      {[...nodes.values()].map((n) => (
        <g key={n.id}>
          <rect className={`n ${n.kind}`} x={left(n) + 0.5} y={top + n.y + 0.5} width={width(n) - 1} height={NODE_H - 1} rx={6} />
          <text className={`t${n.kind === "ent" ? " b" : ""}`} x={left(n) + width(n) / 2} y={top + n.y + 16} textAnchor="middle">
            {n.name}
          </text>
        </g>
      ))}
    </svg>
  );
}
