// First-run tour (docs/archive/iteration-plan.md B2, mocks/onboarding.html direction A): five coach marks, one at
// a time, over the dimmed dashboard. It starts once, on the first dashboard shown while the profile's
// `tour_seen_at` is null, and Replay tour in Help starts it again. Each step rings its target and sets
// the card beside it; a target missing from the page leaves the card centred over a plain scrim.
// The tour is a modal <dialog>, so the page is inert behind it: Esc, Skip tour or the close button end
// it, focus goes to each step's primary button, and returns afterwards to where it was.
import { useNavigate } from "@tanstack/react-router";
import { usePathname } from "@/lib/router";
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useProfile, useSaveProfile } from "@/lib/api/queries";
import { CloseButton } from "@/components/ui/Modal";

interface Step {
  /** Selectors for what the step rings, tried in order. */
  targets: string[];
  title: string;
  body: string;
  /** How far the ring sits outside the target's box; negative insets it. */
  pad: number;
  radius: number;
  /** The step opens the evidence drawer on the dashboard's first development while it shows. */
  evidence?: true;
}

const STEPS: Step[] = [
  {
    targets: ['[data-tour="sidebar"]'],
    title: "Dashboards and monitors",
    body: "Dashboards hold the widgets you pick. Monitors give every topic, group and entity its own page.",
    pad: -4,
    radius: 10,
  },
  {
    targets: ['.dash-grid [data-widget-type="since"]'],
    title: "Since your last review",
    body: "What changed since you last marked this dashboard reviewed, with Needs attention first.",
    pad: 0,
    radius: 10,
  },
  {
    targets: ['[data-tour="evidence"]'],
    title: "Evidence",
    body: "Every answer and development opens its sources here. The quoted passage is highlighted.",
    pad: 0,
    radius: 0,
    evidence: true,
  },
  {
    targets: ['.dash-grid [data-tour="mark-reviewed"]'],
    title: "Mark reviewed",
    body: "Mark all reviewed clears New on this dashboard. Monitor pages have their own Mark reviewed.",
    pad: 6,
    radius: 6,
  },
  {
    targets: ['[data-tour="new-dashboard"]'],
    title: "Generate a dashboard",
    body: "Describe what to watch in New dashboard, and Generate builds widgets you can edit before creating it.",
    pad: 0,
    radius: 6,
  },
];

/** Links the evidence step opens: a Since row first, else any development or answer on the dashboard. */
const EVIDENCE_LINKS = [
  '.dash-grid [data-widget-type="since"] a[href*="evidence="]',
  '.dash-grid a[href*="evidence="], .dash-grid a[href*="answer="]',
];
/** How long the evidence step waits for the drawer before centring its card. */
const DRAWER_WAIT_MS = 1000;
const CARD_GAP = 16;
const EDGE = 16;

const isDashboard = (pathname: string) => pathname.startsWith("/dashboards/");

const StartTour = createContext<(returnFocus?: HTMLElement | null) => void>(() => undefined);

/** Starts the tour, opening the default dashboard first when elsewhere; focus returns to `returnFocus` after. */
export const useStartTour = () => useContext(StartTour);

/** Holds the tour over the shell's pages and gives useStartTour to the profile menu. */
export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const navigate = useNavigate();
  const profile = useProfile();
  const save = useSaveProfile();
  const [run, setRun] = useState<{ returnFocus: HTMLElement | null } | null>(null);
  const [autoStarted, setAutoStarted] = useState(false);

  if (!autoStarted && profile.data && !profile.data.tour_seen_at && isDashboard(pathname)) {
    setAutoStarted(true);
    setRun({ returnFocus: null });
  }

  const showing = run !== null && isDashboard(pathname);
  const markSeen = useEffectEvent(() => {
    if (profile.data) save.mutate({ ...profile.data, tour_seen_at: new Date().toISOString() });
  });
  useEffect(() => {
    if (showing) markSeen();
  }, [showing]);

  const start = (returnFocus: HTMLElement | null = null) => {
    setRun({ returnFocus });
    if (!isDashboard(pathname)) navigate({ to: "/" });
  };
  const end = () => {
    const back = run?.returnFocus;
    setRun(null);
    requestAnimationFrame(() => {
      if (back?.isConnected) back.focus();
    });
  };

  return (
    <StartTour value={start}>
      {children}
      {showing && <TourOverlay onEnd={end} />}
    </StartTour>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The card's side facing the target, where its caret sits. */
type Side = "left" | "right" | "top" | "bottom";

interface Layout {
  step: number;
  ring: Box | null;
  card: { x: number; y: number };
  caret: { side: Side; at: number } | null;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, Math.max(lo, hi)));

/** Places a w by h card beside the ring: right of it if there is room, else left, else below or above. */
function place(ring: Box, w: number, h: number): Pick<Layout, "card" | "caret"> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const midY = ring.y + Math.min(ring.h / 2, 80);
  const beside = (x: number, side: Side) => {
    const y = clamp(midY - 40, EDGE, vh - h - EDGE);
    return { card: { x, y }, caret: { side, at: clamp(midY - y - 5, 16, h - 26) } };
  };
  if (ring.x + ring.w + CARD_GAP + w < vw - EDGE) return beside(ring.x + ring.w + CARD_GAP, "left");
  if (ring.x - CARD_GAP - w > EDGE) return beside(ring.x - CARD_GAP - w, "right");
  const x = clamp(ring.x, EDGE, vw - w - EDGE);
  const at = clamp(ring.x + Math.min(ring.w / 2, 40) - x - 5, 16, w - 26);
  const below = ring.y + ring.h + CARD_GAP;
  if (below + h <= vh - EDGE) return { card: { x, y: below }, caret: { side: "top", at } };
  const above = ring.y - CARD_GAP - h;
  return { card: { x, y: clamp(above, EDGE, vh - h - EDGE) }, caret: { side: "bottom", at } };
}

const find = (selectors: string[]) =>
  selectors.reduce<HTMLElement | null>((el, s) => el ?? document.querySelector<HTMLElement>(s), null);

function TourOverlay({ onEnd }: { onEnd: () => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<Layout | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    return () => el.close();
  }, []);

  // The evidence step opens the drawer through the URL, as a click on the row would, and puts the
  // URL back when the step ends.
  useEffect(() => {
    if (!step.evidence) return;
    const href = find(EVIDENCE_LINKS)?.getAttribute("href");
    if (!href) return;
    const back = window.location.pathname + window.location.search;
    void navigate({ href, replace: true, resetScroll: false });
    return () => {
      void navigate({ href: back, replace: true, resetScroll: false });
    };
  }, [step, navigate]);

  // Ring and card follow the target as the page loads, scrolls, resizes or animates.
  useLayoutEffect(() => {
    const started = performance.now();
    let frame = 0;
    find(step.targets)?.scrollIntoView({ block: "nearest" });
    const update = () => {
      frame = 0;
      const box = card.current;
      if (!box) return;
      const target = find(step.targets);
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      if (!target) {
        const waiting = step.evidence && performance.now() - started < DRAWER_WAIT_MS;
        const centred = { x: (window.innerWidth - w) / 2, y: (window.innerHeight - h) / 2 };
        setLayout(waiting ? null : { step: index, ring: null, card: centred, caret: null });
        return;
      }
      const r = target.getBoundingClientRect();
      const ring = { x: r.left - step.pad, y: r.top - step.pad, w: r.width + 2 * step.pad, h: r.height + 2 * step.pad };
      setLayout({ step: index, ring, ...place(ring, w, h) });
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(schedule, DRAWER_WAIT_MS);
    // Events that move a target without changing the DOM: the drawer slides in, the page scrolls.
    const events = ["scroll", "animationend", "transitionend"] as const;
    window.addEventListener("resize", schedule);
    for (const e of events) document.addEventListener(e, schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("resize", schedule);
      for (const e of events) document.removeEventListener(e, schedule, true);
    };
  }, [step, index]);

  const placed = layout?.step === index ? layout : null;
  // The card is hidden until placed, and a hidden button cannot take focus.
  const ready = placed !== null;
  useEffect(() => {
    if (ready) primary.current?.focus();
  }, [index, ready]);

  return (
    <dialog
      ref={dialog}
      className={`tour${placed && !placed.ring ? " bare" : ""}`}
      aria-label="Tour"
      onCancel={(e) => {
        e.preventDefault();
        onEnd();
      }}
    >
      {placed?.ring && (
        <div
          className="tour-ring"
          style={{
            left: placed.ring.x,
            top: placed.ring.y,
            width: placed.ring.w,
            height: placed.ring.h,
            borderRadius: step.radius,
          }}
        />
      )}
      <div
        key={index}
        ref={card}
        className="coach"
        role="group"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={placed ? { left: placed.card.x, top: placed.card.y } : { visibility: "hidden" }}
      >
        {placed?.caret && (
          <span
            className={`coach-caret ${placed.caret.side}`}
            style={placed.caret.side === "left" || placed.caret.side === "right" ? { top: placed.caret.at } : { left: placed.caret.at }}
          />
        )}
        <div className="coach-head">
          <span className="meta">
            {index + 1} of {STEPS.length}
          </span>
          <CloseButton onClick={onEnd} label="Close tour" />
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p id="tour-body">{step.body}</p>
        <div className="coach-foot">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onEnd}>
            Skip tour
          </button>
          {index > 0 && (
            <button type="button" className="btn btn-sm" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button
            ref={primary}
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => (last ? onEnd() : setIndex(index + 1))}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
