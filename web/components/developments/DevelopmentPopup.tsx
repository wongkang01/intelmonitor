// A development in a popup over the page it was opened from (the user's sketch, after mock u1
// option B), the size of the New dashboard popup. The header holds its labels for the subjects in
// view, the full title, Not relevant and Dismiss, and the close button; below, "Who it impacts" over
// "Connections" (the claims and the graph snippet) on the left, and the sources in News and Social
// tabs down the right. Each column scrolls inside the popup; under 1024 px they stack.
//
// The popup lives in the URL (`?development=<id>&scope=...`, built by link.ts), so a shared link and
// browser Back work. Close, Esc and a backdrop click go back to the entry it was opened over, or drop
// the parameters when the link was loaded fresh. Opening it marks the development read. An old
// `?evidence=<id>` link opens the popup in its place.
import { useLocation, useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import type { Schema } from "@/lib/api/client";
import { useDevelopment, useSetTriage, type TriageChange } from "@/lib/api/queries";
import { capitalize, longDate } from "@/lib/format";
import { Dotted } from "@/components/monitor/parts";
import { CloseButton, Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

import { ImpactGraph, WhoItImpacts } from "./Impacts";
import { AdverseTone, dateSpan, names, PriorityBadge, sourceCountText, UnconfirmedMark } from "./labels";
import { closedDevelopmentLink, developmentLink, parseScope, scopeHere, type ViewScope } from "./link";
import { Sources } from "./Sources";

/** Rendered once in the app shell; shows the development the URL names. */
export function DevelopmentPopup() {
  const search = useSearch({ from: "__root__" });
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const id = search.development;
  const scope = parseScope(search.scope) ?? scopeHere({ pathname: location.pathname, search: location.searchStr });
  const opener = useRef<HTMLElement | null>(null);

  const close = () => {
    if (location.state.developmentOpened) router.history.back();
    else void navigate({ ...closedDevelopmentLink(), replace: true });
  };

  // `?evidence=<id>` was the development drawer; it opens the popup now.
  const legacy = search.evidence;
  useEffect(() => {
    if (legacy) void navigate({ ...developmentLink(legacy), state: { developmentOpened: false }, replace: true });
  }, [legacy, navigate]);

  // Focus goes back to what opened the popup. The native dialog would, but its content unmounts
  // first, and a Back that rerenders the list underneath can replace the opener.
  const open = id !== undefined;
  useEffect(() => {
    if (!open) return;
    const was = document.activeElement;
    opener.current = was instanceof HTMLElement && !was.closest("dialog") ? was : null;
    return () => {
      const target = opener.current;
      if (target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
    };
  }, [open]);

  return (
    <Modal open={open} onClose={close} labelledBy="dp-title" label="Development" className="sheet dp-pop">
      {id && <DevelopmentView key={id} id={id} scope={scope} onClose={close} />}
    </Modal>
  );
}

function DevelopmentView({ id, scope, onClose }: { id: string; scope: ViewScope; onClose: () => void }) {
  const query = scope.subject ? { subject_id: [scope.subject] } : scope.dashboard ? { dashboard_id: scope.dashboard } : undefined;
  const development = useDevelopment(id, query);
  const heading = useRef<HTMLHeadingElement>(null);
  const d = development.data;

  useMarkRead(d);
  // The title takes focus once loaded, after the dialog has opened.
  const loaded = d !== undefined;
  useEffect(() => {
    if (!loaded) return;
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [loaded]);

  return (
    <>
      <div className="dp-top">
        {d ? (
          <Head development={d} scope={scope} headingRef={heading} />
        ) : (
          <p className="dp-head dp-wait">
            {development.isError ? "This development could not be loaded. It may have left the latest update." : "Loading…"}
          </p>
        )}
        <CloseButton onClick={onClose} label="Close development" />
      </div>
      {d && (
        <div className="dp-cols">
          <div className="dp-col dp-col-left">
            <WhoItImpacts direct={d.direct_subjects} impacts={d.impacts} />
            <ImpactGraph impacts={d.impacts} />
          </div>
          <div className="dp-col dp-col-src">
            <Sources sources={d.sources} title={d.title} unconfirmed={d.unconfirmed} />
          </div>
        </div>
      )}
    </>
  );
}

function Head({
  development: d,
  scope,
  headingRef,
}: {
  development: Schema<"DevelopmentDetail">;
  scope: ViewScope;
  headingRef: React.Ref<HTMLHeadingElement>;
}) {
  const triage = useTriageActions(d);
  // Say whose priority it is when the subjects disagree.
  const differ = new Set(d.direct_subjects.map((s) => s.priority)).size > 1;
  const viewed = d.direct_subjects.find((s) => s.subject.id === scope.subject)?.subject.name;
  const whose = d.priority_for.length > 0 ? names(d.priority_for.map((s) => s.name)) : differ && viewed ? viewed : null;
  return (
    <header className="dp-head">
      <p className="dp-labels">
        <PriorityBadge priority={d.priority} />
        <span>
          <Dotted
            parts={[
              d.unconfirmed && <UnconfirmedMark key="u" />,
              whose && `For ${whose}`,
              <AdverseTone key="a" adverse={d.adverse} tone={d.direction} />,
              // Brings the sources into view where the columns stack, without a history entry.
              <a key="s" href="#sources" className="dp-jump" onClick={jumpToSources}>
                {sourceCountText(d)}
              </a>,
              capitalize(d.category),
              <span key="d" className="num">
                {dateSpan(d.first_published, d.last_published, longDate)}
              </span>,
            ]}
          />
        </span>
      </p>
      <h2 id="dp-title" tabIndex={-1} ref={headingRef}>
        {d.title}
      </h2>
      <div className="dp-acts">
        {d.triage.dismissed ? (
          <>
            <span className="meta">{d.triage.not_relevant ? "Marked not relevant." : "Dismissed."}</span>
            <button type="button" className="btn btn-sm" onClick={triage.restore}>
              Restore to feed
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-sm" onClick={triage.notRelevant}>
              Not relevant
            </button>
            <button type="button" className="btn btn-sm" onClick={triage.dismiss}>
              Dismiss
            </button>
            <span className="meta">Not relevant means it should not be here. Dismiss hides it from your feed.</span>
          </>
        )}
      </div>
    </header>
  );
}

function jumpToSources(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const sources = document.getElementById("sources");
  sources?.scrollIntoView({ block: "start" });
  sources?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus({ preventScroll: true });
}

/** Not relevant, Dismiss and Restore, each with a toast that can undo it. */
function useTriageActions(d: Schema<"DevelopmentDetail">) {
  const setTriage = useSetTriage();
  const toast = useToast();
  const apply = (change: TriageChange, message: string, undo: TriageChange) => {
    setTriage.mutate({ id: d.id, change });
    toast({ message, action: { label: "Undo", run: () => setTriage.mutate({ id: d.id, change: undo }) } });
  };
  return {
    notRelevant: () => apply({ not_relevant: true }, "Marked not relevant and hidden from your feed.", { not_relevant: false, dismissed: false }),
    dismiss: () => apply({ dismissed: true }, "Dismissed.", { dismissed: false }),
    restore: () => apply({ dismissed: false, not_relevant: false }, "Restored to your feed.", { dismissed: d.triage.dismissed, not_relevant: d.triage.not_relevant }),
  };
}

/** Opening a development marks it read, once per popup. */
function useMarkRead(d: Schema<"DevelopmentDetail"> | undefined) {
  const setTriage = useSetTriage();
  const done = useRef<string | null>(null);
  const mark = useEffectEvent((id: string) => setTriage.mutate({ id, change: { read: true } }));
  const target = d && !d.triage.read ? d.id : null;
  useEffect(() => {
    if (target === null || done.current === target) return;
    done.current = target;
    mark(target);
  }, [target]);
}
