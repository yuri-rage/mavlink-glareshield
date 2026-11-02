import React, { useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { LineChart as ChartIcon } from 'lucide-react';

export const TelemetryChartsWidget: React.FC = () => {
  const history = useTelemetryStore((state) => state.history);
  const { formatSpeed, formatAltitude } = useUnitsStore();
  const speedUnit = formatSpeed(0).unit;
  const altUnit = formatAltitude(0).unit;

  useEffect(() => {
    messageRateManager.registerRequirement('charts-vfr', MAVLINK_MSG_ID.VFR_HUD);
    messageRateManager.registerRequirement('charts-sys', MAVLINK_MSG_ID.SYS_STATUS);
    return () => {
      messageRateManager.unregisterRequirement('charts-vfr');
      messageRateManager.unregisterRequirement('charts-sys');
    };
  }, []);

  const formattedData = history.map((p) => ({
    ...p,
    timeStr: new Date(p.time).toLocaleTimeString('en-GB', { hour12: false }),
    dispAltitude: formatAltitude(p.altitude).value,
    dispSpeed: formatSpeed(p.groundspeed).value,
  }));

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-2.5 px-4 bg-zinc-900/60 border-b border-zinc-800">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <ChartIcon className="h-4 w-4 text-sky-400" />
            REAL-TIME TELEMETRY TIME-SERIES (LAST 60s)
          </span>
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Alt ({altUnit})
            </span>
            <span className="text-sky-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400" /> Speed ({speedUnit})
            </span>
            <span className="text-amber-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> Current (A)
            </span>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3 flex-1 flex flex-col justify-center">
        <div className="h-56 w-full">
          {formattedData.length < 2 ? (
            <div className="h-full flex items-center justify-center text-xs text-zinc-500 font-mono italic">
              Accumulating real-time telemetry points...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={formattedData}>
                <XAxis dataKey="timeStr" stroke="#52525b" fontSize={10} tickLine={false} />
                <YAxis stroke="#52525b" fontSize={10} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#09090b',
                    borderColor: '#27272a',
                    borderRadius: '0.5rem',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="dispAltitude"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={`Altitude (${altUnit})`}
                />
                <Line
                  type="monotone"
                  dataKey="dispSpeed"
                  stroke="#38bdf8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={`Speed (${speedUnit})`}
                />
                <Line
                  type="monotone"
                  dataKey="batteryCurrent"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name="Current (A)"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
