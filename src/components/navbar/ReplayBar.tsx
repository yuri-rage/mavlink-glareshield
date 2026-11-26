// The replay bar: shown under the navbar while a telemetry log is replayed (mavlink/replay.ts). Play / pause, speed,
// a scrubber, the time, and Stop; and the reminder that nothing is sent.

import React, { useEffect, useState } from 'react';

import { History, Loader2, Pause, Play, Square } from 'lucide-react';

import { replayControls, stopReplay } from '../../mavlink/replay';
import { REPLAY_SPEEDS } from '../../mavlink/tlogReplay';
import { useReplayStore } from '../../store/replayStore';

/** m:ss, or h:mm:ss. */
export function fmtReplayTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const ReplayBar: React.FC = () => {
  const r = useReplayStore();
  // While dragging, the thumb follows the pointer; the seek happens on release.
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => {
    if (!r.active) setDrag(null);
  }, [r.active]);
  if (!r.active) return null;

  const shown = drag ?? r.positionMs;
  const clock =
    r.startEpochMs > 0
      ? new Date(r.startEpochMs + shown).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : null;
  const commit = () => {
    if (drag !== null) replayControls.seek(drag);
    setDrag(null);
  };

  return (
    <div
      role="region"
      aria-label="Telemetry log replay"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-violet-500/60 bg-violet-950/90 px-3 py-1.5 text-xs text-violet-100 sm:px-6"
    >
      <span className="flex min-w-0 items-center gap-1.5" title={r.name}>
        <History className="h-4 w-4 shrink-0 text-violet-300" />
        <strong className="shrink-0 uppercase tracking-wider">Replay</strong>
        <span className="hidden max-w-[16rem] truncate text-violet-200 md:inline">{r.name}</span>
      </span>

      <span className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={() => (r.playing ? replayControls.pause() : replayControls.play())}
          disabled={r.seeking}
          aria-label={r.playing ? 'Pause' : 'Play'}
          title={r.playing ? 'Pause' : r.ended ? 'Play again from the start' : 'Play'}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-violet-400/60 bg-violet-900/60 hover:bg-violet-800 disabled:opacity-40"
        >
          {r.seeking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : r.playing ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </button>
        <select
          value={r.speed}
          onChange={(e) => replayControls.setSpeed(Number(e.target.value))}
          aria-label="Replay speed"
          className="h-6 shrink-0 rounded border border-violet-400/60 bg-violet-900/60 px-1 font-mono text-[11px] text-violet-100"
        >
          {REPLAY_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={Math.max(1, r.durationMs)}
          step={100}
          value={Math.min(shown, r.durationMs)}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          aria-label="Replay position"
          className="h-1.5 min-w-[6rem] flex-1 cursor-pointer accent-violet-400"
        />
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-violet-200">
          {fmtReplayTime(shown)} / {fmtReplayTime(r.durationMs)}
        </span>
        {clock && <span className="hidden shrink-0 font-mono text-[10px] text-violet-300/80 xl:inline">{clock}</span>}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span
          className="hidden text-[11px] text-violet-200/90 lg:inline"
          title="The dashboard shows the log. Commands, parameter writes, mission uploads and downloads go nowhere."
        >
          Read-only: nothing is sent to a vehicle
          {r.gapsCompressed > 0 ? ` · ${r.gapsCompressed} long pause${r.gapsCompressed === 1 ? '' : 's'} skipped` : ''}
        </span>
        <button
          type="button"
          onClick={stopReplay}
          className="flex h-6 items-center gap-1 rounded border border-violet-400/60 bg-violet-900/60 px-2 text-[11px] font-bold hover:bg-violet-800"
          title="Stop the replay (disconnected afterwards: Connect for the live link)"
        >
          <Square className="h-3 w-3" />
          Stop
        </button>
      </span>
    </div>
  );
};
