// The planning-mode editor over the map: the draft's items, the selected item's fields, and the draft's own
// actions (undo, add, save to file, reset, exit). Docked at the side on a wide map, a bottom sheet on a narrow one.

import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Download,
  FolderOpen,
  Maximize2,
  Minimize2,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';

import { downloadFile } from '../../lib/download';
import {
  lengthUnit,
  paramUnitKind,
  RAW_LENGTH,
  RAW_SPEED,
  relabel,
  speedUnit,
  wholeLength,
} from '../../lib/inputUnits';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { validateFenceDraft } from '../../mavlink/fenceDraft';
import { cmdHasLocation, getVehicleCategory } from '../../mavlink/messages';
import { ALTITUDE_FRAMES, MISSION_COMMANDS, missionCommandInfo } from '../../mavlink/missionCommands';
import {
  changeCommand,
  CMD_DO_JUMP,
  draftToItems,
  insertItems,
  jumpsTargeting,
  MAV_FRAME,
  moveItem,
  newWaypoint,
  removeItems,
  updateItem,
  validateDraft,
  type DraftIssue,
  type DraftItem,
  type MissionDraft,
} from '../../mavlink/missionDraft';
import { missionFileStem, toQgcWpl } from '../../mavlink/missionFileWriter';
import { fliesSplines, missionPathLegs, routeIndices } from '../../mavlink/missionPath';
import { missionSummary, type MissionSummary } from '../../mavlink/missionSummary';
import { validateRallyDraft } from '../../mavlink/rallyDraft';
import { routeFenceIssues } from '../../mavlink/routeFence';
import { planningVehicle, useLastVehicleStore } from '../../store/lastVehicleStore';
import {
  isAnyDirty,
  isDraftDirty,
  isFenceDirty,
  isRallyDirty,
  useMissionPlanStore,
} from '../../store/missionPlanStore';
import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { FencePlanBody } from './FencePlanBody';
import { OPEN_ACCEPT } from './MissionMenu';
import { ClearDraftButton, frameTag, ICON_BTN, INPUT, NumField } from './planUi';
import { RallyPlanBody } from './RallyPlanBody';

export { typedValue } from './planUi';

export type PlanPanelLayout = 'side' | 'sheet';

interface MissionPlanPanelProps {
  layout: PlanPanelLayout;
  maximized: boolean;
  onToggleMaximize: () => void;
  /** Where new location items go until they can be placed on the map. */
  getMapCenter: () => { lat: number; lon: number } | null;
  /** Bring an item into view on the map. */
  onFocusItem: (index: number) => void;
  /** Load a file into the draft (same parser as the map's file drop). */
  onOpenFile: (file: File) => void;
  /** Replace the draft with the vehicle's mission. */
  onResetToVehicle: () => void;
  /** Leave planning mode (the panel has already confirmed discarding changes). */
  onExit: () => void;
  /** Open the upload confirmation. */
  onRequestUpload: () => void;
  /** The vehicle's mission changed: keep the draft and compare it with the vehicle's new mission from now on. */
  onKeepDraft: () => void;
  connected: boolean;
  /** A mission download or upload is running. */
  transferBusy: boolean;
  /** Rally layer: bring a point into view, replace the draft with the vehicle's, keep the draft after a change. */
  onFocusRallyPoint: (index: number) => void;
  onRallyResetToVehicle: () => void;
  onRallyKeepDraft: () => void;
  /** Open the rally upload confirmation; omitted until available. */
  onRequestRallyUpload?: () => void;
  /** Fence layer: bring a shape (or -2, the return point) into view, reset, keep the draft, upload. */
  onFocusFenceShape: (index: number) => void;
  onFenceResetToVehicle: () => void;
  onFenceKeepDraft: () => void;
  onRequestFenceUpload?: () => void;
}

/** "≈ 7 min · 4.2 km · up to 120 m · 850 m out": the mission at a glance, with what it assumes in the tooltip. */
const MissionSummaryLine: React.FC<{ summary: MissionSummary }> = ({ summary }) => {
  const { formatDistance, formatAltitude, formatSpeed } = useUnitsStore();
  const t = Math.round(summary.timeS);
  // Whole minutes first, so 59.6 min reads "1 h 0 min", never "60 min".
  const mins = Math.round(t / 60);
  const time = t < 60 ? `${t} s` : mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  const sp = summary.speeds;
  const title =
    `Estimated at ${formatSpeed(sp.horizontal).full} (${sp.source}), climbing ${formatSpeed(sp.up).full}, descending ${formatSpeed(sp.down).full}; ` +
    `holds, loiters, speed changes${sp.accel ? ", stops and RTL's wait" : ''} included${summary.jumps ? ', jumps followed' : ''}; ` +
    `no wind, turns at full speed (expect a little longer).`;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-zinc-800 bg-zinc-900/40 px-2 py-1 font-mono text-[10px] text-zinc-300"
      title={title}
    >
      <span className="font-bold text-sky-300">≈ {time}</span>
      {summary.openEnded && <span className="text-amber-300">then {summary.openEnded}</span>}
      <span>· {formatDistance(summary.distanceM).full}</span>
      <span>· up to {formatAltitude(summary.maxAltM).full}</span>
      {summary.farthestM !== null && <span>· {formatDistance(summary.farthestM).full} from home</span>}
    </div>
  );
};

/** One line describing an item, for the list. */
function itemSummary(
  it: DraftItem,
  formatAlt: (m: number) => string,
  fmtParam: (label: string, v: number) => string
): string {
  if (it.command === CMD_DO_JUMP) {
    return `→ #${it.param1}, ${it.param2 === -1 ? 'forever' : `×${it.param2}`}`;
  }
  if (cmdHasLocation(it.command)) {
    const pos = it.x === 0 && it.y === 0 ? 'here' : '';
    return `${formatAlt(it.z)} ${frameTag(it.frame)}${pos ? ` · ${pos}` : ''}`;
  }
  const info = missionCommandInfo(it.command);
  const vals = [it.param1, it.param2, it.param3, it.param4];
  const parts = info.params
    .map((label, k) => (label ? `${label.replace(/ \(.*\)$/, '')} ${fmtParam(label, vals[k])}` : ''))
    .filter(Boolean)
    .slice(0, 2);
  return parts.join(', ');
}

/** The command picker: every known command, grouped, plus the item's own command when it isn't listed. */
const CommandSelect: React.FC<{ value: number; onChange: (id: number) => void; className?: string }> = ({
  value,
  onChange,
  className,
}) => {
  const known = MISSION_COMMANDS.some((c) => c.id === value);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={className ?? INPUT}>
      {!known && <option value={value}>{missionCommandInfo(value).name}</option>}
      {(['Navigation', 'Condition', 'Do'] as const).map((g) => (
        <optgroup key={g} label={g}>
          {MISSION_COMMANDS.filter((c) => c.group === g).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
};

const ItemEditor: React.FC<{
  draft: MissionDraft;
  index: number;
  issues: DraftIssue[];
  apply: (fn: (d: MissionDraft) => MissionDraft, select?: number | null) => void;
  getMapCenter: () => { lat: number; lon: number } | null;
}> = ({ draft, index, issues, apply, getMapCenter }) => {
  const it = draft.items[index];
  const info = missionCommandInfo(it.command);
  const hasLocation = cmdHasLocation(it.command);
  // Altitude and the length / speed params in the display units, or raw (m, m/s: as sent), as the toggle says.
  const system = useUnitsStore((s) => s.system);
  const paramUnits = useUnitsStore((s) => s.paramUnits);
  const setParamUnits = useUnitsStore((s) => s.setParamUnits);
  const raw = paramUnits === 'raw';
  const len = raw ? RAW_LENGTH : lengthUnit(system);
  const spd = raw ? RAW_SPEED : speedUnit(system);
  const unitFor = (label: string) => {
    const k = paramUnitKind(label);
    return k === 'length' ? len : k === 'speed' ? spd : null;
  };
  const hasUnitFields = hasLocation || info.params.some((l) => l && paramUnitKind(l));
  const del = useConfirmStep();
  const jumps = jumpsTargeting(draft, index);
  const last = draft.items.length - 1;

  const set = (patch: Partial<DraftItem>) => apply((d) => updateItem(d, index, patch));
  const params = [it.param1, it.param2, it.param3, it.param4] as const;
  const extras = [it.x, it.y, it.z] as const;
  const frameKnown = ALTITUDE_FRAMES.some((f) => f.value === it.frame);

  return (
    <div className="space-y-2 border-t border-zinc-800 bg-zinc-900/60 px-2 py-2">
      <CommandSelect
        value={it.command}
        onChange={(cmd) => apply((d) => changeCommand(d, index, cmd, getMapCenter() ?? undefined), index)}
      />
      {hasUnitFields && (
        <div className="flex items-center justify-end gap-1 text-[10px] text-zinc-500">
          Units
          <div
            className="flex rounded-md border border-zinc-700 p-0.5"
            role="group"
            aria-label="Units for this item's values"
          >
            {(['user', 'raw'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={paramUnits === u}
                onClick={() => setParamUnits(u)}
                title={u === 'raw' ? 'As sent to the vehicle: meters and m/s' : 'In the display units (Settings)'}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${paramUnits === u ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:bg-zinc-800'}`}
              >
                {u === 'raw' ? 'Raw' : `${lengthUnit(system).unit} · ${speedUnit(system).unit}`}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasLocation && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="Latitude" value={it.x} digits={7} onCommit={(v) => set({ x: v })} />
            <NumField label="Longitude" value={it.y} digits={7} onCommit={(v) => set({ y: v })} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField
              label={`Altitude (${len.unit})`}
              value={len.fromSi(it.z)}
              digits={len.digits}
              onCommit={(v) => set({ z: len.toSi(v) })}
            />
            <label className="block min-w-0 space-y-0.5">
              <span className="block truncate text-[10px] text-zinc-500">Altitude frame</span>
              <select value={it.frame} onChange={(e) => set({ frame: Number(e.target.value) })} className={INPUT}>
                {!frameKnown && <option value={it.frame}>Frame {it.frame}</option>}
                {ALTITUDE_FRAMES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}

      {(info.params.some(Boolean) || (!hasLocation && info.extra?.some(Boolean))) && (
        <div className="grid grid-cols-2 gap-1.5">
          {info.params.map((label, k) => {
            if (!label) return null;
            const u = unitFor(label);
            return (
              <NumField
                key={`p${k}`}
                label={u ? relabel(label, u.unit) : label}
                value={u ? u.fromSi(params[k]) : params[k]}
                digits={u?.digits}
                onCommit={(v) => set({ [`param${k + 1}`]: u ? u.toSi(v) : v } as Partial<DraftItem>)}
              />
            );
          })}
          {!hasLocation &&
            info.extra?.map((label, k) =>
              label ? (
                <NumField
                  key={`e${k}`}
                  label={label}
                  value={extras[k]}
                  onCommit={(v) => set({ [(['x', 'y', 'z'] as const)[k]]: v })}
                />
              ) : null
            )}
        </div>
      )}

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

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={ICON_BTN}
          disabled={index <= 1}
          title="Move up"
          onClick={() => apply((d) => moveItem(d, index, index - 1), index - 1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={ICON_BTN}
          disabled={index >= last}
          title="Move down"
          onClick={() => apply((d) => moveItem(d, index, index + 1), index + 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {del.armed && jumps.length > 0 && (
            <span
              className="truncate text-[10px] text-amber-300"
              title={`Jump ${jumps.map((j) => `#${j}`).join(', ')} will move to the next item`}
            >
              Jump {jumps.map((j) => `#${j}`).join(', ')} targets this
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!del.armed) return del.arm();
              del.cancel();
              apply((d) => removeItems(d, [index]), Math.min(index, last - 1) >= 1 ? Math.min(index, last - 1) : null);
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
    </div>
  );
};

export const MissionPlanPanel: React.FC<MissionPlanPanelProps> = ({
  layout,
  maximized,
  onToggleMaximize,
  getMapCenter,
  onFocusItem,
  onOpenFile,
  onResetToVehicle,
  onExit,
  onRequestUpload,
  onKeepDraft,
  connected,
  transferBusy,
  onFocusRallyPoint,
  onRallyResetToVehicle,
  onRallyKeepDraft,
  onRequestRallyUpload,
  onFocusFenceShape,
  onFenceResetToVehicle,
  onFenceKeepDraft,
  onRequestFenceUpload,
}) => {
  const layer = useMissionPlanStore((s) => s.layer);
  const rallyDraft = useMissionPlanStore((s) => s.rally.history.present);
  const rallySelected = useMissionPlanStore((s) => s.rally.selected);
  const rallyDirty = useMissionPlanStore((s) => isRallyDirty(s));
  const anyDirty = useMissionPlanStore((s) => isAnyDirty(s));
  const activeHistory = (s: ReturnType<typeof useMissionPlanStore.getState>) =>
    s.layer === 'rally' ? s.rally.history : s.layer === 'fence' ? s.fence.history : s.history;
  const canUndoActive = useMissionPlanStore((s) => activeHistory(s).past.length > 0);
  const canRedoActive = useMissionPlanStore((s) => activeHistory(s).future.length > 0);
  // Fence checks use the vehicle's fence parameters: FENCE_ENABLE, FENCE_TYPE, and FENCE_OPTIONS bit 1 (inclusion
  // zones are a union rather than an intersection).
  const fenceDraft = useMissionPlanStore((s) => s.fence.history.present);
  const fenceSelected = useMissionPlanStore((s) => s.fence.selected);
  const fenceDirty = useMissionPlanStore((s) => isFenceDirty(s));
  const fenceEnable = useTelemetryStore((s) => s.parameters['FENCE_ENABLE']?.value);
  const fenceType = useTelemetryStore((s) => s.parameters['FENCE_TYPE']?.value);
  const fenceOptions = useTelemetryStore((s) => s.parameters['FENCE_OPTIONS']?.value);
  const fenceIssues = useMemo(
    () =>
      validateFenceDraft(fenceDraft, {
        fenceEnable,
        fenceType,
        inclusionUnion: fenceOptions !== undefined ? (Math.round(fenceOptions) & 2) !== 0 : undefined,
      }),
    [fenceDraft, fenceEnable, fenceType, fenceOptions]
  );
  // Rally checks need home (primitives, so position updates don't re-render) and the vehicle's RALLY_LIMIT_KM.
  const homeLat = useTelemetryStore((s) => s.homePosition.lat);
  const homeLon = useTelemetryStore((s) => s.homePosition.lon);
  const homeKnown = useTelemetryStore((s) => s.homePosition.source !== 'none');
  const rallyLimitKm = useTelemetryStore((s) => s.parameters['RALLY_LIMIT_KM']?.value);
  const rallyUnsupported = useTelemetryStore((s) => s.rallySupport === 'unsupported');
  const rallyIssues = useMemo(
    () =>
      validateRallyDraft(rallyDraft, {
        home: homeKnown ? { lat: homeLat, lon: homeLon } : null,
        limitKm: rallyLimitKm,
      }),
    [rallyDraft, homeKnown, homeLat, homeLon, rallyLimitKm]
  );
  const draft = useMissionPlanStore((s) => s.history.present);
  const selected = useMissionPlanStore((s) => s.selected);
  const source = useMissionPlanStore((s) => s.source);
  const dirty = useMissionPlanStore((s) => isDraftDirty(s));
  const uploading = useMissionPlanStore((s) => s.uploading);
  const vehicleChanged = useMissionPlanStore((s) => s.vehicleChanged);
  const { edit, undo, redo, select, rallySelect, fenceSelect } = useMissionPlanStore.getState();
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const systemId = useTelemetryStore((s) => s.heartbeat.systemId);
  const hasVehicleMission = useTelemetryStore((s) => s.missionWaypoints.length > 0);
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);
  // List rows give lengths and speeds as the item editor does: display units, or raw when chosen.
  const unitSystem = useUnitsStore((s) => s.system);
  const rawParams = useUnitsStore((s) => s.paramUnits === 'raw');
  const summaryParam = (label: string, v: number) => {
    const kind = paramUnitKind(label);
    const u =
      kind === 'length'
        ? rawParams
          ? RAW_LENGTH
          : lengthUnit(unitSystem)
        : kind === 'speed'
          ? rawParams
            ? RAW_SPEED
            : speedUnit(unitSystem)
          : null;
    return u ? `${Number(u.fromSi(v).toFixed(u.digits))} ${u.unit}` : String(Number(v.toPrecision(6)));
  };

  const [collapsed, setCollapsed] = useState(false);
  const [addCommand, setAddCommand] = useState(16);
  const [editError, setEditError] = useState<string | null>(null);
  const exitConfirm = useConfirmStep();
  const resetConfirm = useConfirmStep();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // The draft's own checks, and terrain clearance along the route (aircraft, terrain data on; computed elsewhere).
  const terrainIssues = useMissionTerrainStore((s) => s.issues);
  // The summary (distance, time, height, reach) and the route checked against the fence being planned, for the
  // connected vehicle or the last one (its speeds and fence settings).
  const lastVehicle = useLastVehicleStore();
  const linkKey = useTelemetryStore((s) => `${s.heartbeat.type}:${s.heartbeat.modeName === 'DISCONNECTED'}`);
  const { summary, routeIssues } = useMemo(() => {
    const v = planningVehicle();
    const cat = getVehicleCategory(v.type);
    const param = (n: string) => v.params[n];
    const splines = fliesSplines(cat);
    const pathItems = draft.items.map((it) => ({
      command: it.command,
      lat: it.x,
      lon: it.y,
      alt: it.z,
      frame: it.frame,
      param1: it.param1,
    }));
    const legs = missionPathLegs(pathItems, routeIndices(pathItems, splines), splines);
    const home = draft.items[0];
    const len = lengthUnit(unitSystem);
    const fenceOptions = param('FENCE_OPTIONS');
    const fenceEnable = param('FENCE_ENABLE');
    const summary = draft.items.length > 1 ? missionSummary(draft.items, cat, param, legs) : null;
    // Fencing off only when it's known to stay off: FENCE_ENABLE 1 is on; report-only (FENCE_ACTION 0) is off; with
    // FENCE_ENABLE 0, auto-enable (at arming or takeoff) means it will come on, and unknown means unknown.
    const action = param('FENCE_ACTION');
    const auto = param('FENCE_AUTOENABLE');
    const enabled =
      action !== undefined && Math.round(action) === 0
        ? false
        : fenceEnable === undefined
          ? undefined
          : Math.round(fenceEnable) === 1
            ? true
            : auto === undefined
              ? undefined
              : Math.round(auto) !== 0
                ? undefined
                : false;
    return {
      summary,
      // The legs flown (jump returns, RTL's), plus any drawn leg the walk didn't reach (a landing sequence after RTL
      // or an unlimited loiter, entered by DO_LAND_START or by hand).
      routeIssues: summary
        ? routeFenceIssues(
            [...summary.legs, ...legs.filter((l) => !summary.legs.some((f) => f.from === l.from && f.to === l.to))],
            draft.items,
            fenceDraft,
            {
              home: home && (home.x !== 0 || home.y !== 0) ? { lat: home.x, lon: home.y } : undefined,
              types: param('FENCE_TYPE'),
              inclusionUnion: fenceOptions !== undefined ? (Math.round(fenceOptions) & 2) !== 0 : undefined,
              altMax: param('FENCE_ALT_MAX'),
              circleRadius: param('FENCE_RADIUS'),
              enabled,
              fmtLen: (m) => wholeLength(m, len),
            }
          )
        : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, fenceDraft, lastVehicle, linkKey, unitSystem]);
  const issues = useMemo(
    () => [...validateDraft(draft, getVehicleCategory(vehicleType)), ...terrainIssues, ...routeIssues],
    [draft, vehicleType, terrainIssues, routeIssues]
  );
  // The header's counts are for the layer being edited.
  const activeIssues: { index: number; severity: string }[] =
    layer === 'rally' ? rallyIssues : layer === 'fence' ? fenceIssues : issues;
  const errors = activeIssues.filter((i) => i.severity === 'error').length;
  const warnings = activeIssues.length - errors;
  const rallyErrors = rallyIssues.some((i) => i.severity === 'error');
  const fenceErrors = fenceIssues.some((i) => i.severity === 'error');
  const issuesAt = (i: number) => issues.filter((x) => x.index === i);
  const missionIssues = issuesAt(-1);

  const apply = (fn: (d: MissionDraft) => MissionDraft, sel?: number | null) => {
    try {
      edit(fn, sel);
      setEditError(null);
    } catch (e: any) {
      setEditError(e?.message ?? 'That edit could not be applied.');
    }
  };

  // Selecting an item (a pin, its menu, or a new waypoint) opens a collapsed sheet, so its editor is never hidden.
  // Only on a change of selection: collapsing with an item selected stays collapsed.
  useEffect(() => {
    if (selected !== null) setCollapsed(false);
  }, [selected]);
  useEffect(() => {
    if (rallySelected !== null) setCollapsed(false);
  }, [rallySelected]);
  useEffect(() => {
    if (fenceSelected !== null) setCollapsed(false);
  }, [fenceSelected]);

  // Keep the selected row in view, including once the sheet has opened.
  useEffect(() => {
    if (selected === null || collapsed) return;
    listRef.current?.querySelector(`[data-item="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, collapsed]);

  const addItem = () => {
    const at = selected !== null && selected >= 1 ? selected + 1 : draft.items.length;
    const center = getMapCenter();
    apply((d) => {
      if (cmdHasLocation(addCommand)) {
        const wp = newWaypoint(d, at, center?.lat ?? 0, center?.lon ?? 0);
        const withWp = insertItems(d, at, [wp]);
        return addCommand === 16 ? withWp : changeCommand(withWp, at, addCommand);
      }
      const item: DraftItem = {
        command: addCommand,
        frame: MAV_FRAME.MISSION,
        param1: 0,
        param2: 0,
        param3: 0,
        param4: 0,
        x: 0,
        y: 0,
        z: 0,
        autocontinue: 1,
      };
      return insertItems(d, at, [item]);
    }, at);
  };

  const saveDraft = () => {
    downloadFile(`${missionFileStem(systemId)}-draft.waypoints`, toQgcWpl(draftToItems(draft)), 'text/plain');
  };

  const uploadBlocked = !connected
    ? 'Connect to a vehicle to upload'
    : uploading || transferBusy
      ? 'A mission transfer is in progress'
      : errors > 0
        ? 'Fix the errors first'
        : !dirty
          ? 'No changes to upload'
          : null;

  const sourceText = source.kind === 'vehicle' ? 'from vehicle' : source.kind === 'file' ? source.name : 'new';

  const shell =
    layout === 'side'
      ? 'absolute top-2 right-2 bottom-2 w-[264px]'
      : `absolute left-0 right-0 bottom-0 ${collapsed ? '' : 'max-h-[48%]'} rounded-b-none border-x-0 border-b-0`;

  return (
    <div
      className={`${shell} z-[450] flex flex-col overflow-hidden rounded-lg border border-amber-500/40 bg-zinc-950/95 shadow-xl backdrop-blur-md`}
      role="region"
      aria-label="Mission draft editor"
    >
      {/* Header */}
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        {layout === 'sheet' && (
          <button
            type="button"
            className={ICON_BTN}
            title={collapsed ? 'Show editor' : 'Hide editor'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          {/* Which draft is being edited is switched over the map (PlanLayerSwitch); here, just its name. */}
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
            <span
              className={layer === 'rally' ? 'text-fuchsia-300' : layer === 'fence' ? 'text-red-300' : 'text-amber-300'}
            >
              {layer === 'rally' ? 'Rally points' : layer === 'fence' ? 'Fence' : 'Mission'}
            </span>
            {(layer === 'rally' ? rallyDirty : layer === 'fence' ? fenceDirty : dirty) && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current text-amber-400" title="Unsaved changes" />
            )}
            <span className="truncate font-mono text-[10px] font-normal normal-case tracking-normal text-zinc-500">
              {layer === 'rally'
                ? `${rallyDraft.points.length} point${rallyDraft.points.length === 1 ? '' : 's'}`
                : layer === 'fence'
                  ? `${fenceDraft.shapes.length} shape${fenceDraft.shapes.length === 1 ? '' : 's'}`
                  : `${draft.items.length - 1} items · ${sourceText}`}
            </span>
          </div>
          {(errors > 0 || warnings > 0) && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-[10px]"
              onClick={() => {
                if (layer === 'fence') {
                  const first = fenceIssues.find((i) => i.index >= 0 || i.index === -2);
                  if (first && first.index >= 0) fenceSelect(first.index);
                  if (first) onFocusFenceShape(first.index);
                  return;
                }
                if (layer === 'rally') {
                  const first = rallyIssues.find((i) => i.index >= 0);
                  if (first) {
                    rallySelect(first.index);
                    onFocusRallyPoint(first.index);
                  }
                  return;
                }
                const first = issues.find((i) => i.index >= 1);
                if (first) {
                  select(first.index);
                  onFocusItem(first.index);
                }
              }}
            >
              {errors > 0 && (
                <span className="text-red-300">
                  {errors} error{errors === 1 ? '' : 's'}
                </span>
              )}
              {warnings > 0 && (
                <span className="text-amber-300">
                  {warnings} warning{warnings === 1 ? '' : 's'}
                </span>
              )}
            </button>
          )}
        </div>
        <button type="button" className={ICON_BTN} disabled={!canUndoActive} title="Undo" onClick={undo}>
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={ICON_BTN} disabled={!canRedoActive} title="Redo" onClick={redo}>
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={ICON_BTN}
          title={maximized ? 'Restore map size' : 'Maximize map for planning'}
          onClick={onToggleMaximize}
        >
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className={`${ICON_BTN} ${exitConfirm.armed ? 'w-auto border-red-500 bg-red-600 px-1.5 text-[10px] font-bold text-white' : ''}`}
          title="Stop planning"
          onClick={() => {
            if (anyDirty && !exitConfirm.armed) return exitConfirm.arm();
            exitConfirm.cancel();
            onExit();
          }}
        >
          {exitConfirm.armed ? 'Discard?' : <X className="h-3.5 w-3.5" />}
        </button>
      </div>

      {layer === 'mission' && vehicleChanged && !uploading && (
        <div className="space-y-1 border-b border-amber-500/40 bg-amber-950/40 px-2 py-1.5 text-[10px] text-amber-200">
          <div className="flex gap-1">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            The vehicle's mission changed while you were editing (another upload, or a download).
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onResetToVehicle}
              className="rounded border border-amber-500/50 px-1.5 py-0.5 font-bold hover:bg-amber-500/20"
              title="Replace the draft with the vehicle's mission (undo brings the draft back)"
            >
              Load vehicle's
            </button>
            <button
              type="button"
              onClick={onKeepDraft}
              className="rounded border border-zinc-600 px-1.5 py-0.5 font-bold text-zinc-200 hover:bg-zinc-800"
              title="Keep editing the draft; it will replace the vehicle's mission when uploaded"
            >
              Keep draft
            </button>
          </div>
        </div>
      )}
      {uploading && (
        <div className="animate-pulse border-b border-sky-500/40 bg-sky-950/40 px-2 py-1.5 text-[10px] text-sky-200">
          Uploading and checking… editing resumes when it finishes.
        </div>
      )}

      {!collapsed && layer === 'rally' && (
        <RallyPlanBody
          issues={rallyIssues}
          onFocusPoint={onFocusRallyPoint}
          onOpenFile={onOpenFile}
          onResetToVehicle={onRallyResetToVehicle}
          onKeepDraft={onRallyKeepDraft}
          onRequestUpload={onRequestRallyUpload}
          uploadBlocked={
            rallyUnsupported
              ? "This vehicle doesn't support rally points"
              : !connected
                ? 'Connect to a vehicle to upload'
                : uploading || transferBusy
                  ? 'A mission transfer is in progress'
                  : rallyErrors
                    ? 'Fix the errors first'
                    : !rallyDirty
                      ? 'No changes to upload'
                      : null
          }
        />
      )}
      {!collapsed && layer === 'fence' && (
        <FencePlanBody
          issues={fenceIssues}
          onFocusShape={onFocusFenceShape}
          onOpenFile={onOpenFile}
          onResetToVehicle={onFenceResetToVehicle}
          onKeepDraft={onFenceKeepDraft}
          onRequestUpload={onRequestFenceUpload}
          uploadBlocked={
            !connected
              ? 'Connect to a vehicle to upload'
              : uploading || transferBusy
                ? 'A mission transfer is in progress'
                : fenceErrors
                  ? 'Fix the errors first'
                  : !fenceDirty
                    ? 'No changes to upload'
                    : null
          }
        />
      )}
      {!collapsed && layer === 'mission' && (
        <>
          {/* Items */}
          <div
            ref={listRef}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            aria-busy={uploading}
          >
            {summary && <MissionSummaryLine summary={summary} />}
            {missionIssues.map((iss, k) => (
              <div key={k} className="flex gap-1 border-b border-zinc-800 px-2 py-1 text-[10px] text-amber-300">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                {iss.message}
              </div>
            ))}
            {draft.items.map((it, i) => {
              const info = missionCommandInfo(it.command);
              const own = issuesAt(i);
              const isSel = selected === i;
              const isHome = i === 0;
              return (
                <div key={i} data-item={i} className={`border-b border-zinc-800/70 ${isSel ? 'bg-sky-950/40' : ''}`}>
                  <button
                    type="button"
                    disabled={isHome}
                    onClick={() => {
                      select(isSel ? null : i);
                      if (!isSel) onFocusItem(i);
                    }}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left hover:bg-zinc-900 disabled:hover:bg-transparent"
                  >
                    <span
                      className={`w-6 shrink-0 text-right font-mono text-[10px] font-bold ${
                        isHome ? 'text-amber-600' : isSel ? 'text-sky-300' : 'text-amber-400'
                      }`}
                    >
                      {isHome ? 'H' : i}
                    </span>
                    <span
                      className={`w-[74px] shrink-0 truncate font-mono text-[10px] font-bold ${isHome ? 'text-zinc-500' : 'text-zinc-200'}`}
                    >
                      {isHome ? 'HOME' : info.short}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                      {isHome
                        ? it.x === 0 && it.y === 0
                          ? 'set by the vehicle'
                          : `${it.x.toFixed(5)}, ${it.y.toFixed(5)}`
                        : itemSummary(
                            it,
                            (m) => (rawParams ? `${Number(m.toFixed(2))} m` : formatAltitude(m).full),
                            summaryParam
                          )}
                    </span>
                    {own.some((x) => x.severity === 'error') ? (
                      <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                    ) : own.length > 0 ? (
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                    ) : null}
                  </button>
                  {isSel && !isHome && (
                    <ItemEditor draft={draft} index={i} issues={own} apply={apply} getMapCenter={getMapCenter} />
                  )}
                </div>
              );
            })}
          </div>

          {editError && <div className="border-t border-zinc-800 px-2 py-1 text-[10px] text-red-300">{editError}</div>}

          {/* Footer */}
          <div className="space-y-1.5 border-t border-zinc-800 px-2 py-1.5">
            <button
              type="button"
              disabled={uploadBlocked !== null}
              onClick={onRequestUpload}
              title={uploadBlocked ?? 'Review and upload the draft to the vehicle'}
              className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 text-[11px] font-bold text-white hover:bg-sky-500 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Uploading…' : 'Upload to vehicle'}
              {uploadBlocked && !uploading && <span className="truncate font-normal">· {uploadBlocked}</span>}
            </button>
            <div className="flex items-center gap-1">
              <CommandSelect value={addCommand} onChange={setAddCommand} className={`${INPUT} min-w-0 flex-1`} />
              <button
                type="button"
                onClick={addItem}
                title={
                  cmdHasLocation(addCommand)
                    ? `Insert after ${selected !== null && selected >= 1 ? `#${selected}` : 'the last item'}, at the map center (or use Place on the map)`
                    : `Insert after ${selected !== null && selected >= 1 ? `#${selected}` : 'the last item'}`
                }
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/15 px-2 text-[11px] font-bold text-amber-200 hover:bg-amber-500/25"
              >
                <Plus className="h-3.5 w-3.5" /> Insert
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className={ICON_BTN} title="Save draft to a .waypoints file" onClick={saveDraft}>
                <Download className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className={ICON_BTN}
                title="Open a mission file into the draft"
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
                disabled={!hasVehicleMission}
                title="Replace the draft with the vehicle's mission"
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
                {resetConfirm.armed ? 'Discard changes?' : 'Vehicle mission'}
              </button>
              {/* Home (item 0) stays: it's the vehicle's, not a mission item. */}
              <ClearDraftButton
                what="mission"
                empty={draft.items.length <= 1}
                onClear={() => apply((d) => ({ ...d, items: d.items.slice(0, 1) }), null)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
};
