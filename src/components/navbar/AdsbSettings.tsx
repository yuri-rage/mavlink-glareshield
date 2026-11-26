// Settings: ADS-B traffic. Whether aircraft show on the map (also in the map's View menu), whether threats are
// warned of (banner and spoken alert), and what makes an aircraft a caution or an alert, in the user's units.

import React from 'react';

import { DEFAULT_THRESHOLDS, type TrafficThresholds } from '../../mavlink/adsb';
import { useAdsbSettingsStore } from '../../store/adsbSettingsStore';
import { useUnitsStore } from '../../store/unitsStore';

const M_PER_FT = 0.3048;

/** Horizontal distances: meters (metric), nautical miles (knots), statute miles (mph). Vertical: meters or feet. */
function units(system: string) {
  const h =
    system === 'kts'
      ? { unit: 'NM', toM: (v: number) => v * 1852, fromM: (m: number) => +(m / 1852).toFixed(2), step: 0.05 }
      : system === 'mph'
        ? { unit: 'mi', toM: (v: number) => v * 1609.344, fromM: (m: number) => +(m / 1609.344).toFixed(2), step: 0.05 }
        : { unit: 'm', toM: (v: number) => v, fromM: (m: number) => Math.round(m), step: 50 };
  const imperial = system === 'kts' || system === 'mph';
  const v = imperial
    ? { unit: 'ft', toM: (x: number) => x * M_PER_FT, fromM: (m: number) => Math.round(m / M_PER_FT), step: 50 }
    : { unit: 'm', toM: (x: number) => x, fromM: (m: number) => Math.round(m), step: 10 };
  return { h, v };
}

/**
 * A number field committed on leaving it. `onCommit` returns what the field should then show (the stored value, after
 * any clamping): when a clamp leaves the stored value as it was, nothing re-renders, so the field is set from it here.
 */
const Field: React.FC<{
  label: string;
  unit: string;
  value: number;
  step: number;
  onCommit: (v: number) => number;
}> = ({ label, unit, value, step, onCommit }) => (
  <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
    <span>{label}</span>
    <span className="flex items-center gap-1">
      <input
        key={value}
        type="number"
        min={0}
        step={step}
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value);
          e.target.value = String(Number.isFinite(v) && v > 0 ? onCommit(v) : value);
        }}
        onKeyDown={(e) => {
          // Enter commits the value (on blur); it must not also submit the Settings form (which connects).
          if (e.key !== 'Enter') return;
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }}
        className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-right font-mono text-xs text-zinc-200"
      />
      <span className="w-6 text-zinc-500">{unit}</span>
    </span>
  </label>
);

const Toggle: React.FC<{
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  onText: string;
  offText: string;
}> = ({ label, on, onChange, onText, offText }) => (
  <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
    <span>{label}</span>
    <div
      className="grid grid-cols-2 gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={on === v}
          onClick={() => onChange(v)}
          className={`rounded px-2 py-0.5 text-[11px] ${on === v ? 'bg-sky-500/20 font-medium text-sky-300' : 'text-zinc-400 hover:text-zinc-200'}`}
        >
          {v ? onText : offText}
        </button>
      ))}
    </div>
  </div>
);

export const AdsbSettings: React.FC = () => {
  const { showOnMap, warnings, thresholds, setShowOnMap, setWarnings, setThresholds, resetThresholds } =
    useAdsbSettingsStore();
  const system = useUnitsStore((s) => s.system);
  const { h, v } = units(system);
  // Store the value (clamped there), and give back what the field shows for the stored one.
  const set = (k: keyof TrafficThresholds, toM: (x: number) => number, fromM: (m: number) => number) => (x: number) => {
    setThresholds({ [k]: toM(x) });
    return fromM(useAdsbSettingsStore.getState().thresholds[k]);
  };
  const isDefault = (Object.keys(DEFAULT_THRESHOLDS) as (keyof TrafficThresholds)[]).every(
    (k) => thresholds[k] === DEFAULT_THRESHOLDS[k]
  );
  const odd =
    thresholds.alertRangeM > thresholds.cautionRangeM || thresholds.alertVerticalM > thresholds.cautionVerticalM;

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-zinc-300">ADS-B Traffic</label>
      <Toggle label="Aircraft on the map" on={showOnMap} onChange={setShowOnMap} onText="Show" offText="Hide" />
      <Toggle label="Warnings (banner and voice)" on={warnings} onChange={setWarnings} onText="On" offText="Off" />
      <div className="space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">Caution: within both</div>
        <Field
          label="Range"
          unit={h.unit}
          step={h.step}
          value={h.fromM(thresholds.cautionRangeM)}
          onCommit={set('cautionRangeM', h.toM, h.fromM)}
        />
        <Field
          label="Vertical"
          unit={v.unit}
          step={v.step}
          value={v.fromM(thresholds.cautionVerticalM)}
          onCommit={set('cautionVerticalM', v.toM, v.fromM)}
        />
        <div className="pt-1 text-[10px] font-bold uppercase tracking-wider text-red-300">Alert: within both, or…</div>
        <Field
          label="Range"
          unit={h.unit}
          step={h.step}
          value={h.fromM(thresholds.alertRangeM)}
          onCommit={set('alertRangeM', h.toM, h.fromM)}
        />
        <Field
          label="Vertical"
          unit={v.unit}
          step={v.step}
          value={v.fromM(thresholds.alertVerticalM)}
          onCommit={set('alertVerticalM', v.toM, v.fromM)}
        />
        <Field
          label="…predicted to pass within"
          unit={h.unit}
          step={h.step}
          value={h.fromM(thresholds.cpaAlertM)}
          onCommit={set('cpaAlertM', h.toM, h.fromM)}
        />
        <Field
          label="…in the next"
          unit="s"
          step={5}
          value={thresholds.cpaHorizonS}
          onCommit={set(
            'cpaHorizonS',
            (x) => x,
            (x) => x
          )}
        />
      </div>
      <div className="flex items-start justify-between gap-2 text-[10px] leading-snug text-zinc-500">
        <span>
          Hiding aircraft doesn&apos;t silence warnings. Smaller values are raised to the least: ranges {h.fromM(50)}{' '}
          {h.unit}, heights {v.fromM(10)} {v.unit}, the predicted pass {h.fromM(10)} {h.unit}, the look-ahead 5 s. The
          vehicle forwards only traffic within ADSB_LIST_RADIUS (Copter 2 km, Plane 10 km by default).
          {odd && <span className="text-amber-300"> The alert limits are wider than the caution limits.</span>}
        </span>
        <button
          type="button"
          disabled={isDefault}
          onClick={resetThresholds}
          className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
        >
          Defaults
        </button>
      </div>
    </div>
  );
};
