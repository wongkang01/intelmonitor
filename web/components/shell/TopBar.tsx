"use client";

// Top bar: the search field, the run status chip with its Runs popover, and the alerts bell with its
// Alerts popover. One popover is open at a time; Esc or a click outside closes it and returns focus
// to its trigger.
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { Schema } from "@/lib/api/client";
import {
  searchOptions,
  useAlerts,
  useMarkAlertsRead,
  useRunNow,
  useRunSchedule,
  useRunStatus,
  useRuns,
  useSearch,
} from "@/lib/api/queries";
import { dateTime, plural, shortDate, TYPE_LABEL } from "@/lib/format";
import { monitorHref } from "@/lib/widgets";
import { SearchIcon, XIcon } from "@/components/ui/icons";

import { useEvidenceHref } from "./Evidence";

const MAX_HITS = 8;

type PopName = "runs" | "alerts";

export function TopBar() {
  const [pop, setPop] = useState<PopName | null>(null);
  const toggle = (name: PopName) => setPop((p) => (p === name ? null : name));
  const close = () => setPop(null);

  return (
    <header className="topbar">
      <Search />
      <RunStatus open={pop === "runs"} onToggle={() => toggle("runs")} onClose={close} />
      <AlertsButton open={pop === "alerts"} onToggle={() => toggle("alerts")} onClose={close} />
    </header>
  );
}

/** ⌘K focuses the field; typing a subject name or alias lists matches, arrows move, Enter opens the
 *  highlighted subject's page, Esc clears. */
function Search() {
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
        {text ? (
          <button
            type="button"
            className="btn-icon clear"
            aria-label="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setText("");
              input.current?.focus();
            }}
          >
            <XIcon />
          </button>
        ) : (
          <span className="kbd" aria-hidden="true">
            ⌘K
          </span>
        )}
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
              <b>{h.subject.name}</b>
              {h.matched !== h.subject.name && <span className="alias">{h.matched}</span>}
              <span className="type">{TYPE_LABEL[h.subject.type]}</span>
            </div>
          ))}
          {hits.length === 0 && <p className="empty">No topic, group or entity matches “{text.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

interface PopoverProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}

/** Closes an open popover on Esc or a click outside `wrap`, returning focus to `trigger`. Esc is
 *  caught before the evidence drawer's handler, so it closes only the popover. */
function useDismiss(open: boolean, onClose: () => void) {
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
    const onKey = (e: globalThis.KeyboardEvent) => {
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

/** A top bar popover: 400px, right-aligned under its trigger, fixed head and foot, scrolling body. */
function Popover({
  id,
  label,
  head,
  foot,
  children,
}: {
  id: string;
  label: string;
  head: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="pop" id={id} role="dialog" aria-label={label}>
      <div className="pop-head">{head}</div>
      <div className="pop-body">{children}</div>
      {foot && <div className="pop-foot">{foot}</div>}
    </div>
  );
}

// Times are shown in the viewer's local time.
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** Whole calendar days from today to `at`: 0 today, -1 yesterday, 1 tomorrow. */
function dayOffset(at: Date) {
  const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((midnight(at) - midnight(new Date())) / 86_400_000);
}

const RELATIVE_DAY: Record<number, string> = { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" };

/** "Today 04:01", "Yesterday 04:01" or "23 Sep at 04:01". */
function when(iso: string) {
  const at = new Date(iso);
  const near = RELATIVE_DAY[dayOffset(at)];
  return near ? `${near} ${clock.format(at)}` : dateTime(iso);
}

/** The chip's short form: "04:01" today, otherwise "yesterday" or "23 Sep". */
function lastRunLabel(iso: string) {
  const at = new Date(iso);
  const offset = dayOffset(at);
  if (offset === 0) return clock.format(at);
  if (offset === -1) return "yesterday";
  return `${at.getDate()} ${at.toLocaleString("en-US", { month: "short" })}`;
}

/** "tomorrow, 06:00" or "Thu 1 Oct, 06:00". */
function nextRunLabel(iso: string) {
  const at = new Date(iso);
  const near = RELATIVE_DAY[dayOffset(at)];
  const date = near
    ? near.toLowerCase()
    : `${weekday.format(at)} ${at.getDate()} ${at.toLocaleString("en-US", { month: "short" })}`;
  return `${date}, ${clock.format(at)}`;
}

const duration = (seconds: number) =>
  seconds < 60 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;

/** The static running mark: a ring with its left half filled. Never animated. */
const RunningMark = () => (
  <svg className="half" width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
    <circle cx="4" cy="4" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M4 .75a3.25 3.25 0 0 0 0 6.5Z" fill="currentColor" />
  </svg>
);

// Local glyphs for the top bar; components/ui/icons.tsx has no bell, check, exclamation or down chevron.
const ChevronDownIcon = () => (
  <svg className="chev" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3L4 11Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M6.5 14a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6.2 5 8.6l4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ExclamationIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 2v4.8M6 9.6v.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

type Run = Schema<"RunInfo">;

/** A finished run's status glyph; the hidden text carries the status for screen readers. */
function RunMark({ run }: { run: Run }) {
  if (run.status === "failed")
    return (
      <span className="mk attn">
        <ExclamationIcon />
        <span className="sr-only">Failed</span>
      </span>
    );
  if (run.needs_attention_count > 0)
    return (
      <span className="mk watch">
        <ExclamationIcon />
        <span className="sr-only">Completed with alerts</span>
      </span>
    );
  return (
    <span className="mk stable">
      <CheckIcon />
      <span className="sr-only">Completed</span>
    </span>
  );
}

/** The result line with its "N needs attention" part in the attention color. */
function RunResult({ run }: { run: Run }) {
  if (run.status === "failed") return <span className="res">Did not finish</span>;
  const parts = (run.result ?? "").split(/(\d+ needs? attention)/);
  return (
    <span className="res">
      {parts.map((part, i) =>
        i % 2 ? (
          <span key={i} className="attn">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function RunStatus({ open, onToggle, onClose }: PopoverProps) {
  const { wrap, trigger } = useDismiss(open, onClose);
  const status = useRunStatus();
  const runs = useRuns();
  const running = status.data?.running ?? false;
  const last = runs.data?.find((r) => r.status === "complete" && r.finished_at);
  const lastLabel = last?.finished_at ? lastRunLabel(last.finished_at) : null;
  const sources = status.data?.sources;

  return (
    <div className="trigger-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="runchip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="runs-popover"
        aria-label={
          running
            ? "Run in progress. Show runs"
            : `Monitoring.${lastLabel ? ` Last run ${lastLabel}.` : ""} Show runs`
        }
        onClick={onToggle}
      >
        {running ? <RunningMark /> : <span className="dot" />}
        <span className="label">
          {running ? (
            <>
              <b>Running now</b>
              {sources != null && ` · ${plural(sources, "source")}`}
            </>
          ) : (
            <>
              <b>Monitoring</b>
              {lastLabel && ` · Last run ${lastLabel}`}
            </>
          )}
        </span>
        <ChevronDownIcon />
      </button>
      {open && <RunsPopover running={running} status={status.data} runs={runs.data} failed={runs.isError} />}
    </div>
  );
}

function RunsPopover({
  running,
  status,
  runs,
  failed,
}: {
  running: boolean;
  status?: Schema<"RunStatus">;
  runs?: Run[];
  failed: boolean;
}) {
  const schedule = useRunSchedule();
  const runNow = useRunNow();
  const busy = running || runNow.isPending;
  const next = schedule.data;

  return (
    <Popover
      id="runs-popover"
      label="Runs"
      head={
        <>
          <b>Runs</b>
          {next && (
            <span className="cap">
              {next.cadence} at {clock.format(new Date(next.next_run_at))}
            </span>
          )}
        </>
      }
      foot={
        <>
          <span className="cap grow">
            {runNow.isError
              ? "Could not start a run. Try again."
              : next && `Next scheduled run: ${nextRunLabel(next.next_run_at)}`}
          </span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => runNow.mutate()}>
            {busy ? "Running…" : "Run now"}
          </button>
        </>
      }
    >
      {running && status && (
        <div className="run-row">
          <span className="mk new">
            <RunningMark />
            <span className="sr-only">Running</span>
          </span>
          <b className="now">Running now</b>
          <span className="res">
            {status.estimate_seconds != null && `About ${duration(status.estimate_seconds)}`}
          </span>
          <span className="meta">
            {[status.how, status.sources != null && plural(status.sources, "source")].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
      {runs
        ?.filter((r) => r.status !== "running")
        .map((r) => (
          <div key={r.execution_id} className="run-row">
            <RunMark run={r} />
            <b>Run of {shortDate(r.as_of)}</b>
            <RunResult run={r} />
            <span className="meta">
              {[
                when(r.finished_at ?? r.started_at),
                r.how,
                r.duration_seconds != null && duration(r.duration_seconds),
                plural(r.sources, "source"),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
      {runs?.length === 0 && !running && <p className="empty">No runs yet.</p>}
      {failed && <p className="empty">Could not load runs.</p>}
    </Popover>
  );
}

type Alert = Schema<"Alert">;

const ALERT_GROUPS: { badge: Alert["badge"]; label: string; tone: "attn" | "watch" }[] = [
  { badge: "needs_attention", label: "Needs attention", tone: "attn" },
  { badge: "watch", label: "Watch", tone: "watch" },
];

function AlertsButton({ open, onToggle, onClose }: PopoverProps) {
  const { wrap, trigger } = useDismiss(open, onClose);
  const alerts = useAlerts();
  const unread = alerts.data?.unread;
  const count = unread?.total ?? 0;
  const tone = unread && unread.needs_attention > 0 ? "attn" : "watch";

  return (
    <div className="trigger-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="btn-icon lg bell"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="alerts-popover"
        aria-label={count ? `Alerts, ${count} unread` : "Alerts"}
        onClick={onToggle}
      >
        <BellIcon />
        {count > 0 && (
          <span className={`count ${tone}`} aria-hidden="true">
            {count}
          </span>
        )}
      </button>
      {open && <AlertsPopover data={alerts.data} failed={alerts.isError} onClose={onClose} trigger={trigger} />}
    </div>
  );
}

function AlertsPopover({
  data,
  failed,
  onClose,
  trigger,
}: {
  data?: Schema<"Alerts">;
  failed: boolean;
  onClose: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  const markRead = useMarkAlertsRead();
  const evidence = useEvidenceHref();
  const count = data?.unread.total ?? 0;
  const groups = ALERT_GROUPS.map((g) => ({ ...g, alerts: data?.alerts.filter((a) => a.badge === g.badge) ?? [] }));

  return (
    <Popover
      id="alerts-popover"
      label="Alerts"
      head={
        <>
          <b>Alerts</b>
          <span className="cap grow">{data && (count ? `${count} unread` : "All read")}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost accent"
            disabled={!count || markRead.isPending}
            onClick={() =>
              markRead.mutate(undefined, {
                // The button disables itself, so keep keyboard focus in the popover on its trigger.
                onSuccess: () => trigger.current?.focus(),
              })
            }
          >
            Mark all read
          </button>
        </>
      }
    >
      {groups.map(
        (g) =>
          g.alerts.length > 0 && (
            <section key={g.badge} aria-label={g.label}>
              <h3 className="pop-group">
                {g.label} · {g.alerts.length}
              </h3>
              {g.alerts.map((a) => (
                <Link key={a.id} href={evidence.development(a.id)} scroll={false} className="row" onClick={onClose}>
                  <span className="stat">
                    <span className={`badge b-${g.tone}`}>{g.label}</span>
                  </span>
                  <span>
                    <span className="row-title">{a.title}</span>
                    <span className="row-meta">{a.meta}</span>
                  </span>
                </Link>
              ))}
            </section>
          ),
      )}
      {data?.alerts.length === 0 && <p className="empty">Nothing in the latest run needs attention or watching.</p>}
      {failed && <p className="empty">Could not load alerts.</p>}
    </Popover>
  );
}
