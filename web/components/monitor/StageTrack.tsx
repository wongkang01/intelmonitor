"use client";

// Topic stage track: signal → consultation → proposed → enacted → enforced, with the count of
// recent developments at each stage. Picking a stage lists its most material developments.
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { capitalize, plural } from "@/lib/format";
import { DevelopmentRow } from "@/components/widgets/parts";

type Stage = Schema<"StageBucket">["stage"];

export function StageTrack({ track }: { track: Schema<"StageTrack"> }) {
  const stages = track.stages;
  const reached = stages.findLastIndex((b) => b.count > 0);
  const [picked, setPicked] = useState<Stage | null>(null);
  const selected = stages.find((b) => b.stage === picked) ?? stages[reached];
  // The filled line runs from the first stop to the furthest stage with developments.
  const fill = reached > 0 ? (reached / (stages.length - 1)) * 80 : 0;

  return (
    <section className="panel" aria-labelledby="stage-track">
      <div className="panel-head">
        <h2 id="stage-track">Stage</h2>
        <span className="cap">Last {track.lookback_days} days</span>
      </div>
      <div className="track" role="group" aria-label="Regulatory stage">
        <span className="track-line" />
        <span className="track-fill" style={{ width: `${fill}%` }} />
        {stages.map((b) => (
          <button
            key={b.stage}
            type="button"
            className="stop"
            aria-pressed={selected?.stage === b.stage}
            disabled={b.count === 0}
            onClick={() => setPicked(b.stage)}
          >
            <span className={`knob${b.count > 0 ? " on" : ""}${selected?.stage === b.stage ? " current" : ""}`} />
            <span className="stop-label">{capitalize(b.stage)}</span>
            <span className="cap">{b.count}</span>
          </button>
        ))}
      </div>
      {selected && selected.count > 0 ? (
        <>
          <h3>
            {capitalize(selected.stage)}: {plural(selected.count, "development")}
            {selected.count > selected.developments.length ? `, top ${selected.developments.length}` : ""}
          </h3>
          <div className="rows">
            {selected.developments.map((d) => (
              <DevelopmentRow key={d.id} development={d} />
            ))}
          </div>
        </>
      ) : (
        <p className="muted">No staged developments in the last {track.lookback_days} days.</p>
      )}
    </section>
  );
}
