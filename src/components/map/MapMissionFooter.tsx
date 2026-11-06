import React, { useEffect, useRef, useState } from 'react';
import { Navigation, RotateCcw, SkipForward, X } from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { getMavCmdName } from '../../mavlink/messages';
import { formatEta, useConfirmStep, useWaypointNavigation } from '../../lib/useWaypointNavigation';

/** One readout in a fixed-width slot, so changing numbers never resize the strip. */
const Stat: React.FC<{ label: string; value: string; width: string; tone: string }> = ({ label, value, width, tone }) => (
  <span className="flex items-baseline gap-1 shrink-0">
    <span className="text-zinc-500">{label}</span>
    <b className={`${tone} inline-block text-right tabular-nums whitespace-nowrap`} style={{ minWidth: width }}>
      {value}
    </b>
  </span>
);

/**
 * Mission strip under the map: progress readouts in fixed-width slots (so the strip never changes size as the
 * numbers change), plus restart, jump-to-waypoint and next-waypoint controls.
 */
export const MapMissionFooter: React.FC = () => {
  const nav = useWaypointNavigation();
  const navController = useTelemetryStore((s) => s.navController);
  const groundspeed = useTelemetryStore((s) => s.vfr.groundspeed);
  const { formatDistance, formatCrosstrack, formatAltitude } = useUnitsStore();
  const [selected, setSelected] = useState<number>(nav.currentWaypointSeq || nav.minSeq);
  const selectRef = useRef<HTMLSelectElement>(null);
  const restartConfirm = useConfirmStep();

  // Follow the active waypoint unless the user is choosing one.
  useEffect(() => {
    if (document.activeElement !== selectRef.current) setSelected(nav.currentWaypointSeq || nav.minSeq);
  }, [nav.currentWaypointSeq, nav.minSeq]);

  if (!nav.connected || nav.userWpCount === 0) return null;

  const hasTarget = navController.wpDist > 0;
  const dist = hasTarget ? formatDistance(navController.wpDist).full : '--';
  const xtrack = hasTarget ? formatCrosstrack(navController.xtrackError).full : '--';
  const eta = formatEta(navController.wpDist, groundspeed);
  const xtrackWarn = hasTarget && Math.abs(navController.xtrackError) > 3;
  const controlsDisabled = !nav.connected || nav.isPending;

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-[11px] font-mono">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap min-w-0">
        <Stat label="WP" value={`${nav.currentWaypointSeq}/${nav.maxSeq}`} width="5ch" tone="text-amber-300" />
        <Stat label="Dist" value={dist} width="8ch" tone="text-sky-400" />
        <Stat label="XTrk" value={xtrack} width="9ch" tone={xtrackWarn ? 'text-amber-400' : 'text-zinc-300'} />
        <Stat label="ETA" value={eta} width="7ch" tone="text-emerald-400" />
      </div>

      <div className="flex items-center gap-1 shrink-0 font-sans">
        {restartConfirm.armed ? (
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => {
                restartConfirm.cancel();
                void nav.navigateTo(nav.minSeq);
              }}
              className="h-7 px-2 rounded-md bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 flex items-center gap-1 text-[11px] font-bold animate-pulse"
              title={`Confirm: restart the mission from WP ${nav.minSeq}`}
              autoFocus
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart to WP {nav.minSeq}?
            </button>
            <button
              type="button"
              onClick={restartConfirm.cancel}
              className="h-7 w-7 rounded-md border border-zinc-800 text-zinc-400 hover:text-zinc-200 flex items-center justify-center"
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
            className="h-7 px-2 rounded-md border border-zinc-800 text-amber-300 hover:bg-zinc-800 disabled:opacity-40 flex items-center gap-1 text-[11px] font-semibold"
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
          className="h-7 max-w-[11rem] bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-md px-1.5 text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
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
          className="h-7 px-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 flex items-center gap-1 text-[11px] font-bold"
          title={`Fly to WP ${selected} now`}
        >
          <Navigation className="h-3 w-3" />
          Go
        </button>

        <button
          type="button"
          disabled={controlsDisabled || !nav.hasNext}
          onClick={() => void nav.navigateTo(nav.nextSeq)}
          className="h-7 px-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 flex items-center gap-1 text-[11px] font-bold"
          title={nav.hasNext ? `Skip to the next waypoint (WP ${nav.nextSeq})` : 'Already at the last waypoint'}
          aria-label="Next waypoint"
        >
          <SkipForward className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Next</span>
        </button>
      </div>
    </div>
  );
};
