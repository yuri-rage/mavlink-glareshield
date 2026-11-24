// The last vehicle connected, saved in this browser: its type and the parameters planning draws waypoint radii from
// (waypointRadius.ts). Planning offline then draws the same circles as when connected, instead of none (what a
// radius means depends on the vehicle). Updated while a vehicle is connected; another vehicle type starts over.

import { create } from 'zustand';
import { useTelemetryStore } from './telemetryStore';
import { paramManager } from '../mavlink/paramManager';
import { getVehicleCategory } from '../mavlink/messages';

const KEY = 'mavlink_glareshield_last_vehicle';

/** The parameters the waypoint radii come from. */
export const RADIUS_PARAMS = ['WP_RADIUS', 'WP_LOITER_RAD', 'WPNAV_RADIUS_M', 'WPNAV_RADIUS'] as const;

export interface LastVehicle {
  /** MAV_TYPE, 0 when none has connected in this browser. */
  type: number;
  params: Record<string, number>;
}

function load(): LastVehicle {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object' && Number.isInteger(s.type)) {
      const params: Record<string, number> = {};
      for (const n of RADIUS_PARAMS) if (Number.isFinite(s.params?.[n])) params[n] = s.params[n];
      return { type: s.type, params };
    }
  } catch {
    // Unreadable: nothing remembered.
  }
  return { type: 0, params: {} };
}

export const useLastVehicleStore = create<LastVehicle>(() => load());

function save(v: LastVehicle) {
  useLastVehicleStore.setState(v);
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Storage unavailable: kept for this session only.
  }
}

/**
 * The vehicle type and radius parameters to draw with: the connected vehicle's, else the last one's. Connected, the
 * values are the ones it has sent this connection (kept below), never a value left in the parameter store by an
 * earlier vehicle; until they arrive, the firmware defaults apply.
 */
export function planningVehicle(): LastVehicle {
  const t = useTelemetryStore.getState();
  const last = useLastVehicleStore.getState();
  const linked = t.heartbeat.lastHeartbeatTime > 0 && t.heartbeat.modeName !== 'DISCONNECTED' && t.heartbeat.type !== 0;
  if (!linked) return last;
  return last.type === t.heartbeat.type ? last : { type: t.heartbeat.type, params: {} };
}

/** The radius parameters a vehicle has (Copter before 4.7 has WPNAV_RADIUS in cm, later WPNAV_RADIUS_M). */
function radiusParamsFor(type: number): string[] {
  const cat = getVehicleCategory(type);
  return cat === 'plane' ? ['WP_RADIUS', 'WP_LOITER_RAD'] : cat === 'copter' ? ['WPNAV_RADIUS_M', 'WPNAV_RADIUS'] : cat === 'rover' ? ['WP_RADIUS'] : [];
}

/** The vehicle (sysid:type) asked for its radius parameters this connection. */
let askedFor = '';

// While a vehicle is connected, keep its type and the radius parameters it sends. Only a value arriving now counts:
// one still in the store from before may be another vehicle's.
useTelemetryStore.subscribe((s, prev) => {
  const linked = s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED' && s.heartbeat.type !== 0;
  if (!linked) {
    askedFor = '';
    return;
  }
  // Once per connection (and vehicle), ask for its radius parameters, so the circles are right on the vehicle's
  // mission too, without waiting for the full parameter list or planning. One the firmware doesn't have
  // (WPNAV_RADIUS_M on an older Copter) just goes unanswered.
  const key = `${s.heartbeat.systemId}:${s.heartbeat.type}`;
  if (askedFor !== key) {
    askedFor = key;
    for (const n of radiusParamsFor(s.heartbeat.type)) paramManager.requestParam(s.heartbeat.systemId, s.heartbeat.componentId || 1, n);
  }
  const last = useLastVehicleStore.getState();
  let next: LastVehicle = s.heartbeat.type === last.type ? last : { type: s.heartbeat.type, params: {} };
  if (s.parameters !== prev.parameters) {
    for (const n of RADIUS_PARAMS) {
      const p = s.parameters[n];
      if (p && p !== prev.parameters[n] && p.value !== next.params[n]) {
        const params = { ...next.params, [n]: p.value };
        // A Copter has one or the other (WPNAV_RADIUS in cm before 4.7, WPNAV_RADIUS_M after): the other is a
        // previous vehicle's, and WPNAV_RADIUS_M would be read first.
        if (n === 'WPNAV_RADIUS') delete params.WPNAV_RADIUS_M;
        if (n === 'WPNAV_RADIUS_M') delete params.WPNAV_RADIUS;
        next = { ...next, params };
      }
    }
  }
  if (next !== last) save(next);
});
