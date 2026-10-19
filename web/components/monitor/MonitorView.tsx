// A monitor page for a topic or entity: the head with its tabs, Overview (here), Developments
// (SubjectDevelopments.tsx's DevelopmentsTab), Related (Related.tsx) and Data (TrendView's DataView),
// each rendering MonitorHead with its tab. The Overview holds the summary band (the week's brief
// beside the top Key data figures and the next date), then the subject's top 5 developments and the
// Related card, each full width; a subject with no stored links (most topics) has no Related card. Groups have
// no page of their own (decision S3): their URL lists the members instead.
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { useIndicators, useMonitorPage, useRelatedGraph } from "@/lib/api/queries";
import { useHashScroll } from "@/lib/dom";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { ChevronIcon } from "@/components/ui/icons";
import { SubjectIcon } from "@/components/ui/SubjectIcon";
import { monitorLink } from "@/lib/widgets";

import { SummaryBand } from "./overview/SummaryBand";
import { useRelated } from "./Related";
import { RelatedGraph } from "./RelatedGraph";
import { TopDevelopments } from "./SubjectDevelopments";

type Page = Schema<"MonitorPage">;
type Subject = Schema<"SubjectDetail">;

export function MonitorView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  useHashScroll();
  const p = page.data;
  if (page.isError) return <p className="page-message">This page could not be loaded.</p>;
  if (!p) return null;
  if (p.subject.type === "group") return <GroupMembers subject={p.subject} />;
  return <Overview page={p} />;
}

function Overview({ page: p }: { page: Page }) {
  // The card's own first query: every stored link shows in any window, so 7 days tells whether any
  // exist. The card stays out until it answers, so it never shows and then goes.
  const graph = useRelatedGraph(p.subject.id, 7).data;
  const related = useRelated(p);
  return (
    <>
      <MonitorHead page={p} view="overview" />
      <div className="ov">
        <SummaryBand page={p} />
        <div className="ov-grid">
          <div className="panel ov-card">
            <TopDevelopments subject={p.subject} />
          </div>
          {graph && graph.nodes.length > 0 && <RelatedGraph subject={p.subject} relatedTab={related?.show ?? false} />}
        </div>
      </div>
    </>
  );
}

export type MonitorTab = "overview" | "developments" | "related" | "data";

/**
 * The page head: logo, name and one line on what it is, with "Ask about <name>" on the right, over
 * the tabs. Related shows when something links to the subject, Data when it has listed series.
 */
export function MonitorHead({ page: p, view }: { page: Page; view: MonitorTab }) {
  const params = { id: p.subject.id };
  const indicators = useIndicators(p.subject.id, p.run.as_of);
  const related = useRelated(p);
  const hasData = p.trend || (indicators.data?.indicators.some((i) => i.series.listed) ?? false);
  const current = (tab: MonitorTab) => (view === tab ? ("page" as const) : undefined);
  return (
    <div className="mon-head">
      <div className="mon-head-top">
        <div className="mon-head-main">
          {p.subject.logo_full && (
            // Local logo files need no image optimization; the name below carries the meaning.
            <img className={`mon-logo${p.subject.kind === "country" ? " flag" : ""}`} src={p.subject.logo_full} alt="" />
          )}
          <h1>
            {!p.subject.logo_full && <SubjectIcon subject={p.subject} size={28} />}
            {p.subject.name}
          </h1>
          <p>
            <Summary subject={p.subject} />
          </p>
        </div>
        <Link to="/ask" search={{ about: p.subject.id }} className="btn">
          Ask about {p.subject.name}
        </Link>
      </div>
      <nav className="mon-nav" aria-label="Monitor views">
        <Link to="/monitors/$id" params={params} activeOptions={{ exact: true }} aria-current={current("overview")}>
          Overview
        </Link>
        <Link to="/monitors/$id/developments" params={params} aria-current={current("developments")}>
          Developments
        </Link>
        {(view === "related" || related?.show) && (
          <Link to="/monitors/$id/related" params={params} aria-current={current("related")}>
            Related
          </Link>
        )}
        {hasData && (
          <Link to="/monitors/$id/data" params={params} aria-current={current("data")}>
            Data
          </Link>
        )}
      </nav>
    </div>
  );
}

const KIND_LABEL: Record<NonNullable<Subject["kind"]>, string> = {
  bank: "Bank",
  central_bank: "Central bank",
  regulator: "Regulator",
  agency: "Agency",
  market_infrastructure: "Market infrastructure",
  payment_system: "Payment system",
  tech_provider: "Technology provider",
  asset_manager: "Asset manager",
  insurer: "Insurer",
  stablecoin_issuer: "Stablecoin issuer",
  digital_asset_firm: "Digital asset firm",
  country: "Country or territory",
  sector: "Sector",
};

// Peers named in the head before "N more".
const PEERS_SHOWN = 4;

/** One line under the title: an entity's kind and its peers as links, or a topic's scope. */
function Summary({ subject: s }: { subject: Subject }) {
  const peers = usePeers(s) ?? [];
  const [all, setAll] = useState(false);
  if (s.type !== "entity") return s.description;
  const shown = all || peers.length <= PEERS_SHOWN + 1 ? peers : peers.slice(0, PEERS_SHOWN);
  return (
    <>
      {s.kind ? KIND_LABEL[s.kind] : "Entity"}
      {peers.length > 0 && " · Peers: "}
      {shown.map((peer, i) => (
        <span key={peer.id}>
          {i > 0 && ", "}
          <SubjectLink subject={peer} />
        </span>
      ))}
      {shown.length < peers.length && (
        <>
          {" and "}
          <button type="button" className="link" onClick={() => setAll(true)}>
            {peers.length - shown.length} more
          </button>
        </>
      )}
    </>
  );
}

/** A group's URL: its name and its members, each a link to its page. Groups carry no developments. */
function GroupMembers({ subject: s }: { subject: Subject }) {
  return (
    <>
      <div className="mon-head">
        <h1>{s.name}</h1>
        <p>{s.links.entities.length > 0 ? "Open one of its members." : "This group has no members."}</p>
      </div>
      <div className="ov">
        <div className="panel ov-card rows group-members">
          {s.links.entities.map((e) => (
            <Link key={e.id} {...monitorLink(e.id)} className="row no-stat">
              <span className="row-title">{e.name}</span>
              <span className="row-end">
                {e.kind ? KIND_LABEL[e.kind] : ""}
                <ChevronIcon />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
