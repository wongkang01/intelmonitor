// Entity icons: the entity's logo, its flag for a country, or a monogram. Topics and groups have none.
import type { Schema } from "@/lib/api/client";
import { initials } from "@/lib/format";

type Ref = Pick<Schema<"SubjectRef">, "name" | "type" | "kind" | "logo">;

/** Decorative: the entity's name always sits beside it. */
export function EntityIcon({ subject, size = 16 }: { subject: Ref; size?: 16 | 20 | 28 }) {
  if (subject.type !== "entity") return null;
  const flag = subject.kind === "country" ? " flag" : "";
  return (
    <span className={`ent-icon s${size}${flag}`} aria-hidden="true">
      {subject.logo ? (
        // Local SVGs from /public/logos need no image optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={subject.logo} alt="" />
      ) : (
        initials(subject.name).slice(0, 2)
      )}
    </span>
  );
}
