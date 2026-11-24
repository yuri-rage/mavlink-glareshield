// The last vehicle connected, saved in this browser: its type and the parameters planning draws waypoint radii from
// (waypointRadius.ts). Planning offline then draws the same circles as when connected, instead of none (what a
// radius means depends on the vehicle). Updated while a vehicle is connected; another vehicle type starts over.

import { create } from 'zustand';
import { useTelemetryStore } from './telemetryStore';

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

/** The vehicle type and radius parameters to plan with: the connected vehicle's, else the last one's. */
export function planningVehicle(): LastVehicle {
  const t = useTelemetryStore.getState();
  const linked = t.heartbeat.lastHeartbeatTime > 0 && t.heartbeat.modeName !== 'DISCONNECTED' && t.heartbeat.type !== 0;
  if (!linked) return useLastVehicleStore.getState();
  const params: Record<string, number> = {};
  for (const n of RADIUS_PARAMS) {
    const v = t.parameters[n]?.value;
    if (v !== undefined) params[n] = v;
  }
  return { type: t.heartbeat.type, params };
}

// While a vehicle is connected, keep its type and the radius parameters it sends. Only a value arriving now counts:
// one still in the store from before may be another vehicle's.
useTelemetryStore.subscribe((s, prev) => {
  const linked = s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED' && s.heartbeat.type !== 0;
  if (!linked) return;
  const last = useLastVehicleStore.getState();
  let next: LastVehicle = s.heartbeat.type === last.type ? last : { type: s.heartbeat.type, params: {} };
  if (s.parameters !== prev.parameters) {
    for (const n of RADIUS_PARAMS) {
      const p = s.parameters[n];
      if (p && p !== prev.parameters[n] && p.value !== next.params[n]) next = { ...next, params: { ...next.params, [n]: p.value } };
    }
  }
  if (next !== last) save(next);
});
