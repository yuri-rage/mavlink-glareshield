// Settings modal: put every setting back to its default by clearing what the app keeps in this browser, then
// reloading. The confirmation is inline (not a second modal) and says what is and isn't affected.

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useDashboardStore } from '../../store/dashboardStore';
import { restoreDefaultsAndReload } from '../../lib/appStorage';

const RESETS = [
  'Dashboard tabs, layout and custom widgets',
  'Connection settings (bridge address, link type, serial device, GCS system ID)',
  'Units, altitude mode, theme and telemetry rate',
  'Sound, voice and waypoint callouts',
  'HUD video feed (camera URL) and NTRIP settings',
  'Map shape and the cached mission, fence and rally points',
];

const KEEPS = ["The vehicle's own parameters and mission", 'The downloaded voice model and cached map tiles'];

export const RestoreDefaults: React.FC = () => {
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const armed = useTelemetryStore((s) => s.heartbeat.isArmed);
  const exportProfileJson = useDashboardStore((s) => s.exportProfileJson);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  const exportDashboard = () => {
    const url = URL.createObjectURL(new Blob([exportProfileJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mavlink-glareshield-profile-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-xs text-zinc-200">Restore defaults</div>
          <div className="text-[11px] text-zinc-500 mt-0.5">Reset every setting and the dashboard to how they were on first visit.</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          className="h-7 px-2.5 text-xs font-semibold text-red-300 border-red-500/40 hover:bg-red-950/40 hover:text-red-200 gap-1.5 shrink-0"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore defaults…
        </Button>
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-labelledby="restore-defaults-title" className="rounded-lg border border-red-500/40 bg-red-950/20 p-3 space-y-2.5">
      <div id="restore-defaults-title" className="font-semibold text-sm text-red-200 flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
        Restore all settings to defaults?
      </div>

      <div className="text-[11px] text-zinc-300 space-y-1">
        <div>This resets, in this browser only:</div>
        <ul className="list-disc pl-4 space-y-0.5 text-zinc-400">
          {RESETS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="pt-1">Not affected:</div>
        <ul className="list-disc pl-4 space-y-0.5 text-zinc-400">
          {KEEPS.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </div>

      {linked && (
        <div
          className={`text-[11px] rounded-md border px-2 py-1.5 flex items-start gap-1.5 ${
            armed ? 'border-red-500/60 bg-red-950/50 text-red-200 font-semibold' : 'border-amber-500/40 bg-amber-950/30 text-amber-200'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
          {armed
            ? 'The vehicle is ARMED. The page reloads and the link drops until you reconnect.'
            : 'The page reloads and the link to the vehicle drops until you reconnect.'}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={exportDashboard} className="h-7 px-2 text-xs text-sky-300 hover:text-sky-200 gap-1.5">
          <Download className="h-3.5 w-3.5" />
          Export dashboard first
        </Button>
        <div className="flex items-center gap-2 ml-auto">
          <Button ref={cancelRef} type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} className="h-7 px-3 text-xs">
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={restoreDefaultsAndReload} className="h-7 px-3 text-xs font-bold gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Restore defaults and reload
          </Button>
        </div>
      </div>
    </div>
  );
};
