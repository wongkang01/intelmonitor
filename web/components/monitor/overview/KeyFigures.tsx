// Key data in the right column of an Overview's summary band (SummaryBand.tsx), in the API's pick
// (`key_data`, api pipeline/facts.py), which the brief states too: the indicators a detector
// flagged lead, worst first, then the subject's own (primary) series and the context series. The
// band shows the first 3, each as its name over the latest value in its unit and the weekly change
// (daily series) or the change on the previous release. "Open Data" leads to the Data tab.
import { Link } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { useIndicators } from "@/lib/api/queries";
import { indicatorChange, seriesValue } from "@/lib/format";

type Indicator = Schema<"SubjectIndicator">;

// Figures in the band.
const SHOWN = 3;

/** The top 3 Key data figures and "Open Data"; nothing when the subject has no listed series. */
export function KeyFigures({ subjectId, asOf }: { subjectId: string; asOf: string }) {
  const query = useIndicators(subjectId, asOf);
  const byId = new Map(query.data?.indicators.map((i) => [i.series.id, i]));
  const ids = query.data ? [...query.data.key_data.flagged, ...query.data.key_data.rows] : [];
  const figures = ids.flatMap((id) => byId.get(id) ?? []).slice(0, SHOWN);
  if (figures.length === 0) return null;
  return (
    <>
      {figures.map((ind) => (
        <Figure key={ind.series.id} ind={ind} />
      ))}
      <Link to="/monitors/$id/data" params={{ id: subjectId }} className="link kf-open">
        Open Data
      </Link>
    </>
  );
}

function Figure({ ind }: { ind: Indicator }) {
  const s = ind.series;
  // Over a week for daily series, else against the previous release.
  const daily = s.frequency === "daily";
  const change = indicatorChange(ind, daily ? "1w" : undefined);
  return (
    <div className="kf" data-series-id={s.id}>
      <span className="meta">{s.name}</span>
      <span className="kf-val">
        {ind.latest ? seriesValue(s, ind.latest.value) : "No data"}
        {change && (
          <span className="meta">
            {" "}
            <span className={change.tone ? `chg-${change.tone}` : undefined}>{change.value}</span> {daily ? "wk" : change.window}
          </span>
        )}
      </span>
    </div>
  );
}
