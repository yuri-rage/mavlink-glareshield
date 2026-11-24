// The Place tool's hint on the fence layer: what a click draws (polygon, circle, return point; inclusion or
// exclusion), and while a polygon is being drawn, its vertex count with Finish and Cancel.

import React from 'react';
import { useMissionPlanStore, type FenceDrawKind } from '../../store/missionPlanStore';
import { DEFAULT_CIRCLE_RADIUS } from '../../mavlink/fenceDraft';
import { finishFencePolygon } from './fenceCommit';
import { useLengthUnit, wholeLength } from '../../lib/inputUnits';

const KINDS: { kind: FenceDrawKind; label: string; title: string }[] = [
  { kind: 'polygon-inclusion', label: 'Incl. polygon', title: 'Click each vertex; the vehicle must stay inside' },
  { kind: 'polygon-exclusion', label: 'Excl. polygon', title: 'Click each vertex; the vehicle must stay outside' },
  { kind: 'circle-inclusion', label: 'Incl. circle', title: 'Click the centre ({r} radius; drag its handle to resize)' },
  { kind: 'circle-exclusion', label: 'Excl. circle', title: 'Click the centre ({r} radius; drag its handle to resize)' },
  { kind: 'return-point', label: 'Return point', title: 'Click to place (or move) the fence return point (used by ArduPlane)' },
];

const BTN = 'rounded px-1.5 py-0.5 text-[10px] font-bold';

export const FencePlaceHint: React.FC = () => {
  const kind = useMissionPlanStore((s) => s.fenceDrawKind);
  const drawing = useMissionPlanStore((s) => s.fenceDrawing);
  const { setFenceDrawKind, setFenceDrawing } = useMissionPlanStore.getState();
  const n = drawing?.length ?? 0;
  // The default circle's radius, in the display units.
  const r = wholeLength(DEFAULT_CIRCLE_RADIUS, useLengthUnit());
  const polygon = kind === 'polygon-inclusion' || kind === 'polygon-exclusion';

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-0.5" role="group" aria-label="What a click draws">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            title={k.title.replace('{r}', r)}
            aria-pressed={kind === k.kind}
            onClick={() => setFenceDrawKind(k.kind)}
            className={`${BTN} ${kind === k.kind ? 'bg-red-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {polygon && n === 0 && (
        <div>
          Click the map to start the polygon<span className="text-zinc-500"> · Esc to stop</span>
        </div>
      )}
      {polygon && n > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>
            {n} {n === 1 ? 'vertex' : 'vertices'}
            {n < 3 ? ` · ${3 - n} more needed` : ' · click the first vertex or Enter to finish'}
          </span>
          <button
            type="button"
            disabled={n < 3}
            onClick={() => finishFencePolygon()}
            className={`${BTN} bg-red-500 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-500`}
          >
            Finish
          </button>
          <button type="button" onClick={() => setFenceDrawing(n > 1 ? drawing!.slice(0, -1) : null)} className={`${BTN} border border-zinc-600 text-zinc-200 hover:bg-zinc-800`}>
            Undo vertex
          </button>
          <button type="button" onClick={() => setFenceDrawing(null)} className={`${BTN} border border-zinc-600 text-zinc-200 hover:bg-zinc-800`}>
            Cancel
          </button>
        </div>
      )}
      {!polygon && (
        <div>
          {kind === 'return-point' ? 'Click the map to place the return point' : 'Click the map to place a circle centre'}
          <span className="text-zinc-500"> · Esc to stop</span>
        </div>
      )}
    </div>
  );
};
