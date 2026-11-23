// The path a mission's route is drawn along: straight legs, and for spline waypoints (MAV_CMD_NAV_SPLINE_WAYPOINT)
// the curve ArduPilot Copter actually flies. Pure functions, no map or store.
//
// ArduPilot (AC_WPNav::set_spline_destination_NED_m, AP_Math/SplineCurve, ArduCopter ModeAuto::get_spline_from_cmd):
// - A spline leg is a cubic Hermite curve from the previous waypoint (origin) to the spline waypoint (destination):
//     p(t) = o + v0 t + (-3o - 2 v0 + 3d - v1) t² + (2o + v0 - 2d + v1) t³,   t in [0, 1]
// - Origin velocity v0: if the vehicle passes through the origin without stopping (the previous leg was given a
//   next destination), the previous spline's destination velocity, or the previous straight leg's direction
//   (origin - its own origin). Otherwise zero.
// - Destination velocity v1: if the spline waypoint has no hold time (param1 = 0) and the next navigation command
//   has a location: towards that next point, from the origin if it is also a spline ("leave in the direction of the
//   full arc"), from the destination if not. Otherwise zero.
// - Both are scaled down together when |v0| + |v1| > 4 × |d - o| (SPLINE_FACTOR), to limit overshoot.
// - Velocities are zero across a change between terrain and non-terrain altitude.
// Velocities are vectors in metres, not unit vectors: their length shapes the curve.

import { cmdHasLocation, type VehicleCategory } from './messages';

/** A mission item, as much as the path needs. */
export interface PathItem {
  command: number;
  lat: number;
  lon: number;
  alt: number;
  frame: number;
  /** param1: for (spline) waypoints, the hold time in seconds. */
  param1: number;
}

export const CMD_NAV_WAYPOINT = 16;
export const CMD_NAV_SPLINE_WAYPOINT = 82;
const NAV_LAST = 95;
const SPLINE_FACTOR = 4;
/** Points per spline leg: smooth at any zoom for the leg lengths missions use. */
const SPLINE_SAMPLES = 32;

const isNav = (c: number) => c < NAV_LAST;
const isTerrain = (frame: number) => frame === 10 || frame === 11;
const drawable = (it: PathItem) =>
  cmdHasLocation(it.command) && (it.lat !== 0 || it.lon !== 0) && Math.abs(it.lat) <= 90 && Math.abs(it.lon) <= 180;

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const ZERO: V3 = [0, 0, 0];

/** Local metres (east, north, up) around a reference point; fine over the size of a mission. */
function makeFrame(lat0: number, lon0: number) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return {
    toLocal: (it: { lat: number; lon: number; alt: number }): V3 => [(it.lon - lon0) * mPerDegLon, (it.lat - lat0) * mPerDegLat, it.alt],
    toLatLng: (p: V3): [number, number] => [lat0 + p[1] / mPerDegLat, lon0 + p[0] / mPerDegLon],
  };
}

/** The Hermite curve ArduPilot flies from o to d, sampled (o included, d included). */
export function splineLeg(o: V3, d: V3, v0: V3, v1: V3, samples = SPLINE_SAMPLES): V3[] {
  const velLen = len(v0) + len(v1);
  const posLen = len(sub(d, o)) * SPLINE_FACTOR;
  if (posLen === 0) return [o, d];
  const k = velLen > posLen ? posLen / velLen : 1;
  const a0 = o;
  const a1 = mul(v0, k);
  const w1 = mul(v1, k);
  const a2 = add(add(add(mul(o, -3), mul(a1, -2)), mul(d, 3)), mul(w1, -1));
  const a3 = add(add(add(mul(o, 2), a1), mul(d, -2)), w1);
  const out: V3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    out.push(add(add(add(a0, mul(a1, t)), mul(a2, t * t)), mul(a3, t * t * t)));
  }
  return out;
}

export interface PathLeg {
  /** Indices into the item list of the leg's start and end. */
  from: number;
  to: number;
  spline: boolean;
  /** The leg as drawn: [lat, lon] from start to end (two points for a straight leg). */
  latLngs: [number, number][];
}

/**
 * The legs between consecutive drawn route points (`route`: item indices in order, e.g. home then each navigation
 * item with a position). A leg ending at a spline waypoint is curved when `splines` is true (the vehicle flies
 * them: Copter), else straight.
 */
export function missionPathLegs(items: PathItem[], route: number[], splines: boolean): PathLeg[] {
  if (route.length < 2) return [];
  const ref = items[route[0]];
  const frame = makeFrame(ref.lat, ref.lon);
  const legs: PathLeg[] = [];
  /** The destination velocity of the previous spline leg, for the next leg's origin; null when it wasn't one. */
  let prevSplineDestVel: V3 | null = null;

  /** The next navigation command after index i, if it has a drawable location. */
  const nextNavPoint = (i: number): number | null => {
    for (let j = i + 1; j < items.length; j++) {
      if (!isNav(items[j].command)) continue;
      return drawable(items[j]) ? j : null;
    }
    return null;
  };

  for (let k = 1; k < route.length; k++) {
    const fromI = route[k - 1];
    const toI = route[k];
    const from = items[fromI];
    const to = items[toI];
    const curved = splines && to.command === CMD_NAV_SPLINE_WAYPOINT;
    if (!curved) {
      legs.push({ from: fromI, to: toI, spline: false, latLngs: [[from.lat, from.lon], [to.lat, to.lon]] });
      prevSplineDestVel = null;
      continue;
    }

    const o = frame.toLocal(from);
    const d = frame.toLocal(to);
    const terrain = isTerrain(to.frame);

    // Origin velocity: the vehicle passes through `from` without stopping only if it was told where to go next
    // there: `from` holds for no time, it isn't home (the first leg starts from rest), and the frames match.
    let v0: V3 = ZERO;
    const passesThrough = k >= 2 && (from.param1 ?? 0) === 0 && isTerrain(from.frame) === terrain;
    if (passesThrough) {
      if (prevSplineDestVel) v0 = prevSplineDestVel;
      else v0 = sub(o, frame.toLocal(items[route[k - 2]]));
    }

    // Destination velocity: towards the next navigation point, if the spline doesn't hold and there is one.
    let v1: V3 = ZERO;
    const nextI = (to.param1 ?? 0) === 0 ? nextNavPoint(toI) : null;
    if (nextI !== null && isTerrain(items[nextI].frame) === terrain) {
      const n = frame.toLocal(items[nextI]);
      v1 = items[nextI].command === CMD_NAV_SPLINE_WAYPOINT ? sub(n, o) : sub(n, d);
    }

    legs.push({ from: fromI, to: toI, spline: true, latLngs: splineLeg(o, d, v0, v1).map(frame.toLatLng) });
    prevSplineDestVel = v1;
  }
  return legs;
}

/**
 * Whether this vehicle flies spline waypoints. Only Copter (and Heli) does; Rover, Plane and Sub don't handle the
 * command, and the mission skips it (start_command returns false, so the next one runs). An unknown vehicle is
 * drawn as a copter would fly it.
 */
export function fliesSplines(category: VehicleCategory): boolean {
  return category === 'copter' || category === 'generic';
}

/**
 * The items the drawn route goes through, in order: home (item 0) and every navigation command with a position.
 * A vehicle that doesn't fly splines skips spline waypoints, so they are left out of its route (their pins stay).
 */
export function routeIndices(items: PathItem[], splines: boolean): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (!drawable(it)) return;
    if (i === 0 || (isNav(it.command) && (splines || it.command !== CMD_NAV_SPLINE_WAYPOINT))) out.push(i);
  });
  return out;
}

/** All legs joined into one line for a polyline (each leg's first point is the previous leg's last). */
export function joinLegs(legs: PathLeg[]): [number, number][] {
  const out: [number, number][] = [];
  legs.forEach((leg, i) => out.push(...(i === 0 ? leg.latLngs : leg.latLngs.slice(1))));
  return out;
}

/** The point halfway along a leg (by sample), for its "+" handle. */
export function legMidpoint(leg: PathLeg): [number, number] {
  if (!leg.spline) {
    const [a, b] = leg.latLngs;
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return leg.latLngs[Math.floor(leg.latLngs.length / 2)];
}
