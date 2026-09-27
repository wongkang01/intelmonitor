"use client";

// Profile button pinned to the sidebar bottom; its menu opens upward and leads to four dialogs.
// Help, last after a separator, replaces the old Keyboard shortcuts item; `?` opens it anywhere.
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { useProfile } from "@/lib/api/queries";
import { typingIn } from "@/lib/dom";
import { initials } from "@/lib/format";
import { ChevronUpIcon, HelpIcon, HistoryIcon, SettingsIcon, SourcesIcon } from "@/components/ui/icons";

import { DataSourcesDialog, HelpDialog, RunHistoryDialog, SettingsDialog } from "./ProfileDialogs";
import { useStartTour } from "./Tour";

type DialogName = "settings" | "sources" | "runs" | "help";

const ITEMS: { name: DialogName; label: string; icon: ReactNode; hint?: string }[] = [
  { name: "settings", label: "Settings", icon: <SettingsIcon /> },
  { name: "sources", label: "Data sources", icon: <SourcesIcon /> },
  { name: "runs", label: "Run history", icon: <HistoryIcon /> },
  { name: "help", label: "Help", icon: <HelpIcon />, hint: "?" },
];

export function ProfileMenu() {
  const profile = useProfile();
  const startTour = useStartTour();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) menu.current?.querySelector("button")?.focus();
  }, [open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (open && !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        button.current?.focus();
      }
      if (e.key === "?" && !typingIn(e.target) && !document.querySelector("dialog[open]")) {
        e.preventDefault();
        setOpen(false);
        setDialog("help");
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (step !== undefined) {
      e.preventDefault();
      items[(i + step + items.length) % items.length]?.focus();
    }
    if (e.key === "Tab") setOpen(false);
  };

  const name = profile.data?.display_name ?? "";
  const close = () => {
    setDialog(null);
    // The menu item that opened the dialog is gone, so return focus to the profile button.
    requestAnimationFrame(() => button.current?.focus());
  };

  return (
    <div className="profile-wrap" ref={wrap}>
      {open && (
        <div className="menu" id="profile-menu" role="menu" ref={menu} onKeyDown={onMenuKey}>
          {ITEMS.map((item) => (
            <Fragment key={item.name}>
              {item.name === "help" && <hr />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setDialog(item.name);
                }}
              >
                {item.icon}
                {item.label}
                {item.hint && <span className="kbd">{item.hint}</span>}
              </button>
            </Fragment>
          ))}
        </div>
      )}
      <button
        ref={button}
        type="button"
        className="profile"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-menu"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="who">
          <b>{name}</b>
          <span>{profile.data?.role}</span>
        </span>
        <ChevronUpIcon />
      </button>
      <SettingsDialog open={dialog === "settings"} onClose={close} />
      <DataSourcesDialog open={dialog === "sources"} onClose={close} />
      <RunHistoryDialog open={dialog === "runs"} onClose={close} />
      <HelpDialog
        open={dialog === "help"}
        onClose={close}
        onReplay={() => {
          setDialog(null);
          startTour(button.current);
        }}
      />
    </div>
  );
}
