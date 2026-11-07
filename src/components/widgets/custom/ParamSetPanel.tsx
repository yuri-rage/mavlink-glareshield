// Parameter set: a hand-picked list of parameters to view and edit, by exact name or wildcard (BATT_*, -BATT2_*).
// Rows use the Parameters widget's editors (dropdown for named values, checklist for bitmasks, number with range),
// descriptions come from the version-matched metadata, and every write waits for the vehicle to echo the value.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Lock, ChevronDown, Loader2 } from 'lucide-react';
import { useTelemetryStore } from '../../../store/telemetryStore';
import { mavlinkConnection } from '../../../mavlink/connection';
import { paramManager, type ParamManagerStatus } from '../../../mavlink/paramManager';
import { getVehicleCategory } from '../../../mavlink/messages';
import { formatParamValue, getParamMetadata } from '../../../mavlink/paramMetadata';
import { bitmaskSummary, valueLabel } from '../../../mavlink/paramBits';
import { expandParamPatterns, isParamPattern } from '../../../mavlink/paramMatch';
import { useParamMetaStore } from '../../../store/paramMetaStore';
import { BitmaskEditor, DetailsButton, EnumSelect, ParamDetails } from '../params/ParamEditors';
import { useVehicleTarget, type PanelProps } from './panelKit';

/** Rows shown at most; a wider pattern asks to be narrowed rather than listing hundreds of parameters. */
export const MAX_PARAM_SET_ROWS = 150;
/** How long to wait for the vehicle to echo a written value. */
const ECHO_TIMEOUT_MS = 4000;
/** How long to wait for a single PARAM_REQUEST_READ reply before showing "not on this vehicle". */
const READ_TIMEOUT_MS = 2500;

type RowStatus = { kind: 'pending' | 'saved' | 'failed'; text?: string };

export const ParamSetPanel: React.FC<PanelProps> = ({ def }) => {
  const { sysId, compId } = useVehicleTarget();
  const entries = def.paramSet?.params ?? [];
  const confirmEveryWrite = Boolean(def.paramSet?.confirmation);
  const parameters = useTelemetryStore((s) => s.parameters);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const heartbeatType = useTelemetryStore((s) => s.heartbeat.type);
  const firmwareVersion = useTelemetryStore((s) => s.firmwareVersion);

  // Load the vehicle's metadata even when the Parameters widget isn't open; re-render when it arrives.
  const ensureMeta = useParamMetaStore((s) => s.ensure);
  const metaSummary = useParamMetaStore((s) => s.summary);
  useParamMetaStore((s) => s.catalog);
  useEffect(() => {
    ensureMeta(getVehicleCategory(heartbeatType), firmwareVersion);
  }, [heartbeatType, firmwareVersion, ensureMeta]);

  const [fetchStatus, setFetchStatus] = useState<ParamManagerStatus>({ isFetching: false, method: 'idle', paramCount: 0 });
  useEffect(() => paramManager.onStatusChange(setFetchStatus), []);

  const downloaded = useMemo(() => Object.keys(parameters), [parameters]);
  const rows = useMemo(() => expandParamPatterns(entries, downloaded), [entries.join('\n'), downloaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.slice(0, MAX_PARAM_SET_ROWS);
  const hasPatterns = entries.some((e) => isParamPattern(e) && !e.startsWith('-'));

  // Exact names that aren't loaded: ask for just those (cheap), as param-control does.
  const requested = useRef(new Set<string>());
  const readTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [pendingReads, setPendingReads] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => () => readTimers.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!linked) {
      requested.current.clear();
      readTimers.current.forEach(clearTimeout);
      readTimers.current = [];
      setPendingReads((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const enc = mavlinkConnection.getEncoder();
    const sentNow: string[] = [];
    for (const r of rows) {
      if (!r.present && !requested.current.has(r.name)) {
        requested.current.add(r.name);
        sentNow.push(r.name);
        mavlinkConnection.send(enc.createParamRequestRead(sysId, compId, -1, r.name));
      }
    }
    if (sentNow.length === 0) return;
    setPendingReads((prev) => {
      const next = new Set(prev);
      for (const n of sentNow) next.add(n);
      return next;
    });
    const timer = setTimeout(() => {
      readTimers.current = readTimers.current.filter((t) => t !== timer);
      setPendingReads((prev) => {
        const next = new Set(prev);
        for (const n of sentNow) next.delete(n);
        return next;
      });
    }, READ_TIMEOUT_MS);
    readTimers.current.push(timer);
  }, [rows, linked, sysId, compId]);

  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editCustom, setEditCustom] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirming, setConfirming] = useState<{ name: string; value: number; outOfRange: boolean } | null>(null);
  const [details, setDetails] = useState<{ name: string; anchor: HTMLElement } | null>(null);
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const pending = useRef<Record<string, { value: number; timer: ReturnType<typeof setTimeout> }>>({});

  // A write is confirmed when the vehicle echoes the value back.
  useEffect(() => {
    for (const [name, p] of Object.entries(pending.current)) {
      const v = parameters[name]?.value;
      if (v !== undefined && Math.abs(v - p.value) < 1e-4) {
        clearTimeout(p.timer);
        delete pending.current[name];
        setStatus((s) => ({ ...s, [name]: { kind: 'saved' } }));
        setTimeout(
          () =>
            setStatus((s) => {
              if (s[name]?.kind !== 'saved') return s;
              const { [name]: _done, ...rest } = s;
              return rest;
            }),
          2500
        );
      }
    }
  }, [parameters]);
  useEffect(() => () => Object.values(pending.current).forEach((p) => clearTimeout(p.timer)), []);

  const startEdit = (name: string, value: number, el: HTMLElement) => {
    if (getParamMetadata(name)?.readOnly) return;
    setEditing(name);
    setEditValue(String(value));
    setEditCustom(false);
    setAnchor(el);
    setConfirming(null);
  };
  const stopEdit = () => {
    setEditing(null);
    setConfirming(null);
  };

  const send = (name: string, value: number) => {
    const entry = parameters[name];
    // The write needs the parameter's type from the vehicle; ask for it rather than guess.
    if (!entry || entry.type === undefined) {
      mavlinkConnection.send(mavlinkConnection.getEncoder().createParamRequestRead(sysId, compId, -1, name));
      setStatus((s) => ({ ...s, [name]: { kind: 'failed', text: 'type unknown; requested from the vehicle, try again' } }));
      stopEdit();
      return;
    }
    if (pending.current[name]) clearTimeout(pending.current[name].timer);
    mavlinkConnection.send(mavlinkConnection.getEncoder().createParamSet(sysId, compId, name, value, entry.type));
    pending.current[name] = {
      value,
      timer: setTimeout(() => {
        delete pending.current[name];
        setStatus((s) => ({ ...s, [name]: { kind: 'failed', text: 'no confirmation from the vehicle' } }));
      }, ECHO_TIMEOUT_MS),
    };
    setStatus((s) => ({ ...s, [name]: { kind: 'pending' } }));
    stopEdit();
  };

  const save = (name: string) => {
    const meta = getParamMetadata(name);
    if (meta?.readOnly) return stopEdit();
    const value = parseFloat(editValue);
    if (isNaN(value)) return;
    if (Math.abs(value - (parameters[name]?.value ?? NaN)) < 1e-9) return stopEdit();
    const outOfRange = (meta?.min !== undefined && value < meta.min) || (meta?.max !== undefined && value > meta.max);
    // Out-of-range values always ask first, whatever the widget's confirmation setting.
    if (confirmEveryWrite || outOfRange) setConfirming({ name, value, outOfRange });
    else send(name, value);
  };

  if (entries.length === 0) {
    return <p className="text-xs text-zinc-500 italic py-2">No parameters chosen. Edit the widget to list some (names or patterns like BATT_*).</p>;
  }

  // Individual PARAM_REQUEST_READ replies fill only the exact names asked for; patterns still need the full list.
  const notDownloaded = fetchStatus.paramCount === 0 && downloaded.every((n) => requested.current.has(n));

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-1.5">
      {notDownloaded && hasPatterns && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-[11px] text-zinc-400">
          <span>Patterns need the vehicle's parameter list.</span>
          <button
            type="button"
            disabled={!linked || fetchStatus.isFetching}
            onClick={() => paramManager.fetchParameters()}
            className="inline-flex items-center gap-1 rounded border border-sky-700/60 px-1.5 py-0.5 text-sky-300 hover:bg-sky-950/40 disabled:opacity-40"
          >
            {fetchStatus.isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            {fetchStatus.isFetching ? 'Downloading…' : 'Download'}
          </button>
        </div>
      )}
      {/* Sized by its rows, scrolling past about thirteen of them. */}
      <div className="flex-1 min-h-0">
        <div className="max-h-[420px] overflow-y-auto overflow-x-hidden pr-0.5">
          <ul className="divide-y divide-zinc-900">
            {shown.map(({ name, present }) => {
              const item = parameters[name];
              const meta = getParamMetadata(name);
              const isEditing = editing === name;
              const editor = editCustom ? 'number' : meta?.bitmask ? 'bitmask' : meta?.values && Object.keys(meta.values).length ? 'enum' : 'number';
              const editNum = parseFloat(editValue);
              const st = status[name];
              const conf = confirming?.name === name ? confirming : null;
              return (
                <li key={name} className="py-1 flex items-center gap-2 min-w-0">
                  <div className="min-w-[40%] flex-1 basis-0" title={meta?.description ? `${name}\n${meta.description}` : name}>
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-zinc-200 truncate">{name}</span>
                      {meta && <DetailsButton name={name} onClick={(b) => setDetails((d) => (d?.name === name ? null : { name, anchor: b }))} />}
                      {meta?.rebootRequired && <span className="text-[8.5px] px-1 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">Reboot</span>}
                    </div>
                    {(meta?.displayName || meta?.description) && (
                      <div className="text-[10px] text-zinc-500 truncate leading-tight">{meta.displayName || meta.description}</div>
                    )}
                  </div>

                  <div className="min-w-0 max-w-[60%] flex flex-col items-end gap-0.5 font-mono text-[11px]">
                    {!item ? (
                      <span className="text-zinc-600 italic font-sans text-[10px]">
                        {!linked ? 'not loaded' : fetchStatus.isFetching || pendingReads.has(name) ? 'loading…' : present ? '…' : 'not on this vehicle'}
                      </span>
                    ) : conf ? (
                      <div className={`flex flex-wrap items-center justify-end gap-1 rounded px-1 py-0.5 ${conf.outOfRange ? 'bg-red-950/50 border border-red-700/50' : 'bg-amber-950/40 border border-amber-700/50'}`}>
                        {conf.outOfRange && <AlertTriangle className="h-3 w-3 text-red-400" aria-label="out of range" />}
                        <span className={conf.outOfRange ? 'text-red-200' : 'text-amber-200'}>
                          Write {formatParamValue(conf.value)}?{conf.outOfRange ? ' (out of range)' : ''}
                        </span>
                        <button type="button" onClick={() => send(name, conf.value)} className="px-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-sans font-semibold text-[10px]">
                          Write
                        </button>
                        <button type="button" onClick={stopEdit} className="px-1 text-zinc-400 hover:text-zinc-200 text-[10px]">✕</button>
                      </div>
                    ) : isEditing && editor === 'enum' ? (
                      <div className="flex items-center gap-1">
                        <EnumSelect name={name} values={meta!.values!} editValue={editValue} onChange={setEditValue} onSave={() => save(name)} onCancel={stopEdit} onCustom={() => setEditCustom(true)} />
                        <button type="button" onClick={() => save(name)} className="h-5 px-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/40 font-sans font-semibold">Save</button>
                        <button type="button" onClick={stopEdit} className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200" aria-label="Cancel">✕</button>
                      </div>
                    ) : isEditing && editor === 'number' ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          autoFocus
                          step={meta?.increment ?? 'any'}
                          min={meta?.min}
                          max={meta?.max}
                          value={editValue}
                          aria-label={`${name} value`}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') save(name);
                            else if (e.key === 'Escape') stopEdit();
                          }}
                          className="h-6 w-20 rounded border border-sky-500 bg-black/90 px-1 text-sky-300 focus:outline-none"
                        />
                        {meta?.units && <span className="text-[10px] text-zinc-500 font-sans">{meta.units}</span>}
                        <button type="button" onClick={() => save(name)} className="h-5 px-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded border border-emerald-500/40 font-sans font-semibold">Save</button>
                        <button type="button" onClick={stopEdit} className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200" aria-label="Cancel">✕</button>
                      </div>
                    ) : meta?.readOnly ? (
                      <span className="inline-flex items-center gap-1 text-zinc-300">
                        {formatParamValue(item.value)}
                        {meta.units && <span className="text-[10px] text-zinc-500 font-sans">{meta.units}</span>}
                        <Lock className="h-2.5 w-2.5 text-zinc-600" aria-label="read-only" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => startEdit(name, item.value, e.currentTarget)}
                        title={`Edit ${name} (raw: ${item.value})`}
                        className={`inline-flex items-center gap-1 rounded px-1 text-sky-400 hover:bg-sky-500/10 max-w-full ${isEditing ? 'ring-1 ring-sky-500/60 bg-sky-500/10' : ''}`}
                      >
                        <span>{formatParamValue(isEditing && editor === 'bitmask' ? editNum : item.value)}</span>
                        {meta?.units && <span className="text-[10px] text-zinc-500 font-sans">{meta.units}</span>}
                        {meta?.bitmask ? (
                          <span className="text-[10px] text-zinc-400 font-sans truncate max-w-[140px] inline-flex items-center gap-0.5">
                            {bitmaskSummary(isEditing ? editNum : item.value, meta.bitmask)}
                            <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                          </span>
                        ) : (
                          valueLabel(meta?.values, item.value) && (
                            <span className="text-[10px] text-zinc-400 font-sans truncate max-w-[140px]">({valueLabel(meta?.values, item.value)})</span>
                          )
                        )}
                      </button>
                    )}
                    {st && (
                      <span
                        className={`text-[9.5px] font-sans inline-flex items-center gap-0.5 ${
                          st.kind === 'saved' ? 'text-emerald-400' : st.kind === 'failed' ? 'text-red-400' : 'text-amber-400'
                        }`}
                        role="status"
                      >
                        {st.kind === 'pending' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                        {st.kind === 'saved' && <Check className="h-2.5 w-2.5" />}
                        {st.kind === 'pending' ? 'writing…' : st.kind === 'saved' ? 'saved' : `not saved: ${st.text}`}
                      </span>
                    )}
                  </div>

                  {isEditing && editor === 'bitmask' && meta?.bitmask && item && !conf && (
                    <BitmaskEditor
                      name={name}
                      bitmask={meta.bitmask}
                      value={editNum}
                      original={item.value}
                      anchor={anchor}
                      onChange={(v) => setEditValue(String(v))}
                      onSave={() => save(name)}
                      onCancel={stopEdit}
                    />
                  )}
                  {details?.name === name && meta && (
                    <ParamDetails name={name} meta={meta} anchor={details.anchor} onClose={() => setDetails(null)} source={metaSummary} />
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length > MAX_PARAM_SET_ROWS && (
            <p className="text-[10px] text-amber-400 py-1.5">
              {rows.length - MAX_PARAM_SET_ROWS} more match; narrow the patterns to see them.
            </p>
          )}
          {rows.length === 0 && (
            <p className="text-[11px] text-zinc-500 italic py-2">{notDownloaded ? 'Download the parameters to fill in the patterns.' : 'Nothing matches these patterns.'}</p>
          )}
        </div>
      </div>
    </div>
  );
};
