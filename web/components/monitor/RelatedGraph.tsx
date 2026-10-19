// The Overview's Related card: everything linked to the subject in the relationship store, as a
// graph around it (components/graph/RelatedCanvas.tsx), with the developments of the window that
// reach the subject through each node. Filters above it turn link types off and set the window:
// 7 days (the brief's week), 30 or 90. Clicking a node opens a popover beside it with its
// developments, each opening the development popup; Esc or a click outside closes it. Keyboard
// users reach the nodes with news through a visually hidden list that highlights each one in the
// graph as it takes focus. "See all links" leads to the Related tab when the subject has one. The
// page shows the card only for a subject with stored links (MonitorView.tsx).
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { Schema } from "@/lib/api/client";
import { useRelatedGraph, type RelatedDays } from "@/lib/api/queries";
import { plural, shortDate } from "@/lib/format";
import { monitorLink } from "@/lib/widgets";
import { PriorityBadge } from "@/components/developments/labels";
import { developmentLink } from "@/components/developments/link";
import { FilterMenu, toggle } from "@/components/graph/FilterMenu";
import { LINK_LABEL, type RelType } from "@/components/graph/labels";
import { RelatedCanvas, toneOf } from "@/components/graph/RelatedCanvas";
import { CloseButton } from "@/components/ui/Modal";

import { Section } from "./parts";

type Subject = Schema<"SubjectRef">;
type LinkedNode = Schema<"RelatedNode">;
type Development = Schema<"DevelopmentSummary">;

const WINDOWS: RelatedDays[] = [7, 30, 90];
const linkText = (n: LinkedNode) => n.links.map((l) => l.label).join(", ");

export function RelatedGraph({
  subject,
  relatedTab,
}: {
  subject: Subject;
  /** The subject's Related tab shows (Related.tsx useRelated), so "See all links" has somewhere to go. */
  relatedTab: boolean;
}) {
  const [days, setDays] = useState<RelatedDays>(7);
  // The link types switched on; null until the user changes them, meaning all.
  const [picked, setPicked] = useState<RelType[] | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const query = useRelatedGraph(subject.id, days);
  const data = query.data;

  const shown = useMemo(() => picked ?? data?.link_types.map((f) => f.type) ?? [], [picked, data]);
  const nodes = useMemo(
    () => data?.nodes.filter((n) => n.links.some((l) => shown.includes(l.type))) ?? [],
    [data, shown],
  );
  const open = nodes.find((n) => n.id === selected) ?? null;
  const close = useCallback(() => setSelected(null), []);

  return (
    <div className="panel ov-card rg">
      <Section
        id="related-graph"
        title="Related"
        meta={
          relatedTab && (
            <Link to="/monitors/$id/related" params={{ id: subject.id }} className="link">
              See all links
            </Link>
          )
        }
      >
        {query.isError ? (
          <p className="mon-empty">These links could not be loaded.</p>
        ) : !data ? null : (
          <>
            <div className="rg-bar" role="group" aria-label="Related filters">
              <FilterMenu
                name="Links"
                options={data.link_types.map((f) => ({ value: f.type, label: LINK_LABEL[f.type], count: f.count }))}
                selected={shown}
                onToggle={(t) => setPicked(toggle(shown, t))}
              />
              <div className="seg" role="group" aria-label="Developments from">
                {WINDOWS.map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                    {d} days
                  </button>
                ))}
              </div>
            </div>
            <RelatedCanvas
              center={data.center}
              nodes={nodes}
              hovered={hovered}
              onHover={setHovered}
              onOpen={setSelected}
              selected={open?.id ?? null}
              popover={
                open && (
                  <NodePopover
                    key={open.id}
                    node={open}
                    developments={data.developments}
                    subject={subject}
                    days={days}
                    onClose={close}
                  />
                )
              }
            />
            <Legend subject={subject} nodes={nodes} days={days} />
            <NodeList nodes={nodes} subject={subject} onHover={setHovered} onOpen={setSelected} />
          </>
        )}
      </Section>
    </div>
  );
}

function Legend({ subject, nodes, days }: { subject: Subject; nodes: LinkedNode[]; days: RelatedDays }) {
  if (!nodes.some((n) => n.development_ids.length > 0)) {
    return <p className="rg-legend">No news through these links in the last {days} days.</p>;
  }
  return (
    <ul className="rg-legend" aria-label="Legend">
      <li>
        <span className="rg-swatch harm" aria-hidden="true" />
        News that could hurt {subject.name}
      </li>
      <li>
        <span className="rg-swatch news" aria-hidden="true" />
        Other news
      </li>
    </ul>
  );
}

/** The nodes with news as buttons for keyboard and screen reader users; each one highlights its
 *  node in the graph while focused and opens its popover. */
function NodeList({
  nodes,
  subject,
  onHover,
  onOpen,
}: {
  nodes: LinkedNode[];
  subject: Subject;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  const counted = nodes.filter((n) => n.development_ids.length > 0);
  if (counted.length === 0) return null;
  return (
    <ul className="sr-only" aria-label="Links with news">
      {counted.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            data-node={n.id}
            onFocus={() => onHover(n.id)}
            onBlur={() => onHover(null)}
            onClick={() => onOpen(n.id)}
          >
            {n.name}, {linkText(n)}: {plural(n.development_ids.length, "development")}
            {toneOf(n) === "harm" && `, ${n.harmful} could hurt ${subject.name}`}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A node's popover: its name (a link when it is tracked), its links to the subject, and its
 *  developments in the window, most important first, each opening the development popup. */
function NodePopover({
  node,
  developments,
  subject,
  days,
  onClose,
}: {
  node: LinkedNode;
  developments: Development[];
  subject: Subject;
  days: RelatedDays;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const byId = new Map(developments.map((d) => [d.id, d]));
  const rows = node.development_ids.flatMap((id) => byId.get(id) ?? []);

  // Focus moves into the popover and goes back to the list button that opened it, if one did.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement.closest(".sr-only") ? document.activeElement : null;
    heading.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Esc or a press outside closes it, unless a dialog over the page (the development popup) has them.
  useEffect(() => {
    const inDialog = (t: EventTarget | null) => t instanceof Element && t.closest("dialog") !== null;
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target) && !inDialog(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div ref={box} className="rg-pop" role="dialog" aria-labelledby={titleId}>
      <div className="rg-pop-head">
        <h3 id={titleId} ref={heading} tabIndex={-1}>
          {node.subject ? (
            <Link {...monitorLink(node.subject.id)} className="tlink">
              {node.name}
            </Link>
          ) : (
            node.name
          )}
        </h3>
        <CloseButton onClick={onClose} />
      </div>
      <p className="meta">{linkText(node)}</p>
      {rows.length === 0 ? (
        <p className="mon-empty">No news through this link in the last {days} days.</p>
      ) : (
        <ol className="rg-rows">
          {rows.map((d) => (
            <li key={d.id}>
              <Link {...developmentLink(d.id, { subject: subject.id })} className="rg-row">
                <PriorityBadge priority={d.priority} />
                <span className="rg-title">{d.title}</span>
                <span className="num">{shortDate(d.last_published)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
