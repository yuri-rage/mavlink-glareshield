import React, { useEffect, useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { LineChart as ChartIcon, Layers, Combine } from 'lucide-react';

export const TelemetryChartsWidget: React.FC = () => {
  const history = useTelemetryStore((state) => state.history);
  const { formatSpeed, formatAltitude } = useUnitsStore();
  const [viewMode, setViewMode] = useState<'stacked' | 'combined'>('stacked');
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
    dispAltitude: Number(formatAltitude(p.altitude).value),
    dispSpeed: Number(formatSpeed(p.groundspeed).value),
  }));

  const latest = formattedData[formattedData.length - 1];

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5">
            <ChartIcon className="h-4 w-4 text-sky-400" />
            REAL-TIME TELEMETRY TIME-SERIES (LAST 60s)
          </span>
          <div className="flex items-center gap-2 sm:gap-3 text-[11px] font-mono flex-wrap">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Alt ({altUnit}){latest ? `: ${latest.dispAltitude}` : ''}
            </span>
            <span className="text-sky-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-sky-400" />
              Speed ({speedUnit}){latest ? `: ${latest.dispSpeed}` : ''}
            </span>
            <span className="text-amber-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Current (A){latest ? `: ${latest.batteryCurrent}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setViewMode((m) => (m === 'stacked' ? 'combined' : 'stacked'))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-[10px] font-sans font-bold text-zinc-300 uppercase"
              title={
                viewMode === 'stacked'
                  ? 'Currently showing independent Y-axes (click for single combined axis)'
                  : 'Currently showing combined Y-axis (click for independent stacked axes)'
              }
            >
              {viewMode === 'stacked' ? (
                <>
                  <Layers className="h-3 w-3 text-sky-400" />
                  3x Axes
                </>
              ) : (
                <>
                  <Combine className="h-3 w-3 text-amber-400" />
                  1x Axis
                </>
              )}
            </button>
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-2.5 sm:p-3 flex-1 flex flex-col justify-center">
        {formattedData.length < 2 ? (
          <div className="h-56 w-full flex items-center justify-center text-xs text-zinc-500 font-mono italic">
            Accumulating real-time telemetry points...
          </div>
        ) : viewMode === 'stacked' ? (
          <div className="h-64 w-full flex flex-col gap-1">
            {/* Row 1: Altitude (Independent Y-Axis) */}
            <div className="flex-1 min-h-0 flex items-center gap-1.5">
              <div className="w-16 shrink-0 text-right pr-1 font-mono">
                <div className="text-[9px] font-bold uppercase text-emerald-400">Alt ({altUnit})</div>
                <div className="text-xs font-bold text-zinc-100">
                  {latest ? latest.dispAltitude.toFixed(1) : '--'}
                </div>
              </div>
              <div className="flex-1 h-full min-h-[64px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formattedData} syncId="telemetry-sync">
                    <XAxis dataKey="timeStr" hide />
                    <YAxis
                      stroke="#52525b"
                      fontSize={9}
                      width={36}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '0.5rem',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        padding: '4px 8px',
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
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Row 2: Groundspeed (Independent Y-Axis) */}
            <div className="flex-1 min-h-0 flex items-center gap-1.5 border-t border-zinc-900 pt-0.5">
              <div className="w-16 shrink-0 text-right pr-1 font-mono">
                <div className="text-[9px] font-bold uppercase text-sky-400">Spd ({speedUnit})</div>
                <div className="text-xs font-bold text-zinc-100">
                  {latest ? latest.dispSpeed.toFixed(1) : '--'}
                </div>
              </div>
              <div className="flex-1 h-full min-h-[64px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formattedData} syncId="telemetry-sync">
                    <XAxis dataKey="timeStr" hide />
                    <YAxis
                      stroke="#52525b"
                      fontSize={9}
                      width={36}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '0.5rem',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        padding: '4px 8px',
                      }}
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
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Row 3: Battery Current (Independent Y-Axis) */}
            <div className="flex-1 min-h-0 flex items-center gap-1.5 border-t border-zinc-900 pt-0.5">
              <div className="w-16 shrink-0 text-right pr-1 font-mono">
                <div className="text-[9px] font-bold uppercase text-amber-400">Curr (A)</div>
                <div className="text-xs font-bold text-zinc-100">
                  {latest ? latest.batteryCurrent.toFixed(1) : '--'}
                </div>
              </div>
              <div className="flex-1 h-full min-h-[76px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={formattedData} syncId="telemetry-sync">
                    <XAxis dataKey="timeStr" stroke="#52525b" fontSize={9} tickLine={false} />
                    <YAxis
                      stroke="#52525b"
                      fontSize={9}
                      width={36}
                      tickLine={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#09090b',
                        borderColor: '#27272a',
                        borderRadius: '0.5rem',
                        fontSize: '10px',
                        fontFamily: 'monospace',
                        padding: '4px 8px',
                      }}
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
              </div>
            </div>
          </div>
        ) : (
          <div className="h-56 w-full">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
};
