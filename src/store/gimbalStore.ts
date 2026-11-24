// The vehicle's gimbal as it reports itself (mavlink/gimbalBoot.ts): whether one is enabled, its capabilities and
// limits, yaw lock, where it points, and the place it was last told to point at from here.

import { create } from 'zustand';

export interface GimbalInfo {
  deviceId: number;
  capFlags: number;
  pitchMin: number;
  pitchMax: number;
  yawMin: number;
  yawMax: number;
}

interface GimbalState {
  /** MNT1_TYPE / MNT2_TYPE as read from the vehicle (undefined until read). */
  mountTypes: (number | undefined)[];
  info: GimbalInfo | null;
  yawLock: boolean | null;
  /** Last attitude: pitch and yaw (deg), yaw in the earth frame or relative to the vehicle, and when (ms). */
  attitude: { pitch: number; yaw: number; earthFrame: boolean; at: number } | null;
  /** Pointed at from this app (DO_SET_ROI_LOCATION), until stopped. */
  roi: { lat: number; lon: number } | null;
  set: (patch: Partial<Omit<GimbalState, 'set' | 'reset'>>) => void;
  reset: () => void;
}

export const useGimbalStore = create<GimbalState>((set) => ({
  mountTypes: [],
  info: null,
  yawLock: null,
  attitude: null,
  roi: null,
  set: (patch) => set(patch),
  reset: () => set({ mountTypes: [], info: null, yawLock: null, attitude: null, roi: null }),
}));

/** A gimbal is enabled: a mount type is set, or one is reporting its attitude (within 5 s). */
export function gimbalEnabled(s: Pick<GimbalState, 'mountTypes' | 'attitude' | 'info'>, nowMs: number): boolean {
  if (s.mountTypes.some((t) => t !== undefined && t > 0)) return true;
  if (s.info) return true;
  return s.attitude !== null && nowMs - s.attitude.at < 5000;
}
