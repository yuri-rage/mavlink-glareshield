// The radius drawn around a waypoint while planning: the item's own radius where the vehicle uses one ("item",
// drawn yellow), else the vehicle's default for that kind of waypoint ("default", drawn white). As ArduPilot stores
// and flies them (AP_Mission::mavlink_int_to_mission_cmd and each vehicle's mode_auto / commands_logic):
//
// - NAV_WAYPOINT param2 (accept radius) is kept by Plane only (capped at 255 m; 0 = WP_RADIUS). Copter and Rover
//   store param1 (the hold time) in its place, so they use their default: WPNAV_RADIUS_M (m; older firmware
//   WPNAV_RADIUS in cm) and WP_RADIUS.
// - LOITER_UNLIM param3 and LOITER_TO_ALT param2 are the loiter radius (sign = direction) for Plane; 0 =
//   WP_LOITER_RAD. Copter holds position (no circle), and Rover has no LOITER_TO_ALT.
// - LOITER_TURNS param3 is the circle radius for all three (stored as a byte; over 255 m in tens of metres). Plane's
//   0 is WP_LOITER_RAD; Copter's 0 turns in place.
// - LOITER_TIME has no room for a radius: Plane always uses WP_LOITER_RAD, and the param3 entered is ignored.
// - SPLINE_WAYPOINT: Copter's waypoint radius.

import type { VehicleCategory } from './messages';

export const CMD = { WAYPOINT: 16, LOITER_UNLIM: 17, LOITER_TURNS: 18, LOITER_TIME: 19, LOITER_TO_ALT: 31, SPLINE_WAYPOINT: 82 } as const;

export interface WaypointRadius {
  radiusM: number;
  /** "item": the waypoint's own radius; "default": the vehicle's parameter (or its firmware default). */
  source: 'item' | 'default';
  /** What the circle is, for its tooltip: "Accept radius 5 m (item)". */
  label: string;
}

type ParamLookup = (name: string) => number | undefined;

/** ArduPilot's defaults, for when the vehicle's parameter hasn't been read. */
const DEFAULTS = { planeWp: 90, planeLoiter: 60, copterWp: 2, roverWp: 2 };

const positive = (v: number | undefined): number | undefined => (v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined);

/** The stored loiter-turns radius: a byte, or tens of metres above 255 (up to 2550). */
function turnsRadius(r: number): number {
  const a = Math.abs(r);
  return a <= 255 ? Math.floor(a) : Math.min(255, Math.floor(a * 0.1)) * 10;
}

function vehicleWpRadius(category: VehicleCategory, param: ParamLookup): { r: number; name: string } | null {
  if (category === 'plane') return { r: positive(param('WP_RADIUS')) ?? DEFAULTS.planeWp, name: 'WP_RADIUS' };
  if (category === 'copter') {
    const m = positive(param('WPNAV_RADIUS_M'));
    if (m !== undefined) return { r: m, name: 'WPNAV_RADIUS_M' };
    const cm = positive(param('WPNAV_RADIUS'));
    return cm !== undefined ? { r: cm / 100, name: 'WPNAV_RADIUS' } : { r: DEFAULTS.copterWp, name: 'WPNAV_RADIUS_M' };
  }
  if (category === 'rover') return { r: positive(param('WP_RADIUS')) ?? DEFAULTS.roverWp, name: 'WP_RADIUS' };
  return null; // sub, or an unknown vehicle (not connected): no default to show
}

const fmt = (r: number) => `${+r.toFixed(1)} m`;

/** The radius to draw around a mission item, or null when it has none (not a waypoint, or nothing to show). */
export function waypointRadius(
  item: { command: number; param2: number; param3: number },
  category: VehicleCategory,
  param: ParamLookup
): WaypointRadius | null {
  const def = (what: string): WaypointRadius | null => {
    const v = vehicleWpRadius(category, param);
    return v ? { radiusM: v.r, source: 'default', label: `${what} ${fmt(v.r)} (${v.name})` } : null;
  };
  const planeLoiter = (): WaypointRadius => {
    const r = positive(param('WP_LOITER_RAD') !== undefined ? Math.abs(param('WP_LOITER_RAD')!) : undefined) ?? DEFAULTS.planeLoiter;
    return { radiusM: r, source: 'default', label: `Loiter radius ${fmt(r)} (WP_LOITER_RAD)` };
  };
  const own = (r: number, what: string): WaypointRadius => ({ radiusM: r, source: 'item', label: `${what} ${fmt(r)} (this item)` });

  switch (item.command) {
    case CMD.WAYPOINT: {
      if (category === 'plane') {
        const acc = positive(Math.min(255, Math.floor(item.param2)));
        return acc !== undefined ? own(acc, 'Accept radius') : def('Waypoint radius');
      }
      return def('Waypoint radius');
    }
    case CMD.SPLINE_WAYPOINT:
      return def('Waypoint radius');
    case CMD.LOITER_UNLIM:
    case CMD.LOITER_TO_ALT: {
      if (category !== 'plane') return def('Waypoint radius');
      const r = positive(Math.abs(item.command === CMD.LOITER_UNLIM ? item.param3 : item.param2));
      return r !== undefined ? own(r, 'Loiter radius') : planeLoiter();
    }
    case CMD.LOITER_TURNS: {
      const r = positive(turnsRadius(item.param3));
      if (r !== undefined && (category === 'plane' || category === 'copter' || category === 'rover')) return own(r, 'Loiter radius');
      return category === 'plane' ? planeLoiter() : def('Waypoint radius');
    }
    case CMD.LOITER_TIME:
      return category === 'plane' ? planeLoiter() : def('Waypoint radius');
    default:
      return null;
  }
}
