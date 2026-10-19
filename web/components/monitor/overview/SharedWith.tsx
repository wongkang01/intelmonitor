// "Shared with" on a bank's Overview: pick a peer and see what links both in the relationship
// store (GET /shared). A claim written here from the links heads a ladder: the bank's link on the
// left, the thing both are linked to in the middle, the peer's link on the right, and each side's
// source under it. Suppliers come first, then payment systems and markets, then lending where both
// disclose a share, then everything else.
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { useShared } from "@/lib/api/queries";
import { longDate } from "@/lib/format";
import { names } from "@/components/developments/labels";
import { SubjectLink } from "@/components/shell/SubjectLink";

type Subject = Schema<"SubjectDetail">;
type Endpoint = Schema<"SharedEndpoint">;
type Link = Schema<"RelationshipLink">;

// Rows before "Show N more".
const SHOWN = 6;

const pct = (w: number) => `${(w * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** One side's links to the shared thing, in a few words: "uses for cloud services", "44.4% of loans",
 * "13.1% of reserves" (an exposure's label ends with its share). */
function sideLabel(links: Link[]): string {
  return links
    .map((l) => {
      switch (l.type) {
        case "exposed_to":
          return l.weight === null ? "share not disclosed" : l.label.split(", ").at(-1);
        case "depends_on":
          return l.label.replace("depends on, for", "uses for").replace("depends on", "uses");
        case "participates_in":
          return "takes part";
        case "owns":
          return l.weight === null ? "owns part" : `owns ${pct(l.weight)}`;
        default:
          return l.label.split(",")[0];
      }
    })
    .join(", ");
}

type Kind = "suppliers" | "systems" | "lending" | "other";

const KIND_TITLE: Record<Kind, string> = {
  suppliers: "Suppliers",
  systems: "Payment systems and markets",
  lending: "Exposures",
  other: "Other links",
};

const has = (e: Endpoint, type: Link["type"]) => [...e.a_links, ...e.b_links].some((l) => l.type === type);

/** Which group a shared thing sits in, or null for lending where a side discloses no share. */
function kindOf(e: Endpoint): Kind | null {
  if (has(e, "depends_on")) return "suppliers";
  if (has(e, "participates_in") || e.kind === "payment_system") return "systems";
  if (has(e, "exposed_to")) {
    const weighted = (links: Link[]) => links.some((l) => l.type === "exposed_to" && l.weight !== null);
    return weighted(e.a_links) && weighted(e.b_links) ? "lending" : null;
  }
  return "other";
}

export function SharedWith({ subject }: { subject: Subject }) {
  const peers = usePeers(subject) ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const peer = peers.find((p) => p.id === picked) ?? peers[0] ?? null;
  const shared = useShared(subject.id, peer?.id ?? null);
  const [all, setAll] = useState(false);
  if (!peer) return null;
  const order: Kind[] = ["suppliers", "systems", "lending", "other"];
  const rows = (shared.data?.endpoints ?? [])
    .map((e) => ({ e, kind: kindOf(e) }))
    .filter((r): r is { e: Endpoint; kind: Kind } => r.kind !== null)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const shown = all ? rows : rows.slice(0, SHOWN);
  const claim = [
    rows.some((r) => r.kind === "suppliers") && `Both use ${names(rows.filter((r) => r.kind === "suppliers").map((r) => r.e.name))}.`,
    rows.some((r) => has(r.e, "participates_in")) &&
      `Both take part in ${names(rows.filter((r) => has(r.e, "participates_in")).map((r) => r.e.name))}.`,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="panel ov-card">
      <section className="mon-sec" aria-labelledby="shared">
        <div className="mon-sec-head">
          <h2 id="shared">Shared with</h2>
          <select
            className="input sw-pick"
            aria-label="Peer"
            value={peer.id}
            onChange={(e) => {
              setPicked(e.target.value);
              setAll(false);
            }}
          >
            {peers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {shared.data && rows.length > 0 && <span className="meta">{rows.length} links in common</span>}
        </div>
        {shared.isError ? (
          <p className="mon-empty">These links could not be loaded.</p>
        ) : !shared.data ? null : rows.length === 0 ? (
          <p className="mon-empty">
            {subject.name} and {peer.name} share no stored links.
          </p>
        ) : (
          <>
            {claim && <p className="claim sw-claim">{claim}</p>}
            <div className="sw-ladder">
              <div className="sw-cols meta" aria-hidden="true">
                <span>{subject.name}</span>
                <span>Both linked to</span>
                <span>{peer.name}</span>
              </div>
              {shown.map((r, n) => (
                <Rung key={r.e.id} endpoint={r.e} a={subject.name} b={peer.name} head={n === 0 || shown[n - 1].kind !== r.kind ? KIND_TITLE[r.kind] : null} />
              ))}
            </div>
            {rows.length > shown.length && (
              <button type="button" className="btn btn-sm ca-more" onClick={() => setAll(true)}>
                Show {rows.length - shown.length} more
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** One shared thing: each side's link, the thing between them, and the sources under it. */
function Rung({ endpoint: e, a, b, head }: { endpoint: Endpoint; a: string; b: string; head: string | null }) {
  const ref = { id: e.id, name: e.name, type: "entity" as const, kind: null };
  return (
    <>
      {head && <h3 className="sw-head">{head}</h3>}
      <div className="sw-rung">
        <span className="sw-a">{sideLabel(e.a_links)}</span>
        <span className="sw-mid">{e.subject ? <SubjectLink subject={ref} /> : e.name}</span>
        <span className="sw-b">{sideLabel(e.b_links)}</span>
        <p className="meta sw-src">
          <Sources a={a} b={b} aLinks={e.a_links} bLinks={e.b_links} />
        </p>
      </div>
    </>
  );
}

const EVIDENCE_WORD: Record<Link["evidence"], string> = { public: "public disclosure", reported: "press report", assumed: "assumed" };

/** "DBS: DBS newsroom, 27 Jul 2016, public disclosure · UOB: ...", or "Both: ..." when one source serves both. */
function Sources({ a, b, aLinks, bLinks }: { a: string; b: string; aLinks: Link[]; bLinks: Link[] }) {
  const one = (l: Link) => (
    <>
      {l.source_url ? (
        <a href={l.source_url} target="_blank" rel="noreferrer">
          {l.source_title ?? "Source"}
        </a>
      ) : (
        (l.source_title ?? "No source")
      )}
      {l.as_of && `, ${longDate(l.as_of)}`}, {EVIDENCE_WORD[l.evidence]}
    </>
  );
  const [la, lb] = [aLinks[0], bLinks[0]];
  if (la.source_url && la.source_url === lb.source_url) return <>Both: {one(la)}</>;
  return (
    <>
      {a}: {one(la)} · {b}: {one(lb)}
    </>
  );
}
