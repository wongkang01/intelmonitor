// A monitor page's Developments tab: What changed since the last review with its triage, then the
// subject's developments in the latest run, in the API's order (needing attention first). An entity
// in a group with other members switches the list to Peers (`?scope=peers`): the developments of
// those members, never ones tagged to the entity itself, each row naming the peer it is about.
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { useDevelopments, useMonitorPage } from "@/lib/api/queries";
import { useHashScroll } from "@/lib/dom";
import { plural, shortDate } from "@/lib/format";
import { DevelopmentRow } from "@/components/widgets/parts";

import { MonitorHead } from "./MonitorView";
import { Section } from "./parts";
import { WhatChanged } from "./WhatChanged";

export type DevelopmentScope = "subject" | "peers";

// Rows before Show all.
const FIRST_ROWS = 30;

export function SubjectDevelopments({
  id,
  scope,
  onScope,
}: {
  id: string;
  scope: DevelopmentScope;
  onScope: (scope: DevelopmentScope) => void;
}) {
  const page = useMonitorPage(id);
  useHashScroll();
  const p = page.data;
  if (page.isError) return <p className="page-message">These developments could not be loaded.</p>;
  if (!p) return null;
  return (
    <>
      <MonitorHead page={p} view="developments" />
      <div className="mon-devs">
        <div className="panel">
          <WhatChanged wc={p.what_changed} subjectId={p.subject.id} />
          <Developments subject={p.subject} asOf={p.run.as_of} scope={scope} onScope={onScope} />
        </div>
      </div>
    </>
  );
}

function Developments({
  subject,
  asOf,
  scope,
  onScope,
}: {
  subject: Schema<"SubjectDetail">;
  asOf: string;
  scope: DevelopmentScope;
  onScope: (scope: DevelopmentScope) => void;
}) {
  const peers = usePeers(subject);
  const hasPeers = peers !== undefined && peers.length > 0;
  // A Peers link to a subject without peers shows its own list.
  const shown = scope === "peers" && hasPeers ? "peers" : "subject";
  const own = useDevelopments({ subject_id: [subject.id] });
  const theirs = useDevelopments({ peers_of: subject.id }, hasPeers);
  const list = shown === "peers" ? theirs : own;
  const [all, setAll] = useState(false);
  const peerIds = new Set(peers?.map((s) => s.id));
  const rows = list.data?.developments ?? [];
  const visible = all ? rows : rows.slice(0, FIRST_ROWS);
  const attention = rows.filter((d) => d.needs_attention).length;
  const scopes = [
    { id: "subject", label: subject.name, count: own.data?.in_scope },
    { id: "peers", label: "Peers", count: theirs.data?.in_scope },
  ] as const;

  return (
    <Section id="developments" title="Developments" meta={`Run of ${shortDate(asOf)}`}>
      <div className="lead-row">
        <p className="mon-lead">
          {list.data &&
            [
              plural(list.data.in_scope, "development"),
              attention > 0 && `${attention} need attention`,
            ]
              .filter(Boolean)
              .join(", ")}
        </p>
        {hasPeers && (
          <div className="seg" role="group" aria-label="Scope">
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === shown}
                onClick={() => {
                  setAll(false);
                  onScope(s.id);
                }}
              >
                {s.label}
                {s.count !== undefined && <span className="seg-n">{s.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {list.isError ? (
        <p className="mon-empty">These developments could not be loaded.</p>
      ) : !list.data ? null : rows.length === 0 ? (
        <p className="mon-empty">{shown === "peers" ? `No developments for ${subject.name}'s peers in this run.` : `No developments for ${subject.name} in this run.`}</p>
      ) : (
        <div className="rows">
          {visible.map((d) => (
            <DevelopmentRow
              key={d.id}
              development={d}
              // Peers name the peer each row is about; the subject's own rows name the others it touches.
              subjects={shown === "peers" ? d.subjects.filter((s) => peerIds.has(s.id)) : d.subjects.filter((s) => s.id !== subject.id)}
            />
          ))}
        </div>
      )}
      {rows.length > FIRST_ROWS && (
        <p className="mon-more">
          <button type="button" className="link" aria-expanded={all} onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        </p>
      )}
    </Section>
  );
}
