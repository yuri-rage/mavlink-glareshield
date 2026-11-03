import React, { useState } from 'react';
import { useTelemetryStore, setMissionCurrentWaypoint, sendTrackedCommand } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useAudioAlertsStore } from '../../lib/audioAlerts';
import { missionManager } from '../../mavlink/missionManager';
import { mavlinkConnection } from '../../mavlink/connection';
import { getMavCmdName, getAutoModeNum } from '../../mavlink/messages';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Milestone,
  SkipForward,
  SkipBack,
  RotateCcw,
  Navigation,
  RefreshCw,
  Compass,
  AlertTriangle,
  Volume2,
  VolumeX,
} from 'lucide-react';

export const WaypointControlWidget: React.FC = () => {
  const heartbeat = useTelemetryStore((s) => s.heartbeat);
  const connected = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED';
  const missionWaypoints = useTelemetryStore((s) => s.missionWaypoints);
  const currentWaypointSeq = useTelemetryStore((s) => s.currentWaypointSeq);
  const navController = useTelemetryStore((s) => s.navController);
  const vfr = useTelemetryStore((s) => s.vfr);

  const { formatDistance, formatAltitude, formatCrosstrack } = useUnitsStore();
  const {
    waypointAnnounceEnabled,
    toggleWaypointAnnounce,
    soundEnabled,
    voiceEnabled,
  } = useAudioAlertsStore();

  const [isPending, setIsPending] = useState(false);
  const [selectedWpInput, setSelectedWpInput] = useState<number>(() => currentWaypointSeq || 1);

  // User waypoints exclude WP0 (Home position)
  const userWps = missionWaypoints.filter((w) => w.seq > 0);
  const userWpCount = userWps.length;
  const activeWp = missionWaypoints.find((w) => w.seq === currentWaypointSeq);

  const maxSeq = userWpCount > 0 ? Math.max(...userWps.map((w) => w.seq)) : 0;
  const minSeq = userWpCount > 0 ? Math.min(...userWps.map((w) => w.seq)) : 1;

  const nextSeq = Math.min(maxSeq, (currentWaypointSeq || 0) + 1);
  const prevSeq = Math.max(minSeq, (currentWaypointSeq || 1) - 1);

  const hasNext = connected && userWpCount > 0 && currentWaypointSeq < maxSeq;
  const hasPrev = connected && userWpCount > 0 && currentWaypointSeq > minSeq;
  const isAutoMode = heartbeat.modeName === 'AUTO';

  // Format ETA to active waypoint
  const etaFormatted = (() => {
    if (navController.wpDist <= 0 || vfr.groundspeed <= 0.5) return '--';
    const totalSecs = Math.round(navController.wpDist / vfr.groundspeed);
    if (totalSecs >= 3600) {
      const hrs = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      return `${hrs}h ${mins}m`;
    }
    if (totalSecs >= 60) {
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    }
    return `${totalSecs}s`;
  })();

  const handleNavigateTo = async (targetSeq: number) => {
    if (!connected || targetSeq <= 0 || isPending) return;
    setIsPending(true);
    setSelectedWpInput(targetSeq);
    try {
      await setMissionCurrentWaypoint(targetSeq);
    } finally {
      setTimeout(() => setIsPending(false), 500);
    }
  };

  const handleSwitchToAuto = async () => {
    if (!connected) return;
    const sysId = heartbeat.systemId > 0 ? heartbeat.systemId : 1;
    const compId = heartbeat.componentId > 0 ? heartbeat.componentId : 1;
    const autoModeNum = getAutoModeNum(heartbeat.type);
    const encoder = mavlinkConnection.getEncoder();
    const cmd = encoder.createSetMode(sysId, compId, autoModeNum);
    void sendTrackedCommand(cmd, {
      label: 'Switch to AUTO Mode',
      targetKey: 'mode-auto',
    });
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-lg flex flex-col h-full overflow-hidden">
      <CardHeader className="py-2 px-3.5 bg-zinc-900/60 border-b border-zinc-800 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Milestone className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="font-semibold text-xs tracking-wide text-zinc-100 uppercase">
            Waypoint Control
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {userWpCount > 0 ? (
            <Badge variant="warning" className="text-[10px] font-mono px-1.5 py-0.5">
              WP {currentWaypointSeq} / {userWpCount}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0.5 text-zinc-400">
              No WPs
            </Badge>
          )}

          {connected && (
            <Badge
              variant={isAutoMode ? 'success' : 'outline'}
              className={`text-[10px] font-mono px-1.5 py-0.5 ${
                isAutoMode
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                  : 'text-amber-300 border-amber-500/40'
              }`}
            >
              {heartbeat.modeName}
            </Badge>
          )}

          <button
            type="button"
            onClick={toggleWaypointAnnounce}
            className={`h-6 w-6 rounded flex items-center justify-center transition-colors border ${
              waypointAnnounceEnabled && soundEnabled && voiceEnabled
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-300'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title={
              waypointAnnounceEnabled && soundEnabled && voiceEnabled
                ? 'Verbal waypoint arrival announcements enabled ("Waypoint n"). Click to mute.'
                : 'Verbal waypoint arrival announcements muted. Click to enable.'
            }
          >
            {waypointAnnounceEnabled && soundEnabled && voiceEnabled ? (
              <Volume2 className="h-3 w-3 text-amber-400" />
            ) : (
              <VolumeX className="h-3 w-3 text-zinc-500" />
            )}
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-3.5 space-y-3 flex-1 flex flex-col justify-between">
        {userWpCount === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border border-dashed border-zinc-800 rounded-lg space-y-2">
            <Milestone className="h-6 w-6 text-zinc-600" />
            <div className="text-xs text-zinc-400 font-medium">No waypoints loaded on vehicle</div>
            <div className="text-[11px] text-zinc-500">
              Fetch mission items from vehicle or drop a .plan file onto the map.
            </div>
            {connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => missionManager.fetchMission()}
                className="mt-1 h-7 text-xs font-semibold gap-1.5 border-zinc-700 hover:bg-zinc-900"
              >
                <RefreshCw className="h-3 w-3 text-amber-400" />
                Fetch Waypoints
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Primary Step / Advance Controls */}
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasPrev || isPending}
                onClick={() => handleNavigateTo(prevSeq)}
                className="h-8 text-xs font-bold gap-1 border-zinc-800 hover:bg-zinc-900 disabled:opacity-40"
                title={`Step back to previous waypoint (WP ${prevSeq})`}
              >
                <SkipBack className="h-3.5 w-3.5 text-zinc-300" />
                <span className="hidden sm:inline">Prev</span> WP {hasPrev ? prevSeq : ''}
              </Button>

              <Button
                variant="outline"
                size="sm"
                disabled={!connected || currentWaypointSeq === minSeq || isPending}
                onClick={() => handleNavigateTo(minSeq)}
                className="h-8 text-xs font-bold gap-1 border-zinc-800 hover:bg-zinc-900 text-amber-300 hover:text-amber-200 disabled:opacity-40"
                title={`Restart flight plan from first mission waypoint (WP ${minSeq})`}
              >
                <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                <span>WP {minSeq}</span>
              </Button>

              <Button
                variant="default"
                size="sm"
                disabled={!hasNext || isPending}
                onClick={() => handleNavigateTo(nextSeq)}
                className="h-8 text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 shadow-sm"
                title={`Advance to next waypoint (WP ${nextSeq})`}
              >
                <SkipForward className="h-4 w-4" />
                <span>Next</span> {hasNext ? `WP ${nextSeq}` : ''}
              </Button>
            </div>

            {/* Direct Jump to Chosen Waypoint Dropdown */}
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-zinc-400 flex items-center justify-between">
                <span>Navigate Immediately to Waypoint:</span>
                {activeWp && (
                  <span className="text-[10px] font-mono text-zinc-500">
                    Active: {getMavCmdName(activeWp.command).replace(/^(NAV_|MAV_CMD_NAV_)/, '')}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-1.5">
                <select
                  value={currentWaypointSeq || selectedWpInput}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setSelectedWpInput(val);
                    void handleNavigateTo(val);
                  }}
                  disabled={!connected || userWpCount === 0 || isPending}
                  className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-md px-2.5 py-1.5 text-xs font-mono flex-1 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50 cursor-pointer"
                >
                  {userWps.map((wp) => {
                    const cmdLabel = getMavCmdName(wp.command).replace(/^(NAV_|MAV_CMD_NAV_)/, '');
                    const isCurr = wp.seq === currentWaypointSeq;
                    return (
                      <option key={wp.seq} value={wp.seq}>
                        WP {wp.seq}: {cmdLabel} (Alt {formatAltitude(wp.alt).full})
                        {isCurr ? ' ★ [ACTIVE]' : ''}
                      </option>
                    );
                  })}
                </select>

                <Button
                  variant="default"
                  size="sm"
                  disabled={!connected || isPending}
                  onClick={() => handleNavigateTo(selectedWpInput)}
                  className="h-8 px-3 text-xs font-bold gap-1 bg-sky-600 hover:bg-sky-500 text-white shrink-0"
                  title="Command autopilot to fly directly to chosen waypoint"
                >
                  <Navigation className="h-3 w-3" />
                  <span>Go</span>
                </Button>
              </div>
            </div>

            {/* Live Waypoint Navigation Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 bg-zinc-900/70 border border-zinc-800/80 rounded-lg p-2 text-xs font-mono">
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 font-sans">Distance</span>
                <span className="text-sky-400 font-bold">
                  {navController.wpDist > 0 ? formatDistance(navController.wpDist).full : '--'}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 font-sans flex items-center gap-0.5">
                  <Compass className="h-2.5 w-2.5" /> Bearing
                </span>
                <span className="text-zinc-200 font-bold">
                  {navController.wpDist > 0 ? `${Math.round(navController.navBearing)}°` : '--'}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 font-sans">X-Track</span>
                <span
                  className={
                    Math.abs(navController.xtrackError) > 3
                      ? 'text-amber-400 font-bold'
                      : 'text-zinc-300 font-medium'
                  }
                >
                  {formatCrosstrack(navController.xtrackError).full}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 font-sans">ETA</span>
                <span className="text-emerald-400 font-bold">{etaFormatted}</span>
              </div>
            </div>

            {/* AUTO mode notice banner if aircraft is armed in non-AUTO mode */}
            {connected && heartbeat.isArmed && !isAutoMode && (
              <div className="p-2 rounded-lg bg-amber-950/40 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <span className="truncate text-[11px]">
                    Vehicle in <b>{heartbeat.modeName}</b> mode. Switch to AUTO to track waypoints.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSwitchToAuto}
                  className="h-6 px-2 text-[10px] font-bold text-amber-300 border-amber-500/50 hover:bg-amber-500/20 shrink-0"
                >
                  Set AUTO
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
