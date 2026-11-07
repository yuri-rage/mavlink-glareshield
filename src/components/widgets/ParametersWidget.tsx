import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { paramManager, ParamManagerStatus } from '../../mavlink/paramManager';
import {
  getParamMetadata,
  parseParamFile,
  serializeParamFile,
  areParamsDifferent,
} from '../../mavlink/paramMetadata';
import { useParamMetaStore } from '../../store/paramMetaStore';
import { bitmaskSummary, valueLabel } from '../../mavlink/paramBits';
import { BitmaskEditor, DetailsButton, EnumSelect, ParamDetails, Popover } from './params/ParamEditors';
import { matchesParamQuery, parseParamQuery } from '../../mavlink/paramMatch';
import { getVehicleCategory } from '../../mavlink/messages';
import { decodePayload } from '../../mavlink/parser';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Sliders, RefreshCw, Check, Search, Zap, X, Download, Upload, AlertTriangle, Info, Loader2, Lock, ChevronDown } from 'lucide-react';

const ROW_HEIGHT = 38;
const DEFAULT_VIEWPORT_HEIGHT = 440;
const BUFFER = 10;

export function formatParamValue(val: number): string {
  if (val === undefined || val === null || isNaN(val)) return '-';
  if (Number.isInteger(val)) return val.toString();
  if (Math.abs(val) < 0.0001 && val !== 0) {
    return Number(val.toPrecision(9)).toString();
  }
  return parseFloat(val.toFixed(4)).toString();
}

interface ParamDiffEntry {
  name: string;
  currentValue: number | undefined;
  fileValue: number;
  selected: boolean;
}

export const ParametersWidget: React.FC = () => {
  // Use selector so this component ONLY re-renders when parameters or connection state change,
  // NOT on 50Hz attitude, GPS, or VFR_HUD telemetry updates.
  const parameters = useTelemetryStore((state) => state.parameters);
  const connected = useTelemetryStore(
    (state) => state.heartbeat.lastHeartbeatTime > 0 && state.heartbeat.modeName !== 'DISCONNECTED'
  );
  const firmwareVersion = useTelemetryStore((state) => state.firmwareVersion);

  const [search, setSearch] = useState('');
  const [onlyModified, setOnlyModified] = useState(false);
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);
  /** Typing a number for a named-value parameter ("Other value…"), instead of the dropdown. */
  const [editCustom, setEditCustom] = useState(false);
  /** The value cell being edited, which the bitmask checklist opens beside. */
  const [editAnchor, setEditAnchor] = useState<HTMLElement | null>(null);
  const [details, setDetails] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [searchHelpOpen, setSearchHelpOpen] = useState(false);
  const searchHelpRef = useRef<HTMLButtonElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);

  // .param file compare/load state
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffFileName, setDiffFileName] = useState('');
  const [diffEntries, setDiffEntries] = useState<ParamDiffEntry[]>([]);
  const [batchWriteStatus, setBatchWriteStatus] = useState<string | null>(null);
  const [isBatchWriting, setIsBatchWriting] = useState(false);
  const abortBatchRef = useRef<boolean>(false);

  const heartbeatType = useTelemetryStore((s) => s.heartbeat.type);
  const category = getVehicleCategory(heartbeatType);

  // Metadata for this vehicle and firmware version; the table re-renders when it arrives.
  const ensureParamMeta = useParamMetaStore((s) => s.ensure);
  const paramMetaStatus = useParamMetaStore((s) => s.status);
  const paramMetaCatalog = useParamMetaStore((s) => s.catalog);
  const paramMetaSource = useParamMetaStore((s) => s.source);
  const paramMetaSummary = useParamMetaStore((s) => s.summary);
  useEffect(() => {
    ensureParamMeta(category, firmwareVersion);
  }, [category, firmwareVersion, ensureParamMeta]);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFetchedRef = useRef(false);

  const [paramStatus, setParamStatus] = useState<ParamManagerStatus>({
    isFetching: false,
    method: 'idle',
    paramCount: 0,
  });

  useEffect(() => {
    return paramManager.onStatusChange((st) => setParamStatus(st));
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Dynamically measure scroll container height for virtualization
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const h = entry.contentRect.height;
        if (h > 100) {
          setViewportHeight(h);
        }
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const paramKeys = useMemo(() => Object.keys(parameters), [parameters]);

  // Automatically fetch parameters when widget opens and link is active without a full parameter list
  useEffect(() => {
    if (connected && !paramManager.hasParamList(paramKeys) && !paramStatus.isFetching && !autoFetchedRef.current) {
      autoFetchedRef.current = true;
      paramManager.fetchParameters();
    }
    if (!connected) {
      autoFetchedRef.current = false;
    }
  }, [connected, paramKeys, paramStatus.isFetching]);

  const encoder = mavlinkConnection.getEncoder();

  const handleFetchAll = () => {
    paramManager.fetchParameters();
  };

  const handleStartEdit = (paramId: string, currentVal: number, anchor?: HTMLElement) => {
    if (getParamMetadata(paramId)?.readOnly) return;
    setEditingParam(paramId);
    setEditValue(currentVal.toString());
    setEditCustom(false);
    setEditAnchor(anchor ?? null);
  };

  const handleSaveParam = (paramId: string) => {
    const num = parseFloat(editValue);
    // The vehicle would refuse it anyway; don't send a write for a read-only parameter.
    if (getParamMetadata(paramId)?.readOnly) {
      setEditingParam(null);
      return;
    }
    if (!isNaN(num)) {
      const hb = useTelemetryStore.getState().heartbeat;
      const p = parameters[paramId];
      const cmd = encoder.createParamSet(hb.systemId || 1, hb.componentId || 1, paramId, num, p ? p.type : 9);
      mavlinkConnection.send(cmd);

      setSavedSuccess(paramId);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => {
        setSavedSuccess((cur) => (cur === paramId ? null : cur));
      }, 2500);
      setEditingParam(null);
    }
  };

  const handleExportParams = () => {
    if (paramKeys.length === 0) return;
    const plainMap: Record<string, number> = {};
    for (const k of paramKeys) {
      plainMap[k] = parameters[k].value;
    }
    const content = serializeParamFile(plainMap, firmwareVersion);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `ardupilot-params-${datePart}.param`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const text = await file.text();
    const parsed = parseParamFile(text);
    const diffs: ParamDiffEntry[] = [];

    for (const [name, fileVal] of Object.entries(parsed)) {
      const current = parameters[name]?.value;
      const isDifferent = current === undefined || areParamsDifferent(current, fileVal);
      if (isDifferent) {
        diffs.push({
          name,
          currentValue: current,
          fileValue: fileVal,
          selected: current !== undefined, // default select existing differing params
        });
      }
    }

    diffs.sort((a, b) => a.name.localeCompare(b.name));
    setDiffFileName(file.name);
    setDiffEntries(diffs);
    setBatchWriteStatus(null);
    setDiffModalOpen(true);
  };

  const handleWriteSelectedDiffs = async () => {
    const selected = diffEntries.filter((d) => d.selected);
    if (selected.length === 0) return;
    setIsBatchWriting(true);
    abortBatchRef.current = false;
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = hb.systemId || 1;
    const compId = hb.componentId || 1;

    let confirmed = 0;
    for (let i = 0; i < selected.length; i++) {
      if (abortBatchRef.current) {
        setBatchWriteStatus(`Batch write aborted (${confirmed}/${selected.length} confirmed).`);
        setIsBatchWriting(false);
        return;
      }
      const entry = selected[i];
      setBatchWriteStatus(`Writing ${i + 1}/${selected.length}: ${entry.name} (${entry.fileValue})…`);

      const existing = parameters[entry.name];
      const pType = existing ? existing.type : 9;

      const success = await new Promise<boolean>((resolve) => {
        let timer: any = null;
        let unsub: (() => void) | null = null;
        const finish = (ok: boolean) => {
          if (timer) clearTimeout(timer);
          if (unsub) unsub();
          resolve(ok);
        };

        unsub = mavlinkConnection.onPacket((packet) => {
          if (packet.messageId === 22) {
            // PARAM_VALUE
            const data = decodePayload(packet.messageId, packet.payload);
            const pId = data?.param_id?.trim();
            if (pId === entry.name) {
              finish(true);
            }
          }
        });

        timer = setTimeout(() => {
          finish(false);
        }, 850);

        const cmd = encoder.createParamSet(sysId, compId, entry.name, entry.fileValue, pType);
        const sent = mavlinkConnection.send(cmd);
        if (!sent) finish(false);
      });

      if (success) confirmed++;
      await new Promise((r) => setTimeout(r, 60));
    }

    setIsBatchWriting(false);
    setBatchWriteStatus(`Batch write finished: ${confirmed}/${selected.length} confirmed by vehicle.`);
    setTimeout(() => {
      if (!abortBatchRef.current) {
        setDiffModalOpen(false);
        setBatchWriteStatus(null);
      }
    }, 2000);
  };

  const searchQuery = useMemo(() => parseParamQuery(search), [search]);
  const filteredKeys = useMemo(() => {
    const matched = paramKeys.filter((k) => {
      if (onlyModified) {
        const p = parameters[k];
        if (!p || p.defaultValue === undefined || !areParamsDifferent(p.value, p.defaultValue)) {
          return false;
        }
      }
      return matchesParamQuery(k, getParamMetadata(k), searchQuery);
    });
    return matched.sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the catalogue changes what getParamMetadata returns
  }, [paramKeys, parameters, searchQuery, onlyModified, paramMetaCatalog]);

  const hasAnyDefaults = paramStatus.hasDefaults || Object.values(parameters).some((p) => p.defaultValue !== undefined);

  // Virtual window calculation
  const totalCount = filteredKeys.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);
  const visibleKeys = useMemo(() => filteredKeys.slice(startIndex, endIndex), [filteredKeys, startIndex, endIndex]);

  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setScrollTop(0);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md flex flex-col h-full min-h-[380px] sm:min-h-[540px]">
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
              <Sliders className="h-4 w-4 text-sky-400" />
              PARAMETERS ({paramKeys.length})
            </CardTitle>
            {paramStatus.method === 'ftp' && (
              <Badge variant="info" className="text-[9px] font-mono gap-0.5">
                <Zap className="h-2.5 w-2.5" /> MAVFTP
              </Badge>
            )}
            {paramStatus.method === 'legacy' && (
              <Badge variant="secondary" className="text-[9px] font-mono">
                STREAM
              </Badge>
            )}
            {paramMetaStatus !== 'idle' && (
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${
                  paramMetaStatus === 'loading'
                    ? 'text-zinc-400 border-zinc-700'
                    : paramMetaStatus === 'unavailable'
                      ? 'text-zinc-400 border-zinc-700 bg-zinc-900'
                      : paramMetaSource?.match === 'exact'
                        ? 'text-emerald-300 border-emerald-700/50 bg-emerald-950/30'
                        : 'text-amber-300 border-amber-700/50 bg-amber-950/30'
                }`}
                title={paramMetaSummary}
                aria-label={paramMetaSummary}
              >
                {paramMetaStatus === 'loading' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {paramMetaStatus === 'ready' && paramMetaSource
                  ? `${paramMetaSource.folder.replace('-', ' ')}${paramMetaSource.match === 'dev-same-minor' ? ' dev' : paramMetaSource.match === 'earlier' ? ' ≈' : ''}`
                  : paramMetaStatus === 'loading'
                    ? 'Metadata'
                    : 'Built-in'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              ref={fileInputRef}
              type="file"
              accept=".param,.parm,.txt"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2 text-[11px] font-semibold gap-1 text-zinc-300 hover:text-white border-zinc-700"
              title="Load and compare a .param file against current vehicle parameters"
            >
              <Upload className="h-3 w-3 text-amber-400" />
              <span className="hidden sm:inline">Compare .param</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              disabled={paramKeys.length === 0}
              onClick={handleExportParams}
              className="h-7 px-2 text-[11px] font-semibold gap-1 text-zinc-300 hover:text-white border-zinc-700 disabled:opacity-40"
              title="Export all loaded parameters to a .param file"
            >
              <Download className="h-3 w-3 text-emerald-400" />
              <span className="hidden sm:inline">Save .param</span>
            </Button>

            <Button
              variant={paramStatus.isFetching ? 'destructive' : 'outline'}
              size="sm"
              onClick={paramStatus.isFetching ? () => paramManager.cancelFetch() : handleFetchAll}
              className={`h-7 px-2.5 text-xs font-bold gap-1 transition-colors ${
                paramStatus.isFetching
                  ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300'
                  : 'text-zinc-300 hover:text-white'
              }`}
              title={paramStatus.isFetching ? 'Cancel parameter fetch' : 'Fetch parameters from vehicle'}
            >
              {paramStatus.isFetching ? (
                <>
                  <X className="h-3.5 w-3.5 text-red-400" />
                  <span>Cancel</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 text-sky-400" />
                  <span>Refresh</span>
                </>
              )}
            </Button>
          </div>
        </div>
        {paramStatus.message && paramStatus.isFetching && (
          <p className="text-[10px] text-sky-400 font-mono mt-1 animate-pulse">
            {paramStatus.message}
          </p>
        )}
      </CardHeader>

      <CardContent className="p-3 flex-1 flex flex-col space-y-2">
        {/* Search & filter row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search: BATT_*  FS_*  failsafe  -BATT2_*"
              value={search}
              onChange={handleSearchChange}
              className="h-8 pl-8 pr-20 text-xs font-mono"
              aria-describedby="param-search-help"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {!searchQuery.empty && (
                <span className="text-[10px] font-mono text-zinc-500 tabular-nums" aria-live="polite">
                  {filteredKeys.length}/{paramKeys.length}
                </span>
              )}
              <button
                ref={searchHelpRef}
                type="button"
                onClick={() => setSearchHelpOpen((o) => !o)}
                className="h-5 w-5 inline-flex items-center justify-center rounded text-zinc-500 hover:text-sky-300"
                aria-label="Search help"
                aria-expanded={searchHelpOpen}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchHelpOpen && (
              <Popover anchor={searchHelpRef.current} onClose={() => setSearchHelpOpen(false)} width={320} label="Search help">
                <div id="param-search-help" className="p-3 space-y-1.5 text-[11px] text-zinc-300 leading-snug">
                  <div className="font-bold text-zinc-100">Searching parameters</div>
                  <p>
                    <code className="text-sky-300">BATT_*</code> <code className="text-sky-300">FS_?_*</code>: <code>*</code> and <code>?</code> match
                    whole names. Several add up: <code className="text-sky-300">BATT_* FS_*</code>.
                  </p>
                  <p>
                    <code className="text-sky-300">voltage</code>: other words search the name, short name and description; every word must match.{' '}
                    <code className="text-sky-300">BATT_* voltage</code> narrows the battery parameters.
                  </p>
                  <p>
                    <code className="text-sky-300">-BATT2_*</code>: a leading <code>-</code> leaves matches out.
                  </p>
                  <p>
                    <code className="text-sky-300">"low battery"</code>: quotes keep words together. Case doesn't matter.
                  </p>
                </div>
              </Popover>
            )}
          </div>
          {hasAnyDefaults && (
            <button
              onClick={() => setOnlyModified((v) => !v)}
              className={`h-8 px-2.5 rounded-lg border text-[11px] font-semibold whitespace-nowrap transition-colors ${
                onlyModified
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              title="Show only parameters that differ from firmware defaults"
            >
              Modified Only
            </button>
          )}
        </div>

        {/* Param List Table (Virtualized, expands to fill card) */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 bg-black/60 rounded-xl border border-zinc-800 overflow-y-auto min-h-[240px] max-h-[68vh]"
        >
          {filteredKeys.length === 0 ? (
            <div className="text-zinc-500 text-center py-10 px-4 text-xs flex flex-col items-center gap-2">
              {paramStatus.isFetching ? (
                <span className="text-sky-400 font-mono animate-pulse">
                  Downloading parameters from flight controller...
                </span>
              ) : paramKeys.length === 0 ? (
                <>
                  <span>
                    {connected
                      ? 'No parameters loaded yet.'
                      : 'No telemetry link active — connect a vehicle to inspect or edit parameters.'}
                  </span>
                  {connected && (
                    <Button variant="outline" size="sm" onClick={handleFetchAll} className="mt-1 h-7 text-xs gap-1.5">
                      <RefreshCw className="h-3 w-3 text-sky-400" /> Load Vehicle Parameters
                    </Button>
                  )}
                </>
              ) : (
                <span>No matching parameters found for "{search}".</span>
              )}
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
              <thead className="bg-zinc-900/95 sticky top-0 border-b border-zinc-800 text-zinc-400 text-left z-10 backdrop-blur-sm">
                <tr>
                  <th className="py-1.5 px-3">Parameter</th>
                  <th className="py-1.5 px-3">Value</th>
                  {hasAnyDefaults && <th className="py-1.5 px-3 text-right">Default</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900/80">
                {topPadding > 0 && (
                  <tr>
                    <td colSpan={hasAnyDefaults ? 3 : 2} style={{ height: `${topPadding}px` }} />
                  </tr>
                )}
                {visibleKeys.map((key) => {
                  const item = parameters[key];
                  if (!item) return null;
                  const meta = getParamMetadata(key);
                  const isEditing = editingParam === key;
                  const isSaved = savedSuccess === key;
                  const defVal = item.defaultValue !== undefined ? item.defaultValue : item.value;
                  const isAtDefault = item.defaultValue === undefined || Math.abs(item.defaultValue - item.value) < 1e-6;
                  const enumLabel = valueLabel(meta?.values, item.value);
                  const bitsLabel = meta?.bitmask ? bitmaskSummary(item.value, meta.bitmask) : undefined;
                  const readOnly = Boolean(meta?.readOnly);
                  // Which editor: a checklist for bitmasks, a dropdown for named values, otherwise a number.
                  const editor: 'bitmask' | 'enum' | 'number' = editCustom
                    ? 'number'
                    : meta?.bitmask
                      ? 'bitmask'
                      : meta?.values && Object.keys(meta.values).length > 0
                        ? 'enum'
                        : 'number';
                  const parsedEditNum = parseFloat(editValue);
                  const outOfRange =
                    isEditing &&
                    !isNaN(parsedEditNum) &&
                    ((meta?.min !== undefined && parsedEditNum < meta.min) ||
                      (meta?.max !== undefined && parsedEditNum > meta.max));
                  const subtitle = meta?.displayName || meta?.description;

                  return (
                    <tr key={key} className="h-[38px] hover:bg-zinc-900/40">
                      <td
                        className="py-1 px-3 max-w-[230px]"
                        title={meta ? `${key}${meta.displayName ? ` · ${meta.displayName}` : ''}${meta.description ? `\n${meta.description}` : ''}` : key}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-semibold text-zinc-200 truncate">{key}</span>
                          {meta && (
                            <DetailsButton
                              name={key}
                              onClick={(button) => setDetails((d) => (d?.key === key ? null : { key, anchor: button }))}
                            />
                          )}
                          {meta?.rebootRequired && (
                            <span
                              className="text-[9px] px-1 py-0 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 font-sans shrink-0"
                              title="Requires flight controller reboot after changing"
                            >
                              Reboot
                            </span>
                          )}
                        </div>
                        {subtitle && <div className="text-[10px] text-zinc-500 font-sans truncate leading-tight">{subtitle}</div>}
                      </td>
                      <td className="py-1 px-3 font-mono">
                        {isEditing && editor === 'enum' ? (
                          <div className="flex items-center gap-1">
                            <EnumSelect
                              name={key}
                              values={meta!.values!}
                              editValue={editValue}
                              onChange={setEditValue}
                              onSave={() => handleSaveParam(key)}
                              onCancel={() => setEditingParam(null)}
                              onCustom={() => setEditCustom(true)}
                            />
                            <button
                              onClick={() => handleSaveParam(key)}
                              className="h-5 px-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded border border-emerald-500/40 font-sans font-semibold"
                              title="Save parameter"
                            >
                              Save
                            </button>
                            <button onClick={() => setEditingParam(null)} className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200" title="Cancel">
                              ✕
                            </button>
                          </div>
                        ) : isEditing && editor === 'number' ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                step={meta?.increment ?? 'any'}
                                min={meta?.min}
                                max={meta?.max}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveParam(key);
                                  } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingParam(null);
                                  }
                                }}
                                className={`h-6 w-24 text-xs font-mono px-1 py-0 bg-black/90 text-sky-300 ${
                                  outOfRange ? 'border-amber-500 focus:ring-amber-500' : 'border-sky-500 focus:ring-1 focus:ring-sky-500'
                                }`}
                                autoFocus
                              />
                              {meta?.units && <span className="text-[10px] text-zinc-400 font-sans">{meta.units}</span>}
                              <button
                                onClick={() => handleSaveParam(key)}
                                className="h-5 px-1.5 text-[10px] bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded border border-emerald-500/40 font-sans font-semibold"
                                title="Save parameter"
                              >
                                Save
                              </button>
                              <button onClick={() => setEditingParam(null)} className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200" title="Cancel">
                                ✕
                              </button>
                            </div>
                            {(meta?.min !== undefined || meta?.max !== undefined || valueLabel(meta?.values, parsedEditNum)) && (
                              <span className={`text-[9px] font-sans ${outOfRange ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
                                {meta?.min !== undefined || meta?.max !== undefined
                                  ? `Range: ${meta?.min ?? '—'} to ${meta?.max ?? '—'} ${meta?.units ?? ''}`
                                  : ''}
                                {valueLabel(meta?.values, parsedEditNum) ? ` · ${valueLabel(meta?.values, parsedEditNum)}` : ''}
                              </span>
                            )}
                          </div>
                        ) : readOnly ? (
                          <span className="inline-flex items-center gap-1.5 text-zinc-300 px-1 py-0.5 -mx-1" title={`${key} is read-only`}>
                            <span>{formatParamValue(item.value)}</span>
                            {meta?.units && <span className="text-[10px] text-zinc-500 font-sans">{meta.units}</span>}
                            {enumLabel && <span className="text-[10px] text-zinc-500 font-sans truncate max-w-[130px]">({enumLabel})</span>}
                            <Lock className="h-2.5 w-2.5 text-zinc-600" aria-label="read-only" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(key, item.value, e.currentTarget)}
                            className={`inline-flex items-center gap-1.5 text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 px-1 py-0.5 -mx-1 rounded cursor-pointer transition-colors max-w-full text-left ${
                              isEditing ? 'bg-sky-500/10 ring-1 ring-sky-500/60' : ''
                            }`}
                            title={`Click to edit ${key} (raw: ${item.value})`}
                            aria-haspopup={meta?.bitmask ? 'dialog' : undefined}
                          >
                            <span>{formatParamValue(isEditing && editor === 'bitmask' ? parsedEditNum : item.value)}</span>
                            {meta?.units && <span className="text-[10px] text-zinc-400 font-sans">{meta.units}</span>}
                            {enumLabel && !bitsLabel && (
                              <span className="text-[10px] text-zinc-400 font-sans truncate max-w-[130px]">({enumLabel})</span>
                            )}
                            {bitsLabel && (
                              <span className="text-[10px] text-zinc-400 font-sans truncate max-w-[160px] inline-flex items-center gap-0.5">
                                {isEditing && editor === 'bitmask' ? bitmaskSummary(parsedEditNum, meta!.bitmask!) : bitsLabel}
                                <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                              </span>
                            )}
                            {isSaved && (
                              <span className="text-emerald-400 text-[10px] inline-flex items-center gap-0.5 animate-pulse font-sans">
                                <Check className="h-2.5 w-2.5" /> Saved
                              </span>
                            )}
                          </button>
                        )}
                        {isEditing && editor === 'bitmask' && meta?.bitmask && (
                          <BitmaskEditor
                            name={key}
                            bitmask={meta.bitmask}
                            value={parsedEditNum}
                            original={item.value}
                            anchor={editAnchor}
                            onChange={(v) => setEditValue(String(v))}
                            onSave={() => handleSaveParam(key)}
                            onCancel={() => setEditingParam(null)}
                          />
                        )}
                        {details?.key === key && meta && (
                          <ParamDetails
                            name={key}
                            meta={meta}
                            anchor={details.anchor}
                            onClose={() => setDetails(null)}
                            source={paramMetaSummary}
                            defaultValue={item.defaultValue}
                          />
                        )}
                      </td>
                      {hasAnyDefaults && (
                        <td
                          className={`py-1 px-3 font-mono text-right truncate max-w-[120px] ${
                            isAtDefault ? 'text-zinc-600' : 'text-amber-300 font-medium'
                          }`}
                          title={`Default: ${defVal}`}
                        >
                          {formatParamValue(defVal)}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {bottomPadding > 0 && (
                  <tr>
                    <td colSpan={hasAnyDefaults ? 3 : 2} style={{ height: `${bottomPadding}px` }} />
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </CardContent>

      {/* Parameter File Compare & Batch Load Modal */}
      {diffModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-bold text-zinc-100">
                  Compare Parameter File: <span className="font-mono text-sky-400">{diffFileName}</span>
                </h3>
              </div>
              <button
                onClick={() => setDiffModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {diffEntries.length === 0 ? (
                <div className="text-center py-8 text-xs text-emerald-400 flex flex-col items-center gap-2">
                  <Check className="h-6 w-6" />
                  <span>All parameters in {diffFileName} match the current vehicle values.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                    <span className="flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      Found <strong className="text-zinc-100">{diffEntries.length}</strong> differing parameter(s). Select parameters to write to the vehicle.
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setDiffEntries((prev) => prev.map((e) => ({ ...e, selected: true })))
                        }
                        className="text-[11px] text-sky-400 hover:underline font-semibold"
                      >
                        Select All
                      </button>
                      <span className="text-zinc-700">·</span>
                      <button
                        onClick={() =>
                          setDiffEntries((prev) => prev.map((e) => ({ ...e, selected: false })))
                        }
                        className="text-[11px] text-zinc-400 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    <table className="w-full text-xs font-mono">
                      <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800 text-left">
                        <tr>
                          <th className="py-1.5 px-3 w-8">Write</th>
                          <th className="py-1.5 px-3">Parameter</th>
                          <th className="py-1.5 px-3 text-right">Vehicle</th>
                          <th className="py-1.5 px-3 text-right">File Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900">
                        {diffEntries.map((entry, idx) => {
                          const meta = getParamMetadata(entry.name);
                          return (
                            <tr key={entry.name} className="hover:bg-zinc-900/50">
                              <td className="py-1.5 px-3">
                                <input
                                  type="checkbox"
                                  checked={entry.selected}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setDiffEntries((prev) =>
                                      prev.map((item, i) => (i === idx ? { ...item, selected: checked } : item))
                                    );
                                  }}
                                  className="rounded border-zinc-700 bg-zinc-900 text-sky-500"
                                />
                              </td>
                              <td className="py-1.5 px-3">
                                <div className="font-semibold text-zinc-200">{entry.name}</div>
                                {meta?.description && (
                                  <div className="text-[10px] text-zinc-500 font-sans truncate max-w-[260px]">
                                    {meta.description}
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 px-3 text-right text-zinc-400">
                                {entry.currentValue !== undefined ? formatParamValue(entry.currentValue) : 'Not Loaded'}
                              </td>
                              <td className="py-1.5 px-3 text-right text-amber-300 font-bold">
                                {formatParamValue(entry.fileValue)}
                                {meta?.units ? ` ${meta.units}` : ''}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {batchWriteStatus && (
                <div
                  className={`p-2.5 rounded-lg border text-xs flex items-center gap-2 ${
                    isBatchWriting
                      ? 'bg-sky-950/60 border-sky-500/40 text-sky-300'
                      : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {isBatchWriting ? (
                    <Loader2 className="h-4 w-4 animate-spin text-sky-400 shrink-0" />
                  ) : (
                    <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                  <span>{batchWriteStatus}</span>
                </div>
              )}
            </div>

            <div className="px-4 py-3 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between">
              <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                Review safety-critical parameters before writing to an active vehicle.
              </span>
              <div className="flex items-center gap-2">
                {isBatchWriting ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      abortBatchRef.current = true;
                    }}
                    className="h-8 text-xs font-bold"
                  >
                    Abort Write
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDiffModalOpen(false)}
                    className="h-8 text-xs"
                  >
                    Close
                  </Button>
                )}
                {diffEntries.length > 0 && (
                  <Button
                    variant="default"
                    size="sm"
                    disabled={
                      !connected ||
                      isBatchWriting ||
                      diffEntries.filter((d) => d.selected).length === 0
                    }
                    onClick={handleWriteSelectedDiffs}
                    className="h-8 text-xs bg-sky-600 hover:bg-sky-500 text-white font-bold gap-1.5"
                  >
                    {isBatchWriting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Write Selected ({diffEntries.filter((d) => d.selected).length}) to Vehicle
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
