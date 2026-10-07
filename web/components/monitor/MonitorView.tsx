// A monitor page for a topic, group or entity, in four tabs under its head: Overview (here),
// Developments, Data and Connections (other views, each rendering MonitorHead with its tab).
// The Overview has two columns: the run's Summary, Focus areas (standing questions) and, for
// topics, the stage track and upcoming dates on the left; Key data, Needs attention, a small
// Connections graph and Notes on the right. Under 900px they stack. The head holds Follow, which
// decides whether the subject alerts, and Mark reviewed.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useFollow, useFollows, useIndicators, useMarkReviewed, useMonitorPage, useUndoReview } from "@/lib/api/queries";
import { useHashScroll } from "@/lib/dom";
import { answerText, capitalize, daysBetween, inDays, plural, shortDate, whenAt } from "@/lib/format";
import { CustomQuestionComposer, CustomQuestionEditor } from "@/components/custom/CustomQuestion";
import { evidenceLink } from "@/components/shell/Evidence";
import { useAnswerCorrection } from "@/components/shell/Feedback";
import { Notes } from "@/components/shell/Notes";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { PlusIcon, TickIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { StateBadge } from "@/components/widgets/parts";

import { ConnectionsCard } from "./overview/ConnectionsCard";
import { KeyData } from "./overview/KeyData";
import { NeedsAttention } from "./overview/NeedsAttention";
import { RunSummary } from "./overview/RunSummary";
import { StageTrack } from "./StageTrack";
import { hasUnreviewed } from "./WhatChanged";
import { Dotted, Section, StateChange } from "./parts";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

type Page = Schema<"MonitorPage">;

export function MonitorView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  useHashScroll();
  const p = page.data;
  if (page.isError) return <p className="page-message">This monitor could not be loaded.</p>;
  if (!p) return null;
  const topic = p.subject.type === "topic";
  return (
    <>
      <MonitorHead page={p} view="overview" />
      <div className="ov">
        <div className="ov-col">
          {p.summary && <RunSummary summary={p.summary} run={p.run} />}
          <div className="panel ov-card">
            <Questions page={p} />
          </div>
          {topic && p.stage_track && (
            <div className="panel ov-card">
              <StageTrack track={p.stage_track} />
            </div>
          )}
          {topic && (
            <div className="panel ov-card">
              <Upcoming page={p} />
            </div>
          )}
        </div>
        <div className="ov-col">
          <KeyData subjectId={p.subject.id} asOf={p.run.as_of} />
          <NeedsAttention subjectId={p.subject.id} />
          <ConnectionsCard subject={p.subject} />
          <div className="panel ov-card">
            <Section id="notes" title="Notes">
              <Notes target={{ subject_id: p.subject.id }} notes={p.notes} />
            </Section>
          </div>
        </div>
      </div>
    </>
  );
}

export type MonitorTab = "overview" | "developments" | "data" | "connections";

/**
 * The page head: logo, name and summary line with Mark reviewed and Follow at its right, over the
 * tabs. Data shows when the subject has listed series; Connections shows for groups and entities.
 */
export function MonitorHead({ page: p, view }: { page: Page; view: MonitorTab }) {
  const params = { id: p.subject.id };
  const indicators = useIndicators(p.subject.id, p.run.as_of);
  const hasData = p.trend || (indicators.data?.indicators.some((i) => i.series.listed) ?? false);
  const current = (tab: MonitorTab) => (view === tab ? ("page" as const) : undefined);
  return (
    <div className="mon-head">
      <div className="mon-head-top">
        <div className="mon-head-main">
          {p.subject.logo_full && (
            // Local logo files need no image optimization; the name below carries the meaning.
            <img className={`mon-logo${p.subject.kind === "country" ? " flag" : ""}`} src={p.subject.logo_full} alt="" />
          )}
          <h1>
            {!p.subject.logo_full && <SubjectIcon subject={p.subject} size={28} />}
            {p.subject.name}
          </h1>
          <p>
            <Summary subject={p.subject} />
          </p>
        </div>
        <div className="mon-head-acts">
          <ReviewButton page={p} />
          <FollowButton subjectId={p.subject.id} />
        </div>
      </div>
      <nav className="mon-nav" aria-label="Monitor views">
        <Link to="/monitors/$id" params={params} activeOptions={{ exact: true }} aria-current={current("overview")}>
          Overview
        </Link>
        <Link to="/monitors/$id/developments" params={params} aria-current={current("developments")}>
          Developments
        </Link>
        {hasData && (
          <Link to="/monitors/$id/data" params={params} aria-current={current("data")}>
            Data
          </Link>
        )}
        {p.subject.type !== "topic" && (
          <Link to="/monitors/$id/connections" params={params} aria-current={current("connections")}>
            Connections
          </Link>
        )}
      </nav>
    </div>
  );
}

/** Mark reviewed clears What changed for the subject, with Undo in the toast; the last review beside it. */
function ReviewButton({ page }: { page: Page }) {
  const review = useMarkReviewed();
  const undo = useUndoReview();
  const toast = useToast();
  const wc = page.what_changed;
  const cleared = wc.new_count + wc.updated_count;
  return (
    <>
      <span className="meta">{wc.reviewed_at ? `Reviewed ${whenAt(wc.reviewed_at)}` : "Not reviewed yet"}</span>
      <button
        type="button"
        className="btn btn-primary"
        disabled={review.isPending || !hasUnreviewed(wc)}
        onClick={() =>
          review.mutate([page.subject.id], {
            onSuccess: (reviews) =>
              toast({
                message: `${page.subject.name} marked reviewed.${cleared > 0 ? ` ${cleared} new cleared.` : ""}`,
                action: { label: "Undo", run: () => undo.mutate(reviews.map((r) => r.id)) },
              }),
            onError: () => toast({ message: "Could not mark reviewed" }),
          })
        }
      >
        Mark reviewed
      </button>
    </>
  );
}

/** Follow or unfollow the subject; alerts cover followed subjects only. */
function FollowButton({ subjectId }: { subjectId: string }) {
  const follows = useFollows();
  const follow = useFollow();
  if (!follows.data) return null;
  const following = follows.data.some((s) => s.id === subjectId);
  return (
    <button
      type="button"
      className="btn follow"
      aria-pressed={following}
      onClick={() => {
        if (!follow.isPending) follow.mutate({ subjectId, follow: !following });
      }}
    >
      {following ? <TickIcon /> : <PlusIcon />}
      {following ? "Following" : "Follow"}
    </button>
  );
}

/** One line under the title: "Bank in Singapore banks", a group's members, or a topic's scope. */
function Summary({ subject: s }: { subject: Schema<"SubjectDetail"> }) {
  if (s.type === "group" && s.links.entities.length > 0) return <SubjectLinks subjects={s.links.entities} />;
  if (s.type === "entity") {
    const kind = capitalize((s.kind ?? "entity").replaceAll("_", " "));
    return s.links.groups.length > 0 ? (
      <>
        {kind} in <SubjectLinks subjects={s.links.groups} />
      </>
    ) : (
      kind
    );
  }
  return s.description;
}

function Questions({ page }: { page: Page }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  // A question deleted in the editor: once it leaves the list, focus goes to Add a focus area.
  // So does closing the composer, which held focus.
  const deleted = useRef<string | null>(null);
  const closed = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (closed.current && addButton.current) {
      closed.current = false;
      addButton.current.focus();
    }
    const id = deleted.current;
    if (!id || page.questions.some((a) => a.question_id === id)) return;
    deleted.current = null;
    addButton.current?.focus();
  });
  const close = () => {
    closed.current = true;
    setAdding(false);
  };
  const changed = page.questions.filter((a) => a.change.kind === "state_changed").length;
  return (
    <Section id="questions" title="Focus areas" meta={changed > 0 ? `${plural(changed, "answer")} changed` : plural(page.questions.length, "focus area")}>
      <div className="rows">
        {page.questions.map((a) => (
          <QuestionRow key={a.question_id} subjectId={page.subject.id} answer={a} onEdit={() => setEditing(a.question_id)} />
        ))}
        {page.questions.length === 0 && <p className="mon-empty">No answers in this run.</p>}
        {adding && (
          <div className="row qrow compose">
            <span className="stat">
              <span className="badge b-neutral">Custom</span>
            </span>
            <CustomQuestionComposer
              subject={page.subject}
              autoFocus
              onCancel={close}
              onKept={(q) => {
                close();
                toast({ message: `${q.label} added to ${page.subject.name}` });
              }}
            />
          </div>
        )}
      </div>
      {!adding && (
        <div className="mon-more add-question">
          <button type="button" ref={addButton} className="btn btn-sm btn-ghost add-q" onClick={() => setAdding(true)}>
            <PlusIcon size={14} />
            Add a focus area
          </button>
          <span className="meta">
            {page.custom_question_slots > 0
              ? `${plural(page.custom_question_slots, "custom focus area")} left`
              : "No custom focus areas left. Delete one to add another."}
          </span>
        </div>
      )}
      <CustomQuestionEditor
        questionId={editing}
        onClose={() => setEditing(null)}
        onDeleted={() => {
          deleted.current = editing;
        }}
      />
    </Section>
  );
}

/** One standing question: state, label, question, answer, then meta with See evidence and Mark wrong. */
function QuestionRow({ subjectId, answer: a, onEdit }: { subjectId: string; answer: Schema<"QuestionAnswerView">; onEdit: () => void }) {
  const correction = useAnswerCorrection(subjectId, a);
  const before = a.change.kind === "state_changed" ? a.change.previous_state : null;
  return (
    <div className="row qrow" data-question-id={a.question_id}>
      <span className="stat">
        <StateBadge state={a.state} newCount={a.new_count} />
      </span>
      <div className="qbody">
        <div className="qlabel">
          <b>{a.label}</b>
          {a.custom && (
            <>
              <span className="badge b-neutral">Custom</span>
              <button type="button" className="link" onClick={onEdit} aria-label={`Edit ${a.label}`}>
                Edit
              </button>
            </>
          )}
        </div>
        <p className="qquestion">{a.question}</p>
        <div className="qanswer">
          <p>{answerText(a.summary)}</p>
        </div>
        <p className="meta qmeta">
          <Dotted
            parts={[
              before && <StateChange key="s" state={a.state} from={before} />,
              `Last ${a.lookback_days} days`,
              a.development_ids.length + a.series_ids.length > 0 ? (
                <Link key="e" {...evidenceLink.answer(subjectId, a.question_id)} className="link">
                  See evidence
                </Link>
              ) : (
                "No sources"
              ),
              correction.link,
            ]}
          />
          {correction.line}
        </p>
        {correction.form}
      </div>
    </div>
  );
}

function Upcoming({ page }: { page: Page }) {
  const asOf = page.run.as_of;
  return (
    <Section id="upcoming" title="Upcoming dates" meta="Next 90 days">
      {page.upcoming.length === 0 && <p className="mon-empty">No dates in the next 90 days.</p>}
      <div className="rows">
        {page.upcoming.map((item) => (
          <Link key={`${item.development_id}-${item.date}`} {...evidenceLink.development(item.development_id)} className="row">
            <span className="stat date">{shortDate(item.date)}</span>
            <span>
              <span className="row-title">{item.label}</span>
              <span className="row-meta">{item.development_title}</span>
            </span>
            <span className="row-end">{inDays(daysBetween(asOf, item.date))}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
