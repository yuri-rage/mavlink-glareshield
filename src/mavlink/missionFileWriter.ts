// Writes the mission, geofence and rally points held on the map to files that this app, QGroundControl and
// Mission Planner can load again: QGC WPL 110 text (.waypoints) for each kind, or one QGC .plan with all three.
// Kept free of the connection and the store so it can be tested on its own.

import type { MissionItemIntData } from './encoder';
import { cmdHasLocation } from './messages';
import type { FencePoint, MissionWaypoint, RallyPoint } from '../store/telemetryStore';

const FENCE_RETURN_POINT = 5000;
const FENCE_POLYGON_INCLUSION = 5001;
const FENCE_POLYGON_EXCLUSION = 5002;
const FENCE_CIRCLE_INCLUSION = 5003;
const FENCE_CIRCLE_EXCLUSION = 5004;
const NAV_RALLY_POINT = 5100;
const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;

/** Mission items in upload order, seq 0 (home) first. */
export function waypointsToItems(waypoints: MissionWaypoint[]): MissionItemIntData[] {
  return [...waypoints]
    .sort((a, b) => a.seq - b.seq)
    .map((w) => ({
      seq: w.seq,
      command: w.command,
      frame: w.frame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT,
      current: w.seq === 0 ? 1 : 0,
      autocontinue: 1,
      param1: w.param1 ?? 0,
      param2: w.param2 ?? 0,
      param3: w.param3 ?? 0,
      param4: w.param4 ?? 0,
      x: w.lat,
      y: w.lon,
      z: w.alt,
      mission_type: 0,
    }));
}

export function fenceToItems(fencePoints: FencePoint[]): MissionItemIntData[] {
  return [...fencePoints]
    .sort((a, b) => a.seq - b.seq)
    .map((f, i) => ({
      seq: i,
      command: f.command,
      frame: MAV_FRAME_GLOBAL,
      autocontinue: 1,
      // Vertex count for a polygon point, radius for a circle.
      param1: f.param1 ?? f.radius ?? f.vertexCount ?? 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: f.lat,
      y: f.lon,
      z: f.alt ?? 0,
      mission_type: 1,
    }));
}

export function rallyToItems(rallyPoints: RallyPoint[]): MissionItemIntData[] {
  return [...rallyPoints]
    .sort((a, b) => a.seq - b.seq)
    .map((r, i) => ({
      seq: i,
      command: NAV_RALLY_POINT,
      frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: r.lat,
      y: r.lon,
      z: r.alt,
      mission_type: 2,
    }));
}

/** A float32 value without its binary noise (0.1 rather than 0.10000000149011612). */
const num = (v: number | undefined): number => {
  if (v === undefined || !Number.isFinite(v)) return 0;
  return Number(v.toPrecision(7));
};

/** Latitude and longitude keep the 1e-7 degree resolution of MISSION_ITEM_INT. */
const coord = (v: number | undefined, hasLocation: boolean): number => {
  if (v === undefined || !Number.isFinite(v)) return 0;
  return hasLocation ? Number(v.toFixed(7)) : num(v);
};

const flag = (v: number | boolean | undefined, fallback: number) => (v === undefined ? fallback : v ? 1 : 0);

/**
 * QGC WPL 110 text, the format Mission Planner saves: one tab-separated line per item with
 * seq, current, frame, command, param1-4, lat, lon, alt and autocontinue.
 */
export function toQgcWpl(items: MissionItemIntData[]): string {
  const lines = ['QGC WPL 110'];
  for (const it of items) {
    const loc = cmdHasLocation(it.command);
    lines.push(
      [
        it.seq,
        flag(it.current, 0),
        it.frame ?? MAV_FRAME_GLOBAL_RELATIVE_ALT,
        it.command,
        num(it.param1),
        num(it.param2),
        num(it.param3),
        num(it.param4),
        coord(it.x, loc),
        coord(it.y, loc),
        num(it.z),
        flag(it.autocontinue, 1),
      ].join('\t')
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface PlanInput {
  waypoints: MissionWaypoint[];
  fencePoints: FencePoint[];
  rallyPoints: RallyPoint[];
  /** The vehicle's home, used when the mission has no home item of its own. */
  home?: { lat: number; lon: number; alt: number } | null;
  /** MAV_TYPE from the heartbeat. */
  vehicleType?: number;
}

const located = (lat: number, lon: number) => lat !== 0 || lon !== 0;

/**
 * The fence as QGC describes it: polygons of consecutive vertices (each vertex carries the polygon's
 * vertex count in param1), circles, and the breach return point.
 */
export function groupFenceForPlan(fencePoints: FencePoint[]) {
  const items = fenceToItems(fencePoints);
  const polygons: { inclusion: boolean; polygon: [number, number][]; version: 1 }[] = [];
  const circles: { circle: { center: [number, number]; radius: number }; inclusion: boolean; version: 1 }[] = [];
  let breachReturn: [number, number, number] | undefined;

  for (let i = 0; i < items.length; ) {
    const it = items[i];
    const lat = coord(it.x, true);
    const lon = coord(it.y, true);
    if (it.command === FENCE_POLYGON_INCLUSION || it.command === FENCE_POLYGON_EXCLUSION) {
      const declared = Math.round(it.param1 ?? 0);
      const polygon: [number, number][] = [];
      // Take the declared number of vertices, or every following vertex of the same kind when the count is missing.
      while (
        i < items.length &&
        items[i].command === it.command &&
        (declared >= 3 ? polygon.length < declared : true)
      ) {
        polygon.push([coord(items[i].x, true), coord(items[i].y, true)]);
        i++;
      }
      if (polygon.length >= 3) polygons.push({ inclusion: it.command === FENCE_POLYGON_INCLUSION, polygon, version: 1 });
      continue;
    }
    if (it.command === FENCE_CIRCLE_INCLUSION || it.command === FENCE_CIRCLE_EXCLUSION) {
      circles.push({
        circle: { center: [lat, lon], radius: num(it.param1) },
        inclusion: it.command === FENCE_CIRCLE_INCLUSION,
        version: 1,
      });
    } else if (it.command === FENCE_RETURN_POINT) {
      breachReturn = [lat, lon, num(it.z)];
    }
    i++;
  }
  return { polygons, circles, breachReturn };
}

/** A QGroundControl .plan (JSON) holding the mission, the geofence and the rally points together. */
export function toQgcPlan(input: PlanInput): string {
  const items = waypointsToItems(input.waypoints);
  const homeItem = items.find((it) => it.seq === 0);

  // .plan files keep home apart from the mission items; without one, the first located point stands in so the
  // file still loads (the autopilot sets its own home when it arms).
  let home: [number, number, number] = [0, 0, 0];
  if (homeItem && located(homeItem.x ?? 0, homeItem.y ?? 0)) {
    home = [coord(homeItem.x, true), coord(homeItem.y, true), num(homeItem.z)];
  } else if (input.home && located(input.home.lat, input.home.lon)) {
    home = [coord(input.home.lat, true), coord(input.home.lon, true), num(input.home.alt)];
  } else {
    const first =
      input.waypoints.find((w) => w.seq > 0 && cmdHasLocation(w.command) && located(w.lat, w.lon)) ??
      input.fencePoints.find((f) => located(f.lat, f.lon)) ??
      input.rallyPoints.find((r) => located(r.lat, r.lon));
    if (first) home = [coord(first.lat, true), coord(first.lon, true), 0];
  }

  const missionItems = items
    .filter((it) => it.seq > 0)
    .map((it, i) => {
      const loc = cmdHasLocation(it.command);
      return {
        type: 'SimpleItem',
        autoContinue: true,
        command: it.command,
        doJumpId: i + 1,
        frame: it.frame,
        params: [num(it.param1), num(it.param2), num(it.param3), num(it.param4), coord(it.x, loc), coord(it.y, loc), num(it.z)],
      };
    });

  const { polygons, circles, breachReturn } = groupFenceForPlan(input.fencePoints);

  const plan = {
    fileType: 'Plan',
    groundStation: 'Glareshield',
    version: 1,
    mission: {
      version: 2,
      firmwareType: MAV_AUTOPILOT_ARDUPILOTMEGA,
      vehicleType: input.vehicleType ?? 0,
      cruiseSpeed: 15,
      hoverSpeed: 5,
      plannedHomePosition: home,
      items: missionItems,
    },
    geoFence: {
      version: 2,
      circles,
      polygons,
      ...(breachReturn ? { breachReturn } : {}),
    },
    rallyPoints: {
      version: 2,
      points: [...input.rallyPoints]
        .sort((a, b) => a.seq - b.seq)
        .map((r) => [coord(r.lat, true), coord(r.lon, true), num(r.alt)]),
    },
  };
  return `${JSON.stringify(plan, null, 2)}\n`;
}

/** A filename stem like "glareshield-sys1-20261107-1432". */
export function missionFileStem(systemId: number, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `glareshield-sys${systemId > 0 ? systemId : 1}-${stamp}`;
}
