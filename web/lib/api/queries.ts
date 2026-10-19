// TanStack Query hooks over the typed API client. Components read API data only through these.
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  queryOptions,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { api, type Schema, type Widget, type WidgetData } from "./client";
import type { operations } from "./schema";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(`API request failed with status ${status}`);
  }
}

/** Resolves an openapi-fetch call to its data, throwing ApiError on a non-2xx response. */
async function unwrap<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await request;
  if (error !== undefined || data === undefined) throw new ApiError(response.status, error);
  return data;
}

export const keys = {
  subjects: ["subjects"],
  subject: (id: string) => ["subject", id],
  dashboards: ["dashboards"],
  dashboard: (id: string) => ["dashboard", id],
  overview: (id: string) => ["dashboard-overview", id],
  latestRun: ["latest-run"],
  catalog: ["catalog"],
  profile: ["profile"],
  profiles: ["profiles"],
  suggestions: (role: Role | null) => ["suggestions", role],
  runs: ["runs"],
  runStatus: ["run-status"],
  alerts: ["alerts"],
  follows: ["follows"],
  whatChanged: (query: WhatChangedQuery) => ["what-changed", query],
  dataSources: ["data-sources"],
  materialityLevels: ["materiality-levels"],
  development: (id: string, scope?: DevelopmentScope) => ["development", id, scope],
  developments: (query: DevelopmentsQuery) => ["developments", query],
  answerEvidence: (subjectId: string, questionId: string) => ["answer-evidence", subjectId, questionId],
  monitorPage: (id: string) => ["monitor-page", id],
  linked: (id: string) => ["linked", id],
  relatedGraph: (id: string, days: RelatedDays) => ["related-graph", id, days],
  shared: (a: string, b: string) => ["shared", a, b],
  trend: (id: string) => ["trend", id],
  indicators: (id: string, asOf?: string) => ["indicators", id, asOf],
  series: (id: string, range: SeriesRange) => ["series", id, range],
  search: (text: string) => ["search", text],
  widgetData: ["widget-data"],
  graph: (query: GraphQuery) => ["graph", query],
  customSlots: ["custom-question-slots"],
} as const;

/** Query parameters of GET /developments: a scope (subjects or a dashboard) and filters. */
export type DevelopmentsQuery = NonNullable<operations["list_developments"]["parameters"]["query"]>;

/** The subjects in view in a development popup (some subjects or a dashboard's), for its priority. */
export type DevelopmentScope = NonNullable<operations["get_development"]["parameters"]["query"]>;

/** Query parameters of GET /what-changed: subjects or a dashboard. */
export type WhatChangedQuery = NonNullable<operations["get_what_changed"]["parameters"]["query"]>;

/** Query parameters of GET /series/{series_id}: `from` and `to` period dates, both optional. */
export type SeriesRange = NonNullable<operations["get_series"]["parameters"]["query"]>;

/** The Related graph's window in days: 7 (the brief's week), 30 or 90. */
export type RelatedDays = Schema<"RelatedDays">;

/** Query parameters of GET /graph: center subject, hops (1 or 2) and optional filters. */
export type GraphQuery = NonNullable<operations["get_graph"]["parameters"]["query"]>;

export const useSubjects = () =>
  useQuery({ queryKey: keys.subjects, queryFn: () => unwrap(api.GET("/subjects")) });

export const useSubject = (id: string) =>
  useQuery({
    queryKey: keys.subject(id),
    queryFn: () => unwrap(api.GET("/subjects/{subject_id}", { params: { path: { subject_id: id } } })),
  });

export const useDashboards = () =>
  useQuery({ queryKey: keys.dashboards, queryFn: () => unwrap(api.GET("/dashboards")) });

export const dashboardOptions = (id: string) =>
  queryOptions({
    queryKey: keys.dashboard(id),
    queryFn: () =>
      unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } })),
  });

export const useDashboard = (id: string, enabled = true) => useQuery({ ...dashboardOptions(id), enabled });

/** The new count, watchlist and upcoming dates beside a dashboard's feed. */
export const useDashboardOverview = (id: string) =>
  useQuery({
    queryKey: keys.overview(id),
    queryFn: () =>
      unwrap(api.GET("/dashboards/{dashboard_id}/overview", { params: { path: { dashboard_id: id } } })),
  });

/** The latest run, with the date of the latest news it covers for the top bar's "Updated". */
export const useLatestRun = () =>
  useQuery({ queryKey: keys.latestRun, queryFn: () => unwrap(api.GET("/runs/latest")) });

export const useCatalog = () =>
  useQuery({
    queryKey: keys.catalog,
    queryFn: () => unwrap(api.GET("/widgets/catalog")),
    staleTime: Infinity,
  });

export const useProfile = () =>
  useQuery({ queryKey: keys.profile, queryFn: () => unwrap(api.GET("/profile")) });

/** Run executions, newest first, each with how it started and its result line. */
export const useRuns = () =>
  useQuery({ queryKey: keys.runs, queryFn: () => unwrap(api.GET("/runs")) });

const RUN_POLL_MS = 2000;

/**
 * Whether a run is in progress. Polls every 2 s only while one is; when it finishes, everything
 * else refetches, since the run's data has been recomputed.
 */
export function useRunStatus() {
  const client = useQueryClient();
  return useQuery({
    queryKey: keys.runStatus,
    queryFn: async () => {
      const wasRunning = client.getQueryData<Schema<"RunStatus">>(keys.runStatus)?.running ?? false;
      const status = await unwrap(api.GET("/runs/status"));
      if (wasRunning && !status.running) {
        void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.runStatus[0] });
      }
      return status;
    },
    refetchInterval: (query) => (query.state.data?.running ? RUN_POLL_MS : false),
  });
}

/** Starts recomputing the latest run. The API answers 409 while a run is in progress. */
export function useRunNow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/runs/now")),
    onSuccess: (status) => {
      client.setQueryData(keys.runStatus, status);
      return client.invalidateQueries({ queryKey: keys.runs });
    },
    onError: () => client.invalidateQueries({ queryKey: keys.runStatus }),
  });
}

/**
 * The latest run's Needs attention then Watch developments on followed subjects, with unread counts
 * by badge.
 */
export const useAlerts = () =>
  useQuery({ queryKey: keys.alerts, queryFn: () => unwrap(api.GET("/alerts")) });

/** Marks every current alert's development read; the alerts stay listed. */
export function useMarkAlertsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/alerts/read")),
    onSuccess: (alerts) => {
      client.setQueryData(keys.alerts, alerts);
      return invalidateNew(client);
    },
  });
}

/** Followed subjects, oldest first. Alerts cover these. */
export const useFollows = () =>
  useQuery({ queryKey: keys.follows, queryFn: () => unwrap(api.GET("/follows")) });

/** Follows or unfollows a subject; alerts refetch for the new set. */
export function useFollow() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ subjectId, follow }: { subjectId: string; follow: boolean }) => {
      const params = { params: { path: { subject_id: subjectId } } };
      return unwrap(follow ? api.PUT("/follows/{subject_id}", params) : api.DELETE("/follows/{subject_id}", params));
    },
    onSuccess: (follows) => {
      client.setQueryData(keys.follows, follows);
      return client.invalidateQueries({ queryKey: keys.alerts });
    },
  });
}

/** What changed since the last review of some subjects or of a dashboard's subjects. */
export const useWhatChanged = (query: WhatChangedQuery) =>
  useQuery({
    queryKey: keys.whatChanged(query),
    queryFn: () => unwrap(api.GET("/what-changed", { params: { query } })),
  });

/** Everything that counts or lists what is new: reviews, reads and dismissals change it. */
function invalidateNew(client: QueryClient) {
  return Promise.all(
    [["monitor-page"], keys.widgetData, ["what-changed"], ["developments"], ["dashboard-overview"], keys.dashboards, keys.subjects, ["subject"], keys.alerts].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export type TriageChange = Schema<"TriageChange">;
type WhatChanged = Schema<"WhatChanged">;

/** `list` (What changed or a developments list) with the change applied to one development's triage state. */
function patchTriage<L extends { developments: Schema<"ChangedDevelopment">[] }>(list: L, id: string, change: TriageChange): L {
  const set = triageSet(change);
  return { ...list, developments: list.developments.map((d) => (d.id === id ? { ...d, ...set } : d)) };
}

/** The states a change sets; Not relevant also dismisses. */
function triageSet(change: TriageChange) {
  const set = Object.fromEntries(Object.entries(change).filter(([, v]) => typeof v === "boolean"));
  return change.not_relevant ? { ...set, dismissed: true } : set;
}

/**
 * Marks a development read or unread, flagged or not, dismissed or not. Cached What changed and
 * developments lists and alerts update at once, so a row leaves its filter without waiting; counts follow the refetch.
 */
export function useSetTriage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: TriageChange }) =>
      unwrap(api.PATCH("/developments/{development_id}/triage", { params: { path: { development_id: id } }, body: change })),
    onMutate: ({ id, change }) => {
      client.setQueriesData<Schema<"MonitorPage">>({ queryKey: ["monitor-page"] }, (page) =>
        page ? { ...page, what_changed: patchTriage(page.what_changed, id, change) } : page,
      );
      client.setQueriesData<WhatChanged>({ queryKey: ["what-changed"] }, (wc) => (wc ? patchTriage(wc, id, change) : wc));
      client.setQueriesData<Schema<"DevelopmentList">>({ queryKey: ["developments"] }, (list) =>
        list ? patchTriage(list, id, change) : list,
      );
      client.setQueriesData<Schema<"DevelopmentDetail">>({ queryKey: ["development", id] }, (d) =>
        d ? { ...d, triage: { ...d.triage, ...triageSet(change) } } : d,
      );
      client.setQueriesData<WidgetData>({ queryKey: keys.widgetData }, (data) =>
        data?.type === "since" ? { ...data, what_changed: patchTriage(data.what_changed, id, change) } : data,
      );
      const read = change.read;
      if (typeof read === "boolean") {
        client.setQueryData<Schema<"Alerts">>(keys.alerts, (alerts) =>
          alerts ? { ...alerts, alerts: alerts.alerts.map((a) => (a.id === id ? { ...a, read } : a)) } : alerts,
        );
      }
    },
    onSettled: () => invalidateNew(client),
  });
}

export const useDataSources = () =>
  useQuery({ queryKey: keys.dataSources, queryFn: () => unwrap(api.GET("/data-sources")) });

/** Materiality levels for Help, most material first, with the latest run's counts. */
export const useMaterialityLevels = () =>
  useQuery({ queryKey: keys.materialityLevels, queryFn: () => unwrap(api.GET("/materiality-levels")) });

/** One development with its sources and who it impacts; its priority is for the subjects in `scope`. */
export const useDevelopment = (id: string | null, scope?: DevelopmentScope) =>
  useQuery({
    queryKey: keys.development(id ?? "", scope),
    queryFn: () =>
      unwrap(
        api.GET("/developments/{development_id}", {
          params: { path: { development_id: id ?? "" }, query: scope },
        }),
      ),
    enabled: id !== null,
  });

/**
 * The latest run's developments in display order for a scope, narrowed by facet filters, with each
 * facet's counts. Keeps the previous list while a changed filter refetches.
 */
export const useDevelopments = (query: DevelopmentsQuery, enabled = true) =>
  useQuery({
    queryKey: keys.developments(query),
    queryFn: () => unwrap(api.GET("/developments", { params: { query } })),
    placeholderData: keepPreviousData,
    enabled,
  });

/** The answer behind a standing question and the developments it relies on. */
export const useAnswerEvidence = (target: { subjectId: string; questionId: string } | null) =>
  useQuery({
    queryKey: keys.answerEvidence(target?.subjectId ?? "", target?.questionId ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/subjects/{subject_id}/answers/{question_id}/evidence", {
          params: { path: { subject_id: target?.subjectId ?? "", question_id: target?.questionId ?? "" } },
        }),
      ),
    enabled: target !== null,
  });

export const monitorPageOptions = (id: string) =>
  queryOptions({
    queryKey: keys.monitorPage(id),
    queryFn: () =>
      unwrap(api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id: id } } })),
  });

export const useMonitorPage = (id: string) => useQuery(monitorPageOptions(id));

/** The institutions linked to a country, sector, technology provider or payment system. */
export const useLinked = (id: string, enabled = true) =>
  useQuery({
    queryKey: keys.linked(id),
    enabled,
    queryFn: () => unwrap(api.GET("/subjects/{subject_id}/linked", { params: { path: { subject_id: id } } })),
  });

/**
 * Everything linked to a subject in the relationship store, with the developments of the last
 * `days` that reach it through each node. Keeps the previous graph while the window refetches.
 */
export const useRelatedGraph = (id: string, days: RelatedDays) =>
  useQuery({
    queryKey: keys.relatedGraph(id, days),
    queryFn: () =>
      unwrap(
        api.GET("/subjects/{subject_id}/related-graph", {
          params: { path: { subject_id: id }, query: { days } },
        }),
      ),
    placeholderData: keepPreviousData,
  });

/** What links two entities in the relationship store; idle until both are known. */
export const useShared = (a: string, b: string | null) =>
  useQuery({
    queryKey: keys.shared(a, b ?? ""),
    enabled: b !== null,
    queryFn: () => unwrap(api.GET("/shared", { params: { query: { a, b: b ?? "" } } })),
  });

/**
 * A subject's Trend view: its series over the 12 months to the latest run with its marked
 * developments, each run's note on why they moved, and its questions' states per run.
 */
export const trendOptions = (id: string) =>
  queryOptions({
    queryKey: keys.trend(id),
    queryFn: () =>
      unwrap(api.GET("/subjects/{subject_id}/trend", { params: { path: { subject_id: id } } })),
  });

export const useTrend = (id: string) => useQuery(trendOptions(id));

/**
 * A subject's measured series, primary then context, each with its latest value, changes over
 * 1w, 1m, 3m and 1y, percentile in its history and state. `asOf` (YYYY-MM-DD) reads only what
 * was available by then; the default is today. `enabled: false` leaves it idle.
 */
export const useIndicators = (id: string, asOf?: string, enabled = true) =>
  useQuery({
    queryKey: keys.indicators(id, asOf),
    enabled,
    queryFn: () =>
      unwrap(
        api.GET("/subjects/{subject_id}/indicators", {
          params: { path: { subject_id: id }, query: { as_of: asOf } },
        }),
      ),
  });

/** One series' observations and revisions, with periods in `range`. */
export const useSeries = (id: string, range: SeriesRange = {}) =>
  useQuery({
    queryKey: keys.series(id, range),
    queryFn: () =>
      unwrap(api.GET("/series/{series_id}", { params: { path: { series_id: id }, query: range } })),
  });

/** The graph neighbourhood around a subject. Keeps the previous graph while filters refetch. */
export const useGraph = (query: GraphQuery) =>
  useQuery({
    queryKey: keys.graph(query),
    queryFn: () => unwrap(api.GET("/graph", { params: { query } })),
    placeholderData: keepPreviousData,
  });

/**
 * Subjects whose name or an alias matches `text`, and the latest run's developments and source
 * documents whose text does, each group best first.
 */
export const searchOptions = (text: string) =>
  queryOptions({
    queryKey: keys.search(text.trim().toLowerCase()),
    queryFn: () => unwrap(api.GET("/search", { params: { query: { q: text.trim() } } })),
    staleTime: Infinity,
  });

/** Live search results while typing; idle for blank text. */
export const useSearch = (text: string) =>
  useQuery({ ...searchOptions(text), enabled: text.trim().length > 0, placeholderData: keepPreviousData });

/**
 * One widget's data from the latest run, saved or not. The key leaves out id, order and size, so
 * reordering or resizing reuses the cache and a gallery preview fills the widget it becomes.
 */
export function useWidgetData(widget: Widget, dashboardSubjectIds: string[]) {
  return useQuery({
    queryKey: [...keys.widgetData, widget.type, widget.settings, dashboardSubjectIds],
    queryFn: () =>
      unwrap(
        api.POST("/widgets/data", {
          body: { widget, dashboard_subject_ids: dashboardSubjectIds },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** A subject's answers to all its standing questions, read through a Monitor summary widget. */
export const answersOptions = (subjectId: string) => {
  const widget: Widget = {
    id: "answers",
    order: 0,
    type: "summary",
    size: "M",
    settings: { subject_id: subjectId },
  };
  return queryOptions({
    queryKey: ["answers", subjectId],
    queryFn: async () => {
      const data = await unwrap(api.POST("/widgets/data", { body: { widget } }));
      if (data.type !== "summary") throw new Error("expected summary data");
      return data.answers;
    },
  });
};

export const useAnswers = (subjectId: string | null) =>
  useQuery({ ...answersOptions(subjectId ?? ""), enabled: subjectId !== null });

export type DataOf<T extends WidgetData["type"]> = Extract<WidgetData, { type: T }>;

export type Dashboard = Schema<"Dashboard">;
/** A sidebar dashboard: the dashboard and its new count. */
export type DashboardItem = Schema<"DashboardItem">;

function putDashboard(dashboard: Dashboard) {
  const body: Schema<"DashboardSpec"> = {
    name: dashboard.name,
    color: dashboard.color,
    subject_ids: dashboard.subject_ids,
    widgets: dashboard.widgets.map((w, order) => ({ ...w, order })),
  };
  return unwrap(
    api.PUT("/dashboards/{dashboard_id}", {
      params: { path: { dashboard_id: dashboard.id } },
      body,
    }),
  );
}

function storeDashboard(client: QueryClient, dashboard: Dashboard) {
  client.setQueryData(keys.dashboard(dashboard.id), dashboard);
  client.setQueryData<DashboardItem[]>(keys.dashboards, (list) =>
    list?.map((d) => (d.id === dashboard.id ? { ...d, ...dashboard } : d)),
  );
}

/**
 * Returns `save(dashboard)`. The cache updates synchronously so the layout never waits on the
 * network; saves run one at a time in call order, so the last one wins, and a failure refetches.
 */
export function useSaveDashboard(onError?: () => void) {
  const client = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: putDashboard,
    scope: { id: "dashboard-save" },
    // The feed, overview and new count are computed from the stored subjects.
    onSuccess: (_, dashboard) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.overview(dashboard.id) }),
        client.invalidateQueries({ queryKey: ["developments"] }),
        client.invalidateQueries({ queryKey: keys.dashboards }),
      ]),
    onError: (_, dashboard) => {
      void client.invalidateQueries({ queryKey: keys.dashboard(dashboard.id) });
      void client.invalidateQueries({ queryKey: keys.dashboards });
      onError?.();
    },
  });
  return useCallback(
    (dashboard: Dashboard) => {
      storeDashboard(client, dashboard);
      mutate(dashboard);
    },
    [client, mutate],
  );
}

/**
 * Returns `reorder(ids)`, which sets the sidebar order to `ids` (every dashboard once). The list
 * reorders at once; moves save one at a time in call order, and a failure refetches the list.
 */
export function useReorderDashboards() {
  const client = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (ids: string[]) => unwrap(api.PUT("/dashboards/order", { body: ids })),
    scope: { id: "dashboard-order" },
    onError: () => client.invalidateQueries({ queryKey: keys.dashboards }),
  });
  return useCallback(
    (ids: string[]) => {
      client.setQueryData<DashboardItem[]>(keys.dashboards, (list) => {
        if (!list) return list;
        const byId = new Map(list.map((d) => [d.id, d]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      });
      mutate(ids);
    },
    [client, mutate],
  );
}

/** Creates a dashboard from a spec and follows its subjects; the sidebar list refetches to show it. */
export function useCreateDashboard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (spec: Schema<"DashboardSpec">) => unwrap(api.POST("/dashboards", { body: spec })),
    onSuccess: (created) => {
      client.setQueryData(keys.dashboard(created.id), created);
      // Creating keeps any draft custom questions its widgets show (from Generate).
      return Promise.all([
        invalidateCustom(client),
        client.invalidateQueries({ queryKey: keys.follows }),
        client.invalidateQueries({ queryKey: keys.alerts }),
      ]);
    },
  });
}

export type Role = NonNullable<Schema<"Profile">["role"]>;

/** Every profile, for the profile menu's role switch. */
export const useProfiles = () =>
  useQuery({ queryKey: keys.profiles, queryFn: () => unwrap(api.GET("/profiles")) });

/** The subject picker's groups and starting picks for a role; without one, every group, none picked. */
export const useSuggestions = (role: Role | null) =>
  useQuery({
    queryKey: keys.suggestions(role),
    queryFn: () => unwrap(api.GET("/onboarding/suggestions", { params: { query: role ? { role } : {} } })),
    staleTime: Infinity,
  });

/** After a role switch or onboarding everything refetches: the sidebar lists the profile's
 * dashboards, and New and Updated count from that role's last visit wherever they show. */
function profileChanged(client: QueryClient, profile: Schema<"Profile">) {
  client.setQueryData(keys.profile, profile);
  return client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.profile[0] });
}

/** Onboarding's end: the role's first dashboard from the picks; the new profile becomes active. */
export function useCreateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schema<"ProfileCreate">) => unwrap(api.POST("/profiles", { body })),
    onSuccess: (profile) => profileChanged(client, profile),
  });
}

/** Switches to another profile's role and dashboards. */
export function useActivateProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/profiles/{profile_id}/activate", { params: { path: { profile_id: id } } })),
    onSuccess: (profile) => profileChanged(client, profile),
  });
}

/** Logs an app load with the active role. Failures are ignored: a lost visit row breaks nothing. */
export const logVisit = (path: string) => void api.POST("/visits", { body: { path } }).catch(() => undefined);

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (profile: Schema<"Profile">) => unwrap(api.PUT("/profile", { body: profile })),
    onSuccess: (saved) => client.setQueryData(keys.profile, saved),
  });
}

/** Sets each subject's review watermark to the latest run; returns the reviews for useUndoReview. */
export function useMarkReviewed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (subjectIds: string[]) =>
      unwrap(api.POST("/reviews", { body: { subject_ids: subjectIds } })),
    onSuccess: () => invalidateNew(client),
  });
}

/** Removes reviews, so each subject counts from its review before. */
export function useUndoReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (reviewIds: number[]) => {
      for (const id of reviewIds) {
        const { error, response } = await api.DELETE("/reviews/{review_id}", { params: { path: { review_id: id } } });
        if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
      }
    },
    onSuccess: () => invalidateNew(client),
  });
}

/** Notes hang off a subject (monitor pages) or a development (the evidence drawer). */
export type NoteTarget = { subject_id: string } | { development_id: string };

/** Refetches what shows notes and corrections: monitor pages and the evidence drawer. */
function invalidateAnnotations(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["monitor-page"] }),
    client.invalidateQueries({ queryKey: ["development"] }),
    client.invalidateQueries({ queryKey: ["answer-evidence"] }),
  ]);
}

export function useAddNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ target, text }: { target: NoteTarget; text: string }) =>
      unwrap(api.POST("/notes", { body: { ...target, text } })),
    onSuccess: () => invalidateAnnotations(client),
  });
}

/** Deletes a dashboard (a soft delete) and drops it from the sidebar list. */
export function useDeleteDashboard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (dashboardId: string) => {
      const { error, response } = await api.DELETE("/dashboards/{dashboard_id}", {
        params: { path: { dashboard_id: dashboardId } },
      });
      if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
    },
    onSuccess: (_, dashboardId) => {
      client.setQueryData<DashboardItem[]>(keys.dashboards, (list) => list?.filter((d) => d.id !== dashboardId));
      client.removeQueries({ queryKey: keys.dashboard(dashboardId) });
    },
  });
}

/**
 * Undoes a dashboard delete; the sidebar refetches to show it in its place. The cache updates here,
 * not in callbacks passed to mutate, so a toast's Undo works after the menu that deleted it closed.
 */
export function useRestoreDashboard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (dashboardId: string) =>
      unwrap(api.POST("/dashboards/{dashboard_id}/restore", { params: { path: { dashboard_id: dashboardId } } })),
    onSuccess: (restored) => {
      client.setQueryData(keys.dashboard(restored.id), restored);
      return client.invalidateQueries({ queryKey: keys.dashboards });
    },
  });
}

/** Deletes a note (a soft delete); useRestoreNote undoes it. */
export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) => {
      const { error, response } = await api.DELETE("/notes/{note_id}", {
        params: { path: { note_id: noteId } },
      });
      if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
    },
    onSuccess: () => invalidateAnnotations(client),
  });
}

export function useRestoreNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (noteId: number) =>
      unwrap(api.POST("/notes/{note_id}/restore", { params: { path: { note_id: noteId } } })),
    onSuccess: () => invalidateAnnotations(client),
  });
}

/** Removes a wrong subject tag from a development; the next run leaves it off. */
export function useRemoveTag() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schema<"TagFeedbackRequest">) => unwrap(api.POST("/feedback/tags", { body })),
    onSuccess: () => invalidateAnnotations(client),
  });
}

/** Marks a standing question answer wrong; the next run's answer prompt sees the correction. */
export function useMarkAnswerWrong() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Schema<"AnswerFeedbackRequest">) => unwrap(api.POST("/feedback/answers", { body })),
    onSuccess: () => invalidateAnnotations(client),
  });
}

/** Undoes a tag removal or an answer correction. */
export function useUndoFeedback() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (feedbackId: number) => {
      const { error, response } = await api.DELETE("/feedback/{feedback_id}", {
        params: { path: { feedback_id: feedbackId } },
      });
      if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
    },
    onSuccess: () => invalidateAnnotations(client),
  });
}

export type CustomQuestion = Schema<"CustomQuestion">;

/** The API's message for a failed request, such as the custom question cap. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && typeof error.detail === "object" && error.detail !== null && "detail" in error.detail) {
    const detail = error.detail.detail;
    if (typeof detail === "string" && error.status !== 422) return detail;
  }
  return fallback;
}

/** How many custom questions the user keeps and may still add. */
export const useCustomSlots = () =>
  useQuery({ queryKey: keys.customSlots, queryFn: () => unwrap(api.GET("/custom-questions/slots")) });

/** Everything that shows custom questions or their answers. */
function invalidateCustom(client: QueryClient) {
  return Promise.all(
    [["monitor-page"], ["trend"], keys.widgetData, ["answers"], ["answer-evidence"], keys.customSlots, keys.dashboards, ["dashboard"]].map(
      (queryKey) => client.invalidateQueries({ queryKey }),
    ),
  );
}

/** Claude drafts a config from the user's text and answers it for every run; nothing shows it until Keep. */
export const useDraftCustomQuestion = () =>
  useMutation({
    mutationFn: (request: Schema<"CustomQuestionRequest">) => unwrap(api.POST("/custom-questions", { body: request })),
  });

export function useKeepCustomQuestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/custom-questions/{question_id}/keep", { params: { path: { question_id: id } } })),
    onSuccess: () => invalidateCustom(client),
  });
}

/** A new wording or lookback answers the question again for every run. */
export function useEditCustomQuestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: Schema<"CustomQuestionEdit"> }) =>
      unwrap(api.PATCH("/custom-questions/{question_id}", { params: { path: { question_id: id } }, body: change })),
    onSuccess: (saved) => {
      client.setQueryData(["custom-question", saved.id], saved);
      return invalidateCustom(client);
    },
  });
}

/** Discards a draft or deletes a kept question; the API also drops widgets that show it. */
export function useDeleteCustomQuestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error, response } = await api.DELETE("/custom-questions/{question_id}", {
        params: { path: { question_id: id } },
      });
      if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
    },
    onSuccess: () => invalidateCustom(client),
  });
}

export const useCustomQuestion = (id: string | null) =>
  useQuery({
    queryKey: ["custom-question", id ?? ""],
    queryFn: () =>
      unwrap(api.GET("/custom-questions/{question_id}", { params: { path: { question_id: id ?? "" } } })),
    enabled: id !== null,
  });
