"use client";

// One toast at a time, optionally with an action such as Undo. It sits at the bottom-left of the
// content column, or inside the open modal dialog when there is one: everything outside a modal
// <dialog> is inert, so a toast there could not be clicked.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ToastSpec {
  message: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(toast: ToastSpec) => void>(() => {});

/** Usage: `const toast = useToast(); toast({ message: "Removed Watchlist", action: { label: "Undo", run } })`. */
export const useToast = () => useContext(ToastContext);

/** The topmost open modal dialog, which the toast must render inside to stay interactive. */
const openModal = () => [...document.querySelectorAll<HTMLDialogElement>("dialog.modal[open]")].at(-1) ?? null;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { key: number; host: HTMLDialogElement | null }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((spec: ToastSpec) => {
    setToast({ ...spec, key: Date.now(), host: openModal() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    timer.current = window.setTimeout(() => setToast(null), toast.action ? 5000 : 2600);
    return () => window.clearTimeout(timer.current);
  }, [toast]);

  // A toast raised just before its dialog closes (such as "Created …") moves back to the page.
  const host = toast?.host;
  useEffect(() => {
    if (!host) return;
    const moveOut = () => setToast((t) => (t && t.host === host ? { ...t, host: null } : t));
    host.addEventListener("close", moveOut);
    return () => host.removeEventListener("close", moveOut);
  }, [host]);

  const body = toast && (
    <div className="toast" key={toast.key}>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            setToast(null);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {!host && body}
      </div>
      {host &&
        createPortal(
          <div className="toast-region" role="status" aria-live="polite">
            {body}
          </div>,
          host,
        )}
    </ToastContext.Provider>
  );
}
