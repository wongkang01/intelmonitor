"use client";

import { useSubject } from "@/lib/api/queries";
import { TYPE_LABEL } from "@/lib/format";

export function MonitorHeader({ id }: { id: string }) {
  const subject = useSubject(id);
  const s = subject.data;
  if (subject.isError) return <p className="page-message">This monitor does not exist.</p>;
  if (!s) return null;
  return (
    <div className="pagehead">
      <div className="grow">
        <h1>{s.name}</h1>
        <p>
          <span className={`tag ${s.type}`}>{TYPE_LABEL[s.type]}</span> {s.description}
        </p>
      </div>
    </div>
  );
}
