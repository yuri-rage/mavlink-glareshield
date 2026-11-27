// The settings' single control style for one choice of a few: a full-width segmented switch, with the chosen
// option's hint beneath.

import React from 'react';

interface Option<T> {
  value: T;
  label: string;
  /** What choosing it means, shown beneath while chosen. */
  hint?: React.ReactNode;
}

/** One choice of a few: the settings' single control style. */
export function Segmented<T extends string | boolean>({
  label,
  value,
  options,
  onChange,
  disabled,
  aside,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  aside?: React.ReactNode;
}) {
  const chosen = options.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {aside}
      </div>
      <div
        className="grid gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={
              'truncate rounded-md px-1 py-1.5 text-xs transition-colors disabled:opacity-60 ' +
              (o.value === value ? 'bg-sky-500/20 font-medium text-sky-300' : 'text-zinc-400 hover:text-zinc-200')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      {chosen?.hint && <p className="text-[11px] leading-snug text-zinc-500">{chosen.hint}</p>}
    </div>
  );
}
