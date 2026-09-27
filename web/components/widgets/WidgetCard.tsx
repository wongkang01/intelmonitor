"use client";

// One widget on the grid: fetches its data and renders the body, or its settings in edit mode.
import { useState, type CSSProperties, type Ref } from "react";

import type { Widget } from "@/lib/api/client";
import { useCatalog, useWidgetData } from "@/lib/api/queries";
import { widgetHref } from "@/lib/widgets";
import { MinusIcon } from "@/components/ui/icons";

import { WidgetBody } from "./bodies";
import { Head } from "./parts";
import { WidgetSettings } from "./WidgetSettings";

export interface WidgetCardProps {
  widget: Widget;
  dashboardSubjectIds: string[];
  /** The saved dashboard it sits on; widgets following all its subjects then link to its developments. */
  dashboardId?: string;
  /** grid: on a dashboard. lifted: the copy that follows the pointer while dragging. preview: gallery. */
  variant: "grid" | "lifted" | "preview";
  editing?: boolean;
  settingsOpen?: boolean;
  dragging?: boolean;
  highlighted?: boolean;
  onChange?: (widget: Widget) => void;
  onRemove?: () => void;
  onCloseSettings?: () => void;
  cardRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}

export function WidgetCard({
  widget,
  dashboardSubjectIds,
  dashboardId,
  variant,
  editing = false,
  settingsOpen = false,
  dragging = false,
  highlighted = false,
  onChange = () => {},
  onRemove,
  onCloseSettings = () => {},
  cardRef,
  style,
}: WidgetCardProps) {
  const catalog = useCatalog();
  const query = useWidgetData(widget, dashboardSubjectIds);
  const name = catalog.data?.find((t) => t.type === widget.type)?.name ?? "";
  const href = widgetHref(widget, dashboardSubjectIds, dashboardId);
  const interactive = variant === "grid" && !editing;

  // Only faces that appear after a toggle play the flip.
  const [shownSettings, setShownSettings] = useState(settingsOpen);
  const [flip, setFlip] = useState(false);
  if (shownSettings !== settingsOpen) {
    setShownSettings(settingsOpen);
    setFlip(true);
  }

  const classes = [
    "w",
    widget.size,
    editing && variant !== "preview" ? "editable" : "",
    dragging ? "dragging" : "",
    variant === "lifted" ? "lifted" : "",
    highlighted ? "changed enter" : "",
    interactive && href ? "tappable" : "",
  ];

  return (
    <div
      ref={cardRef}
      className={classes.filter(Boolean).join(" ")}
      style={style}
      data-widget-id={variant === "grid" ? widget.id : undefined}
      data-widget-type={variant === "grid" ? widget.type : undefined}
      data-href={interactive && href ? href : undefined}
      role="group"
      aria-label={name}
      aria-roledescription={editing && variant === "grid" ? "Movable widget" : undefined}
      aria-describedby={editing && variant === "grid" ? "edit-help" : undefined}
      tabIndex={editing && variant === "grid" ? 0 : undefined}
    >
      {editing && variant !== "preview" && (
        <button
          type="button"
          className="minus"
          aria-label={`Remove ${name}`}
          tabIndex={variant === "lifted" ? -1 : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onRemove?.();
          }}
        >
          <MinusIcon />
        </button>
      )}
      {settingsOpen && variant === "grid" ? (
        <WidgetSettings widget={widget} onChange={onChange} onDone={onCloseSettings} />
      ) : (
        <div className={`face${flip ? " flip" : ""}`} inert={!interactive}>
          {query.data ? (
            <WidgetBody data={query.data} widget={widget} href={interactive ? href : null} onChange={onChange} />
          ) : (
            <>
              <Head title={name} />
              {query.isError && (
                <p className="muted">
                  Could not load this widget.{" "}
                  <button type="button" className="link" onClick={() => void query.refetch()}>
                    Retry
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
