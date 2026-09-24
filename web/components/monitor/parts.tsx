// Pieces shared by monitor pages, custom question previews and the evidence drawer.
import { Fragment, type ReactNode } from "react";

import { STATE_LABEL, STATE_TONE, type State } from "@/lib/format";

/** Meta parts joined with a middle dot. Empty parts are dropped. */
export function Dotted({ parts }: { parts: ReactNode[] }) {
  return parts
    .filter((p) => p !== null && p !== undefined && p !== false && p !== "")
    .map((p, i) => (
      <Fragment key={i}>
        {i > 0 && " · "}
        {p}
      </Fragment>
    ));
}

/** A state word in its status color, or "Watch → Needs attention" when it changed. */
export function StateChange({ state, from }: { state: State; from?: State | null }) {
  return (
    <span className="state-change">
      {from && from !== state && (
        <>
          <span className={`c-${STATE_TONE[from]}`}>{STATE_LABEL[from]}</span>
          <span className="arr" aria-hidden="true">
            →
          </span>
          <span className="sr-only"> to </span>
        </>
      )}
      <span className={`c-${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span>
    </span>
  );
}

/** A ruled section inside a monitor panel: a 15/600 header with optional meta on the right. */
export function Section({ id, title, meta, children }: { id: string; title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="mon-sec" aria-labelledby={id}>
      <div className="mon-sec-head">
        <h2 id={id}>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}
