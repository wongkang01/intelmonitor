// The labels every development carries, one per question (prd.md section 12): priority (High,
// Medium, Low), the adverse flag with the tone, the change marker (New or Updated), the source
// counts and the Unconfirmed mark. Shared by the feed rows and the development popup.
import type { Schema } from "@/lib/api/client";
import { plural } from "@/lib/format";

type Priority = Schema<"DevelopmentSummary">["priority"];
type Tone = Schema<"DevelopmentSummary">["direction"];
type SourceType = Schema<"SourceTypeCount">;

/** The priorities, highest first: the order feeds sort and group by. */
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

const PRIORITY_CLASS: Record<Priority, string> = { High: "b-attn", Medium: "b-watch", Low: "b-neutral" };

const PRIORITY_TITLE: Record<Priority, string> = {
  High: "High: significant for the entity or topic",
  Medium: "Medium: worth knowing for the entity or topic",
  Low: "Low: minor for the entity or topic",
};

/** Priority as the one filled badge: High, Medium or Low, with what it means on hover. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge ${PRIORITY_CLASS[priority]}`} title={PRIORITY_TITLE[priority]}>
      {priority}
    </span>
  );
}

/**
 * What each priority means, in the words a first-time user reads: under the feed's priority
 * headings and in Help.
 */
export const PRIORITY_MEANING: Record<Priority, string> = {
  High: "Read these first. They could change the picture for the entity or topic in view.",
  Medium: "Worth knowing about, but not urgent.",
  Low: "Routine, promotional or minor news.",
};

/** New as a badge; Updated as a plain word in the new color, so it never reads as a priority. */
export function ChangeMark({ change }: { change: Schema<"DevelopmentSummary">["change"] }) {
  if (change === "new") return <span className="badge b-new">New</span>;
  if (change === "updated") return <span className="upd">Updated</span>;
  return null;
}

export const toneWord = (tone: Tone) => `${tone.charAt(0).toUpperCase()}${tone.slice(1)} tone`;

/** "Adverse event · Negative tone", or the tone alone when the news reports no harm to the subject. */
export function AdverseTone({ adverse, tone }: { adverse: boolean; tone: Tone }) {
  return (
    <>
      {adverse && (
        <>
          <span className="adv">Adverse event</span>
          {" · "}
        </>
      )}
      {toneWord(tone)}
    </>
  );
}

export const SOURCE_TYPE_LABEL: Record<SourceType["collection"], string> = {
  news: "News",
  official: "Official",
  dms: "Research",
  data: "Data",
  social: "Social",
};

/**
 * "3 outlets · 12 posts · 1 official source": distinct news outlets, social posts, then official,
 * research and data sources, each left out when zero. These are what the source gate counts
 * (api pipeline/corroboration.py).
 */
export function sourceCountText(d: Pick<Schema<"DevelopmentSummary">, "outlet_count" | "social_count" | "source_types">): string {
  const of = (c: SourceType["collection"]) => d.source_types.find((t) => t.collection === c)?.count ?? 0;
  const parts: [number, string][] = [
    [d.outlet_count, "outlet"],
    [d.social_count, "post"],
    [of("official"), "official source"],
    [of("dms"), "research paper"],
    [of("data"), "data source"],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => plural(n, word))
    .join(" · ");
}

/** The mark an unconfirmed development carries when the feed lists it. */
export const UnconfirmedMark = () => <span className="unv">Unconfirmed</span>;

/** "DBS", "DBS and OCBC", "DBS, OCBC and UOB", or the first `max` and "2 more". */
export function names(list: string[], max = 4): string {
  const shown = list.length > max ? [...list.slice(0, max), `${list.length - max} more`] : list;
  return shown.length < 2 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/**
 * One line on who a development impacts: the entities it happened to, the ones that did it, the
 * topics it is about, and the tracked entities it could reach through their links.
 */
export function impactLine(d: Schema<"DevelopmentSummary">): string {
  const actor = new Set(d.actors);
  const entities = d.subjects.filter((s) => s.type === "entity");
  const affected = entities.filter((s) => !actor.has(s.id)).map((s) => s.name);
  const by = entities.filter((s) => actor.has(s.id)).map((s) => s.name);
  const topics = d.subjects.filter((s) => s.type !== "entity").map((s) => s.name);
  return [
    affected.length > 0 && `Impacts ${names(affected)}`,
    by.length > 0 && `By ${names(by)}`,
    topics.length > 0 && `About ${names(topics, 2)}`,
    d.also_affects.length > 0 && `Could also affect ${names(d.also_affects.map((s) => s.name))}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "22 Sep", or "17 to 20 Sep" when it was reported over several days. */
export function dateSpan(first: string, last: string, format: (iso: string) => string): string {
  if (first === last) return format(last);
  const [a, b] = [format(first), format(last)];
  const sameMonth = a.split(" ").slice(1).join(" ") === b.split(" ").slice(1).join(" ");
  return sameMonth ? `${a.split(" ")[0]} to ${b}` : `${a} to ${b}`;
}
