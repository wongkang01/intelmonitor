"use client";

// Top bar with the single search field. ⌘K focuses it; results arrive in phase 5.
import { useEffect, useRef } from "react";

import { SearchIcon } from "@/components/ui/icons";

export function TopBar() {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="topbar">
      <label className="search">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          aria-label="Search or ask"
          placeholder="Search or ask about a topic, group or entity"
        />
        <span className="kbdchip" aria-hidden="true">
          ⌘K
        </span>
      </label>
    </div>
  );
}
