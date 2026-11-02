import React, { useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardContent } from '../ui/card';
import { Battery, Zap, Activity } from 'lucide-react';

export const BatteryWidget: React.FC = () => {
  const { battery } = useTelemetryStore();

  useEffect(() => {
    messageRateManager.registerRequirement('battery-sys', MAVLINK_MSG_ID.SYS_STATUS);
    messageRateManager.registerRequirement('battery-status', MAVLINK_MSG_ID.BATTERY_STATUS);
    return () => {
      messageRateManager.unregisterRequirement('battery-sys');
      messageRateManager.unregisterRequirement('battery-status');
    };
  }, []);

  const getPctColor = (pct: number) => {
    if (pct <= 20) return 'text-red-400 bg-red-950/40 border-red-800';
    if (pct <= 40) return 'text-amber-400 bg-amber-950/40 border-amber-800';
    return 'text-emerald-400 bg-emerald-950/40 border-emerald-800';
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardContent className="p-3 space-y-2.5">
        {/* Top Mini Header: Remaining Gauge & Consumed */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-zinc-400 text-xs font-bold uppercase tracking-wider">
            <Battery className="h-4 w-4 text-emerald-400" />
            <span>Battery</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono">
              {battery.consumedMah > 0 ? `${battery.consumedMah} mAh` : ''}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-mono font-bold ${getPctColor(
                battery.remaining
              )}`}
            >
              {battery.remaining >= 0 ? `${battery.remaining}%` : 'N/A'}
            </span>
          </div>
        </div>

        {/* Voltage & Current large metrics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <Zap className="h-3 w-3 text-amber-400 shrink-0" /> Voltage
            </span>
            <div className="text-xl sm:text-2xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {battery.voltage > 0 ? battery.voltage.toFixed(2) : '--.--'}{' '}
              <span className="text-xs text-zinc-400 font-normal">V</span>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block flex items-center gap-1 truncate">
              <Activity className="h-3 w-3 text-sky-400 shrink-0" /> Current
            </span>
            <div className="text-xl sm:text-2xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {battery.current.toFixed(1)}{' '}
              <span className="text-xs text-zinc-400 font-normal">A</span>
            </div>
          </div>
        </div>

        {/* Cell Voltages if available */}
        {battery.cellVoltages.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold block">
              Cells ({battery.cellVoltages.length}S)
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              {battery.cellVoltages.map((v, i) => (
                <div key={i} className="bg-zinc-900/80 border border-zinc-850 rounded p-1 text-center min-w-0">
                  <span className="text-[8px] text-zinc-500 block truncate">C{i + 1}</span>
                  <span className="text-xs font-mono font-semibold text-zinc-200 truncate block">
                    {v.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
