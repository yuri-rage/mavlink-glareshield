// Onboard logs: the vehicle's DataFlash (.bin) logs, listed and downloaded to this computer (mavlink/logManager.ts).

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { AlertTriangle, Download, FileText, Loader2, RefreshCw, Trash2, X } from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { cn } from '../../lib/utils';
import {
  downloadName,
  logManager,
  type LogEntry,
  type LogList,
  type LogTransferMethod,
} from '../../mavlink/logManager';
import { onActiveVehicleChange } from '../../mavlink/vehicleRoster';
import { useTelemetryStore } from '../../store/telemetryStore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { useVehicleTarget } from './custom/panelKit';
import { TlogList } from './TlogList';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--';
  if (sec < 60) return `${Math.ceil(sec)} s`;
  return `${Math.floor(sec / 60)} min ${Math.ceil(sec % 60)} s`;
}

function formatStart(entry: LogEntry): string {
  if (!entry.timeUtc) return 'No time (no GPS at start)';
  return new Date(entry.timeUtc * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const saveBytes = (data: Uint8Array, name: string) => downloadFile(name, data);

interface Transfer {
  id: number;
  received: number;
  total: number;
  method: LogTransferMethod | null;
  startedAt: number;
}

type RowResult = { kind: 'saved'; method: LogTransferMethod; seconds: number } | { kind: 'failed'; text: string };

export const LogsWidget: React.FC = () => {
  const { sysId, compId } = useVehicleTarget();
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const armed = useTelemetryStore((s) => s.heartbeat.isArmed);
  const maxLogFiles = useTelemetryStore((s) => s.parameters.LOG_MAX_FILES?.value);

  const [list, setList] = useState<LogList | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [confirmErase, setConfirmErase] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // set again on a remount (React's development double mount)
    return () => {
      mounted.current = false;
      logManager.cancel();
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!linked || armed || listing || logManager.busy) return;
    setListing(true);
    setListError(null);
    try {
      const l = await logManager.listLogs(sysId, compId);
      // Still the vehicle it was asked of (not switched meanwhile): else the result, or the "Canceled" a switch
      // causes, isn't the new vehicle's.
      if (mounted.current && useTelemetryStore.getState().heartbeat.systemId === sysId) setList(l);
    } catch (e) {
      if (mounted.current && useTelemetryStore.getState().heartbeat.systemId === sysId)
        setListError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setListing(false);
    }
  }, [linked, armed, listing, sysId, compId]);

  // Another vehicle is commanded: the old one's list, results and an open erase prompt go (erasing would now act on
  // the new vehicle's logs).
  useEffect(
    () =>
      onActiveVehicleChange(() => {
        setList(null);
        setResults({});
        setListError(null);
        setConfirmErase(false);
      }),
    []
  );

  // List once when the vehicle is there and disarmed.
  const listedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${sysId}/${compId}`;
    // Not while a listing (perhaps the old vehicle's, ending after a switch) is still settling: refresh would return
    // without listing, and the key would stay taken. This runs again when it ends.
    if (!linked || armed || listing || listedFor.current === key) return;
    listedFor.current = key;
    void refresh();
  }, [linked, armed, listing, sysId, compId, refresh]);
  useEffect(() => {
    if (!linked) listedFor.current = null;
  }, [linked]);

  const download = async (entry: LogEntry) => {
    if (!list || transfer) return;
    setResults((r) => {
      const next = { ...r };
      delete next[entry.id];
      return next;
    });
    const startedAt = Date.now();
    setTransfer({ id: entry.id, received: 0, total: entry.size, method: null, startedAt });
    try {
      const { data, method } = await logManager.download(
        entry,
        list,
        sysId,
        compId,
        (p) => mounted.current && setTransfer((t) => (t && t.id === entry.id ? { ...t, ...p } : t)),
        maxLogFiles && maxLogFiles > 0 ? maxLogFiles : undefined
      );
      saveBytes(data, downloadName(entry));
      if (mounted.current)
        setResults((r) => ({ ...r, [entry.id]: { kind: 'saved', method, seconds: (Date.now() - startedAt) / 1000 } }));
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (mounted.current) setResults((r) => ({ ...r, [entry.id]: { kind: 'failed', text } }));
    } finally {
      if (mounted.current) setTransfer(null);
    }
  };

  const erase = () => {
    setConfirmErase(false);
    logManager.erase(sysId, compId);
    setList(null);
    setResults({});
    // Erasing takes the vehicle a moment.
    setTimeout(() => mounted.current && void refresh(), 2500);
  };

  const blocked = !linked
    ? 'Connect to a vehicle to see its logs.'
    : armed
      ? 'ArduPilot does not send logs while armed. Disarm to list or download them.'
      : null;
  const entries = list ? [...list.entries].reverse() : []; // newest first
  const totalSize = entries.reduce((n, e) => n + e.size, 0);

  return (
    <Card className="flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <CardTitle className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
          <span className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-sky-400" />
            Logs
          </span>
          <div className="flex items-center gap-1.5 font-normal normal-case tracking-normal">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={!!blocked || listing || !!transfer}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              title="Ask the vehicle for its log list"
            >
              <RefreshCw className={cn('h-3 w-3', listing && 'animate-spin')} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setConfirmErase((c) => !c)}
              disabled={!!blocked || !!transfer || !list || list.numLogs === 0}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-0.5 text-[11px] font-bold uppercase text-zinc-400 hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
              title="Delete every log on the vehicle"
            >
              <Trash2 className="h-3 w-3" />
              Erase all
            </button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 text-xs sm:p-3">
        {confirmErase && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-red-800/60 bg-red-950/40 p-2"
            role="alertdialog"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span className="min-w-[12rem] flex-1 text-red-200">
              Delete all {list?.numLogs ?? ''} logs on the vehicle? This can't be undone.
            </span>
            <button
              type="button"
              onClick={erase}
              className="rounded-md bg-red-700 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-600"
            >
              Erase all logs
            </button>
            <button
              type="button"
              onClick={() => setConfirmErase(false)}
              className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {blocked ? (
          <p className="text-zinc-500">{blocked}</p>
        ) : listError ? (
          <p className="text-amber-400">{listError}</p>
        ) : !list ? (
          <p className="flex items-center gap-1.5 text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Asking the vehicle for its logs…
          </p>
        ) : entries.length === 0 ? (
          <p className="text-zinc-500">No logs on the vehicle.</p>
        ) : (
          <>
            <p className="text-[11px] text-zinc-500">
              {list.numLogs} logs, {formatSize(totalSize)}. Newest first.
            </p>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <ul className="divide-y divide-zinc-900">
                {entries.map((e) => {
                  const active = transfer?.id === e.id ? transfer : null;
                  const result = results[e.id];
                  const pct = active && active.total > 0 ? Math.min(100, (active.received / active.total) * 100) : 0;
                  const elapsed = active ? (Date.now() - active.startedAt) / 1000 : 0;
                  const rate = active && elapsed > 0.5 ? active.received / elapsed : 0;
                  const eta = rate > 0 && active ? (active.total - active.received) / rate : NaN;
                  return (
                    <li key={e.id} className="flex flex-col gap-1 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="w-9 shrink-0 font-mono text-[11px] font-semibold text-zinc-200">#{e.id}</span>
                        <span
                          className="min-w-0 flex-1 truncate text-zinc-400"
                          title={e.timeUtc ? new Date(e.timeUtc * 1000).toString() : undefined}
                        >
                          {formatStart(e)}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-zinc-300">{formatSize(e.size)}</span>
                        {active ? (
                          <button
                            type="button"
                            onClick={() => logManager.cancel()}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-300 hover:bg-zinc-800"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void download(e)}
                            disabled={!!transfer || e.size === 0}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-sky-700/60 px-2 py-0.5 text-[10px] font-bold uppercase text-sky-300 hover:bg-sky-950/40 disabled:opacity-40"
                            title={`Download as ${downloadName(e)}`}
                          >
                            <Download className="h-3 w-3" /> Get
                          </button>
                        )}
                      </div>
                      {active && (
                        <div className="flex items-center gap-2 pl-11">
                          <div
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800"
                            role="progressbar"
                            aria-valuenow={Math.round(pct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className="h-full bg-sky-500 transition-[width] duration-200"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                            {Math.floor(pct)}% · {rate > 0 ? `${formatSize(rate)}/s` : '…'} · {formatDuration(eta)} left
                            {active.method ? ` · ${active.method === 'mavftp' ? 'MAVFTP' : 'MAVLink'}` : ''}
                          </span>
                        </div>
                      )}
                      {!active && result && (
                        <p
                          className={cn(
                            'pl-11 text-[10px]',
                            result.kind === 'saved' ? 'text-emerald-400' : 'text-amber-400'
                          )}
                        >
                          {result.kind === 'saved'
                            ? `Saved as ${downloadName(e)} (${result.method === 'mavftp' ? 'MAVFTP' : 'MAVLink'}, ${formatDuration(result.seconds)})`
                            : result.text === 'Canceled'
                              ? 'Canceled'
                              : `Not downloaded: ${result.text}`}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
        <TlogList />
      </CardContent>
    </Card>
  );
};
