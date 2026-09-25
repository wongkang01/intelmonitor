"use client";

// Sidebar: brand, Dashboards (New dashboard first), Monitors by type with counts, profile menu.
// The Monitors section holding the current subject opens itself, so the current page is always marked.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { useDashboards, useSubjects } from "@/lib/api/queries";
import { TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { ChevronIcon, MoreIcon, PlusIcon } from "@/components/ui/icons";
import { EntityIcon } from "@/components/ui/EntityIcon";
import type { Schema } from "@/lib/api/client";

import { DashboardDot, DashboardEditPop, useRenameDashboard } from "@/components/dashboard/DashboardIdentity";

import { NewDashboard } from "@/components/dashboard/NewDashboard";

import { ProfileMenu } from "./ProfileMenu";

const TYPES: SubjectType[] = ["topic", "group", "entity"];

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
      <div className="side-scroll">
        <div className="navhead" id="nav-dashboards">
          Dashboards
        </div>
        <button type="button" className="navitem" onClick={() => setCreating(true)}>
          <PlusIcon />
          <span>New dashboard</span>
        </button>
        {dashboards.data?.map((d) => (
          <DashboardRow key={d.id} dashboard={d} current={pathname === `/dashboards/${d.id}`} />
        ))}
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
                      <EntityIcon subject={s} />
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

/** A sidebar dashboard: the "more" button (shown on hover) opens name, color and delete; a double-click renames in place. */
function DashboardRow({ dashboard: d, current }: { dashboard: Schema<"Dashboard">; current: boolean }) {
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
    <div className={`dashrow${editing ? " open" : ""}`}>
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
      {editing && <DashboardEditPop dashboard={d} trigger={moreRef} onClose={() => setEditing(false)} />}
    </div>
  );
}
