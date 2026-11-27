// Telemetry logs recorded in this browser (mavlink/tlogRecorder.ts): newest first, with download, keep (never
// deleted to make room), replay and delete. The one being recorded can be downloaded (what's written so far) but not
// deleted or replayed.

import React, { useEffect, useState } from 'react';

import { Download, Pin, PinOff, Play, Radio, Trash2 } from 'lucide-react';

import { downloadFile } from '../../lib/download';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { cn } from '../../lib/utils';
import { getVehicleCategoryLabel } from '../../mavlink/messages';
import { confirmLeavingLiveLink, startReplayFromBlob } from '../../mavlink/replay';
import type { TlogMeta } from '../../mavlink/tlog';
import { tlogRecorder } from '../../mavlink/tlogBoot';
import { showNotice } from '../../store/confirmStore';
import { useTlogStore } from '../../store/tlogStore';
import { fmtBytes } from '../navbar/TlogSettings';
import { ReplayFileButton } from './ReplayFileButton';

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

const Row: React.FC<{ log: TlogMeta; active: boolean; activeBytes: number }> = ({ log, active, activeBytes }) => {
  const del = useConfirmStep();
  const [busy, setBusy] = useState(false);
  const bytes = active ? activeBytes : log.bytes;
  const start = new Date(log.startMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const replay = async () => {
    if (!(await confirmLeavingLiveLink())) return;
    setBusy(true);
    try {
      const blob = await tlogRecorder.file(log.name);
      if (blob) await startReplayFromBlob(blob, log.name);
    } catch (e: any) {
      void showNotice('Replay', e?.message || 'Could not replay this log.');
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    setBusy(true);
    try {
      const blob = await tlogRecorder.file(log.name);
      if (blob) downloadFile(log.name, blob);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex items-center gap-1.5 py-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-zinc-200">
          {active && (
            <span
              className="inline-flex items-center gap-0.5 rounded bg-red-950/60 px-1 font-mono text-[9px] font-bold text-red-300"
              title="Being recorded"
            >
              <Radio className="h-2.5 w-2.5" /> REC
            </span>
          )}
          <span className="truncate">{start}</span>
          {log.kept && <Pin className="h-3 w-3 shrink-0 text-sky-400" aria-label="Kept" />}
        </div>
        <div className="truncate font-mono text-[10px] text-zinc-500" title={log.name}>
          {fmtBytes(bytes)} · {fmtDuration(log.lastWriteMs - log.startMs)}
          {log.sysId > 0 ? ` · sys ${log.sysId}` : ''}
          {log.vehicleType >= 0 ? ` ${getVehicleCategoryLabel(log.vehicleType)}` : ''}
        </div>
      </div>
      <button
        type="button"
        disabled={busy || active}
        onClick={replay}
        title={active ? 'Being recorded' : 'Replay on the dashboard (read-only: nothing is sent)'}
        aria-label={`Replay ${log.name}`}
        className="rounded-md border border-zinc-800 p-1 text-violet-300 hover:bg-zinc-800 disabled:opacity-30"
      >
        <Play className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={download}
        title="Download (.tlog)"
        className="rounded-md border border-zinc-800 p-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => tlogRecorder.setKept(log.name, !log.kept)}
        title={log.kept ? 'Stop keeping (may be deleted to make room)' : 'Keep (never deleted to make room)'}
        className="rounded-md border border-zinc-800 p-1 text-zinc-300 hover:bg-zinc-800"
      >
        {log.kept ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        disabled={active}
        onClick={() => {
          if (!del.armed) return del.arm();
          del.cancel();
          void tlogRecorder.remove(log.name);
        }}
        title={active ? 'Being recorded' : 'Delete this log'}
        className={cn(
          'rounded-md border p-1 disabled:opacity-30',
          del.armed
            ? 'border-red-500 bg-red-600 px-1.5 text-[10px] font-bold text-white'
            : 'border-zinc-800 text-zinc-400 hover:bg-red-950/40 hover:text-red-300'
        )}
      >
        {del.armed ? 'Delete?' : <Trash2 className="h-3.5 w-3.5" />}
      </button>
    </li>
  );
};

export const TlogList: React.FC = () => {
  const logs = useTlogStore((s) => s.logs);
  const active = useTlogStore((s) => s.active);
  const activeBytes = useTlogStore((s) => s.activeBytes);
  const enabled = useTlogStore((s) => s.enabled);
  const error = useTlogStore((s) => s.error);
  useEffect(() => {
    void tlogRecorder.refreshList();
  }, []);

  return (
    <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col gap-1 border-t border-zinc-800 pt-2">
      <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-400">
        <span>Telemetry logs · this browser</span>
        <span className="font-mono font-normal normal-case tracking-normal text-zinc-500">
          {fmtBytes(logs.reduce((t, l) => t + l.bytes, 0))}
        </span>
      </div>
      <ReplayFileButton />
      {error && <p className="text-[10px] text-red-300">{error}</p>}
      {logs.length === 0 ? (
        <p className="text-[11px] text-zinc-500">
          {enabled ? 'None yet: every connection to a vehicle is recorded.' : 'Telemetry logging is off (Settings).'}
        </p>
      ) : (
        <ul className="-mx-1 min-h-0 divide-y divide-zinc-900 overflow-y-auto px-1">
          {logs.map((l) => (
            <Row key={l.name} log={l} active={l.name === active} activeBytes={activeBytes} />
          ))}
        </ul>
      )}
    </div>
  );
};
