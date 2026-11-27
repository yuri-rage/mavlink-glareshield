// Settings modal: put every setting back to its default by clearing what the app keeps in this browser, then
// reloading. The confirmation is inline (not a second modal) and says what is and isn't affected.

import React, { useEffect, useRef, useState } from 'react';

import { AlertTriangle, Download, RotateCcw } from 'lucide-react';

import { restoreDefaultsAndReload } from '../../lib/appStorage';
import { downloadFile } from '../../lib/download';
import { useDashboardStore } from '../../store/dashboardStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { Button } from '../ui/button';

const RESETS = [
  'Dashboard tabs, layout and custom widgets',
  'Connection settings (bridge address, link type, serial device, GCS system ID)',
  'Units, altitude mode, theme and telemetry rate',
  'Sound, voice and waypoint callouts',
  'HUD video feed (camera URL) and NTRIP settings',
  'Map shape and the cached mission, fence and rally points',
];

const KEEPS = [
  "The vehicle's own parameters and mission",
  'The downloaded voice model, parameter descriptions and cached map tiles',
];

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
    downloadFile(
      `mavlink-glareshield-profile-${new Date().toISOString().slice(0, 10)}.json`,
      exportProfileJson(),
      'application/json'
    );
  };

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-zinc-200">Restore defaults</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">
            Every setting and the dashboard, as on first visit. (The dashboard alone: Edit Mode › Profiles &amp;
            Backup.)
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirming(true)}
          className="h-7 shrink-0 gap-1.5 border-red-500/40 px-2.5 text-xs font-semibold text-red-300 hover:bg-red-950/40 hover:text-red-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore defaults…
        </Button>
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="restore-defaults-title"
      className="space-y-2.5 rounded-lg border border-red-500/40 bg-red-950/20 p-3"
    >
      <div id="restore-defaults-title" className="flex items-center gap-1.5 text-sm font-semibold text-red-200">
        <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
        Restore all settings to defaults?
      </div>

      <div className="space-y-1 text-[11px] text-zinc-300">
        <div>This resets, in this browser only:</div>
        <ul className="list-disc space-y-0.5 pl-4 text-zinc-400">
          {RESETS.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="pt-1">Not affected:</div>
        <ul className="list-disc space-y-0.5 pl-4 text-zinc-400">
          {KEEPS.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </ul>
      </div>

      {linked && (
        <div
          className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px] ${
            armed
              ? 'border-red-500/60 bg-red-950/50 font-semibold text-red-200'
              : 'border-amber-500/40 bg-amber-950/30 text-amber-200'
          }`}
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          {armed
            ? 'The vehicle is ARMED. The page reloads and the link drops until you reconnect.'
            : 'The page reloads and the link to the vehicle drops until you reconnect.'}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={exportDashboard}
          className="h-7 gap-1.5 px-2 text-xs text-sky-300 hover:text-sky-200"
        >
          <Download className="h-3.5 w-3.5" />
          Export dashboard first
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(false)}
            className="h-7 px-3 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={restoreDefaultsAndReload}
            className="h-7 gap-1.5 px-3 text-xs font-bold"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Restore defaults and reload
          </Button>
        </div>
      </div>
    </div>
  );
};
