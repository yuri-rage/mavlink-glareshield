// A geofence being edited on the map, kept apart from the vehicle's until uploaded. Plain data and pure functions
// (no store, no connection, no React), like missionDraft.ts and rallyDraft.ts.
//
// ArduPilot (AC_PolyFence_loader, MissionItemProtocol_Fence):
// - Items are MAV_CMD_NAV_FENCE_*: polygon vertices (inclusion 5001 / exclusion 5002, each carrying its polygon's
//   vertex count in param1, a polygon's vertices contiguous), circles (inclusion 5003 / exclusion 5004, radius in
//   param1) and at most one return point (5000). Only latitude/longitude are stored: no altitudes.
// - validate_fence rejects a polygon with fewer than 3 vertices, a non-positive radius and a second return point. It
//   does not check self-intersection, which breaks the inside test, so the editor does.
// - Breach: inside any exclusion zone; outside any inclusion zone (their intersection), or outside all of them when
//   FENCE_OPTIONS bit 1 (union of inclusion areas) is set.
// - A new fence takes effect at once: a vehicle armed with fencing on that is outside it takes its fence action.

import type { MissionItemIntData } from './encoder';
import type { FencePoint } from '../store/telemetryStore';

export const CMD_FENCE_RETURN_POINT = 5000;
export const CMD_FENCE_POLYGON_INCLUSION = 5001;
export const CMD_FENCE_POLYGON_EXCLUSION = 5002;
export const CMD_FENCE_CIRCLE_INCLUSION = 5003;
export const CMD_FENCE_CIRCLE_EXCLUSION = 5004;
const MAV_FRAME_GLOBAL = 0;

/** Radius for a new circle (m). */
export const DEFAULT_CIRCLE_RADIUS = 50;

export interface LatLon {
  lat: number;
  lon: number;
}

export type FenceShape =
  | { kind: 'polygon'; inclusion: boolean; vertices: LatLon[] }
  | { kind: 'circle'; inclusion: boolean; center: LatLon; radius: number };

export interface FenceDraft {
  shapes: FenceShape[];
  /** Where the vehicle goes on a breach (FENCE_RET_RALLY = 0); null when there is none. */
  returnPoint: LatLon | null;
}


export const EMPTY_FENCE: FenceDraft = { shapes: [], returnPoint: null };

const finite = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------------------------------------
// Conversions
// ------------------------------------------------------------------------------------------------

/**
 * A draft from fence items in any order (a file, or what the vehicle sent). Polygon vertices are grouped as
 * ArduPilot groups them: a run of the same command whose length is the vertex count each carries in param1.
 */
export function fenceDraftFromItems(items: MissionItemIntData[]): FenceDraft {
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  const shapes: FenceShape[] = [];
  let returnPoint: LatLon | null = null;
  let current: { command: number; count: number; vertices: LatLon[] } | null = null;
  const flush = () => {
    if (current && current.vertices.length > 0) {
      shapes.push({ kind: 'polygon', inclusion: current.command === CMD_FENCE_POLYGON_INCLUSION, vertices: current.vertices });
    }
    current = null;
  };

  for (const it of sorted) {
    const at = { lat: finite(it.x), lon: finite(it.y) };
    if (it.command === CMD_FENCE_POLYGON_INCLUSION || it.command === CMD_FENCE_POLYGON_EXCLUSION) {
      const count = Math.round(finite(it.param1));
      if (!current || current.command !== it.command || current.vertices.length >= current.count) {
        flush();
        current = { command: it.command, count: count >= 1 ? count : Number.MAX_SAFE_INTEGER, vertices: [] };
      }
      current.vertices.push(at);
      continue;
    }
    flush();
    if (it.command === CMD_FENCE_CIRCLE_INCLUSION || it.command === CMD_FENCE_CIRCLE_EXCLUSION) {
      shapes.push({ kind: 'circle', inclusion: it.command === CMD_FENCE_CIRCLE_INCLUSION, center: at, radius: finite(it.param1) });
    } else if (it.command === CMD_FENCE_RETURN_POINT) {
      returnPoint = at;
    }
  }
  flush();
  return { shapes, returnPoint };
}

/** A draft from the fence the vehicle reported (the telemetry store's fence points). */
export function fenceDraftFromPoints(points: FencePoint[]): FenceDraft {
  return fenceDraftFromItems(
    points.map((p) => ({
      seq: p.seq,
      command: p.command,
      x: p.lat,
      y: p.lon,
      z: p.alt ?? 0,
      // Polygons carry their vertex count in param1, circles their radius.
      param1: p.param1 ?? (p.command === CMD_FENCE_CIRCLE_INCLUSION || p.command === CMD_FENCE_CIRCLE_EXCLUSION ? p.radius : p.vertexCount) ?? 0,
    }))
  );
}

/** Items ready to upload or save (mission_type 1): shapes in order, then the return point. */
export function fenceDraftToItems(draft: FenceDraft): MissionItemIntData[] {
  const items: MissionItemIntData[] = [];
  const push = (command: number, at: LatLon, param1: number) =>
    items.push({
      seq: items.length,
      command,
      frame: MAV_FRAME_GLOBAL,
      current: 0,
      autocontinue: 1,
      param1,
      param2: 0,
      param3: 0,
      param4: 0,
      x: at.lat,
      y: at.lon,
      z: 0,
      mission_type: 1,
    });
  for (const s of draft.shapes) {
    if (s.kind === 'polygon') {
      const cmd = s.inclusion ? CMD_FENCE_POLYGON_INCLUSION : CMD_FENCE_POLYGON_EXCLUSION;
      s.vertices.forEach((v) => push(cmd, v, s.vertices.length));
    } else {
      push(s.inclusion ? CMD_FENCE_CIRCLE_INCLUSION : CMD_FENCE_CIRCLE_EXCLUSION, s.center, s.radius);
    }
  }
  if (draft.returnPoint) push(CMD_FENCE_RETURN_POINT, draft.returnPoint, 0);
  return items;
}

/** The draft as the telemetry store's fence points (for the file writers and the map's fence rendering). */
export function fenceDraftToPoints(draft: FenceDraft): FencePoint[] {
  return fenceDraftToItems(draft).map((it) => {
    const circle = it.command === CMD_FENCE_CIRCLE_INCLUSION || it.command === CMD_FENCE_CIRCLE_EXCLUSION;
    const polygon = it.command === CMD_FENCE_POLYGON_INCLUSION || it.command === CMD_FENCE_POLYGON_EXCLUSION;
    return {
      seq: it.seq,
      command: it.command,
      lat: it.x ?? 0,
      lon: it.y ?? 0,
      param1: it.param1,
      ...(circle ? { radius: it.param1 } : {}),
      ...(polygon ? { vertexCount: it.param1 } : {}),
      ...(circle || polygon ? { inclusion: it.command === CMD_FENCE_POLYGON_INCLUSION || it.command === CMD_FENCE_CIRCLE_INCLUSION } : {}),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Geometry (local metres; fine at fence scale)
// ------------------------------------------------------------------------------------------------

const M_PER_DEG_LAT = 111320;
const mPerDegLon = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** Great-circle-free distance in metres, accurate at fence scale. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dx = (b.lon - a.lon) * mPerDegLon((a.lat + b.lat) / 2);
  const dy = (b.lat - a.lat) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** The point at `distance` m along `bearingDeg` from `from`, for a circle's radius handle. */
export function offsetPoint(from: LatLon, distance: number, bearingDeg: number): LatLon {
  const b = (bearingDeg * Math.PI) / 180;
  return { lat: from.lat + (distance * Math.cos(b)) / M_PER_DEG_LAT, lon: from.lon + (distance * Math.sin(b)) / mPerDegLon(from.lat) };
}

/** Ray-casting point-in-polygon, as ArduPilot's Polygon_outside does (on lat/lon). */
export function insidePolygon(p: LatLon, vertices: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** The polygon's centre handle: the average of its vertices. */
export function polygonCenter(vertices: LatLon[]): LatLon {
  const n = Math.max(1, vertices.length);
  return { lat: vertices.reduce((s, v) => s + v.lat, 0) / n, lon: vertices.reduce((s, v) => s + v.lon, 0) / n };
}

/** Area in m² (shoelace, local metres). */
export function polygonAreaM2(vertices: LatLon[]): number {
  if (vertices.length < 3) return 0;
  const o = vertices[0];
  const xy = vertices.map((v) => [(v.lon - o.lon) * mPerDegLon(o.lat), (v.lat - o.lat) * M_PER_DEG_LAT]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function segmentsCross(p1: LatLon, p2: LatLon, p3: LatLon, p4: LatLon): boolean {
  const d = (a: LatLon, b: LatLon, c: LatLon) => (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two non-adjacent edges cross. */
export function selfIntersects(vertices: LatLon[]): boolean {
  const n = vertices.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsCross(vertices[i], vertices[(i + 1) % n], vertices[j], vertices[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * Whether `p` is outside the fence, as ArduPilot decides it (AC_PolyFence_loader::breached): inside any exclusion
 * zone, or outside the inclusion zones (any of them by default; all of them with `inclusionUnion`).
 */
export function fenceBreached(draft: FenceDraft, p: LatLon, opts: { inclusionUnion?: boolean } = {}): boolean {
  let inclusions = 0;
  let outsideInclusions = 0;
  for (const s of draft.shapes) {
    const inside = s.kind === 'polygon' ? s.vertices.length >= 3 && insidePolygon(p, s.vertices) : distanceM(p, s.center) <= s.radius;
    if (s.inclusion) {
      inclusions++;
      if (!inside) outsideInclusions++;
    } else if (inside) {
      return true;
    }
  }
  return opts.inclusionUnion ? inclusions > 0 && outsideInclusions === inclusions : outsideInclusions > 0;
}

/**
 * Why `p` breaches the fence, by shape (F1 is shape 0), following the same rule as fenceBreached; empty when it
 * doesn't. Being inside an exclusion zone is a breach on its own; inclusion zones breach when `p` is outside any of
 * them (or, with `inclusionUnion`, outside all of them).
 */
export function fenceBreachReasons(draft: FenceDraft, p: LatLon, opts: { inclusionUnion?: boolean } = {}): string[] {
  const reasons: string[] = [];
  const outside: number[] = [];
  let inclusions = 0;
  draft.shapes.forEach((s, i) => {
    const inside = s.kind === 'polygon' ? s.vertices.length >= 3 && insidePolygon(p, s.vertices) : distanceM(p, s.center) <= s.radius;
    if (s.inclusion) {
      inclusions++;
      if (!inside) outside.push(i);
    } else if (inside) {
      reasons.push(`inside exclusion ${s.kind} F${i + 1}`);
    }
  });
  const names = (list: number[]) => list.map((i) => `F${i + 1}`).join(', ');
  if (opts.inclusionUnion) {
    if (inclusions > 0 && outside.length === inclusions) reasons.push(`outside every inclusion zone (${names(outside)})`);
  } else if (outside.length > 0) {
    reasons.push(`outside inclusion zone${outside.length === 1 ? '' : 's'} ${names(outside)}`);
  }
  return reasons;
}

/** What uploading `draft` changes from the vehicle's fence `vehicle`, in words, shape by shape. */
export function fenceChanges(vehicle: FenceDraft, draft: FenceDraft): string[] {
  const out: string[] = [];
  const label = (s: FenceShape) => `${s.inclusion ? 'inclusion' : 'exclusion'} ${s.kind}`;
  const n = Math.max(vehicle.shapes.length, draft.shapes.length);
  for (let i = 0; i < n; i++) {
    const a = vehicle.shapes[i];
    const b = draft.shapes[i];
    if (!a) out.push(`F${i + 1} added: ${label(b)}`);
    else if (!b) out.push(`F${i + 1} removed: ${label(a)}`);
    else if (compareFenceDrafts({ shapes: [a], returnPoint: null }, { shapes: [b], returnPoint: null }).length > 0) {
      out.push(`F${i + 1} changed: ${label(a) === label(b) ? label(b) : `${label(a)} → ${label(b)}`}`);
    }
  }
  if (!vehicle.returnPoint && draft.returnPoint) out.push('return point added');
  else if (vehicle.returnPoint && !draft.returnPoint) out.push('return point removed');
  else if (vehicle.returnPoint && draft.returnPoint && compareFenceDrafts({ shapes: [], returnPoint: vehicle.returnPoint }, { shapes: [], returnPoint: draft.returnPoint }).length > 0) {
    out.push('return point moved');
  }
  return out;
}

/**
 * What the vehicle does on a fence breach for FENCE_ACTION `action` (AC_Fence parameter docs), as a phrase that
 * follows "the vehicle will", or null for report only. Copter disarms instead when it is on the ground.
 */
export function fenceActionText(category: string, action: number | undefined): string | null {
  if (action === undefined) return 'take its fence action (FENCE_ACTION unknown)';
  const a = Math.round(action);
  if (a === 0) return null;
  const table: Record<string, Record<number, string>> = {
    copter: { 1: 'RTL (or land)', 2: 'land', 3: 'SmartRTL (or RTL, or land)', 4: 'brake (or land)', 5: 'SmartRTL (or land)' },
    rover: { 1: 'RTL (or hold)', 2: 'hold', 3: 'SmartRTL (or RTL, or hold)', 4: 'SmartRTL (or hold)', 5: 'TERMINATE (disarm)', 6: 'loiter (or hold)' },
    plane: { 1: 'RTL (to the fence return point if set)', 6: 'switch to Guided (to the fence return point if set)', 7: 'switch to Guided, throttle passed through', 8: 'AUTOLAND if possible, else RTL' },
  };
  return table[category]?.[a] ?? `take fence action ${a}`;
}

/** MAV_SYS_STATUS_GEOFENCE: ArduPilot reports it enabled when a fence is enabled with an action other than report. */
const SYS_STATUS_GEOFENCE = 1 << 20;

/** The parameters the fence checks read; the editor and the upload dialog ask the vehicle for them by name. */
export const FENCE_PARAMS = ['FENCE_ENABLE', 'FENCE_TYPE', 'FENCE_ACTION', 'FENCE_OPTIONS', 'FENCE_AUTOENABLE'];

/**
 * Whether the vehicle's fence is on (enforcing, with an action), or undefined when it can't be told (treated as
 * possibly on). ArduPilot's SYS_STATUS geofence bit is authoritative when it reports the fence present: enabled then
 * covers FENCE_ENABLE, auto-enable and an RC switch, and excludes report-only. But polygons count as present only once
 * some are loaded, so a vehicle with fencing on and no fence yet reports nothing, and the first upload enforces at
 * once: then fall back to the parameters.
 */
export function fencingState(v: {
  sensorsPresent: number;
  sensorsEnabled: number;
  fenceEnable?: number;
  fenceAction?: number;
  fenceAutoEnable?: number;
  armed: boolean;
}): boolean | undefined {
  if ((v.sensorsPresent & SYS_STATUS_GEOFENCE) !== 0) return (v.sensorsEnabled & SYS_STATUS_GEOFENCE) !== 0;
  if (v.fenceAction !== undefined && Math.round(v.fenceAction) === 0) return false;
  if (v.fenceEnable === undefined) return undefined;
  if (Math.round(v.fenceEnable) === 1) return true;
  // Auto-enabled fences switch on at arming or takeoff: can't tell from here.
  if (v.armed && v.fenceAutoEnable !== undefined && Math.round(v.fenceAutoEnable) !== 0) return undefined;
  return false;
}

// ------------------------------------------------------------------------------------------------
// Edits (immutable; an invalid index throws, as in missionDraft)
// ------------------------------------------------------------------------------------------------

function assertShape(draft: FenceDraft, s: number, kind?: FenceShape['kind']): FenceShape {
  const shape = draft.shapes[s];
  if (!shape || (kind && shape.kind !== kind)) throw new RangeError(`Fence shape ${s} doesn't exist${kind ? ` as a ${kind}` : ''}`);
  return shape;
}
const withShape = (draft: FenceDraft, s: number, shape: FenceShape): FenceDraft => ({
  ...draft,
  shapes: draft.shapes.map((x, i) => (i === s ? shape : x)),
});

/** Add a shape; returns the draft and its index. */
export function addShape(draft: FenceDraft, shape: FenceShape): { draft: FenceDraft; index: number } {
  return { draft: { ...draft, shapes: [...draft.shapes, shape] }, index: draft.shapes.length };
}

export function removeShape(draft: FenceDraft, s: number): FenceDraft {
  assertShape(draft, s);
  return { ...draft, shapes: draft.shapes.filter((_, i) => i !== s) };
}

export function setInclusion(draft: FenceDraft, s: number, inclusion: boolean): FenceDraft {
  const shape = assertShape(draft, s);
  return withShape(draft, s, { ...shape, inclusion });
}

export function moveVertex(draft: FenceDraft, s: number, v: number, at: LatLon): FenceDraft {
  const shape = assertShape(draft, s, 'polygon') as Extract<FenceShape, { kind: 'polygon' }>;
  if (!shape.vertices[v]) throw new RangeError(`Vertex ${v} doesn't exist`);
  return withShape(draft, s, { ...shape, vertices: shape.vertices.map((x, i) => (i === v ? at : x)) });
}

/** Insert a vertex after vertex `after` (on the edge from it to the next). Returns the new vertex's index. */
export function insertVertex(draft: FenceDraft, s: number, after: number, at: LatLon): { draft: FenceDraft; index: number } {
  const shape = assertShape(draft, s, 'polygon') as Extract<FenceShape, { kind: 'polygon' }>;
  if (!shape.vertices[after]) throw new RangeError(`Vertex ${after} doesn't exist`);
  const vertices = [...shape.vertices];
  vertices.splice(after + 1, 0, at);
  return { draft: withShape(draft, s, { ...shape, vertices }), index: after + 1 };
}

/** Delete a vertex. A polygon keeps at least 3: deleting below that is refused (delete the shape instead). */
export function removeVertex(draft: FenceDraft, s: number, v: number): FenceDraft {
  const shape = assertShape(draft, s, 'polygon') as Extract<FenceShape, { kind: 'polygon' }>;
  if (!shape.vertices[v]) throw new RangeError(`Vertex ${v} doesn't exist`);
  if (shape.vertices.length <= 3) throw new RangeError('A polygon needs at least 3 vertices: delete the shape instead');
  return withShape(draft, s, { ...shape, vertices: shape.vertices.filter((_, i) => i !== v) });
}

/** Move a whole shape so its centre handle lands on `to` (a polygon keeps its shape; a circle moves its centre). */
export function moveShape(draft: FenceDraft, s: number, to: LatLon): FenceDraft {
  const shape = assertShape(draft, s);
  if (shape.kind === 'circle') return withShape(draft, s, { ...shape, center: to });
  const c = polygonCenter(shape.vertices);
  // Each vertex keeps its offset from the centre in metres, not degrees, so the polygon keeps its shape and size
  // wherever it goes (a degree of longitude shrinks with latitude).
  const vertices = shape.vertices.map((v) => {
    const north = (v.lat - c.lat) * M_PER_DEG_LAT;
    const east = (v.lon - c.lon) * mPerDegLon(c.lat);
    const lat = to.lat + north / M_PER_DEG_LAT;
    return { lat, lon: to.lon + east / mPerDegLon(lat) };
  });
  return withShape(draft, s, { ...shape, vertices });
}

export function setRadius(draft: FenceDraft, s: number, radius: number): FenceDraft {
  const shape = assertShape(draft, s, 'circle') as Extract<FenceShape, { kind: 'circle' }>;
  return withShape(draft, s, { ...shape, radius });
}

export function setReturnPoint(draft: FenceDraft, at: LatLon | null): FenceDraft {
  return { ...draft, returnPoint: at };
}

/** A square polygon of side `sizeM` centred on `at`: a starting shape to drag into place. */
export function squareAt(at: LatLon, sizeM: number, inclusion: boolean): FenceShape {
  const h = sizeM / 2;
  return {
    kind: 'polygon',
    inclusion,
    vertices: [offsetPoint(offsetPoint(at, h, 0), h, 270), offsetPoint(offsetPoint(at, h, 0), h, 90), offsetPoint(offsetPoint(at, h, 180), h, 90), offsetPoint(offsetPoint(at, h, 180), h, 270)],
  };
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------

export interface FenceIssue {
  /** Shape index, -1 for the fence as a whole, -2 for the return point. */
  index: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface FenceCheckContext {
  /** The vehicle's FENCE_ENABLE, when known. */
  fenceEnable?: number;
  /** The vehicle's FENCE_TYPE, when known: bit 2 (value 4) enforces polygons and circles. */
  fenceType?: number;
  /** FENCE_OPTIONS bit 1: inclusion zones are a union rather than an intersection. */
  inclusionUnion?: boolean;
}

const validPos = (p: LatLon) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat !== 0 || p.lon !== 0);

/** Problems to fix (errors: the vehicle would reject the fence or misjudge it) or check (warnings). */
export function validateFenceDraft(draft: FenceDraft, ctx: FenceCheckContext = {}): FenceIssue[] {
  const issues: FenceIssue[] = [];
  const err = (index: number, message: string) => issues.push({ index, severity: 'error', message });
  const warn = (index: number, message: string) => issues.push({ index, severity: 'warning', message });

  if (draft.shapes.length === 0 && !draft.returnPoint) warn(-1, 'No fence: uploading clears the fence on the vehicle.');

  draft.shapes.forEach((s, i) => {
    if (s.kind === 'polygon') {
      if (s.vertices.length < 3) err(i, `A polygon needs at least 3 vertices (has ${s.vertices.length}).`);
      if (!s.vertices.every(validPos)) err(i, 'A vertex has no valid position.');
      else if (selfIntersects(s.vertices)) err(i, 'The polygon crosses itself: the vehicle would misjudge inside and outside.');
      if (s.vertices.length > 255) err(i, 'A polygon can have at most 255 vertices.');
    } else {
      if (!validPos(s.center)) err(i, 'The circle has no valid centre.');
      if (!(Number.isFinite(s.radius) && s.radius > 0)) err(i, 'The circle needs a positive radius.');
    }
  });

  if (draft.returnPoint) {
    if (!validPos(draft.returnPoint)) err(-2, 'The return point has no valid position.');
    else if (draft.shapes.length > 0 && fenceBreached(draft, draft.returnPoint, ctx)) {
      warn(-2, 'The return point is outside the fence: a breach would send the vehicle outside it.');
    }
  }

  if (draft.shapes.length > 0) {
    if (ctx.fenceType !== undefined && (ctx.fenceType & 4) === 0) {
      warn(-1, 'FENCE_TYPE does not include polygons and circles (bit 2): this fence is stored but not enforced.');
    }
    if (ctx.fenceEnable === 0) warn(-1, 'Fencing is off (FENCE_ENABLE = 0): this fence is stored but not enforced until enabled.');
  }
  return issues;
}

// ------------------------------------------------------------------------------------------------
// Comparison and read-back
// ------------------------------------------------------------------------------------------------

const samePos = (a: LatLon, b: LatLon) => Math.abs(a.lat - b.lat) <= 1.5e-7 && Math.abs(a.lon - b.lon) <= 1.5e-7;

/** How fence `b` differs from `a`, shape by shape in order. Positions to 1e-7°, radii to 1 cm. */
export function compareFenceDrafts(a: FenceDraft, b: FenceDraft): string[] {
  const out: string[] = [];
  if (a.shapes.length !== b.shapes.length) out.push(`${a.shapes.length} shapes vs ${b.shapes.length}`);
  const n = Math.min(a.shapes.length, b.shapes.length);
  for (let i = 0; i < n; i++) {
    const p = a.shapes[i];
    const q = b.shapes[i];
    const name = `shape ${i + 1}`;
    if (p.kind !== q.kind || p.inclusion !== q.inclusion) {
      out.push(`${name}: ${p.inclusion ? 'inclusion' : 'exclusion'} ${p.kind} vs ${q.inclusion ? 'inclusion' : 'exclusion'} ${q.kind}`);
      continue;
    }
    if (p.kind === 'polygon' && q.kind === 'polygon') {
      if (p.vertices.length !== q.vertices.length) out.push(`${name}: ${p.vertices.length} vertices vs ${q.vertices.length}`);
      else if (!p.vertices.every((v, k) => samePos(v, q.vertices[k]))) out.push(`${name}: a vertex differs`);
    } else if (p.kind === 'circle' && q.kind === 'circle') {
      if (!samePos(p.center, q.center)) out.push(`${name}: centre differs`);
      if (Math.abs(p.radius - q.radius) > 0.01) out.push(`${name}: radius ${p.radius} vs ${q.radius}`);
    }
  }
  if (!!a.returnPoint !== !!b.returnPoint) out.push(a.returnPoint ? 'return point missing' : 'unexpected return point');
  else if (a.returnPoint && b.returnPoint && !samePos(a.returnPoint, b.returnPoint)) out.push('return point differs');
  return out;
}

export function fenceDraftsEqual(a: FenceDraft, b: FenceDraft): boolean {
  return compareFenceDrafts(a, b).length === 0;
}

export interface FenceReadBackCheck {
  status: 'verified' | 'mismatch' | 'unreadable';
  vehicle: FenceDraft;
  differences: string[];
}

/** Judge a fence upload by what the vehicle sent back (an empty fence is a valid answer only when nothing was sent). */
export function checkFenceReadBack(uploaded: FenceDraft, readBack: FencePoint[], readOk = true): FenceReadBackCheck {
  const vehicle = fenceDraftFromPoints(readBack);
  const differences = compareFenceDrafts(uploaded, vehicle);
  const sentSomething = uploaded.shapes.length > 0 || !!uploaded.returnPoint;
  const status = !readOk || (readBack.length === 0 && sentSomething) ? 'unreadable' : differences.length > 0 ? 'mismatch' : 'verified';
  return { status, vehicle, differences };
}
