"use client";

// A dashboard: title, last run time, Edit and Add widget, then the widget grid.
// Every layout change is saved through the dashboards API as it happens.
import { useEffect, useRef, useState } from "react";

import type { Widget } from "@/lib/api/client";
import { useDashboard, useRuns, useSaveDashboard, useSubjects, type Dashboard } from "@/lib/api/queries";
import { typingIn } from "@/lib/dom";
import { dateTime } from "@/lib/format";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

import { AddWidgetSheet } from "./AddWidgetSheet";
import { WidgetGrid } from "./WidgetGrid";

const HIGHLIGHT_MS = 1600;

export function DashboardView({ id }: { id: string }) {
  const dashboard = useDashboard(id);
  const runs = useRuns();
  const subjects = useSubjects();
  const toast = useToast();
  const save = useSaveDashboard(() => toast({ message: "Could not save the dashboard" }));
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const latest = useRef<Dashboard | undefined>(undefined);

  const d = dashboard.data;
  useEffect(() => {
    latest.current = d;
  }, [d]);

  useEffect(() => {
    if (!highlight) return;
    const t = window.setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [highlight]);

  // Esc closes a widget's settings, then leaves edit mode.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || typingIn(e.target) || document.querySelector("dialog[open]")) return;
      if (settingsFor) setSettingsFor(null);
      else setEditing(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editing, settingsFor]);

  if (dashboard.isError) return <p className="page-message">This dashboard could not be loaded.</p>;
  if (!d) return null;

  const commit = (widgets: Widget[]) => {
    const current = latest.current ?? d;
    const next = { ...current, widgets };
    latest.current = next;
    save(next);
  };
  const current = () => (latest.current ?? d).widgets;

  const remove = (widgetId: string) => {
    const list = current();
    const index = list.findIndex((w) => w.id === widgetId);
    const removed = list[index];
    if (!removed) return;
    commit(list.filter((w) => w.id !== widgetId));
    if (settingsFor === widgetId) setSettingsFor(null);
    toast({
      message: "Widget removed",
      action: {
        label: "Undo",
        run: () => {
          const now = current();
          commit([...now.slice(0, index), removed, ...now.slice(index)]);
        },
      },
    });
  };

  const names = d.subject_ids.map((sid) => subjects.data?.find((s) => s.id === sid)?.name ?? "");
  const lastRun = runs.data?.[0]?.finished_at;

  return (
    <>
      <div className="pagehead">
        <div className="grow">
          <h1>{d.name}</h1>
          <p>
            {editing
              ? "Drag to rearrange. Tap a widget for its settings, or the minus to remove it."
              : [lastRun ? `Last run ${dateTime(lastRun)}` : "", names.filter(Boolean).join(", ")]
                  .filter(Boolean)
                  .join(". ")}
          </p>
        </div>
        <button type="button" className="pill-btn" onClick={() => setAdding(true)}>
          <PlusIcon size={14} />
          Add widget
        </button>
        <button
          type="button"
          className={`pill-btn${editing ? " primary" : ""}`}
          aria-pressed={editing}
          onClick={() => {
            setEditing((e) => !e);
            setSettingsFor(null);
          }}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>
      {d.widgets.length === 0 && <p className="page-message">This dashboard has no widgets. Add one to start.</p>}
      <WidgetGrid
        widgets={d.widgets}
        dashboardSubjectIds={d.subject_ids}
        editing={editing}
        settingsFor={settingsFor}
        highlight={highlight}
        onReorder={(ids) => {
          const byId = new Map(current().map((w) => [w.id, w]));
          commit(ids.flatMap((wid) => byId.get(wid) ?? []));
        }}
        onRemove={remove}
        onChange={(widget) => commit(current().map((w) => (w.id === widget.id ? widget : w)))}
        onSettings={setSettingsFor}
        onLongPress={() => setEditing(true)}
      />
      <AddWidgetSheet
        open={adding}
        onClose={() => setAdding(false)}
        initialSubjectId={d.subject_ids[0] ?? null}
        onAdd={(widget) => {
          commit([...current(), widget]);
          setAdding(false);
          setHighlight(widget.id);
        }}
      />
    </>
  );
}
