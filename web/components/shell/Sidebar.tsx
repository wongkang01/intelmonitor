// Sidebar: brand, Ask, Dashboards (New dashboard first), Entities with their groups as headings, Topics,
// and the profile menu. A group holding the current page opens itself, so the current page is
// always marked. An entity or topic with a High development new since the last visit shows
// "1 High". A dashboard shows "N new": its developments new since the last visit and unread. A
// dashboard's developments list marks its dashboard.
// Dashboards reorder by dragging a row with a mouse or pen, or with Move up and Move down in the
// row's options popover.
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";

import type { Schema } from "@/lib/api/client";
import { useDashboards, useProfile, useReorderDashboards, useSubjects, type DashboardItem } from "@/lib/api/queries";
import { plural, shortDate } from "@/lib/format";
import { usePathname, useSearchParams } from "@/lib/router";
import { monitorLink } from "@/lib/widgets";
import { ChatIcon, ChevronIcon, MoreIcon, PlusIcon } from "@/components/ui/icons";
import { SubjectIcon } from "@/components/ui/SubjectIcon";
import { DashboardDot, DashboardEditPop, useRenameDashboard } from "@/components/dashboard/DashboardIdentity";

import { ProfileMenu } from "./ProfileMenu";

const NewDashboard = lazy(() => import("@/components/dashboard/NewDashboard").then((m) => ({ default: m.NewDashboard })));

type Subject = Schema<"SubjectSummary">;

const DRAG_THRESHOLD = 6;

/** `ids` with the one at `from` moved to `to`. */
function moved(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// The sidebar sections a viewer can collapse; which are closed is remembered in this browser only.
type NavSection = "entities" | "topics";
const CLOSED_KEY = "im.sidebar.closed";

function readClosed(): Set<NavSection> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((v): v is NavSection => v === "entities" || v === "topics") : []);
  } catch {
    return new Set();
  }
}

function saveClosed(closed: Set<NavSection>) {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify([...closed]));
  } catch {
    // Storage can be blocked; the sections then just open on each load.
  }
}

/** A section heading that opens and closes the list under it. */
function SectionToggle({ id, label, open, onToggle }: { id: string; label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="navhead navhead-btn" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span>{label}</span>
      <ChevronIcon />
    </button>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const dashboards = useDashboards();
  const subjects = useSubjects();
  const lastVisit = useProfile().data?.last_visit ?? null;
  const since = lastVisit ? `your last visit on ${shortDate(lastVisit)}` : "the last update";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [closed, setClosed] = useState<Set<NavSection>>(readClosed);
  useEffect(() => saveClosed(closed), [closed]);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Once opened, the sheet stays mounted so it can animate closed.
  const [sheetLoaded, setSheetLoaded] = useState(false);
  if (creating && !sheetLoaded) setSheetLoaded(true);

  const all = subjects.data ?? [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const groups = all.filter((s) => s.type === "group");
  const topics = all.filter((s) => s.type === "topic");

  // On arriving at an entity's page (any tab), open its section and group once; on a topic's page,
  // open Topics. The user can still collapse them.
  const currentId = pathname.match(/^\/monitors\/([^/]+)/)?.[1];
  const currentGroup = groups.find((g) => currentId && g.members.includes(currentId))?.id;
  const currentSection: NavSection | null = currentGroup ? "entities" : topics.some((t) => t.id === currentId) ? "topics" : null;
  if (currentSection && openedFor !== pathname) {
    setOpenedFor(pathname);
    if (currentGroup) setExpanded((prev) => new Set(prev).add(currentGroup));
    if (closed.has(currentSection))
      setClosed((prev) => {
        const next = new Set(prev);
        next.delete(currentSection);
        return next;
      });
  }

  const toggleSection = (section: NavSection) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (s: Subject, sub: boolean) => (
    <Link key={s.id} {...monitorLink(s.id)} className={`navitem${sub ? " sub" : ""}`}>
      <SubjectIcon subject={s} />
      <span>{s.name}</span>
      {s.new_high > 0 && (
        <span
          className="count attn"
          title={`${plural(s.new_high, "new High development")} since ${since}`}
        >
          {s.new_high} High
        </span>
      )}
    </Link>
  );

  return (
    <nav className="side" aria-label="Main">
      <Link to="/" activeOptions={{ exact: true }} className="brand">
        IntelMonitor
      </Link>
      <div className="side-scroll">
        <Link to="/ask" className="navitem">
          <ChatIcon />
          <span>Ask</span>
        </Link>
        <div className="navhead" id="nav-dashboards">
          Dashboards
        </div>
        <button type="button" className="navitem" onClick={() => setCreating(true)}>
          <PlusIcon />
          <span>New dashboard</span>
        </button>
        {dashboards.data && <DashboardList dashboards={dashboards.data} pathname={pathname} since={since} />}
        <SectionToggle id="nav-entities" label="Entities" open={!closed.has("entities")} onToggle={() => toggleSection("entities")} />
        <div id="nav-entities" className="navgroup" hidden={closed.has("entities")}>
          {groups.map((g) => {
            const open = expanded.has(g.id);
            return (
              <div key={g.id} className="navgroup">
                <button
                  type="button"
                  className="navitem"
                  aria-expanded={open}
                  aria-controls={`nav-${g.id}`}
                  onClick={() => toggle(g.id)}
                >
                  <ChevronIcon />
                  <span>{g.name}</span>
                  <span className="count">{g.members.length}</span>
                </button>
                <div id={`nav-${g.id}`} className="navgroup" hidden={!open}>
                  {g.members.flatMap((m) => byId.get(m) ?? []).map((s) => row(s, true))}
                </div>
              </div>
            );
          })}
        </div>
        <SectionToggle id="nav-topics" label="Topics" open={!closed.has("topics")} onToggle={() => toggleSection("topics")} />
        <div id="nav-topics" className="navgroup" hidden={closed.has("topics")}>
          {topics.map((s) => row(s, false))}
        </div>
      </div>
      <ProfileMenu />
      {sheetLoaded && (
        <Suspense>
          <NewDashboard open={creating} onClose={() => setCreating(false)} />
        </Suspense>
      )}
    </nav>
  );
}

/**
 * The sidebar dashboards. A drag lifts the row under the pointer and the rows it passes shift a slot
 * to make room; dropping saves the order. Touch scrolls the sidebar instead, so it uses the menu.
 */
function DashboardList({ dashboards, pathname, since }: { dashboards: DashboardItem[]; pathname: string; since: string }) {
  const reorder = useReorderDashboards();
  // The dashboard page, or the dashboard whose developments list is open.
  const params = useSearchParams();
  const currentId = pathname === "/developments" ? params.get("dashboard") : pathname.match(/^\/dashboards\/([^/]+)$/)?.[1];
  const list = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number; pitch: number } | null>(
    null,
  );
  // The dropped order, shown until `dashboards` changes to the saved order so the old one never flashes.
  const [dropped, setDropped] = useState<{ ids: string[]; base: DashboardItem[] } | null>(null);
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
          current={currentId === d.id}
          index={i}
          count={shown.length}
          lifted={drag?.id === d.id}
          offset={offset(i, d.id)}
          since={since}
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
  since,
  onMove,
}: {
  dashboard: DashboardItem;
  current: boolean;
  index: number;
  count: number;
  lifted: boolean;
  offset: number;
  /** What the new count counts from, for its tooltip. */
  since: string;
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
          to="/dashboards/$id"
          params={{ id: d.id }}
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
          {d.new_count > 0 && (
            <span className="count" title={`${plural(d.new_count, "development")} new since ${since}`}>
              {d.new_count} new
            </span>
          )}
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
