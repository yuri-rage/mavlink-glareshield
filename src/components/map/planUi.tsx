// Small pieces shared by the planning editor's mission and rally views.

import React, { useEffect, useRef, useState } from 'react';

import { Trash2 } from 'lucide-react';

import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { MAV_FRAME } from '../../mavlink/missionDraft';

export { FT_PER_M } from '../../lib/inputUnits';
export const INPUT =
  'h-7 w-full rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] font-mono text-zinc-100 focus:outline-none focus:border-sky-500';
export const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-35 disabled:pointer-events-none';

/**
 * The value to commit when a number field loses focus, or null for none. Only something the user typed counts:
 * - not typed at all: nothing, even if the value changed meanwhile (a pin dragged while the field had focus must
 *   not be overwritten by the old text);
 * - typed back to what is shown: nothing (the text is rounded, so comparing with the exact value would commit the
 *   rounding).
 */
export function typedValue(text: string, shown: string, typed: boolean): number | null {
  if (!typed || text.trim() === shown) return null;
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : null;
}

/** A number input that keeps what is typed until Enter or blur, then commits a finite value. */
export const NumField: React.FC<{
  label: string;
  value: number;
  onCommit: (v: number) => void;
  digits?: number;
  title?: string;
}> = ({ label, value, onCommit, digits, title }) => {
  const shown = digits !== undefined ? Number(value.toFixed(digits)).toString() : String(Number(value.toPrecision(7)));
  const [text, setText] = useState(shown);
  /** The user has typed since focusing. Until then the field follows the draft, even while focused. */
  const typed = useRef(false);
  // The draft's value changed (a pin dragged, undo, a commit landing): it wins over anything half-typed here, since
  // it is the newer action. Show it and forget the typing, so leaving the field can't write the old text back.
  useEffect(() => {
    typed.current = false;
    setText(shown);
  }, [shown]);
  const commit = () => {
    const v = typedValue(text, shown, typed.current);
    typed.current = false;
    if (v !== null) onCommit(v);
    // Show the draft's value again: the new one once the edit lands, the old one if it was refused.
    setText(shown);
  };
  return (
    <label className="block min-w-0 space-y-0.5" title={title}>
      <span className="block truncate text-[10px] text-zinc-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => (typed.current = false)}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            // Cancel the typing only; don't also leave the Place tool or the maximized map.
            e.stopPropagation();
            typed.current = false;
            setText(shown);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={INPUT}
      />
    </label>
  );
};

export function frameTag(frame: number): string {
  if (frame === MAV_FRAME.GLOBAL || frame === MAV_FRAME.GLOBAL_INT) return 'MSL';
  if (frame === MAV_FRAME.GLOBAL_TERRAIN_ALT || frame === MAV_FRAME.GLOBAL_TERRAIN_ALT_INT) return 'TER';
  return 'REL';
}

/**
 * Clear a draft (the mission, rally points or fence) in the planner: asks first ("Clear?", which lapses after a few
 * seconds), changes only the draft (Undo brings it back), and the vehicle keeps its own until an upload.
 */
export const ClearDraftButton: React.FC<{ what: string; empty: boolean; onClear: () => void }> = ({
  what,
  empty,
  onClear,
}) => {
  const confirm = useConfirmStep();
  return (
    <button
      type="button"
      disabled={empty && !confirm.armed}
      title={
        confirm.armed
          ? `Confirm: clear the ${what} in this draft (Undo brings it back)`
          : `Clear the ${what} (asks first; the vehicle keeps its own until you upload)`
      }
      aria-label={`Clear ${what}`}
      onClick={() => {
        if (!confirm.armed) return confirm.arm();
        confirm.cancel();
        onClear();
      }}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[10px] font-bold disabled:opacity-35 ${
        confirm.armed ? 'border-red-500 bg-red-600 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <Trash2 className="h-3 w-3" />
      {confirm.armed ? 'Clear?' : 'Clear'}
    </button>
  );
};
