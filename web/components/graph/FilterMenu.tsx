// A bordered select-style button ("Links: All") opening a checklist of filter values, for the
// graph view's toolbar. One value always stays checked.
import { useEffect, useId, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/ui/icons";

/** Toggles `item` in `list`, never leaving it empty (the API reads an empty filter as "all"). */
export function toggle<T>(list: T[], item: T): T[] {
  if (!list.includes(item)) return [...list, item];
  return list.length > 1 ? list.filter((x) => x !== item) : list;
}

/** A bordered select-style button ("Nodes: All") opening a checklist; closes on Escape or outside click. */
export function FilterMenu<T extends string>({
  name,
  options,
  selected,
  onToggle,
  dot = false,
}: {
  name: string;
  options: { value: T; label: string; count?: number }[];
  selected: T[];
  onToggle: (value: T) => void;
  /** Show each option's graph color dot (node types). */
  dot?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const chosen = options.filter((o) => selected.includes(o.value));
  const summary =
    chosen.length === options.length
      ? "All"
      : chosen.length <= 2
        ? chosen.map((o) => o.label).join(", ")
        : `${chosen.length} of ${options.length}`;

  return (
    <div className="gmenu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="gsel"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="gsel-name">{name}:</span> {summary}
        <ChevronDownIcon />
      </button>
      {open && (
        <div className="gmenu-pop" id={menuId} role="group" aria-label={`${name} shown`}>
          {options.map((o) => {
            const on = selected.includes(o.value);
            return (
              <label key={o.value} className="gmenu-item">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={on && selected.length === 1}
                  onChange={() => onToggle(o.value)}
                />
                {dot && <span className={`gdot ${o.value}`} aria-hidden="true" />}
                {o.label}
                {o.count !== undefined && <span className="gmenu-count">{o.count}</span>}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
