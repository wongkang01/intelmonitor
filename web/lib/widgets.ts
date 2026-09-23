// Widget helpers: typed construction and edits of dashboard widgets, and gallery offers.
import type { Schema, Widget } from "./api/client";

export type WidgetType = Widget["type"];
export type Size = Widget["size"];
export type SubjectType = Schema<"SubjectRef">["type"];
type WidgetOf<T extends WidgetType> = Extract<Widget, { type: T }>;

/** Sizes each type allows, checked against the generated API types. */
export const SIZES: { [T in WidgetType]: WidgetOf<T>["size"][] } = {
  since: ["M", "L"],
  question: ["S", "M"],
  summary: ["M", "L"],
  developments: ["M", "L"],
  direction: ["S", "M"],
  watchlist: ["M", "L"],
  upcoming: ["S", "M"],
};

export const SIZE_LABEL: Record<Size, string> = { S: "Small", M: "Medium", L: "Large" };

/** Gallery order and default size per subject type; the first two are tagged Suggested. */
export const OFFERS: Record<SubjectType, [WidgetType, Size][]> = {
  topic: [
    ["since", "L"],
    ["direction", "S"],
    ["upcoming", "S"],
    ["summary", "M"],
    ["developments", "M"],
    ["question", "S"],
  ],
  group: [
    ["since", "L"],
    ["watchlist", "L"],
    ["summary", "M"],
    ["developments", "M"],
    ["direction", "S"],
    ["upcoming", "S"],
    ["question", "S"],
  ],
  entity: [
    ["summary", "M"],
    ["question", "S"],
    ["since", "M"],
    ["developments", "M"],
    ["watchlist", "M"],
    ["direction", "S"],
    ["upcoming", "S"],
  ],
};

const fit = <S extends Size>(allowed: S[], size: Size): S => allowed.find((s) => s === size) ?? allowed[0];

export const newWidgetId = () => `w-${crypto.randomUUID().slice(0, 8)}`;

/** What a new widget needs beyond its type, subject and size. */
export interface DraftContext {
  questionId: string | null;
  entityIds: string[];
}

/**
 * A widget for the gallery to preview, with a placeholder id; give it a `newWidgetId()` when it is
 * added. Null when the context lacks what the type needs.
 */
export function draftWidget(
  type: WidgetType,
  subjectId: string,
  size: Size,
  context: DraftContext,
): Widget | null {
  const base = { id: "draft", order: 0 };
  switch (type) {
    case "since":
      return { ...base, type, size: fit(SIZES.since, size), settings: { subject_id: subjectId } };
    case "question":
      if (!context.questionId) return null;
      return {
        ...base,
        type,
        size: fit(SIZES.question, size),
        settings: { subject_id: subjectId, question_id: context.questionId },
      };
    case "summary":
      return { ...base, type, size: fit(SIZES.summary, size), settings: { subject_id: subjectId } };
    case "developments":
      return {
        ...base,
        type,
        size: fit(SIZES.developments, size),
        settings: { subject_id: subjectId },
      };
    case "direction":
      return { ...base, type, size: fit(SIZES.direction, size), settings: { subject_id: subjectId } };
    case "watchlist":
      if (!context.entityIds.length) return null;
      return {
        ...base,
        type,
        size: fit(SIZES.watchlist, size),
        settings: { entity_ids: context.entityIds },
      };
    case "upcoming":
      return { ...base, type, size: fit(SIZES.upcoming, size), settings: { subject_id: subjectId } };
  }
}

export function resize(widget: Widget, size: Size): Widget {
  switch (widget.type) {
    case "since":
      return { ...widget, size: fit(SIZES.since, size) };
    case "question":
      return { ...widget, size: fit(SIZES.question, size) };
    case "summary":
      return { ...widget, size: fit(SIZES.summary, size) };
    case "developments":
      return { ...widget, size: fit(SIZES.developments, size) };
    case "direction":
      return { ...widget, size: fit(SIZES.direction, size) };
    case "watchlist":
      return { ...widget, size: fit(SIZES.watchlist, size) };
    case "upcoming":
      return { ...widget, size: fit(SIZES.upcoming, size) };
  }
}

/** The subject a widget is set to; null for "every subject on the dashboard" and watchlists. */
export function settingsSubject(widget: Widget): string | null {
  return widget.type === "watchlist" ? null : (widget.settings.subject_id ?? null);
}

/** Points a widget at another subject. Question widgets also need the question, so use setQuestion. */
export function setSubject(widget: Widget, subjectId: string | null): Widget {
  switch (widget.type) {
    case "since":
    case "developments":
      return { ...widget, settings: { subject_id: subjectId } };
    case "summary":
    case "direction":
    case "upcoming":
      return subjectId ? { ...widget, settings: { subject_id: subjectId } } : widget;
    case "question":
    case "watchlist":
      return widget;
  }
}

export function setQuestion(widget: Widget, subjectId: string, questionId: string): Widget {
  return widget.type === "question"
    ? { ...widget, settings: { subject_id: subjectId, question_id: questionId } }
    : widget;
}

export function setEntities(widget: Widget, entityIds: string[]): Widget {
  return widget.type === "watchlist" ? { ...widget, settings: { entity_ids: entityIds } } : widget;
}

/** Whether the widget may follow every subject on the dashboard (an empty subject). */
export const allowsDashboardScope = (widget: Widget) =>
  widget.type === "since" || widget.type === "developments";

/** The monitor page a tap on the widget opens, or null when only its rows link somewhere. */
export function widgetHref(widget: Widget, dashboardSubjectIds: string[]): string | null {
  if (widget.type === "watchlist") return null;
  const id = widget.settings.subject_id ?? dashboardSubjectIds[0];
  return id ? monitorHref(id) : null;
}

export const monitorHref = (subjectId: string) => `/monitors/${subjectId}`;

/** The subjects a set of widgets follows, in order: widget subjects, else watchlist entities. */
export function subjectsUsed(widgets: Widget[]): string[] {
  const subjects = widgets.flatMap((w) => settingsSubject(w) ?? []);
  const ids = subjects.length ? subjects : widgets.flatMap((w) => (w.type === "watchlist" ? w.settings.entity_ids : []));
  return [...new Set(ids)];
}

/** A dashboard name from subject names: "OCBC", "OCBC and DBS", "OCBC and 2 more". */
export function defaultName(names: string[]): string {
  if (names.length === 0) return "New dashboard";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} more`;
}
