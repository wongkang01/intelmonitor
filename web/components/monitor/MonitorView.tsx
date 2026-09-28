"use client";

// A monitor page for a topic, group or entity. Every scope has the same order: What changed,
// Indicators (where series are mapped), Standing questions, Links, Actions. Topics add the stage
// track and upcoming dates; groups add common issues and outliers. The main panel holds the first
// three and the scope extras; a sticky rail panel holds Links and Actions. The head's Follow button decides whether the subject alerts.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useFollow, useFollows, useMarkReviewed, useMonitorPage, useUndoReview } from "@/lib/api/queries";
import { trackRailHeight } from "@/lib/dom";
import { answerText, capitalize, daysBetween, inDays, plural, shortDate, TYPE_PLURAL, whenAt } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { CustomQuestionComposer, CustomQuestionEditor } from "@/components/custom/CustomQuestion";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { useAnswerCorrection } from "@/components/shell/Feedback";
import { Notes } from "@/components/shell/Notes";
import { SubjectLink, SubjectLinks } from "@/components/shell/SubjectLink";
import { PlusIcon, TickIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { DevelopmentRow, StateBadge } from "@/components/widgets/parts";

import { Indicators } from "./Indicators";
import { StageTrack } from "./StageTrack";
import { hasUnreviewed, WhatChanged } from "./WhatChanged";
import { Dotted, Section, StateChange } from "./parts";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

type Page = Schema<"MonitorPage">;

export function MonitorView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  const p = page.data;
  if (page.isError) return <p className="page-message">This monitor could not be loaded.</p>;
  if (!p) return null;
  return (
    <>
      <div className="mon-head">
        <div className="mon-head-main">
          {p.subject.logo_full && (
            // Local logo files need no image optimization; the name below carries the meaning.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className={`mon-logo${p.subject.kind === "country" ? " flag" : ""}`}
              src={p.subject.logo_full}
              alt=""
            />
          )}
          <h1>
            {!p.subject.logo_full && <SubjectIcon subject={p.subject} size={28} />}
            {p.subject.name}
          </h1>
          <p>
            <Summary subject={p.subject} />
          </p>
        </div>
        <FollowButton subjectId={p.subject.id} />
      </div>
      <div className="monitor">
        <div className="panel mon-main">
          <WhatChanged wc={p.what_changed} subjectId={p.subject.id} />
          <Indicators subjectId={p.subject.id} asOf={p.run.as_of} />
          <Questions page={p} />
          {p.group && <GroupInsights group={p.group} />}
          {p.stage_track && <StageTrack track={p.stage_track} />}
          {p.subject.type === "topic" && <Upcoming page={p} />}
        </div>
        <aside className="panel mon-rail" aria-label="Links and actions" ref={trackRailHeight}>
          <Links subject={p.subject} />
          <Actions page={p} />
        </aside>
      </div>
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
  // A question deleted in the editor: once it leaves the list, focus goes to Add a question.
  const deleted = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const id = deleted.current;
    if (!id || page.questions.some((a) => a.question_id === id)) return;
    deleted.current = null;
    addButton.current?.focus();
  });
  const changed = page.questions.filter((a) => a.change.kind === "state_changed").length;
  return (
    <Section id="questions" title="Standing questions" meta={changed > 0 ? `${plural(changed, "answer")} changed` : plural(page.questions.length, "question")}>
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
              onCancel={() => setAdding(false)}
              onKept={(q) => {
                setAdding(false);
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
            Add a question
          </button>
          <span className="meta">
            {page.custom_question_slots > 0
              ? `${plural(page.custom_question_slots, "custom question")} left`
              : "No custom questions left. Delete one to add another."}
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
  const evidence = useEvidenceHref();
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
              a.development_ids.length > 0 ? (
                <Link key="e" href={evidence.answer(subjectId, a.question_id)} scroll={false} className="link">
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
  const evidence = useEvidenceHref();
  const asOf = page.run.as_of;
  return (
    <Section id="upcoming" title="Upcoming dates" meta="Next 90 days">
      {page.upcoming.length === 0 && <p className="mon-empty">No dates in the next 90 days.</p>}
      <div className="rows">
        {page.upcoming.map((item) => (
          <Link key={`${item.development_id}-${item.date}`} href={evidence.development(item.development_id)} className="row" scroll={false}>
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

function GroupInsights({ group }: { group: Schema<"GroupInsights"> }) {
  return (
    <>
      <Section id="common-issues" title="Common issues" meta={`Last ${group.lookback_days} days`}>
        {group.common_issues.length === 0 && <p className="mon-empty">No development touches more than one member.</p>}
        <div className="rows">
          {group.common_issues.map((c) => (
            <DevelopmentRow key={c.development.id} development={c.development} subjects={c.members} />
          ))}
        </div>
      </Section>
      <Section id="outliers" title="Outliers" meta={`Last ${group.lookback_days} days`}>
        {group.outliers.length === 0 && <p className="mon-empty">No member stands out from its peers.</p>}
        <div className="rows">
          {group.outliers.map((o) => (
            <div key={o.member.id} className="row">
              <span className="stat">
                {o.needs_attention > 0 && <span className="badge b-attn">{o.needs_attention} need attention</span>}
              </span>
              <span>
                <span className="row-title">
                  <SubjectLink subject={o.member} />
                </span>
                <span className="row-meta">{o.reason}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

const LINK_TYPES: SubjectType[] = ["topic", "group", "entity"];
const LINK_KEY = { topic: "topics", group: "groups", entity: "entities" } as const;

function Links({ subject }: { subject: Schema<"SubjectDetail"> }) {
  const types = LINK_TYPES.filter((type) => subject.links[LINK_KEY[type]].length > 0);
  return (
    <Section id="links" title="Links">
      {types.length > 0 ? (
        <dl className="mon-links">
          {types.map((type) => (
            <div key={type}>
              <dt>{TYPE_PLURAL[type]}</dt>
              <dd>
                {subject.links[LINK_KEY[type]].map((s) => (
                  <SubjectLink key={s.id} subject={s} />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mon-empty">No linked subjects.</p>
      )}
      <Link href={`${monitorHref(subject.id)}/graph`} className="link">
        Open graph view
      </Link>
    </Section>
  );
}

function Actions({ page }: { page: Page }) {
  const review = useMarkReviewed();
  const undo = useUndoReview();
  const toast = useToast();
  const wc = page.what_changed;
  const cleared = wc.new_count + wc.updated_count;
  return (
    <Section id="actions" title="Actions">
      <div className="mon-actions">
        <div className="review">
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
          <span className="meta">{wc.reviewed_at ? `Reviewed ${whenAt(wc.reviewed_at)}` : "Not reviewed yet"}</span>
        </div>
        <Notes target={{ subject_id: page.subject.id }} notes={page.notes} />
      </div>
    </Section>
  );
}
