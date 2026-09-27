"use client";

// Evidence drawer over the current page. `?evidence=<development id>` shows a development's
// sources; `?answer=<subject id>:<question id>` shows a standing question answer with the
// developments it relies on. Build links with useEvidenceHref. Esc or Close drops the parameter.
// The page's own parameters (the developments view's scope) stay as they are.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { useAnswerEvidence, useDevelopment } from "@/lib/api/queries";
import { answerText, longDate, percent, plural, tagger } from "@/lib/format";
import { typingIn } from "@/lib/dom";
import { CloseButton } from "@/components/ui/Modal";
import { Dotted, StateChange } from "@/components/monitor/parts";
import { DevelopmentBadge } from "@/components/widgets/parts";

import { TagList, useAnswerCorrection } from "./Feedback";
import { Notes } from "./Notes";
import { SubjectLink } from "./SubjectLink";

type DrawerParam = "evidence" | "answer";

/** The page's href with the drawer set to `open`, or closed when `open` is omitted. */
export function drawerHref(pathname: string, params: URLSearchParams, open?: [DrawerParam, string]) {
  const next = new URLSearchParams(params);
  next.delete("evidence");
  next.delete("answer");
  if (open) next.set(...open);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Hrefs that open the evidence drawer over the current page. */
export function useEvidenceHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return {
    development: (id: string) => drawerHref(pathname, params, ["evidence", id]),
    answer: (subjectId: string, questionId: string) =>
      drawerHref(pathname, params, ["answer", `${subjectId}:${questionId}`]),
  };
}

function answerTarget(param: string | null) {
  const at = param?.indexOf(":") ?? -1;
  if (!param || at < 1) return null;
  return { subjectId: param.slice(0, at), questionId: param.slice(at + 1) };
}

export function EvidenceDrawer() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const developmentId = params.get("evidence");
  const answerParam = params.get("answer");
  const answer = answerTarget(answerParam);
  const development = useDevelopment(developmentId);
  const answerEvidence = useAnswerEvidence(developmentId ? null : answer);
  const heading = useRef<HTMLHeadingElement>(null);
  const open = developmentId !== null || answer !== null;
  const opened = developmentId ?? answerParam;
  const close = () => router.replace(drawerHref(pathname, params), { scroll: false });
  const closeOnEscape = useEffectEvent(close);

  useEffect(() => {
    if (!opened) return;
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
  }, [opened]);

  if (!open) return null;
  const failed = developmentId ? development.isError : answerEvidence.isError;

  return (
    <aside className="drawer" aria-labelledby="evidence-title" data-testid="evidence-drawer" data-tour="evidence">
      <div className="sheet-head">
        <h2 id="evidence-title" tabIndex={-1} ref={heading}>
          Evidence
        </h2>
        <CloseButton onClick={close} label="Close evidence" />
      </div>
      <div className="drawer-body">
        {failed && <p className="ev-empty">Could not load this evidence.</p>}
        {developmentId && development.data && <DevelopmentEvidence development={development.data} />}
        {!developmentId && answerEvidence.data && <AnswerEvidenceView evidence={answerEvidence.data} />}
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
      <h4 className="ev-label">
        {evidence.developments.length ? `Based on ${plural(evidence.developments.length, "development")}` : "Sources"}
      </h4>
      {evidence.developments.length === 0 && (
        <p className="ev-empty">No developments in the last {a.lookback_days} days bear on this question.</p>
      )}
      {evidence.developments.map((d) => (
        <DevelopmentEvidence key={d.id} development={d} nested />
      ))}
    </>
  );
}

/**
 * One development: badge and facts, its title, who it is tagged to, and each source with its
 * highlighted quotes. Nested inside an answer it links to its own drawer, where notes and the
 * tag list with Wrong live.
 */
function DevelopmentEvidence({ development: d, nested = false }: { development: Schema<"DevelopmentDetail">; nested?: boolean }) {
  const evidence = useEvidenceHref();
  const head = (
    <>
      <p className="ev-facts">
        <DevelopmentBadge development={d} />
        <span className="meta">
          <Dotted parts={[d.materiality_label, d.category, d.stage, longDate(d.last_published)]} />
        </span>
      </p>
      {nested ? (
        <h5 className="ev-title">
          <Link href={evidence.development(d.id)} scroll={false}>
            {d.title}
          </Link>
        </h5>
      ) : (
        <h3 className="ev-answer">{d.title}</h3>
      )}
      {nested ? (
        <Confidence development={d} />
      ) : (
        <>
          <p className="meta ev-conf">
            Materiality: <MaterialityConfidence development={d} />
          </p>
          <TagList development={d} />
        </>
      )}
    </>
  );
  const sources = d.sources.map((s) => <Source key={s.document_id} source={s} title={d.title} />);
  if (nested)
    return (
      <section className="ev-dev" aria-label={d.title}>
        {head}
        {sources}
      </section>
    );
  return (
    <>
      {head}
      <h4 className="ev-label">{plural(d.sources.length, "source")}</h4>
      {sources}
      <h4 className="ev-label">Notes</h4>
      <Notes target={{ development_id: d.id }} notes={d.notes} />
    </>
  );
}

const confidenceWord = (x: number) => (x >= 0.7 ? "high" : x >= 0.4 ? "medium" : "low");

/** One line under a nested development: who it is tagged to, then materiality confidence in words. Percentages show on hover. */
function Confidence({ development: d }: { development: Schema<"DevelopmentDetail"> }) {
  return (
    <p className="meta ev-conf">
      {d.subject_confidence.length > 0 && (
        <>
          Tagged to{" "}
          {d.subject_confidence.map((c, i) => (
            <Fragment key={c.subject.id}>
              {i > 0 && ", "}
              <span title={`${percent(c.confidence)} confidence, tagged by ${tagger(c.source)}`}>
                <SubjectLink subject={c.subject} />
              </span>
            </Fragment>
          ))}
          {" · "}
        </>
      )}
      <MaterialityConfidence development={d} />
    </p>
  );
}

function MaterialityConfidence({ development: d }: { development: Schema<"DevelopmentDetail"> }) {
  return (
    <span title={`Materiality confidence ${percent(d.materiality_confidence)}`}>
      {confidenceWord(d.materiality_confidence)} confidence
    </span>
  );
}

const COLLECTION_LABEL: Record<Schema<"EvidenceSource">["collection"], string> = {
  dms: "DMS",
  official: "Official",
  news: "News",
};

function Source({ source: s, title }: { source: Schema<"EvidenceSource">; title: string }) {
  const kind = s.doc_type.toLowerCase() === s.collection ? COLLECTION_LABEL[s.collection] : `${COLLECTION_LABEL[s.collection]}, ${s.doc_type}`;
  return (
    <article className="source">
      <a href={s.url} target="_blank" rel="noreferrer">
        {s.title}
      </a>
      <p className="meta">
        <Dotted parts={[longDate(s.published_at), kind, s.domain, s.new_in_run && "new this run"]} />
      </p>
      {s.findings.map((f) => (
        <div key={f.id} className="finding">
          {f.statement !== title && <p>{f.statement}</p>}
          <blockquote>
            <Highlighted passage={f.passage} />
          </blockquote>
        </div>
      ))}
    </article>
  );
}

/** A passage with its quote spans wrapped in <mark>, and an ellipsis where the document goes on. */
function Highlighted({ passage }: { passage: Schema<"Passage"> }) {
  const parts: ReactNode[] = [passage.clipped_start && "…"];
  let at = 0;
  for (const h of [...passage.highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    parts.push(passage.text.slice(at, h.start));
    parts.push(<mark key={h.start}>{passage.text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  parts.push(passage.text.slice(at), passage.clipped_end && "…");
  return <>{parts}</>;
}
