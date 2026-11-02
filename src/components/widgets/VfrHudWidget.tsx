import React, { useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardContent } from '../ui/card';
import { Wind, Gauge, Compass, ArrowUp } from 'lucide-react';

export const VfrHudWidget: React.FC = () => {
  const { vfr } = useTelemetryStore();
  const { formatSpeed, formatClimb } = useUnitsStore();

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
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardContent className="p-3 space-y-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <Gauge className="h-3 w-3 text-sky-400 shrink-0" /> Groundspeed
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {gsFormatted.value} <span className="text-xs text-zinc-400 font-normal">{gsFormatted.unit}</span>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <Wind className="h-3 w-3 text-cyan-400 shrink-0" /> Airspeed
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {asFormatted.value} <span className="text-xs text-zinc-400 font-normal">{asFormatted.unit}</span>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <ArrowUp className="h-3 w-3 text-emerald-400 shrink-0" /> Climb Rate
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {climbFormatted.value}{' '}
              <span className="text-xs text-zinc-400 font-normal">{climbFormatted.unit}</span>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <Compass className="h-3 w-3 text-amber-400 shrink-0" /> Heading
            </span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {vfr.heading}°
            </div>
          </div>
        </div>

        {/* Throttle bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] font-mono text-zinc-400">
            <span>Throttle</span>
            <span className={`font-bold ${isReverse ? 'text-amber-400' : 'text-zinc-200'}`}>
              {isReverse ? `${vfr.throttle}% (REV)` : `${vfr.throttle}%`}
            </span>
          </div>
          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800 relative">
            <div
              className={`h-full transition-all duration-200 ${isReverse ? 'bg-amber-500' : 'bg-sky-500'}`}
              style={{ width: `${absThrottle}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
