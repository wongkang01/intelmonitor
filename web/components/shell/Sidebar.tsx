"use client";

// Sidebar: brand, Dashboards (New dashboard first), Monitors by type with counts, profile menu.
// The Monitors section holding the current subject opens itself, so the current page is always marked.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useDashboards, useSubjects } from "@/lib/api/queries";
import { TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { ChevronIcon, PlusIcon } from "@/components/ui/icons";

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
        {dashboards.data?.map((d) => {
          const href = `/dashboards/${d.id}`;
          return (
            <Link key={d.id} href={href} className="navitem" aria-current={pathname === href ? "page" : undefined}>
              <span>{d.name}</span>
            </Link>
          );
        })}
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
