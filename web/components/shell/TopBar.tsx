"use client";

// Top bar with the single search field. ⌘K focuses it; typing a subject name or alias lists
// matches, arrows move, Enter opens the highlighted subject's page, Esc clears.
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Schema } from "@/lib/api/client";
import { searchOptions, useSearch } from "@/lib/api/queries";
import { TYPE_COLOR, TYPE_LABEL } from "@/lib/format";
import { monitorHref } from "@/lib/widgets";
import { SearchIcon } from "@/components/ui/icons";

const MAX_HITS = 8;

export function TopBar() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useSearch(text);
  const blank = !text.trim();
  const hits = blank ? [] : (search.data ?? []).slice(0, MAX_HITS);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (hit: Schema<"SearchHit">) => {
    router.push(monitorHref(hit.subject.id));
    setText("");
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + hits.length) % hits.length);
    } else if (e.key === "Enter" && !blank) {
      e.preventDefault();
      // Shown results may be for an earlier keystroke; then Enter takes the best current match.
      const stale = search.isPlaceholderData || !search.data;
      const hit = stale ? (await client.fetchQuery(searchOptions(text)))[0] : hits[active];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (text) setText("");
      else input.current?.blur();
    }
  };

  const showList = open && !blank && (hits.length > 0 || search.isFetched);

  return (
    <div className="topbar">
      <div className="search-wrap">
        <label className="search">
          <SearchIcon />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Search or ask"
            aria-expanded={showList}
            aria-controls="search-results"
            aria-autocomplete="list"
            aria-activedescendant={showList && hits[active] ? `search-hit-${hits[active].subject.id}` : undefined}
            placeholder="Search or ask about a topic, group or entity"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => void onKeyDown(e)}
          />
          <span className="kbdchip" aria-hidden="true">
            ⌘K
          </span>
        </label>
        {showList && (
          <div id="search-results" role="listbox" aria-label="Matching subjects" className="search-list">
            {hits.map((h, i) => (
              <div
                key={h.subject.id}
                id={`search-hit-${h.subject.id}`}
                role="option"
                aria-selected={i === active}
                className="search-hit"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
              >
                <span className="dot" style={{ background: TYPE_COLOR[h.subject.type] }} />
                <b>{h.subject.name}</b>
                {h.matched !== h.subject.name && <span className="cap">{h.matched}</span>}
                <span className="cap type">{TYPE_LABEL[h.subject.type]}</span>
              </div>
            ))}
            {hits.length === 0 && <p className="muted">No topic, group or entity matches “{text.trim()}”.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
