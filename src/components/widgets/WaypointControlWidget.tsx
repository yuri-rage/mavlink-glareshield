import React, { useState } from 'react';

import {
  AlertTriangle,
  Compass,
  Milestone,
  Navigation,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';

import { useAudioAlertsStore } from '../../lib/audioAlerts';
import { formatEta, useConfirmStep, useWaypointNavigation } from '../../lib/useWaypointNavigation';
import { mavlinkConnection } from '../../mavlink/connection';
import { getAutoModeNum, getMavCmdName } from '../../mavlink/messages';
import { missionManager } from '../../mavlink/missionManager';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useInPane } from '../dashboard/paneContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';

export const WaypointControlWidget: React.FC = () => {
  // In a Cockpit pane: the card fills it and its content scrolls under the pinned title.
  const inPane = useInPane();
  const {
    heartbeat,
    showAltitude,
    connected,
    currentWaypointSeq,
    userWps,
    userWpCount,
    activeWp,
    minSeq,
    nextSeq,
    prevSeq,
    hasNext,
    hasPrev,
    isPending,
    navigateTo,
  } = useWaypointNavigation();
  const navController = useTelemetryStore((s) => s.navController);
  const vfr = useTelemetryStore((s) => s.vfr);

  const { formatDistance, formatAltitude, formatCrosstrack } = useUnitsStore();
  const { waypointAnnounceEnabled, toggleWaypointAnnounce, soundEnabled, voiceEnabled } = useAudioAlertsStore();

  // The dropdown only picks a waypoint (null = follow the active one); Go sends the jump, after a confirm.
  const [pickedWp, setPickedWp] = useState<number | null>(null);
  const selectedWpInput = pickedWp ?? (currentWaypointSeq || 1);
  const goConfirm = useConfirmStep();
  const isAutoMode = heartbeat.modeName === 'AUTO';
  const restartConfirm = useConfirmStep();
  const etaFormatted = formatEta(navController.wpDist, vfr.groundspeed);

  const handleNavigateTo = async (targetSeq: number) => {
    setPickedWp(null);
    await navigateTo(targetSeq);
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
    <Card className="flex h-full flex-col overflow-hidden border-zinc-800 bg-zinc-950/90 shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-zinc-800 bg-zinc-900/60 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <Milestone className="h-4 w-4 shrink-0 text-amber-400" />
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-100">Waypoint Control</span>
        </div>

        <div className="flex items-center gap-1.5">
          {userWpCount > 0 ? (
            <Badge variant="warning" className="px-1.5 py-0.5 font-mono text-[10px]">
              WP {currentWaypointSeq} / {userWpCount}
            </Badge>
          ) : (
            <Badge variant="secondary" className="px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              No WPs
            </Badge>
          )}

          {connected && (
            <Badge
              variant={isAutoMode ? 'success' : 'outline'}
              className={`px-1.5 py-0.5 font-mono text-[10px] ${
                isAutoMode
                  ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300'
                  : 'border-amber-500/40 text-amber-300'
              }`}
            >
              {heartbeat.modeName}
            </Badge>
          )}

          <button
            type="button"
            onClick={toggleWaypointAnnounce}
            className={`flex h-6 w-6 items-center justify-center rounded border transition-colors ${
              waypointAnnounceEnabled && soundEnabled && voiceEnabled
                ? 'border-amber-500/50 bg-amber-950/40 text-amber-300'
                : 'border-zinc-800 bg-zinc-900 text-zinc-500 hover:text-zinc-300'
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

      <CardContent
        className={`flex min-h-0 flex-1 flex-col justify-between space-y-3 p-3 sm:p-3.5 ${inPane ? 'overflow-y-auto' : ''}`}
      >
        {userWpCount === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center space-y-2 rounded-lg border border-dashed border-zinc-800 p-4 text-center">
            <Milestone className="h-6 w-6 text-zinc-600" />
            <div className="text-xs font-medium text-zinc-400">No waypoints loaded on vehicle</div>
            <div className="text-[11px] text-zinc-500">
              Fetch mission items from vehicle or drop a .plan file onto the map.
            </div>
            {connected && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => missionManager.fetchMission()}
                className="mt-1 h-7 gap-1.5 border-zinc-700 text-xs font-semibold hover:bg-zinc-900"
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
                className="h-8 gap-1 border-zinc-800 text-xs font-bold hover:bg-zinc-900 disabled:opacity-40"
                title={`Step back to previous waypoint (WP ${prevSeq})`}
              >
                <SkipBack className="h-3.5 w-3.5 text-zinc-300" />
                <span className="hidden sm:inline">Prev</span> WP {hasPrev ? prevSeq : ''}
              </Button>

              {restartConfirm.armed ? (
                <Button
                  variant="default"
                  size="sm"
                  disabled={!connected || isPending}
                  onClick={() => {
                    restartConfirm.cancel();
                    void handleNavigateTo(minSeq);
                  }}
                  onBlur={restartConfirm.cancel}
                  className="h-8 animate-pulse gap-1 bg-amber-600 text-xs font-bold text-white hover:bg-amber-500"
                  title={`Confirm: restart the flight plan from WP ${minSeq}`}
                  autoFocus
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Confirm WP {minSeq}?</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!connected || currentWaypointSeq === minSeq || isPending}
                  onClick={restartConfirm.arm}
                  className="h-8 gap-1 border-zinc-800 text-xs font-bold text-amber-300 hover:bg-zinc-900 hover:text-amber-200 disabled:opacity-40"
                  title={`Restart flight plan from first mission waypoint (WP ${minSeq}); asks to confirm`}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
                  <span>WP {minSeq}</span>
                </Button>
              )}

              <Button
                variant="default"
                size="sm"
                disabled={!hasNext || isPending}
                onClick={() => handleNavigateTo(nextSeq)}
                className="h-8 gap-1.5 bg-emerald-600 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-40"
                title={`Advance to next waypoint (WP ${nextSeq})`}
              >
                <SkipForward className="h-4 w-4" />
                <span>Next</span> {hasNext ? `WP ${nextSeq}` : ''}
              </Button>
            </div>

            {/* Direct Jump to Chosen Waypoint Dropdown */}
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
                <span>Jump to Waypoint:</span>
                {activeWp && (
                  <span className="font-mono text-[10px] text-zinc-500">
                    Active: {getMavCmdName(activeWp.command).replace(/^(NAV_|MAV_CMD_NAV_)/, '')}
                  </span>
                )}
              </label>

              <div className="flex items-center gap-1.5">
                <select
                  value={selectedWpInput}
                  onChange={(e) => {
                    goConfirm.cancel();
                    const val = Number(e.target.value);
                    setPickedWp(val === currentWaypointSeq ? null : val);
                  }}
                  aria-label="Waypoint to jump to"
                  disabled={!connected || userWpCount === 0 || isPending}
                  className="flex-1 cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 font-mono text-xs text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
                >
                  {userWps.map((wp) => {
                    const cmdLabel = getMavCmdName(wp.command).replace(/^(NAV_|MAV_CMD_NAV_)/, '');
                    const isCurr = wp.seq === currentWaypointSeq;
                    return (
                      <option key={wp.seq} value={wp.seq}>
                        WP {wp.seq}: {cmdLabel}
                        {showAltitude ? ` (Alt ${formatAltitude(wp.alt).full})` : ''}
                        {isCurr ? ' ★ [ACTIVE]' : ''}
                      </option>
                    );
                  })}
                </select>

                {goConfirm.armed ? (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!connected || isPending}
                    onClick={() => {
                      goConfirm.cancel();
                      void handleNavigateTo(selectedWpInput);
                    }}
                    onBlur={goConfirm.cancel}
                    className="h-8 shrink-0 animate-pulse gap-1 bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-500"
                    title={`Confirm: fly directly to WP ${selectedWpInput}`}
                    autoFocus
                  >
                    <Navigation className="h-3 w-3" />
                    <span>Go to WP {selectedWpInput}?</span>
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={!connected || isPending || selectedWpInput === currentWaypointSeq}
                    onClick={goConfirm.arm}
                    className="h-8 shrink-0 gap-1 bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-40"
                    title={
                      selectedWpInput === currentWaypointSeq
                        ? 'Already the active waypoint'
                        : `Fly directly to WP ${selectedWpInput}; asks to confirm`
                    }
                  >
                    <Navigation className="h-3 w-3" />
                    <span>Go</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Live Waypoint Navigation Metrics Strip */}
            <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-2 font-mono text-xs @md:grid-cols-4 sm:text-[13px]">
              <div className="flex flex-col">
                <span className="font-sans text-[11px] text-zinc-500">Distance</span>
                <span className="font-bold text-sky-400">
                  {navController.wpDist > 0 ? formatDistance(navController.wpDist).full : '--'}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="flex items-center gap-0.5 font-sans text-[11px] text-zinc-500">
                  <Compass className="h-2.5 w-2.5" /> Bearing
                </span>
                <span className="font-bold text-zinc-200">
                  {navController.wpDist > 0 ? `${Math.round(navController.navBearing)}°` : '--'}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="font-sans text-[11px] text-zinc-500">X-Track</span>
                <span
                  className={
                    Math.abs(navController.xtrackError) > 3 ? 'font-bold text-amber-400' : 'font-medium text-zinc-300'
                  }
                >
                  {formatCrosstrack(navController.xtrackError).full}
                </span>
              </div>

              <div className="flex flex-col">
                <span className="font-sans text-[11px] text-zinc-500">ETA</span>
                <span className="font-bold text-emerald-400">{etaFormatted}</span>
              </div>
            </div>

            {/* AUTO mode notice banner if aircraft is armed in non-AUTO mode */}
            {connected && heartbeat.isArmed && !isAutoMode && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 p-2 text-xs text-amber-200">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <span className="truncate text-[11px]">
                    Vehicle in <b>{heartbeat.modeName}</b> mode. Switch to AUTO to track waypoints.
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSwitchToAuto}
                  className="h-6 shrink-0 border-amber-500/50 px-2 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20"
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
