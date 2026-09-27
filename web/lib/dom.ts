import { useSyncExternalStore } from "react";

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
export const trackRailHeight = (rail: HTMLElement | null) => {
  if (!rail) return;
  const observer = new ResizeObserver(() => rail.style.setProperty("--rail-h", `${rail.offsetHeight}px`));
  observer.observe(rail);
  return () => observer.disconnect();
};
