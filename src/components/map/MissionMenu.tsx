// The map header's mission menu: download the mission, fence and rally points from the vehicle, open a file to
// upload, and save what the map shows to files.

import React, { useRef } from 'react';

import {
  Download,
  Earth,
  FileJson,
  Flag,
  FolderOpen,
  Hexagon,
  PencilRuler,
  RefreshCw,
  Route,
  Shield,
  X,
} from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { fenceDraftToPoints } from '../../mavlink/fenceDraft';
import { normalFrame, type MissionDraft } from '../../mavlink/missionDraft';
import { polyPointCount, toKml, toMpPoly } from '../../mavlink/missionExport';
import {
  fenceToItems,
  missionFileStem,
  rallyToItems,
  toQgcPlan,
  toQgcWpl,
  waypointsToItems,
} from '../../mavlink/missionFileWriter';
import { rallyDraftToPoints } from '../../mavlink/rallyDraft';
import { askConfirm } from '../../store/confirmStore';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import type { MissionWaypoint } from '../../store/telemetryStore';
import { HeaderMenu, MenuItem, MenuSection } from './HeaderMenu';

/** The draft as mission waypoints, for the file writers. */
function draftWaypoints(draft: MissionDraft): MissionWaypoint[] {
  return draft.items.map((it, seq) => ({
    seq,
    command: it.command,
    lat: it.x,
    lon: it.y,
    alt: it.z,
    current: false,
    frame: it.frame,
    param1: it.param1,
    param2: it.param2,
    param3: it.param3,
    param4: it.param4,
    autocontinue: it.autocontinue,
  }));
}

interface MissionMenuProps {
  connected: boolean;
  isFetching: boolean;
  isUploading: boolean;
  onFetch: () => void;
  onCancelFetch: () => void;
  /** A file the person picked to upload; it goes through the same preview as a dropped file. */
  onOpenFile: (file: File) => void;
  /** Planning mode is on: opened files go into the draft instead of being uploaded. */
  planning: boolean;
  onTogglePlanning: () => void;
}

/** File types the upload preview (and the planning drafts) understand. */
export const OPEN_ACCEPT = '.plan,.waypoints,.txt,.fence,.rally,.dat,.json';

const saveText = (filename: string, text: string, type: string) => downloadFile(filename, text, type);

export const MissionMenu: React.FC<MissionMenuProps> = ({
  connected,
  isFetching,
  isUploading,
  onFetch,
  onCancelFetch,
  onOpenFile,
  planning,
  onTogglePlanning,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);

  // While planning, saving writes the draft (what the map is editing), not the vehicle's mission.
  const vehicleWaypoints = useTelemetryStore((s) => s.missionWaypoints);
  const draft = useMissionPlanStore((s) => (s.active ? s.history.present : null));
  const waypoints = draft ? draftWaypoints(draft) : vehicleWaypoints;
  const vehicleFence = useTelemetryStore((s) => s.fencePoints);
  const fenceDraft = useMissionPlanStore((s) => (s.active ? s.fence.history.present : null));
  const fencePoints = fenceDraft ? fenceDraftToPoints(fenceDraft) : vehicleFence;
  const vehicleRally = useTelemetryStore((s) => s.rallyPoints);
  const rallyDraft = useMissionPlanStore((s) => (s.active ? s.rally.history.present : null));
  const rallyPoints = rallyDraft ? rallyDraftToPoints(rallyDraft) : vehicleRally;

  // Home (seq 0) is not counted as a waypoint, as in the header badge.
  const wpCount = Math.max(0, waypoints.length - 1);
  const busy = isFetching || isUploading;

  const stem = () => `${missionFileStem(useTelemetryStore.getState().heartbeat.systemId)}${draft ? '-draft' : ''}`;

  const savePlan = async () => {
    // A QGC .plan stores rally points as [lat, lon, alt] with no frame: loaded back, every one is relative to home.
    // Say so before saving one that isn't; the .waypoints export keeps the frame.
    const notRelative = rallyPoints.filter((r) => normalFrame(r.frame ?? 3) !== 3).map((r) => `R${r.seq + 1}`);
    if (
      notRelative.length > 0 &&
      !(await askConfirm({
        title: 'Save the .plan?',
        message: [
          `A .plan file stores rally altitudes relative to home only. ${notRelative.join(', ')} ${
            notRelative.length === 1 ? 'uses' : 'use'
          } another altitude frame and would come back relative to home.`,
          'Rally points (.waypoints) keeps the frame.',
        ],
        confirmLabel: 'Save .plan anyway',
      }))
    ) {
      return;
    }
    const s = useTelemetryStore.getState();
    const home = s.homePosition.source !== 'none' ? s.homePosition : null;
    const text = toQgcPlan({ waypoints, fencePoints, rallyPoints, home, vehicleType: s.heartbeat.type });
    saveText(`${stem()}.plan`, text, 'application/json');
  };
  const saveWaypoints = () => saveText(`${stem()}.waypoints`, toQgcWpl(waypointsToItems(waypoints)), 'text/plain');
  const saveFence = () => saveText(`${stem()}-fence.waypoints`, toQgcWpl(fenceToItems(fencePoints)), 'text/plain');
  const saveRally = () => saveText(`${stem()}-rally.waypoints`, toQgcWpl(rallyToItems(rallyPoints)), 'text/plain');
  const saveKml = () => {
    const s = useTelemetryStore.getState();
    const home = s.homePosition.source !== 'none' ? s.homePosition : null;
    const name = stem();
    saveText(
      `${name}.kml`,
      toKml({ waypoints, fencePoints, rallyPoints, home, name }),
      'application/vnd.google-earth.kml+xml'
    );
  };
  const savePoly = () => saveText(`${stem()}.poly`, toMpPoly(waypoints), 'text/plain');
  const polyPoints = polyPointCount(waypoints);

  const nothingToSave = waypoints.length === 0 && fencePoints.length === 0 && rallyPoints.length === 0;

  return (
    <HeaderMenu
      icon={
        busy ? (
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-400" />
        ) : (
          <Route className="h-3.5 w-3.5 text-amber-400" />
        )
      }
      label="Mission"
      title="Mission: download from the vehicle, upload a file, save to files"
      extra={
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
      }
    >
      {(close) => {
        const run = (fn: () => void) => () => {
          close();
          fn();
        };
        return (
          <>
            <MenuSection label="Vehicle" first />
            {isFetching ? (
              <MenuItem
                icon={<X className="h-3.5 w-3.5" />}
                label="Cancel download"
                danger
                onClick={run(onCancelFetch)}
              />
            ) : (
              <MenuItem
                icon={<RefreshCw className="h-3.5 w-3.5 text-amber-400" />}
                label="Download from vehicle"
                detail={connected ? undefined : 'offline'}
                disabled={!connected || isUploading}
                onClick={run(onFetch)}
              />
            )}
            {planning ? (
              <MenuItem
                icon={<FolderOpen className="h-3.5 w-3.5 text-sky-400" />}
                label="Open file into draft…"
                onClick={run(() => fileRef.current?.click())}
              />
            ) : (
              <MenuItem
                icon={<FolderOpen className="h-3.5 w-3.5 text-sky-400" />}
                label="Upload from file…"
                detail={connected ? undefined : 'offline'}
                disabled={!connected || busy}
                onClick={run(() => fileRef.current?.click())}
              />
            )}

            <MenuSection label="Plan" />
            <MenuItem
              icon={<PencilRuler className="h-3.5 w-3.5 text-amber-400" />}
              label={planning ? 'Stop editing' : 'Edit mission on map'}
              onClick={run(onTogglePlanning)}
            />

            <MenuSection label="Save to file" />
            <MenuItem
              icon={<FileJson className="h-3.5 w-3.5 text-emerald-400" />}
              label="Everything (.plan)"
              detail="QGC"
              disabled={nothingToSave}
              onClick={run(savePlan)}
            />
            <MenuItem
              icon={<Download className="h-3.5 w-3.5 text-amber-400" />}
              label={planning ? 'Draft waypoints (.waypoints)' : 'Waypoints (.waypoints)'}
              detail={String(wpCount)}
              disabled={waypoints.length === 0}
              onClick={run(saveWaypoints)}
            />
            <MenuItem
              icon={<Shield className="h-3.5 w-3.5 text-red-400" />}
              label={planning ? 'Draft geofence (.waypoints)' : 'Geofence (.waypoints)'}
              detail={String(fencePoints.length)}
              disabled={fencePoints.length === 0}
              onClick={run(saveFence)}
            />
            <MenuItem
              icon={<Flag className="h-3.5 w-3.5 text-[#f0abfc]" />}
              label={planning ? 'Draft rally points (.waypoints)' : 'Rally points (.waypoints)'}
              detail={String(rallyPoints.length)}
              disabled={rallyPoints.length === 0}
              onClick={run(saveRally)}
            />
            <div className="px-2.5 pb-1 pt-1 text-[10px] leading-snug text-zinc-500">
              {planning ? 'Saves the drafts (mission, rally points and fence). ' : 'Saves what the map shows. '}
              Files open in QGroundControl and Mission Planner, and can be dropped back on the map.
            </div>

            <MenuSection label="Export" />
            <MenuItem
              icon={<Earth className="h-3.5 w-3.5 text-sky-400" />}
              label="Map view (.kml)"
              detail="Google Earth"
              disabled={nothingToSave}
              onClick={run(saveKml)}
            />
            <MenuItem
              icon={<Hexagon className="h-3.5 w-3.5 text-amber-400" />}
              label="Polygon (.poly)"
              detail={String(polyPoints)}
              disabled={polyPoints < 3}
              onClick={run(savePoly)}
            />
            <div className="px-2.5 pb-1 pt-1 text-[10px] leading-snug text-zinc-500">
              For other tools: KML (route, waypoints, fence and rally points) for Google Earth or QGIS; the polygon for
              Mission Planner&apos;s survey and fence tools. Not loaded back here.
            </div>
          </>
        );
      }}
    </HeaderMenu>
  );
};
