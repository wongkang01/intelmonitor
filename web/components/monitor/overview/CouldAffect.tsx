// "Could affect DBS" on the Related tab: this week's news about the places, sectors, suppliers,
// systems and companies the subject is linked to, grouped by kind of link (exposure, ownership and
// structure, dependency). Each link shows once, with
// its evidence, over the developments that reach the subject through it: the effect in words, the
// title and the full why.
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { capitalize, shortDate } from "@/lib/format";
import { DIRECTION, LinkEvidence } from "@/components/developments/Impacts";
import { developmentLink } from "@/components/developments/link";

import { Section } from "../parts";

type Impact = Schema<"SubjectImpact">;
type Subject = Schema<"SubjectRef">;
type RelType = Schema<"RelationshipLink">["type"];

const GROUPS: { title: string; types: RelType[] }[] = [
  { title: "Exposure", types: ["exposed_to"] },
  { title: "Ownership and structure", types: ["owns", "subsidiary_of", "shareholder_of", "operates_in", "member_of"] },
  { title: "Dependency", types: ["depends_on", "participates_in"] },
];
const GROUPED = new Set(GROUPS.flatMap((g) => g.types));

// Developments under one link before "Show N more".
const PER_LINK = 3;

/** A route as a heading: "Singapore loans, 44.4% of total", one figure for a whole region named once. */
export const routeHeading = (route: string) =>
  capitalize(route.replace(/^via its /, "").replace(/, a figure for the whole region including .+$/, ", a figure for the whole region"));

export function CouldAffect({ subject, impacts }: { subject: Subject; impacts: Impact[] }) {
  const byLink = new Map<string, Impact[]>();
  for (const i of impacts) {
    const key = i.relationships.map((l) => l.id).join(">");
    byLink.set(key, [...(byLink.get(key) ?? []), i]);
  }
  const links = [...byLink.values()];
  const typeOf = (rows: Impact[]) => rows[0].relationships[0]?.type;
  const groups = [
    ...GROUPS.map((g) => ({ title: g.title, links: links.filter((l) => g.types.includes(typeOf(l))) })),
    { title: "Other links", links: links.filter((l) => !GROUPED.has(typeOf(l))) },
  ].filter((g) => g.links.length > 0);
  return (
    <Section id="could-affect" title={`Could affect ${subject.name}`} meta={impacts.length > 0 && `${impacts.length} this week`}>
      {impacts.length === 0 ? (
        <p className="mon-empty">Nothing this week reaches {subject.name} through its links.</p>
      ) : (
        groups.map((g) => (
          <div key={g.title} className="ca-group">
            <h3>{g.title}</h3>
            {g.links.map((rows) => (
              <LinkBlock key={rows[0].relationships.map((l) => l.id).join(">")} rows={rows} subject={subject} />
            ))}
          </div>
        ))
      )}
    </Section>
  );
}

/** One link and the developments that reach the subject through it. */
function LinkBlock({ rows, subject }: { rows: Impact[]; subject: Subject }) {
  const [all, setAll] = useState(false);
  const first = rows[0];
  const shown = all ? rows : rows.slice(0, PER_LINK);
  return (
    <div className="ca-link">
      <p className="ca-route">{routeHeading(first.route)}</p>
      <RouteEvidence links={first.relationships} />
      <ol className="ca-rows">
        {shown.map((i) => (
          <ImpactRow key={i.development_id} impact={i} subject={subject} />
        ))}
      </ol>
      {rows.length > shown.length && (
        <button type="button" className="btn btn-sm ca-more" onClick={() => setAll(true)}>
          Show {rows.length - shown.length} more
        </button>
      )}
    </div>
  );
}

/**
 * The evidence for a route, one line per link ("DBS owns DBS Bank India: Public disclosure: ..."),
 * or a single line when every link comes from the same source.
 */
export function RouteEvidence({ links }: { links: Schema<"RelationshipLink">[] }) {
  const one = links.every((l) => l.source_url === links[0].source_url) ? links.slice(0, 1) : links;
  return one.map((l) => (
    <p key={l.id} className="meta ca-ev">
      {one.length > 1 && <>{`${l.from_name} ${l.label.split(",")[0]} ${l.to_name}: `}</>}
      <LinkEvidence link={l} />
    </p>
  ));
}

function ImpactRow({ impact: i, subject }: { impact: Impact; subject: Subject }) {
  const dir = DIRECTION[i.direction];
  const d = i.development;
  // A region-level link carries news about several places; the row names its own.
  const about = i.route.match(/, a figure for the whole region including (.+)$/)?.[1];
  return (
    <li className="ca-row">
      <span className={`ca-dir ${dir.cls}`}>{dir.word}</span>
      <span className="ca-main">
        <Link {...developmentLink(d.id, { subject: subject.id })} className="tlink">
          {d.title}
        </Link>
        <span className="ca-why">{i.why}</span>
        {about && <span className="meta">News about {about}</span>}
      </span>
      <span className="ca-end num">{shortDate(d.last_published)}</span>
    </li>
  );
}
