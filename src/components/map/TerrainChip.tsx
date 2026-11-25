// Over the map: the vehicle's terrain status (TERRAIN_REPORT), shown once it reports one. How much of the terrain it
// wants it has (loaded / (loaded + pending)), and on click the details: terrain height under it, its height above
// terrain, spacing, and what the app has sent it. Nothing shows for a vehicle without terrain enabled.

import React, { useEffect, useRef, useState } from 'react';

import { Mountain } from 'lucide-react';

import { useTelemetryStore } from '../../store/telemetryStore';
import { useTerrainStore } from '../../store/terrainStore';
import { useUnitsStore } from '../../store/unitsStore';

const STALE_MS = 10_000;

export const TerrainChip: React.FC = () => {
  const report = useTerrainStore((s) => s.report);
  const enabled = useTerrainStore((s) => s.enabled);
  const sent = useTerrainStore((s) => s.sent);
  const unavailable = useTerrainStore((s) => s.unavailable);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!linked || !report || now - report.at > STALE_MS) return null;

  const total = report.loaded + report.pending;
  const pct = total > 0 ? Math.round((report.loaded / total) * 100) : 0;
  const here = report.spacing > 0; // the vehicle has terrain where it is
  const loading = report.pending > 0;
  const tone = !here
    ? 'border-amber-500/60 text-amber-300'
    : loading
      ? 'border-sky-600/60 text-sky-300'
      : 'border-emerald-600/60 text-emerald-300';
  const label = !here
    ? loading
      ? `TERRAIN ${pct}%`
      : 'TERRAIN · NONE HERE'
    : loading
      ? `TERRAIN ${pct}%`
      : `TERRAIN ${formatAltitude(report.currentHeight).full} AGL`;
  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Terrain status"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1 rounded-lg border bg-zinc-950/90 px-2 font-mono text-[10px] font-bold shadow-md ${tone}`}
      >
        <Mountain className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-[470] w-60 space-y-1 rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 text-[11px] text-zinc-300 shadow-xl backdrop-blur-sm">
          <div className="font-bold text-zinc-200">Vehicle terrain</div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Terrain under it</span>
            <span className="font-mono">{here ? `${formatAltitude(report.terrainHeight).full} MSL` : 'none'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Height above terrain</span>
            <span className="font-mono">{here ? formatAltitude(report.currentHeight).full : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Grid</span>
            <span className="font-mono">
              {report.spacing || '—'} m · {report.loaded} loaded, {report.pending} pending
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Sent from here</span>
            <span className="font-mono">
              {sent}
              {unavailable ? ` (${unavailable} unavailable)` : ''}
            </span>
          </div>
          <p className="text-[10px] leading-snug text-zinc-500">
            {enabled
              ? "The app answers the vehicle's terrain requests from AWS Terrain Tiles."
              : 'Terrain data is off in Settings: the vehicle gets terrain only from its SD card.'}
          </p>
        </div>
      )}
    </div>
  );
};
