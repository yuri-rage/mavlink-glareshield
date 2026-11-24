// A small card pinned beside the point picked on the map: set the altitude and send the vehicle there in GUIDED
// (DO_REPOSITION). Enter sends, Escape cancels.

import { useLengthUnit } from '../../lib/inputUnits';
import React, { useEffect, useRef } from 'react';
import { LocateFixed, Minus, Navigation, Plus, X } from 'lucide-react';

interface FlyToPopoverProps {
  lat: number;
  lon: number;
  /** The picked point in pixels within the map container. */
  anchor: { x: number; y: number };
  /** The map container's size, to keep the card inside it. */
  bounds: { width: number; height: number };
  altInput: string;
  onAltInput: (v: string) => void;
  modeName: string;
  armed: boolean;
  /** Set when the point is this device's location: the fix's accuracy in metres. */
  accuracyM?: number;
  onSend: () => void;
  onCancel: () => void;
  /** More actions for the picked point, under the fly button (e.g. pointing the camera there). */
  extra?: React.ReactNode;
}

const CARD_W = 232;
const CARD_H = 160;
const GAP = 14;

export const FlyToPopover: React.FC<FlyToPopoverProps> = ({ lat, lon, anchor, bounds, altInput, onAltInput, modeName, armed, accuracyM, onSend, onCancel, extra }) => {
  const sendRef = useRef<HTMLButtonElement | null>(null);
  const inGuided = modeName === 'GUIDED';

  useEffect(() => {
    // Focus the send button rather than the altitude field, so a phone does not raise its keyboard.
    sendRef.current?.focus({ preventScroll: true });
  }, [lat, lon]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Above the point when there is room, otherwise below; always inside the map.
  const cardH = CARD_H + (extra ? 40 : 0);
  const above = anchor.y - GAP - cardH >= 4;
  const top = above ? anchor.y - GAP - cardH : Math.min(anchor.y + GAP, bounds.height - cardH - 4);
  const left = Math.max(4, Math.min(anchor.x - CARD_W / 2, bounds.width - CARD_W - 4));

  // Typed in the display units: steps of 5 m or 15 ft, never below 2 m.
  const len = useLengthUnit();
  const stepBy = len.unit === 'ft' ? 15 : 5;
  const minAlt = Math.ceil(len.fromSi(2));
  const step = (delta: number) => {
    const v = Math.max(minAlt, Math.round((Number(altInput) || 0) + delta));
    onAltInput(String(v));
  };

  return (
    <form
      className="absolute z-[1000] rounded-lg border border-sky-500/40 bg-zinc-950/95 backdrop-blur-md shadow-2xl text-xs"
      style={{ top: Math.max(4, top), left, width: CARD_W }}
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      // Keep clicks inside the card from reaching the map below.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      // Enter sends from anywhere in the card, including after pressing the +/- buttons, but not from Cancel or the
      // extra actions (Enter on "Point camera here" must point the camera, not fly there).
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest('[data-cancel], [data-extra]')) {
          e.preventDefault();
          onSend();
        }
      }}
    >
      <div className="flex items-center justify-between px-2.5 pt-2">
        <span className="flex items-center gap-1.5 font-bold text-sky-300">
          {accuracyM !== undefined ? (
            <>
              <LocateFixed className="h-3.5 w-3.5 text-blue-400" /> Fly to me
            </>
          ) : (
            <>
              <Navigation className="h-3.5 w-3.5" /> Fly here
            </>
          )}
        </span>
        <button type="button" data-cancel onClick={onCancel} className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800" aria-label="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-2.5 pt-0.5 font-mono text-[10px] text-zinc-400">
        {lat.toFixed(6)}, {lon.toFixed(6)}
        {accuracyM !== undefined && (
          <span className={accuracyM > 30 ? 'text-amber-400' : 'text-zinc-500'}> ±{Math.round(len.fromSi(accuracyM))} {len.unit}</span>
        )}
      </div>

      <div className="px-2.5 pt-2 flex items-center gap-1.5">
        <label htmlFor="flyto-alt" className="text-zinc-400 mr-auto" title="Above home">
          Altitude
        </label>
        <button type="button" onClick={() => step(-stepBy)} className="h-6 w-6 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center justify-center" aria-label={`${stepBy} ${len.unit} lower`}>
          <Minus className="h-3 w-3" />
        </button>
        <input
          id="flyto-alt"
          type="number"
          inputMode="decimal"
          min={minAlt}
          max={Math.round(len.fromSi(1000))}
          step={1}
          value={altInput}
          onChange={(e) => onAltInput(e.target.value)}
          className="h-6 w-14 rounded border border-zinc-700 bg-zinc-900 text-center font-mono text-zinc-100 focus:outline-none focus:border-sky-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="text-[10px] text-zinc-500 -ml-1 mr-0.5">{len.unit}</span>
        <button type="button" onClick={() => step(stepBy)} className="h-6 w-6 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 flex items-center justify-center" aria-label={`${stepBy} ${len.unit} higher`}>
          <Plus className="h-3 w-3" />
        </button>
      </div>

      <div className="px-2.5 pt-1.5 text-[10px] leading-snug min-h-[14px]">
        {!armed ? (
          <span className="text-amber-400">Vehicle is disarmed; it will not move until armed.</span>
        ) : !inGuided ? (
          <span className="text-amber-400">Switches from {modeName} to GUIDED.</span>
        ) : accuracyM !== undefined ? (
          <span className="text-amber-400">It will come to where you are standing.</span>
        ) : (
          <span className="text-zinc-500">Enter to send · Esc to cancel</span>
        )}
      </div>

      <div className="p-2.5 pt-1.5">
        <button
          ref={sendRef}
          type="submit"
          className={`w-full h-7 rounded-md font-bold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${
            inGuided ? 'bg-sky-600 hover:bg-sky-500' : 'bg-amber-600 hover:bg-amber-500'
          }`}
        >
          {inGuided ? 'Fly here' : 'Switch to GUIDED & fly here'}
        </button>
        {extra && (
          <div className="pt-1.5" data-extra>
            {extra}
          </div>
        )}
      </div>
    </form>
  );
};
