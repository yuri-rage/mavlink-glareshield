import React, { useEffect, useState } from 'react';

import { Activity, Battery, BatteryCharging, Gauge, Zap } from 'lucide-react';

import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useInPane } from '../dashboard/paneContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const BatteryWidget: React.FC = () => {
  // In a Cockpit pane: the card fills it and its content scrolls under the pinned title.
  const inPane = useInPane();
  const battery = useTelemetryStore((state) => state.battery);
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  // Other battery monitors (BATT2_ ...), while linked and reporting within the last 10 s. A 2 s tick drops one that
  // goes quiet even when nothing else re-renders the widget.
  const batteries = useTelemetryStore((state) => state.batteries);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const hasOthers = Object.keys(batteries).some((k) => k !== '0');
  useEffect(() => {
    if (!hasOthers) return;
    const t = setInterval(() => setNowMs(Date.now()), 2000);
    return () => clearInterval(t);
  }, [hasOthers]);
  const linked = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED';
  const others = linked
    ? Object.values(batteries)
        .filter((b) => b.id !== 0 && Math.max(nowMs, Date.now()) - b.at < 10_000)
        .sort((a, b) => a.id - b.id)
    : [];

  useEffect(() => {
    messageRateManager.registerRequirement('battery-sys', MAVLINK_MSG_ID.SYS_STATUS);
    messageRateManager.registerRequirement('battery-status', MAVLINK_MSG_ID.BATTERY_STATUS);
    return () => {
      messageRateManager.unregisterRequirement('battery-sys');
      messageRateManager.unregisterRequirement('battery-status');
    };
  }, []);

  const hasLink = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED' && battery.voltage > 0;

  // AP_BattMonitor analog/power-brick monitors populate voltages[0] with total pack voltage
  // and 65535 in slots 1..9. Only display per-cell readout when true per-cell data is present.
  const hasPerCellTelemetry =
    hasLink &&
    battery.cellVoltages.length > 0 &&
    !(battery.cellVoltages.length === 1 && battery.cellVoltages[0] > 4.55);

  const getPctColor = (pct: number) => {
    if (!hasLink) return 'text-zinc-500 bg-zinc-900 border-zinc-800';
    if (pct <= 20) return 'text-red-400 bg-red-950/40 border-red-800';
    if (pct <= 40) return 'text-amber-400 bg-amber-950/40 border-amber-800';
    return 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
  };

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Battery className="h-3.5 w-3.5 text-emerald-400" />
            Battery
          </CardTitle>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-xs font-bold ${getPctColor(
                battery.remaining
              )}`}
            >
              {hasLink && battery.remaining >= 0 ? `${battery.remaining}%` : '--%'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className={`flex min-h-0 flex-1 flex-col space-y-2.5 p-3 ${inPane ? 'overflow-y-auto' : ''}`}>
        {/* Voltage, current, power and consumption, laid out like the neighbouring flight cards */}
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5">
            <span className="flex items-center gap-1 truncate text-[11px] font-bold uppercase text-zinc-400">
              <Zap className="h-3 w-3 shrink-0 text-amber-400" /> Voltage
            </span>
            <div className="mt-0.5 truncate font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasLink ? battery.voltage.toFixed(2) : '--.--'}{' '}
              <span className="text-xs font-normal text-zinc-400">V</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5">
            <span className="flex items-center gap-1 truncate text-[11px] font-bold uppercase text-zinc-400">
              <Activity className="h-3 w-3 shrink-0 text-sky-400" /> Current
            </span>
            <div className="mt-0.5 truncate font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasLink ? battery.current.toFixed(1) : '--.-'}{' '}
              <span className="text-xs font-normal text-zinc-400">A</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5">
            <span className="flex items-center gap-1 truncate text-[11px] font-bold uppercase text-zinc-400">
              <Gauge className="h-3 w-3 shrink-0 text-emerald-400" /> Power
            </span>
            <div className="mt-0.5 truncate font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasLink ? Math.round(battery.voltage * battery.current) : '--'}{' '}
              <span className="text-xs font-normal text-zinc-400">W</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5">
            <span className="flex items-center gap-1 truncate text-[11px] font-bold uppercase text-zinc-400">
              <BatteryCharging className="h-3 w-3 shrink-0 text-amber-400" /> Consumed
            </span>
            <div className="mt-0.5 truncate font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasLink ? battery.consumedMah : '--'} <span className="text-xs font-normal text-zinc-400">mAh</span>
            </div>
          </div>
        </div>

        {/* Other battery monitors: each with its own numbers, never mixed into the first. */}
        {others.length > 0 && (
          <div className="space-y-1">
            {others.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 font-mono text-xs"
              >
                <span className="text-[11px] font-bold uppercase text-zinc-400">Battery {b.id + 1}</span>
                <span className="text-zinc-100">{b.voltage > 0 ? `${b.voltage.toFixed(2)} V` : '--.-- V'}</span>
                <span className="text-zinc-100">{b.current.toFixed(1)} A</span>
                <span className="text-zinc-300">{b.consumedMah} mAh</span>
                <span className={b.remaining >= 0 && b.remaining < 25 ? 'text-red-300' : 'text-zinc-300'}>
                  {b.remaining >= 0 ? `${b.remaining}%` : '--%'}
                </span>
                {b.temperature !== undefined && <span className="text-zinc-400">{b.temperature.toFixed(0)}°C</span>}
              </div>
            ))}
          </div>
        )}

        {/* Cell Voltages when true per-cell telemetry is available */}
        {hasPerCellTelemetry && (
          <div className="space-y-1">
            <span className="block text-[11px] font-bold uppercase text-zinc-500">
              Cells ({battery.cellVoltages.length}S)
            </span>
            <div className="grid grid-cols-3 gap-1.5 @lg:grid-cols-6">
              {battery.cellVoltages.map((v, i) => (
                <div key={i} className="min-w-0 rounded border border-zinc-800 bg-zinc-900/80 p-1 text-center">
                  <span className="block truncate text-[10px] text-zinc-500">C{i + 1}</span>
                  <span className="block truncate font-mono text-xs font-semibold text-zinc-200">{v.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
