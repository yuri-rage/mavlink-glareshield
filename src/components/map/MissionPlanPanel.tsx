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
import { cmdHasLocation, getVehicleCategory } from '../../mavlink/messages';
import {
  CMD_DO_JUMP,
  MAV_FRAME,
  changeCommand,
  draftToItems,
  insertItems,
  jumpsTargeting,
  moveItem,
  newWaypoint,
  removeItems,
  updateItem,
  validateDraft,
  type DraftIssue,
  type DraftItem,
  type MissionDraft,
} from '../../mavlink/missionDraft';
import { ALTITUDE_FRAMES, MISSION_COMMANDS, missionCommandInfo } from '../../mavlink/missionCommands';
import { missionFileStem, toQgcWpl } from '../../mavlink/missionFileWriter';
import { isDraftDirty, useMissionPlanStore } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { downloadFile } from '../../lib/download';

const FT_PER_M = 3.28084;
const INPUT =
  'h-7 w-full rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] font-mono text-zinc-100 focus:outline-none focus:border-sky-500';
const ICON_BTN =
  'inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-35 disabled:pointer-events-none';

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
}

/**
 * The value to commit when a number field loses focus, or null for none. Only something the user typed counts:
 * - not typed at all: nothing, even if the value changed meanwhile (a pin dragged while the field had focus must
 *   not be overwritten by the old text);
 * - typed back to what is shown: nothing (the text is rounded, so comparing with the exact value would commit the
 *   rounding).
 */
export function typedValue(text: string, shown: string, typed: boolean): number | null {
  if (!typed || text.trim() === shown) return null;
  const v = parseFloat(text);
  return Number.isFinite(v) ? v : null;
}

/** A number input that keeps what is typed until Enter or blur, then commits a finite value. */
const NumField: React.FC<{
  label: string;
  value: number;
  onCommit: (v: number) => void;
  digits?: number;
  title?: string;
}> = ({ label, value, onCommit, digits, title }) => {
  const shown = digits !== undefined ? Number(value.toFixed(digits)).toString() : String(Number(value.toPrecision(7)));
  const [text, setText] = useState(shown);
  /** The user has typed since focusing. Until then the field follows the draft, even while focused. */
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setText(shown);
  }, [shown]);
  const commit = () => {
    const v = typedValue(text, shown, typed.current);
    typed.current = false;
    if (v !== null) onCommit(v);
    // Show the draft's value again: the new one once the edit lands, the old one if it was refused.
    setText(shown);
  };
  return (
    <label className="block min-w-0 space-y-0.5" title={title}>
      <span className="block truncate text-[10px] text-zinc-500">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => (typed.current = false)}
        onChange={(e) => {
          typed.current = true;
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            // Cancel the typing only; don't also leave the Place tool or the maximized map.
            e.stopPropagation();
            typed.current = false;
            setText(shown);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={INPUT}
      />
    </label>
  );
};

function frameTag(frame: number): string {
  if (frame === MAV_FRAME.GLOBAL || frame === MAV_FRAME.GLOBAL_INT) return 'MSL';
  if (frame === MAV_FRAME.GLOBAL_TERRAIN_ALT || frame === MAV_FRAME.GLOBAL_TERRAIN_ALT_INT) return 'TER';
  return 'REL';
}

/** One line describing an item, for the list. */
function itemSummary(it: DraftItem, formatAlt: (m: number) => string): string {
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
    .map((label, k) => (label ? `${label.replace(/ \(.*\)$/, '')} ${Number(vals[k].toPrecision(6))}` : ''))
    .filter(Boolean)
    .slice(0, 2);
  return parts.join(', ');
}

/** The command picker: every known command, grouped, plus the item's own command when it isn't listed. */
const CommandSelect: React.FC<{ value: number; onChange: (id: number) => void; className?: string }> = ({ value, onChange, className }) => {
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
  const imperial = useUnitsStore((s) => s.system === 'mph' || s.system === 'kts');
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

      {hasLocation && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField label="Latitude" value={it.x} digits={7} onCommit={(v) => set({ x: v })} />
            <NumField label="Longitude" value={it.y} digits={7} onCommit={(v) => set({ y: v })} />
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <NumField
              label={`Altitude (${imperial ? 'ft' : 'm'})`}
              value={imperial ? it.z * FT_PER_M : it.z}
              digits={imperial ? 0 : 1}
              onCommit={(v) => set({ z: imperial ? v / FT_PER_M : v })}
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
          {info.params.map((label, k) =>
            label ? (
              <NumField
                key={`p${k}`}
                label={label}
                value={params[k]}
                onCommit={(v) => set({ [`param${k + 1}`]: v } as Partial<DraftItem>)}
              />
            ) : null
          )}
          {!hasLocation &&
            info.extra?.map((label, k) =>
              label ? (
                <NumField key={`e${k}`} label={label} value={extras[k]} onCommit={(v) => set({ [(['x', 'y', 'z'] as const)[k]]: v })} />
              ) : null
            )}
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-0.5">
          {issues.map((iss, k) => (
            <li key={k} className={`flex gap-1 text-[10px] leading-snug ${iss.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
              {iss.severity === 'error' ? <XCircle className="mt-px h-3 w-3 shrink-0" /> : <AlertTriangle className="mt-px h-3 w-3 shrink-0" />}
              {iss.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-1">
        <button type="button" className={ICON_BTN} disabled={index <= 1} title="Move up" onClick={() => apply((d) => moveItem(d, index, index - 1), index - 1)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={ICON_BTN} disabled={index >= last} title="Move down" onClick={() => apply((d) => moveItem(d, index, index + 1), index + 1)}>
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          {del.armed && jumps.length > 0 && (
            <span className="truncate text-[10px] text-amber-300" title={`Jump ${jumps.map((j) => `#${j}`).join(', ')} will move to the next item`}>
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
}) => {
  const draft = useMissionPlanStore((s) => s.history.present);
  const canUndo = useMissionPlanStore((s) => s.history.past.length > 0);
  const canRedo = useMissionPlanStore((s) => s.history.future.length > 0);
  const selected = useMissionPlanStore((s) => s.selected);
  const source = useMissionPlanStore((s) => s.source);
  const dirty = useMissionPlanStore((s) => isDraftDirty(s));
  const uploading = useMissionPlanStore((s) => s.uploading);
  const vehicleChanged = useMissionPlanStore((s) => s.vehicleChanged);
  const { edit, undo, redo, select } = useMissionPlanStore.getState();
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const systemId = useTelemetryStore((s) => s.heartbeat.systemId);
  const hasVehicleMission = useTelemetryStore((s) => s.missionWaypoints.length > 0);
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);

  const [collapsed, setCollapsed] = useState(false);
  const [addCommand, setAddCommand] = useState(16);
  const [editError, setEditError] = useState<string | null>(null);
  const exitConfirm = useConfirmStep();
  const resetConfirm = useConfirmStep();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const issues = useMemo(() => validateDraft(draft, getVehicleCategory(vehicleType)), [draft, vehicleType]);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
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

  const sourceText =
    source.kind === 'vehicle' ? 'from vehicle' : source.kind === 'file' ? source.name : 'new';

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
          <button type="button" className={ICON_BTN} title={collapsed ? 'Show editor' : 'Hide editor'} onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-300">
            Draft
            {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved changes" />}
            <span className="truncate font-mono text-[10px] font-normal normal-case tracking-normal text-zinc-500">
              {draft.items.length - 1} items · {sourceText}
            </span>
          </div>
          {(errors > 0 || warnings > 0) && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-[10px]"
              onClick={() => {
                const first = issues.find((i) => i.index >= 1);
                if (first) {
                  select(first.index);
                  onFocusItem(first.index);
                }
              }}
            >
              {errors > 0 && <span className="text-red-300">{errors} error{errors === 1 ? '' : 's'}</span>}
              {warnings > 0 && <span className="text-amber-300">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
            </button>
          )}
        </div>
        <button type="button" className={ICON_BTN} disabled={!canUndo} title="Undo" onClick={undo}>
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={ICON_BTN} disabled={!canRedo} title="Redo" onClick={redo}>
          <Redo2 className="h-3.5 w-3.5" />
        </button>
        <button type="button" className={ICON_BTN} title={maximized ? 'Restore map size' : 'Maximize map for planning'} onClick={onToggleMaximize}>
          {maximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className={`${ICON_BTN} ${exitConfirm.armed ? 'w-auto border-red-500 bg-red-600 px-1.5 text-[10px] font-bold text-white' : ''}`}
          title="Stop planning"
          onClick={() => {
            if (dirty && !exitConfirm.armed) return exitConfirm.arm();
            exitConfirm.cancel();
            onExit();
          }}
        >
          {exitConfirm.armed ? 'Discard?' : <X className="h-3.5 w-3.5" />}
        </button>
      </div>

      {vehicleChanged && !uploading && (
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
        <div className="border-b border-sky-500/40 bg-sky-950/40 px-2 py-1.5 text-[10px] text-sky-200 animate-pulse">
          Uploading and checking… editing resumes when it finishes.
        </div>
      )}

      {!collapsed && (
        <>
          {/* Items */}
          <div
            ref={listRef}
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${uploading ? 'pointer-events-none opacity-60' : ''}`}
            aria-busy={uploading}
          >
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
                    <span className={`w-[74px] shrink-0 truncate font-mono text-[10px] font-bold ${isHome ? 'text-zinc-500' : 'text-zinc-200'}`}>
                      {isHome ? 'HOME' : info.short}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-400">
                      {isHome
                        ? it.x === 0 && it.y === 0
                          ? 'set by the vehicle'
                          : `${it.x.toFixed(5)}, ${it.y.toFixed(5)}`
                        : itemSummary(it, (m) => formatAltitude(m).full)}
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
                    ? `Insert after ${selected !== null && selected >= 1 ? `#${selected}` : 'the last item'}, at the map centre (or use Place on the map)`
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
              <button type="button" className={ICON_BTN} title="Open a mission file into the draft" onClick={() => fileRef.current?.click()}>
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".plan,.waypoints,.txt,.dat,.json"
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
                  resetConfirm.armed ? 'border-red-500 bg-red-600 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <RotateCcw className="h-3 w-3" />
                {resetConfirm.armed ? 'Discard changes?' : 'Vehicle mission'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
