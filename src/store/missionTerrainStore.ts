// The mission draft's altitude profile over terrain and its clearance issues (mavlink/missionProfile.ts), computed
// by useMissionTerrain while planning; read by the profile strip, the planning panel and the upload dialog.

import { create } from 'zustand';
import type { MissionProfile, TerrainIssue } from '../mavlink/missionProfile';

interface MissionTerrainState {
  /** Null when not computed: not planning, not an aircraft, terrain off, or nothing to draw. */
  profile: MissionProfile | null;
  issues: TerrainIssue[];
  /** Elevation tiles for the route are being fetched. */
  loading: boolean;
  /** The strip is shown (planning, mission layer). */
  showProfile: boolean;
  setShowProfile: (on: boolean) => void;
}

const KEY = 'mavlink_glareshield_profile_shown';
let shown = false;
try {
  shown = localStorage.getItem(KEY) === '1';
} catch {
  // Storage blocked.
}

export const useMissionTerrainStore = create<MissionTerrainState>((set) => ({
  profile: null,
  issues: [],
  loading: false,
  showProfile: shown,
  setShowProfile: (on) => {
    set({ showProfile: on });
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      // Storage blocked: lasts this session.
    }
  },
}));
