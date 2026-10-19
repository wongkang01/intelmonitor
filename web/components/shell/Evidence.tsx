// Evidence drawer over the current page for a standing question's answer:
// `?answer=<subject id>:<question id>` shows the answer with the developments it relies on. A
// development opens in its popup (components/developments/DevelopmentPopup.tsx), which also takes
// old `?evidence=<id>` links. Build links with evidenceLink. Esc or Close drops the parameter.
import { Link, linkOptions, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import type { Schema } from "@/lib/api/client";
import { useAnswerEvidence } from "@/lib/api/queries";
import { answerText, longDate, plural } from "@/lib/format";
import { typingIn } from "@/lib/dom";
import { CloseButton } from "@/components/ui/Modal";
import { Dotted, StateChange } from "@/components/monitor/parts";
import { PriorityBadge } from "@/components/developments/labels";
import { developmentLink } from "@/components/developments/link";
import { SourceBlock } from "@/components/developments/Sources";

import { useAnswerCorrection } from "./Feedback";
import { factSentence, SeriesSource } from "./SeriesSource";
import { SubjectLink } from "./SubjectLink";

/** The current page with the drawer set to `answer`, or closed when it is empty. */
const drawerLink = (answer?: string) =>
  linkOptions({
    to: ".",
    search: (prev) => ({ ...prev, answer }),
    resetScroll: false,
  });

/** Links to a development's popup or the answer drawer over the current page; spread into a Link or navigate. */
export const evidenceLink = {
  development: (id: string) => developmentLink(id),
  answer: (subjectId: string, questionId: string) => drawerLink(`${subjectId}:${questionId}`),
};

function answerTarget(param: string | undefined) {
  const at = param?.indexOf(":") ?? -1;
  if (!param || at < 1) return null;
  return { subjectId: param.slice(0, at), questionId: param.slice(at + 1) };
}

export function EvidenceDrawer() {
  const search = useSearch({ from: "__root__" });
  const navigate = useNavigate();
  const answerParam = search.answer;
  const answer = answerTarget(answerParam);
  const answerEvidence = useAnswerEvidence(answer);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = () => void navigate({ ...drawerLink(), replace: true });
  const closeOnEscape = useEffectEvent(close);

  useEffect(() => {
    if (!answerParam) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typingIn(e.target) && !document.querySelector("dialog[open]")) {
        closeOnEscape();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected && !opener.closest(".drawer")) opener.focus();
    };
  }, [answerParam]);

  if (answer === null) return null;

  return (
    <aside className="drawer" aria-labelledby="evidence-title" data-testid="evidence-drawer" data-tour="evidence">
      <div className="sheet-head">
        <h2 id="evidence-title" tabIndex={-1} ref={heading}>
          Evidence
        </h2>
        <CloseButton onClick={close} label="Close evidence" />
      </div>
      <div className="drawer-body">
        {answerEvidence.isError && <p className="ev-empty">Could not load this evidence.</p>}
        {answerEvidence.data && <AnswerEvidenceView evidence={answerEvidence.data} />}
      </div>
    </aside>
  );
}

function AnswerEvidenceView({ evidence }: { evidence: Schema<"AnswerEvidence"> }) {
  const a = evidence.answer;
  const correction = useAnswerCorrection(evidence.subject.id, a, { icon: true });
  const before = a.change.kind === "state_changed" ? a.change.previous_state : null;
  return (
    <>
      <p className="meta ev-context">
        {a.custom && <span className="badge b-neutral">Custom</span>}
        <span>
          <Dotted parts={[a.label, <SubjectLink key="s" subject={evidence.subject} />, `last ${a.lookback_days} days`]} />
        </span>
      </p>
      <h3 className="ev-answer">{answerText(a.summary)}</h3>
      <p className="meta">{a.question}</p>
      <p className="ev-state">
        <StateChange state={a.state} from={before} />
        {before && a.change.previous_summary && <span className="meta">, was: {answerText(a.change.previous_summary)}</span>}
      </p>
      {!a.custom && (
        <p className="fb-wrong">
          {correction.link}
          {correction.line}
        </p>
      )}
      {correction.form}
      <h4 className="ev-label">{basedOn(evidence)}</h4>
      {evidence.developments.length === 0 && evidence.series.length === 0 && (
        <p className="ev-empty">No developments in the last {a.lookback_days} days bear on this focus area.</p>
      )}
      {evidence.series.map((c) => (
        <section key={c.series.id} className="ev-dev ev-series" aria-label={c.series.name}>
          <SeriesSource chart={c.chart} known={c.chart.cited?.available_at ?? null} sentence={factSentence(c.series, c.fact.text)} />
        </section>
      ))}
      {evidence.developments.map((d) => (
        <DevelopmentEvidence key={d.id} development={d} />
      ))}
    </>
  );
}

/** "Based on 6 developments and 3 series", or "Sources" when nothing is cited. */
function basedOn({ developments, series }: Schema<"AnswerEvidence">): string {
  const parts = [developments.length && plural(developments.length, "development"), series.length && plural(series.length, "series", "series")];
  const cited = parts.filter(Boolean);
  return cited.length ? `Based on ${cited.join(" and ")}` : "Sources";
}

/** One development an answer relies on: its labels, its title opening its popup, and its sources. */
function DevelopmentEvidence({ development: d }: { development: Schema<"DevelopmentDetail"> }) {
  return (
    <section className="ev-dev" aria-label={d.title}>
      <p className="ev-facts">
        <PriorityBadge priority={d.priority} />
        <span className="meta">
          <Dotted parts={[d.category, longDate(d.last_published)]} />
        </span>
      </p>
      <h5 className="ev-title">
        <Link {...developmentLink(d.id)}>{d.title}</Link>
      </h5>
      {d.sources.map((s) => (
        <SourceBlock key={s.document_id} source={s} title={d.title} />
      ))}
    </section>
  );
}
