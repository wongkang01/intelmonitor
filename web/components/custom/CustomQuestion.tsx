"use client";

// Custom standing questions. CustomQuestionComposer is the write, preview, Keep or Discard flow
// under "Add a question" on monitor pages and in the widget gallery. CustomQuestionEditor is the
// dialog that edits or deletes a kept question, opened from its row or its widget's settings.
// Both pick the subject's series whose facts the answers get with the gallery's series select.
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";

import {
  errorMessage,
  useCustomQuestion,
  useCustomSlots,
  useDeleteCustomQuestion,
  useDraftCustomQuestion,
  useEditCustomQuestion,
  useIndicators,
  useKeepCustomQuestion,
  type CustomQuestion,
} from "@/lib/api/queries";
import { answerText, plural, SCOPE_LABEL, shortDate } from "@/lib/format";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Dotted, StateChange } from "@/components/monitor/parts";
import { DevelopmentRow, SeriesSelect, StateBadge } from "@/components/widgets/parts";

const MIN_LENGTH = 5;
/** The most series a question names (MAX_SERIES in api/intelmonitor/pipeline/custom.py). */
const MAX_SERIES = 3;

export function CustomQuestionComposer({
  subject,
  onKept,
  onCancel,
  linkCitations = true,
  autoFocus = false,
}: {
  subject: { id: string; name: string };
  onKept: (question: CustomQuestion) => void;
  onCancel?: () => void;
  /** Citations open the evidence drawer; off where a dialog would cover the drawer. */
  linkCitations?: boolean;
  autoFocus?: boolean;
}) {
  const slots = useCustomSlots();
  const draft = useDraftCustomQuestion();
  const keep = useKeepCustomQuestion();
  const discard = useDeleteCustomQuestion();
  const [text, setText] = useState("");
  // Series rows as picked; an empty row picks nothing. None picked lets the draft pick those the
  // question names.
  const [series, setSeries] = useState<string[]>([]);
  const [preview, setPreview] = useState<CustomQuestion | null>(null);

  if (slots.data && slots.data.left === 0 && !preview) {
    return (
      <div className="cq">
        <p className="cq-note" role="status">
          You have {slots.data.limit} custom questions, the most allowed. Delete one to add another.
        </p>
        {onCancel && (
          <div className="cq-actions">
            <button type="button" className="btn btn-sm" onClick={onCancel}>
              Close
            </button>
          </div>
        )}
      </div>
    );
  }

  if (preview) {
    return (
      <div className="cq" aria-label="Custom question preview" role="group">
        <Preview question={preview} linkCitations={linkCitations} />
        {(keep.isError || discard.isError) && (
          <p className="cq-note" role="alert">
            {errorMessage(keep.error ?? discard.error, "Something went wrong. Try again.")}
          </p>
        )}
        <div className="cq-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={discard.isPending || keep.isPending}
            onClick={() => discard.mutate(preview.id, { onSuccess: () => setPreview(null) })}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={discard.isPending || keep.isPending}
            onClick={() =>
              keep.mutate(preview.id, {
                onSuccess: (kept) => {
                  setPreview(null);
                  setText("");
                  setSeries([]);
                  onKept(kept);
                },
              })
            }
          >
            Keep
          </button>
        </div>
      </div>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < MIN_LENGTH || draft.isPending) return;
    const picked = series.filter(Boolean);
    draft.mutate(
      { text: text.trim(), subject_id: subject.id, series_ids: picked.length > 0 ? picked : undefined },
      { onSuccess: setPreview },
    );
  };

  return (
    <form className="cq" onSubmit={submit}>
      <label className="form-field">
        Your question about {subject.name}
        <textarea
          className="input"
          value={text}
          rows={2}
          maxLength={500}
          disabled={draft.isPending}
          placeholder="Ask about an angle the standing questions miss"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          autoFocus={autoFocus}
        />
      </label>
      <SeriesPicker subjectId={subject.id} value={series} onChange={setSeries} none="Named in the question" disabled={draft.isPending} />
      {draft.isPending && (
        <p className="cq-note" role="status">
          Drafting the question and answering it for every run. This can take a minute.
        </p>
      )}
      {draft.isError && (
        <p className="cq-note" role="alert">
          {errorMessage(draft.error, "Could not draft the question. Try again.")}
        </p>
      )}
      <div className="cq-actions">
        {slots.data && <span className="meta grow">{plural(slots.data.left, "custom question")} left</span>}
        {onCancel && (
          <button type="button" className="btn btn-sm" onClick={onCancel} disabled={draft.isPending}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-sm" disabled={text.trim().length < MIN_LENGTH || draft.isPending}>
          Draft question
        </button>
      </div>
    </form>
  );
}

/**
 * The series a question names, one gallery series select each, and Add series up to MAX_SERIES.
 * `none` words the first select's empty option: what naming no series means where it is used.
 * Subjects without listed series show nothing.
 */
function SeriesPicker({
  subjectId,
  value,
  onChange,
  none,
  disabled,
}: {
  subjectId: string;
  value: string[];
  onChange: (series: string[]) => void;
  none: string;
  disabled?: boolean;
}) {
  const indicators = useIndicators(subjectId);
  const labelId = useId();
  const listed = indicators.data?.indicators.filter((i) => i.series.listed) ?? [];
  if (listed.length === 0) return null;
  const rows = value.length > 0 ? value : [""];
  const change = (at: number, id: string) => {
    const next = rows.map((r, i) => (i === at ? id : r));
    // Picking None on a later row removes it; the first row stays, empty.
    onChange(id || at === 0 ? next : next.filter((_, i) => i !== at));
  };
  return (
    <div className="form-field" role="group" aria-labelledby={labelId}>
      <span id={labelId}>Series</span>
      <div className="cq-series-rows">
        {rows.map((id, i) => (
          <SeriesSelect
            key={i}
            // Each series once: a row offers its own and those no other row picked.
            listed={listed.filter((l) => l.series.id === id || !rows.includes(l.series.id))}
            value={id}
            onChange={(next) => change(i, next)}
            label={i === 0 ? "Series" : `Series ${i + 1}`}
            none={i === 0 ? none : "None"}
            disabled={disabled}
          />
        ))}
        {rows.every(Boolean) && rows.length < Math.min(MAX_SERIES, listed.length) && (
          <button type="button" className="link" disabled={disabled} onClick={() => onChange([...rows, ""])}>
            Add series
          </button>
        )}
      </div>
    </div>
  );
}

/** The drafted config, the answer for each run (latest first) and what the latest cites. */
function Preview({ question: q, linkCitations }: { question: CustomQuestion; linkCitations: boolean }) {
  const runs = [...q.runs].reverse();
  const cited = q.series.filter((s) => runs[0]?.series_ids.includes(s.id));
  const cites = [
    q.evidence.length > 0 && plural(q.evidence.length, "development"),
    cited.length > 0 && plural(cited.length, "series", "series"),
  ].filter(Boolean);
  return (
    <>
      <dl className="cq-config">
        <dt>Question</dt>
        <dd>{q.question}</dd>
        <dt>Label</dt>
        <dd>{q.label}</dd>
        <dt>Subject</dt>
        <dd>{q.subject.name}</dd>
        <dt>Lookback</dt>
        <dd>{plural(q.lookback_days, "day")}</dd>
        {q.series.length > 0 && (
          <>
            <dt>Series</dt>
            <dd>{q.series.map((s) => s.name).join(", ")}</dd>
          </>
        )}
      </dl>
      <div className="rows cq-runs">
        {runs.map((r, i) => {
          const before = runs[i + 1];
          return (
            <div key={r.run.id} className="row cq-run">
              <span className="stat">
                <StateBadge state={r.state} newCount={r.state === "new" ? r.development_ids.length : 0} />
              </span>
              <span>
                <span className="row-title">{answerText(r.summary)}</span>
                <span className="row-meta">
                  <Dotted
                    parts={[
                      `Run of ${shortDate(r.run.as_of)}`,
                      before && before.state !== r.state && <StateChange key="s" state={r.state} from={before.state} />,
                    ]}
                  />
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {cites.length > 0 ? (
        <div className="cq-cites">
          <h4 className="cq-label">Cites {cites.join(" and ")}</h4>
          <div className="rows">
            {q.evidence.map((d) => (
              <DevelopmentRow key={d.id} development={d} link={linkCitations} />
            ))}
            {cited.map((s) => (
              <div key={s.id} className="row no-stat">
                <span>
                  <span className="row-title">{s.name}</span>
                  <span className="row-meta">
                    <Dotted parts={["Data", s.source_label, s.scope && SCOPE_LABEL[s.scope]]} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="cq-note">No sources in the latest run.</p>
      )}
    </>
  );
}

/** Edits a kept custom question's wording, label, lookback and series, or deletes it. `onDeleted` runs
 *  after a delete, before `onClose`, so the opener can place focus once the question is gone. */
export function CustomQuestionEditor({
  questionId,
  onClose,
  onDeleted,
}: {
  questionId: string | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const question = useCustomQuestion(questionId);
  return (
    <Modal open={questionId !== null} onClose={onClose} labelledBy="cq-edit-title" className="panel">
      <div className="sheet-head">
        <h2 id="cq-edit-title">Edit custom question</h2>
        <CloseButton onClick={onClose} />
      </div>
      {question.isError && <p className="panel-body cq-note">This question could not be loaded.</p>}
      {question.data && (
        <EditForm key={question.data.id} question={question.data} onClose={onClose} onDeleted={onDeleted} />
      )}
    </Modal>
  );
}

function EditForm({
  question: q,
  onClose,
  onDeleted,
}: {
  question: CustomQuestion;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const edit = useEditCustomQuestion();
  const remove = useDeleteCustomQuestion();
  const toast = useToast();
  const [wording, setWording] = useState(q.question);
  const [label, setLabel] = useState(q.label);
  const [lookback, setLookback] = useState(String(q.lookback_days));
  const [series, setSeries] = useState(q.series.map((s) => s.id));
  const [confirming, setConfirming] = useState(false);
  const days = Number(lookback);
  const picked = series.filter(Boolean);
  const valid = wording.trim().length >= MIN_LENGTH && label.trim().length > 0 && Number.isInteger(days) && days >= 1 && days <= 60;
  const reanswers =
    wording.trim() !== q.question || days !== q.lookback_days || picked.join() !== q.series.map((s) => s.id).join();
  const busy = edit.isPending || remove.isPending;
  const foot = useRef<HTMLDivElement>(null);

  // The footer swaps its buttons, so focus moves to the first of the new set: Keep it, or back to
  // Delete question.
  const confirm = (on: boolean) => {
    flushSync(() => setConfirming(on));
    foot.current?.querySelector("button")?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    edit.mutate(
      { id: q.id, change: { question: wording.trim(), label: label.trim(), lookback_days: days, series_ids: picked } },
      {
        onSuccess: () => {
          toast({ message: `${label.trim()} saved` });
          onClose();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="cq-edit">
      <div className="panel-body">
        <span className="meta">
          {q.subject.name}. You asked: “{q.request}”
        </span>
        <label className="form-field">
          Question
          <textarea className="input" value={wording} rows={3} maxLength={500} onChange={(e) => setWording(e.target.value)} autoFocus />
        </label>
        <div className="cq-row">
          <label className="form-field grow">
            Label
            <input className="input" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className="form-field">
            Lookback in days
            <input className="input" type="number" min={1} max={60} value={lookback} onChange={(e) => setLookback(e.target.value)} />
          </label>
        </div>
        <SeriesPicker subjectId={q.subject.id} value={series} onChange={setSeries} none="None" disabled={edit.isPending} />
        {edit.isPending && reanswers && (
          <p className="cq-note" role="status">
            Answering again for every run. This can take a minute.
          </p>
        )}
        {(edit.isError || remove.isError) && (
          <p className="cq-note" role="alert">
            {errorMessage(edit.error ?? remove.error, "Could not save. Try again.")}
          </p>
        )}
      </div>
      <div className="panel-foot" ref={foot}>
        {confirming ? (
          <>
            <span className="meta grow">Delete this question and every widget that shows it?</span>
            <button type="button" className="btn" onClick={() => !busy && confirm(false)} aria-disabled={busy}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn-danger"
              aria-disabled={busy}
              onClick={() => {
                if (busy) return;
                remove.mutate(q.id, {
                  onSuccess: () => {
                    toast({ message: `${q.label} deleted` });
                    onDeleted?.();
                    onClose();
                  },
                });
              }}
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-danger" onClick={() => !busy && confirm(true)} aria-disabled={busy}>
              Delete question
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={() => !busy && onClose()} aria-disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" aria-disabled={!valid || busy}>
              Save
            </button>
          </>
        )}
      </div>
    </form>
  );
}
