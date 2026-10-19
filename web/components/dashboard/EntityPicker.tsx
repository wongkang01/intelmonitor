// The subject picker shared by onboarding (components/shell/Setup.tsx) and the New and Edit
// dashboard dialog (NewDashboard.tsx). Groups come from GET /onboarding/suggestions in the role's
// order: suggested groups are open, the rest sit under "More to add". Each row shows the subject's
// developments in the last 30 days and, for providers, who uses it from the relationship store.
import { useMemo, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useSubjects } from "@/lib/api/queries";
import { EVIDENCE } from "@/components/developments/Impacts";
import { ChevronIcon } from "@/components/ui/icons";

type Suggestions = Schema<"Suggestions">;
type Group = Schema<"PickerGroup">;
type Subject = Schema<"SubjectSummary">;

/** "19 entities, 3 topics" for a set of picks. */
export function pickCount(picked: Iterable<string>, subjects: Subject[] | undefined): string {
  const types = new Map(subjects?.map((s) => [s.id, s.type]));
  let entities = 0;
  let topics = 0;
  for (const id of picked) {
    if (types.get(id) === "topic") topics++;
    else entities++;
  }
  const parts = [entities && `${entities} ${entities === 1 ? "entity" : "entities"}`];
  parts.push(topics && `${topics} ${topics === 1 ? "topic" : "topics"}`);
  return parts.filter(Boolean).join(", ") || "Nothing picked";
}

/** The dashboard name picks suggest: a group's name when the picks are exactly one whole group. */
export function pickName(groups: Group[], picked: Set<string>, fallback: string): string {
  const whole = groups.find(
    (g) => g.rows.length === picked.size && g.rows.every((r) => picked.has(r.subject_id)),
  );
  return whole?.name ?? fallback;
}

export function EntityPicker({
  suggestions,
  picked,
  onChange,
  openMore = false,
}: {
  suggestions: Suggestions;
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Start with the "More to add" groups open. */
  openMore?: boolean;
}) {
  const subjects = useSubjects();
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<Set<string>>(() =>
    openMore ? new Set(suggestions.groups.map((g) => g.id)) : new Set(),
  );
  const byId = useMemo(() => new Map(subjects.data?.map((s) => [s.id, s])), [subjects.data]);

  const words = query.trim().toLowerCase();
  const matches = (id: string) => {
    const s = byId.get(id);
    if (!words || !s) return true;
    return [s.name, ...s.aliases].some((n) => n.toLowerCase().includes(words));
  };
  const shown = suggestions.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => matches(r.subject_id)) }))
    .filter((g) => g.rows.length > 0);
  const open = shown.filter((g) => g.suggested || words || opened.has(g.id));
  const more = shown.filter((g) => !g.suggested && !words && !opened.has(g.id));

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  return (
    <div className="picker">
      <div className="picker-top">
        <input
          type="search"
          className="input"
          placeholder="Find an entity or topic"
          aria-label="Find an entity or topic"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="picker-colhead">Developments, last 30 days</span>
      </div>
      {open.map((g) => (
        <PickerSection key={g.id} group={g} picked={picked} byId={byId} onToggle={toggle} />
      ))}
      {shown.length === 0 && <p className="picker-empty">Nothing matches “{query.trim()}”.</p>}
      {more.length > 0 && (
        <section className="picker-more" aria-labelledby="picker-more-title">
          <h3 id="picker-more-title">More to add</h3>
          {more.map((g) => (
            <button
              key={g.id}
              type="button"
              className="picker-expand"
              aria-expanded={false}
              onClick={() => setOpened(new Set([...opened, g.id]))}
            >
              <ChevronIcon />
              {g.name}
              <span className="meta num">{g.rows.length}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function PickerSection({
  group,
  picked,
  byId,
  onToggle,
}: {
  group: Group;
  picked: Set<string>;
  byId: Map<string, Subject>;
  onToggle: (ids: string[], on: boolean) => void;
}) {
  const ids = group.rows.map((r) => r.subject_id);
  const n = ids.filter((id) => picked.has(id)).length;
  const all = n === ids.length;
  const headId = `picker-${group.id}`;
  return (
    <section className="picker-group" aria-labelledby={headId}>
      <div className="picker-head">
        <h3 id={headId}>{group.name}</h3>
        <span className="meta num">
          {n} of {ids.length}
        </span>
        <button type="button" className="link" onClick={() => onToggle(ids, !all)}>
          {all ? "Remove all" : "Add all"}
          <span className="sr-only"> {group.name}</span>
        </button>
      </div>
      <ul className="picker-rows">
        {group.rows.map((row) => {
          const s = byId.get(row.subject_id);
          return (
            <li key={row.subject_id}>
              <label>
                <input
                  type="checkbox"
                  checked={picked.has(row.subject_id)}
                  onChange={(e) => onToggle([row.subject_id], e.target.checked)}
                />
                <span className="picker-name">
                  {s?.name ?? row.subject_id}
                  {row.reason && (
                    <span
                      className="picker-reason"
                      title={row.evidence ? `${EVIDENCE[row.evidence].word}. ${EVIDENCE[row.evidence].hint}` : undefined}
                    >
                      {row.reason}
                    </span>
                  )}
                </span>
                {s && <RecentCount recent={s.recent} high={s.recent_high} />}
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "15 (3 High)", with only the word High in the attention color; zero is dimmed. */
function RecentCount({ recent, high }: { recent: number; high: number }) {
  if (recent === 0) return <span className="picker-count num muted">0</span>;
  return (
    <span className="picker-count num">
      {recent}
      {high > 0 && (
        <>
          {" "}
          ({high} <span className="c-attn">High</span>)
        </>
      )}
    </span>
  );
}
