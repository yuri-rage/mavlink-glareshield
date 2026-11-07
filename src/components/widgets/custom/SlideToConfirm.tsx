// A slide-to-confirm control, working like the arming slider: drag the handle from the left end all the way to
// the right and let go. Anything short of that springs back and sends nothing, so it needs no separate
// confirmation step.

import React, { useRef, useState } from 'react';

/** The drag must start within this fraction of the track's left end. */
const START_ZONE = 0.25;
/** ...and be released at or beyond this value (0-100). */
const CONFIRM_AT = 90;

interface SlideToConfirmProps {
  /** Text inside the track, e.g. "Slide to ENGAGE". */
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  /** Track colours and thumb accent, e.g. "accent-emerald-500 bg-emerald-950/40 border-emerald-800/60". */
  toneClass: string;
  ariaLabel: string;
}

export const SlideToConfirm: React.FC<SlideToConfirmProps> = ({ label, onConfirm, disabled, toneClass, ariaLabel }) => {
  const [value, setValue] = useState(0);
  const valueRef = useRef(0);
  const armed = useRef(false);

  const set = (v: number) => {
    valueRef.current = v;
    setValue(v);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLInputElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    armed.current = (e.clientX - rect.left) / rect.width <= START_ZONE;
    // A press anywhere else must not jump the handle to the press point.
    if (!armed.current) e.preventDefault();
  };

  const release = () => {
    const confirmed = armed.current && valueRef.current >= CONFIRM_AT && !disabled;
    armed.current = false;
    set(0);
    if (confirmed) onConfirm();
  };

  return (
    <div className="relative flex items-center">
      <input
        type="range"
        min="0"
        max="100"
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onChange={(e) => {
          if (armed.current) set(Number(e.target.value));
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onMouseUp={release}
        onTouchEnd={release}
        // Keyboard steps would let the handle reach the end without a deliberate drag.
        onKeyDown={(e) => e.preventDefault()}
        className={`w-full h-8 rounded-lg appearance-none transition-all select-none border ${
          disabled ? 'cursor-not-allowed accent-zinc-600 bg-zinc-950/60 border-zinc-800' : `cursor-pointer ${toneClass}`
        }`}
      />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-[11px] font-bold uppercase tracking-wider text-zinc-200">
        {label}
      </div>
    </div>
  );
};
