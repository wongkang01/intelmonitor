"use client";

// A native modal <dialog>: focus stays inside, Esc and a backdrop click close it, and focus
// returns to the opener. `className` picks the shape: "sheet" (80% of the screen) or "panel".
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  open,
  onClose,
  labelledBy,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  label?: string;
  className: "sheet" | "panel";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${className}`}
      aria-labelledby={labelledBy}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="close" aria-label={label} onClick={onClick}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 3l6 6M9 3l-6 6" stroke="#3A3A40" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}
