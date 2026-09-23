// Typed client for the IntelMonitor API. Types come from lib/api/schema.ts, generated from the
// API's OpenAPI schema by `pnpm gen:api`; rerun it after changing API models.
import createClient from "openapi-fetch";

import type { components, paths } from "./schema";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://intelmonitor.api.localhost";

/** Usage: `const { data, error } = await api.GET("/subjects/{subject_id}/page", { params: { path: { subject_id } } })`. */
export const api = createClient<paths>({ baseUrl: API_URL });

/** A named API model, for example `Schema<"Dashboard">` or `Schema<"MonitorPage">`. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

/** One dashboard widget; narrow on `type`. */
export type Widget = Schema<"DashboardSpec">["widgets"][number];

/** A widget's data from the latest run; narrow on `type`. */
export type WidgetData =
  paths["/widgets/data"]["post"]["responses"][200]["content"]["application/json"];
