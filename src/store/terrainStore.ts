// Terrain: the setting (fetch elevation tiles and supply the vehicle; the planning clearance), saved in this browser,
// and the vehicle's terrain status from TERRAIN_REPORT, with what the app has sent it.

import { create } from 'zustand';

const KEY = 'mavlink_glareshield_terrain';

export interface TerrainReport {
  /** Terrain height under the vehicle (m above sea level) and the vehicle's height above it (m). */
  terrainHeight: number;
  currentHeight: number;
  /** The vehicle's terrain grid spacing (0 = no terrain data where it is). */
  spacing: number;
  /** 4 x 4 sub-grids the vehicle still lacks / has, across its cache. */
  pending: number;
  loaded: number;
  at: number;
}

interface TerrainState {
  /** Fetch elevation tiles (AWS Terrain Tiles) and answer the vehicle's terrain requests. */
  enabled: boolean;
  /** Planning: warn where an airborne vehicle's route comes within this height of the terrain (m). */
  clearanceM: number;
  report: TerrainReport | null;
  /** Sub-grids sent to the vehicle, and ones that couldn't be (no elevation tile), this connection. */
  sent: number;
  unavailable: number;
  setEnabled: (on: boolean) => void;
  setClearanceM: (m: number) => void;
}

function load(): { enabled: boolean; clearanceM: number } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') {
      const c = Number(s.clearanceM);
      return { enabled: s.enabled !== false, clearanceM: Number.isFinite(c) && c >= 0 && c <= 1000 ? c : 30 };
    }
  } catch {
    // Unreadable: defaults.
  }
  return { enabled: true, clearanceM: 30 };
}

export const useTerrainStore = create<TerrainState>((set, get) => {
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled: get().enabled, clearanceM: get().clearanceM }));
    } catch {
      // Storage blocked: lasts this session.
    }
  };
  return {
    ...load(),
    report: null,
    sent: 0,
    unavailable: 0,
    setEnabled: (enabled) => {
      set({ enabled });
      persist();
    },
    setClearanceM: (m) => {
      set({ clearanceM: Math.max(0, Math.min(1000, Math.round(m))) });
      persist();
    },
  };
});
