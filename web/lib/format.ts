// Display formatting shared by widgets, the shell and dialogs.
import type { Schema } from "./api/client";

export type State = Schema<"QuestionAnswerView">["state"];

export const STATE_LABEL: Record<State, string> = {
  stable: "Stable",
  watch: "Watch",
  needs_attention: "Needs attention",
  new: "New",
};

/** The badge palette key for a state: `b-<key>` and `c-<key>` classes in styles/widgets.css. */
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

type SubjectType = Schema<"SubjectRef">["type"];

export const TYPE_COLOR: Record<SubjectType, string> = {
  topic: "var(--topic)",
  group: "var(--group)",
  entity: "var(--entity)",
};

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
