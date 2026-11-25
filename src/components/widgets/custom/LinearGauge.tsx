import React from 'react';

import { clamp, niceStep, niceTicks, stepDecimals, thresholdZones } from '../../../lib/gaugeGeometry';
import type { WidgetDataBinding, WidgetGaugeConfig } from '../../../types/widget';
import { ZONE_HEX } from './palette';

export interface LinearGaugeProps {
  /** All values in display units. */
  value: number | null;
  text: string;
  unit: string;
  min: number;
  max: number;
  zoneBinding?: WidgetDataBinding;
  config?: WidgetGaugeConfig;
  accent: string;
  valueClass?: string;
  secondary?: { value: number | null; text: string; label: string } | null;
  /** Row label, shown in multi-gauge stacks. */
  label?: string;
  /** Smaller readout for stacks of several bars. */
  compact?: boolean;
  dimmed?: boolean;
}

export const LinearGauge: React.FC<LinearGaugeProps> = ({
  value,
  text,
  unit,
  min,
  max,
  zoneBinding,
  config,
  accent,
  valueClass = 'text-zinc-100',
  secondary,
  label,
  compact,
  dimmed,
}) => {
  const majorCount = config?.majorTicks ?? (compact ? 4 : 5);
  const zones = (config?.showZones ?? true) ? thresholdZones(zoneBinding, min, max) : [];
  const ticks = niceTicks(min, max, majorCount);
  const tickDec = stepDecimals(niceStep(min, max, majorCount));
  const at = (v: number) => (max > min ? clamp(((v - min) / (max - min)) * 100, 0, 100) : 0);
  const pct = value !== null ? at(value) : 0;
  // A range that spans zero fills from zero, so negative values read as negative.
  const origin = min < 0 && max > 0 ? at(0) : 0;

  return (
    <div className={`${compact ? 'space-y-0.5' : 'space-y-1.5'} transition-opacity ${dimmed ? 'opacity-40' : ''}`}>
      <div className="flex min-w-0 items-baseline justify-between gap-2 font-mono">
        {label && <span className="truncate text-xs font-semibold text-zinc-400">{label}</span>}
        <span
          className={`${compact ? 'text-sm' : 'text-2xl'} font-bold ${valueClass} ${label ? 'ml-auto' : ''} whitespace-nowrap`}
        >
          {text} <span className={`${compact ? 'text-[11px]' : 'text-xs'} font-normal text-zinc-400`}>{unit}</span>
        </span>
        {secondary && (
          <span className="truncate font-mono text-[10px]" style={{ color: '#d946ef' }}>
            ▼ {secondary.label} {secondary.text}
          </span>
        )}
      </div>
      <div className={`relative ${secondary ? 'pt-2' : ''}`}>
        {secondary?.value !== null && secondary?.value !== undefined && (
          <div
            className="absolute top-0 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent"
            style={{ left: `${at(secondary.value)}%`, borderTopColor: '#d946ef' }}
          />
        )}
        <div
          className={`w-full bg-zinc-900 ${compact ? 'h-2.5' : 'h-3'} relative overflow-hidden rounded-full border border-zinc-800`}
        >
          {value !== null && (
            <div
              className="absolute bottom-0 top-0 transition-[left,width] duration-150"
              style={{ left: `${Math.min(origin, pct)}%`, width: `${Math.abs(pct - origin)}%`, background: accent }}
            />
          )}
          {origin > 0 && <div className="absolute bottom-0 top-0 w-px bg-zinc-500" style={{ left: `${origin}%` }} />}
          {zones.map((z) => (
            <div
              key={`${z.level}-${z.from}`}
              className="absolute bottom-0 h-[3px]"
              style={{
                left: `${at(z.from)}%`,
                width: `${at(z.to) - at(z.from)}%`,
                background: ZONE_HEX[z.level],
                opacity: z.level === 'normal' ? 0.6 : 0.9,
              }}
            />
          ))}
        </div>
        <div className="relative mt-0.5 h-4 font-mono text-[10px] text-zinc-500">
          {ticks.map((t, i) => (
            <span
              key={t}
              // Keep the end labels inside the bar's width.
              className={`absolute whitespace-nowrap ${i === 0 && at(t) < 4 ? '' : i === ticks.length - 1 && at(t) > 96 ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: `${at(t)}%` }}
            >
              {t.toFixed(tickDec)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
