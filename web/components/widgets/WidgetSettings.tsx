"use client";

// The back of a widget in edit mode: subject, question and size, applied as they change.
import { useQueryClient } from "@tanstack/react-query";

import type { Widget } from "@/lib/api/client";
import { answersOptions, useAnswers, useCatalog, useSubjects } from "@/lib/api/queries";
import { TYPE_PLURAL } from "@/lib/format";
import {
  allowsDashboardScope,
  resize,
  setQuestion,
  setSubject,
  settingsSubject,
  SIZE_LABEL,
  SIZES,
  type Size,
  type SubjectType,
} from "@/lib/widgets";

const TYPES: SubjectType[] = ["topic", "group", "entity"];

export function WidgetSettings({
  widget,
  onChange,
  onDone,
}: {
  widget: Widget;
  onChange: (widget: Widget) => void;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const catalog = useCatalog();
  const subjects = useSubjects();
  const info = catalog.data?.find((t) => t.type === widget.type);
  const subjectId = settingsSubject(widget);
  const answers = useAnswers(widget.type === "question" ? subjectId : null);
  const sizes: Size[] = SIZES[widget.type];

  const changeSubject = async (id: string) => {
    if (widget.type !== "question") return onChange(setSubject(widget, id || null));
    const list = await client.fetchQuery(answersOptions(id));
    const pick = list.find((a) => a.state !== "stable") ?? list[0];
    if (pick) onChange(setQuestion(widget, id, pick.question_id));
  };

  return (
    <div className="face settings flip">
      <div className="wh">
        <span className="wt">{info?.name ?? "Settings"}</span>
        <button type="button" className="link" style={{ marginLeft: "auto" }} onClick={onDone}>
          Done
        </button>
      </div>
      {widget.type !== "watchlist" && (
        <label>
          <span>Subject</span>
          <select value={subjectId ?? ""} onChange={(e) => void changeSubject(e.target.value)}>
            {allowsDashboardScope(widget) && <option value="">Every subject on the dashboard</option>}
            {TYPES.filter((t) => info?.fits.includes(t)).map((t) => (
              <optgroup key={t} label={TYPE_PLURAL[t]}>
                {subjects.data
                  ?.filter((s) => s.type === t)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {widget.type === "question" && (
        <label>
          <span>Question</span>
          <select
            value={widget.settings.question_id}
            onChange={(e) => onChange(setQuestion(widget, widget.settings.subject_id, e.target.value))}
          >
            {answers.data?.map((a) => (
              <option key={a.question_id} value={a.question_id}>
                {a.custom ? `${a.label} (custom)` : a.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {widget.type === "watchlist" && (
        <p className="muted" style={{ margin: 0 }}>
          Add and remove entities in the widget itself.
        </p>
      )}
      <div>
        <div className="seg small" role="group" aria-label="Size" style={{ display: "inline-flex" }}>
          {sizes.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={widget.size === s}
              onClick={() => onChange(resize(widget, s))}
            >
              {SIZE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
