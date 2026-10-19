// The profile menu's dialogs: Data sources and Help.
import type { ReactNode } from "react";

import { useDataSources } from "@/lib/api/queries";
import { COLLECTION_LABEL, longDate, shortDate } from "@/lib/format";
import { ChangeMark, PRIORITIES, PRIORITY_MEANING, PriorityBadge } from "@/components/developments/labels";
import { CloseButton, Modal } from "@/components/ui/Modal";

interface DialogProps {
  open: boolean;
  onClose: () => void;
}

function Panel({ id, title, onClose, open, children }: DialogProps & { id: string; title: string; children: ReactNode }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy={id} className="panel">
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        <CloseButton onClick={onClose} />
      </div>
      {children}
    </Modal>
  );
}

export function DataSourcesDialog(props: DialogProps) {
  const sources = useDataSources();
  const data = sources.data;
  return (
    <Panel {...props} id="sources-title" title="Data sources">
      <div className="panel-body">
        {data && (
          <>
            <p className="cap">
              {data.total_documents} documents
              {data.t0 ? `, 60 days to ${longDate(data.t0)}` : ""}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Collection</th>
                  <th className="num">Documents</th>
                  <th className="num">Relevant</th>
                  <th>Published</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={`${s.source}-${s.collection}`}>
                    <td>{s.source.toUpperCase()}</td>
                    <td>{COLLECTION_LABEL[s.collection]}</td>
                    <td className="num">{s.documents}</td>
                    <td className="num">{s.relevant_documents}</td>
                    <td>
                      {shortDate(s.first_published)} to {shortDate(s.last_published)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {sources.isError && <p className="cap">Could not load data sources.</p>}
      </div>
    </Panel>
  );
}

const SHORTCUTS: [string[], string][] = [
  [["⌘", "K"], "Search"],
  [["?"], "Help"],
  [["Esc"], "Close a menu, dialog or development"],
];

/** The labels a development carries, one per question, in the order a row shows them. */
const LABELS: { label: ReactNode; text: string }[] = [
  ...PRIORITIES.map((p) => ({ label: <PriorityBadge priority={p} />, text: PRIORITY_MEANING[p] })),
  {
    label: <span className="adv">Adverse event</span>,
    text: "The news reports harm to the entity itself: something that happened at it, such as an outage, a fraud case or a penalty, or a trend or new rule that hurts it directly. Commentary, forecasts, share price moves and follow-up reports do not count.",
  },
  { label: <span>Negative tone</span>, text: "How the news reads for the entity: negative, neutral or positive." },
  { label: <ChangeMark change="new" />, text: "First reported since your last visit." },
  { label: <ChangeMark change="updated" />, text: "Seen before, with new reports since your last visit." },
];

/** Help: what the labels on a development mean, and the keyboard shortcuts. `?` opens it. */
export function HelpDialog(props: DialogProps) {
  return (
    <Panel {...props} id="help-title" title="Help">
      <div className="panel-body help">
        <section aria-labelledby="help-labels">
          <h3 id="help-labels">Labels on a development</h3>
          {LABELS.map((l, i) => (
            <div key={i} className="help-row">
              <span>{l.label}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </section>
        <section aria-labelledby="help-keys">
          <h3 id="help-keys">Keyboard shortcuts</h3>
          <dl className="keys">
            {SHORTCUTS.map(([combo, what]) => (
              <div key={what} style={{ display: "contents" }}>
                <dt>
                  {combo.map((k) => (
                    <kbd key={k} className="kbd">
                      {k}
                    </kbd>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Panel>
  );
}
