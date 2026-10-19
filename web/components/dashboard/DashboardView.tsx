// A dashboard, one fixed layout (mocks/phase1/u4-dashboard-shell.html, option B): the name, its
// subjects and Edit dashboard; the watchlist table (each entity's new High count and its top
// development this month, the busiest few first, the rest behind "Show all"); then the feed of the
// latest developments, highest priority first, beside the upcoming dates. The widget grid, Add widget and edit mode are parked (phase1-plan.md section 5).
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useDashboard, useDashboardOverview, useProfile, useSubjects } from "@/lib/api/queries";
import { shortDate } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { Section } from "@/components/monitor/parts";
import { Feed } from "@/components/developments/Feed";
import { PRIORITIES, PriorityBadge } from "@/components/developments/labels";
import { developmentLink } from "@/components/developments/link";

import { DashboardDot } from "./DashboardIdentity";
import { NewDashboard } from "./NewDashboard";

type Overview = Schema<"DashboardOverview">;

/** Feed rows before "Show all N", which opens the dashboard's developments list. */
const FEED_CAP = 15;

/**
 * Watchlist rows before "Show all N", so a large dashboard's feed starts above the fold. One more
 * shows instead of a button that would hide a single row.
 */
const WATCH_CAP = 3;

export function DashboardView({ id }: { id: string }) {
  const dashboard = useDashboard(id);
  const overview = useDashboardOverview(id);
  const subjects = useSubjects();
  const lastVisit = useProfile().data?.last_visit ?? null;
  const [editing, setEditing] = useState(false);

  const d = dashboard.data;
  if (dashboard.isError) return <p className="page-message">This dashboard could not be loaded.</p>;
  if (!d) return null;

  const named = d.subject_ids.flatMap((sid) => subjects.data?.find((s) => s.id === sid) ?? []);
  const o = overview.data;
  const since = o && (lastVisit ? `since your last visit on ${shortDate(o.since)}` : `since ${shortDate(o.since)}`);

  return (
    <>
      <div className="pagehead dash-head">
        <div className="grow">
          <div className="dash-title">
            <DashboardDot color={d.color} />
            <h1>{d.name}</h1>
          </div>
          <p>
            <SubjectLinks subjects={named} />
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          Edit dashboard
        </button>
      </div>
      <div className="dash">
        {overview.isError && <p className="mon-empty">The watchlist and dates could not be loaded.</p>}
        {o && o.watchlist.length > 0 && (
          <div className="panel ov-card">
            <Watchlist overview={o} />
          </div>
        )}
        <div className="dash-cols">
          <div className="panel ov-card">
            <Section
              id="latest"
              title="Latest developments"
              meta={
                o &&
                (o.new_count > 0 ? (
                  <>
                    <b className="new-n">{o.new_count} new</b> {since}
                  </>
                ) : (
                  `Nothing new ${since}`
                ))
              }
            >
              <Feed
                scope={{ dashboard_id: id }}
                view={{ dashboard: id }}
                cap={FEED_CAP}
                more={`/developments?dashboard=${encodeURIComponent(id)}`}
              />
            </Section>
          </div>
          {o && (
            <div className="panel ov-card">
              <Upcoming items={o.upcoming} dashboardId={id} />
            </div>
          )}
        </div>
      </div>
      <NewDashboard open={editing} onClose={() => setEditing(false)} dashboard={d} />
    </>
  );
}

type Watch = Schema<"WatchItem">;

/**
 * Busiest first: most new High, then the top development's priority, then its date; entities with
 * nothing this month last, in dashboard order.
 */
const busiest = (a: Watch, b: Watch) =>
  b.new_high - a.new_high ||
  Number(!a.top) - Number(!b.top) ||
  (a.top && b.top ? PRIORITIES.indexOf(a.top.priority) - PRIORITIES.indexOf(b.top.priority) || b.top.last_published.localeCompare(a.top.last_published) : 0);

/**
 * One row per entity: new High count since the last visit, then its top development this month in
 * full. Only the first few entities with developments this month show until "Show all N".
 */
function Watchlist({ overview: o }: { overview: Overview }) {
  const [all, setAll] = useState(false);
  const rows = [...o.watchlist].sort(busiest);
  const active = rows.filter((w) => w.top);
  const first = active.slice(0, active.length === WATCH_CAP + 1 ? WATCH_CAP + 1 : WATCH_CAP);
  const shown = all ? rows : first;
  const hidden = rows.length - first.length;
  return (
    <Section id="watchlist" title="Watchlist" meta="Most new High first">
      {shown.length === 0 ? (
        <p className="mon-empty">Nothing this month for these entities.</p>
      ) : (
        <table className="wtable">
          <thead>
            <tr>
              <th scope="col">Entity</th>
              <th scope="col">New High since {shortDate(o.since)}</th>
              <th scope="col">Top development this month</th>
              <th scope="col" className="wl-dt">
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((w) => (
              <WatchRow key={w.subject.id} item={w} />
            ))}
          </tbody>
        </table>
      )}
      {hidden > 0 && (
        <div className="feed-foot">
          <button type="button" className="btn btn-sm" aria-expanded={all} onClick={() => setAll((x) => !x)}>
            {all ? "Show fewer" : `Show all ${rows.length} entities`}
          </button>
        </div>
      )}
    </Section>
  );
}

function WatchRow({ item: w }: { item: Watch }) {
  const shown = w.top ?? w.latest;
  const view = { subject: w.subject.id };
  return (
    <tr>
      <th scope="row" className="wl-ent">
        <Link {...monitorLink(w.subject.id)} className="subject-link">
          {w.subject.name}
        </Link>
      </th>
      <td className="wl-cnt">
        {w.new_high > 0 ? (
          <span className="num">
            {w.new_high} new <span className="attn-t">High</span>
          </span>
        ) : (
          <span className="wl-none">None</span>
        )}
      </td>
      <td className="wl-top">
        {w.top ? (
          <span className="wtop">
            <PriorityBadge priority={w.top.priority} />
            <Link {...developmentLink(w.top.id, view)} className="wtitle">
              {w.top.title}
            </Link>
          </span>
        ) : w.latest ? (
          <span className="wl-none">
            Nothing this month. Latest:{" "}
            <Link {...developmentLink(w.latest.id, view)} className="wtitle">
              {w.latest.title}
            </Link>
          </span>
        ) : (
          <span className="wl-none">No developments yet.</span>
        )}
      </td>
      <td className="wl-dt num">{shown && shortDate(shown.last_published)}</td>
    </tr>
  );
}

/**
 * Dates from this dashboard's news, soonest first: the label links to its development, with the
 * development's title under it, since labels such as "Applications close" need it to make sense.
 */
function Upcoming({ items, dashboardId }: { items: Schema<"UpcomingItem">[]; dashboardId: string }) {
  return (
    <Section id="upcoming" title="Upcoming dates">
      {items.length === 0 ? (
        <p className="mon-empty">No upcoming dates in this dashboard's news.</p>
      ) : (
        <ol className="uplist">
          {items.map((u) => (
            <li key={`${u.development_id}-${u.date}`}>
              <span className="num up-date">{shortDate(u.date)}</span>
              <span className="up-main">
                <Link {...developmentLink(u.development_id, { dashboard: dashboardId })} className="up-label wtitle">
                  {u.label}
                </Link>
                <span className="up-about">{u.development_title}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
