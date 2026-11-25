// Editors for one parameter, chosen by its metadata: a dropdown for named values, a checklist for bitmasks, and
// a details card with the full description. The table rows are virtualised at a fixed height, so the checklist
// and details open as popovers rather than growing the row.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Info, Lock, RotateCcw } from 'lucide-react';

import { bitmaskBits, hasBit, setBits, sortedValueOptions, withBit } from '../../../mavlink/paramBits';
import type { ParamMeta } from '../../../mavlink/paramMetadata';
import { formatParamValue } from '../../../mavlink/paramMetadata';

// ---------------------------------------------------------------------------------------------------------------
// Popover shell
// ---------------------------------------------------------------------------------------------------------------

interface PopoverProps {
  anchor: HTMLElement | null;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
  label: string;
}

/** A card pinned under (or above) `anchor`; closes on Escape, an outside click, or when the page scrolls. */
export const Popover: React.FC<PopoverProps> = ({ anchor, onClose, width = 300, children, label }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    const openUp = below < 240 && above > below;
    const maxHeight = Math.max(160, Math.min(420, openUp ? above : below));
    const left = Math.max(8, Math.min(r.left, vw - width - 8));
    setPos({ top: openUp ? Math.max(8, r.top - maxHeight - 4) : r.bottom + 4, left, maxHeight });
  }, [anchor, width]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      closeRef.current();
    };
    // The table scrolls under a fixed-position card, and its rows are recycled: close rather than drift.
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className="fixed z-[2000] flex flex-col rounded-lg border border-zinc-700 bg-zinc-950 font-sans text-xs shadow-2xl"
      style={{ top: pos.top, left: pos.left, width, maxHeight: pos.maxHeight }}
    >
      {children}
    </div>,
    document.body
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Named values: dropdown
// ---------------------------------------------------------------------------------------------------------------

const CUSTOM = '__custom__';

interface EnumSelectProps {
  name: string;
  values: Record<number, string>;
  /** The value being edited, as text. */
  editValue: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Switch to typing a number, for a value the list doesn't name. */
  onCustom: () => void;
}

export const EnumSelect: React.FC<EnumSelectProps> = ({
  name,
  values,
  editValue,
  onChange,
  onSave,
  onCancel,
  onCustom,
}) => {
  const options = sortedValueOptions(values);
  const current = editValue.trim() === '' ? NaN : Number(editValue);
  const known = Number.isFinite(current) && options.some(([v]) => v === current);
  return (
    <select
      autoFocus
      aria-label={`${name} value`}
      value={known ? String(current) : ''}
      onChange={(e) => {
        if (e.target.value === CUSTOM) onCustom();
        else if (e.target.value !== '') onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-6 max-w-[220px] rounded border border-sky-500 bg-black/90 px-1 font-mono text-xs text-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
    >
      {!known && <option value="">{formatParamValue(current)} (not in list)</option>}
      {options.map(([v, label]) => (
        <option key={v} value={String(v)}>
          {v}: {label}
        </option>
      ))}
      <option value={CUSTOM}>Other value…</option>
    </select>
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Bitmask: checklist
// ---------------------------------------------------------------------------------------------------------------

interface BitmaskEditorProps {
  name: string;
  bitmask: Record<number, string>;
  value: number;
  /** The value on the vehicle, to show what changes. */
  original: number;
  anchor: HTMLElement | null;
  onChange: (v: number) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const BitmaskEditor: React.FC<BitmaskEditorProps> = ({
  name,
  bitmask,
  value,
  original,
  anchor,
  onChange,
  onSave,
  onCancel,
}) => {
  const bits = bitmaskBits(bitmask);
  // Bits set on the vehicle that the definition doesn't name are kept and listed, so saving never drops them.
  const unnamed = setBits(value).filter((b) => bitmask[b] === undefined);
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  const origRounded = Number.isFinite(original) ? Math.round(original) : 0;
  const changed = rounded !== origRounded;

  const [rawInput, setRawInput] = useState(() => String(rounded));
  const lastEmittedRef = useRef<number>(rounded);

  useEffect(() => {
    if (rounded !== lastEmittedRef.current) {
      lastEmittedRef.current = rounded;
      setRawInput(String(rounded));
    }
  }, [rounded]);

  const handleNumericChange = (nextRaw: string) => {
    setRawInput(nextRaw);
    if (nextRaw.trim() === '') return;
    const parsed = Number(nextRaw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const intVal = Math.trunc(parsed);
      lastEmittedRef.current = intVal;
      onChange(intVal);
    }
  };

  return (
    <Popover anchor={anchor} onClose={onCancel} width={300} label={`${name} bits`}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 pb-1.5 pt-2.5">
        <span className="truncate font-mono font-bold text-zinc-100">{name}</span>
        <div className="flex shrink-0 items-center gap-1 font-mono text-sky-300" aria-live="polite">
          <span>=</span>
          <input
            type="number"
            min={0}
            step={1}
            value={rawInput}
            aria-label={`${name} numeric value`}
            onChange={(e) => handleNumericChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && changed) {
                e.preventDefault();
                onSave();
              }
            }}
            className="h-6 w-20 rounded border border-sky-500/70 bg-zinc-900 px-1.5 font-mono text-xs text-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          {changed && <span className="text-[10px] text-zinc-500">(was {origRounded})</span>}
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {bits.map((bit) => {
          const on = hasBit(value, bit);
          return (
            <li key={bit}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-zinc-900">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onChange(withBit(value, bit, e.target.checked))}
                  className="accent-sky-500"
                />
                <span className={on ? 'text-zinc-100' : 'text-zinc-400'}>{bitmask[bit]}</span>
                <span className="ml-auto font-mono text-[10px] text-zinc-600">bit {bit}</span>
              </label>
            </li>
          );
        })}
        {unnamed.map((bit) => (
          <li key={`u${bit}`} className="flex items-center gap-2 px-1.5 py-1 italic text-zinc-500">
            <input
              type="checkbox"
              checked
              onChange={(e) => onChange(withBit(value, bit, e.target.checked))}
              className="accent-zinc-500"
            />
            Unnamed bit
            <span className="ml-auto font-mono text-[10px] not-italic">bit {bit}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2">
        <button
          type="button"
          onClick={() => onChange(original)}
          disabled={!changed}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
        >
          <RotateCcw className="h-3 w-3" /> Undo changes
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-6 rounded border border-zinc-700 px-2 text-zinc-300 hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!changed}
            className="h-6 rounded bg-emerald-600 px-2.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </Popover>
  );
};

// ---------------------------------------------------------------------------------------------------------------
// Details card
// ---------------------------------------------------------------------------------------------------------------

interface DetailsProps {
  name: string;
  meta: ParamMeta;
  anchor: HTMLElement | null;
  onClose: () => void;
  /** Which metadata this came from, e.g. "Rover 4.6 parameter metadata, matching firmware 4.6.2." */
  source?: string;
  /** The vehicle's default value for this parameter, if known. */
  defaultValue?: number;
}

export const ParamDetails: React.FC<DetailsProps> = ({ name, meta, anchor, onClose, source, defaultValue }) => {
  const options = meta.values ? sortedValueOptions(meta.values) : [];
  const bits = meta.bitmask ? bitmaskBits(meta.bitmask) : [];
  const range =
    meta.min !== undefined || meta.max !== undefined
      ? `${meta.min ?? '—'} to ${meta.max ?? '—'}${meta.units ? ` ${meta.units}` : ''}`
      : null;
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} label={`${name} details`}>
      <div className="border-b border-zinc-800 px-3 pb-2 pt-2.5">
        <div className="font-mono font-bold text-zinc-100">{name}</div>
        {meta.displayName && <div className="mt-0.5 text-zinc-300">{meta.displayName}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1">
          {meta.rebootRequired && (
            <span className="rounded border border-amber-500/30 bg-amber-500/15 px-1.5 text-[10px] text-amber-300">
              Reboot required
            </span>
          )}
          {meta.readOnly && (
            <span className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 text-[10px] text-zinc-300">
              <Lock className="h-2.5 w-2.5" />
              Read-only
            </span>
          )}
          {meta.user && (
            <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-400">
              {meta.user}
            </span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {meta.description && <p className="whitespace-pre-line leading-relaxed text-zinc-300">{meta.description}</p>}
        {(range || meta.units || meta.increment || defaultValue !== undefined) && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px]">
            {range && (
              <>
                <dt className="text-zinc-500">Range</dt>
                <dd className="font-mono text-zinc-200">{range}</dd>
              </>
            )}
            {meta.units && !range && (
              <>
                <dt className="text-zinc-500">Units</dt>
                <dd className="font-mono text-zinc-200">{meta.units}</dd>
              </>
            )}
            {meta.increment && (
              <>
                <dt className="text-zinc-500">Step</dt>
                <dd className="font-mono text-zinc-200">{meta.increment}</dd>
              </>
            )}
            {defaultValue !== undefined && (
              <>
                <dt className="text-zinc-500">Default</dt>
                <dd className="font-mono text-zinc-200">
                  {formatParamValue(defaultValue)}
                  {meta.units ? ` ${meta.units}` : ''}
                </dd>
              </>
            )}
          </dl>
        )}
        {options.length > 0 && (
          <div>
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Values</div>
            <ul className="space-y-px text-[11px]">
              {options.map(([v, label]) => (
                <li key={v} className="flex gap-2">
                  <span className="w-10 shrink-0 text-right font-mono text-zinc-500">{v}</span>
                  <span className="text-zinc-300">{label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {bits.length > 0 && (
          <div>
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Bits</div>
            <ul className="space-y-px text-[11px]">
              {bits.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="w-10 shrink-0 text-right font-mono text-zinc-500">{b}</span>
                  <span className="text-zinc-300">{meta.bitmask![b]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {source && <p className="border-t border-zinc-900 pt-1 text-[10px] text-zinc-500">{source}</p>}
      </div>
    </Popover>
  );
};

/** The small (i) button that opens the details card. */
export const DetailsButton = React.forwardRef<
  HTMLButtonElement,
  { name: string; onClick: (button: HTMLButtonElement) => void }
>(({ name, onClick }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={(e) => onClick(e.currentTarget)}
    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:text-sky-300"
    title={`About ${name}`}
    aria-label={`About ${name}`}
  >
    <Info className="h-3 w-3" />
  </button>
));
DetailsButton.displayName = 'DetailsButton';
