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
  const gps2 = useTelemetryStore((state) => state.gps2);
  const position = useTelemetryStore((state) => state.position);
  const heartbeat = useTelemetryStore((state) => state.heartbeat);
  const { formatSpeed, formatAltitude, altitudeMode } = useUnitsStore();

  useEffect(() => {
    messageRateManager.registerRequirement('gps-raw', MAVLINK_MSG_ID.GPS_RAW_INT);
    messageRateManager.registerRequirement('gps2-raw', MAVLINK_MSG_ID.GPS2_RAW);
    messageRateManager.registerRequirement('gps-pos', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
    return () => {
      messageRateManager.unregisterRequirement('gps-raw');
      messageRateManager.unregisterRequirement('gps2-raw');
      messageRateManager.unregisterRequirement('gps-pos');
    };
  }, []);

  const hasLink =
    heartbeat.lastHeartbeatTime > 0 &&
    heartbeat.modeName !== 'DISCONNECTED';

  const getFixBadgeVariant = (fix: number) => {
    if (!hasLink) return 'secondary';
    if (fix >= 4) return 'success'; // DGPS / RTK
    if (fix === 3) return 'info'; // 3D Fix
    if (fix === 2) return 'warning'; // 2D Fix
    return 'destructive'; // No Fix
  };

  const spdFormatted = formatSpeed(gps.groundspeed);
  const rawAlt = altitudeMode === 'msl' ? position.alt : position.relativeAlt;
  const altFormatted = formatAltitude(rawAlt);

  const hasAnyYaw = Boolean(gps.hasYaw || gps2?.hasYaw);

  const getYawDisplay = () => {
    if (!hasLink) return '--';
    if (gps.hasYaw && gps2?.hasYaw) {
      const y1 = gps.yaw !== undefined ? `${gps.yaw.toFixed(0)}°` : '--';
      const y2 = gps2.yaw !== undefined ? `${gps2.yaw.toFixed(0)}°` : '--';
      return `${y1} / ${y2}`;
    }
    if (gps2?.hasYaw) {
      return gps2.yaw !== undefined ? `${gps2.yaw.toFixed(0)}°` : '--';
    }
    if (gps.hasYaw) {
      return gps.yaw !== undefined ? `${gps.yaw.toFixed(0)}°` : '--';
    }
    return '--';
  };

  const getYawLabel = () => {
    if (gps.hasYaw && gps2?.hasYaw) return 'G1 / G2 Yaw';
    if (gps2?.hasYaw) return 'GPS2 Yaw';
    return 'GPS Yaw';
  };

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-1 flex-wrap">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 shrink-0">
            <Satellite className="h-3.5 w-3.5 text-sky-400" />
            GNSS / GPS
          </CardTitle>
          <div className="flex items-center gap-1 flex-wrap">
            {!hasLink ? (
              <Badge variant="secondary" className="font-mono text-[10px] px-2 py-0.5">
                NO LINK
              </Badge>
            ) : gps2 ? (
              <>
                <Badge variant={getFixBadgeVariant(gps.fixType)} className="font-mono text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                  G1: {gps.fixLabel}
                </Badge>
                <Badge variant={getFixBadgeVariant(gps2.fixType)} className="font-mono text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                  G2: {gps2.fixLabel}
                </Badge>
              </>
            ) : (
              <Badge variant={getFixBadgeVariant(gps.fixType)} className="font-mono text-[10px] px-2 py-0.5">
                {gps.fixLabel}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
        {/* Metric stats grid: 2x2 grid prevents truncation at 1/3 card width */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase shrink-0">Sats</span>
            <div className="text-sm sm:text-base font-mono font-bold text-zinc-100 whitespace-nowrap">
              {!hasLink ? '--' : gps2 ? `${gps.satellites} / ${gps2.satellites}` : gps.satellites}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase shrink-0">HDOP</span>
            <div className="text-sm sm:text-base font-mono font-bold text-zinc-100 whitespace-nowrap">
              {hasLink && gps.hdop > 0 && gps.hdop < 90 ? gps.hdop.toFixed(2) : '--'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase shrink-0">Speed</span>
            <div className="text-sm sm:text-base font-mono font-bold text-zinc-100 whitespace-nowrap">
              {hasLink ? (
                <>
                  {spdFormatted.value}{' '}
                  <span className="text-[10px] text-zinc-400 font-normal">{spdFormatted.unit}</span>
                </>
              ) : (
                '--'
              )}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-1 min-w-0">
            <span className="text-[10px] text-zinc-400 font-bold uppercase shrink-0">
              {hasAnyYaw ? getYawLabel() : 'COG'}
            </span>
            <div
              className="text-sm sm:text-base font-mono font-bold text-sky-400 whitespace-nowrap"
              title={hasAnyYaw ? getYawDisplay() : `${gps.cog.toFixed(0)}°`}
            >
              {!hasLink
                ? '--'
                : hasAnyYaw
                  ? getYawDisplay()
                  : `${gps.cog.toFixed(0)}°`}
            </div>
          </div>
        </div>

        {/* Position coordinates readout */}
        <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-2 space-y-1 font-mono text-xs">
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Lat:</span>
            <span className="font-bold text-zinc-200 truncate">
              {hasLink && (position.lat !== 0 || position.lon !== 0)
                ? `${position.lat.toFixed(6)}°`
                : '--'}
            </span>
          </div>
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Lon:</span>
            <span className="font-bold text-zinc-200 truncate">
              {hasLink && (position.lat !== 0 || position.lon !== 0)
                ? `${position.lon.toFixed(6)}°`
                : '--'}
            </span>
          </div>
          <div className="flex justify-between items-center text-zinc-300">
            <span className="text-zinc-500">Alt ({altitudeMode.toUpperCase()}):</span>
            <span className="font-bold text-emerald-400 truncate">
              {hasLink ? altFormatted.full : '--'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
