// The Overview's Related card: the nodes linked to the subject whose developments in the window
// reach it, as a graph around it (components/graph/RelatedCanvas.tsx) beside a list of those
// developments grouped by node, as the graph view's In view list sits beside its canvas. The window
// is 7 days (the brief's week), 30 or 90. Clicking a node scrolls the list to its group and marks
// it; hovering or focusing a group highlights its node. "See all links" leads to the Related tab
// when the subject has one. The page shows the card only for a subject with stored links
// (MonitorView.tsx).
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useRelatedGraph, type RelatedDays } from "@/lib/api/queries";
import { shortDate } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import { PriorityBadge } from "@/components/developments/labels";
import { developmentLink } from "@/components/developments/link";
import { RelatedCanvas, toneOf } from "@/components/graph/RelatedCanvas";

import { Section } from "./parts";

type Subject = Schema<"SubjectRef">;
type LinkedNode = Schema<"RelatedNode">;
type Development = Schema<"DevelopmentSummary">;

const WINDOWS: RelatedDays[] = [7, 30, 90];

export function RelatedGraph({
  subject,
  relatedTab,
}: {
  subject: Subject;
  /** The subject's Related tab shows (Related.tsx useRelated), so "See all links" has somewhere to go. */
  relatedTab: boolean;
}) {
  const [days, setDays] = useState<RelatedDays>(7);
  const [hovered, setHovered] = useState<string | null>(null);
  // A fresh object per click, so clicking the same node again scrolls back to its group.
  const [selected, setSelected] = useState<{ id: string } | null>(null);
  const query = useRelatedGraph(subject.id, days);
  const data = query.data;
  const nodes = useMemo(() => data?.nodes.filter((n) => n.development_ids.length > 0) ?? [], [data]);

  return (
    <div className="panel ov-card rg">
      <Section
        id="related-graph"
        title={`Related to ${subject.name}`}
        meta={
          relatedTab && (
            <Link to="/monitors/$id/related" params={{ id: subject.id }} className="link">
              See all links
            </Link>
          )
        }
      >
        {query.isError ? (
          <p className="mon-empty">These links could not be loaded.</p>
        ) : !data ? null : (
          <>
            <div className="rg-bar">
              <div className="seg" role="group" aria-label="Developments from">
                {WINDOWS.map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d} days
                  </button>
                ))}
              </div>
              {nodes.length > 0 && <Legend subject={subject} />}
            </div>
            {nodes.length === 0 ? (
              <p className="mon-empty">
                No news reached {subject.name} through its links in the last {days} days.
              </p>
            ) : (
              <div className="rg-body">
                <RelatedCanvas center={data.center} nodes={nodes} hovered={hovered} onHover={setHovered} onOpen={(id) => setSelected({ id })} />
                <DevelopmentList
                  nodes={nodes}
                  developments={data.developments}
                  subject={subject}
                  hovered={hovered}
                  selected={selected}
                  onHover={setHovered}
                />
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

function Legend({ subject }: { subject: Subject }) {
  return (
    <ul className="rg-legend" aria-label="Legend">
      <li>
        <span className="rg-swatch harm" aria-hidden="true" />
        Could hurt {subject.name}
      </li>
      <li>
        <span className="rg-swatch news" aria-hidden="true" />
        Other news
      </li>
    </ul>
  );
}

/** Each node's developments under its name, in the graph's order (most developments first). A
 *  node click scrolls its group to the top of the list, inside the list so the page stays put. */
function DevelopmentList({
  nodes,
  developments,
  subject,
  hovered,
  selected,
  onHover,
}: {
  nodes: LinkedNode[];
  developments: Development[];
  subject: Subject;
  hovered: string | null;
  selected: { id: string } | null;
  onHover: (id: string | null) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(developments.map((d) => [d.id, d])), [developments]);

  useEffect(() => {
    const list = body.current;
    const group = selected ? list?.querySelector<HTMLElement>(`[data-node="${CSS.escape(selected.id)}"]`) : null;
    if (list && group) list.scrollTo({ top: group.offsetTop - list.offsetTop, behavior: "smooth" });
  }, [selected]);

  return (
    <div ref={body} className="rg-list" data-testid="related-list">
      {nodes.map((n) => (
        <section
          key={n.id}
          className="rg-group"
          data-node={n.id}
          data-tone={toneOf(n)}
          data-selected={n.id === selected?.id || undefined}
          data-hovered={n.id === hovered || undefined}
          aria-label={n.name}
          onMouseEnter={() => onHover(n.id)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(n.id)}
          onBlur={() => onHover(null)}
        >
          <h3>
            {n.subject ? (
              <Link {...monitorLink(n.subject.id)} className="tlink">
                {n.name}
              </Link>
            ) : (
              n.name
            )}
            <span className="count">{n.development_ids.length}</span>
          </h3>
          <p className="meta">{n.links.map((l) => l.label).join(", ")}</p>
          <ol className="rg-rows">
            {n.development_ids.flatMap((id) => byId.get(id) ?? []).map((d) => (
              <li key={d.id}>
                <Link {...developmentLink(d.id, { subject: subject.id })} className="rg-row">
                  <PriorityBadge priority={d.priority} />
                  <span className="rg-title">{d.title}</span>
                  <span className="num">{shortDate(d.last_published)}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
