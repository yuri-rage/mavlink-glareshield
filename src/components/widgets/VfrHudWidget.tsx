import React, { useEffect } from 'react';

import { ArrowUp, Compass, Gauge, Wind } from 'lucide-react';

import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useInPane } from '../dashboard/paneContext';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const VfrHudWidget: React.FC = () => {
  // In a Cockpit pane: the card fills it and its content scrolls under the pinned title.
  const inPane = useInPane();
  const connected = useTelemetryStore(
    (state) => state.heartbeat.lastHeartbeatTime > 0 && state.heartbeat.modeName !== 'DISCONNECTED'
  );
  const hasConnectedInSession = useTelemetryStore((state) => state.hasConnectedInSession);
  const vfr = useTelemetryStore((state) => state.vfr);
  const { formatSpeed, formatClimb } = useUnitsStore();

  const hasData = connected || hasConnectedInSession;

  useEffect(() => {
    messageRateManager.registerRequirement('vfr-hud', MAVLINK_MSG_ID.VFR_HUD);
    return () => {
      messageRateManager.unregisterRequirement('vfr-hud');
    };
  }, []);

  const isReverse = vfr.throttle < 0;
  const absThrottle = Math.min(100, Math.abs(vfr.throttle));
  const gsFormatted = formatSpeed(vfr.groundspeed);
  const asFormatted = formatSpeed(vfr.airspeed);
  const climbFormatted = formatClimb(vfr.climb);

  return (
    <Card
      className={`flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md transition-opacity ${
        !connected ? 'opacity-75' : ''
      }`}
    >
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
          <Gauge className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <span>VFR Telemetry</span>
        </CardTitle>
      </CardHeader>
      <CardContent
        className={`flex min-h-0 flex-1 flex-col justify-between space-y-2.5 p-3 ${inPane ? 'overflow-y-auto' : ''}`}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-zinc-400">
              <Gauge className="h-3 w-3 shrink-0 text-sky-400" /> Groundspeed
            </span>
            <div className="mt-0.5 font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasData ? gsFormatted.value : '--'}{' '}
              <span className="text-xs font-normal text-zinc-400">{gsFormatted.unit}</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-zinc-400">
              <Wind className="h-3 w-3 shrink-0 text-cyan-400" /> Airspeed
            </span>
            <div className="mt-0.5 font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasData ? asFormatted.value : '--'}{' '}
              <span className="text-xs font-normal text-zinc-400">{asFormatted.unit}</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-zinc-400">
              <ArrowUp className="h-3 w-3 shrink-0 text-emerald-400" /> Climb Rate
            </span>
            <div className="mt-0.5 font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasData ? climbFormatted.value : '--'}{' '}
              <span className="text-xs font-normal text-zinc-400">{climbFormatted.unit}</span>
            </div>
          </div>

          <div className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2">
            <span className="flex items-center gap-1 text-[11px] font-bold uppercase text-zinc-400">
              <Compass className="h-3 w-3 shrink-0 text-amber-400" /> Heading
            </span>
            <div className="mt-0.5 font-mono text-xl font-bold text-zinc-100 sm:text-2xl">
              {hasData ? `${vfr.heading}°` : '--'}
            </div>
          </div>
        </div>

        {/* Throttle bar */}
        <div className="space-y-1">
          <div className="flex justify-between font-mono text-xs text-zinc-400">
            <span>Throttle</span>
            <span className={`font-bold ${isReverse ? 'text-amber-400' : 'text-zinc-200'}`}>
              {hasData ? (isReverse ? `${vfr.throttle}% (REV)` : `${vfr.throttle}%`) : '--'}
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-900">
            <div
              className={`h-full transition-all duration-200 ${isReverse ? 'bg-amber-500' : 'bg-sky-500'}`}
              style={{ width: `${hasData ? absThrottle : 0}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
