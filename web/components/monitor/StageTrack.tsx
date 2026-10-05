// Topic stage track: signal → consultation → proposed → enacted → enforced, as one segmented track
// with the count of recent developments at each stage. Picking a stage lists its most material
// developments; it opens on the furthest stage that has any.
import { useState } from "react";

import type { Schema } from "@/lib/api/client";
import { capitalize, plural } from "@/lib/format";
import { DevelopmentRow } from "@/components/widgets/parts";

import { Section } from "./parts";

type Stage = Schema<"StageBucket">["stage"];

export function StageTrack({ track }: { track: Schema<"StageTrack"> }) {
  const stages = track.stages;
  const reached = stages.findLastIndex((b) => b.count > 0);
  const [picked, setPicked] = useState<Stage | null>(null);
  const selected = stages.find((b) => b.stage === picked) ?? stages[reached];

  return (
    <Section id="stage-track" title="Stage" meta={`Last ${track.lookback_days} days`}>
      <div className="seg stage-seg" role="group" aria-label="Regulatory stage">
        {stages.map((b) => (
          <button
            key={b.stage}
            type="button"
            aria-pressed={selected?.stage === b.stage}
            aria-label={`${capitalize(b.stage)}, ${plural(b.count, "development")}`}
            disabled={b.count === 0}
            onClick={() => setPicked(b.stage)}
          >
            {capitalize(b.stage)}
            <span className="stage-count">{b.count}</span>
          </button>
        ))}
      </div>
      {selected && selected.count > 0 ? (
        <>
          <h3 className="mon-sub">
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
        <p className="mon-empty">No staged developments in the last {track.lookback_days} days.</p>
      )}
    </Section>
  );
}
