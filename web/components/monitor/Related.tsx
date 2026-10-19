// A monitor page's Related tab: what reaches the subject through its links ("Could affect"), the
// institutions linked to a country, sector, technology provider or payment system (decision U2a),
// and, for a bank, what it shares with a peer. The tab shows only when one of these has rows.
import { Navigate } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { useLinked, useMonitorPage } from "@/lib/api/queries";
import { useHashScroll } from "@/lib/dom";

import { MonitorHead } from "./MonitorView";
import { CouldAffect } from "./overview/CouldAffect";
import { Linked, LINKED_KINDS } from "./overview/Linked";
import { SharedWith } from "./overview/SharedWith";

type Page = Schema<"MonitorPage">;

/**
 * What the Related tab holds for a page: whether it shows, and the number of linked institutions
 * (0 for kinds without them). Undefined while the peers or linked institutions load.
 */
export function useRelated(p: Page): { show: boolean; linked: number } | undefined {
  const kind = p.subject.kind;
  const bank = kind === "bank";
  const linkedKind = kind !== null && LINKED_KINDS.has(kind);
  const peers = usePeers(bank ? p.subject : undefined);
  const linked = useLinked(p.subject.id, linkedKind);
  if ((bank && !peers) || (linkedKind && linked.isPending)) return undefined;
  const count = linked.data?.length ?? 0;
  return { show: p.impacts.length > 0 || (peers?.length ?? 0) > 0 || count > 0, linked: count };
}

export function RelatedTab({ id }: { id: string }) {
  const page = useMonitorPage(id);
  useHashScroll();
  const p = page.data;
  if (page.isError) return <p className="page-message">This page could not be loaded.</p>;
  if (!p) return null;
  return <Related page={p} />;
}

function Related({ page: p }: { page: Page }) {
  const related = useRelated(p);
  if (!related) return null;
  // Nothing links here: an old or typed URL lands on the Overview.
  if (!related.show) return <Navigate to="/monitors/$id" params={{ id: p.subject.id }} replace />;
  const bank = p.subject.kind === "bank";
  return (
    <>
      <MonitorHead page={p} view="related" />
      <div className="ov">
        {(bank || p.impacts.length > 0) && (
          <div className="panel ov-card">
            <CouldAffect subject={p.subject} impacts={p.impacts} />
          </div>
        )}
        {related.linked > 0 && <Linked subject={p.subject} />}
        {bank && <SharedWith subject={p.subject} />}
      </div>
    </>
  );
}
