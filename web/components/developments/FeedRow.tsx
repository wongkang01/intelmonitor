// One development in a feed: the status column (priority, then New or Updated), the full title,
// one line on who it impacts, a facts line (Unconfirmed when the feed lists unconfirmed ones,
// adverse and tone, outlets and posts, category), and the date with a visible "View sources" cue.
// The whole row opens the development's popup, except in onboarding's preview (scope null), which
// is not a link.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { capitalize, shortDate } from "@/lib/format";
import { Dotted } from "@/components/monitor/parts";
import { ChevronIcon } from "@/components/ui/icons";

import { AdverseTone, ChangeMark, dateSpan, impactLine, names, PriorityBadge, sourceCountText, UnconfirmedMark } from "./labels";
import { developmentLink, type ViewScope } from "./link";

/** The column names above a list of FeedRows, on the same grid; the rows carry their own labels, so screen readers skip it. */
export function FeedHeader() {
  return (
    <div className="frow-head" aria-hidden="true">
      <span>Priority</span>
      <span>Finding</span>
      <span>Date</span>
    </div>
  );
}

export function FeedRow({
  development: d,
  scope,
}: {
  development: Schema<"ChangedDevelopment">;
  scope: ViewScope | null;
}) {
  const who = impactLine(d);
  return (
    <li className={`frow${d.dismissed ? " dismissed" : ""}${scope ? "" : " frow-static"}`}>
      <span className="fstat">
        <PriorityBadge priority={d.priority} />
        {!d.read && <ChangeMark change={d.change} />}
      </span>
      <span className="fmain">
        {scope ? (
          <Link {...developmentLink(d.id, scope)} className="ftitle">
            {d.title}
          </Link>
        ) : (
          <span className="ftitle">{d.title}</span>
        )}
        {who && <span className="fwho">{who}</span>}
        <span className="fmeta">
          <Dotted
            parts={[
              d.unconfirmed && <UnconfirmedMark key="u" />,
              d.priority_for.length > 0 && `${d.priority} for ${names(d.priority_for.map((s) => s.name))}`,
              <AdverseTone key="a" adverse={d.adverse} tone={d.direction} />,
              sourceCountText(d),
              capitalize(d.category),
              d.dismissed && "Dismissed",
            ]}
          />
        </span>
      </span>
      <span className="fend">
        <span className="num">{dateSpan(d.first_published, d.last_published, shortDate)}</span>
        {scope && (
          <span className="fopen" aria-hidden="true">
            View sources
            <ChevronIcon />
          </span>
        )}
      </span>
    </li>
  );
}
