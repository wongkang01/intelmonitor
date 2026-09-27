"use client";

// The developments list's filter bar: a words filter, a button per facet whose popover lists the
// facet's values with counts, and the switch between every development and What changed. One
// popover is open at a time; Esc or a click outside closes it.
import { useEffect, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useDismiss } from "@/lib/dom";
import { ANY_TIME, FACETS, selected, withFacet, type FacetId } from "@/lib/developments";
import { ChevronDownIcon, SearchIcon } from "@/components/ui/icons";

type FacetValue = Schema<"FacetValue">;
type FacetDef = (typeof FACETS)[number];

const WORDS_DELAY_MS = 250;

export function FilterBar({
  params,
  facets,
  counts,
  changed,
  onParams,
}: {
  params: URLSearchParams;
  /** The facets' values and counts; absent until the first list loads. */
  facets: Schema<"DevelopmentFacets"> | undefined;
  /** Developments matching the filters, and those of them changed since the review. */
  counts: { all: number; changed: number } | undefined;
  changed: boolean;
  onParams: (next: URLSearchParams) => void;
}) {
  const [open, setOpen] = useState<FacetId | null>(null);
  return (
    <div className="fbar" role="group" aria-label="Filters">
      <Words params={params} onParams={onParams} />
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
      <span className="push" />
      <div className="seg" role="group" aria-label="Developments to list">
        {[
          { label: "All", value: false, n: counts?.all },
          { label: "New since review", value: true, n: counts?.changed },
        ].map((v) => (
          <button
            key={v.label}
            type="button"
            aria-pressed={v.value === changed}
            onClick={() => {
              if (v.value === changed) return;
              const next = new URLSearchParams(params);
              if (v.value) next.set("changed", "1");
              else next.delete("changed");
              onParams(next);
            }}
          >
            {v.label}
            {v.n !== undefined && <span className="seg-n">{v.n}</span>}
          </button>
        ))}
      </div>
    </div>
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
 * A facet's button and popover. The button names the selection ("Materiality: Significant"); the
 * popover lists the values with counts as checkboxes, or radios for a single-choice facet.
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
  // The date facet always has a value; Any time is no filter.
  const set = chosen.filter((v) => v !== ANY_TIME);
  const id = `facet-${facet.id}`;

  return (
    <div className="fwrap" ref={wrap}>
      <button
        type="button"
        className={`btn btn-sm fbtn${set.length ? " set" : ""}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        ref={trigger}
        onClick={onToggle}
      >
        {facet.label}
        {set.length > 0 && (
          <>
            :{" "}
            <b>
              {label(set[0])}
              {set.length > 1 && ` +${set.length - 1}`}
            </b>
          </>
        )}
        <ChevronDownIcon />
      </button>
      {open && <FacetPopover id={id} facet={facet} values={values} chosen={chosen} cleared={set.length === 0} onChange={onChange} />}
    </div>
  );
}

/** The open popover; focus moves into it, to its find field or its first value. */
function FacetPopover({
  id,
  facet,
  values,
  chosen,
  cleared,
  onChange,
}: {
  id: string;
  facet: FacetDef;
  values: FacetValue[] | undefined;
  chosen: string[];
  cleared: boolean;
  onChange: (values: string[]) => void;
}) {
  const [find, setFind] = useState("");
  const pop = useRef<HTMLDivElement>(null);
  const shown = values?.filter((v) => v.label.toLowerCase().includes(find.trim().toLowerCase())) ?? [];

  useEffect(() => {
    pop.current?.querySelector("input")?.focus();
  }, []);

  return (
    <div className="fpop" id={id} role="dialog" aria-label={facet.label} ref={pop}>
      {facet.find && (
        <div className="fpop-head">
          <label className="field">
            <SearchIcon />
            <input type="search" placeholder={facet.find} aria-label={facet.find} value={find} onChange={(e) => setFind(e.target.value)} />
          </label>
        </div>
      )}
      <div className="fpop-body">
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
        {values && shown.length === 0 && <p className="fpop-empty">{find ? "No match" : "Nothing to filter by"}</p>}
      </div>
      <div className="fpop-foot">
        <button type="button" className="link" disabled={cleared} onClick={() => onChange([])}>
          Clear
        </button>
      </div>
    </div>
  );
}
