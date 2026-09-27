// A dashboard's developments list (`/developments?dashboard=<id>`): its URL parameters and its sort.
// Facet filters, the words filter and the sort live in the URL, so a reload and the evidence drawer
// keep them; `changed=1` lists What changed since the review.
import type { Schema } from "./api/client";
import type { DevelopmentsQuery } from "./api/queries";

type Listed = Schema<"ChangedDevelopment">;
type Category = NonNullable<DevelopmentsQuery["category"]>[number];
type Collection = Listed["collections"][number];

/** A facet of the list; `date` is the `days` parameter. */
export type FacetId = keyof Schema<"DevelopmentFacets">;

export const FACETS: { id: FacetId; label: string; param: string; single?: boolean; find?: string }[] = [
  { id: "category", label: "Category", param: "category" },
  { id: "materiality", label: "Materiality", param: "materiality" },
  { id: "jurisdiction", label: "Jurisdiction", param: "jurisdiction", find: "Find a jurisdiction" },
  { id: "date", label: "Date", param: "days", single: true },
  { id: "source", label: "Source", param: "source" },
];

/** The date facet's value for no date filter. */
export const ANY_TIME = "any";

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
const COLLECTION: Record<Collection, true> = { dms: true, official: true, news: true };

const isCategory = (v: string): v is Category => Object.hasOwn(CATEGORY, v);
const isCollection = (v: string): v is Collection => Object.hasOwn(COLLECTION, v);
const days = (v: string | null) => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);

/** The facet's selected values as its popover lists them: the date facet always has one. */
export function selected(params: URLSearchParams, facet: FacetId): string[] {
  if (facet === "date") return [String(days(params.get("days")) ?? ANY_TIME)];
  return params.getAll(facet);
}

/** Whether any facet or the words filter narrows the list. */
export const filtered = (params: URLSearchParams) =>
  FACETS.some((f) => params.has(f.param)) || Boolean(params.get("q")?.trim());

/** The API query for the page's parameters: the dashboard's developments, narrowed as the URL says. */
export function listQuery(dashboardId: string, params: URLSearchParams, changed?: DevelopmentsQuery["changed"]): DevelopmentsQuery {
  return {
    dashboard_id: dashboardId,
    changed,
    q: params.get("q")?.trim() || undefined,
    category: params.getAll("category").filter(isCategory),
    materiality: params.getAll("materiality").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 4),
    jurisdiction: params.getAll("jurisdiction"),
    days: days(params.get("days")),
    source: params.getAll("source").filter(isCollection),
  };
}

/** `params` with a facet set to `values`; Any time clears the date. */
export function withFacet(params: URLSearchParams, facet: FacetId, values: string[]): URLSearchParams {
  const { param } = FACETS.find((f) => f.id === facet) ?? FACETS[0];
  const next = new URLSearchParams(params);
  next.delete(param);
  for (const v of values) if (v !== ANY_TIME) next.append(param, v);
  return next;
}

/** `params` without any facet or words filter. */
export function withoutFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const f of FACETS) next.delete(f.param);
  next.delete("q");
  return next;
}

export type SortKey = "status" | "subjects" | "category" | "materiality" | "jurisdiction" | "sources" | "date";
export type SortOrder = "asc" | "desc";

const text = (a: string, b: string) => a.localeCompare(b);

/**
 * Each column's ascending comparison and the order a first click sorts it in. Status sorts by the
 * API's display order, which descending keeps: needing attention first, then changed, most
 * material, most recent.
 */
const SORTS: Record<SortKey, { first: SortOrder; compare?: (a: Listed, b: Listed) => number }> = {
  status: { first: "desc" },
  subjects: { first: "asc", compare: (a, b) => text(a.subjects[0]?.name ?? "", b.subjects[0]?.name ?? "") },
  category: { first: "asc", compare: (a, b) => text(a.category, b.category) },
  materiality: { first: "desc", compare: (a, b) => a.materiality_level - b.materiality_level },
  jurisdiction: { first: "asc", compare: (a, b) => text(a.jurisdictions.join(), b.jurisdictions.join()) },
  sources: { first: "desc", compare: (a, b) => a.source_count - b.source_count },
  date: { first: "desc", compare: (a, b) => text(a.last_published, b.last_published) },
};

const isSortKey = (v: string | null): v is SortKey => v !== null && Object.hasOwn(SORTS, v);

/** The sort the URL asks for: `sort` (status when absent) and `order` (the column's first when absent). */
export function sortOf(params: URLSearchParams): { key: SortKey; order: SortOrder } {
  const raw = params.get("sort");
  const key = isSortKey(raw) ? raw : "status";
  const order = params.get("order");
  return { key, order: order === "asc" || order === "desc" ? order : SORTS[key].first };
}

/** `params` sorted by `key`: its first order, or the other order when it is already sorted by it. */
export function withSort(params: URLSearchParams, key: SortKey): URLSearchParams {
  const current = sortOf(params);
  const order = current.key === key ? (current.order === "asc" ? "desc" : "asc") : SORTS[key].first;
  const next = new URLSearchParams(params);
  next.delete("sort");
  next.delete("order");
  if (key !== "status") next.set("sort", key);
  if (order !== SORTS[key].first) next.set("order", order);
  return next;
}

/** `list`, in display order, in the sort's order; ties keep the display order. */
export function sortList(list: Listed[], { key, order }: { key: SortKey; order: SortOrder }): Listed[] {
  const compare = SORTS[key].compare;
  if (!compare) return order === "desc" ? list : [...list].reverse();
  const sign = order === "asc" ? 1 : -1;
  // Array.prototype.sort is stable, so ties stay in display order.
  return [...list].sort((a, b) => sign * compare(a, b));
}
