"use client";

// Evidence drawer. Any link to `?evidence=<development id>` opens it over the current page;
// closing drops the parameter. Esc closes it.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import type { Schema } from "@/lib/api/client";
import { useDevelopment } from "@/lib/api/queries";
import { capitalize, longDate, plural } from "@/lib/format";
import { typingIn } from "@/lib/dom";
import { monitorHref } from "@/lib/widgets";
import { CloseButton } from "@/components/ui/Modal";


/** The href that opens the evidence drawer for a development on the current page. */
export function useEvidenceHref() {
  const pathname = usePathname();
  return (developmentId: string) => `${pathname}?evidence=${encodeURIComponent(developmentId)}`;
}

export function EvidenceDrawer() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const id = params.get("evidence");
  const development = useDevelopment(id);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!id) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !typingIn(e.target) && !document.querySelector("dialog[open]")) {
        router.replace(pathname, { scroll: false });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [id, pathname, router]);

  if (!id) return null;
  const d = development.data;

  return (
    <aside className="drawer" aria-labelledby="evidence-title">
      <div className="sheet-head">
        <h2 id="evidence-title" tabIndex={-1} ref={heading}>
          Evidence
        </h2>
        <CloseButton onClick={() => router.replace(pathname, { scroll: false })} label="Close evidence" />
      </div>
      <div className="drawer-body">
        {development.isError && <p className="muted">Could not load this development.</p>}
        {d && <DevelopmentEvidence development={d} />}
      </div>
    </aside>
  );
}

function DevelopmentEvidence({ development: d }: { development: Schema<"DevelopmentDetail"> }) {
  return (
    <>
      <div className="chips">
        {d.needs_attention && <span className="badge b-attn">Needs attention</span>}
        {d.change === "new" && <span className="badge b-new">New</span>}
        {d.change === "updated" && <span className="badge b-new">Updated</span>}
        <span className="cap">
          {d.materiality_label}, {d.category}
          {d.stage ? `, ${d.stage}` : ""}, {longDate(d.last_published)}
        </span>
      </div>
      <h3>{d.title}</h3>
      <div className="chips">
        {d.subjects.map((s) => (
          <Link key={s.id} href={monitorHref(s.id)} className={`tag ${s.type}`}>
            {s.name}
          </Link>
        ))}
      </div>
      <h4>{plural(d.sources.length, "source")}</h4>
      {d.sources.map((s) => (
        <article key={s.document_id} className="source">
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title}
          </a>
          <span className="cap">
            {s.domain}, {capitalize(s.doc_type.replaceAll("_", " "))}, {longDate(s.published_at)}
            {s.new_in_run ? ", new this run" : ""}
          </span>
          {s.findings.map((f) => (
            <blockquote key={f.id}>
              <Highlighted passage={f.passage} />
            </blockquote>
          ))}
        </article>
      ))}
    </>
  );
}

/** A passage with its quote spans wrapped in <mark>. */
function Highlighted({ passage }: { passage: Schema<"Passage"> }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const h of [...passage.highlights].sort((a, b) => a.start - b.start)) {
    if (h.start < at) continue;
    parts.push(passage.text.slice(at, h.start));
    parts.push(<mark key={h.start}>{passage.text.slice(h.start, h.end)}</mark>);
    at = h.end;
  }
  parts.push(passage.text.slice(at));
  return <>{parts}</>;
}
