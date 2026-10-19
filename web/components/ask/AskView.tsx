// The Ask page, a preview with mocked answers (Answer.tsx). Empty, the query bar sits in the middle
// under a heading, with four suggested questions below it. Once a question is asked the thread
// shows each question with its answer and the bar stays at the bottom. Opened about a subject
// (`/ask?about=<id>`), the bar starts with that subject's mention and the suggestions are for it.
import { useEffect, useRef, useState } from "react";

import { useSubjects } from "@/lib/api/queries";

import { Answer } from "./Answer";
import { MentionText, mentionOf, useMentionPattern, type Subject } from "./mentions";
import { QueryBar } from "./QueryBar";
import { suggestionsFor } from "./suggestions";

const NO_SUBJECTS: Subject[] = [];

export function AskView({ aboutId }: { aboutId?: string }) {
  const subjects = useSubjects().data ?? NO_SUBJECTS;
  const pattern = useMentionPattern(subjects);
  const about = aboutId ? subjects.find((s) => s.id === aboutId) : undefined;
  const [text, setText] = useState("");
  const [thread, setThread] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef<HTMLLIElement>(null);

  // Start the bar with the subject's mention once subjects load, unless the user has typed.
  const [prefilled, setPrefilled] = useState(false);
  if (about && !prefilled) {
    setPrefilled(true);
    if (!text) setText(`${mentionOf(about)} `);
  }

  useEffect(() => {
    latest.current?.scrollIntoView({ block: "start" });
  }, [thread.length]);

  const submit = () => {
    const question = text.trim();
    if (!question) return;
    setThread((t) => [...t, question]);
    setText("");
  };

  const empty = thread.length === 0;
  const preview = <p className="ask-preview">Preview</p>;

  return (
    <div className={`ask${empty ? " empty" : ""}`}>
      {empty ? (
        <div className="ask-intro">
          <h1>{about ? `Ask about ${about.name}` : "Ask about any entity, group or topic"}</h1>
          {preview}
        </div>
      ) : (
        <ol className="ask-thread" aria-label="Questions and answers">
          {thread.map((question, i) => (
            <li key={i} ref={i === thread.length - 1 ? latest : undefined}>
              <p className="ask-question">
                <MentionText text={question} pattern={pattern} linked />
              </p>
              <Answer question={question} />
            </li>
          ))}
        </ol>
      )}
      <div className="ask-dock">
        <QueryBar
          text={text}
          onText={setText}
          onSubmit={submit}
          subjects={subjects}
          pattern={pattern}
          docked={!empty}
          input={input}
        />
        {empty ? (
          <ul className="ask-sugg" aria-label="Suggested questions">
            {suggestionsFor(about).map((q) => (
              <li key={q}>
                <button
                  type="button"
                  onClick={() => {
                    setText(q);
                    input.current?.focus();
                  }}
                >
                  <MentionText text={q} pattern={pattern} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          preview
        )}
      </div>
    </div>
  );
}
