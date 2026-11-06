import React, { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import type { WidgetDataBinding, WidgetUnitKind } from '../../types/widget';
import { Input } from '../ui/input';

/** A number input that keeps what the user typed ("-", "1.") and reports undefined for blank. */
export const NumberField: React.FC<{
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  labelClassName?: string;
  min?: number;
  max?: number;
  step?: string;
}> = ({ label, value, onChange, placeholder, labelClassName, min, max, step = 'any' }) => {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? undefined : parseFloat(text);
    if (parsed !== value && !(Number.isNaN(parsed) && value === undefined)) {
      setText(value === undefined ? '' : String(value));
    }
    // Only resync when the value changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="space-y-1 min-w-0">
      <label className={`text-[11px] font-medium ${labelClassName ?? 'text-zinc-400'}`}>{label}</label>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = e.target.value.trim() === '' ? undefined : parseFloat(e.target.value);
          onChange(parsed === undefined || Number.isNaN(parsed) ? undefined : parsed);
        }}
        className="h-8 text-xs font-mono"
      />
    </div>
  );
};

export const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200';

export interface BindingEditorProps {
  value: WidgetDataBinding;
  onChange: (next: WidgetDataBinding) => void;
  /** Message → fields: the curated list merged with what the vehicle has actually sent. */
  catalog: Record<string, string[]>;
  /** Messages seen from the vehicle, listed first and marked live. */
  observed: Set<string>;
  showRange?: boolean;
  showThresholds?: boolean;
  showLabel?: boolean;
  showColor?: boolean;
  /** Called when the user picks a message, so the caller can apply message-specific defaults. */
  onMessagePicked?: (message: string) => void;
  onRemove?: () => void;
  title?: string;
}

export const BindingEditor: React.FC<BindingEditorProps> = ({
  value,
  onChange,
  catalog,
  observed,
  showRange = true,
  showThresholds = false,
  showLabel = false,
  showColor = false,
  onMessagePicked,
  onRemove,
  title,
}) => {
  const fieldListId = useId();
  const set = (patch: Partial<WidgetDataBinding>) => onChange({ ...value, ...patch });
  const messages = Object.keys(catalog).sort((a, b) => {
    const oa = observed.has(a) ? 0 : 1;
    const ob = observed.has(b) ? 0 : 1;
    return oa - ob || a.localeCompare(b);
  });
  if (value.messageName && !messages.includes(value.messageName)) messages.unshift(value.messageName);
  const fields = catalog[value.messageName] ?? [];

  return (
    <div className="space-y-2.5">
      {(title || onRemove) && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-zinc-300">{title}</span>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1 rounded text-zinc-500 hover:text-red-400"
              aria-label="Remove this value"
              title="Remove this value"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="space-y-1 min-w-0">
          <label className="text-[11px] font-medium text-zinc-400">MAVLink Message</label>
          <select
            value={value.messageName}
            onChange={(e) => {
              const msg = e.target.value;
              const first = catalog[msg]?.[0];
              set({ messageName: msg, ...(first ? { fieldName: first } : {}) });
              onMessagePicked?.(msg);
            }}
            className={SELECT_CLASS}
          >
            {messages.map((m) => (
              <option key={m} value={m}>
                {observed.has(m) ? `● ${m}` : m}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 min-w-0">
          <label className="text-[11px] font-medium text-zinc-400">Field (pick or type any decoded field)</label>
          <Input
            type="text"
            list={fieldListId}
            value={value.fieldName}
            onChange={(e) => set({ fieldName: e.target.value.trim() })}
            className="h-8 text-xs font-mono"
            spellCheck={false}
          />
          <datalist id={fieldListId}>
            {fields.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {showLabel && (
          <div className="space-y-1 min-w-0">
            <label className="text-[11px] font-medium text-zinc-400">Label</label>
            <Input
              type="text"
              value={value.label ?? ''}
              placeholder={value.fieldName}
              onChange={(e) => set({ label: e.target.value || undefined })}
              className="h-8 text-xs"
            />
          </div>
        )}
        <div className="space-y-1 min-w-0">
          <label className="text-[11px] font-medium text-zinc-400">Units</label>
          <select
            value={value.unitKind ?? 'none'}
            onChange={(e) => set({ unitKind: e.target.value === 'none' ? undefined : (e.target.value as WidgetUnitKind) })}
            className={SELECT_CLASS}
            title="Follow the speed / altitude units chosen in Link & Display Settings"
          >
            <option value="none">Fixed label</option>
            <option value="speed">Speed (from m/s)</option>
            <option value="altitude">Altitude (from m)</option>
            <option value="distance">Distance (from m)</option>
          </select>
        </div>
        {(value.unitKind ?? 'none') === 'none' && (
          <div className="space-y-1 min-w-0">
            <label className="text-[11px] font-medium text-zinc-400">Unit Label</label>
            <Input
              type="text"
              placeholder="V, %, °"
              value={value.unit ?? ''}
              onChange={(e) => set({ unit: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </div>
        )}
        <NumberField label="Multiplier" value={value.multiplier} placeholder="1" onChange={(v) => set({ multiplier: v })} />
        <NumberField label="Offset" value={value.offset} placeholder="0" onChange={(v) => set({ offset: v })} />
        <NumberField
          label="Decimals"
          value={value.decimals}
          placeholder="1"
          min={0}
          max={6}
          step="1"
          onChange={(v) => set({ decimals: v === undefined ? undefined : Math.max(0, Math.min(6, Math.round(v))) })}
        />
        {showRange && (
          <>
            <NumberField label="Min" value={value.min} placeholder="0" onChange={(v) => set({ min: v })} />
            <NumberField label="Max" value={value.max} placeholder="100" onChange={(v) => set({ max: v })} />
          </>
        )}
        {showColor && (
          <div className="space-y-1 min-w-0">
            <label className="text-[11px] font-medium text-zinc-400">Color</label>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                value={value.color ?? '#0ea5e9'}
                onChange={(e) => set({ color: e.target.value })}
                className="h-8 w-10 rounded border border-zinc-700 bg-zinc-900 p-0.5"
                aria-label="Series color"
              />
              {value.color && (
                <button type="button" onClick={() => set({ color: undefined })} className="text-[10px] text-zinc-500 hover:text-zinc-300">
                  auto
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showThresholds && (
        <div className="pt-2 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
          <NumberField
            label="Warning Threshold"
            labelClassName="text-amber-400/90"
            value={value.warnThreshold}
            placeholder="optional"
            onChange={(v) => set({ warnThreshold: v })}
          />
          <NumberField
            label="Critical Threshold"
            labelClassName="text-red-400/90"
            value={value.critThreshold}
            placeholder="optional"
            onChange={(v) => set({ critThreshold: v })}
          />
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none h-8 pb-1">
            <input
              type="checkbox"
              checked={Boolean(value.thresholdInvert)}
              onChange={(e) => set({ thresholdInvert: e.target.checked || undefined })}
              className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
            />
            Alert when below (e.g. voltage)
          </label>
        </div>
      )}
      {value.unitKind && value.unitKind !== 'none' && (showRange || showThresholds) && (
        <p className="text-[10px] text-zinc-500">
          Min, max and thresholds are in {value.unitKind === 'speed' ? 'm/s' : 'm'}; they are converted for display.
        </p>
      )}
    </div>
  );
};
