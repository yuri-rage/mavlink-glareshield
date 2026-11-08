// Altitude, ground speed and battery current over time, on the same canvas chart the custom widgets use.
// Values come from the shared 10 Hz sampler (10 minutes of history), so this widget and any custom chart of the
// same field share one history.

import React, { useEffect, useMemo, useState } from 'react';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { valueSampler } from '../../lib/valueSampler';
import { bindingUnit, toDisplayUnits, type UnitSystem } from '../../lib/widgetValues';
import type { WidgetDataBinding } from '../../types/widget';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { ChartControls, TimeSeriesChart, type ChartSeries } from './custom/TimeSeriesChart';
import { LineChart as ChartIcon, Layers, Combine } from 'lucide-react';

const SERIES: { binding: WidgetDataBinding; color: string }[] = [
  { binding: { messageName: 'VFR_HUD', fieldName: 'alt', unitKind: 'altitude', label: 'Alt', decimals: 1 }, color: '#10b981' },
  { binding: { messageName: 'VFR_HUD', fieldName: 'groundspeed', unitKind: 'speed', label: 'Speed', decimals: 1 }, color: '#38bdf8' },
  { binding: { messageName: 'SYS_STATUS', fieldName: 'current_battery', unit: 'A', label: 'Current', decimals: 1 }, color: '#f59e0b' },
];

export const TelemetryChartsWidget: React.FC = () => {
  const system = useUnitsStore((s) => s.system) as UnitSystem;
  const [viewMode, setViewMode] = useState<'stacked' | 'combined'>('stacked');
  const [windowSec, setWindowSec] = useState(60);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  useEffect(() => {
    messageRateManager.registerRequirement('charts-vfr', MAVLINK_MSG_ID.VFR_HUD);
    messageRateManager.registerRequirement('charts-sys', MAVLINK_MSG_ID.SYS_STATUS);
    // Sample while mounted; the history stays for when the widget comes back.
    const handles = SERIES.map((s) => valueSampler.acquire(s.binding));
    return () => {
      messageRateManager.unregisterRequirement('charts-vfr');
      messageRateManager.unregisterRequirement('charts-sys');
      handles.forEach((h) => h.release());
    };
  }, []);

  const series = useMemo<ChartSeries[]>(
    () =>
      SERIES.map(({ binding, color }) => {
        const { key, ring } = valueSampler.seriesFor(binding);
        return {
          key,
          ring,
          label: binding.label ?? binding.fieldName,
          color,
          unit: bindingUnit(binding, system),
          decimals: binding.decimals ?? 1,
          toDisplay: (base: number) => toDisplayUnits(base, binding, system),
        };
      }),
    [system]
  );

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <ChartIcon className="h-4 w-4 text-sky-400" />
            Telemetry Charts
          </span>
          <div className="flex items-center gap-1.5 normal-case tracking-normal font-normal">
            <ChartControls
              windowSec={windowSec}
              onWindow={setWindowSec}
              paused={pausedAt !== null}
              onTogglePause={() => setPausedAt((p) => (p === null ? Date.now() : null))}
            />
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'stacked' ? 'combined' : 'stacked'))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 hover:bg-zinc-800 text-[11px] font-bold text-zinc-300 uppercase"
              title={viewMode === 'stacked' ? 'One axis per value (click for a single shared axis)' : 'One shared axis (click for an axis per value)'}
            >
              {viewMode === 'stacked' ? (
                <>
                  <Layers className="h-3 w-3 text-sky-400" />
                  3 axes
                </>
              ) : (
                <>
                  <Combine className="h-3 w-3 text-amber-400" />1 axis
                </>
              )}
            </button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-2.5 sm:p-3 flex-1 flex flex-col gap-2 min-h-0">
        {viewMode === 'stacked' ? (
          series.map((s, i) => (
            <div key={s.key} className={`flex-1 flex flex-col min-h-0 ${i > 0 ? 'border-t border-zinc-900 pt-1.5' : ''}`}>
              <TimeSeriesChart
                series={[s]}
                config={{ yScale: 'auto' }}
                fixedMin={0}
                fixedMax={1}
                windowSec={windowSec}
                pausedAt={pausedAt}
                controls={false}
                plotMinHeight={70}
                legendLabels
              />
            </div>
          ))
        ) : (
          <TimeSeriesChart
            series={series}
            config={{ yScale: 'auto' }}
            fixedMin={0}
            fixedMax={1}
            windowSec={windowSec}
            pausedAt={pausedAt}
            controls={false}
            plotMinHeight={220}
          />
        )}
      </CardContent>
    </Card>
  );
};
