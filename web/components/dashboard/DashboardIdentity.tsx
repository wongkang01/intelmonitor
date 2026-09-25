"use client";

// A dashboard's identity: its colored dot, and a popover to rename it and change the color.
// Used by the sidebar rows and the dashboard page title.
import { useEffect, useRef, useState, type RefObject } from "react";

import type { Schema } from "@/lib/api/client";
import { useSaveDashboard } from "@/lib/api/queries";

type Dashboard = Schema<"Dashboard">;
type DashboardColor = NonNullable<Dashboard["color"]>;

const COLORS: DashboardColor[] = ["blue", "teal", "purple", "pink", "orange", "olive", "slate", "brown"];

export function DashboardDot({ color }: { color: Dashboard["color"] }) {
  return <span className="dash-dot" style={{ background: `var(--dash-${color ?? "slate"})` }} />;
}

/** Saves a new name, ignoring blanks and unchanged names. */
export function useRenameDashboard() {
  const save = useSaveDashboard();
  return (d: Dashboard, name: string) => {
    const next = name.trim().slice(0, 80);
    if (next && next !== d.name) save({ ...d, name: next });
  };
}

/** Name field and color swatches, anchored under `trigger`. Esc or an outside click closes it. */
export function DashboardEditPop({
  dashboard,
  trigger,
  onClose,
}: {
  dashboard: Dashboard;
  trigger: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const save = useSaveDashboard();
  const rename = useRenameDashboard();
  const [name, setName] = useState(dashboard.name);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (focusTrigger: boolean) => {
      onClose();
      if (focusTrigger) trigger.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [onClose, trigger]);

  return (
    <div ref={ref} className="dash-pop" role="dialog" aria-label={`Edit ${dashboard.name}`}>
      <label className="dash-pop-label" htmlFor={`dash-name-${dashboard.id}`}>
        Name
      </label>
      <input
        id={`dash-name-${dashboard.id}`}
        className="input"
        value={name}
        maxLength={80}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onBlur={() => rename(dashboard, name)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            rename(dashboard, name);
            onClose();
            trigger.current?.focus();
          }
        }}
      />
      <div className="dash-pop-label" id={`dash-color-${dashboard.id}`}>
        Color
      </div>
      <div className="swatches" role="radiogroup" aria-labelledby={`dash-color-${dashboard.id}`}>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={dashboard.color === c}
            aria-label={c}
            className="swatch"
            style={{ background: `var(--dash-${c})` }}
            onClick={() => save({ ...dashboard, color: c })}
          />
        ))}
      </div>
    </div>
  );
}
