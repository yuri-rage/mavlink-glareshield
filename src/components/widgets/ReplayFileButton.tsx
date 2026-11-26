// "Replay a .tlog file…": picks a telemetry log from disk and replays it (mavlink/replay.ts). Used beside the logs
// recorded in this browser (Logs widget) and in Settings → Data.

import React, { useRef, useState } from 'react';

import { History } from 'lucide-react';

import { confirmLeavingLiveLink, startReplayFromBlob } from '../../mavlink/replay';

export const ReplayFileButton: React.FC<{ className?: string; onStarted?: () => void }> = ({
  className,
  onStarted,
}) => {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const open = async (file: File) => {
    setError(null);
    if (!(await confirmLeavingLiveLink())) return;
    try {
      await startReplayFromBlob(file, file.name);
      onStarted?.();
    } catch (e: any) {
      setError(e?.message || 'Could not read that file.');
    }
  };
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        title="Play a recorded telemetry log (.tlog, from Glareshield, Mission Planner or QGroundControl) on the dashboard. Read-only: nothing is sent."
        className={
          className ??
          'inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800'
        }
      >
        <History className="h-3.5 w-3.5 text-violet-300" />
        Replay a .tlog file…
      </button>
      <input
        ref={input}
        type="file"
        accept=".tlog,.TLOG,application/octet-stream"
        className="hidden"
        aria-label="Telemetry log to replay"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void open(file);
        }}
      />
      {error && <span className="text-[10px] leading-snug text-red-300">{error}</span>}
    </span>
  );
};
