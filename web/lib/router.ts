// The app's URLs keep plain query strings (`?category=a&category=b`), not TanStack Router's JSON
// values, so links, the e2e and the verify recipes read the same as before. Components that work
// with URLSearchParams read the current query through useSearchParams.
import { useLocation } from "@tanstack/react-router";
import { useMemo } from "react";

type Search = Record<string, string | string[]>;

/** Parses a query string, keeping a repeated key as an array of its values. */
export function searchFromParams(query: string): Search {
  const search: Search = {};
  for (const [key, value] of new URLSearchParams(query)) {
    const prev = search[key];
    search[key] = prev === undefined ? value : [...(Array.isArray(prev) ? prev : [prev]), value];
  }
  return search;
}

/** The inverse of searchFromParams, with a leading `?` when anything is set. */
export function searchToParams(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const v of Array.isArray(value) ? value : [value]) if (v !== undefined && v !== null) params.append(key, String(v));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The current URL's query. */
export function useSearchParams() {
  const query = useLocation({ select: (l) => l.searchStr });
  return useMemo(() => new URLSearchParams(query), [query]);
}

/** The current URL's path. */
export const usePathname = () => useLocation({ select: (l) => l.pathname });
