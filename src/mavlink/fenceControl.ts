// The vehicle's fence switch (MAV_CMD_DO_FENCE_ENABLE): its state as the vehicle reports it, and what enabling it
// would put the vehicle outside of. Pure; the UI is components/map/FenceControl.tsx.
//
// ArduPilot (AC_Fence, GCS_Fence.cpp): DO_FENCE_ENABLE changes the fence at run time only (FENCE_ENABLE is the state
// at boot and doesn't change). param1 1 enables every configured type, 0 disables, 2 disables only the altitude
// floor. Enabling is refused (MAV_RESULT_FAILED) when no configured type is present; polygons are present only once
// some are loaded. Disabling clears the breach but not the action already taken (an RTL carries on).

import { fenceBreachReasons, type FenceDraft } from './fenceDraft';

/** FENCE_TYPE bits. */
export const FENCE_TYPE_ALT_MAX = 1;
export const FENCE_TYPE_CIRCLE = 2;
export const FENCE_TYPE_POLYGON = 4;
export const FENCE_TYPE_ALT_MIN = 8;
/** MAV_SYS_STATUS_GEOFENCE. */
const GEOFENCE = 1 << 20;
/** FENCE_STATUS comes about once a second while enabled; older than this, the fence is taken as no longer enabled. */
export const FENCE_STATUS_FRESH_MS = 5000;
export const MAV_CMD_DO_FENCE_ENABLE = 207;

export interface FenceStateInput {
  sensorsPresent: number;
  sensorsEnabled: number;
  sensorsHealth: number;
  /** When FENCE_STATUS last arrived (ms, 0 never), and whether it said breached. */
  fenceStatusAt: number;
  fenceStatusBreached: boolean;
  nowMs: number;
  fenceType?: number;
  fenceAction?: number;
  /** The vehicle's fence has polygon or circle zones loaded (the downloaded fence). */
  hasZones: boolean;
}

export interface FenceState {
  /**
   * 'none': nothing configured to enforce (enabling would be refused); 'off'; 'on'; 'breach': on and breached now;
   * 'unknown': the vehicle hasn't said (no SYS_STATUS yet).
   */
  state: 'none' | 'off' | 'on' | 'breach' | 'unknown';
  /** The types that would be enforced (configured, and for polygons, loaded). */
  types: number;
  /** FENCE_ACTION is report only: a breach is reported, nothing else. */
  reportOnly: boolean;
}

/** The fence's state from SYS_STATUS (and FENCE_STATUS, which ArduPilot sends only while the fence is enabled). */
export function vehicleFenceState(v: FenceStateInput): FenceState {
  const configured = v.fenceType === undefined ? FENCE_TYPE_POLYGON : Math.round(v.fenceType);
  const types = configured & ~(v.hasZones ? 0 : FENCE_TYPE_POLYGON);
  const reportOnly = v.fenceAction !== undefined && Math.round(v.fenceAction) === 0;
  const fresh = v.fenceStatusAt > 0 && v.nowMs - v.fenceStatusAt <= FENCE_STATUS_FRESH_MS;
  const present = (v.sensorsPresent & GEOFENCE) !== 0;
  if (types === 0 && !present) return { state: 'none', types, reportOnly };
  // SYS_STATUS's enabled bit is off for report-only fences even when enabled, but FENCE_STATUS still comes then.
  const enabled = fresh || (present && (v.sensorsEnabled & GEOFENCE) !== 0);
  if (!enabled) {
    if (v.sensorsPresent === 0 && !fresh) return { state: 'unknown', types, reportOnly };
    return { state: 'off', types, reportOnly };
  }
  const breached = (fresh && v.fenceStatusBreached) || (present && (v.sensorsHealth & GEOFENCE) === 0);
  return { state: breached ? 'breach' : 'on', types, reportOnly };
}

/** The enforced types in words. */
export function fenceTypeNames(types: number): string[] {
  const out: string[] = [];
  if (types & FENCE_TYPE_POLYGON) out.push('zones');
  if (types & FENCE_TYPE_CIRCLE) out.push('home circle');
  if (types & FENCE_TYPE_ALT_MAX) out.push('max altitude');
  if (types & FENCE_TYPE_ALT_MIN) out.push('min altitude');
  return out;
}

/**
 * Where the vehicle is outside what enabling the fence would enforce, in words (empty when inside all of it):
 * the polygon and circle zones (fenceBreachReasons), the circle of FENCE_RADIUS around home, and FENCE_ALT_MAX /
 * FENCE_ALT_MIN above home. Unknown position, home or parameters skip that check.
 */
export function fenceEnableBreaches(v: {
  types: number;
  fence: FenceDraft;
  position: { lat: number; lon: number } | null;
  /** Height above home (m). */
  relAlt: number | null;
  /** Distance from home (m). */
  homeDistanceM: number | null;
  fenceRadius?: number;
  altMax?: number;
  altMin?: number;
  inclusionUnion?: boolean;
}): string[] {
  const out: string[] = [];
  if (v.types & FENCE_TYPE_POLYGON && v.position) out.push(...fenceBreachReasons(v.fence, v.position, { inclusionUnion: v.inclusionUnion }));
  if (v.types & FENCE_TYPE_CIRCLE && v.homeDistanceM !== null && v.fenceRadius !== undefined && v.homeDistanceM >= v.fenceRadius) {
    out.push(`outside the home circle (${Math.round(v.homeDistanceM)} m from home, FENCE_RADIUS ${v.fenceRadius} m)`);
  }
  if (v.types & FENCE_TYPE_ALT_MAX && v.relAlt !== null && v.altMax !== undefined && v.relAlt >= v.altMax) {
    out.push(`above FENCE_ALT_MAX (${Math.round(v.relAlt)} m, max ${v.altMax} m)`);
  }
  if (v.types & FENCE_TYPE_ALT_MIN && v.relAlt !== null && v.altMin !== undefined && v.relAlt <= v.altMin) {
    out.push(`below FENCE_ALT_MIN (${Math.round(v.relAlt)} m, min ${v.altMin} m)`);
  }
  return out;
}
