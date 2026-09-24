"use client";

// One toast at a time at the bottom-left of the content column, optionally with an action such as Undo.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastSpec {
  message: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<(toast: ToastSpec) => void>(() => {});

/** Usage: `const toast = useToast(); toast({ message: "Widget removed", action: { label: "Undo", run } })`. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastSpec & { key: number }) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((spec: ToastSpec) => {
    setToast({ ...spec, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    timer.current = window.setTimeout(() => setToast(null), toast.action ? 5000 : 2600);
    return () => window.clearTimeout(timer.current);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
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
        )}
      </div>
    </ToastContext.Provider>
  );
}
