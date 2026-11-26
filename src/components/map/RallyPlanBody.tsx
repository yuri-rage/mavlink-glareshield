// The planning editor's rally view: the rally draft's points, the selected point's fields, and the rally draft's
// own actions (upload, save to file, reset). Points are added on the map (Place, or right-click).

import React, { useEffect, useRef } from 'react';

import { AlertTriangle, Download, FolderOpen, RotateCcw, Trash2, Upload, XCircle } from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { useLengthUnit } from '../../lib/inputUnits';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { ALTITUDE_FRAMES } from '../../mavlink/missionCommands';
import { missionFileStem, toQgcWpl } from '../../mavlink/missionFileWriter';
import {
  rallyDraftToItems,
  removeRallyPoint,
  updateRallyPoint,
  type RallyDraft,
  type RallyIssue,
  type RallyItem,
} from '../../mavlink/rallyDraft';
import { isRallyDirty, useMissionPlanStore } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { OPEN_ACCEPT } from './MissionMenu';
import { ClearDraftButton, frameTag, ICON_BTN, INPUT, NumField } from './planUi';

interface RallyPlanBodyProps {
  issues: RallyIssue[];
  /** Bring a point into view on the map. */
  onFocusPoint: (index: number) => void;
  onOpenFile: (file: File) => void;
  /** Replace the rally draft with the vehicle's rally points. */
  onResetToVehicle: () => void;
  /** The vehicle's rally points changed: keep the draft, comparing it with the vehicle's new ones from now on. */
  onKeepDraft: () => void;
  /** Open the upload confirmation; omitted until uploading rally points is available. */
  onRequestUpload?: () => void;
  /** Why uploading is not possible now, or null. */
  uploadBlocked: string | null;
}

const PointEditor: React.FC<{
  draft: RallyDraft;
  index: number;
  issues: RallyIssue[];
  apply: (fn: (d: RallyDraft) => RallyDraft, select?: number | null) => void;
}> = ({ draft, index, issues, apply }) => {
  const p = draft.points[index];
  const len = useLengthUnit();
  const del = useConfirmStep();
  const set = (patch: Partial<RallyItem>) => apply((d) => updateRallyPoint(d, index, patch));
  const frameKnown = ALTITUDE_FRAMES.some((f) => f.value === p.frame);
  const last = draft.points.length - 1;

  return (
    <div className="space-y-2 border-t border-zinc-800 bg-zinc-900/60 px-2 py-2">
      <div className="grid grid-cols-2 gap-1.5">
        <NumField label="Latitude" value={p.lat} digits={7} onCommit={(v) => set({ lat: v })} />
        <NumField label="Longitude" value={p.lon} digits={7} onCommit={(v) => set({ lon: v })} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <NumField
          label={`Altitude (${len.unit})`}
          title="ArduPilot keeps rally altitudes in whole metres"
          value={len.fromSi(p.alt)}
          digits={0}
          onCommit={(v) => set({ alt: len.toSi(v) })}
        />
        <label className="block min-w-0 space-y-0.5">
          <span className="block truncate text-[10px] text-zinc-500">Altitude frame</span>
          <select value={p.frame} onChange={(e) => set({ frame: Number(e.target.value) })} className={INPUT}>
            {!frameKnown && <option value={p.frame}>Frame {p.frame}</option>}
            {ALTITUDE_FRAMES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {issues.length > 0 && (
        <ul className="space-y-0.5">
          {issues.map((iss, k) => (
            <li
              key={k}
              className={`flex gap-1 text-[10px] leading-snug ${iss.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}
            >
              {iss.severity === 'error' ? (
                <XCircle className="mt-px h-3 w-3 shrink-0" />
              ) : (
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              )}
              {iss.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (!del.armed) return del.arm();
            del.cancel();
            apply((d) => removeRallyPoint(d, index), last > 0 ? Math.min(index, last - 1) : null);
          }}
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold ${
            del.armed ? 'border-red-500 bg-red-600 text-white' : 'border-zinc-700 text-red-300 hover:bg-red-950/50'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {del.armed ? 'Confirm' : 'Delete'}
        </button>
      </div>
    </div>
  );
};

export const RallyPlanBody: React.FC<RallyPlanBodyProps> = ({
  issues,
  onFocusPoint,
  onOpenFile,
  onResetToVehicle,
  onKeepDraft,
  onRequestUpload,
  uploadBlocked,
}) => {
  const draft = useMissionPlanStore((s) => s.rally.history.present);
  const selected = useMissionPlanStore((s) => s.rally.selected);
  const dirty = useMissionPlanStore((s) => isRallyDirty(s));
  const vehicleChanged = useMissionPlanStore((s) => s.rally.vehicleChanged);
  const uploading = useMissionPlanStore((s) => s.uploading);
  const { rallyEdit, rallySelect } = useMissionPlanStore.getState();
  const systemId = useTelemetryStore((s) => s.heartbeat.systemId);
  const hasVehicleRally = useTelemetryStore((s) => s.rallyPoints.length > 0);
  const unsupported = useTelemetryStore((s) => s.rallySupport === 'unsupported');
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);
  const resetConfirm = useConfirmStep();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const apply = (fn: (d: RallyDraft) => RallyDraft, sel?: number | null) => {
    try {
      rallyEdit(fn, sel);
    } catch (e) {
      console.warn('[planning] rally edit refused:', e);
    }
  };

  useEffect(() => {
    if (selected === null) return;
    listRef.current?.querySelector(`[data-point="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const issuesAt = (i: number) => issues.filter((x) => x.index === i);

  return (
    <>
      {unsupported && (
        <div className="flex gap-1 border-b border-zinc-700 bg-zinc-900/80 px-2 py-1.5 text-[10px] leading-snug text-zinc-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-400" />
          This vehicle doesn't support rally points, so these can't be uploaded. You can still save them to a file.
        </div>
      )}
      {vehicleChanged && !uploading && (
        <div className="space-y-1 border-b border-amber-500/40 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-200">
          <div className="flex gap-1">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            The vehicle's rally points changed while you were editing (another upload, or a download).
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onResetToVehicle}
              className="rounded border border-amber-500/50 px-1.5 py-0.5 font-bold hover:bg-amber-500/20"
              title="Replace the draft with the vehicle's rally points (undo brings the draft back)"
            >
              Load vehicle's
            </button>
            <button
              type="button"
              onClick={onKeepDraft}
              className="rounded border border-zinc-600 px-1.5 py-0.5 font-bold text-zinc-200 hover:bg-zinc-800"
              title="Keep editing the draft; it will replace the vehicle's rally points when uploaded"
            >
              Keep draft
            </button>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={uploading}
      >
        {issuesAt(-1).map((iss, k) => (
          <div key={k} className="flex gap-1 border-b border-zinc-800 px-2 py-1 text-[10px] text-amber-300">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            {iss.message}
          </div>
        ))}
        {draft.points.length === 0 && (
          <div className="px-2 py-2 text-[10px] leading-snug text-zinc-500">
            Use <b className="text-zinc-300">Place</b> on the map, or right-click it, to add a rally point. On RTL the
            vehicle goes to the nearest rally point (or home).
          </div>
        )}
        {draft.points.map((p, i) => {
          const own = issuesAt(i);
          const isSel = selected === i;
          return (
            <div key={i} data-point={i} className={`border-b border-zinc-800/70 ${isSel ? 'bg-fuchsia-950/30' : ''}`}>
              <button
                type="button"
                onClick={() => {
                  rallySelect(isSel ? null : i);
                  if (!isSel) onFocusPoint(i);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-zinc-900"
              >
                <span
                  className={`w-6 shrink-0 text-right font-mono text-[10px] font-bold ${isSel ? 'text-sky-300' : 'text-fuchsia-300'}`}
                >
                  R{i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                  {formatAltitude(p.alt).full} {frameTag(p.frame)} · {p.lat.toFixed(5)}, {p.lon.toFixed(5)}
                </span>
                {own.some((x) => x.severity === 'error') ? (
                  <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                ) : own.length > 0 ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                ) : null}
              </button>
              {isSel && <PointEditor draft={draft} index={i} issues={own} apply={apply} />}
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 border-t border-zinc-800 px-2 py-1.5">
        {onRequestUpload && (
          <button
            type="button"
            disabled={uploadBlocked !== null}
            onClick={onRequestUpload}
            title={uploadBlocked ?? 'Review and upload the rally points to the vehicle'}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 text-[11px] font-bold text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? 'Uploading…' : 'Upload rally points'}
            {uploadBlocked && !uploading && <span className="truncate font-normal">· {uploadBlocked}</span>}
          </button>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={ICON_BTN}
            title="Save rally draft to a .waypoints file"
            onClick={() =>
              downloadFile(
                `${missionFileStem(systemId)}-rally-draft.waypoints`,
                toQgcWpl(rallyDraftToItems(draft)),
                'text/plain'
              )
            }
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={ICON_BTN}
            title="Open a file into the drafts"
            onClick={() => fileRef.current?.click()}
          >
            <FolderOpen className="h-3.5 w-3.5" />
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
          <button
            type="button"
            disabled={!hasVehicleRally && !dirty}
            title="Replace the rally draft with the vehicle's rally points"
            onClick={() => {
              if (dirty && !resetConfirm.armed) return resetConfirm.arm();
              resetConfirm.cancel();
              onResetToVehicle();
            }}
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-[10px] font-bold disabled:opacity-35 ${
              resetConfirm.armed
                ? 'border-red-500 bg-red-600 text-white'
                : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <RotateCcw className="h-3 w-3" />
            {resetConfirm.armed ? 'Discard changes?' : "Vehicle's rally points"}
          </button>
          <ClearDraftButton
            what="rally points"
            empty={draft.points.length === 0}
            onClear={() => useMissionPlanStore.getState().rallyEdit((d) => ({ ...d, points: [] }), null)}
          />
        </div>
      </div>
    </>
  );
};
