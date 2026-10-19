// Mocked answers for the Ask preview: the DBS and UOB loans question gets the approved sample
// answer, built from stored 30 Jun 2026 exposures; any other question gets a not-built-yet note.
// No backend or model is called.
import { useId } from "react";

/** True for a question about DBS and UOB loans or regions. */
const isLoansQuestion = (question: string) =>
  /\bdbs\b/i.test(question) && /\buob\b/i.test(question) && /loan|region/i.test(question);

export function Answer({ question }: { question: string }) {
  const titleId = useId();
  if (!isLoansQuestion(question))
    return (
      <section className="ask-answer" aria-label="Answer">
        <p>Answers are not built yet. Ask how DBS and UOB loans compare by region to see a sample.</p>
      </section>
    );
  return (
    <section className="ask-answer" aria-labelledby={titleId}>
      <h2 id={titleId}>DBS and UOB loans by region, 30 Jun 2026</h2>
      <p>
        DBS lends more outside Singapore than UOB, 56% of loans against 50%. DBS leans to Greater China (25% against
        14%); UOB leans to Southeast Asia outside Singapore (21% against 9%). UOB&apos;s Greater China NPL ratio rose to
        4.8% from 2.7% a year earlier; DBS Hong Kong&apos;s is 2.2%.
      </p>
      <RegionBars />
      <p className="ask-caveat">
        Stored exposures at 30 Jun 2026. DBS reports South and Southeast Asia as one region, so UOB&apos;s Malaysia,
        Thailand and Indonesia are summed. UOB Greater China figures were read off charts.
      </p>
    </section>
  );
}

// Share of loans by region, in percent.
const REGIONS = [
  { label: "Outside Singapore", dbs: 56, uob: 50 },
  { label: "Greater China", dbs: 25, uob: 14 },
  { label: "Southeast Asia outside Singapore", dbs: 9, uob: 21 },
];
// The longest bar spans the row, less room for its value; every bar starts at zero, so lengths compare directly.
const SCALE = Math.max(...REGIONS.flatMap((r) => [r.dbs, r.uob]));

/** A grouped horizontal bar chart: a DBS bar over a UOB bar per region, each labelled with its value. */
function RegionBars() {
  const summary = REGIONS.map((r) => `${r.label}: DBS ${r.dbs}%, UOB ${r.uob}%.`).join(" ");
  return (
    <div className="ask-chart" role="img" aria-label={`Share of loans by region. ${summary}`}>
      <div className="ask-legend">
        <span>
          <i className="dbs" /> DBS
        </span>
        <span>
          <i className="uob" /> UOB
        </span>
      </div>
      {REGIONS.map((r) => (
        <div key={r.label} className="ask-chart-row">
          <span>{r.label}</span>
          <div className="ask-chart-pair">
            {(["dbs", "uob"] as const).map((bank) => (
              <div key={bank} className="ask-chart-bar">
                <i className={bank} style={{ width: `calc((100% - 3em) * ${r[bank] / SCALE})` }} />
                <span>{r[bank]}%</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
