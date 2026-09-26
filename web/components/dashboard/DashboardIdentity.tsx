"use client";

// A dashboard's identity: its colored dot, and the options popover (name, color, order, delete) that
// the sidebar row's "more" button opens.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";

import type { Schema } from "@/lib/api/client";
import { useDeleteDashboard, useSaveDashboard } from "@/lib/api/queries";
import { useToast } from "@/components/ui/Toast";

type Dashboard = Schema<"Dashboard">;
type DashboardColor = Dashboard["color"];

const COLORS: DashboardColor[] = ["blue", "teal", "purple", "pink", "orange", "olive", "slate", "brown"];

export function DashboardDot({ color }: { color: Dashboard["color"] }) {
  return <span className="dash-dot" style={{ background: `var(--dash-${color})` }} />;
}

/** Saves a new name, ignoring blanks and unchanged names. */
export function useRenameDashboard() {
  const save = useSaveDashboard();
  return (d: Dashboard, name: string) => {
    const next = name.trim().slice(0, 80);
    if (next && next !== d.name) save({ ...d, name: next });
  };
}

/**
 * Name field, color swatches, Move up and Move down, and Delete, anchored under `trigger`. Esc or an
 * outside click closes it. `index` of `count` is the dashboard's place in the sidebar.
 */
export function DashboardEditPop({
  dashboard,
  trigger,
  index,
  count,
  onMove,
  onClose,
}: {
  dashboard: Dashboard;
  trigger: RefObject<HTMLElement | null>;
  index: number;
  count: number;
  onMove: (step: -1 | 1) => void;
  onClose: () => void;
}) {
  const save = useSaveDashboard();
  const rename = useRenameDashboard();
  const remove = useDeleteDashboard();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [name, setName] = useState(dashboard.name);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const lastStep = useRef<-1 | 1 | null>(null);

  // Moving the row re-inserts it, which drops focus; put it back on the button just pressed. At the
  // ends the buttons use aria-disabled, so the focused one stays focusable.
  useEffect(() => {
    if (lastStep.current !== null) (lastStep.current === -1 ? upRef : downRef).current?.focus();
  }, [index]);

  const atEnd = (step: -1 | 1) => (step === -1 ? index === 0 : index === count - 1);
  const move = (step: -1 | 1) => {
    if (atEnd(step)) return;
    lastStep.current = step;
    onMove(step);
  };

  const deleteDashboard = () =>
    remove.mutate(dashboard.id, {
      onSuccess: () => {
        onClose();
        toast({ message: `Deleted ${dashboard.name}` });
        if (pathname === `/dashboards/${dashboard.id}`) router.push("/");
      },
      onError: () => toast({ message: "Could not delete the dashboard" }),
    });

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
      <div className="dash-pop-moves">
        <button ref={upRef} type="button" className="btn btn-sm" aria-disabled={atEnd(-1)} onClick={() => move(-1)}>
          Move up
        </button>
        <button ref={downRef} type="button" className="btn btn-sm" aria-disabled={atEnd(1)} onClick={() => move(1)}>
          Move down
        </button>
      </div>
      <div className="dash-pop-foot">
        {confirming ? (
          <>
            <span className="dash-pop-label">Delete this dashboard?</span>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-danger" autoFocus onClick={deleteDashboard}>
              Delete
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost danger-text" onClick={() => setConfirming(true)}>
            Delete dashboard
          </button>
        )}
      </div>
    </div>
  );
}
