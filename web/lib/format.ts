// Display formatting shared by widgets, the shell and dialogs.
import type { Schema } from "./api/client";

export type State = Schema<"QuestionAnswerView">["state"];

export const STATE_LABEL: Record<State, string> = {
  stable: "Stable",
  watch: "Watch",
  needs_attention: "Needs attention",
  new: "New",
};

/** The badge palette key for a state: `b-<key>` and `c-<key>` classes in app/globals.css. */
export const STATE_TONE: Record<State, "stable" | "watch" | "attn" | "new"> = {
  stable: "stable",
  watch: "watch",
  needs_attention: "attn",
  new: "new",
};

/** Parses an API date (YYYY-MM-DD) as a local calendar day. */
export function day(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Fixed three-letter months: Intl's en-GB writes "Sept".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "24 Sep" for an API date. */
export const shortDate = (iso: string) => dayMonth(day(iso));

/** "24 Sep 2026" for an API date. */
export const longDate = (iso: string) => `${shortDate(iso)} ${day(iso).getFullYear()}`;

/** "24 Sep at 04:01" for an API timestamp, in local time. */
export function dateTime(iso: string): string {
  const at = new Date(iso);
  return `${dayMonth(at)} at ${time.format(at)}`;
}

// Timestamps below are shown in the viewer's local time.
const RELATIVE_DAY: Record<number, string> = { [-1]: "Yesterday", 0: "Today" };

/** Whole calendar days from today to `at`: 0 today, -1 yesterday. */
function dayOffset(at: Date) {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(at) - midnight(new Date())) / 86_400_000);
}

/** "04:01" for an API timestamp. */
export const clock = (iso: string) => time.format(new Date(iso));

/** "Today 04:01", "Yesterday 04:01" or "23 Sep at 04:01" for an API timestamp. */
export function relativeTime(iso: string): string {
  const near = RELATIVE_DAY[dayOffset(new Date(iso))];
  return near ? `${near} ${clock(iso)}` : dateTime(iso);
}

/** "today at 04:01", "yesterday at 04:01" or "23 Sep at 04:01", to follow a verb: "Reviewed today at 04:01". */
export function whenAt(iso: string): string {
  const near = RELATIVE_DAY[dayOffset(new Date(iso))];
  return near ? `${near.toLowerCase()} at ${clock(iso)}` : dateTime(iso);
}

/** "today", "yesterday" or "on 23 Sep" for an API timestamp, to follow a verb: "You marked this wrong today". */
export function onDay(iso: string): string {
  const at = new Date(iso);
  const near = RELATIVE_DAY[dayOffset(at)];
  return near ? near.toLowerCase() : `on ${dayMonth(at)}`;
}

/** The short past form: "04:01" today, then "yesterday", then "23 Sep". */
export function shortTime(iso: string): string {
  const at = new Date(iso);
  const offset = dayOffset(at);
  if (offset === 0) return clock(iso);
  if (offset === -1) return "yesterday";
  return dayMonth(at);
}

/** "98%" for a 0 to 1 confidence. */
export const percent = (x: number) => `${Math.round(x * 100)}%`;

const TAGGERS: Record<string, string> = { jev: "Jev", claude: "Claude" };

/** Who tagged a development to a subject, from a tag's source. */
export const tagger = (source: string) => TAGGERS[source] ?? source;

/** "14 s" or "3 min". */
export const duration = (seconds: number) =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

/** Whole days from `from` to `to`, both API dates. */
export const daysBetween = (from: string, to: string) =>
  Math.round((day(to).getTime() - day(from).getTime()) / 86_400_000);

export function inDays(n: number): string {
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n < 0) return `${-n} days ago`;
  return `In ${n} days`;
}

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

/** "79 new, 1 updated, 9 need attention" for a run's changes; zero counts are left out. */
export const changeCounts = (c: Pick<Schema<"WhatChanged">, "new_count" | "updated_count" | "needs_attention_count">) =>
  [
    c.new_count > 0 && `${c.new_count} new`,
    c.updated_count > 0 && `${c.updated_count} updated`,
    c.needs_attention_count > 0 && `${c.needs_attention_count} ${c.needs_attention_count === 1 ? "needs" : "need"} attention`,
  ]
    .filter(Boolean)
    .join(", ");

/** "Run of 24 Sep against 17 Sep"; run ids are their as-of dates. */
export const runMeta = (run: Schema<"RunRef">) =>
  run.previous_run_id
    ? `Run of ${shortDate(run.as_of)} against ${shortDate(run.previous_run_id)}`
    : `Run of ${shortDate(run.as_of)}`;

/** First letters of up to three words: "Wong Kang" is "WK", "DBS" is "D". */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** An answer summary for display: drops the machine "Yes:" lead-in ("Yes: BNM fined…" reads "BNM fined…"). */
export const answerText = (summary: string) => capitalize(summary.replace(/^yes\s*[:,.;–-]\s*/i, ""));

type SubjectType = Schema<"SubjectRef">["type"];

export const TYPE_LABEL: Record<SubjectType, string> = {
  topic: "Topic",
  group: "Group",
  entity: "Entity",
};

export const TYPE_PLURAL: Record<SubjectType, string> = {
  topic: "Topics",
  group: "Groups",
  entity: "Entities",
};

export const COLLECTION_LABEL: Record<Schema<"EvidenceSource">["collection"], string> = {
  dms: "DMS",
  official: "Official",
  news: "News",
};
