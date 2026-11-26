import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Download,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Sliders,
  Upload,
  X,
  Zap,
} from 'lucide-react';

import { downloadFile } from '../../lib/download';
import {
  compareParams,
  filterEntries,
  writeOutcome,
  type CompareResult,
  type WriteOutcome,
} from '../../lib/paramCompare';
import { mavlinkConnection } from '../../mavlink/connection';
import { getVehicleCategory } from '../../mavlink/messages';
import { bitmaskSummary, valueLabel } from '../../mavlink/paramBits';
import { paramManager, ParamManagerStatus } from '../../mavlink/paramManager';
import { matchesParamQuery, parseParamQuery } from '../../mavlink/paramMatch';
import {
  areParamsDifferent,
  formatParamValue,
  getParamMetadata,
  parseParamFile,
  serializeParamFile,
} from '../../mavlink/paramMetadata';
import { decodePayload } from '../../mavlink/parser';
import { markBusy, onActiveVehicleChange } from '../../mavlink/vehicleRoster';
import { useParamMetaStore } from '../../store/paramMetaStore';
import { useReplaying } from '../../store/replayStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useInPane } from '../dashboard/paneContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { BitmaskEditor, DetailsButton, EnumSelect, ParamDetails, Popover } from './params/ParamEditors';

const ROW_HEIGHT = 38;
const DEFAULT_VIEWPORT_HEIGHT = 440;
const BUFFER = 10;

export { formatParamValue };

/** A write's state in the compare dialog: under way, or what it came to (with the value kept, when another). */
type WriteState = { state: 'writing' } | { state: WriteOutcome; echoed?: number };

export const ParametersWidget: React.FC = () => {
  // In a Cockpit pane: fill it (no minimum heights; lists scroll inside).
  const inPane = useInPane();
  // Use selector so this component ONLY re-renders when parameters or connection state change,
  // NOT on 50Hz attitude, GPS, or VFR_HUD telemetry updates.
  const parameters = useTelemetryStore((state) => state.parameters);
  // A replayed log is not a vehicle to read or write parameters on: treated as no link.
  const replaying = useReplaying();
  const connected =
    useTelemetryStore(
      (state) => state.heartbeat.lastHeartbeatTime > 0 && state.heartbeat.modeName !== 'DISCONNECTED'
    ) && !replaying;
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
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [writeStates, setWriteStates] = useState<Record<string, WriteState>>({});
  const [diffFilter, setDiffFilter] = useState('');
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
    const unsubscribe = paramManager.onStatusChange((st) => setParamStatus(st));
    return () => {
      unsubscribe();
      // Gone (layout changed, widget removed) mid-batch: stop writing rather than carry on unseen.
      abortBatchRef.current = true;
    };
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

  // Automatically fetch parameters when widget opens and link is active without a full parameter list, or when
  // the stored values are from an earlier connection.
  useEffect(() => {
    const needsList = !paramManager.hasParamList(paramKeys) || paramStatus.fromPreviousConnection;
    if (connected && needsList && !paramStatus.isFetching && !autoFetchedRef.current) {
      autoFetchedRef.current = true;
      paramManager.fetchParameters();
    }
    if (!connected) {
      autoFetchedRef.current = false;
    }
  }, [connected, paramKeys, paramStatus.isFetching, paramStatus.fromPreviousConnection]);

  const encoder = mavlinkConnection.getEncoder();

  const handleFetchAll = () => {
    paramManager.fetchParameters();
  };

  const handleStartEdit = (paramId: string, currentVal: number, anchor?: HTMLElement) => {
    if (getParamMetadata(paramId)?.readOnly) return;
    setEditingParam(paramId);
    // The shortest text that reads back as the same stored value (as the table shows it), not the raw float32
    // expansion (0.02727782167494297), which overflows the input.
    setEditValue(formatParamValue(currentVal));
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
    downloadFile(
      `ardupilot-params-${new Date().toISOString().slice(0, 10)}.param`,
      content,
      'text/plain;charset=utf-8'
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const text = await file.text();
    const parsed = parseParamFile(text);
    // Missing (not on this vehicle) only once its full list is read; until then, not read yet.
    // Only a list read whole this connection, and not being fetched now (a partial stream isn't the whole list).
    const listComplete =
      paramStatus.listComplete === true && !paramStatus.isFetching && !paramStatus.fromPreviousConnection;
    const result = compareParams(parsed, parameters, listComplete, getParamMetadata);
    setDiffFileName(file.name);
    setCompare(result);
    // Selected to start: what differs on the vehicle (not what's unread, missing or read-only).
    setSelected(new Set(result.entries.filter((e) => e.writable && e.status === 'differs').map((e) => e.name)));
    setWriteStates({});
    setDiffFilter('');
    setBatchWriteStatus(null);
    setDiffModalOpen(true);
  };

  /**
   * Write one parameter and wait for the vehicle's echo; once more if none comes (a slow or lossy link). The echoed
   * value tells whether it took (the vehicle may refuse or clamp it).
   */
  const writeOne = async (name: string, value: number): Promise<{ outcome: WriteOutcome; echoed?: number }> => {
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = hb.systemId || 1;
    const compId = hb.componentId || 1;
    const pType = parameters[name]?.type ?? 9;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Stopped between tries: no second one.
      if (abortBatchRef.current) return { outcome: 'no-answer' };
      let sent = true;
      const echoed = await new Promise<number | undefined>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        // The vehicle's own echo only: a gimbal, companion or another vehicle may have a parameter of that name.
        const unsub = mavlinkConnection.onPacket((packet) => {
          if (packet.messageId !== 22 || packet.systemId !== sysId || packet.componentId !== compId) return; // PARAM_VALUE
          const data = decodePayload(packet.messageId, packet.payload);
          if (data?.param_id?.trim().toUpperCase() === name.toUpperCase()) finish(data.param_value);
        });
        const finish = (v: number | undefined) => {
          if (timer) clearTimeout(timer);
          unsub();
          resolve(v);
        };
        timer = setTimeout(() => finish(undefined), 1500);
        if (!mavlinkConnection.send(encoder.createParamSet(sysId, compId, name, value, pType))) {
          sent = false;
          finish(undefined);
        }
      });
      if (echoed !== undefined) return { outcome: writeOutcome(value, echoed), echoed };
      // Not sent (no link): retrying won't help.
      if (!sent) return { outcome: 'no-answer' };
    }
    return { outcome: 'no-answer' };
  };

  const handleWriteSelectedDiffs = async () => {
    if (!compare) return;
    const todo = compare.entries.filter((e) => e.writable && selected.has(e.name));
    if (todo.length === 0) return;
    setIsBatchWriting(true);
    abortBatchRef.current = false;
    // A vehicle switch would stop this: the confirmation names it, and the switch stops it.
    markBusy('Writing parameters', true);
    const offSwitch = onActiveVehicleChange(() => (abortBatchRef.current = true));
    const outcomes: Record<string, WriteOutcome> = {};
    for (let i = 0; i < todo.length; i++) {
      if (abortBatchRef.current) break;
      const e = todo[i];
      setBatchWriteStatus(`Writing ${i + 1}/${todo.length}: ${e.name} = ${formatParamValue(e.file)}…`);
      setWriteStates((prev) => ({ ...prev, [e.name]: { state: 'writing' } }));
      const { outcome, echoed } = await writeOne(e.name, e.file);
      outcomes[e.name] = outcome;
      setWriteStates((prev) => ({ ...prev, [e.name]: { state: outcome, echoed } }));
      await new Promise((r) => setTimeout(r, 40));
    }
    const done = Object.values(outcomes);
    const ok = done.filter((o) => o === 'ok').length;
    const kept = done.filter((o) => o === 'kept').length;
    const none = done.filter((o) => o === 'no-answer').length;
    const reboot = todo.filter((e) => outcomes[e.name] === 'ok' && e.rebootRequired).map((e) => e.name);
    offSwitch();
    markBusy('Writing parameters', false);
    setIsBatchWriting(false);
    setBatchWriteStatus(
      `${abortBatchRef.current ? 'Stopped. ' : ''}${ok} written${kept ? `, ${kept} kept another value (refused or limited)` : ''}${none ? `, ${none} not answered` : ''}` +
        `${reboot.length ? `. Reboot to apply: ${reboot.join(', ')}` : ''}.`
    );
  };

  /** The vehicle's current values of the selected parameters, as a .param file: a backup before writing. */
  const backupSelected = () => {
    if (!compare) return;
    const values: Record<string, number> = {};
    for (const e of compare.entries) if (selected.has(e.name) && e.vehicle !== undefined) values[e.name] = e.vehicle;
    if (Object.keys(values).length === 0) return;
    downloadFile(
      `vehicle-before-${diffFileName.replace(/\.param$/i, '')}-${new Date().toISOString().slice(0, 10)}.param`,
      serializeParamFile(values, firmwareVersion),
      'text/plain;charset=utf-8'
    );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the catalog changes what getParamMetadata returns
  }, [paramKeys, parameters, searchQuery, onlyModified, paramMetaCatalog]);

  const hasAnyDefaults = paramStatus.hasDefaults || Object.values(parameters).some((p) => p.defaultValue !== undefined);

  // Virtual window calculation
  const totalCount = filteredKeys.length;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(totalCount, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);
  const visibleKeys = useMemo(() => filteredKeys.slice(startIndex, endIndex), [filteredKeys, startIndex, endIndex]);

  const topPadding = startIndex * ROW_HEIGHT;
  const bottomPadding = Math.max(0, (totalCount - endIndex) * ROW_HEIGHT);

  // The table's own width (the panel can be narrow in a wide window): below 440 px it goes compact (12 px text,
  // tighter cells, a narrower Default column) so names and full values still fit.
  const [tableWidth, setTableWidth] = useState(0);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    setTableWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setTableWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = tableWidth > 0 && tableWidth < 440;
  const cellX = compact ? 'px-2' : 'px-3';

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
    <Card
      className={`flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md ${inPane ? 'min-h-0' : 'min-h-[380px] sm:min-h-[540px]'}`}
    >
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
              <Sliders className="h-4 w-4 text-sky-400" />
              PARAMETERS ({paramKeys.length})
            </CardTitle>
            {paramStatus.method === 'ftp' && (
              <Badge variant="info" className="gap-0.5 font-mono text-[10px]">
                <Zap className="h-2.5 w-2.5" /> MAVFTP
              </Badge>
            )}
            {paramStatus.method === 'legacy' && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                STREAM
              </Badge>
            )}
            {paramMetaStatus !== 'idle' && (
              <span
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  paramMetaStatus === 'loading'
                    ? 'border-zinc-700 text-zinc-400'
                    : paramMetaStatus === 'unavailable'
                      ? 'border-zinc-700 bg-zinc-900 text-zinc-400'
                      : paramMetaSource?.match === 'exact'
                        ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300'
                        : 'border-amber-700/50 bg-amber-950/30 text-amber-300'
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

          <div className="flex flex-wrap items-center gap-1.5">
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
              className="h-7 gap-1 border-zinc-700 px-2 text-xs font-semibold text-zinc-300 hover:text-white"
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
              className="h-7 gap-1 border-zinc-700 px-2 text-xs font-semibold text-zinc-300 hover:text-white disabled:opacity-40"
              title="Export all loaded parameters to a .param file"
            >
              <Download className="h-3 w-3 text-emerald-400" />
              <span className="hidden sm:inline">Save .param</span>
            </Button>

            <Button
              variant={paramStatus.isFetching ? 'destructive' : 'outline'}
              size="sm"
              onClick={paramStatus.isFetching ? () => paramManager.cancelFetch() : handleFetchAll}
              className={`h-7 gap-1 px-2.5 text-xs font-bold transition-colors ${
                paramStatus.isFetching
                  ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300'
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
          <p className="mt-1 animate-pulse font-mono text-[10px] text-sky-400">{paramStatus.message}</p>
        )}
        {paramStatus.fromPreviousConnection && !paramStatus.isFetching && (
          <p className="mt-1 text-[11px] text-amber-400" role="status">
            Values are from the previous connection{connected ? ' and will refresh' : ''}; they may have changed since.
          </p>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 p-3">
        {/* Search & filter row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
            <Input
              type="text"
              placeholder="Search: BATT_*  FS_*  failsafe  -BATT2_*"
              value={search}
              onChange={handleSearchChange}
              className="h-8 pl-8 pr-20 font-mono text-xs sm:text-[13px]"
              aria-describedby="param-search-help"
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {!searchQuery.empty && (
                <span className="font-mono text-[11px] tabular-nums text-zinc-500" aria-live="polite">
                  {filteredKeys.length}/{paramKeys.length}
                </span>
              )}
              <button
                ref={searchHelpRef}
                type="button"
                onClick={() => setSearchHelpOpen((o) => !o)}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:text-sky-300"
                aria-label="Search help"
                aria-expanded={searchHelpOpen}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </div>
            {searchHelpOpen && (
              <Popover
                anchor={searchHelpRef.current}
                onClose={() => setSearchHelpOpen(false)}
                width={320}
                label="Search help"
              >
                <div id="param-search-help" className="space-y-1.5 p-3 text-[11px] leading-snug text-zinc-300">
                  <div className="font-bold text-zinc-100">Searching parameters</div>
                  <p>
                    <code className="text-sky-300">BATT_*</code> <code className="text-sky-300">FS_?_*</code>:{' '}
                    <code>*</code> and <code>?</code> match whole names. Several add up:{' '}
                    <code className="text-sky-300">BATT_* FS_*</code>.
                  </p>
                  <p>
                    <code className="text-sky-300">voltage</code>: other words search the name, short name and
                    description; every word must match. <code className="text-sky-300">BATT_* voltage</code> narrows the
                    battery parameters.
                  </p>
                  <p>
                    <code className="text-sky-300">-BATT2_*</code>: a leading <code>-</code> leaves matches out.
                  </p>
                  <p>
                    <code className="text-sky-300">"low battery"</code>: quotes keep words together. Case doesn't
                    matter.
                  </p>
                </div>
              </Popover>
            )}
          </div>
          {hasAnyDefaults && (
            <button
              onClick={() => setOnlyModified((v) => !v)}
              className={`h-8 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
                onlyModified
                  ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
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
          className={`flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-black/60 ${inPane ? 'min-h-0' : 'max-h-[68vh] min-h-[240px]'}`}
        >
          {filteredKeys.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-zinc-500">
              {paramStatus.isFetching ? (
                <span className="animate-pulse font-mono text-sky-400">
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
                    <Button variant="outline" size="sm" onClick={handleFetchAll} className="mt-1 h-7 gap-1.5 text-xs">
                      <RefreshCw className="h-3 w-3 text-sky-400" /> Load Vehicle Parameters
                    </Button>
                  )}
                </>
              ) : (
                <span>No matching parameters found for "{search}".</span>
              )}
            </div>
          ) : (
            // Fixed layout: the columns keep their share of the panel, and long names, descriptions and value labels
            // truncate inside their own column instead of pushing Default out of view.
            <table className={`w-full table-fixed font-mono ${compact ? 'text-xs' : 'text-xs sm:text-[13px]'}`}>
              <colgroup>
                <col className={hasAnyDefaults ? (compact ? 'w-[46%]' : 'w-[44%]') : 'w-1/2'} />
                <col />
                {hasAnyDefaults && <col className={compact ? 'w-[4.75rem]' : 'w-[6.5rem]'} />}
              </colgroup>
              <thead className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900/95 text-left text-zinc-400 backdrop-blur-sm">
                <tr>
                  <th className={`py-1.5 ${cellX}`}>Parameter</th>
                  <th className={`py-1.5 ${cellX}`}>Value</th>
                  {hasAnyDefaults && (
                    <th className={`py-1.5 ${compact ? 'px-2' : 'px-2 sm:px-3'} text-right`}>Default</th>
                  )}
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
                  const isAtDefault =
                    item.defaultValue === undefined || Math.abs(item.defaultValue - item.value) < 1e-6;
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
                        className={`py-1 ${cellX} overflow-hidden`}
                        title={
                          meta
                            ? `${key}${meta.displayName ? ` · ${meta.displayName}` : ''}${meta.description ? `\n${meta.description}` : ''}`
                            : key
                        }
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="truncate font-semibold text-zinc-200">{key}</span>
                          {meta && (
                            <DetailsButton
                              name={key}
                              onClick={(button) => setDetails((d) => (d?.key === key ? null : { key, anchor: button }))}
                            />
                          )}
                          {meta?.rebootRequired && (
                            <span
                              className="shrink-0 rounded border border-amber-500/30 bg-amber-500/15 px-1 py-0 font-sans text-[9px] text-amber-400"
                              title="Requires flight controller reboot after changing"
                            >
                              Reboot
                            </span>
                          )}
                        </div>
                        {subtitle && (
                          <div className="truncate font-sans text-[11px] leading-tight text-zinc-500">{subtitle}</div>
                        )}
                      </td>
                      <td className={`py-1 ${cellX} overflow-hidden font-mono`}>
                        {isEditing && editor === 'enum' ? (
                          <div className="flex flex-wrap items-center gap-1">
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
                              className="h-5 rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 font-sans text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/30"
                              title="Save parameter"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingParam(null)}
                              className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : isEditing && editor === 'number' ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-1">
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
                                className={`h-6 w-[7.5rem] min-w-0 bg-black/90 px-1 py-0 font-mono text-xs text-sky-300 ${
                                  outOfRange
                                    ? 'border-amber-500 focus:ring-amber-500'
                                    : 'border-sky-500 focus:ring-1 focus:ring-sky-500'
                                }`}
                                autoFocus
                              />
                              {meta?.units && <span className="font-sans text-[11px] text-zinc-400">{meta.units}</span>}
                              <button
                                onClick={() => handleSaveParam(key)}
                                className="h-5 rounded border border-emerald-500/40 bg-emerald-500/20 px-1.5 font-sans text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/30"
                                title="Save parameter"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingParam(null)}
                                className="h-5 px-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                            {(meta?.min !== undefined ||
                              meta?.max !== undefined ||
                              valueLabel(meta?.values, parsedEditNum)) && (
                              <span
                                className={`font-sans text-[10px] ${outOfRange ? 'font-semibold text-amber-400' : 'text-zinc-500'}`}
                              >
                                {meta?.min !== undefined || meta?.max !== undefined
                                  ? `Range: ${meta?.min ?? '—'} to ${meta?.max ?? '—'} ${meta?.units ?? ''}`
                                  : ''}
                                {valueLabel(meta?.values, parsedEditNum)
                                  ? ` · ${valueLabel(meta?.values, parsedEditNum)}`
                                  : ''}
                              </span>
                            )}
                          </div>
                        ) : readOnly ? (
                          <span
                            className="flex min-w-0 items-center gap-1.5 py-0.5 text-zinc-300"
                            title={`${key} is read-only`}
                          >
                            <span className="shrink-0">{formatParamValue(item.value)}</span>
                            {meta?.units && (
                              <span className="min-w-0 truncate font-sans text-[11px] text-zinc-500">{meta.units}</span>
                            )}
                            {enumLabel && (
                              <span className="min-w-0 truncate font-sans text-[11px] text-zinc-500">
                                ({enumLabel})
                              </span>
                            )}
                            <Lock className="h-2.5 w-2.5 shrink-0 text-zinc-600" aria-label="read-only" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => handleStartEdit(key, item.value, e.currentTarget)}
                            className={`-mx-1 flex min-w-0 max-w-[calc(100%+0.5rem)] cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-left text-sky-400 transition-colors hover:bg-sky-500/10 hover:text-sky-300 ${
                              isEditing ? 'bg-sky-500/10 ring-1 ring-sky-500/60' : ''
                            }`}
                            title={`Click to edit ${key} (raw: ${item.value})`}
                            aria-haspopup={meta?.bitmask ? 'dialog' : undefined}
                          >
                            <span className="shrink-0">
                              {formatParamValue(isEditing && editor === 'bitmask' ? parsedEditNum : item.value)}
                            </span>
                            {meta?.units && (
                              <span className="min-w-0 truncate font-sans text-[11px] text-zinc-400">{meta.units}</span>
                            )}
                            {enumLabel && !bitsLabel && (
                              <span className="min-w-0 truncate font-sans text-[11px] text-zinc-400">
                                ({enumLabel})
                              </span>
                            )}
                            {bitsLabel && (
                              <span className="flex min-w-0 items-center gap-0.5 font-sans text-[11px] text-zinc-400">
                                <span className="truncate">
                                  {isEditing && editor === 'bitmask'
                                    ? bitmaskSummary(parsedEditNum, meta!.bitmask!)
                                    : bitsLabel}
                                </span>
                                <ChevronDown className="h-2.5 w-2.5 shrink-0" />
                              </span>
                            )}
                            {isSaved && (
                              <span className="inline-flex shrink-0 animate-pulse items-center gap-0.5 font-sans text-[10px] text-emerald-400">
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
                          className={`py-1 ${compact ? 'px-2' : 'px-2 sm:px-3'} truncate text-right font-mono ${
                            isAtDefault ? 'text-zinc-600' : 'font-medium text-amber-300'
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
      {diffModalOpen &&
        compare &&
        (() => {
          const shown = filterEntries(compare.entries, diffFilter, getParamMetadata);
          const writableShown = shown.filter((e) => e.writable);
          const selectedCount = compare.entries.filter((e) => e.writable && selected.has(e.name)).length;
          const withVehicle = compare.entries.filter((e) => selected.has(e.name) && e.vehicle !== undefined).length;
          const toggle = (name: string, on: boolean) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (on) next.add(name);
              else next.delete(name);
              return next;
            });
          // What a write came to: a clamped or refused write shows the value the vehicle kept.
          const resultOf = (w: WriteState): { text: string; cls: string } =>
            w.state === 'writing'
              ? { text: 'writing…', cls: 'text-sky-300' }
              : w.state === 'ok'
                ? { text: '✓ written', cls: 'text-emerald-400' }
                : w.state === 'kept'
                  ? {
                      text: `kept ${w.echoed !== undefined ? formatParamValue(w.echoed) : 'its value'}`,
                      cls: 'text-amber-300',
                    }
                  : { text: 'no answer', cls: 'text-red-300' };
          const counts = {
            differs: compare.entries.filter((e) => e.status === 'differs').length,
            missing: compare.entries.filter((e) => e.status === 'missing').length,
            unread: compare.entries.filter((e) => e.status === 'unread').length,
          };
          const nothingInFile = compare.entries.length === 0 && compare.same === 0;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
              <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
                <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Upload className="h-4 w-4 shrink-0 text-amber-400" />
                    <h3 className="truncate text-sm font-bold text-zinc-100">
                      Compare Parameter File: <span className="font-mono text-sky-400">{diffFileName}</span>
                    </h3>
                  </div>
                  <button
                    onClick={() => setDiffModalOpen(false)}
                    className="rounded p-1 text-zinc-400 hover:text-zinc-200"
                    aria-label="Close"
                    disabled={isBatchWriting}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto p-4">
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                    <span>
                      <strong className="text-zinc-100">{counts.differs}</strong> differ
                    </span>
                    {counts.missing > 0 && (
                      <span title="In the file but not a parameter of this vehicle (another firmware or vehicle type)">
                        <strong className="text-zinc-100">{counts.missing}</strong> not on this vehicle
                      </span>
                    )}
                    {counts.unread > 0 && (
                      <span title="The vehicle's full list isn't read yet: these may or may not exist">
                        <strong className="text-zinc-100">{counts.unread}</strong> not read yet
                      </span>
                    )}
                    <span>
                      <strong className="text-zinc-100">{compare.same}</strong> same
                    </span>
                    {compare.notInFile > 0 && (
                      <span title="The vehicle's parameters this file doesn't mention (a partial file, or another vehicle's)">
                        <strong className="text-zinc-100">{compare.notInFile}</strong> on the vehicle not in the file
                      </span>
                    )}
                  </div>
                  {nothingInFile ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-amber-300">
                      <AlertTriangle className="h-6 w-6" />
                      <span>
                        No parameters found in {diffFileName}: is it a .param file (NAME,VALUE or NAME VALUE lines)?
                      </span>
                    </div>
                  ) : compare.entries.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-emerald-400">
                      <Check className="h-6 w-6" />
                      <span>All parameters in {diffFileName} match the current vehicle values.</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="relative min-w-[160px] flex-1">
                          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                          <Input
                            value={diffFilter}
                            onChange={(e) => setDiffFilter(e.target.value)}
                            placeholder="Filter by name or description"
                            className="h-8 pl-7 text-xs"
                          />
                        </div>
                        <button
                          onClick={() => setSelected((prev) => new Set([...prev, ...writableShown.map((e) => e.name)]))}
                          className="text-[11px] font-semibold text-sky-400 hover:underline"
                          disabled={isBatchWriting}
                        >
                          Select {diffFilter.trim() ? 'shown' : 'all'}
                        </button>
                        <span className="text-zinc-700">·</span>
                        <button
                          onClick={() =>
                            setSelected((prev) => new Set([...prev].filter((n) => !shown.some((e) => e.name === n))))
                          }
                          className="text-[11px] text-zinc-400 hover:underline"
                          disabled={isBatchWriting}
                        >
                          Clear {diffFilter.trim() ? 'shown' : ''}
                        </button>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-zinc-800">
                        <table className="w-full font-mono text-xs">
                          <thead className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-400">
                            <tr>
                              <th className="w-8 px-2 py-1.5">Write</th>
                              <th className="px-2 py-1.5">Parameter</th>
                              <th className="px-2 py-1.5 text-right">Vehicle</th>
                              <th className="px-2 py-1.5 text-right">File</th>
                              <th className="px-2 py-1.5 text-right">Default</th>
                              <th className="px-2 py-1.5 text-right">Result</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-900">
                            {shown.map((entry) => {
                              const meta = getParamMetadata(entry.name);
                              const state = writeStates[entry.name];
                              const why =
                                entry.status === 'missing'
                                  ? 'not on this vehicle'
                                  : entry.readOnly
                                    ? 'read-only'
                                    : null;
                              return (
                                <tr
                                  key={entry.name}
                                  className={`hover:bg-zinc-900/50 ${entry.writable ? '' : 'opacity-60'}`}
                                >
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="checkbox"
                                      checked={entry.writable && selected.has(entry.name)}
                                      disabled={!entry.writable || isBatchWriting}
                                      title={why ?? undefined}
                                      aria-label={`Write ${entry.name}`}
                                      onChange={(e) => toggle(entry.name, e.target.checked)}
                                      className="rounded border-zinc-700 bg-zinc-900 text-sky-500"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
                                      {entry.name}
                                      {entry.rebootRequired && (
                                        <span
                                          className="font-sans text-[9px] font-bold text-amber-300"
                                          title="Takes effect after a reboot"
                                        >
                                          ↻ reboot
                                        </span>
                                      )}
                                      {why && <span className="font-sans text-[9px] text-zinc-500">{why}</span>}
                                      {entry.status === 'unread' && (
                                        <span
                                          className="font-sans text-[9px] text-zinc-500"
                                          title="The vehicle's full parameter list isn't read: it may or may not have this"
                                        >
                                          not read yet
                                        </span>
                                      )}
                                    </div>
                                    {meta?.description && (
                                      <div className="max-w-[260px] truncate font-sans text-[11px] text-zinc-500">
                                        {meta.description}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-zinc-400">
                                    {entry.vehicle !== undefined ? formatParamValue(entry.vehicle) : '—'}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-bold text-amber-300">
                                    {formatParamValue(entry.file)}
                                    {entry.units ? (
                                      <span className="font-normal text-zinc-500"> {entry.units}</span>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-zinc-500">
                                    {entry.defaultValue !== undefined ? formatParamValue(entry.defaultValue) : ''}
                                  </td>
                                  <td
                                    className={`px-2 py-1.5 text-right text-[11px] ${state ? resultOf(state).cls : ''}`}
                                  >
                                    {state ? resultOf(state).text : ''}
                                  </td>
                                </tr>
                              );
                            })}
                            {shown.length === 0 && (
                              <tr>
                                <td colSpan={6} className="py-3 text-center font-sans text-zinc-500">
                                  Nothing matches "{diffFilter.trim()}".
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {batchWriteStatus && (
                    <div
                      className={`flex items-center gap-2 rounded-lg border p-2.5 text-xs ${
                        isBatchWriting
                          ? 'border-sky-500/40 bg-sky-950/60 text-sky-300'
                          : 'border-zinc-700 bg-zinc-900 text-zinc-200'
                      }`}
                    >
                      {isBatchWriting ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sky-400" />
                      ) : (
                        <Check className="h-4 w-4 shrink-0 text-emerald-400" />
                      )}
                      <span>{batchWriteStatus}</span>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 bg-zinc-900 px-4 py-3">
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                    Review safety-critical parameters before writing to an active vehicle.
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {compare.entries.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={withVehicle === 0 || isBatchWriting}
                        onClick={backupSelected}
                        className="h-8 gap-1.5 text-xs"
                        title="Save the vehicle's current values of the selected parameters (.param)"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Back up these first
                      </Button>
                    )}
                    {isBatchWriting ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => (abortBatchRef.current = true)}
                        className="h-8 text-xs font-bold"
                      >
                        Stop writing
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setDiffModalOpen(false)} className="h-8 text-xs">
                        Close
                      </Button>
                    )}
                    {compare.entries.length > 0 && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={!connected || isBatchWriting || selectedCount === 0}
                        onClick={handleWriteSelectedDiffs}
                        className="h-8 gap-1.5 bg-sky-600 text-xs font-bold text-white hover:bg-sky-500"
                      >
                        {isBatchWriting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Write Selected ({selectedCount}) to Vehicle
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </Card>
  );
};
