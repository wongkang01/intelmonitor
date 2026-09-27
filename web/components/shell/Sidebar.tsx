"use client";

// Sidebar: brand, Dashboards (New dashboard first), Monitors by type with counts, profile menu.
// The Monitors section holding the current subject opens itself, so the current page is always marked.
// Dashboards reorder by dragging a row with a mouse or pen, or with Move up and Move down in the
// row's options popover.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import { useDashboards, useReorderDashboards, useSubjects, type Dashboard } from "@/lib/api/queries";
import { TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { ChevronIcon, MoreIcon, PlusIcon } from "@/components/ui/icons";
import { SubjectIcon } from "@/components/ui/SubjectIcon";
import { DashboardDot, DashboardEditPop, useRenameDashboard } from "@/components/dashboard/DashboardIdentity";

import { NewDashboard } from "@/components/dashboard/NewDashboard";

import { ProfileMenu } from "./ProfileMenu";

const TYPES: SubjectType[] = ["topic", "group", "entity"];
const DRAG_THRESHOLD = 6;

/** `ids` with the one at `from` moved to `to`. */
function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function Sidebar() {
  const pathname = usePathname();
  const dashboards = useDashboards();
  const subjects = useSubjects();
  const [expanded, setExpanded] = useState<Set<SubjectType>>(new Set());
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // On arriving at a monitor page, open its type's section once; the user can still collapse it.
  const currentType = subjects.data?.find((s) => monitorHref(s.id) === pathname)?.type;
  if (currentType && openedFor !== pathname) {
    setOpenedFor(pathname);
    setExpanded((prev) => new Set(prev).add(currentType));
  }

  const toggle = (type: SubjectType) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  return (
    <nav className="side" aria-label="Main">
      <Link href="/" className="brand">
        IntelMonitor
      </Link>
      <div className="side-scroll" data-tour="sidebar">
        <div className="navhead" id="nav-dashboards">
          Dashboards
        </div>
        <button type="button" className="navitem" data-tour="new-dashboard" onClick={() => setCreating(true)}>
          <PlusIcon />
          <span>New dashboard</span>
        </button>
        {dashboards.data && <DashboardList dashboards={dashboards.data} pathname={pathname} />}
        <div className="navhead">Monitors</div>
        {TYPES.map((type) => {
          const list = subjects.data?.filter((s) => s.type === type) ?? [];
          const open = expanded.has(type);
          return (
            <div key={type} className="navgroup">
              <button
                type="button"
                className="navitem"
                aria-expanded={open}
                aria-controls={`nav-${type}`}
                onClick={() => toggle(type)}
              >
                <ChevronIcon />
                <span>{TYPE_PLURAL[type]}</span>
                <span className="count">{subjects.data ? list.length : ""}</span>
              </button>
              <div id={`nav-${type}`} className="navgroup" hidden={!open}>
                {list.map((s) => {
                  const href = monitorHref(s.id);
                  return (
                    <Link
                      key={s.id}
                      href={href}
                      className="navitem sub"
                      aria-current={pathname === href ? "page" : undefined}
                    >
                      <SubjectIcon subject={s} />
                      <span>{s.name}</span>
                      {s.new_developments > 0 && (
                        <span className="count" aria-label={`${s.new_developments} new`}>
                          {s.new_developments}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <ProfileMenu />
      <NewDashboard open={creating} onClose={() => setCreating(false)} />
    </nav>
  );
}

/**
 * The sidebar dashboards. A drag lifts the row under the pointer and the rows it passes shift a slot
 * to make room; dropping saves the order. Touch scrolls the sidebar instead, so it uses the menu.
 */
function DashboardList({ dashboards, pathname }: { dashboards: Dashboard[]; pathname: string }) {
  const reorder = useReorderDashboards();
  const list = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; pitch: number } | null>(
    null,
  );
  // The dropped order, shown until `dashboards` changes to the saved order so the old one never flashes.
  const [dropped, setDropped] = useState<{ ids: string[]; base: Dashboard[] } | null>(null);
  const byId = new Map(dashboards.map((d) => [d.id, d]));
  const shown = dropped?.base === dashboards ? dropped.ids.flatMap((id) => byId.get(id) ?? []) : dashboards;
  const ids = shown.map((d) => d.id);

  const move = (id: string, step: -1 | 1) => {
    const from = ids.indexOf(id);
    reorder(moved(ids, from, from + step));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (e.button !== 0 || e.pointerType === "touch" || !(e.target instanceof Element)) return;
    const row = e.target.closest<HTMLElement>("[data-dashboard-id]");
    if (!row || e.target.closest("button, input")) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-dashboard-id]") ?? [])];
    const from = rows.indexOf(row);
    const pitch = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
    const id = row.dataset.dashboardId ?? "";
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let to = from;

    const end = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        suppressClick.current = true;
        window.getSelection()?.removeAllRanges();
      }
      // The row stays within the list; it takes the slot its middle is over.
      const dy = Math.min(Math.max(ev.clientY - startY, -from * pitch), (rows.length - 1 - from) * pitch);
      to = from + Math.round(dy / pitch);
      setDrag({ id, from, to, dy, pitch });
    };
    const onPointerUp = () => {
      end();
      if (!dragging) return;
      if (to !== from) {
        const next = moved(ids, from, to);
        setDropped({ ids: next, base: dashboards });
        reorder(next);
      }
      setDrag(null);
    };
    const onPointerCancel = () => {
      end();
      setDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  // Capture phase, so the click that ends a drag never follows the row's link.
  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  /** How far a row sits from its slot while a drag is under way. */
  const offset = (i: number, id: string) => {
    if (!drag) return 0;
    if (id === drag.id) return drag.dy;
    if (drag.from < i && i <= drag.to) return -drag.pitch;
    if (drag.to <= i && i < drag.from) return drag.pitch;
    return 0;
  };

  return (
    <div
      ref={list}
      className={`dashlist${drag ? " sorting" : ""}`}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
    >
      {shown.map((d, i) => (
        <DashboardRow
          key={d.id}
          dashboard={d}
          current={pathname === `/dashboards/${d.id}`}
          index={i}
          count={shown.length}
          lifted={drag?.id === d.id}
          offset={offset(i, d.id)}
          onMove={(step) => move(d.id, step)}
        />
      ))}
    </div>
  );
}

/**
 * A sidebar dashboard: the "more" button (shown on hover) opens name, color, order and delete; a
 * double-click renames in place.
 */
function DashboardRow({
  dashboard: d,
  current,
  index,
  count,
  lifted,
  offset,
  onMove,
}: {
  dashboard: Dashboard;
  current: boolean;
  index: number;
  count: number;
  lifted: boolean;
  offset: number;
  onMove: (step: -1 | 1) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rename = useRenameDashboard();
  const moreRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);

  const finish = (name: string | null) => {
    if (name !== null) rename(d, name);
    setRenaming(false);
    requestAnimationFrame(() => linkRef.current?.focus());
  };

  return (
    <div
      className={`dashrow${editing ? " open" : ""}${lifted ? " lifted" : ""}`}
      data-dashboard-id={d.id}
      style={offset ? { transform: `translateY(${offset}px)` } : undefined}
    >
      <span className="dashrow-dot">
        <DashboardDot color={d.color} />
      </span>
      {renaming ? (
        <div className="navitem" aria-current={current ? "page" : undefined}>
          <input
            className="input"
            aria-label="Dashboard name"
            defaultValue={d.name}
            maxLength={80}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => finish(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish(e.currentTarget.value);
              if (e.key === "Escape") finish(null);
            }}
          />
        </div>
      ) : (
        <Link
          ref={linkRef}
          href={`/dashboards/${d.id}`}
          className="navitem"
          aria-current={current ? "page" : undefined}
          title="Double-click to rename"
          draggable={false}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenaming(true);
          }}
        >
          <span>{d.name}</span>
        </Link>
      )}
      <button
        ref={moreRef}
        type="button"
        className="more-btn"
        aria-label={`Options for ${d.name}`}
        aria-haspopup="dialog"
        aria-expanded={editing}
        onClick={() => setEditing((e) => !e)}
      >
        <MoreIcon />
      </button>
      {editing && (
        <DashboardEditPop
          dashboard={d}
          trigger={moreRef}
          index={index}
          count={count}
          onMove={onMove}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
