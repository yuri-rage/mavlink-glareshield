import React, { useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Battery, Zap, Activity } from 'lucide-react';

export const BatteryWidget: React.FC = () => {
  const battery = useTelemetryStore((state) => state.battery);
  const heartbeat = useTelemetryStore((state) => state.heartbeat);

  useEffect(() => {
    messageRateManager.registerRequirement('battery-sys', MAVLINK_MSG_ID.SYS_STATUS);
    messageRateManager.registerRequirement('battery-status', MAVLINK_MSG_ID.BATTERY_STATUS);
    return () => {
      messageRateManager.unregisterRequirement('battery-sys');
      messageRateManager.unregisterRequirement('battery-status');
    };
  }, []);

  const hasLink =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED' &&
    battery.voltage > 0;

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
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Battery className="h-3.5 w-3.5 text-emerald-400" />
            Battery
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 font-mono">
              {hasLink && battery.consumedMah > 0 ? `${battery.consumedMah} mAh` : ''}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full border font-mono font-bold ${getPctColor(
                battery.remaining
              )}`}
            >
              {hasLink && battery.remaining >= 0 ? `${battery.remaining}%` : '--%'}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
        {/* Voltage & Current large metrics */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase flex items-center gap-1 truncate">
              <Zap className="h-3 w-3 text-amber-400 shrink-0" /> Voltage
            </span>
            <div className="text-xl sm:text-2xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {hasLink ? battery.voltage.toFixed(2) : '--.--'}{' '}
              <span className="text-xs text-zinc-400 font-normal">V</span>
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2.5 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase flex items-center gap-1 truncate">
              <Activity className="h-3 w-3 text-sky-400 shrink-0" /> Current
            </span>
            <div className="text-xl sm:text-2xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {hasLink ? battery.current.toFixed(1) : '--.-'}{' '}
              <span className="text-xs text-zinc-400 font-normal">A</span>
            </div>
          </div>
        </div>

        {/* Cell Voltages when true per-cell telemetry is available */}
        {hasPerCellTelemetry ? (
          <div className="space-y-1">
            <span className="text-[10px] text-zinc-500 uppercase font-bold block">
              Cells ({battery.cellVoltages.length}S)
            </span>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {battery.cellVoltages.map((v, i) => (
                <div key={i} className="bg-zinc-900/80 border border-zinc-800 rounded p-1 text-center min-w-0">
                  <span className="text-[8px] text-zinc-500 block truncate">C{i + 1}</span>
                  <span className="text-xs font-mono font-semibold text-zinc-200 truncate block">
                    {v.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 bg-zinc-900/50 border border-zinc-800/80 rounded-lg px-2.5 py-1.5">
            <span>Consumed:</span>
            <span className="font-bold text-zinc-200">
              {hasLink ? `${battery.consumedMah} mAh` : '-- mAh'}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
