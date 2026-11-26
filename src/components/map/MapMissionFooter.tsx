import React, { useEffect, useRef, useState } from 'react';

import { MapPinned, RefreshCw, RotateCcw, SkipForward, X } from 'lucide-react';

import { formatEta, useConfirmStep, useWaypointNavigation } from '../../lib/useWaypointNavigation';
import { followsPath } from '../../mavlink/guidedActions';
import { getMavCmdName } from '../../mavlink/messages';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';

/** One readout in a fixed-width slot, so changing numbers never resize the strip. */
const Stat: React.FC<{ label: string; value: string; width: string; tone: string; title?: string }> = ({
  label,
  value,
  width,
  tone,
  title,
}) => (
  <span className="flex shrink-0 items-baseline gap-1" title={title}>
    <span className="text-zinc-500">{label}</span>
    <b className={`${tone} inline-block whitespace-nowrap text-right tabular-nums`} style={{ minWidth: width }}>
      {value}
    </b>
  </span>
);

/**
 * Mission strip under the map: progress readouts in fixed-width slots (so the strip never changes size as the
 * numbers change), plus restart, jump-to-waypoint and next-waypoint controls.
 */
interface FooterProps {
  /** The mission is being downloaded from the vehicle. */
  isFetching: boolean;
  /** Download the mission from the vehicle (the Mission menu's Download). */
  onFetch: () => void;
}

export const MapMissionFooter: React.FC<FooterProps> = ({ isFetching, onFetch }) => {
  const nav = useWaypointNavigation();
  const navController = useTelemetryStore((s) => s.navController);
  const groundspeed = useTelemetryStore((s) => s.vfr.groundspeed);
  const modeName = useTelemetryStore((s) => s.heartbeat.modeName);
  const armed = useTelemetryStore((s) => s.heartbeat.isArmed);
  const missionState = useTelemetryStore((s) => s.missionState);
  const { formatDistance, formatCrosstrack, formatAltitude } = useUnitsStore();
  const [selected, setSelected] = useState<number>(nav.currentWaypointSeq || nav.minSeq);
  const selectRef = useRef<HTMLSelectElement>(null);
  const restartConfirm = useConfirmStep();

  // Follow the active waypoint unless the user is choosing one.
  useEffect(() => {
    if (document.activeElement !== selectRef.current) setSelected(nav.currentWaypointSeq || nav.minSeq);
  }, [nav.currentWaypointSeq, nav.minSeq]);

  if (!nav.connected) return null;
  // Shown whenever connected: without a downloaded mission it says so (and offers to download it) rather than
  // vanishing, and distance and cross-track still show on a guided target.
  const loaded = nav.userWpCount > 0;
  const noMission = missionState === 1; // MISSION_STATE_NO_MISSION

  // Distance and cross-track error mean something only while it follows a path (Auto, Guided, RTL...): "--" otherwise.
  // Not "wp_dist > 0": that's whole metres, so it read 0 in the last metre before each waypoint and blanked both just
  // as it got there.
  const hasTarget = followsPath(modeName, armed);
  const notFollowing = 'Shown while it follows a path (armed in Auto, Guided or RTL)';
  const dist = hasTarget ? formatDistance(navController.wpDist).full : '--';
  const xtrack = hasTarget ? formatCrosstrack(navController.xtrackError).full : '--';
  const eta = hasTarget ? formatEta(navController.wpDist, groundspeed) : '--';
  const xtrackWarn = hasTarget && Math.abs(navController.xtrackError) > 3;
  const controlsDisabled = !nav.connected || nav.isPending;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 font-mono text-[11px]">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Stat
          label="WP"
          value={loaded ? `${nav.currentWaypointSeq}/${nav.maxSeq}` : '--'}
          width="5ch"
          tone="text-amber-300"
        />
        <Stat
          label="Dist"
          value={dist}
          width="8ch"
          tone="text-sky-400"
          title={hasTarget ? 'Distance to the target waypoint' : notFollowing}
        />
        <Stat
          label="XTrk"
          value={xtrack}
          width="9ch"
          tone={xtrackWarn ? 'text-amber-400' : 'text-zinc-300'}
          title={hasTarget ? 'Cross-track error: how far it is off the line to the target' : notFollowing}
        />
        <Stat label="ETA" value={eta} width="7ch" tone="text-emerald-400" />
      </div>

      {!loaded ? (
        <div className="flex shrink-0 items-center gap-2 font-sans text-[11px] text-zinc-400">
          {isFetching ? (
            <span className="flex items-center gap-1.5 text-sky-300">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Downloading mission…
            </span>
          ) : noMission ? (
            <span title="The vehicle reports no mission (MISSION_CURRENT)">No mission on the vehicle</span>
          ) : (
            <>
              <span>Mission not downloaded</span>
              <button
                type="button"
                onClick={onFetch}
                className="flex h-7 items-center gap-1 rounded-md border border-zinc-800 px-2 font-semibold text-amber-300 hover:bg-zinc-800"
                title="Download the mission from the vehicle (as the Mission menu does)"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Download
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1 font-sans">
          {restartConfirm.armed ? (
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => {
                  restartConfirm.cancel();
                  void nav.navigateTo(nav.minSeq);
                }}
                className="flex h-7 animate-pulse items-center gap-1 rounded-md bg-amber-600 px-2 text-[11px] font-bold text-white hover:bg-amber-500 disabled:opacity-40"
                title={`Confirm: restart the mission from WP ${nav.minSeq}`}
                autoFocus
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restart to WP {nav.minSeq}?
              </button>
              <button
                type="button"
                onClick={restartConfirm.cancel}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                aria-label="Cancel restart"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={controlsDisabled || nav.currentWaypointSeq === nav.minSeq}
              onClick={restartConfirm.arm}
              className="flex h-7 items-center gap-1 rounded-md border border-zinc-800 px-2 text-[11px] font-semibold text-amber-300 hover:bg-zinc-800 disabled:opacity-40"
              title={`Restart the mission from WP ${nav.minSeq} (asks to confirm)`}
              aria-label="Restart mission"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Restart</span>
            </button>
          )}

          <select
            ref={selectRef}
            value={selected}
            onChange={(e) => setSelected(Number(e.target.value))}
            disabled={controlsDisabled}
            className="h-7 max-w-[11rem] rounded-md border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-[11px] text-zinc-200 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
            aria-label="Waypoint to fly to"
          >
            {nav.userWps.map((wp) => (
              <option key={wp.seq} value={wp.seq}>
                WP {wp.seq}: {getMavCmdName(wp.command).replace(/^(MAV_CMD_)?NAV_/, '')}
                {nav.showAltitude ? ` · ${formatAltitude(wp.alt).full}` : ''}
                {wp.seq === nav.currentWaypointSeq ? ' ★' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={controlsDisabled || selected === nav.currentWaypointSeq}
            onClick={() => void nav.navigateTo(selected)}
            className="flex h-7 items-center gap-1 rounded-md bg-sky-600 px-2 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-40"
            title={`Fly to WP ${selected} now`}
          >
            <MapPinned className="h-3 w-3" />
            Go
          </button>

          <button
            type="button"
            disabled={controlsDisabled || !nav.hasNext}
            onClick={() => void nav.navigateTo(nav.nextSeq)}
            className="flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
            title={nav.hasNext ? `Skip to the next waypoint (WP ${nav.nextSeq})` : 'Already at the last waypoint'}
            aria-label="Next waypoint"
          >
            <SkipForward className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Next</span>
          </button>
        </div>
      )}
    </div>
  );
};
