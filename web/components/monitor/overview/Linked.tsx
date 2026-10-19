// The institutions linked to a country, sector, technology provider or payment system, on its
// Related tab (GET /subjects/{id}/linked, decision U2a): each with how it is linked in plain words,
// the link's evidence (grade, size, dates, source) and this week's news that reaches it that way.
// Institutions the app does not track are listed by name with "No page yet".
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useLinked } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { DIRECTION, EVIDENCE } from "@/components/developments/Impacts";
import { developmentLink } from "@/components/developments/link";
import { SubjectLink } from "@/components/shell/SubjectLink";

import { Section } from "../parts";
import { RouteEvidence } from "./CouldAffect";

type Subject = Schema<"SubjectDetail">;
type Institution = Schema<"LinkedInstitution">;
type Kind = NonNullable<Subject["kind"]>;

const TITLE: Partial<Record<Kind, (name: string) => string>> = {
  country: (n) => `Institutions with loans or subsidiaries in ${n}`,
  sector: (n) => `Institutions lending to ${n.toLowerCase()}`,
  tech_provider: (n) => `Institutions that use ${n}`,
  payment_system: (n) => `Institutions that take part in ${n}`,
};

/** The subject kinds whose Related tab lists linked institutions. */
export const LINKED_KINDS: ReadonlySet<Kind> = new Set(Object.keys(TITLE) as Kind[]);

// Institutions before "Show N more", and this week's developments under each.
const SHOWN = 10;
const WEEK_SHOWN = 2;

export function Linked({ subject }: { subject: Subject }) {
  const query = useLinked(subject.id);
  const [all, setAll] = useState(false);
  const title = (subject.kind && TITLE[subject.kind]?.(subject.name)) ?? `Institutions linked to ${subject.name}`;
  if (query.isPending) return null;
  const rows = query.data ?? [];
  const { same, rest } = splitSame(rows);
  const shown = all ? rest : rest.slice(0, SHOWN);
  const grades = [...new Set(rows.flatMap((i) => i.routes.flatMap((r) => r.links.map((l) => l.evidence))))];
  const regionStart = rest.some((i) => !i.region) ? shown.findIndex((i) => i.region) : -1;
  return (
    <div className="panel ov-card">
      <Section id="linked" title={title} meta={rows.length > 0 && plural(rows.length, "institution")}>
        {query.isError ? (
          <p className="mon-empty">These institutions could not be loaded.</p>
        ) : (
          <>
            {rest.length > 0 && (
              <ol className="ln-rows">
                {shown.map((inst, n) => (
                  <InstitutionRow key={inst.id} inst={inst} subject={subject} regionHead={n === regionStart} />
                ))}
              </ol>
            )}
            {rest.length > shown.length && (
              <button type="button" className="btn btn-sm ca-more" onClick={() => setAll(true)}>
                Show {rest.length - shown.length} more
              </button>
            )}
            {same.length > 0 && <SameLink rows={same} />}
            <p className="meta ln-legend">
              {grades
                .filter((g) => g !== "assumed")
                .map((g) => `${EVIDENCE[g].word}: ${EVIDENCE[g].hint.charAt(0).toLowerCase()}${EVIDENCE[g].hint.slice(1)}`)
                .join(" ")}
              {same.some((i) => !i.subject) && " Names without a link have no page yet."}
            </p>
          </>
        )}
      </Section>
    </div>
  );
}

// Institutions sharing one link before their names collapse into columns (FAST's 36, MEPS+'s 56).
const SAME_MIN = 5;

/**
 * Splits off the institutions whose only link is the most common one, in the same words from the
 * same source and with no news this week, when there are enough of them to list by name only.
 */
function splitSame(rows: Institution[]): { same: Institution[]; rest: Institution[] } {
  const key = (i: Institution) => {
    const r = i.routes[0];
    return i.impacts.length === 0 && i.routes.length === 1 && r.links.length === 1 ? `${r.text}|${r.links[0].source_url}` : null;
  };
  const counts = new Map<string, number>();
  for (const i of rows) {
    const k = key(i);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [best, count] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a), ["", 0]);
  if (count < SAME_MIN) return { same: [], rest: rows };
  return { same: rows.filter((i) => key(i) === best), rest: rows.filter((i) => key(i) !== best) };
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** The one shared link and source once, then the institutions' names in columns. */
function SameLink({ rows }: { rows: Institution[] }) {
  return (
    <>
      <div className="ln-route ln-same">
        <p>
          Each of these {rows.length} {lowerFirst(rows[0].routes[0].text)}.
        </p>
        <RouteEvidence links={rows[0].routes[0].links} />
      </div>
      <ul className="ln-names">
        {rows.map((i) => (
          <li key={i.id}>{i.subject ? <SubjectLink subject={i.subject} /> : i.name}</li>
        ))}
      </ul>
    </>
  );
}

/** One institution: its name, then each route with its evidence, then this week's news through them. */
function InstitutionRow({ inst, subject, regionHead }: { inst: Institution; subject: Subject; regionHead: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <>
      {regionHead && <li className="ln-head">Figures for a whole region that includes {subject.name}</li>}
      <li className="ln-row">
        <span className="ln-name">
          {inst.subject ? <SubjectLink subject={inst.subject} /> : inst.name}
          {!inst.subject && <span className="ln-none">No page yet</span>}
        </span>
        <div className="ln-routes">
          {inst.routes.map((r) => (
            <div key={r.links.map((l) => l.id).join(">")} className="ln-route">
              <p>{r.text}</p>
              <RouteEvidence links={r.links} />
            </div>
          ))}
          {inst.impacts.length > 0 && (
            <div className="ln-week">
              <h3>This week, through these links</h3>
              <ul>
                {(all ? inst.impacts : inst.impacts.slice(0, WEEK_SHOWN)).map((i) => (
                  <li key={i.development_id}>
                    <Link {...developmentLink(i.development_id, { subject: subject.id })} className="tlink">
                      {i.development.title}
                    </Link>{" "}
                    <span className={DIRECTION[i.direction].cls}>{DIRECTION[i.direction].word}.</span>
                  </li>
                ))}
              </ul>
              {!all && inst.impacts.length > WEEK_SHOWN && (
                <button type="button" className="link" onClick={() => setAll(true)}>
                  Show {inst.impacts.length - WEEK_SHOWN} more
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    </>
  );
}
