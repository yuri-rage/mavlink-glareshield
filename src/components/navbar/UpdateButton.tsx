// "Update": shown once a newer deploy is live (lib/updateCheck.ts). A click reloads the page into it; while the
// vehicle is armed it waits (a reload drops the link for a few seconds), saying why.

import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useUpdateStore } from '../../lib/updateCheck';
import { useTelemetryStore } from '../../store/telemetryStore';

export const UpdateButton: React.FC = () => {
  const available = useUpdateStore((s) => s.available);
  const armed = useTelemetryStore((s) => s.heartbeat.isArmed);
  if (!available) return null;
  return (
    <button
      type="button"
      disabled={armed}
      onClick={() => window.location.reload()}
      title={
        armed
          ? 'A newer version is available. Reload after disarming: reloading drops the vehicle link for a few seconds.'
          : `A newer version is available${available !== 'unknown' ? ` (${available})` : ''}. Reload to use it; the link reconnects.`
      }
      aria-label="Update: reload into the newer version"
      className="h-7 shrink-0 inline-flex items-center gap-1 rounded-lg border border-sky-500/60 bg-sky-950/60 px-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/70 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RefreshCw className="h-3.5 w-3.5 shrink-0" />
      <span className="hidden sm:inline">{armed ? 'Update after landing' : 'Update'}</span>
    </button>
  );
};
