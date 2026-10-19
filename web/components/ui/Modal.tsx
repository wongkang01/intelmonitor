// A native modal <dialog>: focus stays inside (Tab wraps around), Esc and a backdrop click close it,
// and focus returns to the opener. `className` starts with the shape, "sheet" (80% of the screen) or
// "panel" (a 560px dialog), and may add a class of its own. Styles live in app/globals.css: 14px
// radius, --shadow-modal, --scrim backdrop, and a 48px `.sheet-head` header that ends with
// <CloseButton />.
import { useEffect, useRef, type ReactNode } from "react";

/** What asked a modal to close: the Esc key or a click on the backdrop. */
export type CloseReason = "escape" | "backdrop";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tab and Shift+Tab wrap around inside the dialog instead of leaving for the browser's own controls. */
function wrapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
  if (e.key !== "Tab" || e.defaultPrevented) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.checkVisibility());
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const at = document.activeElement;
  if (e.shiftKey ? at === first || at === e.currentTarget : at === last) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
}

export function Modal({
  open,
  onClose,
  labelledBy,
  label,
  className,
  children,
}: {
  open: boolean;
  onClose: (reason: CloseReason) => void;
  labelledBy?: string;
  label?: string;
  className: "sheet" | "panel" | `${"sheet" | "panel"} ${string}`;
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
        onClose("escape");
      }}
      onKeyDown={wrapTab}
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        const inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) onClose("backdrop");
      }}
    >
      {open && children}
    </dialog>
  );
}

/** The 28px ghost close button for modal, sheet and drawer headers. */
export function CloseButton({ onClick, label = "Close" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn-icon close" aria-label={label} onClick={onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
