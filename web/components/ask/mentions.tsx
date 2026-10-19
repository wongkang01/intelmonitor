// @ mentions in an Ask question. A mention is plain text, `@` followed by a subject's exact name, so
// the question stays an ordinary string; these helpers find the mentions in it, filter subjects for
// the @ popover and render a question with its mentions marked.
import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import { monitorLink } from "@/lib/widgets";

export type Subject = Schema<"SubjectSummary">;

/** The mention text for a subject, as inserted into the question. */
export const mentionOf = (s: Pick<Subject, "name">) => `@${s.name}`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A matcher for every subject's mention. Longer names come first, so "@Singapore banks" is one
 * mention rather than "@Singapore" and a word; a name must not run on into a letter or digit.
 */
export function useMentionPattern(subjects: Subject[]) {
  return useMemo(() => {
    if (!subjects.length) return null;
    const names = subjects.map((s) => s.name).sort((a, b) => b.length - a.length);
    return {
      regex: new RegExp(`@(${names.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu"),
      byName: new Map(subjects.map((s) => [s.name, s])),
    };
  }, [subjects]);
}

export type MentionPattern = NonNullable<ReturnType<typeof useMentionPattern>>;

/**
 * `text` split into plain strings and mentions. `mark` renders each mention; the plain text is kept
 * exactly, so the query bar's backdrop lines up with the input over it.
 */
export function withMentions(
  text: string,
  pattern: MentionPattern | null,
  mark: (s: Subject, text: string, key: number) => ReactNode,
) {
  if (!pattern) return [text];
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern.regex)) {
    const subject = pattern.byName.get(m[1]);
    if (!subject) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(mark(subject, m[0], m.index));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** A question with its mentions as accent text; `linked` makes each a link to its monitor page. */
export function MentionText({ text, pattern, linked = false }: { text: string; pattern: MentionPattern | null; linked?: boolean }) {
  return withMentions(text, pattern, (s, mention, key) =>
    linked ? (
      <Link key={key} {...monitorLink(s.id)} className="ask-mention">
        {mention}
      </Link>
    ) : (
      <span key={key} className="ask-mention">
        {mention}
      </span>
    ),
  );
}

/**
 * The @ being typed at the caret: its index in `text` and the query after it. An @ counts at the
 * start or after a space, before the caret, and the query runs to the caret on one line.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const start = text.lastIndexOf("@", caret - 1);
  // lastIndexOf reads -1 as 0, so a caret at the start would still find an @ there.
  if (start < 0 || caret <= start || (start > 0 && !/\s/.test(text[start - 1]))) return null;
  const query = text.slice(start + 1, caret);
  if (query.length > 40 || query.includes("\n")) return null;
  return { start, query };
}

const TYPE_ORDER: Subject["type"][] = ["entity", "group", "topic"];

/**
 * Subjects matching `query`, in popover order: entities, groups, then topics, and within each the
 * names that start with the query, then names with a word that does, then aliases that start with
 * it or have a word that does.
 */
export function matchSubjects(subjects: Subject[], query: string): Subject[] {
  const q = query.trim().toLowerCase();
  const rank = (s: Subject) => {
    if (!q) return 0;
    const name = s.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    const wordStarts = (text: string) => text.toLowerCase().split(/\s+/).some((w) => w.startsWith(q));
    if (wordStarts(s.name)) return 1;
    if (s.aliases.some((a) => a.toLowerCase().startsWith(q) || wordStarts(a))) return 2;
    return -1;
  };
  return TYPE_ORDER.flatMap((type) =>
    subjects
      .filter((s) => s.type === type)
      .map((s) => ({ s, r: rank(s) }))
      .filter(({ r }) => r >= 0)
      .sort((a, b) => a.r - b.r)
      .map(({ s }) => s),
  );
}
