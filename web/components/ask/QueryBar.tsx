// The Ask query bar: a labelled text input and the Ask button. Typing @ opens a listbox of entities,
// groups and topics filtered by what follows the @; Up and Down move, Enter or Tab inserts the
// mention, Escape closes, and focus stays in the input throughout. Mentions show as accent text
// through a backdrop drawn behind the input, whose own text is transparent.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { TYPE_PLURAL } from "@/lib/format";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

import { matchSubjects, mentionAt, mentionOf, withMentions, type MentionPattern, type Subject } from "./mentions";

export function QueryBar({
  text,
  onText,
  onSubmit,
  subjects,
  pattern,
  docked,
  input,
}: {
  text: string;
  onText: (text: string) => void;
  onSubmit: () => void;
  subjects: Subject[];
  pattern: MentionPattern | null;
  /** At the bottom of the thread, so the listbox opens upwards. */
  docked: boolean;
  /** The input, for the page to focus. */
  input: RefObject<HTMLInputElement | null>;
}) {
  const backdrop = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // The caret as of the last edit or move in the input; text set from outside puts it at the end.
  const [caretAt, setCaretAt] = useState({ text, pos: text.length });
  const caret = caretAt.text === text ? caretAt.pos : text.length;
  // The @ whose listbox Escape closed; a newly typed @ opens again.
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const placeCaret = useRef<number | null>(null);

  const at = focused ? mentionAt(text, caret) : null;
  // An @ that already starts a whole mention is finished when the caret is past it or inside it,
  // or at its end with text after it. At the end of the text it is still being typed, so
  // "@Singapore" keeps offering "Singapore banks".
  const finished =
    at && pattern
      ? [...text.matchAll(pattern.regex)].some((m) => {
          const end = m.index + m[0].length;
          return m.index === at.start && (caret !== end || end < text.length);
        })
      : false;
  const options = at && !finished && at.start !== closedAt ? matchSubjects(subjects, at.query) : [];
  const open = options.length > 0;
  const navKey = at ? `${at.start}:${at.query}` : "";
  const [nav, setNav] = useState({ key: "", index: 0 });
  const active = nav.key === navKey ? Math.min(nav.index, options.length - 1) : 0;

  const syncScroll = () => {
    if (input.current && backdrop.current) backdrop.current.scrollLeft = input.current.scrollLeft;
  };

  useLayoutEffect(() => {
    if (placeCaret.current !== null) {
      input.current?.setSelectionRange(placeCaret.current, placeCaret.current);
      placeCaret.current = null;
    }
    syncScroll();
  });

  const activeId = open ? `ask-opt-${options[active].id}` : undefined;
  useLayoutEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const pick = (s: Subject) => {
    if (!at) return;
    const before = text.slice(0, at.start) + mentionOf(s) + " ";
    const next = before + text.slice(caret).replace(/^ /, "");
    onText(next);
    setCaretAt({ text: next, pos: before.length });
    placeCaret.current = before.length;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !at) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setNav({ key: navKey, index: (active + step + options.length) % options.length });
    } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setClosedAt(at.start);
    }
  };

  const types = [...new Set(options.map((s) => s.type))];

  return (
    <form
      className={`ask-bar${docked ? " docked" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="ask-q" className="sr-only">
        Question
      </label>
      <div className="ask-box">
        <div className="ask-field">
          <div ref={backdrop} className="ask-backdrop" aria-hidden="true">
            {withMentions(text, pattern, (_, mention, key) => (
              <span key={key} className="ask-mention">
                {mention}
              </span>
            ))}{" "}
          </div>
          <input
            ref={input}
            id="ask-q"
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls="ask-mentions"
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            placeholder="Ask a question, type @ to mention"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={text}
            onChange={(e) => {
              const { value, selectionStart } = e.target;
              const pos = selectionStart ?? value.length;
              if (value.length > text.length && value[pos - 1] === "@") setClosedAt(null);
              onText(value);
              setCaretAt({ text: value, pos });
            }}
            onSelect={(e) => {
              setCaretAt({ text: e.currentTarget.value, pos: e.currentTarget.selectionStart ?? 0 });
              syncScroll();
            }}
            onScroll={syncScroll}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          Ask
        </button>
      </div>
      {open && (
        <div id="ask-mentions" role="listbox" aria-label="Mention" className="ask-pop">
          {types.map((type) => (
            <div key={type} role="group" aria-labelledby={`ask-group-${type}`}>
              <div id={`ask-group-${type}`} className="pop-group">
                {TYPE_PLURAL[type]}
              </div>
              {options
                .filter((s) => s.type === type)
                .map((s) => {
                  const i = options.indexOf(s);
                  return (
                    <div
                      key={s.id}
                      id={`ask-opt-${s.id}`}
                      role="option"
                      aria-selected={i === active}
                      className="search-hit"
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setNav({ key: navKey, index: i })}
                      onClick={() => pick(s)}
                    >
                      <span className="ask-opt-icon">
                        <SubjectIcon subject={s} />
                      </span>
                      <b>{s.name}</b>
                      {s.type === "group" && <span className="type">{s.members.length}</span>}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
