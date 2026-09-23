"use client";

// Evidence drawer over the current page. `?evidence=<development id>` shows a development's
// sources; `?answer=<subject id>:<question id>` shows a standing question answer with the
// developments it relies on. Build links with useEvidenceHref. Esc or Close drops the parameter.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { useAnswerEvidence, useDevelopment } from "@/lib/api/queries";
import { longDate, plural, STATE_LABEL } from "@/lib/format";
import { typingIn } from "@/lib/dom";
import { CloseButton } from "@/components/ui/Modal";
import { DevelopmentBadge, StateBadge } from "@/components/widgets/parts";

import { Notes } from "./Notes";
import { SubjectLink } from "./SubjectLink";

/** Hrefs that open the evidence drawer over the current page. */
export function useEvidenceHref() {
  const pathname = usePathname();
  return {
    development: (id: string) => `${pathname}?evidence=${encodeURIComponent(id)}`,
    answer: (subjectId: string, questionId: string) =>
      `${pathname}?answer=${encodeURIComponent(`${subjectId}:${questionId}`)}`,
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

  useEffect(() => {
    if (!opened) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typingIn(e.target) && !document.querySelector("dialog[open]")) {
        router.replace(pathname, { scroll: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected && !opener.closest(".drawer")) opener.focus();
    };
  }, [opened, pathname, router]);

  if (!open) return null;
  const failed = developmentId ? development.isError : answerEvidence.isError;

  return (
    <aside className="drawer" aria-labelledby="evidence-title" data-testid="evidence-drawer">
      <div className="sheet-head">
        <h2 id="evidence-title" tabIndex={-1} ref={heading}>
          Evidence
        </h2>
        <CloseButton onClick={() => router.replace(pathname, { scroll: false })} label="Close evidence" />
      </div>
      <div className="drawer-body">
        {failed && <p className="muted">Could not load this evidence.</p>}
        {developmentId && development.data && <DevelopmentEvidence development={development.data} />}
        {!developmentId && answerEvidence.data && <AnswerEvidenceView evidence={answerEvidence.data} />}
      </div>
    </aside>
  );
}

function AnswerEvidenceView({ evidence }: { evidence: Schema<"AnswerEvidence"> }) {
  const a = evidence.answer;
  const before = a.change.kind === "state_changed" ? a.change.previous_state : null;
  return (
    <>
      <div className="chips">
        <StateBadge state={a.state} newCount={a.new_count} />
        {before && <span className="badge b-new">Changed</span>}
        {a.custom && <span className="tag custom">Custom</span>}
        <span className="cap">
          {a.label}, <SubjectLink subject={evidence.subject} />, last {a.lookback_days} days
        </span>
      </div>
      <h3>{a.summary}</h3>
      <p className="cap question">{a.question}</p>
      {before && (
        <p className="prev">
          <b>Last run: {STATE_LABEL[before]}.</b> {a.change.previous_summary}
        </p>
      )}
      <h4>
        {evidence.developments.length ? `Based on ${plural(evidence.developments.length, "development")}` : "Sources"}
      </h4>
      {evidence.developments.length === 0 && (
        <p className="muted">No developments in the last {a.lookback_days} days bear on this question.</p>
      )}
      {evidence.developments.map((d) => (
        <DevelopmentEvidence key={d.id} development={d} nested />
      ))}
    </>
  );
}

/**
 * One development: its finding, subjects with tag confidence, and each source with highlighted
 * quotes. Nested inside an answer it links to its own drawer, where notes live.
 */
function DevelopmentEvidence({ development: d, nested = false }: { development: Schema<"DevelopmentDetail">; nested?: boolean }) {
  const evidence = useEvidenceHref();
  const facts = [d.materiality_label, d.category, d.stage, longDate(d.last_published)].filter(Boolean).join(", ");
  const body = (
    <>
      <div className="chips">
        <DevelopmentBadge development={d} />
        <span className="cap">{facts}</span>
      </div>
      {nested ? (
        <Link href={evidence.development(d.id)} scroll={false} className="ev-title">
          {d.title}
        </Link>
      ) : (
        <h3>{d.title}</h3>
      )}
      <Confidence development={d} />
      <Section label={plural(d.sources.length, "source")}>
        {d.sources.map((s) => (
          <Source key={s.document_id} source={s} title={d.title} />
        ))}
      </Section>
    </>
  );
  if (nested) return <section className="ev-dev">{body}</section>;
  return (
    <>
      {body}
      <Section label="Notes">
        <Notes target={{ development_id: d.id }} notes={d.notes} />
      </Section>
    </>
  );
}

const percent = (x: number) => `${Math.round(x * 100)}%`;

function Confidence({ development: d }: { development: Schema<"DevelopmentDetail"> }) {
  return (
    <div className="confidence">
      <span className="cap">
        Confidence: materiality {percent(d.materiality_confidence)}
      </span>
      <div className="chips">
        {d.subject_confidence.map((c) => (
          <span key={c.subject.id} className="conf-chip">
            <SubjectLink subject={c.subject} tag />
            <span className="cap" title={`Tagged by ${c.source === "jev" ? "Jev" : c.source === "claude" ? "Claude" : c.source}`}>
              {percent(c.confidence)}
            </span>
          </span>
        ))}
      </div>
    </div>
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
      <span className="cap">
        {longDate(s.published_at)}, {kind}, {s.domain}
        {s.new_in_run ? ", new this run" : ""}
      </span>
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

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="ev-section" aria-label={label}>
      <h4>{label}</h4>
      {children}
    </section>
  );
}

/** A passage with its quote spans wrapped in <mark>. */
function Highlighted({ passage }: { passage: Schema<"Passage"> }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const h of [...passage.highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    parts.push(passage.text.slice(at, h.start));
    parts.push(<mark key={h.start}>{passage.text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  parts.push(passage.text.slice(at));
  return <>{parts}</>;
}
