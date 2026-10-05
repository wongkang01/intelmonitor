// Widget helpers: typed construction and edits of dashboard widgets, and gallery offers.
import { linkOptions } from "@tanstack/react-router";

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
  indicator: ["S", "M", "L"],
};

export const SIZE_LABEL: Record<Size, string> = { S: "Small", M: "Medium", L: "Large" };

/**
 * Gallery order and default size per subject type; the first two are tagged Suggested. Indicators
 * are offered apart from these, by the series a subject has (see `indicatorOffer`).
 */
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
  /** The series an indicator shows; null when the subject has none. */
  seriesId: string | null;
}

type ListedSeries = { role: "primary" | "context"; series: { id: string; baseline: number | null } };

/**
 * Where the gallery offers an indicator, given the subject's listed series: first among Suggested
 * for a subject with a primary series of its own, last under More widgets for one with context
 * series only, else nowhere.
 */
export function indicatorOffer(listed: ListedSeries[]): "suggested" | "more" | null {
  if (listed.some((i) => i.role === "primary")) return "suggested";
  return listed.length > 0 ? "more" : null;
}

/**
 * The series an indicator shows when set only to its subject, as the API resolves it
 * (`default_series` in api/intelmonitor/server/series.py): the first primary series, a peg (a
 * series with a baseline) before any other, else the first context series.
 */
export function defaultSeriesId(listed: ListedSeries[]): string | null {
  const primary = listed.filter((i) => i.role === "primary");
  return (primary.find((i) => i.series.baseline !== null) ?? primary[0] ?? listed[0])?.series.id ?? null;
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
    case "indicator":
      if (!context.seriesId) return null;
      return {
        ...base,
        type,
        size: fit(SIZES.indicator, size),
        settings: { subject_id: subjectId, series_id: context.seriesId },
      };
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
    case "indicator":
      return { ...widget, size: fit(SIZES.indicator, size) };
  }
}

/** The subject a widget is set to; null for "every subject on the dashboard" and watchlists. */
export function settingsSubject(widget: Widget): string | null {
  return widget.type === "watchlist" ? null : (widget.settings.subject_id ?? null);
}

/**
 * Points a widget at another subject. Question widgets also need the question, so use setQuestion;
 * an indicator moves to the new subject's primary series.
 */
export function setSubject(widget: Widget, subjectId: string | null): Widget {
  switch (widget.type) {
    case "since":
    case "developments":
      return { ...widget, settings: { subject_id: subjectId } };
    case "summary":
    case "direction":
    case "upcoming":
      return subjectId ? { ...widget, settings: { subject_id: subjectId } } : widget;
    case "indicator":
      return subjectId ? { ...widget, settings: { subject_id: subjectId, series_id: null } } : widget;
    case "question":
    case "watchlist":
      return widget;
  }
}

/** Points an indicator at another of its subject's series. */
export function setSeries(widget: Widget, seriesId: string): Widget {
  return widget.type === "indicator" ? { ...widget, settings: { ...widget.settings, series_id: seriesId } } : widget;
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

/**
 * Where a tap on the widget goes, or null when only its rows link somewhere: its subject's monitor
 * page or, for a widget following every subject on a saved dashboard, that dashboard's developments
 * (the changed ones for Since), so the page counts what the widget counts.
 */
export function widgetLink(widget: Widget, dashboardSubjectIds: string[], dashboardId?: string): WidgetLink | null {
  if (widget.type === "watchlist") return null;
  const id = widget.settings.subject_id;
  if (id) return monitorLink(id);
  if (dashboardId) return developmentsLink(dashboardId, widget.type === "since");
  return dashboardSubjectIds[0] ? monitorLink(dashboardSubjectIds[0]) : null;
}

export type WidgetLink = ReturnType<typeof monitorLink> | ReturnType<typeof developmentsLink>;

/** A subject's monitor page; spread into a Link or navigate. */
export const monitorLink = (subjectId: string) => linkOptions({ to: "/monitors/$id", params: { id: subjectId } });

/** A dashboard's developments, or only those new or updated in the latest run. */
export const developmentsLink = (dashboardId: string, changed: boolean) =>
  linkOptions({ to: "/developments", search: { dashboard: dashboardId, changed: changed ? "1" : undefined } });

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
