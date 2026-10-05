// One toast at a time, optionally with an action such as Undo. It sits at the bottom-left of the
// content column, or inside the open modal dialog when there is one: everything outside a modal
// <dialog> is inert, so a toast there could not be clicked. Its timer pauses while the pointer is
// over it or focus is in it.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ToastSpec {
  message: string;
  action?: { label: string; run: () => void };
  /** How long it shows, in ms; by default 5 s with an action and 2.6 s without. */
  duration?: number;
}

/** The duration for a delete whose Undo is the only way back, such as a note or a dashboard. */
export const DELETE_UNDO_MS = 8000;

const ToastContext = createContext<(toast: ToastSpec) => void>(() => {});

/** Usage: `const toast = useToast(); toast({ message: "Removed Watchlist", action: { label: "Undo", run } })`. */
export const useToast = () => useContext(ToastContext);

/** The topmost open modal dialog, which the toast must render inside to stay interactive. */
const openModal = () => [...document.querySelectorAll<HTMLDialogElement>("dialog.modal[open]")].at(-1) ?? null;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { key: number; host: HTMLDialogElement | null }) | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // The time left, when the timer last started, and whether the pointer is over it or focus in it.
  const left = useRef(0);
  const started = useRef(0);
  const held = useRef({ hover: false, focus: false });

  const show = useCallback((spec: ToastSpec) => {
    setToast({ ...spec, key: Date.now(), host: openModal() });
  }, []);

  const start = useCallback(() => {
    started.current = Date.now();
    timer.current = window.setTimeout(() => setToast(null), left.current);
  }, []);

  useEffect(() => {
    if (!toast) return;
    left.current = toast.duration ?? (toast.action ? 5000 : 2600);
    held.current = { hover: false, focus: false };
    start();
    return () => window.clearTimeout(timer.current);
  }, [toast, start]);

  const hold = (kind: "hover" | "focus", on: boolean) => {
    const was = held.current.hover || held.current.focus;
    held.current[kind] = on;
    const is = held.current.hover || held.current.focus;
    if (is && !was) {
      window.clearTimeout(timer.current);
      left.current -= Date.now() - started.current;
    } else if (was && !is) start();
  };

  // A toast raised just before its dialog closes (such as "Created …") moves back to the page.
  const host = toast?.host;
  useEffect(() => {
    if (!host) return;
    const moveOut = () => setToast((t) => (t && t.host === host ? { ...t, host: null } : t));
    host.addEventListener("close", moveOut);
    return () => host.removeEventListener("close", moveOut);
  }, [host]);

  const body = toast && (
    <div
      className="toast"
      key={toast.key}
      onMouseEnter={() => hold("hover", true)}
      onMouseLeave={() => hold("hover", false)}
      onFocus={() => hold("focus", true)}
      onBlur={() => hold("focus", false)}
    >
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
