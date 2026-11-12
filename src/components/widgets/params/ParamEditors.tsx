// Editors for one parameter, chosen by its metadata: a dropdown for named values, a checklist for bitmasks, and
// a details card with the full description. The table rows are virtualised at a fixed height, so the checklist
// and details open as popovers rather than growing the row.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, Lock, RotateCcw } from 'lucide-react';
import type { ParamMeta } from '../../../mavlink/paramMetadata';
import { bitmaskBits, hasBit, setBits, sortedValueOptions, withBit } from '../../../mavlink/paramBits';
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
      className="fixed z-[2000] rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl text-xs font-sans flex flex-col"
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

export const EnumSelect: React.FC<EnumSelectProps> = ({ name, values, editValue, onChange, onSave, onCancel, onCustom }) => {
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
      className="h-6 max-w-[220px] rounded border border-sky-500 bg-black/90 text-sky-300 text-xs font-mono px-1 focus:outline-none focus:ring-1 focus:ring-sky-500"
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

export const BitmaskEditor: React.FC<BitmaskEditorProps> = ({ name, bitmask, value, original, anchor, onChange, onSave, onCancel }) => {
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
      <div className="px-3 pt-2.5 pb-1.5 border-b border-zinc-800 flex items-center justify-between gap-2">
        <span className="font-bold text-zinc-100 font-mono truncate">{name}</span>
        <div className="flex items-center gap-1 font-mono text-sky-300 shrink-0" aria-live="polite">
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
            className="h-6 w-20 rounded border border-sky-500/70 bg-zinc-900 px-1.5 text-xs font-mono text-sky-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          {changed && <span className="text-[10px] text-zinc-500">(was {origRounded})</span>}
        </div>
      </div>
      <ul className="overflow-y-auto px-1.5 py-1 flex-1 min-h-0">
        {bits.map((bit) => {
          const on = hasBit(value, bit);
          return (
            <li key={bit}>
              <label className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-zinc-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => onChange(withBit(value, bit, e.target.checked))}
                  className="accent-sky-500"
                />
                <span className={on ? 'text-zinc-100' : 'text-zinc-400'}>{bitmask[bit]}</span>
                <span className="ml-auto text-[10px] font-mono text-zinc-600">bit {bit}</span>
              </label>
            </li>
          );
        })}
        {unnamed.map((bit) => (
          <li key={`u${bit}`} className="flex items-center gap-2 px-1.5 py-1 text-zinc-500 italic">
            <input type="checkbox" checked onChange={(e) => onChange(withBit(value, bit, e.target.checked))} className="accent-zinc-500" />
            Unnamed bit
            <span className="ml-auto text-[10px] font-mono not-italic">bit {bit}</span>
          </li>
        ))}
      </ul>
      <div className="px-3 py-2 border-t border-zinc-800 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(original)}
          disabled={!changed}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <RotateCcw className="h-3 w-3" /> Undo changes
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="h-6 px-2 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!changed}
            className="h-6 px-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40"
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
  const range = meta.min !== undefined || meta.max !== undefined ? `${meta.min ?? '—'} to ${meta.max ?? '—'}${meta.units ? ` ${meta.units}` : ''}` : null;
  return (
    <Popover anchor={anchor} onClose={onClose} width={360} label={`${name} details`}>
      <div className="px-3 pt-2.5 pb-2 border-b border-zinc-800">
        <div className="font-bold text-zinc-100 font-mono">{name}</div>
        {meta.displayName && <div className="text-zinc-300 mt-0.5">{meta.displayName}</div>}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {meta.rebootRequired && <span className="px-1.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]">Reboot required</span>}
          {meta.readOnly && <span className="px-1.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] inline-flex items-center gap-1"><Lock className="h-2.5 w-2.5" />Read-only</span>}
          {meta.user && <span className="px-1.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 text-[10px]">{meta.user}</span>}
        </div>
      </div>
      <div className="overflow-y-auto px-3 py-2 space-y-2 flex-1 min-h-0">
        {meta.description && <p className="text-zinc-300 leading-relaxed whitespace-pre-line">{meta.description}</p>}
        {(range || meta.units || meta.increment || defaultValue !== undefined) && (
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[11px]">
            {range && (<><dt className="text-zinc-500">Range</dt><dd className="text-zinc-200 font-mono">{range}</dd></>)}
            {meta.units && !range && (<><dt className="text-zinc-500">Units</dt><dd className="text-zinc-200 font-mono">{meta.units}</dd></>)}
            {meta.increment && (<><dt className="text-zinc-500">Step</dt><dd className="text-zinc-200 font-mono">{meta.increment}</dd></>)}
            {defaultValue !== undefined && (
              <>
                <dt className="text-zinc-500">Default</dt>
                <dd className="text-zinc-200 font-mono">
                  {formatParamValue(defaultValue)}{meta.units ? ` ${meta.units}` : ''}
                </dd>
              </>
            )}
          </dl>
        )}
        {options.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Values</div>
            <ul className="text-[11px] space-y-px">
              {options.map(([v, label]) => (
                <li key={v} className="flex gap-2"><span className="font-mono text-zinc-500 w-10 text-right shrink-0">{v}</span><span className="text-zinc-300">{label}</span></li>
              ))}
            </ul>
          </div>
        )}
        {bits.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-0.5">Bits</div>
            <ul className="text-[11px] space-y-px">
              {bits.map((b) => (
                <li key={b} className="flex gap-2"><span className="font-mono text-zinc-500 w-10 text-right shrink-0">{b}</span><span className="text-zinc-300">{meta.bitmask![b]}</span></li>
              ))}
            </ul>
          </div>
        )}
        {source && <p className="text-[10px] text-zinc-500 pt-1 border-t border-zinc-900">{source}</p>}
      </div>
    </Popover>
  );
};

/** The small (i) button that opens the details card. */
export const DetailsButton = React.forwardRef<HTMLButtonElement, { name: string; onClick: (button: HTMLButtonElement) => void }>(({ name, onClick }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={(e) => onClick(e.currentTarget)}
    className="h-4 w-4 inline-flex items-center justify-center rounded text-zinc-500 hover:text-sky-300 shrink-0"
    title={`About ${name}`}
    aria-label={`About ${name}`}
  >
    <Info className="h-3 w-3" />
  </button>
));
DetailsButton.displayName = 'DetailsButton';
