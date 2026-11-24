// Settings: terrain. Fetch elevation (AWS Terrain Tiles) to supply the vehicle and check plans, and the clearance the
// planning checks warn about (airborne vehicles only).

import React from 'react';
import { useTerrainStore } from '../../store/terrainStore';
import { useUnitsStore } from '../../store/unitsStore';
import { TERRAIN_ATTRIBUTION } from '../../mavlink/terrain';

export const TerrainSettings: React.FC = () => {
  const { enabled, clearanceM, setEnabled, setClearanceM } = useTerrainStore();
  const imperial = useUnitsStore((s) => s.system === 'mph' || s.system === 'kts');
  const shown = imperial ? Math.round(clearanceM * 3.28084) : clearanceM;
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-zinc-300">Terrain</label>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-0.5" role="radiogroup" aria-label="Terrain data">
        {[true, false].map((on) => (
          <button
            key={String(on)}
            type="button"
            role="radio"
            aria-checked={enabled === on}
            onClick={() => setEnabled(on)}
            className={'rounded-md py-1.5 text-xs transition-colors ' + (enabled === on ? 'bg-sky-500/20 font-medium text-sky-300' : 'text-zinc-400 hover:text-zinc-200')}
          >
            {on ? 'Terrain data on' : 'Off'}
          </button>
        ))}
      </div>
      <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
        <span>Planning: warn below this height above terrain</span>
        <span className="flex items-center gap-1">
          <input
            key={shown}
            type="number"
            min={0}
            step={imperial ? 10 : 5}
            defaultValue={shown}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 0) setClearanceM(imperial ? v / 3.28084 : v);
              else e.target.value = String(shown);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-16 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-right font-mono text-xs text-zinc-200"
          />
          <span className="w-5 text-zinc-500">{imperial ? 'ft' : 'm'}</span>
        </span>
      </label>
      <p className="text-[10px] leading-snug text-zinc-500">
        Elevation tiles are fetched from AWS (by area, like the map imagery) and kept in this browser. They supply the
        vehicle&apos;s terrain requests (TERRAIN_ENABLE) and the mission altitude profile and clearance checks (aircraft
        only). {TERRAIN_ATTRIBUTION}.
      </p>
    </div>
  );
};
