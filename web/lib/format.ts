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
  data: "Data",
  news: "News",
};

type Series = Schema<"SeriesInfo">;
type Indicator = Schema<"SubjectIndicator">;
export type IndicatorState = Indicator["state"];

/** An indicator's data state (api/intelmonitor/pipeline/indicators.py), in words. */
export const INDICATOR_STATE_LABEL: Record<IndicatorState, string> = {
  no_data: "No data",
  stale: "Stale",
  revised: "Revised",
  preliminary: "Preliminary",
  current: "Current",
};

export const SCOPE_LABEL: Record<NonNullable<Series["scope"]>, string> = {
  system: "System-wide",
  market: "Market-wide",
};

// Amounts in these units read as money in billions or millions; "SGD m" is S$ million.
const MONEY: Record<string, { prefix: string; scale: number }> = {
  USD: { prefix: "$", scale: 1 },
  SGD: { prefix: "S$", scale: 1 },
  "SGD m": { prefix: "S$", scale: 1e6 },
};
const MINUS = "−";
const signed = (x: number, text: string) => `${x > 0 ? "+" : x < 0 ? MINUS : ""}${text}`;

/**
 * A series value in its unit: "70.3%", "S$16.5M", "$183.4B", "0.3132" (SGD per MYR). A distance
 * from a target (a peg, `baseline` set) is always signed, "+0.04%" above and "−0.01%" below; a
 * value that rounds to zero takes no sign.
 */
export function seriesValue(s: Series, v: number): string {
  const text = magnitude(s, Math.abs(v));
  if (!/[1-9]/.test(text)) return text;
  return s.baseline !== null ? signed(v, text) : `${v < 0 ? MINUS : ""}${text}`;
}

/** A value's size in the series' unit, unsigned. */
function magnitude(s: Series, a: number): string {
  const money = s.decimals === 0 ? MONEY[s.unit] : undefined;
  if (s.unit === "%") return `${a.toFixed(s.decimals)}%`;
  if (!money) return a.toFixed(s.decimals);
  const amount = a * money.scale;
  const [div, suffix] = amount >= 1e9 ? [1e9, "B"] : amount >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  return `${money.prefix}${(amount / div).toFixed(1)}${suffix}`;
}

/**
 * A move from one value to another in the series' unit: points for series in % ("+0.3 pt"),
 * else the difference and the percent ("+$2.2B (+3.0%)", "+0.0017 (+0.5%)").
 */
export function seriesChange(s: Series, from: number, to: number): string {
  const diff = to - from;
  if (s.unit === "%") {
    const size = Math.abs(diff).toFixed(s.decimals);
    return signed(Number(size) === 0 ? 0 : diff, `${size} pt`);
  }
  const amount = signed(diff, magnitude(s, Math.abs(diff)));
  if (!from) return amount;
  const pct = (diff / Math.abs(from)) * 100;
  const size = Math.abs(pct).toFixed(1);
  return `${amount} (${signed(Number(size) === 0 ? 0 : pct, `${size}%`)})`;
}

/**
 * An axis tick in the series' unit: money as "$180.0B", other values as bare numbers ("3.50"),
 * signed about a peg ("+0.50").
 */
export function seriesTick(s: Series, v: number, decimals: number): string {
  if (s.decimals === 0 && MONEY[s.unit]) return seriesValue(s, v);
  const text = Math.abs(v).toFixed(decimals);
  if (Number(text) === 0) return text;
  return s.baseline !== null ? signed(v, text) : `${v < 0 ? MINUS : ""}${text}`;
}

/** "Jun 2026 was 69.8%, revised 12 Sep" per revision, for a Revised label's tooltip. */
export const revisionsTitle = (s: Series, revisions: Schema<"Revision">[]) =>
  revisions.map((r) => `${seriesPeriod(s, r.period)} was ${seriesValue(s, r.old_value)}, revised ${shortDate(r.revised_at)}`).join("\n");

/** A period as its series is released: "24 Sep" daily, "Jul 2026" monthly, "Q2 2026" quarterly. */
export function seriesPeriod(s: Series, iso: string): string {
  const d = day(iso);
  if (s.frequency === "daily") return shortDate(iso);
  if (s.frequency === "monthly") return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

/**
 * The change an indicator row shows, with its window: over 1 month for daily series ("1 month"),
 * against the previous release for monthly and quarterly ones ("vs Jun", "vs Q1"). Series in %
 * change in points ("+0.3 pt"), others in percent ("+2.6%"). Null when the window has no change.
 */
export function indicatorChange(ind: Indicator): { value: string; window: string } | null {
  const s = ind.series;
  const c = ind.changes.find((x) => x.window === (s.frequency === "quarterly" ? "3m" : "1m"));
  if (!c || c.change === null || !c.since) return null;
  const size = (ind.change_basis === "points" ? Math.abs(c.change).toFixed(s.decimals) : Math.abs(c.change).toFixed(1));
  // A change that rounds to zero takes no sign.
  const value = signed(Number(size) === 0 ? 0 : c.change, ind.change_basis === "points" ? `${size} pt` : `${size}%`);
  if (s.frequency === "daily") return { value, window: "1 month" };
  // "Jun 2026" or "Q1 2026" without its year.
  return { value, window: `vs ${seriesPeriod(s, c.since).split(" ")[0]}` };
}

/** The same day `months` earlier, clamped to its month; a month end maps to a month end, as the API's windows do. */
export function monthsBefore(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = y * 12 + m - 1 - months;
  const [year, month] = [Math.floor(t / 12), (t % 12) + 1];
  const last = new Date(year, month, 0).getDate();
  const at = d === new Date(y, m, 0).getDate() ? last : Math.min(d, last);
  return `${year}-${String(month).padStart(2, "0")}-${String(at).padStart(2, "0")}`;
}

/** "Sep 2025". */
export const monthYear = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const FX_UNIT = /^SGD per ([A-Z]{3})$/;

/**
 * The sentence an indicator widget states under its status, written from the indicator as of the
 * run date. A peg: how far off it is and the widest gap in the week to its latest point. Other
 * series: the latest value with its date or period and flag, the change `indicatorChange` shows
 * (an FX change told by the SGD's side, as the answers do), and the range of the 12-month line.
 */
export function indicatorSentence(ind: Indicator, asOf: string): string {
  const s = ind.series;
  const latest = ind.latest;
  if (!latest) return `No data by ${shortDate(asOf)}.`;
  const at = s.frequency === "daily" ? `on ${shortDate(latest.period)}` : `for ${seriesPeriod(s, latest.period)}`;
  if (s.baseline !== null) {
    const off = Math.abs(latest.value - s.baseline).toFixed(s.decimals);
    const where = Number(off) === 0 ? `At its peg ${at}` : `${off}% ${latest.value < s.baseline ? "below" : "above"} its peg ${at}`;
    const weekStart = day(latest.period).getTime() - 7 * 86_400_000;
    const week = ind.line.filter((p) => day(p.period).getTime() > weekStart);
    const widest = Math.max(...week.map((p) => Math.abs(p.value - (s.baseline ?? 0))));
    return week.length > 1 ? `${where}; the widest gap this week was ${widest.toFixed(s.decimals)}%.` : `${where}.`;
  }
  const flag = ind.state === "preliminary" || ind.state === "revised" ? ` (${INDICATOR_STATE_LABEL[ind.state].toLowerCase()})` : "";
  const currency = FX_UNIT.exec(s.unit)?.[1];
  const parts = [`${seriesValue(s, latest.value)} ${at}${flag}`];
  const change = indicatorChange(ind);
  const c = ind.changes.find((x) => x.window === (s.frequency === "quarterly" ? "3m" : "1m"))?.change;
  const window = change && (s.frequency === "daily" ? `over ${change.window}` : change.window);
  if (change && currency && c != null) {
    const size = Math.abs(c).toFixed(1);
    parts.push(Number(size) === 0 ? `SGD unchanged against the ${currency} ${window}` : `SGD ${c > 0 ? "weakened" : "strengthened"} ${size}% against the ${currency} ${window}`);
  } else if (change) {
    parts.push(`${change.value} ${window}`);
  }
  const values = ind.line.map((p) => p.value);
  const range = values.length > 1 ? `; 12-month range ${seriesValue(s, Math.min(...values))} to ${seriesValue(s, Math.max(...values))}` : "";
  return `${parts.join(", ")}${range}.`;
}
