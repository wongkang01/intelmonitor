"use client";

// Sidebar: brand, Dashboards (New dashboard first), Monitors by type with counts, profile menu.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useDashboards, useSubjects } from "@/lib/api/queries";
import { TYPE_COLOR, TYPE_PLURAL } from "@/lib/format";
import { monitorHref, type SubjectType } from "@/lib/widgets";
import { BrandIcon, ChevronIcon, DashboardIcon, PlusIcon } from "@/components/ui/icons";

import { ProfileMenu } from "./ProfileMenu";

const TYPES: SubjectType[] = ["topic", "group", "entity"];

export function Sidebar() {
  const pathname = usePathname();
  const dashboards = useDashboards();
  const subjects = useSubjects();
  const [expanded, setExpanded] = useState<Set<SubjectType>>(new Set());

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
        <i>
          <BrandIcon />
        </i>
        IntelMonitor
      </Link>
      <div className="side-scroll">
        <div className="navsec">
          <div className="navhead" id="nav-dashboards">
            Dashboards
          </div>
          {/* Opens the New dashboard popup (phase 6). */}
          <button type="button" className="navitem new">
            <PlusIcon />
            New dashboard
          </button>
          {dashboards.data?.map((d) => {
            const href = `/dashboards/${d.id}`;
            const active = pathname === href;
            return (
              <Link
                key={d.id}
                href={href}
                className="navitem"
                aria-current={active ? "page" : undefined}
              >
                <DashboardIcon active={active} />
                <span>{d.name}</span>
              </Link>
            );
          })}
        </div>
        <div className="navsec">
          <div className="navhead">Monitors</div>
          {TYPES.map((type) => {
            const list = subjects.data?.filter((s) => s.type === type) ?? [];
            const open = expanded.has(type);
            return (
              <div key={type} className="navsec">
                <button
                  type="button"
                  className="navitem"
                  aria-expanded={open}
                  aria-controls={`nav-${type}`}
                  onClick={() => toggle(type)}
                >
                  <span className="dot" style={{ background: TYPE_COLOR[type] }} />
                  <span>{TYPE_PLURAL[type]}</span>
                  <span className="count">{subjects.data ? list.length : ""}</span>
                  <ChevronIcon />
                </button>
                <div id={`nav-${type}`} className="navsec" hidden={!open}>
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
      </div>
      <ProfileMenu />
    </nav>
  );
}
