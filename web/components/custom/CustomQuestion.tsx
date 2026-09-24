"use client";

// Custom standing questions. CustomQuestionComposer is the write, preview, Keep or Discard flow
// under "Add a question" on monitor pages and in the widget gallery. CustomQuestionEditor is the
// dialog that edits or deletes a kept question, opened from its row or its widget's settings.
import { useState, type FormEvent } from "react";

import {
  errorMessage,
  useCustomQuestion,
  useCustomSlots,
  useDeleteCustomQuestion,
  useDraftCustomQuestion,
  useEditCustomQuestion,
  useKeepCustomQuestion,
  type CustomQuestion,
} from "@/lib/api/queries";
import { answerText, plural, shortDate } from "@/lib/format";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { Dotted, StateChange } from "@/components/monitor/parts";
import { DevelopmentRow, StateBadge } from "@/components/widgets/parts";

const MIN_LENGTH = 5;

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
    draft.mutate({ text: text.trim(), subject_id: subject.id }, { onSuccess: setPreview });
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
      {draft.isPending && (
        <p className="cq-note" role="status">
          Drafting the question and answering it for both runs. This can take a minute.
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

/** The drafted config, the answer for each run (latest first) and the developments it cites. */
function Preview({ question: q, linkCitations }: { question: CustomQuestion; linkCitations: boolean }) {
  const runs = [...q.runs].reverse();
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
      {q.evidence.length > 0 ? (
        <div className="cq-cites">
          <h4 className="cq-label">Cites {plural(q.evidence.length, "development")}</h4>
          <div className="rows">
            {q.evidence.map((d) => (
              <DevelopmentRow key={d.id} development={d} link={linkCitations} />
            ))}
          </div>
        </div>
      ) : (
        <p className="cq-note">No sources in the latest run.</p>
      )}
    </>
  );
}

/** Edits a kept custom question's wording, label and lookback, or deletes it. */
export function CustomQuestionEditor({ questionId, onClose }: { questionId: string | null; onClose: () => void }) {
  const question = useCustomQuestion(questionId);
  return (
    <Modal open={questionId !== null} onClose={onClose} labelledBy="cq-edit-title" className="panel">
      <div className="sheet-head">
        <h2 id="cq-edit-title">Edit custom question</h2>
        <CloseButton onClick={onClose} />
      </div>
      {question.isError && <p className="panel-body cq-note">This question could not be loaded.</p>}
      {question.data && <EditForm key={question.data.id} question={question.data} onClose={onClose} />}
    </Modal>
  );
}

function EditForm({ question: q, onClose }: { question: CustomQuestion; onClose: () => void }) {
  const edit = useEditCustomQuestion();
  const remove = useDeleteCustomQuestion();
  const toast = useToast();
  const [wording, setWording] = useState(q.question);
  const [label, setLabel] = useState(q.label);
  const [lookback, setLookback] = useState(String(q.lookback_days));
  const [confirming, setConfirming] = useState(false);
  const days = Number(lookback);
  const valid = wording.trim().length >= MIN_LENGTH && label.trim().length > 0 && Number.isInteger(days) && days >= 1 && days <= 60;
  const reanswers = wording.trim() !== q.question || days !== q.lookback_days;
  const busy = edit.isPending || remove.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    edit.mutate(
      { id: q.id, change: { question: wording.trim(), label: label.trim(), lookback_days: days } },
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
        {edit.isPending && reanswers && (
          <p className="cq-note" role="status">
            Answering again for both runs. This can take a minute.
          </p>
        )}
        {(edit.isError || remove.isError) && (
          <p className="cq-note" role="alert">
            {errorMessage(edit.error ?? remove.error, "Could not save. Try again.")}
          </p>
        )}
      </div>
      <div className="panel-foot">
        {confirming ? (
          <>
            <span className="meta grow">Delete this question and every widget that shows it?</span>
            <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                remove.mutate(q.id, {
                  onSuccess: () => {
                    toast({ message: `${q.label} deleted` });
                    onClose();
                  },
                })
              }
            >
              Delete
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
              Delete question
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              Save
            </button>
          </>
        )}
      </div>
    </form>
  );
}
