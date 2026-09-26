"use client";

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
  catalog: ["catalog"],
  profile: ["profile"],
  runs: ["runs"],
  runStatus: ["run-status"],
  runSchedule: ["run-schedule"],
  alerts: ["alerts"],
  dataSources: ["data-sources"],
  development: (id: string) => ["development", id],
  answerEvidence: (subjectId: string, questionId: string) => ["answer-evidence", subjectId, questionId],
  monitorPage: (id: string) => ["monitor-page", id],
  search: (text: string) => ["search", text],
  widgetData: ["widget-data"],
  graph: (query: GraphQuery) => ["graph", query],
  customSlots: ["custom-question-slots"],
} as const;

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

export const useDashboard = (id: string) =>
  useQuery({
    queryKey: keys.dashboard(id),
    queryFn: () =>
      unwrap(api.GET("/dashboards/{dashboard_id}", { params: { path: { dashboard_id: id } } })),
  });

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

/** The planned cadence and next run; nominal in the POC, which has no scheduler. */
export const useRunSchedule = () =>
  useQuery({ queryKey: keys.runSchedule, queryFn: () => unwrap(api.GET("/runs/schedule")) });

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

/** The latest run's Needs attention then Watch developments, with unread counts by badge. */
export const useAlerts = () =>
  useQuery({ queryKey: keys.alerts, queryFn: () => unwrap(api.GET("/alerts")) });

/** Marks every current alert read; the alerts stay listed. */
export function useMarkAlertsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/alerts/read")),
    onSuccess: (alerts) => client.setQueryData(keys.alerts, alerts),
  });
}

export const useDataSources = () =>
  useQuery({ queryKey: keys.dataSources, queryFn: () => unwrap(api.GET("/data-sources")) });

export const useDevelopment = (id: string | null) =>
  useQuery({
    queryKey: keys.development(id ?? ""),
    queryFn: () =>
      unwrap(
        api.GET("/developments/{development_id}", {
          params: { path: { development_id: id ?? "" } },
        }),
      ),
    enabled: id !== null,
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

export const useMonitorPage = (id: string) =>
  useQuery({
    queryKey: keys.monitorPage(id),
    queryFn: () =>
      unwrap(api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id: id } } })),
  });

/** The graph neighbourhood around a subject. Keeps the previous graph while filters refetch. */
export const useGraph = (query: GraphQuery) =>
  useQuery({
    queryKey: keys.graph(query),
    queryFn: () => unwrap(api.GET("/graph", { params: { query } })),
    placeholderData: keepPreviousData,
  });

/** Subjects whose name or an alias matches `text`, best first. */
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
  client.setQueryData<Dashboard[]>(keys.dashboards, (list) =>
    list?.map((d) => (d.id === dashboard.id ? dashboard : d)),
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
      client.setQueryData<Dashboard[]>(keys.dashboards, (list) => {
        if (!list) return list;
        const byId = new Map(list.map((d) => [d.id, d]));
        return ids.flatMap((id) => byId.get(id) ?? []);
      });
      mutate(ids);
    },
    [client, mutate],
  );
}

/** Creates a dashboard from a spec; the sidebar list refetches to show it. */
export function useCreateDashboard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (spec: Schema<"DashboardSpec">) => unwrap(api.POST("/dashboards", { body: spec })),
    onSuccess: (created) => {
      client.setQueryData(keys.dashboard(created.id), created);
      // Creating keeps any draft custom questions its widgets show (from Generate).
      return invalidateCustom(client);
    },
  });
}

export function useSaveProfile() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (profile: Schema<"Profile">) => unwrap(api.PUT("/profile", { body: profile })),
    onSuccess: (saved) => client.setQueryData(keys.profile, saved),
  });
}

export function useMarkReviewed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (subjectIds: string[]) =>
      unwrap(api.POST("/reviews", { body: { subject_ids: subjectIds } })),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.widgetData }),
        client.invalidateQueries({ queryKey: ["monitor-page"] }),
      ]),
  });
}

/** Notes hang off a subject (monitor pages) or a development (the evidence drawer). */
export type NoteTarget = { subject_id: string } | { development_id: string };

function invalidateNotes(client: QueryClient) {
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
    onSuccess: () => invalidateNotes(client),
  });
}

/** Deletes a dashboard and drops it from the sidebar list. */
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
      client.setQueryData<Dashboard[]>(keys.dashboards, (list) => list?.filter((d) => d.id !== dashboardId));
      client.removeQueries({ queryKey: keys.dashboard(dashboardId) });
    },
  });
}

export function useDeleteNote() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) => {
      const { error, response } = await api.DELETE("/notes/{note_id}", {
        params: { path: { note_id: noteId } },
      });
      if (error !== undefined || !response.ok) throw new ApiError(response.status, error);
    },
    onSuccess: () => invalidateNotes(client),
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
    [["monitor-page"], keys.widgetData, ["answers"], ["answer-evidence"], keys.customSlots, keys.dashboards, ["dashboard"]].map(
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
