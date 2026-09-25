"use client";

// A monitor page for a topic, group or entity. Every scope has the same order: What changed,
// Standing questions, Links, Actions. Topics add the stage track and upcoming dates; groups add
// common issues and outliers. The main panel holds the first two and the scope extras; a sticky
// rail panel holds Links and Actions.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useMarkReviewed, useMonitorPage } from "@/lib/api/queries";
import { answerText, capitalize, dateTime, daysBetween, inDays, plural, shortDate, TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { CustomQuestionComposer, CustomQuestionEditor } from "@/components/custom/CustomQuestion";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { Notes } from "@/components/shell/Notes";
import { SubjectLink, SubjectLinks } from "@/components/shell/SubjectLink";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";
import { DevelopmentRow, StateBadge } from "@/components/widgets/parts";

import { StageTrack } from "./StageTrack";
import { Dotted, Section, StateChange } from "./parts";
import { EntityIcon } from "@/components/ui/EntityIcon";

type Page = Schema<"MonitorPage">;

export function MonitorView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  const p = page.data;
  if (page.isError) return <p className="page-message">This monitor could not be loaded.</p>;
  if (!p) return null;
  return (
    <>
      <div className="mon-head">
        <h1>
          <EntityIcon subject={p.subject} size={28} />
          {p.subject.name}
        </h1>
        <p>
          <Summary subject={p.subject} />
        </p>
      </div>
      <div className="monitor">
        <div className="panel mon-main">
          <WhatChanged page={p} />
          <Questions page={p} />
          {p.group && <GroupInsights group={p.group} />}
          {p.stage_track && <StageTrack track={p.stage_track} />}
          {p.subject.type === "topic" && <Upcoming page={p} />}
        </div>
        <aside className="panel mon-rail" aria-label="Links and actions">
          <Links subject={p.subject} />
          <Actions page={p} />
        </aside>
      </div>
    </>
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

const FIRST_ROWS = 6;

function WhatChanged({ page }: { page: Page }) {
  const wc = page.what_changed;
  const [all, setAll] = useState(false);
  const evidence = useEvidenceHref();
  const shown = all ? wc.developments : wc.developments.slice(0, FIRST_ROWS);
  const base = wc.run.previous_run_id;
  const counts = [
    wc.new_count > 0 && `${wc.new_count} new`,
    wc.updated_count > 0 && `${wc.updated_count} updated`,
    wc.needs_attention_count > 0 && `${wc.needs_attention_count} ${wc.needs_attention_count === 1 ? "needs" : "need"} attention`,
  ].filter(Boolean);
  return (
    <Section
      id="what-changed"
      title="What changed since last review"
      meta={base ? `Run of ${shortDate(wc.run.as_of)} against ${shortDate(base)}` : `Run of ${shortDate(wc.run.as_of)}`}
    >
      <p className="mon-lead">{counts.length > 0 ? counts.join(", ") : "Nothing new or updated"}</p>
      {wc.developments.length > 0 && (
        <div className="rows">
          {shown.map((d) => (
            <DevelopmentRow key={d.id} development={d} />
          ))}
        </div>
      )}
      {wc.developments.length > FIRST_ROWS && (
        <p className="mon-more">
          <button type="button" className="link" aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${wc.developments.length}`}
          </button>
        </p>
      )}
      {wc.question_changes.length > 0 && (
        <>
          <h3 className="mon-sub">{plural(wc.question_changes.length, "answer")} changed</h3>
          <div className="rows">
            {wc.question_changes.map((c) => (
              <div key={`${c.subject.id}-${c.question_id}`} className="row qrow">
                <span className="stat">
                  <StateBadge state={c.to_state} />
                </span>
                <div className="qbody">
                  <div className="qlabel">
                    <b>{c.label}</b>
                    {c.subject.id !== page.subject.id && (
                      <span className="meta">
                        <SubjectLink subject={c.subject} />
                      </span>
                    )}
                  </div>
                  <div className="qanswer">
                    <p>{answerText(c.summary)}</p>
                  </div>
                  <p className="meta qmeta">
                    <Dotted
                      parts={[
                        <StateChange key="s" state={c.to_state} from={c.from_state} />,
                        c.development_ids.length > 0 ? (
                          <Link key="e" href={evidence.answer(c.subject.id, c.question_id)} scroll={false} className="link">
                            See evidence
                          </Link>
                        ) : (
                          "No sources"
                        ),
                      ]}
                    />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

function Questions({ page }: { page: Page }) {
  const evidence = useEvidenceHref();
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
        {page.questions.map((a) => {
          const before = a.change.kind === "state_changed" ? a.change.previous_state : null;
          return (
            <div key={a.question_id} className="row qrow" data-question-id={a.question_id}>
              <span className="stat">
                <StateBadge state={a.state} newCount={a.new_count} />
              </span>
              <div className="qbody">
                <div className="qlabel">
                  <b>{a.label}</b>
                  {a.custom && (
                    <>
                      <span className="badge b-neutral">Custom</span>
                      <button type="button" className="link" onClick={() => setEditing(a.question_id)} aria-label={`Edit ${a.label}`}>
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
                        <Link key="e" href={evidence.answer(page.subject.id, a.question_id)} scroll={false} className="link">
                          See evidence
                        </Link>
                      ) : (
                        "No sources"
                      ),
                    ]}
                  />
                </p>
              </div>
            </div>
          );
        })}
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
  const toast = useToast();
  return (
    <Section id="actions" title="Actions">
      <div className="mon-actions">
        <div className="review">
          <button
            type="button"
            className="btn btn-primary"
            disabled={review.isPending}
            onClick={() =>
              review.mutate([page.subject.id], {
                onSuccess: () => toast({ message: `${page.subject.name} marked reviewed` }),
                onError: () => toast({ message: "Could not mark reviewed" }),
              })
            }
          >
            Mark reviewed
          </button>
          <span className="meta">{page.reviewed_at ? `Reviewed ${dateTime(page.reviewed_at)}` : "Not reviewed yet"}</span>
        </div>
        <Notes target={{ subject_id: page.subject.id }} notes={page.notes} />
      </div>
    </Section>
  );
}
