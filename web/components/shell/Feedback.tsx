// Correct the AI, inline per claim. "Mark wrong" under a standing question answer (monitor page
// rows and the evidence drawer) opens a form under it: what is wrong, what the state should be, and
// a reason. Each subject tag in a development's drawer has a Wrong link that removes the tag.
// Corrections apply from the next run; until then the answer or tag says so, with Undo.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";

import type { Schema } from "@/lib/api/client";
import { useAnswerEvidence, useMarkAnswerWrong, useRemoveTag, useUndoFeedback } from "@/lib/api/queries";
import { onDay, percent, plural, STATE_LABEL, tagger, type State } from "@/lib/format";
import { WrongIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

import { SubjectLink } from "./SubjectLink";

type Answer = Schema<"QuestionAnswerView">;
type Development = Schema<"DevelopmentDetail">;

const SAVED = "Feedback saved. The next run takes it into account.";
const STATES: State[] = ["needs_attention", "watch", "new", "stable"];

/** Escape cancels a form without closing the drawer around it. */
function escapeCancels(e: KeyboardEvent, cancel: () => void) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  cancel();
}

/**
 * Mark wrong for one answer, in three pieces the caller places: `link` (Mark wrong, while there is
 * no pending correction), `line` ("You marked this wrong today: ... Undo") and `form` (open under
 * the answer). Custom answers are not recomputed by runs, so they get none of them.
 */
export function useAnswerCorrection(subjectId: string, answer: Answer, { icon = false } = {}) {
  const [open, setOpen] = useState(false);
  const markButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  // Where focus goes once the answer's feedback changes: Undo after Send, Mark wrong after Undo.
  const focusNext = useRef<"undo" | "mark" | null>(null);
  // The mutation lives here, not in the form: the form unmounts as soon as the saved feedback
  // arrives, which would drop callbacks given to a mutate call made inside it.
  const mark = useMarkAnswerWrong();
  const undo = useUndoFeedback();
  const toast = useToast();
  const feedback = answer.feedback;

  const focusPending = () => {
    const next = focusNext.current;
    const target = next === "undo" ? undoButton.current : next === "mark" ? markButton.current : null;
    if (!target) return;
    focusNext.current = null;
    target.focus();
  };
  // The feedback may change before or after the form closes, so both try.
  useEffect(focusPending, [feedback?.id]);

  if (answer.custom) return { link: null, line: null, form: null };

  const link = !feedback && (
    <button
      key="wrong"
      type="button"
      ref={markButton}
      className={`link quiet${icon ? " fb-mark" : ""}`}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
    >
      {icon && <WrongIcon />}
      Mark wrong
    </button>
  );
  const line = feedback && (
    <span className="fb-line">
      You marked this wrong {onDay(feedback.created_at)}
      {correctionSummary(feedback)}.{" "}
      <button
        type="button"
        ref={undoButton}
        className="link"
        onClick={() => {
          if (undo.isPending) return;
          focusNext.current = document.activeElement === undoButton.current ? "mark" : null;
          undo.mutate(feedback.id, { onError: () => toast({ message: "Could not undo the correction" }) });
        }}
      >
        Undo
      </button>
    </span>
  );
  const close = (sent: boolean) => {
    focusNext.current = sent ? "undo" : "mark";
    setOpen(false);
    requestAnimationFrame(focusPending);
  };
  const send = (body: Schema<"AnswerFeedbackRequest">) => {
    if (mark.isPending) return;
    mark.mutate(body, {
      onSuccess: () => {
        toast({ message: SAVED });
        close(true);
      },
      onError: () => toast({ message: "Could not save the feedback" }),
    });
  };
  const form = open && !feedback && (
    <AnswerForm subjectId={subjectId} answer={answer} sending={mark.isPending} onCancel={() => close(false)} onSend={send} />
  );
  return { link, line, form };
}

/** ": state should be Watch, summary, 1 cited development", or nothing for a reason alone. */
function correctionSummary(f: Schema<"AnswerFeedback">): string {
  const parts = [
    f.state && `state should be ${STATE_LABEL[f.state]}`,
    f.summary_wrong && "summary",
    f.development_ids.length > 0 && plural(f.development_ids.length, "cited development"),
  ].filter(Boolean);
  return parts.length ? `: ${parts.join(", ")}` : "";
}

function AnswerForm({
  subjectId,
  answer,
  sending,
  onCancel,
  onSend,
}: {
  subjectId: string;
  answer: Answer;
  sending: boolean;
  onCancel: () => void;
  onSend: (body: Schema<"AnswerFeedbackRequest">) => void;
}) {
  const cited = answer.development_ids;
  // Titles of the cited developments; the drawer has them cached already.
  const evidence = useAnswerEvidence(cited.length ? { subjectId, questionId: answer.question_id } : null);
  const titles = new Map(evidence.data?.developments.map((d) => [d.id, d.title]));
  const others = STATES.filter((s) => s !== answer.state);
  const [stateWrong, setStateWrong] = useState(false);
  const [state, setState] = useState<State>(others[0]);
  const [summaryWrong, setSummaryWrong] = useState(false);
  const [citedWrong, setCitedWrong] = useState(false);
  const [wrongIds, setWrongIds] = useState<string[]>(cited);
  const [reason, setReason] = useState("");
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);

  const developmentIds = citedWrong ? cited.filter((id) => wrongIds.includes(id)) : [];
  const ready = stateWrong || summaryWrong || developmentIds.length > 0 || reason.trim() !== "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    onSend({
      subject_id: subjectId,
      question_id: answer.question_id,
      state: stateWrong ? state : null,
      summary_wrong: summaryWrong,
      development_ids: developmentIds,
      reason: reason.trim(),
    });
  };

  const toggleId = (id: string) =>
    setWrongIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));

  return (
    <form className="fb-form" aria-label="Mark answer wrong" onSubmit={submit} onKeyDown={(e) => escapeCancels(e, onCancel)}>
      <p className="fb-title">What is wrong?</p>
      <Option label="State" checked={stateWrong} onChange={setStateWrong} inputRef={first}>
        {stateWrong && (
          <select
            className="input fb-sel"
            aria-label="What the state should be"
            value={state}
            onChange={(e) => setState(others.find((s) => s === e.target.value) ?? state)}
          >
            {others.map((s) => (
              <option key={s} value={s}>
                Should be {STATE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
      </Option>
      <Option label="Summary" checked={summaryWrong} onChange={setSummaryWrong} />
      {cited.length > 0 && (
        <Option
          label="Cited developments"
          meta={cited.length === 1 ? (titles.get(cited[0]) ?? "") : citedWrong ? "" : `${cited.length} cited`}
          checked={citedWrong}
          onChange={setCitedWrong}
        />
      )}
      {citedWrong && cited.length > 1 && (
        <div className="fb-sub" role="group" aria-label="Cited developments that are wrong">
          {cited.map((id) => (
            <Option key={id} label={titles.get(id) ?? id} checked={wrongIds.includes(id)} onChange={() => toggleId(id)} plain />
          ))}
        </div>
      )}
      <textarea
        className="input"
        aria-label="Reason"
        placeholder="What should it say, and why?"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      <div className="fb-foot">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={!ready || sending}>
          Send
        </button>
      </div>
    </form>
  );
}

/** A checkbox row: label with optional meta under it, and a control at the right. */
function Option({
  label,
  meta,
  checked,
  onChange,
  inputRef,
  plain = false,
  children,
}: {
  label: string;
  meta?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  inputRef?: Ref<HTMLInputElement>;
  plain?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="fb-opt">
      <label>
        <input type="checkbox" ref={inputRef} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className={plain ? "fb-optl plain" : "fb-optl"}>
          {label}
          {meta && <span className="meta">{meta}</span>}
        </span>
      </label>
      {children}
    </div>
  );
}


/**
 * "Tagged to": one row per subject tag with its confidence and a Wrong link, which opens a reason
 * and Remove tag. A removed tag says so, with Undo, and stays listed after the next run drops it.
 */
export function TagList({ development: d }: { development: Development }) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const remove = useRemoveTag();
  const undo = useUndoFeedback();
  const toast = useToast();
  const root = useRef<HTMLDivElement>(null);
  // The tag whose action button takes focus once the development's feedback changes.
  const focusNext = useRef<string | null>(null);

  const removed = new Map(d.tag_feedback.map((f) => [f.subject.id, f]));
  const tagged = new Set(d.subject_confidence.map((c) => c.subject.id));
  const rows = [
    ...d.subject_confidence.map((c) => ({ subject: c.subject, confidence: c, feedback: removed.get(c.subject.id) })),
    ...d.tag_feedback.filter((f) => !tagged.has(f.subject.id)).map((f) => ({ subject: f.subject, confidence: null, feedback: f })),
  ];
  const feedbackKey = d.tag_feedback.map((f) => f.id).join();

  const focusPending = () => {
    const target = focusNext.current && root.current?.querySelector<HTMLElement>(`[data-tag="${focusNext.current}"] button`);
    if (!target) return;
    focusNext.current = null;
    target.focus();
  };
  // The feedback may change before or after a form closes, so both try.
  useEffect(focusPending, [feedbackKey]);
  const focusSoon = (id: string) => {
    focusNext.current = id;
    requestAnimationFrame(focusPending);
  };

  if (rows.length === 0) return null;

  const cancel = (id: string) => {
    setOpen(null);
    focusSoon(id);
  };
  const submit = (e: FormEvent, id: string) => {
    e.preventDefault();
    if (remove.isPending) return;
    remove.mutate(
      { development_id: d.id, subject_id: id, reason: reason.trim() },
      {
        onSuccess: () => {
          setOpen(null);
          setReason("");
          focusSoon(id);
          toast({ message: SAVED });
        },
        onError: () => toast({ message: "Could not remove the tag" }),
      },
    );
  };

  return (
    <div className="fb-tags" ref={root}>
      <p className="fb-title">Tagged to</p>
      {rows.map(({ subject, confidence, feedback }) => (
        <div key={subject.id}>
          <div className="fb-tag" data-tag={subject.id}>
            <SubjectLink subject={subject} />
            <span className="meta grow">
              {feedback
                ? feedback.applied
                  ? `You removed this tag ${onDay(feedback.created_at)}`
                  : `You marked this wrong ${onDay(feedback.created_at)}. Removed from the next run.`
                : confidence && `${percent(confidence.confidence)}, tagged by ${tagger(confidence.source)}`}
            </span>
            {feedback ? (
              <button
                type="button"
                className="link"
                aria-label={`Undo removing ${subject.name}`}
                onClick={(e) => {
                  if (undo.isPending) return;
                  if (document.activeElement === e.currentTarget) focusNext.current = subject.id;
                  undo.mutate(feedback.id, {
                    // The latest run already left the tag off, so the row goes until the next run.
                    onSuccess: () => {
                      if (feedback.applied) toast({ message: `The ${subject.name} tag comes back with the next run.` });
                    },
                    onError: () => toast({ message: "Could not undo the correction" }),
                  });
                }}
              >
                Undo
              </button>
            ) : (
              <button
                type="button"
                className="link quiet"
                aria-label={`${subject.name} is wrong`}
                aria-expanded={open === subject.id}
                onClick={() => {
                  setReason("");
                  setOpen(open === subject.id ? null : subject.id);
                }}
              >
                Wrong
              </button>
            )}
          </div>
          {open === subject.id && !feedback && (
            <form
              className="fb-form fb-form-tag"
              aria-label={`Remove the ${subject.name} tag`}
              onSubmit={(e) => submit(e, subject.id)}
              onKeyDown={(e) => escapeCancels(e, () => cancel(subject.id))}
            >
              <textarea
                className="input"
                aria-label="Reason"
                placeholder="Why is this tag wrong?"
                rows={2}
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e, subject.id);
                }}
              />
              <div className="fb-foot">
                <span className="meta grow">Removed from the next run</span>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancel(subject.id)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={remove.isPending}>
                  Remove tag
                </button>
              </div>
            </form>
          )}
        </div>
      ))}
    </div>
  );
}
