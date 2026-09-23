"use client";

// A monitor page for a topic, group or entity. Every scope has the same order: What changed,
// Standing questions, Links, Actions. Topics add the stage track and upcoming dates; groups add
// common issues and outliers.
import Link from "next/link";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useMarkReviewed, useMonitorPage } from "@/lib/api/queries";
import { dateTime, daysBetween, inDays, plural, shortDate, STATE_LABEL, STATE_TONE, TYPE_COLOR, TYPE_LABEL, TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { CustomQuestionComposer, CustomQuestionEditor } from "@/components/custom/CustomQuestion";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { Notes } from "@/components/shell/Notes";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { useToast } from "@/components/ui/Toast";
import { DevelopmentRow, StateBadge, stateText } from "@/components/widgets/parts";

import { StageTrack } from "./StageTrack";

type Page = Schema<"MonitorPage">;

export function MonitorView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  const p = page.data;
  if (page.isError) return <p className="page-message">This monitor could not be loaded.</p>;
  if (!p) return null;
  const s = p.subject;
  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>{s.name}</h1>
          <p>
            <span className={`tag ${s.type}`}>{s.kind ? `${TYPE_LABEL[s.type]}, ${s.kind.replaceAll("_", " ")}` : TYPE_LABEL[s.type]}</span>{" "}
            {s.description}
          </p>
        </div>
      </div>
      <div className="monitor">
        <div className="col">
          <WhatChanged page={p} />
          <Questions page={p} />
          {p.stage_track && <StageTrack track={p.stage_track} />}
          {s.type === "topic" && <Upcoming page={p} />}
          {p.group && <GroupInsights group={p.group} />}
        </div>
        <div className="col side">
          <Links subject={s} />
          <Actions page={p} />
        </div>
      </div>
    </>
  );
}

const FIRST_ROWS = 6;

function WhatChanged({ page }: { page: Page }) {
  const wc = page.what_changed;
  const [all, setAll] = useState(false);
  const evidence = useEvidenceHref();
  const shown = all ? wc.developments : wc.developments.slice(0, FIRST_ROWS);
  const base = wc.run.previous_run_id;
  const counts = [
    `${wc.new_count} new`,
    `${wc.updated_count} updated`,
    `${wc.needs_attention_count} ${wc.needs_attention_count === 1 ? "needs" : "need"} attention`,
  ].join(", ");
  return (
    <section className="panel" aria-labelledby="what-changed">
      <div className="panel-head">
        <h2 id="what-changed">What changed since last review</h2>
        <span className="cap">{base ? `Run of ${shortDate(wc.run.as_of)} against ${shortDate(base)}` : `Run of ${shortDate(wc.run.as_of)}`}</span>
      </div>
      <p className="hero sm">{counts}</p>
      {page.reviewed_at && <span className="cap">You marked this reviewed {dateTime(page.reviewed_at)}.</span>}
      {wc.developments.length > 0 ? (
        <div className="rows">
          {shown.map((d) => (
            <DevelopmentRow key={d.id} development={d} />
          ))}
        </div>
      ) : (
        <p className="muted">No new or updated developments in this run.</p>
      )}
      {wc.developments.length > FIRST_ROWS && (
        <button type="button" className="link" aria-expanded={all} onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${wc.developments.length}`}
        </button>
      )}
      {wc.question_changes.length > 0 && (
        <>
          <h3>{plural(wc.question_changes.length, "answer")} changed</h3>
          <div className="rows">
            {wc.question_changes.map((c) => (
              <div key={`${c.subject.id}-${c.question_id}`} className="row qchange">
                <span className="tx">
                  <b>
                    {c.label}
                    {c.subject.id !== page.subject.id && (
                      <>
                        {" · "}
                        <SubjectLink subject={c.subject} />
                      </>
                    )}
                  </b>
                  <span>{c.summary}</span>
                </span>
                <span className="change">
                  <span className={`c-${STATE_TONE[c.from_state]}`}>{STATE_LABEL[c.from_state]}</span> →{" "}
                  <span className={`c-${STATE_TONE[c.to_state]}`}>{STATE_LABEL[c.to_state]}</span>
                </span>
                {c.development_ids.length > 0 ? (
                  <Link href={evidence.answer(c.subject.id, c.question_id)} scroll={false} className="link">
                    See evidence
                  </Link>
                ) : (
                  <span className="cap">No sources</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Questions({ page }: { page: Page }) {
  const evidence = useEvidenceHref();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const changed = page.questions.filter((a) => a.change.kind === "state_changed").length;
  return (
    <section className="panel" aria-labelledby="questions">
      <div className="panel-head">
        <h2 id="questions">Standing questions</h2>
        <span className="cap">
          {plural(page.questions.length, "question")}
          {changed > 0 && `, ${changed} changed`}
        </span>
      </div>
      <div className="rows">
        {page.questions.map((a) => {
          const before = a.change.kind === "state_changed" ? a.change.previous_state : null;
          return (
            <div key={a.question_id} className="qrow" data-question-id={a.question_id}>
              <div className="qlabel">
                <b title={a.question}>{a.label}</b>
                {a.custom && (
                  <>
                    <span className="tag custom">Custom</span>
                    <button type="button" className="link" onClick={() => setEditing(a.question_id)} aria-label={`Edit ${a.label}`}>
                      Edit
                    </button>
                  </>
                )}
              </div>
              <div className="qanswer">
                <p>{a.summary}</p>
                <span className="cap">
                  {a.development_ids.length > 0 ? (
                    <Link href={evidence.answer(page.subject.id, a.question_id)} scroll={false} className="link">
                      See evidence
                    </Link>
                  ) : (
                    "No sources"
                  )}
                  {before && `, last run ${STATE_LABEL[before]}`}
                  {`, last ${a.lookback_days} days`}
                </span>
              </div>
              <div className="qstate">
                <StateBadge state={a.state} newCount={a.new_count} />
                {before && (
                  <span className="badge b-new" title={stateText(a)}>
                    Changed
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {page.questions.length === 0 && <p className="muted">No answers in this run.</p>}
        {adding ? (
          <div className="qrow compose">
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
        ) : (
          <div className="qrow add">
            <button type="button" className="link" onClick={() => setAdding(true)}>
              Add a question
            </button>
            <span className="cap">
              {page.custom_question_slots > 0
                ? `${plural(page.custom_question_slots, "custom question")} left`
                : "No custom questions left. Delete one to add another."}
            </span>
          </div>
        )}
      </div>
      <CustomQuestionEditor questionId={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

function Upcoming({ page }: { page: Page }) {
  const evidence = useEvidenceHref();
  const asOf = page.run.as_of;
  return (
    <section className="panel" aria-labelledby="upcoming">
      <div className="panel-head">
        <h2 id="upcoming">Upcoming dates</h2>
        <span className="cap">Next 90 days</span>
      </div>
      {page.upcoming.length === 0 && <p className="muted">No dates in the next 90 days.</p>}
      <div className="rows">
        {page.upcoming.map((item) => (
          <Link key={`${item.development_id}-${item.date}`} href={evidence.development(item.development_id)} className="row" scroll={false}>
            <span className="date">{shortDate(item.date)}</span>
            <span className="tx">
              <b>{item.label}</b>
              <span>{item.development_title}</span>
            </span>
            <span className="when">{inDays(daysBetween(asOf, item.date))}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function GroupInsights({ group }: { group: Schema<"GroupInsights"> }) {
  return (
    <>
      <section className="panel" aria-labelledby="common-issues">
        <div className="panel-head">
          <h2 id="common-issues">Common issues</h2>
          <span className="cap">Last {group.lookback_days} days</span>
        </div>
        {group.common_issues.length === 0 && <p className="muted">No development touches more than one member.</p>}
        <div className="rows">
          {group.common_issues.map((c) => (
            <DevelopmentRow key={c.development.id} development={c.development} subjects={c.members} />
          ))}
        </div>
      </section>
      <section className="panel" aria-labelledby="outliers">
        <div className="panel-head">
          <h2 id="outliers">Outliers</h2>
          <span className="cap">Last {group.lookback_days} days</span>
        </div>
        {group.outliers.length === 0 && <p className="muted">No member stands out from its peers.</p>}
        <div className="rows">
          {group.outliers.map((o) => (
            <div key={o.member.id} className="row">
              <span className="tx">
                <b>
                  <SubjectLink subject={o.member} />
                </b>
                <span>{o.reason}</span>
              </span>
              {o.needs_attention > 0 && <span className="badge b-attn">{o.needs_attention} need attention</span>}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const LINK_TYPES: SubjectType[] = ["topic", "group", "entity"];
const LINK_KEY = { topic: "topics", group: "groups", entity: "entities" } as const;

function Links({ subject }: { subject: Schema<"SubjectDetail"> }) {
  return (
    <section className="panel" aria-labelledby="links">
      <div className="panel-head">
        <h2 id="links">Links</h2>
        <Link href={`${monitorHref(subject.id)}/graph`} className="link">
          Open graph view
        </Link>
      </div>
      {LINK_TYPES.map((type) => {
        const list = subject.links[LINK_KEY[type]];
        if (!list.length) return null;
        return (
          <div key={type} className="linkgroup">
            <h3>
              <span className="dot" style={{ background: TYPE_COLOR[type] }} />
              {TYPE_PLURAL[type]}
            </h3>
            <div className="chips">
              {list.map((s) => (
                <SubjectLink key={s.id} subject={s} tag />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Actions({ page }: { page: Page }) {
  const review = useMarkReviewed();
  const toast = useToast();
  return (
    <section className="panel" aria-labelledby="actions">
      <div className="panel-head">
        <h2 id="actions">Actions</h2>
      </div>
      <div className="review">
        <button
          type="button"
          className="btn sm primary"
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
        <span className="cap">
          {page.reviewed_at ? `Reviewed ${dateTime(page.reviewed_at)}` : "Not reviewed yet"}
        </span>
      </div>
      <Notes target={{ subject_id: page.subject.id }} notes={page.notes} />
    </section>
  );
}
