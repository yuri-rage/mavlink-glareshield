// The planning editor's fence view: the fence draft's shapes and return point, the selected shape's fields, and the
// fence draft's own actions (upload, save to file, reset). Shapes are drawn on the map (Place, or right-click);
// vertices and whole shapes are moved there by dragging, or typed in here (a polygon's vertex list expands).

import React, { useEffect, useRef, useState } from 'react';

import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  RotateCcw,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { useLengthUnit } from '../../lib/inputUnits';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import {
  FENCE_PARAMS,
  fenceDraftToItems,
  moveShape,
  moveVertex,
  polygonCenter,
  removeShape,
  removeVertex,
  setInclusion,
  setRadius,
  setReturnPoint,
  type FenceDraft,
  type FenceIssue,
} from '../../mavlink/fenceDraft';
import { missionFileStem, toQgcWpl } from '../../mavlink/missionFileWriter';
import { paramManager } from '../../mavlink/paramManager';
import { isFenceDirty, useMissionPlanStore } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { FenceControlBody } from './FenceControl';
import { OPEN_ACCEPT } from './MissionMenu';
import { ICON_BTN, NumField } from './planUi';

interface FencePlanBodyProps {
  issues: FenceIssue[];
  /** Bring a shape (or, with -2, the return point) into view on the map. */
  onFocusShape: (index: number) => void;
  onOpenFile: (file: File) => void;
  /** Replace the fence draft with the vehicle's fence. */
  onResetToVehicle: () => void;
  /** The vehicle's fence changed: keep the draft, comparing it with the vehicle's new one from now on. */
  onKeepDraft: () => void;
  /** Open the upload confirmation; omitted until uploading a fence is available. */
  onRequestUpload?: () => void;
  /** Why uploading is not possible now, or null. */
  uploadBlocked: string | null;
}

function IssueList({ issues }: { issues: FenceIssue[] }) {
  if (issues.length === 0) return null;
  return (
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
  );
}

const ShapeEditor: React.FC<{
  draft: FenceDraft;
  index: number;
  issues: FenceIssue[];
  apply: (fn: (d: FenceDraft) => FenceDraft, select?: number | null) => void;
}> = ({ draft, index, issues, apply }) => {
  const shape = draft.shapes[index];
  const len = useLengthUnit();
  const del = useConfirmStep();
  const [showVertices, setShowVertices] = useState(false);
  const centre = shape.kind === 'polygon' ? polygonCenter(shape.vertices) : shape.center;
  const moveTo = (lat: number, lon: number) => apply((d) => moveShape(d, index, { lat, lon }));

  return (
    <div className="space-y-2 border-t border-zinc-800 bg-zinc-900/60 px-2 py-2">
      <div className="flex rounded-md border border-zinc-700 p-0.5" role="group" aria-label="Zone type">
        {[true, false].map((inclusion) => (
          <button
            key={String(inclusion)}
            type="button"
            aria-pressed={shape.inclusion === inclusion}
            onClick={() => shape.inclusion !== inclusion && apply((d) => setInclusion(d, index, inclusion))}
            title={inclusion ? 'The vehicle must stay inside' : 'The vehicle must stay outside'}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-bold ${
              shape.inclusion === inclusion ? 'bg-red-500 text-zinc-950' : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {inclusion ? 'Inclusion (stay in)' : 'Exclusion (keep out)'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <NumField
          label={shape.kind === 'circle' ? 'Centre lat' : 'Centre lat (moves all)'}
          value={centre.lat}
          digits={7}
          onCommit={(v) => moveTo(v, centre.lon)}
        />
        <NumField label="Centre lon" value={centre.lon} digits={7} onCommit={(v) => moveTo(centre.lat, v)} />
      </div>
      {shape.kind === 'circle' ? (
        <NumField
          label={`Radius (${len.unit})`}
          value={len.fromSi(shape.radius)}
          digits={1}
          onCommit={(v) => apply((d) => setRadius(d, index, len.toSi(v)))}
        />
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => setShowVertices((v) => !v)}
            aria-expanded={showVertices}
            className="flex w-full items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-left text-[11px] font-bold text-zinc-200 hover:bg-zinc-800"
          >
            {showVertices ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {shape.vertices.length} vertices
            <span className="ml-auto font-normal text-zinc-500">{showVertices ? 'hide' : 'edit'}</span>
          </button>
          {showVertices && (
            <ol className="max-h-64 space-y-1 overflow-y-auto pr-0.5">
              {shape.vertices.map((v, k) => (
                <li key={k} className="flex items-end gap-1">
                  <span className="w-6 shrink-0 pb-1.5 font-mono text-[10px] font-bold text-zinc-400">V{k + 1}</span>
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-1">
                    <NumField
                      label="Lat"
                      value={v.lat}
                      digits={7}
                      onCommit={(lat) => apply((d) => moveVertex(d, index, k, { lat, lon: v.lon }))}
                    />
                    <NumField
                      label="Lon"
                      value={v.lon}
                      digits={7}
                      onCommit={(lon) => apply((d) => moveVertex(d, index, k, { lat: v.lat, lon }))}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={shape.vertices.length <= 3}
                    onClick={() => apply((d) => removeVertex(d, index, k))}
                    title={
                      shape.vertices.length <= 3 ? 'A polygon needs at least 3 vertices' : `Delete vertex ${k + 1}`
                    }
                    aria-label={`Delete vertex ${k + 1}`}
                    className="mb-0.5 h-7 shrink-0 rounded-md border border-zinc-700 px-1 text-zinc-400 hover:text-red-300 disabled:opacity-30"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="text-[10px] leading-snug text-zinc-500">
            On the map: drag a vertex to move it, click a <b className="text-zinc-300">+</b> to add one, right-click a
            vertex to delete it; drag the centre handle to move the whole polygon.
          </div>
        </div>
      )}

      <IssueList issues={issues} />

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            if (!del.armed) return del.arm();
            del.cancel();
            apply((d) => removeShape(d, index), null);
          }}
          className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-bold ${
            del.armed ? 'border-red-500 bg-red-600 text-white' : 'border-zinc-700 text-red-300 hover:bg-red-950/50'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {del.armed ? 'Confirm' : `Delete ${shape.kind}`}
        </button>
      </div>
    </div>
  );
};

export const FencePlanBody: React.FC<FencePlanBodyProps> = ({
  issues,
  onFocusShape,
  onOpenFile,
  onResetToVehicle,
  onKeepDraft,
  onRequestUpload,
  uploadBlocked,
}) => {
  const draft = useMissionPlanStore((s) => s.fence.history.present);
  const selected = useMissionPlanStore((s) => s.fence.selected);
  const dirty = useMissionPlanStore((s) => isFenceDirty(s));
  const vehicleChanged = useMissionPlanStore((s) => s.fence.vehicleChanged);
  const uploading = useMissionPlanStore((s) => s.uploading);
  const { fenceEdit, fenceSelect } = useMissionPlanStore.getState();
  const systemId = useTelemetryStore((s) => s.heartbeat.systemId);
  const hasVehicleFence = useTelemetryStore((s) => s.fencePoints.length > 0);
  const formatDistance = useUnitsStore((s) => s.formatDistance);
  const resetConfirm = useConfirmStep();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const apply = (fn: (d: FenceDraft) => FenceDraft, sel?: number | null) => {
    try {
      fenceEdit(fn, sel);
    } catch (e) {
      console.warn('[planning] fence edit refused:', e);
    }
  };

  // The fence checks need the vehicle's fence parameters, which aren't downloaded unless asked for.
  const compId = useTelemetryStore((s) => s.heartbeat.componentId);
  useEffect(() => {
    if (systemId > 0) FENCE_PARAMS.forEach((p) => paramManager.requestParam(systemId, compId || 1, p));
  }, [systemId, compId]);

  useEffect(() => {
    if (selected === null) return;
    listRef.current?.querySelector(`[data-shape="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const issuesAt = (i: number) => issues.filter((x) => x.index === i);
  const rp = draft.returnPoint;

  return (
    <>
      {vehicleChanged && !uploading && (
        <div className="space-y-1 border-b border-amber-500/40 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-200">
          <div className="flex gap-1">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            The vehicle's fence changed while you were editing (another upload, or a download).
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onResetToVehicle}
              className="rounded border border-amber-500/50 px-1.5 py-0.5 font-bold hover:bg-amber-500/20"
              title="Replace the draft with the vehicle's fence (undo brings the draft back)"
            >
              Load vehicle's
            </button>
            <button
              type="button"
              onClick={onKeepDraft}
              className="rounded border border-zinc-600 px-1.5 py-0.5 font-bold text-zinc-200 hover:bg-zinc-800"
              title="Keep editing the draft; it will replace the vehicle's fence when uploaded"
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
        {draft.shapes.length === 0 && (
          <div className="px-2 py-2 text-[10px] leading-snug text-zinc-500">
            Use <b className="text-zinc-300">Place</b> to draw a polygon or circle, or right-click the map for a square.
            Fence altitude limits are parameters (FENCE_ALT_MAX, FENCE_ALT_MIN), not part of this draft.
          </div>
        )}
        {draft.shapes.map((shape, i) => {
          const own = issuesAt(i);
          const isSel = selected === i;
          const summary =
            shape.kind === 'circle' ? `r ${formatDistance(shape.radius).full}` : `${shape.vertices.length} vertices`;
          return (
            <div key={i} data-shape={i} className={`border-b border-zinc-800/70 ${isSel ? 'bg-red-950/30' : ''}`}>
              <button
                type="button"
                onClick={() => {
                  fenceSelect(isSel ? null : i);
                  if (!isSel) onFocusShape(i);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-zinc-900"
              >
                <span
                  className={`w-6 shrink-0 text-right font-mono text-[10px] font-bold ${isSel ? 'text-sky-300' : 'text-red-300'}`}
                >
                  F{i + 1}
                </span>
                <span className="shrink-0 text-[10px] font-bold text-zinc-200">
                  {shape.inclusion ? 'Incl.' : 'Excl.'} {shape.kind}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-500">{summary}</span>
                {own.some((x) => x.severity === 'error') ? (
                  <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                ) : own.length > 0 ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                ) : null}
              </button>
              {isSel && <ShapeEditor draft={draft} index={i} issues={own} apply={apply} />}
            </div>
          );
        })}

        {/* The return point: ArduPlane flies to it on a fence breach; Copter and Rover don't use it. */}
        <div
          className="space-y-1.5 border-b border-zinc-800/70 px-2 py-1.5"
          title="ArduPlane flies to the return point on a fence breach; Copter and Rover don't use it"
        >
          <div className="flex items-center gap-1.5">
            <span className="w-6 shrink-0 text-right font-mono text-[10px] font-bold text-red-300">RP</span>
            <button
              type="button"
              disabled={!rp}
              onClick={() => onFocusShape(-2)}
              className="min-w-0 flex-1 truncate text-left text-[10px] text-zinc-300 disabled:text-zinc-500"
            >
              {rp
                ? `Return point · ${rp.lat.toFixed(5)}, ${rp.lon.toFixed(5)}`
                : 'No return point (Place it, or right-click the map)'}
            </button>
            {rp && (
              <button
                type="button"
                className={ICON_BTN}
                title="Remove the return point"
                onClick={() => apply((d) => setReturnPoint(d, null))}
              >
                <Trash2 className="h-3.5 w-3.5 text-red-300" />
              </button>
            )}
          </div>
          {rp && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumField
                label="Latitude"
                value={rp.lat}
                digits={7}
                onCommit={(v) => apply((d) => setReturnPoint(d, { lat: v, lon: rp.lon }))}
              />
              <NumField
                label="Longitude"
                value={rp.lon}
                digits={7}
                onCommit={(v) => apply((d) => setReturnPoint(d, { lat: rp.lat, lon: v }))}
              />
            </div>
          )}
          <IssueList issues={issuesAt(-2)} />
        </div>
      </div>

      <div className="space-y-1.5 border-t border-zinc-800 px-2 py-1.5">
        {/* The vehicle's fence switch: what's uploaded is only enforced while it's on. */}
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-1.5">
          <FenceControlBody compact />
        </div>
        {onRequestUpload && (
          <button
            type="button"
            disabled={uploadBlocked !== null}
            onClick={onRequestUpload}
            title={uploadBlocked ?? 'Review and upload the fence to the vehicle'}
            className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 text-[11px] font-bold text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? 'Uploading…' : 'Upload fence'}
            {uploadBlocked && !uploading && <span className="truncate font-normal">· {uploadBlocked}</span>}
          </button>
        )}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={ICON_BTN}
            title="Save fence draft to a .waypoints file"
            onClick={() =>
              downloadFile(
                `${missionFileStem(systemId)}-fence-draft.waypoints`,
                toQgcWpl(fenceDraftToItems(draft)),
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
            disabled={!hasVehicleFence && !dirty}
            title="Replace the fence draft with the vehicle's fence"
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
            {resetConfirm.armed ? 'Discard changes?' : "Vehicle's fence"}
          </button>
        </div>
      </div>
    </>
  );
};
