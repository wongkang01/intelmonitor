// A development feed's URL parameters: the period, facet filters, the words filter and whether
// unconfirmed developments are listed. They live in the URL, so a reload and closing a development
// popup keep them. One feed reads them per page.
import type { Schema } from "./api/client";
import type { DevelopmentsQuery } from "./api/queries";

type Listed = Schema<"ChangedDevelopment">;
type Category = NonNullable<DevelopmentsQuery["category"]>[number];
type Collection = Listed["collections"][number];
type Priority = Listed["priority"];
type Tone = Listed["direction"];

/** A facet the feed filters on; each popover lists its values with counts. */
export type FacetId = "priority" | "adverse" | "tone" | "category" | "source";

export const FACETS: { id: FacetId; label: string; single?: boolean }[] = [
  { id: "priority", label: "Priority" },
  { id: "adverse", label: "Adverse event", single: true },
  { id: "tone", label: "Tone" },
  { id: "category", label: "Category" },
  { id: "source", label: "Source type" },
];

/** The period control: `days` in the URL, This month when absent, `any` for all time. */
export const PERIODS = [
  { value: "1", label: "Today" },
  { value: "7", label: "This week" },
  { value: "30", label: "This month" },
  { value: "any", label: "All time" },
] as const;
export type Period = (typeof PERIODS)[number]["value"];
const DEFAULT_PERIOD: Period = "30";

const CATEGORY: Record<Category, true> = {
  incident: true,
  regulatory: true,
  financial: true,
  management: true,
  strategy: true,
  policy: true,
  security: true,
  market: true,
  other: true,
};
const COLLECTION: Record<Collection, true> = { dms: true, official: true, data: true, news: true, social: true };
const PRIORITY: Record<Priority, true> = { High: true, Medium: true, Low: true };
const TONE: Record<Tone, true> = { negative: true, neutral: true, positive: true };

const isCategory = (v: string): v is Category => Object.hasOwn(CATEGORY, v);
const isCollection = (v: string): v is Collection => Object.hasOwn(COLLECTION, v);
const isPriority = (v: string): v is Priority => Object.hasOwn(PRIORITY, v);
const isTone = (v: string): v is Tone => Object.hasOwn(TONE, v);
const isAdverse = (v: string) => v === "true" || v === "false";

/** The period the URL asks for. */
export function periodOf(params: URLSearchParams): Period {
  const raw = params.get("days");
  return PERIODS.find((p) => p.value === raw)?.value ?? DEFAULT_PERIOD;
}

/** `params` set to a period; This month, the default, leaves `days` out. */
export function withPeriod(params: URLSearchParams, period: Period): URLSearchParams {
  const next = new URLSearchParams(params);
  if (period === DEFAULT_PERIOD) next.delete("days");
  else next.set("days", period);
  return next;
}

/** Whether the feed lists unconfirmed developments too (`unconfirmed=true`). Like the period, it is not a filter. */
export const showsUnconfirmed = (params: URLSearchParams) => params.get("unconfirmed") === "true";

/** `params` listing unconfirmed developments or not; off, the default, leaves the parameter out. */
export function withUnconfirmed(params: URLSearchParams, on: boolean): URLSearchParams {
  const next = new URLSearchParams(params);
  if (on) next.set("unconfirmed", "true");
  else next.delete("unconfirmed");
  return next;
}

/** The facet's selected values; values a hand-edited URL gets wrong are left out, as the query leaves them out. */
export function selected(params: URLSearchParams, facet: FacetId): string[] {
  const values = params.getAll(facet);
  switch (facet) {
    case "priority":
      return values.filter(isPriority);
    case "adverse":
      return values.filter(isAdverse).slice(0, 1);
    case "tone":
      return values.filter(isTone);
    case "category":
      return values.filter(isCategory);
    case "source":
      return values.filter(isCollection);
  }
}

/** Whether any facet or the words filter narrows the list. The period is not a filter. */
export const filtered = (params: URLSearchParams) =>
  FACETS.some((f) => selected(params, f.id).length > 0) || Boolean(params.get("q")?.trim());

/** The feed's scope: some subjects or a dashboard. */
export type FeedScope = { subject_id: string[] } | { dashboard_id: string };

/** The API query for the feed's parameters over a scope. Dismissed ones are left out unless `dismissed`, unconfirmed ones unless the URL asks. */
export function listQuery(scope: FeedScope, params: URLSearchParams, dismissed = false): DevelopmentsQuery {
  const period = periodOf(params);
  const adverse = selected(params, "adverse")[0];
  return {
    ...scope,
    q: params.get("q")?.trim() || undefined,
    days: period === "any" ? null : Number(period),
    priority: selected(params, "priority").filter(isPriority),
    adverse: adverse === undefined ? null : adverse === "true",
    tone: selected(params, "tone").filter(isTone),
    category: selected(params, "category").filter(isCategory),
    source: selected(params, "source").filter(isCollection),
    dismissed: dismissed ? null : false,
    unconfirmed: showsUnconfirmed(params),
  };
}

/** `params` with a facet set to `values`. */
export function withFacet(params: URLSearchParams, facet: FacetId, values: string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(facet);
  for (const v of values) next.append(facet, v);
  return next;
}

/** `params` without any facet or words filter. */
export function withoutFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const f of FACETS) next.delete(f.id);
  next.delete("q");
  return next;
}
