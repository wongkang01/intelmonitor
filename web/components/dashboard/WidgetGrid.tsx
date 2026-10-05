// The dashboard grid. Order is the only layout state: CSS grid packs S, M and L from the top left
// with no gaps (grid-auto-flow: dense), so dragging or arrow keys only change the order.
// Pointer gestures: tap opens the widget's page (settings in edit mode), a long press enters edit
// mode, and in edit mode a drag reorders with the others reflowing into place.
import { useNavigate } from "@tanstack/react-router";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { Widget } from "@/lib/api/client";
import { WidgetCard } from "@/components/widgets/WidgetCard";

const LONG_PRESS_MS = 500;
const DRAG_THRESHOLD = 6;
const CONTROLS = "button, a, input, select, textarea, label, [role=option]";

interface Gesture {
  id: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  dragging: boolean;
  timer: number | undefined;
}

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** FLIP: call `snapshot()` before a change that moves widgets; they then glide to their new spots. */
function useFlip(container: React.RefObject<HTMLElement | null>) {
  const before = useRef<Map<string, DOMRect> | null>(null);
  useLayoutEffect(() => {
    const rects = before.current;
    before.current = null;
    if (!rects || !container.current || reducedMotion()) return;
    for (const el of container.current.querySelectorAll<HTMLElement>("[data-widget-id]")) {
      const from = rects.get(el.dataset.widgetId ?? "");
      if (!from) continue;
      el.style.transition = "none";
      el.style.transform = "";
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (!dx && !dy) continue;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 0.22s ease, box-shadow 0.3s ease";
      el.style.transform = "";
    }
  });
  return () => {
    const map = new Map<string, DOMRect>();
    container.current
      ?.querySelectorAll<HTMLElement>("[data-widget-id]")
      .forEach((el) => map.set(el.dataset.widgetId ?? "", el.getBoundingClientRect()));
    before.current = map;
  };
}

function moved(ids: string[], id: string, targetId: string, after: boolean): string[] {
  const rest = ids.filter((i) => i !== id);
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function WidgetGrid({
  widgets,
  dashboardSubjectIds,
  dashboardId,
  editing,
  settingsFor,
  highlight,
  onReorder,
  onRemove,
  onChange,
  onSettings,
  onLongPress,
}: {
  widgets: Widget[];
  dashboardSubjectIds: string[];
  /** Set for a saved dashboard, so widgets following all its subjects link to its developments. */
  dashboardId?: string;
  editing: boolean;
  settingsFor: string | null;
  /** Widgets to outline, such as one just added; the last one is scrolled into view. */
  highlight: readonly string[];
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onChange: (widget: Widget) => void;
  onSettings: (id: string | null) => void;
  onLongPress: () => void;
}) {
  const navigate = useNavigate();
  const grid = useRef<HTMLDivElement>(null);
  const lifted = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const refocus = useRef<{ id: string; order: string } | null>(null);
  const editingRef = useRef(editing);
  const snapshot = useFlip(grid);
  // The order while dragging, kept after the drop until `widgets` reflects the saved order, so
  // the grid never flashes the old one. `base` is the widgets list it was taken from.
  const [local, setLocalState] = useState<{ ids: string[]; base: Widget[] } | null>(null);
  const localRef = useRef(local);
  const setLocal = (next: typeof local) => {
    localRef.current = next;
    setLocalState(next);
  };
  const [drag, setDrag] = useState<{ id: string; width: number; height: number } | null>(null);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const shown =
    local && (drag || local.base === widgets) ? local.ids.flatMap((id) => byId.get(id) ?? []) : widgets;

  // Keep keyboard focus on a widget the arrow keys moved, once the new order has rendered.
  useLayoutEffect(() => {
    const want = refocus.current;
    if (!want || widgets.map((w) => w.id).join() !== want.order) return;
    grid.current?.querySelector<HTMLElement>(`[data-widget-id="${want.id}"]`)?.focus();
    refocus.current = null;
  });

  // When the widget holding focus goes (its minus, the Delete key, or deleting the custom question
  // it shows), focus moves to the widget that takes its place instead of dropping to the page.
  const focusedId = useRef<string | null>(null);
  const lastIds = useRef<string[]>([]);
  useLayoutEffect(() => {
    const ids = widgets.map((w) => w.id);
    const prev = lastIds.current;
    lastIds.current = ids;
    const lost = focusedId.current;
    if (!lost || ids.includes(lost) || (document.activeElement && document.activeElement !== document.body)) return;
    const i = prev.indexOf(lost);
    const next = prev.slice(i + 1).find((id) => ids.includes(id)) ?? prev.slice(0, i).findLast((id) => ids.includes(id));
    focusedId.current = null;
    if (next) grid.current?.querySelector<HTMLElement>(`[data-widget-id="${next}"]`)?.focus();
  }, [widgets]);
  const onFocus = (e: FocusEvent) => {
    focusedId.current = e.target instanceof Element ? (e.target.closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId ?? null) : null;
  };
  const onBlur = (e: FocusEvent) => {
    if (e.relatedTarget instanceof Node && !grid.current?.contains(e.relatedTarget)) focusedId.current = null;
  };

  // Bring a newly added widget into view.
  const lastHighlight = highlight.at(-1);
  useEffect(() => {
    if (!lastHighlight) return;
    grid.current
      ?.querySelector(`[data-widget-id="${lastHighlight}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [lastHighlight]);

  const placeLifted = () => {
    const g = gesture.current;
    if (!g || !lifted.current) return;
    lifted.current.style.left = `${pointer.current.x - g.offsetX}px`;
    lifted.current.style.top = `${pointer.current.y - g.offsetY}px`;
  };
  useLayoutEffect(placeLifted, [drag]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (e.button !== 0 || !(e.target instanceof Element)) return;
    const card = e.target.closest<HTMLElement>("[data-widget-id]");
    if (!card || e.target.closest("input, select, textarea, button, [role=option]")) return;
    const r = card.getBoundingClientRect();
    const g: Gesture = {
      id: card.dataset.widgetId ?? "",
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - r.left,
      offsetY: e.clientY - r.top,
      width: r.width,
      height: r.height,
      dragging: false,
      timer: undefined,
    };
    if (!editing) {
      g.timer = window.setTimeout(() => {
        suppressClick.current = true;
        onLongPress();
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
    pointer.current = { x: e.clientX, y: e.clientY };

    const end = () => {
      window.clearTimeout(g.timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      gesture.current = null;
    };
    const move = (ev: PointerEvent) => {
      pointer.current = { x: ev.clientX, y: ev.clientY };
      if (!g.dragging) {
        if (Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY) < DRAG_THRESHOLD) return;
        window.clearTimeout(g.timer);
        if (!editingRef.current) return end();
        g.dragging = true;
        suppressClick.current = true;
        window.getSelection()?.removeAllRanges();
        setLocal({ ids: widgets.map((w) => w.id), base: widgets });
        setDrag({ id: g.id, width: g.width, height: g.height });
        return;
      }
      placeLifted();
      const target = document
        .elementsFromPoint(ev.clientX, ev.clientY)
        .find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && !!el.dataset.widgetId && grid.current?.contains(el) === true,
        );
      if (!target || target.dataset.widgetId === g.id) return;
      const r = target.getBoundingClientRect();
      const after = ev.clientX > r.left + r.width / 2;
      const current = localRef.current;
      if (!current) return;
      const next = moved(current.ids, g.id, target.dataset.widgetId ?? "", after);
      if (next.join() === current.ids.join()) return;
      snapshot();
      setLocal({ ...current, ids: next });
    };
    const up = () => {
      const wasDragging = g.dragging;
      end();
      if (!wasDragging) return;
      const current = localRef.current;
      if (current && current.ids.join() !== widgets.map((w) => w.id).join()) onReorder(current.ids);
      else setLocal(null);
      setDrag(null);
    };
    const cancel = () => {
      end();
      setLocal(null);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Capture phase, so the click that ends a long press or a drag never reaches a link inside.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target instanceof Element)) return;
    const card = e.target.closest<HTMLElement>("[data-widget-id]");
    if (!card || e.target.closest(CONTROLS) || e.target.closest(".settings")) return;
    if (editing) onSettings(settingsFor === card.dataset.widgetId ? null : (card.dataset.widgetId ?? null));
    else if (card.dataset.href && !window.getSelection()?.toString()) navigate({ href: card.dataset.href });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || !(e.target instanceof HTMLElement)) return;
    const id = e.target.dataset.widgetId;
    if (!id) return;
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      const ids = widgets.map((w) => w.id);
      const i = ids.indexOf(id);
      const j = i + step;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      snapshot();
      refocus.current = { id, order: ids.join() };
      onReorder(ids);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSettings(settingsFor === id ? null : id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(id);
    }
  };

  const dragged = drag ? byId.get(drag.id) : undefined;

  return (
    <>
      <p id="edit-help" className="sr-only">
        Arrow keys move the widget. Enter opens its settings. Delete removes it.
      </p>
      <div
        className="grid dash-grid"
        ref={grid}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {shown.map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            dashboardSubjectIds={dashboardSubjectIds}
            dashboardId={dashboardId}
            variant="grid"
            editing={editing}
            settingsOpen={editing && settingsFor === w.id}
            dragging={drag?.id === w.id}
            highlighted={highlight.includes(w.id)}
            onChange={onChange}
            onRemove={() => onRemove(w.id)}
            onCloseSettings={() => onSettings(null)}
          />
        ))}
      </div>
      {drag && dragged && (
        <WidgetCard
          widget={dragged}
          dashboardSubjectIds={dashboardSubjectIds}
          variant="lifted"
          editing
          cardRef={lifted}
          style={{ width: drag.width, height: drag.height }}
        />
      )}
    </>
  );
}
