// A feed's filter bar: an optional words filter, a button per facet whose popover lists All, then
// the facet's values with counts, and "Show unconfirmed" when the source gate holds some back. One
// popover is open at a time; Esc, a click outside or tabbing out of it closes it. The bar wraps
// when it does not fit on one line.
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useDismiss } from "@/lib/dom";
import { FACETS, selected, showsUnconfirmed, withFacet, withUnconfirmed, type FacetId } from "@/lib/developments";
import { ChevronDownIcon, SearchIcon } from "@/components/ui/icons";

type FacetValue = Schema<"FacetValue">;
type FacetDef = (typeof FACETS)[number];

const WORDS_DELAY_MS = 250;

export function FilterBar({
  params,
  facets,
  unconfirmed,
  words = false,
  onParams,
}: {
  params: URLSearchParams;
  /** The facets' values and counts; absent until the first list loads. */
  facets: Schema<"DevelopmentFacets"> | undefined;
  /** Unconfirmed developments matching the filters; absent until the first list loads. */
  unconfirmed: number | undefined;
  /** Show the words filter. */
  words?: boolean;
  onParams: (next: URLSearchParams) => void;
}) {
  const [open, setOpen] = useState<FacetId | null>(null);
  return (
    <div className="fbar" role="group" aria-label="Filters">
      {words && <Words params={params} onParams={onParams} />}
      {FACETS.map((f) => (
        <Facet
          key={f.id}
          facet={f}
          values={facets?.[f.id]}
          chosen={selected(params, f.id)}
          open={open === f.id}
          onToggle={() => setOpen((o) => (o === f.id ? null : f.id))}
          onClose={() => setOpen(null)}
          onChange={(values) => onParams(withFacet(params, f.id, values))}
        />
      ))}
      <Unconfirmed count={unconfirmed} on={showsUnconfirmed(params)} onChange={(on) => onParams(withUnconfirmed(params, on))} />
    </div>
  );
}

/** "Show unconfirmed" with how many match, shown while there are some or it is on. */
function Unconfirmed({ count, on, onChange }: { count: number | undefined; on: boolean; onChange: (on: boolean) => void }) {
  if (!on && !count) return null;
  return (
    <label className={`fopt${on ? " on" : ""}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Show unconfirmed
      {count !== undefined && <span className="n">{count}</span>}
    </label>
  );
}

/** The words filter: typing updates the URL after a pause. */
function Words({ params, onParams }: { params: URLSearchParams; onParams: (next: URLSearchParams) => void }) {
  const current = params.get("q") ?? "";
  const [text, setText] = useState(current);
  const [synced, setSynced] = useState(current);
  // Back, Clear filters or a reload change the URL: the field follows.
  if (current !== synced) {
    setSynced(current);
    setText(current);
  }

  useEffect(() => {
    if (text === current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (text.trim()) next.set("q", text);
      else next.delete("q");
      setSynced(text);
      onParams(next);
    }, WORDS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, current, params, onParams]);

  return (
    <label className="field fsearch">
      <SearchIcon />
      <input type="search" placeholder="Filter by words" aria-label="Filter by words" value={text} onChange={(e) => setText(e.target.value)} />
    </label>
  );
}

/**
 * A facet's button and popover. The button names the selection ("Priority", "Priority: High",
 * "Priority: 2 selected"); the popover lists All, then the values with counts as checkboxes, or
 * radios for a single-choice facet.
 */
function Facet({
  facet,
  values,
  chosen,
  open,
  onToggle,
  onClose,
  onChange,
}: {
  facet: FacetDef;
  values: FacetValue[] | undefined;
  chosen: string[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (values: string[]) => void;
}) {
  const { wrap, trigger } = useDismiss(open, onClose);
  const label = (v: string) => values?.find((x) => x.value === v)?.label ?? v;
  const id = `facet-${facet.id}`;

  return (
    <div
      className="fwrap"
      ref={wrap}
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) onClose();
      }}
    >
      <button
        type="button"
        className={`btn btn-sm fbtn${chosen.length ? " set" : ""}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        ref={trigger}
        onClick={onToggle}
      >
        {facet.label}
        {chosen.length > 0 && (
          <>
            : <b>{chosen.length === 1 ? label(chosen[0]) : `${chosen.length} selected`}</b>
          </>
        )}
        <ChevronDownIcon />
      </button>
      {open && <FacetPopover id={id} facet={facet} values={values} chosen={chosen} onChange={onChange} />}
    </div>
  );
}

/** The open popover; focus moves to its checked value, or to All. Values with no matches are left out. */
function FacetPopover({
  id,
  facet,
  values,
  chosen,
  onChange,
}: {
  id: string;
  facet: FacetDef;
  values: FacetValue[] | undefined;
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const shown = values?.filter((v) => v.count > 0 || chosen.includes(v.value)) ?? [];
  const total = values && facet.single ? values.reduce((n, v) => n + v.count, 0) : undefined;

  // Once, as soon as there is something to focus: a popover opened while its values load gets
  // focus when they arrive.
  useEffect(() => {
    const box = pop.current;
    const target = box?.querySelector<HTMLInputElement>("input:checked") ?? box?.querySelector("input");
    if (focused.current || !target) return;
    focused.current = true;
    target.focus();
  }, [values]);

  return (
    <div className="fpop" id={id} role="dialog" aria-label={facet.label} ref={pop}>
      <div className="fpop-body">
        <label className={`fopt${chosen.length === 0 ? " on" : ""}`}>
          <input type={facet.single ? "radio" : "checkbox"} name={id} checked={chosen.length === 0} onChange={() => onChange([])} />
          <span className="grow">All</span>
          {total !== undefined && <span className="n">{total}</span>}
        </label>
        {shown.map((v) => {
          const on = chosen.includes(v.value);
          return (
            <label key={v.value} className={`fopt${on ? " on" : ""}`}>
              <input
                type={facet.single ? "radio" : "checkbox"}
                name={id}
                checked={on}
                onChange={() => onChange(facet.single ? [v.value] : on ? chosen.filter((c) => c !== v.value) : [...chosen, v.value])}
              />
              <span className="grow">{v.label}</span>
              <span className="n">{v.count}</span>
            </label>
          );
        })}
        {values && shown.length === 0 && <p className="fpop-empty">Nothing to filter by</p>}
      </div>
    </div>
  );
}
