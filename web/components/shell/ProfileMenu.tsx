// Profile button pinned to the sidebar bottom. The profile is a role standing in for identity
// (phase1-plan.md, item U3): the menu, opening upward, switches between the preloaded department
// profiles and the user's own roles in one click, adds a role through onboarding, and leads to Data
// sources and Help. `?` opens Help anywhere. Each app load, and each switch, logs a visit.
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { logVisit, useActivateProfile, useProfile, useProfiles } from "@/lib/api/queries";
import { typingIn } from "@/lib/dom";
import { roleName } from "@/lib/roles";
import { CheckIcon, ChevronUpIcon, HelpIcon, PlusIcon, SourcesIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Toast";

import { DataSourcesDialog, HelpDialog } from "./ProfileDialogs";

type DialogName = "sources" | "help";

/** Two letters for the avatar: "TC" for TCRD, "RS" for Regulatory supervisor, skipping "and". */
const avatarText = (name: string) => {
  const words = name.split(/\s+/).filter((w) => w && w !== "and");
  return (words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "")).slice(0, 2).toUpperCase();
};

// The profile a visit was last logged for in this page load, so a remount does not log twice.
let visitLoggedFor: string | null = null;

export function ProfileMenu() {
  const navigate = useNavigate();
  const toast = useToast();
  const profile = useProfile();
  const profiles = useProfiles();
  const activate = useActivateProfile();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const current = profile.data;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Logged once the page settles, so a switch logs the dashboard it opens rather than the page left.
  useEffect(() => {
    const id = current?.id;
    if (!id || visitLoggedFor === id) return;
    const t = window.setTimeout(() => {
      visitLoggedFor = id;
      logVisit(window.location.pathname);
    }, 500);
    return () => window.clearTimeout(t);
  }, [current?.id, pathname]);

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

  const switchTo = (id: string) => {
    setOpen(false);
    if (id === current?.id) return;
    activate.mutate(id, {
      onSuccess: (p) => {
        if (p.default_dashboard_id) void navigate({ to: "/dashboards/$id", params: { id: p.default_dashboard_id } });
        else void navigate({ to: "/" });
      },
      onError: () => toast({ message: "Could not switch role" }),
    });
  };

  const close = () => {
    setDialog(null);
    // The menu item that opened the dialog is gone, so return focus to the profile button.
    requestAnimationFrame(() => button.current?.focus());
  };

  const name = current?.name ?? "";
  const role = current?.role ? roleName(current.role) : "";

  return (
    <div className="profile-wrap" ref={wrap}>
      {open && (
        <div className="menu" id="profile-menu" role="menu" ref={menu} onKeyDown={onMenuKey}>
          <div role="group" aria-labelledby="switch-role-label">
            <span className="menu-label" id="switch-role-label">
              Switch role
            </span>
            {profiles.data?.map((p) => {
              const sub = p.role && roleName(p.role) !== p.name ? roleName(p.role) : null;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={p.id === current?.id}
                  className="menu-role"
                  onClick={() => p.id && switchTo(p.id)}
                >
                  <span className="menu-check">{p.id === current?.id && <CheckIcon />}</span>
                  <span>
                    {p.name}
                    {sub && <span className="menu-sub">{sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void navigate({ to: "/setup" });
            }}
          >
            <PlusIcon />
            Add a role
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDialog("sources");
            }}
          >
            <SourcesIcon />
            Data sources
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDialog("help");
            }}
          >
            <HelpIcon />
            Help
            <span className="kbd">?</span>
          </button>
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
          {avatarText(name)}
        </span>
        <span className="who">
          <b>{name}</b>
          <span>{role && role !== name ? role : "Your role"}</span>
        </span>
        <ChevronUpIcon />
      </button>
      <DataSourcesDialog open={dialog === "sources"} onClose={close} />
      <HelpDialog open={dialog === "help"} onClose={close} />
    </div>
  );
}
