// A monitor page's Connections tab for a group or entity: the graph around the subject, then how it
// compares with the subjects around it (an entity's peers side by side, a group's common issues
// and outliers), then its linked subjects. Topics have no Connections tab; their URL opens Overview.
import { useQueries } from "@tanstack/react-query";
import { Link, Navigate } from "@tanstack/react-router";

import type { Schema } from "@/lib/api/client";
import { usePeers } from "@/lib/api/peers";
import { monitorPageOptions, useMonitorPage } from "@/lib/api/queries";
import { answerText, shortDate, TYPE_PLURAL } from "@/lib/format";
import type { SubjectType } from "@/lib/widgets";
import { GraphView } from "@/components/graph/GraphView";
import { evidenceLink } from "@/components/shell/Evidence";
import { SubjectLink } from "@/components/shell/SubjectLink";
import { DevelopmentRow, StateBadge } from "@/components/widgets/parts";

import { MonitorHead } from "./MonitorView";
import { Dotted, Section } from "./parts";

type Page = Schema<"MonitorPage">;
type SubjectRef = Schema<"SubjectRef">;

export function ConnectionsView({ id }: { id: string }) {
  const page = useMonitorPage(id);
  const p = page.data;
  const peers = usePeers(p?.subject) ?? [];
  if (page.isError) return <p className="page-message">This monitor could not be loaded.</p>;
  if (!p) return null;
  if (p.subject.type === "topic") return <Navigate to="/monitors/$id" params={{ id }} replace />;
  const compare = p.group !== null || peers.length > 0;
  return (
    <>
      <MonitorHead page={p} view="connections" />
      <div className="conn">
        <GraphView id={id} embedded />
        <div className={compare ? "conn-body split" : "conn-body"}>
          {compare && (
            <div className="panel">
              {peers.length > 0 && <PeersTable page={p} peers={peers} />}
              {p.group && <GroupInsights group={p.group} page={p} />}
            </div>
          )}
          <div className="panel">
            <Related subject={p.subject} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Focus area states of the subject and each peer side by side, one row per focus area label any
 *  of them has. A state links to that bank's answer and its evidence. */
function PeersTable({ page, peers }: { page: Page; peers: SubjectRef[] }) {
  const byName = [...peers].sort((a, b) => a.name.localeCompare(b.name));
  const peerPages = useQueries({
    queries: byName.map((s) => monitorPageOptions(s.id)),
    combine: (results) => results.map((r) => r.data),
  });
  const columns = [page, ...peerPages];
  if (columns.some((c) => !c)) return null;
  const pages = columns.filter((c): c is Page => c !== undefined);
  const labels = [...new Set(pages.flatMap((c) => c.questions.map((q) => q.label)))];
  const groups = page.subject.links.groups.map((g) => g.name).join(", ");
  return (
    <Section id="peers" title="Peers" meta={`${groups}, run of ${shortDate(page.run.as_of)}`}>
      <div className="conn-scroll">
        <table className="table conn-peers">
          <thead>
            <tr>
              <th scope="col">Focus area</th>
              {pages.map((c) => (
                <th key={c.subject.id} scope="col">
                  {c.subject.id === page.subject.id ? c.subject.name : <SubjectLink subject={c.subject} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                {pages.map((c) => {
                  const a = c.questions.find((q) => q.label === label);
                  return (
                    <td key={c.subject.id}>
                      {!a ? (
                        <span className="meta">Not asked</span>
                      ) : a.development_ids.length + a.series_ids.length > 0 ? (
                        <Link
                          {...evidenceLink.answer(c.subject.id, a.question_id)}
                          className="conn-state"
                          title="See evidence"
                        >
                          <StateBadge state={a.state} />
                        </Link>
                      ) : (
                        <StateBadge state={a.state} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/** Common issues and Outliers, both counted from the members' developments. Outliers leads with
 *  the group's Outliers focus area answer, which reads the developments themselves and can name a
 *  member the counts do not. */
function GroupInsights({ group, page }: { group: Schema<"GroupInsights">; page: Page }) {
  const answer = page.questions.find((q) => q.question_id === "group.outliers");
  return (
    <>
      <Section id="common-issues" title="Common issues" meta={`Last ${group.lookback_days} days`}>
        {group.common_issues.length === 0 && <p className="mon-empty">No development touches more than one member.</p>}
        <div className="rows">
          {group.common_issues.map((c) => (
            <DevelopmentRow key={c.development.id} development={c.development} subjects={c.members} />
          ))}
        </div>
      </Section>
      <Section id="outliers" title="Outliers" meta={`Last ${group.lookback_days} days`}>
        {answer && (
          <div className="row" data-question-id={answer.question_id}>
            <span className="stat">
              <StateBadge state={answer.state} />
            </span>
            <span>
              <span className="conn-answer">{answerText(answer.summary)}</span>
              <span className="row-meta">
                <Dotted
                  parts={[
                    "Focus area",
                    answer.development_ids.length + answer.series_ids.length > 0 && (
                      <Link key="e" {...evidenceLink.answer(page.subject.id, answer.question_id)} className="link">
                        See evidence
                      </Link>
                    ),
                  ]}
                />
              </span>
            </span>
          </div>
        )}
        {group.outliers.length === 0 && <p className="mon-empty">By development counts, no member stands out from its peers.</p>}
        <div className="rows">
          {group.outliers.map((o) => (
            <div key={o.member.id} className="row">
              <span className="stat">
                {o.needs_attention > 0 && <span className="badge b-attn">{o.needs_attention} need attention</span>}
              </span>
              <span>
                <span className="row-title">
                  <SubjectLink subject={o.member} />
                </span>
                <span className="row-meta">{o.reason}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

const LINK_TYPES: SubjectType[] = ["topic", "group", "entity"];
const LINK_KEY = { topic: "topics", group: "groups", entity: "entities" } as const;

/** Linked subjects by type, one per line, and the full graph page. */
function Related({ subject }: { subject: Schema<"SubjectDetail"> }) {
  const types = LINK_TYPES.filter((type) => subject.links[LINK_KEY[type]].length > 0);
  return (
    <Section
      id="related"
      title="Related"
      meta={
        <Link to="/monitors/$id/graph" params={{ id: subject.id }} className="link">
          Open full graph
        </Link>
      }
    >
      {types.length > 0 ? (
        <dl className="conn-links">
          {types.map((type) => (
            <div key={type}>
              <dt>{TYPE_PLURAL[type]}</dt>
              <dd>
                {subject.links[LINK_KEY[type]].map((s) => (
                  <SubjectLink key={s.id} subject={s} />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mon-empty">No linked subjects.</p>
      )}
    </Section>
  );
}
