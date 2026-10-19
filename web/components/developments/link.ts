// Links that open a development in the popup over the current page (DevelopmentPopup.tsx). The
// popup lives in the URL, so a shared link and browser Back work: `?development=<id>` names it and
// `&scope=subject:<id>` or `&scope=dashboard:<id>` the subjects in view, whose priority it shows.
// Without a scope a link takes the current page's: its monitor, its dashboard, or the dashboard of
// the developments list.
import { linkOptions } from "@tanstack/react-router";

export type ViewScope = { subject?: string; dashboard?: string };

/** The subjects in view on a page, read from its path and query (`window.location` by default). */
export function scopeHere({ pathname, search }: { pathname: string; search: string } = window.location): ViewScope {
  const monitor = pathname.match(/^\/monitors\/([^/]+)/);
  if (monitor) return { subject: decodeURIComponent(monitor[1]) };
  const dashboard = pathname.match(/^\/dashboards\/([^/]+)/);
  if (dashboard) return { dashboard: decodeURIComponent(dashboard[1]) };
  const listed = pathname.startsWith("/developments") ? new URLSearchParams(search).get("dashboard") : null;
  return listed ? { dashboard: listed } : {};
}

/** The `scope` parameter for a scope: "subject:<id>", "dashboard:<id>", or nothing. */
export const scopeParam = (s: ViewScope) => (s.subject ? `subject:${s.subject}` : s.dashboard ? `dashboard:${s.dashboard}` : undefined);

/** The scope a `scope` parameter names, or undefined when it names none. */
export function parseScope(param: string | undefined): ViewScope | undefined {
  const [kind, ...rest] = param?.split(":") ?? [];
  const id = rest.join(":");
  if (!id) return undefined;
  return kind === "subject" ? { subject: id } : kind === "dashboard" ? { dashboard: id } : undefined;
}

/**
 * Link options that open a development's popup over the current page, keeping its filters and
 * scroll; spread into a Link or pass to navigate. The history entry is marked so closing the popup
 * goes back to the entry underneath instead of adding one.
 */
export const developmentLink = (id: string, scope: ViewScope = scopeHere()) =>
  linkOptions({
    to: ".",
    search: (prev) => ({ ...prev, evidence: undefined, development: id, scope: scopeParam(scope) }),
    state: { developmentOpened: true },
    resetScroll: false,
  });

/** The current page with no development open. */
export const closedDevelopmentLink = () =>
  linkOptions({
    to: ".",
    search: (prev) => ({ ...prev, development: undefined, scope: undefined }),
    resetScroll: false,
  });
