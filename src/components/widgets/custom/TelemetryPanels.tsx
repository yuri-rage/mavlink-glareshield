// Read-only custom widget panels: numbers, lists, gauges, charts, compass, bars and LEDs.

import React, { useEffect, useMemo } from 'react';
import { useTelemetryStore } from '../../../store/telemetryStore';
import { evaluateAlert, toDisplayUnits, type BindingReading } from '../../../lib/widgetValues';
import { valueSampler } from '../../../lib/valueSampler';
import type { WidgetDataBinding } from '../../../types/widget';
import { RadialGauge } from './RadialGauge';
import { LinearGauge } from './LinearGauge';
import { GaugeGrid, type GridGauge } from './GaugeGrid';
import { TimeSeriesChart, type ChartSeries } from './TimeSeriesChart';
import { ACCENT_HEX, SERIES_HEX, useChromeColors, type ColorScheme } from './palette';
import { displayBinding, extractMultiBarItems, gaugeLevels, isMultiGauge, multiBarGroup, seriesLabel } from './panelModel';
import type { PanelProps } from './panelKit';

/** The primary value in display units, with its range (min / max are configured in base units). */
function primaryView({ def, readings, system }: PanelProps) {
  const primary = readings[0];
  const pb = displayBinding(def.binding, system);
  return {
    primary,
    pb,
    unit: primary?.unit ?? def.binding?.unit ?? '',
    min: pb?.min ?? 0,
    max: pb?.max ?? 100,
    numVal: primary?.value ?? null,
    boundText: primary?.text ?? '--',
  };
}

/** The first extra value, drawn as a marker on single gauges and the compass rose. */
function secondaryView(bindings: WidgetDataBinding[], readings: BindingReading[]) {
  return bindings.length > 1 && readings[1]
    ? { value: readings[1].value, text: `${readings[1].text} ${readings[1].unit}`.trim(), label: seriesLabel(bindings[1]) }
    : null;
}

/** One gauge per value, each on its own scale (falling back to the first value's range). */
function gaugeItems({ def, bindings, readings, system }: PanelProps): GridGauge[] {
  const levels = gaugeLevels(bindings, readings);
  return bindings.map((b, i) => {
    const r = readings[i];
    const scaled = displayBinding({ ...b, min: b.min ?? def.binding?.min, max: b.max ?? def.binding?.max }, system);
    const level = levels[i];
    return {
      key: `${b.messageName}.${b.fieldName}.${i}`,
      label: seriesLabel(b),
      value: r?.value ?? null,
      text: r?.text ?? '--',
      unit: r?.unit ?? '',
      min: scaled?.min ?? 0,
      max: scaled?.max ?? 100,
      zoneBinding: scaled,
      accent:
        level === 'crit'
          ? ACCENT_HEX.red
          : level === 'warn'
            ? ACCENT_HEX.amber
            : b.color || ACCENT_HEX[(def.colorScheme || 'default') as ColorScheme],
      dimmed: Boolean(r?.stale),
    };
  });
}

export const StatPanel: React.FC<PanelProps> = (props) => {
  const { boundText, unit } = primaryView(props);
  return (
    <div className={`text-center py-2 transition-opacity ${props.staleAll ? 'opacity-40' : ''}`}>
      <div className={`text-3xl font-mono font-bold ${props.scheme.valueText}`}>
        {boundText} <span className="text-sm font-normal text-zinc-400">{unit}</span>
      </div>
      {props.def.description && <p className="text-[11px] text-zinc-500 mt-1">{props.def.description}</p>}
    </div>
  );
};

export const TextPanel: React.FC<PanelProps> = (props) => {
  const { boundText, unit } = primaryView(props);
  return (
    <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 font-mono text-xs text-zinc-300 transition-opacity ${props.staleAll ? 'opacity-40' : ''}`}>
      {props.def.description || 'Raw output'}: <b className={props.scheme.icon}>{boundText}</b> {unit}
    </div>
  );
};

export const RadialGaugePanel: React.FC<PanelProps> = (props) => {
  const multi = isMultiGauge(props.def);
  const items = multi ? gaugeItems(props) : [];
  const { numVal, boundText, unit, min, max, pb } = primaryView(props);
  return (
    // The dial is absolutely positioned so it fits the card instead of sizing it: the card's height comes from its
    // row (neighbouring widgets, or the row-height setting), with a modest minimum.
    <div className={`relative flex-1 ${multi && items.length > 4 ? 'min-h-[240px]' : 'min-h-[190px]'}`}>
      {multi ? (
        <GaugeGrid gauges={items} config={props.def.gauge} />
      ) : (
        <RadialGauge
          value={numVal}
          text={boundText}
          unit={unit}
          min={min}
          max={max}
          zoneBinding={pb}
          config={props.def.gauge}
          accent={props.accentHex}
          secondary={secondaryView(props.bindings, props.readings)}
          dimmed={props.staleAll}
        />
      )}
    </div>
  );
};

export const LinearGaugePanel: React.FC<PanelProps> = (props) => {
  if (isMultiGauge(props.def)) {
    return (
      <div className="space-y-2.5">
        {gaugeItems(props).map((g) => (
          <LinearGauge
            key={g.key}
            label={g.label}
            value={g.value}
            text={g.text}
            unit={g.unit}
            min={g.min}
            max={g.max}
            zoneBinding={g.zoneBinding}
            config={props.def.gauge}
            accent={g.accent}
            dimmed={g.dimmed}
            compact
          />
        ))}
      </div>
    );
  }
  const { numVal, boundText, unit, min, max, pb } = primaryView(props);
  return (
    <LinearGauge
      value={numVal}
      text={boundText}
      unit={unit}
      min={min}
      max={max}
      zoneBinding={pb}
      config={props.def.gauge}
      accent={props.accentHex}
      valueClass={props.scheme.valueText}
      secondary={secondaryView(props.bindings, props.readings)}
      dimmed={props.staleAll}
    />
  );
};

export const ValueListPanel: React.FC<PanelProps> = ({ bindings, readings }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 font-mono text-xs">
    {bindings.map((b, i) => {
      const r = readings[i];
      const level = evaluateAlert(r?.base ?? null, b);
      return (
        <React.Fragment key={`${b.messageName}.${b.fieldName}.${i}`}>
          <span className={`text-zinc-400 truncate ${r?.stale ? 'opacity-40' : ''}`} title={`${b.messageName}.${b.fieldName}`}>
            {seriesLabel(b)}
          </span>
          <span
            className={`text-right font-bold ${r?.stale ? 'opacity-40' : ''} ${
              level === 'crit' ? 'text-red-400' : level === 'warn' ? 'text-amber-300' : 'text-zinc-100'
            }`}
          >
            {r?.text ?? '--'} <span className="text-[10px] font-normal text-zinc-500">{r?.unit}</span>
          </span>
        </React.Fragment>
      );
    })}
    {bindings.length === 0 && <span className="text-zinc-500 col-span-2">No values configured.</span>}
  </div>
);

export const MultiBarPanel: React.FC<PanelProps> = ({ def, scheme }) => {
  const group = multiBarGroup(def);
  const items = useTelemetryStore((s) => extractMultiBarItems(group, s));
  return (
    <div className="space-y-1.5 py-0.5">
      {items.map((item) => {
        const isUnused = item.displayValue === '--';
        const barPct =
          isUnused || (item.value === 0 && item.min >= 0)
            ? 0
            : item.max > item.min
              ? Math.max(0, Math.min(100, ((item.value - item.min) / (item.max - item.min)) * 100))
              : 0;
        const isCrit = !isUnused && item.critAbove !== undefined && item.value >= item.critAbove;
        const isWarn = !isUnused && !isCrit && item.warnAbove !== undefined && item.value >= item.warnAbove;
        const barColor = isCrit ? 'bg-red-500' : isWarn ? 'bg-amber-500' : scheme.bg;
        return (
          <div key={item.label} className="space-y-0.5">
            <div className="flex justify-between items-center text-[10px] font-mono">
              <span className="text-zinc-400 font-semibold">{item.label}</span>
              <span className={isCrit ? 'text-red-400 font-bold' : isWarn ? 'text-amber-300 font-bold' : 'text-zinc-200'}>
                {item.displayValue ?? `${item.value} ${item.unit}`.trim()}
              </span>
            </div>
            <div className="w-full bg-zinc-900 h-2 rounded overflow-hidden border border-zinc-800/80 relative">
              {item.min < 0 && <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-zinc-600/80 z-10 -translate-x-1/2" />}
              <div className={`h-full ${barColor} transition-all duration-150`} style={{ width: `${barPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const CompassPanel: React.FC<PanelProps> = (props) => {
  const chrome = useChromeColors();
  const { def, staleAll, scheme, accentHex } = props;
  const { numVal, boundText, unit } = primaryView(props);
  const secondary = secondaryView(props.bindings, props.readings);
  return (
    <div className={`flex items-center justify-around gap-3 py-1 transition-opacity ${staleAll ? 'opacity-40' : ''}`}>
      <div className="relative w-24 h-24 shrink-0">
        <svg viewBox="0 0 100 100" className="w-full h-full">
          <circle cx="50" cy="50" r="44" stroke={chrome.track} fill={chrome.panel} strokeWidth="2" />
          {Array.from({ length: 36 }, (_, i) => {
            const a = (i * 10 * Math.PI) / 180;
            const r1 = i % 9 === 0 ? 36 : i % 3 === 0 ? 39 : 41;
            return (
              <line
                key={i}
                x1={50 + r1 * Math.sin(a)}
                y1={50 - r1 * Math.cos(a)}
                x2={50 + 43 * Math.sin(a)}
                y2={50 - 43 * Math.cos(a)}
                stroke={i % 9 === 0 ? chrome.tick : chrome.tickMinor}
                strokeWidth={i % 9 === 0 ? 1.4 : 0.7}
              />
            );
          })}
          <text x="50" y="22" textAnchor="middle" className="fill-sky-400 text-[9px] font-bold font-mono">N</text>
          <text x="80" y="53" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">E</text>
          <text x="50" y="84" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">S</text>
          <text x="20" y="53" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">W</text>
          {secondary?.value !== null && secondary?.value !== undefined && (
            <g transform={`rotate(${secondary.value} 50 50)`}>
              <polygon points="50,6 46,14 54,14" fill="#d946ef" />
            </g>
          )}
          <g transform={`rotate(${numVal ?? 0} 50 50)`}>
            <polygon points="50,18 45,54 50,48 55,54" style={{ fill: accentHex }} />
            <polygon points="50,82 46,54 50,48 54,54" fill={chrome.tickMinor} />
          </g>
          <circle cx="50" cy="50" r="3.5" fill={chrome.pivot} />
        </svg>
      </div>
      <div className="text-right font-mono min-w-0">
        <div className={`text-2xl font-bold ${scheme.valueText}`}>
          {boundText}
          <span className="text-xs font-normal text-zinc-400 ml-0.5">{unit || '°'}</span>
        </div>
        {secondary && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: '#d946ef' }}>
            ▲ {secondary.label} {secondary.text}
          </div>
        )}
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
          {def.binding?.messageName || 'VECTOR'} · {def.binding?.fieldName || 'deg'}
        </div>
        {def.description && <div className="text-[10px] text-zinc-400 mt-1">{def.description}</div>}
      </div>
    </div>
  );
};

export const ChartPanel: React.FC<PanelProps> = (props) => {
  const { def, bindings, readings, system, staleAll } = props;
  const { min, max } = primaryView(props);

  // One shared sampler ring per bound series.
  const series = useMemo<ChartSeries[]>(
    () =>
      bindings.map((b, i) => {
        const { key, ring } = valueSampler.seriesFor(b, def.staleAfterSec);
        return {
          key,
          ring,
          label: seriesLabel(b),
          color: b.color || (i === 0 ? ACCENT_HEX[(def.colorScheme ?? 'default') as ColorScheme] : SERIES_HEX[i % SERIES_HEX.length]),
          unit: readings[i]?.unit ?? b.unit ?? '',
          decimals: b.decimals ?? 1,
          toDisplay: (base: number) => toDisplayUnits(base, b, system),
        };
      }),
    // readings[i].unit only changes with the unit system, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bindings, system, def.colorScheme, def.staleAfterSec]
  );

  useEffect(() => {
    // Sample while mounted; the history itself is kept for when the widget comes back.
    const handles = bindings.map((b) => valueSampler.acquire(b, def.staleAfterSec));
    return () => handles.forEach((h) => h.release());
  }, [bindings, def.staleAfterSec]);

  return (
    <div className="flex-1 min-h-[170px] flex flex-col">
      <TimeSeriesChart
        series={series}
        config={{ yScale: 'auto', ...def.chart }}
        fixedMin={min}
        fixedMax={max}
        dimmed={staleAll}
        // A label the user set is always shown; an unlabelled single series is named by the card title instead.
        legendLabels={bindings.some((b) => Boolean(b.label?.trim()))}
      />
    </div>
  );
};

export const LedPanel: React.FC<PanelProps> = (props) => {
  const { primary, boundText, unit } = primaryView(props);
  const threshold = props.def.stateThreshold ?? 0;
  const on = primary?.base !== null && primary?.base !== undefined && primary.base > threshold && !primary.stale;
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`h-5 w-5 rounded-full border shadow-lg ${on ? `${props.scheme.ledActive} animate-pulse` : 'bg-zinc-800 border-zinc-700'}`} />
      <div>
        <span className="text-sm font-bold text-zinc-200">{primary?.stale ? 'NO DATA' : on ? 'ACTIVE / HIGH' : 'INACTIVE / LOW'}</span>
        <span className="text-[10px] text-zinc-500 block font-mono">
          Value: {boundText} {unit} · on above {threshold}
        </span>
      </div>
    </div>
  );
};
