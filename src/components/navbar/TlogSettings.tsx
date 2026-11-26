// Settings: telemetry logging on or off, the size cap, and what's happening now (file, size, storage use).

import React, { useEffect, useState } from 'react';

import { useTlogStore } from '../../store/tlogStore';
import { ReplayFileButton } from '../widgets/ReplayFileButton';

const CAPS_MB = [512, 1024, 2048, 5120, 10240];
const fmtMb = (mb: number) => (mb >= 1024 ? `${+(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
export const fmtBytes = (b: number) =>
  b >= 1024 ** 3
    ? `${(b / 1024 ** 3).toFixed(2)} GB`
    : b >= 1024 ** 2
      ? `${(b / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(b / 1024)} KB`;

/** `onReplayStarted`: Settings closes so the dashboard and the replay bar show. */
export const TlogSettings: React.FC<{ onReplayStarted?: () => void }> = ({ onReplayStarted }) => {
  const { enabled, capMb, phase, active, activeBytes, error, overCap, logs, setEnabled, setCapMb } = useTlogStore();
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    (navigator.storage as any)
      ?.estimate?.()
      .then((e: any) => e?.quota && setQuota({ usage: e.usage ?? 0, quota: e.quota }))
      .catch(() => {});
  }, [activeBytes, logs.length]);
  const total = logs.reduce((t, l) => t + l.bytes, 0);
  const caps = CAPS_MB.includes(capMb) ? CAPS_MB : [...CAPS_MB, capMb].sort((a, b) => a - b);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium text-zinc-300">Telemetry Logs (.tlog)</label>
        <ReplayFileButton onStarted={onReplayStarted} />
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5"
        role="radiogroup"
        aria-label="Telemetry logging"
      >
        {[true, false].map((on) => (
          <button
            key={String(on)}
            type="button"
            role="radio"
            aria-checked={enabled === on}
            onClick={() => setEnabled(on)}
            className={
              'rounded-md py-1.5 text-xs transition-colors ' +
              (enabled === on
                ? on
                  ? 'bg-red-500/20 font-medium text-red-300'
                  : 'bg-zinc-700/60 font-medium text-zinc-200'
                : 'text-zinc-400 hover:text-zinc-200')
            }
          >
            {on ? 'Record' : 'Off'}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span>Keep up to</span>
        <select
          value={capMb}
          onChange={(e) => setCapMb(Number(e.target.value))}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200"
          aria-label="Telemetry log size cap"
        >
          {caps.map((mb) => (
            <option key={mb} value={mb}>
              {fmtMb(mb)}
            </option>
          ))}
        </select>
      </div>
      <div className="text-[10px] leading-snug text-zinc-500">
        {phase === 'stopped' && error ? (
          <span className="text-red-300">{error}</span>
        ) : phase === 'recording' && active ? (
          <span className="text-zinc-300">
            Recording <span className="font-mono">{active}</span> ({fmtBytes(activeBytes)})
          </span>
        ) : enabled ? (
          phase === 'waiting' ? (
            'Waiting for the vehicle to choose the log…'
          ) : (
            'Records every connection to a vehicle.'
          )
        ) : (
          'Off: nothing is recorded.'
        )}{' '}
        {logs.length} log{logs.length === 1 ? '' : 's'}, {fmtBytes(total)} of {fmtMb(capMb)}
        {quota ? ` · browser storage ${fmtBytes(quota.usage)} of ${fmtBytes(quota.quota)}` : ''}. Oldest logs are
        deleted to stay under the cap, except ones marked kept. A reload mid-flight continues the same log; a disconnect
        starts a new one next time.
        {overCap && <span className="text-amber-300"> Kept logs alone exceed the cap.</span>}
      </div>
    </div>
  );
};

/** In the header: REC while a log is being written, a warning when logging stopped on an error. Opens Settings. */
export const TlogIndicator: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const phase = useTlogStore((s) => s.phase);
  const active = useTlogStore((s) => s.active);
  const error = useTlogStore((s) => s.error);
  if (phase !== 'recording' && phase !== 'stopped') return null;
  const rec = phase === 'recording';
  return (
    <button
      type="button"
      onClick={onClick}
      title={rec ? `Recording telemetry log ${active ?? ''}` : (error ?? 'Telemetry logging stopped')}
      aria-label={rec ? 'Telemetry log recording' : 'Telemetry logging stopped'}
      className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-1.5 font-mono text-[10px] font-bold ${
        rec ? 'border-red-500/40 bg-red-950/40 text-red-300' : 'border-amber-500/50 bg-amber-950/40 text-amber-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${rec ? 'animate-pulse bg-red-500' : 'bg-amber-400'}`} />
      {rec ? 'REC' : 'LOG ⚠'}
    </button>
  );
};
