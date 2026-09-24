"use client";

// A dashboard: title, the subjects it covers, Add widget and Edit, then the widget grid. The last
// run time lives in the top bar chip. Every layout change is saved through the dashboards API as it happens.
import { useEffect, useRef, useState } from "react";

import type { Widget } from "@/lib/api/client";
import { useCatalog, useDashboard, useSaveDashboard, useSubjects, type Dashboard } from "@/lib/api/queries";
import { typingIn } from "@/lib/dom";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { PlusIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

import { AddWidgetSheet } from "./AddWidgetSheet";
import { WidgetGrid } from "./WidgetGrid";

const HIGHLIGHT_MS = 1600;

export function DashboardView({ id }: { id: string }) {
  const dashboard = useDashboard(id);
  const catalog = useCatalog();
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
    const name = catalog.data?.find((t) => t.type === removed.type)?.name;
    toast({
      message: name ? `Removed ${name}` : "Widget removed",
      action: {
        label: "Undo",
        run: () => {
          const now = current();
          commit([...now.slice(0, index), removed, ...now.slice(index)]);
          setHighlight(removed.id);
        },
      },
    });
  };

  const named = d.subject_ids.flatMap((sid) => subjects.data?.find((s) => s.id === sid) ?? []);

  return (
    <>
      <div className="pagehead dash-head">
        <div className="grow">
          <h1>{d.name}</h1>
          <p>{editing ? "Drag to reorder. Click a widget for settings." : <SubjectLinks subjects={named} />}</p>
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add widget
        </button>
        <button
          type="button"
          className={`btn${editing ? " btn-primary" : ""}`}
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
        highlight={highlight ? [highlight] : []}
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
