// A subject's developments: the top 5 this month on its Overview, and the full feed with the period
// and facet filters on its Developments tab (components/developments/Feed.tsx). Both leave out
// unconfirmed developments; only the tab can show them.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { useDevelopments, useMonitorPage } from "@/lib/api/queries";
import { listQuery } from "@/lib/developments";
import { plural } from "@/lib/format";
import { useHashScroll } from "@/lib/dom";
import { Feed, HrefLink } from "@/components/developments/Feed";
import { FeedHeader, FeedRow } from "@/components/developments/FeedRow";
import { ChevronIcon } from "@/components/ui/icons";

import { MonitorHead } from "./MonitorView";
import { Section } from "./parts";

// Rows on the Overview before "See all".
const TOP = 5;

/**
 * The Overview's "Top <entity> developments" ("Top developments" for a topic): this month's first 5 confirmed ones, High and adverse for the
 * subject first, then other High, Medium adverse, other Medium and the rest, newest first within
 * each (the API's order). Each has its priority badge; a link to the Developments tab follows. The
 * query is the tab's default one, so the tab opens from cache.
 */
export function TopDevelopments({ subject }: { subject: Schema<"SubjectRef"> }) {
  const list = useDevelopments(listQuery({ subject_id: [subject.id] }, new URLSearchParams()));
  const rows = list.data?.developments.filter((d) => !d.dismissed) ?? [];
  const allTime = list.data?.facets.date.find((v) => v.value === "any")?.count ?? 0;
  return (
    <Section id="developments" title={subject.type === "entity" ? `Top ${subject.name} developments` : "Top developments"}>
      {list.isError ? (
        <p className="mon-empty">These developments could not be loaded.</p>
      ) : !list.data ? null : rows.length === 0 ? (
        <p className="mon-empty">No developments this month.</p>
      ) : (
        <>
          <FeedHeader />
          <ol className="frows">
            {rows.slice(0, TOP).map((d) => (
              <FeedRow key={d.id} development={d} scope={{ subject: subject.id }} />
            ))}
          </ol>
        </>
      )}
      {list.data && allTime > 0 && (
        <div className="feed-foot">
          {rows.length > 0 ? (
            <Link to="/monitors/$id/developments" params={{ id: subject.id }} className="link top-all">
              {rows.length > TOP ? `See all ${plural(rows.length, "development")} this month` : "See all developments"}
              <ChevronIcon />
            </Link>
          ) : (
            // Nothing this month: open the tab on all time, where the older ones are.
            <HrefLink href={`/monitors/${encodeURIComponent(subject.id)}/developments?days=any`} className="link top-all">
              See earlier developments
              <ChevronIcon />
            </HrefLink>
          )}
        </div>
      )}
    </Section>
  );
}

/** The Developments tab: the subject's full feed in the same order, with the filters and Show unconfirmed. */
export function DevelopmentsTab({ id }: { id: string }) {
  const page = useMonitorPage(id);
  useHashScroll();
  const p = page.data;
  if (page.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!p) return null;
  return (
    <>
      <MonitorHead page={p} view="developments" />
      <div className="mon-devs">
        <div className="panel">
          <Section id="developments" title={`Developments about ${p.subject.name}`}>
            <Feed scope={{ subject_id: [p.subject.id] }} view={{ subject: p.subject.id }} />
          </Section>
        </div>
      </div>
    </>
  );
}
