// A mission's altitude profile over the terrain: points along the route (the drawn legs, splines included) with the
// planned altitude and the terrain beneath, both above sea level, and where the route comes too close to the terrain.
// Pure: terrain heights come from a lookup (lib/terrainService.ts heightNow, with the tiles fetched beforehand).
//
// How the vehicle flies it (ArduPilot, close enough for a profile):
// - Altitude changes linearly along a leg, between its ends' altitudes. Relative altitudes are above home (home's
//   MSL altitude), MSL ones as they are, terrain ones above the terrain at that end.
// - A leg is flown in its destination's frame (AC_WPNav::set_wp_destination_NED_m converts the origin when the frame
//   changes). Into an above-terrain waypoint, the height above the terrain changes linearly from the origin's (its
//   altitude less the terrain there) to the destination's: the planned altitude follows the ground beneath.
// - From home after a TAKEOFF: a climb at home to the takeoff altitude, then the leg. Not checked against terrain
//   (it starts on the ground). Without a TAKEOFF the vehicle starts the mission already flying, at a height unknown
//   here: the leg from home is taken as level with its destination (as missionPath draws it).
// - Into a LAND with a position: the vehicle goes there at its altitude, then descends. The descent isn't checked.

import { type PathItem, type PathLeg } from './missionPath';
import type { VehicleCategory } from './messages';

const CMD_NAV_TAKEOFF = 22;
const CMD_NAV_LAND = 21;
const CMD_NAV_VTOL_TAKEOFF = 84;
const CMD_NAV_VTOL_LAND = 85;
const isMsl = (f: number) => f === 0 || f === 5;
const isTerrainFrame = (f: number) => f === 10 || f === 11;

/** Checked against terrain: aircraft, and an unknown vehicle (offline planning). Rover, boat, sub and tracker aren't. */
export function terrainChecked(category: VehicleCategory): boolean {
  return category === 'copter' || category === 'plane' || category === 'generic';
}

export interface ProfilePoint {
  /** Distance along the route (m). */
  dist: number;
  lat: number;
  lon: number;
  /** Planned altitude and terrain, m above sea level (null where unknown). */
  alt: number | null;
  terrain: number | null;
  /** The leg (index into the legs) and whether this point is checked for clearance. */
  leg: number;
  checked: boolean;
}

export interface ProfileMark {
  /** Item index and its distance along the route. */
  item: number;
  dist: number;
  alt: number | null;
}

export interface MissionProfile {
  points: ProfilePoint[];
  /** The route's items (pins), at their distances. */
  marks: ProfileMark[];
  length: number;
  /** Home's altitude (m MSL) and where it came from: the mission's home item, or the terrain there. */
  homeMsl: number | null;
  homeFrom: 'mission' | 'terrain' | 'unknown';
}

export interface TerrainIssue {
  /** The item the leg ends at (where the warning shows). */
  index: number;
  severity: 'warning';
  message: string;
  /** Lowest height above terrain on the leg (m), and where (distance along the route). */
  minAgl: number;
  at: number;
}

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;
function distM(a: [number, number], b: [number, number]): number {
  const dlat = rad(b[0] - a[0]);
  const dlon = rad(b[1] - a[1]) * Math.cos(rad((a[0] + b[0]) / 2));
  return Math.hypot(dlat, dlon) * R;
}

/**
 * The profile of `legs` (from missionPathLegs) through `items`, sampling about every `stepM` metres. `homeMslHint`
 * is home's MSL altitude when known from elsewhere (the vehicle); else the mission's home item, else the terrain.
 */
export function missionProfile(
  items: PathItem[],
  legs: PathLeg[],
  terrainAt: (lat: number, lon: number) => number | null,
  opts: { stepM?: number; homeMslHint?: number | null } = {}
): MissionProfile {
  const stepM = opts.stepM ?? 20;
  const home = items[0];
  // Home without a position (offline, before a GPS fix) is 0, 0: never look up terrain there (Null Island, 0 m).
  const homeHasPos = Boolean(home && (home.lat !== 0 || home.lon !== 0));
  let homeMsl: number | null = null;
  let homeFrom: MissionProfile['homeFrom'] = 'unknown';
  if (opts.homeMslHint !== undefined && opts.homeMslHint !== null) {
    homeMsl = opts.homeMslHint;
    homeFrom = 'mission';
  } else if (home && isMsl(home.frame) && home.alt !== 0) {
    homeMsl = home.alt;
    homeFrom = 'mission';
  } else if (homeHasPos) {
    const t = terrainAt(home.lat, home.lon);
    if (t !== null) {
      homeMsl = t;
      homeFrom = 'terrain';
    }
  }

  /** An item's altitude MSL at its own position (terrain items need the terrain there). A takeoff without a position
   *  takes off from home: its above-terrain altitude is over home's terrain. */
  const endMsl = (i: number): number | null => {
    if (i === 0) return homeMsl;
    const it = items[i];
    if (isMsl(it.frame)) return it.alt;
    if (isTerrainFrame(it.frame)) {
      const noPos = it.lat === 0 && it.lon === 0;
      if (noPos && !homeHasPos) return null;
      const t = noPos ? terrainAt(home.lat, home.lon) : terrainAt(it.lat, it.lon);
      return t === null ? null : t + it.alt;
    }
    return homeMsl === null ? null : homeMsl + it.alt;
  };
  /** The last takeoff before item i: its altitude MSL, for the leg from home. */
  const takeoffMsl = (beforeI: number): number | null => {
    for (let j = beforeI - 1; j > 0; j--) {
      const c = items[j].command;
      if (c === CMD_NAV_TAKEOFF || c === CMD_NAV_VTOL_TAKEOFF) return endMsl(j) ?? null;
    }
    return null;
  };

  const points: ProfilePoint[] = [];
  const marks: ProfileMark[] = [];
  let dist = 0;
  legs.forEach((leg, li) => {
    const from = items[leg.from];
    const to = items[leg.to];
    const fromHome = leg.from === 0;
    const toLand = to.command === CMD_NAV_LAND || to.command === CMD_NAV_VTOL_LAND;
    // A takeoff with a position (Plane, VTOL): the leg to it is the climb from home's ground, not checked.
    const toTakeoff = fromHome && (to.command === CMD_NAV_TAKEOFF || to.command === CMD_NAV_VTOL_TAKEOFF);
    // The altitudes the leg runs between.
    const dest = endMsl(leg.to);
    const takeoff = fromHome ? takeoffMsl(leg.to) : null;
    const a0 = toTakeoff ? homeMsl : fromHome ? (takeoff ?? dest) : endMsl(leg.from);
    const a1 = toLand ? a0 : dest;
    // Flown above terrain when the destination is (and isn't a land, which keeps the altitude it arrives at).
    const terrainLeg = isTerrainFrame(to.frame) && !toLand && !toTakeoff;
    const fromTerrain = terrainAt(from.lat, from.lon);
    // The origin's height above terrain: its altitude less the terrain there (for the leg from home, the takeoff
    // altitude above home's ground, or level with the destination when there is no takeoff).
    const originAgl = fromHome && takeoff === null ? to.alt : a0 !== null && fromTerrain !== null ? a0 - fromTerrain : null;
    if (marks.length === 0) {
      marks.push({ item: leg.from, dist: 0, alt: fromHome ? homeMsl : a0 });
      // The climb at home: from the ground to the takeoff altitude, unchecked.
      if (fromHome && takeoff !== null && homeMsl !== null && takeoff !== homeMsl) {
        points.push({ dist: 0, lat: from.lat, lon: from.lon, alt: homeMsl, terrain: terrainAt(from.lat, from.lon), leg: li, checked: false });
      }
    }
    // Sample along the drawn shape.
    const pts = leg.latLngs;
    const segLens = pts.slice(1).map((p, k) => distM(pts[k], p));
    const legLen = segLens.reduce((s, x) => s + x, 0);
    const n = Math.max(1, Math.ceil(legLen / stepM));
    for (let s = li === 0 ? 0 : 1; s <= n; s++) {
      const target = (legLen * s) / n;
      // Locate along the polyline.
      let acc = 0;
      let k = 0;
      while (k < segLens.length - 1 && acc + segLens[k] < target) acc += segLens[k++];
      const f = segLens[k] > 0 ? (target - acc) / segLens[k] : 0;
      const lat = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f;
      const lon = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f;
      const frac = legLen > 0 ? target / legLen : 1;
      const terrain = terrainAt(lat, lon);
      let alt: number | null;
      if (terrainLeg) alt = terrain === null || originAgl === null ? null : terrain + originAgl + (to.alt - originAgl) * frac;
      else alt = a0 === null || a1 === null ? null : a0 + (a1 - a0) * frac;
      // Unchecked: the leg's first point when it leaves home on the ground (no takeoff to climb), nothing else here.
      points.push({ dist: dist + target, lat, lon, alt, terrain, leg: li, checked: !toTakeoff && !(fromHome && s === 0) });
    }
    dist += legLen;
    // Into a land: the descent at the land point, unchecked.
    if (toLand) {
      const t = terrainAt(to.lat, to.lon);
      points.push({ dist, lat: to.lat, lon: to.lon, alt: t, terrain: t, leg: li, checked: false });
    }
    marks.push({ item: leg.to, dist, alt: toLand ? terrainAt(to.lat, to.lon) : terrainLeg ? endMsl(leg.to) : a1 });
  });
  return { points, marks, length: dist, homeMsl, homeFrom };
}

/**
 * A height in whole metres, the default for the messages (the app passes one in the user's units). Any height above
 * zero is at least one unit: never "0 m below" for a fraction under.
 */
const wholeMetres = (m: number) => `${m > 0 ? Math.max(1, Math.round(m)) : Math.round(m)} m`;

/**
 * Where the route comes within `clearanceM` of the terrain (or below it), one issue per leg, at the leg's end item.
 * `fmt` writes a height (m) for the message, in the user's units.
 */
export function terrainIssues(profile: MissionProfile, legs: PathLeg[], clearanceM: number, fmt: (m: number) => string = wholeMetres): TerrainIssue[] {
  const worst = new Map<number, { agl: number; at: number }>();
  for (const p of profile.points) {
    if (!p.checked || p.alt === null || p.terrain === null) continue;
    const agl = p.alt - p.terrain;
    const w = worst.get(p.leg);
    if (!w || agl < w.agl) worst.set(p.leg, { agl, at: p.dist });
  }
  const out: TerrainIssue[] = [];
  for (const [li, w] of [...worst.entries()].sort((a, b) => a[0] - b[0])) {
    if (w.agl >= clearanceM) continue;
    const leg = legs[li];
    const where = leg.from === 0 ? `from home to #${leg.to}` : `from #${leg.from} to #${leg.to}`;
    const below = w.agl < 0 ? -w.agl : 0; // the formatter rounds, to at least one of its units
    out.push({
      index: leg.to,
      severity: 'warning',
      minAgl: w.agl,
      at: w.at,
      message:
        w.agl < 0
          ? `The leg ${where} goes ${fmt(below)} below the terrain.`
          : `The leg ${where} comes within ${fmt(w.agl)} of the terrain (clearance ${fmt(clearanceM)}).`,
    });
  }
  return out;
}
