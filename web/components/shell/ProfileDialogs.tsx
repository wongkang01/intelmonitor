"use client";

// The profile menu's dialogs: Settings, Data sources, Run history and Help.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import {
  useDashboards,
  useDataSources,
  useMaterialityLevels,
  useProfile,
  useRuns,
  useSaveProfile,
} from "@/lib/api/queries";
import { capitalize, COLLECTION_LABEL, dateTime, longDate, onDay, shortDate } from "@/lib/format";
import { PlayIcon } from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { StateBadge } from "@/components/widgets/parts";

interface DialogProps {
  open: boolean;
  onClose: () => void;
}

function Panel({ id, title, onClose, open, children }: DialogProps & { id: string; title: string; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy={id} className="panel">
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      {children}
    </Modal>
  );
}

export function SettingsDialog(props: DialogProps) {
  const profile = useProfile();
  return (
    <Panel {...props} id="settings-title" title="Settings">
      {profile.data && <SettingsForm profile={profile.data} onClose={props.onClose} />}
    </Panel>
  );
}

function SettingsForm({ profile, onClose }: { profile: Schema<"Profile">; onClose: () => void }) {
  const dashboards = useDashboards();
  const save = useSaveProfile();
  const [name, setName] = useState(profile.display_name);
  const [dashboardId, setDashboardId] = useState(profile.default_dashboard_id ?? "");
  const first = useRef<HTMLInputElement>(null);

  // The form mounts before the dialog opens, when nothing in it can take focus; focus the first field
  // on the next frame instead of letting the dialog focus its close button.
  useEffect(() => {
    const frame = requestAnimationFrame(() => first.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      { ...profile, display_name: name.trim() || profile.display_name, default_dashboard_id: dashboardId || null },
      { onSuccess: onClose },
    );
  };

  return (
    <form onSubmit={submit}>
      <div className="panel-body">
        <label className="form-field">
          Display name
          <input
            ref={first}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </label>
        <label className="form-field">
          Default dashboard
          <select className="input" value={dashboardId} onChange={(e) => setDashboardId(e.target.value)}>
            <option value="">First in the sidebar</option>
            {dashboards.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {save.isError && <p className="cap">Could not save. Try again.</p>}
      </div>
      <div className="panel-foot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

export function DataSourcesDialog(props: DialogProps) {
  const sources = useDataSources();
  const data = sources.data;
  return (
    <Panel {...props} id="sources-title" title="Data sources">
      <div className="panel-body">
        {data && (
          <>
            <p className="cap">
              {data.total_documents} documents
              {data.t0 ? `, 60 days to ${longDate(data.t0)}` : ""}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Collection</th>
                  <th className="num">Documents</th>
                  <th className="num">Relevant</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={`${s.source}-${s.collection}`}>
                    <td>{s.source.toUpperCase()}</td>
                    <td>{COLLECTION_LABEL[s.collection]}</td>
                    <td className="num">{s.documents}</td>
                    <td className="num">{s.relevant_documents}</td>
                    <td>
                      {shortDate(s.first_published)} to {shortDate(s.last_published)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {sources.isError && <p className="cap">Could not load data sources.</p>}
      </div>
    </Panel>
  );
}

export function RunHistoryDialog(props: DialogProps) {
  const runs = useRuns();
  return (
    <Panel {...props} id="runs-title" title="Run history">
      <div className="panel-body">
        {runs.data && (
          <table className="table">
            <thead>
              <tr>
                <th>As of</th>
                <th>Finished</th>
                <th>How</th>
                <th className="num">Documents</th>
                <th className="num">Developments</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.execution_id}>
                  <td>{shortDate(r.as_of)}</td>
                  <td>{r.finished_at ? dateTime(r.finished_at) : r.status}</td>
                  <td>{r.how}</td>
                  <td className="num">{r.documents}</td>
                  <td className="num">{r.developments}</td>
                  <td className="num">
                    {r.duration_seconds === null ? "" : `${Math.round(r.duration_seconds)} s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {runs.isError && <p className="cap">Could not load runs.</p>}
      </div>
    </Panel>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["⌘", "K"], "Search"],
  [["?"], "Help"],
  [["Esc"], "Close a menu, sheet or drawer, or skip the tour"],
  [["⌘", "Enter"], "Send a note, correction or question"],
  [["←", "→"], "Move the focused widget in edit mode"],
  [["Enter"], "Open the focused widget's settings in edit mode"],
  [["Delete"], "Remove the focused widget in edit mode"],
];

/** What each state means, in the order a development or answer escalates. */
const STATES: { badge: ReactNode; text: (attentionLevels: string) => string }[] = [
  {
    badge: <StateBadge state="new" />,
    text: () => "Relevant new items that are routine, neutral or positive. As a count, new since your last review.",
  },
  { badge: <span className="badge b-neutral">Updated</span>, text: () => "Seen before, with new sources this run." },
  {
    badge: <StateBadge state="watch" />,
    text: () => "Something adverse or uncertain is developing that could become material.",
  },
  {
    badge: <StateBadge state="needs_attention" />,
    text: (levels) =>
      `Something could hurt a tracked subject or needs supervisory follow-up now.${levels ? ` Rated ${levels}.` : ""}`,
  },
  { badge: <StateBadge state="stable" />, text: () => "Nothing relevant happened in the lookback." },
];

/** How the app treats a materiality level. */
function levelEffect(level: Schema<"MaterialityLevel">): string {
  if (level.needs_attention) return "Needs attention, and alerts";
  if (level.material) return "Material: counted in Direction, alerts as Watch";
  return "In lists, not counted as material";
}

/** Help: the states and materiality glossary, the shortcuts, and Replay tour. `?` opens it. */
export function HelpDialog({ onReplay, ...props }: DialogProps & { onReplay: () => void }) {
  const levels = useMaterialityLevels();
  const profile = useProfile();
  const seen = profile.data?.tour_seen_at;
  const attentionLevels = (levels.data ?? [])
    .filter((l) => l.needs_attention)
    .map((l) => l.name)
    .reverse()
    .join(" or ");
  return (
    <Panel {...props} id="help-title" title="Help">
      <div className="panel-body help">
        <section aria-labelledby="help-states">
          <h3 id="help-states">States</h3>
          {STATES.map((s, i) => (
            <div key={i} className="help-row">
              <span>{s.badge}</span>
              <span>{s.text(attentionLevels)}</span>
            </div>
          ))}
        </section>
        <section aria-labelledby="help-materiality">
          <h3 id="help-materiality">Materiality</h3>
          {levels.data?.map((l) => (
            <div key={l.level} className="help-row">
              <b>{l.name}</b>
              <span>
                {capitalize(l.description)}
                <span className="meta">{levelEffect(l)}</span>
              </span>
              <span className="meta num">{l.developments} this run</span>
            </div>
          ))}
          {levels.isError && <p className="cap">Could not load materiality levels.</p>}
        </section>
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">Keyboard shortcuts</h3>
          <dl className="keys">
            {SHORTCUTS.map(([combo, what]) => (
              <div key={what} style={{ display: "contents" }}>
                <dt>
                  {combo.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <div className="panel-foot help-foot">
        <button type="button" className="btn" onClick={onReplay}>
          <PlayIcon />
          Replay tour
        </button>
        {seen && <span className="meta">Tour seen {onDay(seen)}</span>}
      </div>
    </Panel>
  );
}
