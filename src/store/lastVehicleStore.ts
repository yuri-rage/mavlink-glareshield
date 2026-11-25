// The last vehicle connected, saved in this browser: its type and the parameters planning uses (waypoint radii,
// mission speeds, the fence settings: waypointRadius.ts, missionSummary.ts, routeFence.ts). Planning offline then
// shows the same circles, estimates and fence checks as when connected, instead of none (what they mean depends on
// the vehicle). Updated while a vehicle is connected; another vehicle type starts over.

import { create } from 'zustand';
import { onActiveVehicleChange } from '../mavlink/vehicleRoster';
import { useTelemetryStore } from './telemetryStore';
import { paramManager } from '../mavlink/paramManager';
import { getVehicleCategory } from '../mavlink/messages';

const KEY = 'mavlink_glareshield_last_vehicle';

/** The parameters the waypoint radii come from. */
export const RADIUS_PARAMS = ['WP_RADIUS', 'WP_LOITER_RAD', 'WP_RADIUS_M', 'WPNAV_RADIUS_M', 'WPNAV_RADIUS'] as const;

/** Mission speeds (missionSummary.ts), current names and those of 4.6 and before. */
export const SPEED_PARAMS = [
  'WP_SPD', 'WP_SPD_UP', 'WP_SPD_DN', 'WPNAV_SPEED', 'WPNAV_SPEED_UP', 'WPNAV_SPEED_DN', 'WP_ACC', 'WPNAV_ACCEL', 'RTL_LOIT_TIME',
  'AIRSPEED_CRUISE', 'TRIM_ARSPD_CM', 'TECS_CLMB_MAX', 'TECS_SINK_MAX',
  'WP_SPEED', 'CRUISE_SPEED',
] as const;

/** The fence settings the route is checked against (routeFence.ts). */
export const FENCE_CHECK_PARAMS = ['FENCE_ENABLE', 'FENCE_TYPE', 'FENCE_OPTIONS', 'FENCE_ALT_MAX', 'FENCE_RADIUS', 'FENCE_ACTION', 'FENCE_AUTOENABLE'] as const;

/**
 * Names for the same setting on different firmware (master's first): a vehicle has one, so when it sends one the
 * others are a previous vehicle's, and are dropped (they'd be read first, or shadow the live value).
 */
const RENAMED_GROUPS: string[][] = [
  ['WP_RADIUS_M', 'WPNAV_RADIUS_M', 'WPNAV_RADIUS'],
  ['WP_SPD', 'WPNAV_SPEED'],
  ['WP_SPD_UP', 'WPNAV_SPEED_UP'],
  ['WP_SPD_DN', 'WPNAV_SPEED_DN'],
  ['WP_ACC', 'WPNAV_ACCEL'],
  ['AIRSPEED_CRUISE', 'TRIM_ARSPD_CM'],
];

/** Everything planning reads from the vehicle, remembered for planning offline. */
export const PLANNING_PARAMS: readonly string[] = [...RADIUS_PARAMS, ...SPEED_PARAMS, ...FENCE_CHECK_PARAMS];

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
      for (const n of PLANNING_PARAMS) if (Number.isFinite(s.params?.[n])) params[n] = s.params[n];
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

/** The radius parameters a vehicle has (Copter: WP_RADIUS_M on master, WPNAV_RADIUS in cm on 4.6 and before). */
function radiusParamsFor(type: number): string[] {
  const cat = getVehicleCategory(type);
  const radius = cat === 'plane' ? ['WP_RADIUS', 'WP_LOITER_RAD'] : cat === 'copter' ? ['WP_RADIUS_M', 'WPNAV_RADIUS'] : cat === 'rover' ? ['WP_RADIUS'] : [];
  // Speeds (the current name and the 4.6 one; the missing one goes unanswered) and the fence, for the summary.
  const speeds =
    cat === 'plane'
      ? ['AIRSPEED_CRUISE', 'TRIM_ARSPD_CM', 'TECS_CLMB_MAX', 'TECS_SINK_MAX']
      : cat === 'copter'
        ? ['WP_SPD', 'WP_SPD_UP', 'WP_SPD_DN', 'WP_ACC', 'WPNAV_SPEED', 'WPNAV_SPEED_UP', 'WPNAV_SPEED_DN', 'WPNAV_ACCEL', 'RTL_LOIT_TIME']
        : cat === 'rover'
          ? ['WP_SPEED', 'CRUISE_SPEED']
          : [];
  return [...radius, ...speeds, ...(radius.length ? FENCE_CHECK_PARAMS : [])];
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
    for (const n of PLANNING_PARAMS) {
      const p = s.parameters[n];
      if (p && p !== prev.parameters[n] && p.value !== next.params[n]) {
        const params = { ...next.params, [n]: p.value };
        for (const group of RENAMED_GROUPS) if (group.includes(n)) for (const o of group) if (o !== n) delete params[o];
        next = { ...next, params };
      }
    }
  }
  if (next !== last) save(next);
});

// Another vehicle is commanded: the remembered planning values were the old one's, even when both are the same
// type. They start over and fill from the new vehicle's answers (asked for again: its sysid:type key differs).
onActiveVehicleChange(() => {
  askedFor = '';
  const last = useLastVehicleStore.getState();
  if (Object.keys(last.params).length > 0) save({ type: last.type, params: {} });
});
