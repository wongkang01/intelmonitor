// Needs attention on a monitor's Overview: up to 3 developments in the latest run's scope for the
// subject that need attention, each opening its evidence; "All N developments" leads to the Developments tab.
import { Link } from "@tanstack/react-router";

import { useDevelopments } from "@/lib/api/queries";
import { plural } from "@/lib/format";
import { DevelopmentRow } from "@/components/widgets/parts";

import { Section } from "../parts";

const SHOWN = 3;

export function NeedsAttention({ subjectId }: { subjectId: string }) {
  // The API lists developments needing attention first, so the first few hold any there are.
  const query = useDevelopments({ subject_id: [subjectId], limit: SHOWN });
  const list = query.data;
  if (!list) return null;
  const rows = list.developments.filter((d) => d.needs_attention);
  return (
    <div className="panel ov-card">
      <Section
        id="needs-attention"
        title="Needs attention"
        meta={
          list.in_scope > 0 && (
            <Link to="/monitors/$id/developments" params={{ id: subjectId }} className="link">
              All {plural(list.in_scope, "development")}
            </Link>
          )
        }
      >
        {rows.length === 0 ? (
          <p className="mon-empty">Nothing needs attention.</p>
        ) : (
          <div className="rows">
            {rows.map((d) => (
              <DevelopmentRow key={d.id} development={d} status={false} meta={false} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
