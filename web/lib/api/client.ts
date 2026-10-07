// Typed client for the IntelMonitor API. Types come from lib/api/schema.ts, generated from the
// API's OpenAPI schema by `pnpm gen:api`; rerun it after changing API models.
import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

// The e2e imports this under Node, where Vite's import.meta.env does not exist.
export const API_URL = import.meta.env?.VITE_API_URL ?? "https://intelmonitor.api.localhost";

// VITE_LLM_OFF=1 builds for a deploy without LLM keys: Generate, drafting a custom focus area,
// edits that answer one again, and Run now stay in place but disabled, with LLM_OFF_NOTE as why.
export const LLM_OFF = import.meta.env?.VITE_LLM_OFF === "1";
export const LLM_OFF_NOTE = "Not available in this demo";

/** Usage: `const { data, error } = await api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id } } })`. */
export const api = createClient<paths>({ baseUrl: API_URL });

/** A named API model, for example `Schema<"Dashboard">` or `Schema<"MonitorPage">`. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

/** One dashboard widget; narrow on `type`. */
export type Widget = Schema<"DashboardSpec">["widgets"][number];

/** A widget's data from the latest run; narrow on `type`. */
export type WidgetData =
  paths["/widgets/data"]["post"]["responses"][200]["content"]["application/json"];
