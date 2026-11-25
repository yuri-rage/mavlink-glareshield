import React, { useEffect } from 'react';

import { Satellite } from 'lucide-react';

import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { messageRateManager } from '../../mavlink/rateManager';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useInPane } from '../dashboard/paneContext';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export const GpsWidget: React.FC = () => {
  // In a Cockpit pane: the card fills it and its content scrolls under the pinned title.
  const inPane = useInPane();
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

  const hasLink = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED';

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
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <CardTitle className="flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Satellite className="h-3.5 w-3.5 text-sky-400" />
            GNSS / GPS
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1">
            {!hasLink ? (
              <Badge variant="secondary" className="px-2 py-0.5 font-mono text-[10px]">
                NO LINK
              </Badge>
            ) : gps2 ? (
              <>
                <Badge
                  variant={getFixBadgeVariant(gps.fixType)}
                  className="whitespace-nowrap px-1.5 py-0.5 font-mono text-[10px]"
                >
                  G1: {gps.fixLabel}
                </Badge>
                <Badge
                  variant={getFixBadgeVariant(gps2.fixType)}
                  className="whitespace-nowrap px-1.5 py-0.5 font-mono text-[10px]"
                >
                  G2: {gps2.fixLabel}
                </Badge>
              </>
            ) : (
              <Badge variant={getFixBadgeVariant(gps.fixType)} className="px-2 py-0.5 font-mono text-[10px]">
                {gps.fixLabel}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={`flex min-h-0 flex-1 flex-col justify-between space-y-2.5 p-3 ${inPane ? 'overflow-y-auto' : ''}`}
      >
        {/* Metric stats grid: 2x2 grid prevents truncation at 1/3 card width */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
            <span className="shrink-0 text-[11px] font-bold uppercase text-zinc-400">Sats</span>
            <div className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-zinc-100 sm:text-base">
              {!hasLink ? '--' : gps2 ? `${gps.satellites} / ${gps2.satellites}` : gps.satellites}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
            <span className="shrink-0 text-[11px] font-bold uppercase text-zinc-400">HDOP</span>
            <div className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-zinc-100 sm:text-base">
              {hasLink && gps.hdop > 0 && gps.hdop < 90 ? gps.hdop.toFixed(2) : '--'}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
            <span className="shrink-0 text-[11px] font-bold uppercase text-zinc-400">Speed</span>
            <div className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-zinc-100 sm:text-base">
              {hasLink ? (
                <>
                  {spdFormatted.value}{' '}
                  <span className="text-[11px] font-normal text-zinc-400">{spdFormatted.unit}</span>
                </>
              ) : (
                '--'
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-1 rounded-xl border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5">
            <span className="shrink-0 text-[11px] font-bold uppercase text-zinc-400">
              {hasAnyYaw ? getYawLabel() : 'COG'}
            </span>
            <div
              className="ml-auto whitespace-nowrap font-mono text-sm font-bold text-zinc-100 sm:text-base"
              title={hasAnyYaw ? getYawDisplay() : `${gps.cog.toFixed(0)}°`}
            >
              {!hasLink ? '--' : hasAnyYaw ? getYawDisplay() : `${gps.cog.toFixed(0)}°`}
            </div>
          </div>
        </div>

        {/* Position coordinates readout */}
        <div className="space-y-1 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-2 font-mono text-xs sm:text-[13px]">
          <div className="flex items-center justify-between text-zinc-300">
            <span className="text-zinc-500">Lat:</span>
            <span className="truncate font-bold text-zinc-200">
              {hasLink && (position.lat !== 0 || position.lon !== 0) ? `${position.lat.toFixed(6)}°` : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span className="text-zinc-500">Lon:</span>
            <span className="truncate font-bold text-zinc-200">
              {hasLink && (position.lat !== 0 || position.lon !== 0) ? `${position.lon.toFixed(6)}°` : '--'}
            </span>
          </div>
          <div className="flex items-center justify-between text-zinc-300">
            <span className="text-zinc-500">Alt ({altitudeMode.toUpperCase()}):</span>
            <span className="truncate font-bold text-emerald-400">{hasLink ? altFormatted.full : '--'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
