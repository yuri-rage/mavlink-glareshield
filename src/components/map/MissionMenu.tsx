// The map header's mission menu: download the mission, fence and rally points from the vehicle, open a file to
// upload, and save what the map shows to files.

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FileJson, Flag, FolderOpen, RefreshCw, Route, Shield, X } from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { missionFileStem, toQgcPlan, toQgcWpl, waypointsToItems, fenceToItems, rallyToItems } from '../../mavlink/missionFileWriter';
import { cn } from '../../lib/utils';

interface MissionMenuProps {
  connected: boolean;
  isFetching: boolean;
  isUploading: boolean;
  onFetch: () => void;
  onCancelFetch: () => void;
  /** A file the person picked to upload; it goes through the same preview as a dropped file. */
  onOpenFile: (file: File) => void;
}

/** File types the upload preview understands. */
const OPEN_ACCEPT = '.plan,.waypoints,.txt,.fence,.rally,.dat,.json';

function saveText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  detail?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}> = ({ icon, label, detail, disabled, danger, onClick }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left text-[12px] transition-colors',
      'disabled:opacity-40 disabled:cursor-not-allowed',
      danger ? 'text-red-300 hover:bg-red-500/15' : 'text-zinc-200 hover:bg-zinc-800 disabled:hover:bg-transparent'
    )}
  >
    <span className="shrink-0 w-4 flex justify-center">{icon}</span>
    <span className="flex-1 min-w-0 truncate">{label}</span>
    {detail && <span className="shrink-0 text-[10px] font-mono text-zinc-500">{detail}</span>}
  </button>
);

export const MissionMenu: React.FC<MissionMenuProps> = ({ connected, isFetching, isUploading, onFetch, onCancelFetch, onOpenFile }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const waypoints = useTelemetryStore((s) => s.missionWaypoints);
  const fencePoints = useTelemetryStore((s) => s.fencePoints);
  const rallyPoints = useTelemetryStore((s) => s.rallyPoints);

  // Home (seq 0) is not counted as a waypoint, as in the header badge.
  const wpCount = Math.max(0, waypoints.length - 1);
  const busy = isFetching || isUploading;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const stem = () => missionFileStem(useTelemetryStore.getState().heartbeat.systemId);

  const savePlan = () => {
    const s = useTelemetryStore.getState();
    const home = s.homePosition.source !== 'none' ? s.homePosition : null;
    const text = toQgcPlan({ waypoints, fencePoints, rallyPoints, home, vehicleType: s.heartbeat.type });
    saveText(`${stem()}.plan`, text, 'application/json');
  };
  const saveWaypoints = () => saveText(`${stem()}.waypoints`, toQgcWpl(waypointsToItems(waypoints)), 'text/plain');
  const saveFence = () => saveText(`${stem()}-fence.waypoints`, toQgcWpl(fenceToItems(fencePoints)), 'text/plain');
  const saveRally = () => saveText(`${stem()}-rally.waypoints`, toQgcWpl(rallyToItems(rallyPoints)), 'text/plain');

  const nothingToSave = waypoints.length === 0 && fencePoints.length === 0 && rallyPoints.length === 0;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-7 px-2 inline-flex items-center gap-1 rounded-md border text-xs font-bold transition-colors',
          open ? 'bg-zinc-800 border-zinc-600 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white'
        )}
        title="Mission: download from the vehicle, open a file, save to files"
      >
        {busy ? <RefreshCw className="h-3.5 w-3.5 text-amber-400 animate-spin" /> : <Route className="h-3.5 w-3.5 text-amber-400" />}
        <span className="hidden xl:inline text-[11px]">Mission</span>
        <ChevronDown className={cn('h-3 w-3 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>

      <input
        ref={fileRef}
        type="file"
        accept={OPEN_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onOpenFile(file);
        }}
      />

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-[1100] w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl p-1 font-sans normal-case tracking-normal"
        >
          <div className="px-2.5 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Vehicle</div>
          {isFetching ? (
            <MenuItem icon={<X className="h-3.5 w-3.5" />} label="Cancel download" danger onClick={run(onCancelFetch)} />
          ) : (
            <MenuItem
              icon={<RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
              label="Download from vehicle"
              detail={connected ? undefined : 'offline'}
              disabled={!connected || isUploading}
              onClick={run(onFetch)}
            />
          )}
          <MenuItem
            icon={<FolderOpen className="h-3.5 w-3.5 text-sky-400" />}
            label="Upload from file…"
            detail={connected ? undefined : 'offline'}
            disabled={!connected || busy}
            onClick={run(() => fileRef.current?.click())}
          />

          <div className="my-1 border-t border-zinc-800" />
          <div className="px-2.5 pt-0.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Save to file</div>
          <MenuItem
            icon={<FileJson className="h-3.5 w-3.5 text-emerald-400" />}
            label="Everything (.plan)"
            detail="QGC"
            disabled={nothingToSave}
            onClick={run(savePlan)}
          />
          <MenuItem
            icon={<Download className="h-3.5 w-3.5 text-amber-400" />}
            label="Waypoints (.waypoints)"
            detail={String(wpCount)}
            disabled={waypoints.length === 0}
            onClick={run(saveWaypoints)}
          />
          <MenuItem
            icon={<Shield className="h-3.5 w-3.5 text-red-400" />}
            label="Geofence (.waypoints)"
            detail={String(fencePoints.length)}
            disabled={fencePoints.length === 0}
            onClick={run(saveFence)}
          />
          <MenuItem
            icon={<Flag className="h-3.5 w-3.5 text-[#f0abfc]" />}
            label="Rally points (.waypoints)"
            detail={String(rallyPoints.length)}
            disabled={rallyPoints.length === 0}
            onClick={run(saveRally)}
          />
          <div className="px-2.5 pt-1 pb-1 text-[10px] text-zinc-500 leading-snug">
            Saves what the map shows. Files open in QGroundControl and Mission Planner, and can be dropped back on the map.
          </div>
        </div>
      )}
    </div>
  );
};
