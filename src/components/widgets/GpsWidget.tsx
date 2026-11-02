import React, { useEffect } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Satellite } from 'lucide-react';

export const GpsWidget: React.FC = () => {
  const gps = useTelemetryStore((state) => state.gps);
  const position = useTelemetryStore((state) => state.position);
  const { formatSpeed, formatAltitude, altitudeMode } = useUnitsStore();

  useEffect(() => {
    messageRateManager.registerRequirement('gps-raw', MAVLINK_MSG_ID.GPS_RAW_INT);
    messageRateManager.registerRequirement('gps-pos', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
    return () => {
      messageRateManager.unregisterRequirement('gps-raw');
      messageRateManager.unregisterRequirement('gps-pos');
    };
  }, []);

  const getFixBadgeVariant = (fix: number) => {
    if (fix >= 4) return 'success'; // DGPS / RTK
    if (fix === 3) return 'info'; // 3D Fix
    if (fix === 2) return 'warning'; // 2D Fix
    return 'destructive'; // No Fix
  };

  const spdFormatted = formatSpeed(gps.groundspeed);
  const rawAlt = altitudeMode === 'msl' ? position.alt : position.relativeAlt;
  const altFormatted = formatAltitude(rawAlt);

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Satellite className="h-3.5 w-3.5 text-sky-400" />
            GNSS / GPS
          </CardTitle>
          <Badge variant={getFixBadgeVariant(gps.fixType)} className="font-mono text-[10px] px-2 py-0.5">
            {gps.fixLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">

        {/* Metric stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 text-center min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block truncate">Satellites</span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {gps.satellites}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 text-center min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block truncate">HDOP</span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {gps.hdop > 0 && gps.hdop < 90 ? gps.hdop.toFixed(2) : '--'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-2 text-center min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase block truncate">Speed</span>
            <div className="text-lg sm:text-xl font-mono font-bold text-zinc-100 mt-0.5 truncate">
              {spdFormatted.value}{' '}
              <span className="text-[10px] text-zinc-400 font-normal">{spdFormatted.unit}</span>
            </div>
          </div>
        </div>

        {/* Position coordinates readout */}
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-2 space-y-1 font-mono text-xs">
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Lat:</span>
            <span className="font-bold text-zinc-200 truncate">{position.lat.toFixed(6)}°</span>
          </div>
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Lon:</span>
            <span className="font-bold text-zinc-200 truncate">{position.lon.toFixed(6)}°</span>
          </div>
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Alt ({altitudeMode.toUpperCase()}):</span>
            <span className="font-bold text-emerald-400 truncate">{altFormatted.full}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
