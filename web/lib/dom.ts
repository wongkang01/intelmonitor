import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";

/** True when a key press should go to a text field rather than a shortcut. */
export const typingIn = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const COARSE = "(any-pointer: coarse)";
const subscribeCoarse = (onChange: () => void) => {
  const query = window.matchMedia(COARSE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** True on a device with a touch screen, where `styles/touch.css` grows rows to 44px. False on the server. */
export const useCoarsePointer = () =>
  useSyncExternalStore(subscribeCoarse, () => window.matchMedia(COARSE).matches, () => false);

/**
 * Ref callback for a sticky rail: keeps `--rail-h` set to its height, so its CSS can let a rail
 * taller than the window scroll until its bottom shows before it sticks (`.mon-rail` in
 * styles/monitor.css).
 */
export const trackRailHeight = (rail: HTMLElement | null) => (rail ? trackHeight(rail, "--rail-h") : undefined);

/** Keeps the CSS variable `name` on `host` set to `el`'s height; returns the cleanup. */
export function trackHeight(el: HTMLElement, name: string, host = el) {
  const observer = new ResizeObserver(() => host.style.setProperty(name, `${el.offsetHeight}px`));
  observer.observe(el);
  return () => observer.disconnect();
}

/**
 * Closes an open popover on Esc or a click outside `wrap`, returning focus to `trigger`. Esc is
 * caught before the evidence drawer's handler, so it closes only the popover.
 */
export function useDismiss(open: boolean, onClose: () => void) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Node && wrap.current?.contains(e.target)) return;
      close();
      // A click on something focusable keeps that focus; otherwise focus goes back to the trigger.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) trigger.current?.focus();
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
      trigger.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return { wrap, trigger };
}

/** How long a hash waits for its section to render, and keeps it in place while content above loads. */
const HASH_WAIT_MS = 10_000;

/**
 * Lands on the section the URL's hash names (`/monitors/circle#indicators`) once it renders, on
 * direct load and after client navigation: sections that wait on data are not there yet when the
 * browser or the router looks for them. Until the user scrolls, clicks or types, or 10 s pass, the
 * section is kept at the top while content above it loads. Section headings carry the ids.
 */
export function useHashScroll() {
  const pathname = usePathname();
  useEffect(() => {
    let stop = () => {};
    const follow = () => {
      stop();
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      let landed: number | null = null;
      const place = () => {
        const heading = document.getElementById(id);
        if (!heading) return;
        const target = heading.closest("section") ?? heading;
        const top = target.getBoundingClientRect().top;
        if (landed !== null && Math.abs(top - landed) < 1) return;
        target.scrollIntoView({ block: "start" });
        landed = target.getBoundingClientRect().top;
      };
      const observer = new MutationObserver(place);
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = window.setTimeout(() => stop(), HASH_WAIT_MS);
      const events = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
      stop = () => {
        observer.disconnect();
        window.clearTimeout(timer);
        for (const e of events) window.removeEventListener(e, stop, true);
      };
      for (const e of events) window.addEventListener(e, stop, true);
      place();
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => {
      stop();
      window.removeEventListener("hashchange", follow);
    };
  }, [pathname]);
}
