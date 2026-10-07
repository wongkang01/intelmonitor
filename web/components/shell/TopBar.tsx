// Top bar: the search field, the run status chip with its Runs popover, and the alerts bell with its
// Alerts popover. One popover is open at a time; Esc or a click outside closes it and returns focus
// to its trigger.
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { LLM_OFF, LLM_OFF_NOTE, type Schema } from "@/lib/api/client";
import {
  searchOptions,
  useAlerts,
  useFollow,
  useFollows,
  useMarkAlertsRead,
  useRunNow,
  useRunStatus,
  useRuns,
  useSearch,
  useSetTriage,
} from "@/lib/api/queries";
import { useDismiss } from "@/lib/dom";
import { duration, plural, relativeTime, shortDate, shortTime, TYPE_LABEL } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import {
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ExclamationIcon,
  ReadIcon,
  RunningIcon,
  SearchIcon,
  UnreadIcon,
  XIcon,
} from "@/components/ui/icons";
import { CloseButton, Modal } from "@/components/ui/Modal";

import { evidenceLink } from "./Evidence";
import { SubjectIcon } from "@/components/ui/SubjectIcon";

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

/** Rows per result group. */
const GROUP_HITS = 5;

type Results = Schema<"SearchResults">;

/** One row in the results: a subject opens its page, a development or a document its evidence. */
type Hit =
  | { kind: "subject"; key: string; hit: Schema<"SearchHit"> }
  | { kind: "development"; key: string; development: Schema<"DevelopmentSummary"> }
  | { kind: "document"; key: string; document: Schema<"DocumentHit"> };

const GROUPS: { kind: Hit["kind"]; label: string }[] = [
  { kind: "subject", label: "Monitors" },
  { kind: "development", label: "Developments" },
  { kind: "document", label: "Documents" },
];

/** The results as one list in display order: monitors, then developments, then documents. */
function flatten(results: Results | undefined): Hit[] {
  if (!results) return [];
  return [
    ...results.subjects.slice(0, GROUP_HITS).map((hit): Hit => ({ kind: "subject", key: `s-${hit.subject.id}`, hit })),
    ...results.developments
      .slice(0, GROUP_HITS)
      .map((development): Hit => ({ kind: "development", key: `d-${development.id}`, development })),
    ...results.documents.slice(0, GROUP_HITS).map((document): Hit => ({ kind: "document", key: `f-${document.id}`, document })),
  ];
}

/** ⌘K focuses the field; typing lists matching monitors, developments and documents, arrows move,
 *  Enter opens the highlighted one (a monitor's page, or evidence in the drawer), Esc clears. */
function Search() {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useSearch(text);
  const blank = !text.trim();
  const hits = blank ? [] : flatten(search.data);

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

  const go = (hit: Hit) => {
    if (hit.kind === "subject") void navigate(monitorLink(hit.hit.subject.id));
    else void navigate(evidenceLink.development(hit.kind === "development" ? hit.development.id : hit.document.development_id));
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
      const hit = stale ? flatten(await client.fetchQuery(searchOptions(text)))[0] : hits[active];
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
      <label className="field search">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search"
          aria-expanded={showList}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `search-hit-${hits[active].key}` : undefined}
          placeholder="Search monitors, developments and documents"
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
        <div id="search-results" role="listbox" aria-label="Search results" className="search-list">
          {GROUPS.map((g) => {
            const rows = hits.filter((h) => h.kind === g.kind);
            return (
              rows.length > 0 && (
                <div key={g.kind} role="group" aria-labelledby={`search-group-${g.kind}`}>
                  <div id={`search-group-${g.kind}`} className="pop-group">
                    {g.label}
                  </div>
                  {rows.map((h) => {
                    const i = hits.indexOf(h);
                    return (
                      <div
                        key={h.key}
                        id={`search-hit-${h.key}`}
                        role="option"
                        aria-selected={i === active}
                        className={`search-hit ${h.kind}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h)}
                      >
                        <HitRow hit={h} />
                      </div>
                    );
                  })}
                </div>
              )
            );
          })}
          {hits.length === 0 && <p className="empty">No monitor, development or document matches “{text.trim()}”.</p>}
        </div>
      )}
    </div>
  );
}

function HitRow({ hit }: { hit: Hit }) {
  switch (hit.kind) {
    case "subject": {
      const { subject, matched } = hit.hit;
      return (
        <>
          <SubjectIcon subject={subject} />
          <b>{subject.name}</b>
          {matched !== subject.name && <span className="alias">{matched}</span>}
          <span className="type">{TYPE_LABEL[subject.type]}</span>
        </>
      );
    }
    case "development":
      return (
        <>
          <b title={hit.development.title}>{hit.development.title}</b>
          <span className="type">{shortDate(hit.development.last_published)}</span>
        </>
      );
    case "document":
      return (
        <>
          <b title={hit.document.title}>{hit.document.title}</b>
          <span className="alias">{hit.document.snippet}</span>
          <span className="type">{hit.document.domain}</span>
        </>
      );
  }
}

interface PopoverProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
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

/** The result line with its "N need attention" part in the attention color. */
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
  const lastLabel = last?.finished_at ? shortTime(last.finished_at) : null;
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
        {running ? <RunningIcon /> : <span className="dot" />}
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
  const runNow = useRunNow();
  const busy = running || runNow.isPending;

  return (
    <Popover
      id="runs-popover"
      label="Runs"
      head={<b>Runs</b>}
      foot={
        <>
          <span className="cap grow">
            {LLM_OFF
              ? `${LLM_OFF_NOTE}.`
              : runNow.isError
                ? "Could not start a run. Try again."
                : "Runs are manual for now."}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            aria-disabled={busy || LLM_OFF}
            onClick={() => {
              if (!busy && !LLM_OFF) runNow.mutate();
            }}
          >
            {busy ? "Running…" : "Run now"}
          </button>
        </>
      }
    >
      {running && status && (
        <div className="run-row">
          <span className="mk new">
            <RunningIcon />
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
                relativeTime(r.finished_at ?? r.started_at),
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
  const [managing, setManaging] = useState(false);
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
      {open && (
        <AlertsPopover
          data={alerts.data}
          failed={alerts.isError}
          onClose={onClose}
          onManage={() => {
            onClose();
            setManaging(true);
          }}
        />
      )}
      <FollowingDialog
        open={managing}
        onClose={() => {
          setManaging(false);
          // The dialog hands focus back to Manage, which went with the popover.
          requestAnimationFrame(() => trigger.current?.focus());
        }}
      />
    </div>
  );
}

function AlertsPopover({
  data,
  failed,
  onClose,
  onManage,
}: {
  data?: Schema<"Alerts">;
  failed: boolean;
  onClose: () => void;
  onManage: () => void;
}) {
  const markRead = useMarkAlertsRead();
  const setTriage = useSetTriage();
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
            aria-disabled={!count || markRead.isPending}
            onClick={() => {
              if (count && !markRead.isPending) markRead.mutate();
            }}
          >
            Mark all read
          </button>
        </>
      }
      foot={
        data && (
          <>
            <span className="cap grow">From {plural(data.followed, "followed subject")}</span>
            <button type="button" className="btn btn-sm btn-ghost accent" onClick={onManage}>
              Manage
            </button>
          </>
        )
      }
    >
      {groups.map((g) => {
        const unread = g.alerts.filter((a) => !a.read).length;
        return (
          g.alerts.length > 0 && (
            <section key={g.badge} aria-label={g.label}>
              <h3 className="pop-group">
                {g.label} · {unread ? `${unread} unread` : g.alerts.length}
              </h3>
              {g.alerts.map((a) => (
                <div key={a.id} className={`row alert-row${a.read ? " is-read" : ""}`}>
                  <span className="stat">
                    <span className={`badge b-${g.tone}`}>{g.label}</span>
                  </span>
                  <Link
                    {...evidenceLink.development(a.id)}
                    className="alert-body"
                    onClick={() => {
                      if (!a.read) setTriage.mutate({ id: a.id, change: { read: true } });
                      onClose();
                    }}
                  >
                    <span className="row-title">
                      {!a.read && <span className="new-dot" role="img" aria-label="Unread" />}
                      {a.title}
                    </span>
                    <span className="row-meta">{a.meta}</span>
                  </Link>
                  <button
                    type="button"
                    className="btn-icon alert-read"
                    aria-label={a.read ? "Mark unread" : "Mark read"}
                    title={a.read ? "Mark unread" : "Mark read"}
                    onClick={() => setTriage.mutate({ id: a.id, change: { read: !a.read } })}
                  >
                    {a.read ? <UnreadIcon /> : <ReadIcon />}
                  </button>
                </div>
              ))}
            </section>
          )
        );
      })}
      {data?.alerts.length === 0 && (
        <p className="empty">
          {data.followed ? "Nothing new on followed subjects needs attention or watching." : "Follow a subject from its page to get alerts."}
        </p>
      )}
      {failed && <p className="empty">Could not load alerts.</p>}
    </Popover>
  );
}

/** The subjects alerts cover, each with Unfollow. Following one happens on its monitor page. */
function FollowingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const follows = useFollows();
  const follow = useFollow();
  return (
    <Modal open={open} onClose={onClose} labelledBy="following-title" className="panel">
      <div className="sheet-head">
        <h2 id="following-title">Following</h2>
        <CloseButton onClick={onClose} />
      </div>
      <div className="panel-body">
        <p className="cap">Alerts cover these subjects. Follow others from their monitor pages.</p>
        {follows.data?.length === 0 && <p className="cap">You follow no subjects.</p>}
        <div className="rows following">
          {follows.data?.map((s) => (
            <div key={s.id} className="row no-stat">
              <span className="following-name">
                <span className="following-icon">
                  <SubjectIcon subject={s} />
                </span>
                <Link {...monitorLink(s.id)} className="subject-link" onClick={onClose}>
                  {s.name}
                </Link>
                <span className="meta">{TYPE_LABEL[s.type]}</span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Unfollow ${s.name}`}
                onClick={() => follow.mutate({ subjectId: s.id, follow: false })}
              >
                Unfollow
              </button>
            </div>
          ))}
        </div>
        {follows.isError && <p className="cap">Could not load followed subjects.</p>}
      </div>
    </Modal>
  );
}
