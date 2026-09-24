// A development as a list row, shared by monitor pages and custom question previews. It uses the
// list-row grammar in app/globals.css (`.row`, `.stat`, `.row-title`, `.row-meta`, `.row-end`).
import Link from "next/link";
import { Fragment } from "react";

import type { Schema } from "@/lib/api/client";
import { plural, shortDate } from "@/lib/format";
import { useEvidenceHref } from "@/components/shell/Evidence";
import { SubjectLinks } from "@/components/shell/SubjectLink";
import { DevelopmentBadge } from "@/components/widgets/parts";

import { Dotted } from "./parts";

/**
 * A development as a list row that opens its evidence: badge in the status column, title over
 * subjects, category and source count, and the last published date on the right. Pass `subjects`
 * to name others (a group's members) than the development's first two.
 */
export function DevRow({
  development: d,
  subjects,
  link = true,
}: {
  development: Schema<"DevelopmentSummary">;
  subjects?: Schema<"SubjectRef">[];
  /** Off where a dialog would cover the drawer. */
  link?: boolean;
}) {
  const evidence = useEvidenceHref();
  // Unlinked rows sit in dialogs, where subject links would leave the dialog.
  const named = link ? (subjects ?? d.subjects.slice(0, 2)) : [];
  const more = link && !subjects ? d.subjects.length - named.length : 0;
  return (
    <div className={`row dev${link ? " linked" : ""}`}>
      <span className="stat">
        <DevelopmentBadge development={d} />
      </span>
      <span>
        {link ? (
          <Link href={evidence.development(d.id)} className="row-title stretch" scroll={false}>
            {d.title}
          </Link>
        ) : (
          <span className="row-title">{d.title}</span>
        )}
        <span className="row-meta">
          <Dotted
            parts={[
              named.length > 0 && (
                <Fragment key="s">
                  <SubjectLinks subjects={named} />
                  {more > 0 && ` +${more}`}
                </Fragment>
              ),
              d.category,
              plural(d.source_count, "source"),
            ]}
          />
        </span>
      </span>
      <span className="row-end">{shortDate(d.last_published)}</span>
    </div>
  );
}
