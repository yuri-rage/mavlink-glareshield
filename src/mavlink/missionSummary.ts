// A mission's summary while planning: how far it flies, roughly how long it takes, how high and how far from home
// it goes. The mission is walked the way the vehicle runs it: DO_JUMPs repeat their legs (an endless one, or an
// unlimited loiter, leaves the time open), DO_CHANGE_SPEED changes the speed from there on, holds and loiters add
// their time, RTL and LAND end it. Leg lengths come from the route as drawn (spline legs as curves), so the numbers
// match the map.
//
// Speeds are the vehicle's parameters (firmware defaults when not read):
// - Copter: WP_SPD, WP_SPD_UP, WP_SPD_DN (m/s, master); WPNAV_SPEED, _UP, _DN (cm/s, 4.6 and before). Each run
//   between stops (a hold, a loiter, a landing, RTL) also spends speed / acceleration speeding up and slowing down
//   (WP_ACC m/s², WPNAV_ACCEL cm/s²), and RTL waits RTL_LOIT_TIME (ms) over home before descending.
// - Plane: AIRSPEED_CRUISE (m/s; TRIM_ARSPD_CM in cm/s before), climbing and sinking at TECS_CLMB_MAX, TECS_SINK_MAX.
// - Rover: WP_SPEED (m/s; CRUISE_SPEED when 0).
// A leg takes the longer of its horizontal and vertical times (both happen together). No wind, no acceleration: an
// estimate, said so where it's shown.

import type { VehicleCategory } from './messages';
import type { PathLeg } from './missionPath';
import { cmdHasLocation } from './messages';

export interface SummaryItem {
  command: number;
  param1: number;
  param2: number;
  param3: number;
  x: number;
  y: number;
  z: number;
}

export interface VehicleSpeeds {
  /** Horizontal (Plane: airspeed), m/s. */
  horizontal: number;
  up: number;
  down: number;
  /** Copter: horizontal acceleration, m/s² (speeding up and slowing down at stops); undefined for the others. */
  accel?: number;
  /** Copter: RTL's wait over home before descending, s. */
  rtlLoiterS?: number;
  /** Which parameters they came from, for the tooltip. */
  source: string;
}

export interface MissionSummary {
  /** Along the route, m. */
  distanceM: number;
  /** Estimated, s. */
  timeS: number;
  /** Why the time has no end (an unlimited loiter, an endless jump), or null. */
  openEnded: string | null;
  /** Highest item altitude (as entered, above home for relative items), m. */
  maxAltM: number;
  /** Farthest item from home, m. */
  farthestM: number;
  /** DO_JUMPs were followed (repeats counted). */
  jumps: boolean;
  speeds: VehicleSpeeds;
}

const CMD = {
  WAYPOINT: 16,
  LOITER_UNLIM: 17,
  LOITER_TURNS: 18,
  LOITER_TIME: 19,
  RTL: 20,
  LAND: 21,
  TAKEOFF: 22,
  LOITER_TO_ALT: 31,
  SPLINE_WAYPOINT: 82,
  VTOL_TAKEOFF: 84,
  VTOL_LAND: 85,
  DELAY: 93,
  DO_JUMP: 177,
  DO_CHANGE_SPEED: 178,
} as const;

type ParamLookup = (name: string) => number | undefined;
const pos = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined);

/** The vehicle's mission speeds, from its parameters (or the firmware defaults). */
export function vehicleSpeeds(category: VehicleCategory, param: ParamLookup): VehicleSpeeds {
  if (category === 'plane') {
    const cruise = pos(param('AIRSPEED_CRUISE')) ?? (pos(param('TRIM_ARSPD_CM')) !== undefined ? param('TRIM_ARSPD_CM')! / 100 : undefined);
    return {
      horizontal: cruise ?? 12,
      up: pos(param('TECS_CLMB_MAX')) ?? 5,
      down: pos(param('TECS_SINK_MAX')) ?? 5,
      source: cruise !== undefined ? 'AIRSPEED_CRUISE' : 'default cruise (12 m/s)',
    };
  }
  if (category === 'rover') {
    const wp = pos(param('WP_SPEED'));
    const cruise = pos(param('CRUISE_SPEED'));
    return { horizontal: wp ?? cruise ?? 2, up: 1, down: 1, source: wp !== undefined ? 'WP_SPEED' : cruise !== undefined ? 'CRUISE_SPEED' : 'default (2 m/s)' };
  }
  // Copter (and anything else flying waypoints the same way)
  const m = pos(param('WP_SPD'));
  const cm = pos(param('WPNAV_SPEED'));
  const up = pos(param('WP_SPD_UP')) ?? (pos(param('WPNAV_SPEED_UP')) !== undefined ? param('WPNAV_SPEED_UP')! / 100 : undefined);
  const dn = pos(param('WP_SPD_DN')) ?? (pos(param('WPNAV_SPEED_DN')) !== undefined ? param('WPNAV_SPEED_DN')! / 100 : undefined);
  const accM = pos(param('WP_ACC'));
  const accCm = pos(param('WPNAV_ACCEL'));
  const rtlLoit = param('RTL_LOIT_TIME');
  return {
    horizontal: m ?? (cm !== undefined ? cm / 100 : 10),
    up: up ?? 2.5,
    down: dn ?? 1.5,
    accel: accM ?? (accCm !== undefined ? accCm / 100 : 2.5),
    rtlLoiterS: rtlLoit !== undefined && Number.isFinite(rtlLoit) && rtlLoit >= 0 ? rtlLoit / 1000 : 5,
    source: m !== undefined ? 'WP_SPD' : cm !== undefined ? 'WPNAV_SPEED' : 'default (10 m/s)',
  };
}

const R = 6371008.8;
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const polylineM = (pts: [number, number][]) => pts.reduce((sum, p, i) => (i === 0 ? 0 : sum + distanceM(pts[i - 1][0], pts[i - 1][1], p[0], p[1])), 0);

/** The last few metres of a Copter landing, at its landing speed (LAND_SPEED default 0.5 m/s below 10 m). */
const COPTER_LAND_FINAL_M = 10;
const COPTER_LAND_FINAL_SPEED = 0.5;
/** Steps through the mission before giving up (a jump loop with huge repeat counts). */
const MAX_STEPS = 20000;

/**
 * The summary of `items` (items[0] is home), for a vehicle of `category`. `legs` are the route as drawn
 * (missionPathLegs), used for the length of each leg between consecutive route items; any other pair is measured
 * straight.
 */
export function missionSummary(items: SummaryItem[], category: VehicleCategory, param: ParamLookup, legs: PathLeg[] = []): MissionSummary {
  const speeds = vehicleSpeeds(category, param);
  const home = items[0];
  const out: MissionSummary = { distanceM: 0, timeS: 0, openEnded: null, maxAltM: 0, farthestM: 0, jumps: false, speeds };
  if (!home || items.length < 2) return out;
  const drawn = new Map(legs.map((l) => [`${l.from}>${l.to}`, polylineM(l.latLngs)]));
  const copter = category !== 'plane' && category !== 'rover';
  let speed = speeds.horizontal;
  let at = { lat: home.x, lon: home.y, index: 0 };
  let alt = 0;
  const jumpCounts = new Map<number, number>();

  const climbTime = (to: number) => (to > alt ? (to - alt) / speeds.up : (alt - to) / speeds.down);
  const landTime = (from: number) =>
    copter
      ? Math.max(0, from - COPTER_LAND_FINAL_M) / speeds.down + Math.min(from, COPTER_LAND_FINAL_M) / COPTER_LAND_FINAL_SPEED
      : category === 'plane'
        ? 0 // a plane's landing approach is its leg
        : 0;
  // A Copter run between stops: speeding up from and slowing down to a stop adds speed / acceleration.
  let running = false;
  const stop = () => {
    if (copter && running && speeds.accel) out.timeS += speed / speeds.accel;
    running = false;
  };
  const goTo = (index: number, lat: number, lon: number, toAlt: number) => {
    running = true;
    const key = `${at.index}>${index}`;
    const h = drawn.get(key) ?? distanceM(at.lat, at.lon, lat, lon);
    const hTime = h / speed;
    const vTime = category === 'rover' ? 0 : climbTime(toAlt);
    out.distanceM += h;
    out.timeS += Math.max(hTime, vTime);
    at = { lat, lon, index };
    if (category !== 'rover') alt = toAlt;
    out.maxAltM = Math.max(out.maxAltM, toAlt);
    out.farthestM = Math.max(out.farthestM, distanceM(home.x, home.y, lat, lon));
  };

  let seq = 1;
  for (let steps = 0; seq < items.length && steps < MAX_STEPS; steps++) {
    const it = items[seq];
    const hasPos = cmdHasLocation(it.command) && (it.x !== 0 || it.y !== 0);
    switch (it.command) {
      case CMD.DO_JUMP: {
        out.jumps = true;
        const target = Math.round(it.param1);
        const repeat = Math.round(it.param2);
        if (repeat < 0) {
          out.openEnded = `jump at #${seq} repeats forever`;
          return out;
        }
        const done = jumpCounts.get(seq) ?? 0;
        if (done < repeat && target >= 1 && target < items.length) {
          jumpCounts.set(seq, done + 1);
          seq = target;
          continue;
        }
        break;
      }
      case CMD.DO_CHANGE_SPEED: {
        // Plane takes an airspeed (type 0); Copter and Rover a groundspeed (Copter treats airspeed as one too).
        const type = Math.round(it.param1);
        if (it.param2 > 0 && (category === 'plane' ? type === 0 : type === 0 || type === 1)) speed = it.param2;
        if (category === 'plane' && it.param2 === -2) speed = speeds.horizontal;
        break;
      }
      case CMD.TAKEOFF:
      case CMD.VTOL_TAKEOFF:
        if (hasPos) goTo(seq, it.x, it.y, it.z);
        else {
          out.timeS += it.z > alt ? (it.z - alt) / speeds.up : 0;
          alt = Math.max(alt, it.z);
          out.maxAltM = Math.max(out.maxAltM, it.z);
        }
        break;
      case CMD.DELAY:
        if (it.param1 > 0) out.timeS += it.param1;
        break;
      case CMD.RTL:
        stop(); // the mission's last leg ends; RTL sets off from a stop
        goTo(0, home.x, home.y, alt);
        stop();
        if (copter) out.timeS += speeds.rtlLoiterS ?? 0;
        out.timeS += landTime(alt);
        return out;
      case CMD.LAND:
      case CMD.VTOL_LAND:
        if (hasPos) goTo(seq, it.x, it.y, alt);
        stop();
        out.timeS += category === 'plane' && it.command === CMD.LAND ? 0 : landTime(alt);
        return out;
      default:
        if (!hasPos) break;
        goTo(seq, it.x, it.y, it.z);
        if (it.command === CMD.WAYPOINT || it.command === CMD.SPLINE_WAYPOINT) {
          // Copter and Rover hold for param1 seconds; Plane keeps its accept/pass radius there instead.
          if (category !== 'plane' && it.param1 > 0) {
            stop();
            out.timeS += it.param1;
          }
        } else if (it.command === CMD.LOITER_TIME) {
          stop();
          if (it.param1 > 0) out.timeS += it.param1;
        } else if (it.command === CMD.LOITER_TURNS) {
          stop();
          const r = Math.abs(it.param3) || (category === 'plane' ? Math.abs(param('WP_LOITER_RAD') ?? 60) : 0);
          if (r > 0 && it.param1 > 0) out.timeS += (it.param1 * 2 * Math.PI * r) / speed;
        } else if (it.command === CMD.LOITER_UNLIM) {
          out.openEnded = `loiters at #${seq} until switched`;
          return out;
        }
    }
    seq++;
  }
  if (seq < items.length) out.openEnded = 'too many jump repeats to follow';
  stop();
  return out;
}
