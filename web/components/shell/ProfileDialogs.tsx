"use client";

// The profile menu's dialogs: Settings, Data sources, Run history and Keyboard shortcuts.
import { useState, type FormEvent, type ReactNode } from "react";

import type { Schema } from "@/lib/api/client";
import {
  useDashboards,
  useDataSources,
  useProfile,
  useRuns,
  useSaveProfile,
} from "@/lib/api/queries";
import { dateTime, longDate, shortDate } from "@/lib/format";
import { CloseButton, Modal } from "@/components/ui/Modal";

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
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
        </label>
        <label className="form-field">
          Default dashboard
          <select value={dashboardId} onChange={(e) => setDashboardId(e.target.value)}>
            <option value="">First in the sidebar</option>
            {dashboards.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {save.isError && <p className="muted">Could not save. Try again.</p>}
      </div>
      <div className="panel-foot">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={save.isPending}>
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
            <p className="muted" style={{ margin: 0 }}>
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
                    <td>{s.collection === "dms" ? "DMS" : s.collection === "news" ? "News" : "Official"}</td>
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
        {sources.isError && <p className="muted">Could not load data sources.</p>}
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
                <th className="num">Documents</th>
                <th className="num">Developments</th>
                <th className="num">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>{longDate(r.as_of)}</td>
                  <td>{r.finished_at ? dateTime(r.finished_at) : r.status}</td>
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
        {runs.isError && <p className="muted">Could not load runs.</p>}
      </div>
    </Panel>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["⌘", "K"], "Search"],
  [["?"], "Keyboard shortcuts"],
  [["Esc"], "Close a menu, sheet or drawer"],
  [["←", "→"], "Move the focused widget in edit mode"],
  [["Enter"], "Open the focused widget's settings in edit mode"],
  [["Delete"], "Remove the focused widget in edit mode"],
];

export function ShortcutsDialog(props: DialogProps) {
  return (
    <Panel {...props} id="shortcuts-title" title="Keyboard shortcuts">
      <div className="panel-body">
        <dl className="keys">
          {SHORTCUTS.map(([combo, what]) => (
            <div key={what} style={{ display: "contents" }}>
              <dt>
                {combo.map((k) => (
                  <kbd key={k} style={{ marginRight: 4 }}>
                    {k}
                  </kbd>
                ))}
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}
