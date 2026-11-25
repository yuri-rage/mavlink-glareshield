// Rally points being edited on the map, kept apart from the vehicle's until uploaded. Plain data and pure functions
// (no store, no connection, no React), like missionDraft.ts.
//
// Unlike a mission there is no home item and nothing to keep consistent between items: each point is a position,
// an altitude and its frame. ArduPilot returns to the nearest rally point (or home, with RALLY_INCL_HOME) on RTL,
// and ignores any rally point farther than RALLY_LIMIT_KM from home.

import type { MissionItemIntData } from './encoder';
import type { RallyPoint } from '../store/telemetryStore';
import { MAV_FRAME, normalFrame } from './missionDraft';

export const CMD_NAV_RALLY_POINT = 5100;

/** Altitude for a new rally point when there is none to copy (m, relative to home). */
export const DEFAULT_RALLY_ALT = 30;

/**
 * ArduPilot stores a rally point's altitude as a whole number of metres (AP_Rally's RallyLocation.alt is an int16),
 * so the draft keeps whole metres too: otherwise 100 ft (30.48 m) would read back as 30 m and never verify.
 */
export function rallyAlt(m: number): number {
  return Number.isFinite(m) ? Math.round(m) : m;
}

export interface RallyItem {
  lat: number;
  lon: number;
  /** Altitude in m, in `frame`. */
  alt: number;
  frame: number;
}

export interface RallyDraft {
  points: RallyItem[];
}


const finiteOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ------------------------------------------------------------------------------------------------
// Conversions
// ------------------------------------------------------------------------------------------------

/** A draft from the rally points the vehicle reported (the telemetry store's), in seq order. */
export function rallyDraftFromPoints(points: RallyPoint[]): RallyDraft {
  return {
    points: [...points]
      .sort((a, b) => a.seq - b.seq)
      .map((p) => ({ lat: p.lat, lon: p.lon, alt: rallyAlt(p.alt), frame: finiteOr(p.frame, MAV_FRAME.GLOBAL_RELATIVE_ALT) })),
  };
}

/** A draft from file items: rally point commands only, in seq order. */
export function rallyDraftFromItems(items: MissionItemIntData[]): RallyDraft {
  return {
    points: [...items]
      .filter((it) => it.command === CMD_NAV_RALLY_POINT)
      .sort((a, b) => a.seq - b.seq)
      .map((it) => ({
        lat: finiteOr(it.x, 0),
        lon: finiteOr(it.y, 0),
        alt: rallyAlt(finiteOr(it.z, 0)),
        frame: finiteOr(it.frame, MAV_FRAME.GLOBAL_RELATIVE_ALT),
      })),
  };
}

/** Items ready to upload or save (mission_type 2), numbered from 0. */
export function rallyDraftToItems(draft: RallyDraft): MissionItemIntData[] {
  return draft.points.map((p, seq) => ({
    seq,
    command: CMD_NAV_RALLY_POINT,
    frame: p.frame,
    current: 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: p.lat,
    y: p.lon,
    z: p.alt,
    mission_type: 2,
  }));
}

/** The draft as the telemetry store's rally points (for the file writers). */
export function rallyDraftToPoints(draft: RallyDraft): RallyPoint[] {
  return draft.points.map((p, seq) => ({ seq, lat: p.lat, lon: p.lon, alt: p.alt, frame: p.frame }));
}

// ------------------------------------------------------------------------------------------------
// Edits
// ------------------------------------------------------------------------------------------------

function assertIndex(draft: RallyDraft, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= draft.points.length) {
    throw new RangeError(`Rally point ${index} doesn't exist (there are ${draft.points.length})`);
  }
}

/**
 * Add a rally point after `after` (the selection), or at the end. It takes the altitude and frame of the point
 * before it, else the default. Order doesn't change where the vehicle goes (it picks the nearest), only numbering.
 */
export function addRallyPoint(
  draft: RallyDraft,
  after: number | null,
  lat: number,
  lon: number,
  fallbackAlt = DEFAULT_RALLY_ALT
): { draft: RallyDraft; index: number } {
  const at = after !== null && after >= 0 && after < draft.points.length ? after + 1 : draft.points.length;
  const ref = draft.points[at - 1];
  const point: RallyItem = {
    lat,
    lon,
    alt: rallyAlt(ref ? ref.alt : fallbackAlt),
    frame: ref ? ref.frame : MAV_FRAME.GLOBAL_RELATIVE_ALT,
  };
  const points = [...draft.points];
  points.splice(at, 0, point);
  return { draft: { points }, index: at };
}

/** Change a point's fields. Altitude is kept to whole metres (see rallyAlt). */
export function updateRallyPoint(draft: RallyDraft, index: number, patch: Partial<RallyItem>): RallyDraft {
  assertIndex(draft, index);
  const points = [...draft.points];
  points[index] = { ...points[index], ...patch, ...(patch.alt !== undefined ? { alt: rallyAlt(patch.alt) } : {}) };
  return { points };
}

export function moveRallyPoint(draft: RallyDraft, index: number, lat: number, lon: number): RallyDraft {
  return updateRallyPoint(draft, index, { lat, lon });
}

export function removeRallyPoint(draft: RallyDraft, index: number): RallyDraft {
  assertIndex(draft, index);
  return { points: draft.points.filter((_, i) => i !== index) };
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------

export interface RallyIssue {
  /** Point index, or -1 for the rally points as a whole. */
  index: number;
  severity: 'error' | 'warning';
  message: string;
}

/** Great-circle distance in m. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface RallyCheckContext {
  /** Home, to check RALLY_LIMIT_KM against. */
  home?: { lat: number; lon: number } | null;
  /** The vehicle's RALLY_LIMIT_KM, when its parameters are known. 0 disables the limit. */
  limitKm?: number;
}

/** Problems to fix (errors block the upload) or check (warnings). */
export function validateRallyDraft(draft: RallyDraft, ctx: RallyCheckContext = {}): RallyIssue[] {
  const issues: RallyIssue[] = [];
  const err = (index: number, message: string) => issues.push({ index, severity: 'error', message });
  const warn = (index: number, message: string) => issues.push({ index, severity: 'warning', message });

  if (draft.points.length === 0) warn(-1, 'No rally points: uploading clears the rally points on the vehicle.');

  const home = ctx.home && (ctx.home.lat !== 0 || ctx.home.lon !== 0) ? ctx.home : null;
  const limitM = ctx.limitKm !== undefined && ctx.limitKm > 0 ? ctx.limitKm * 1000 : null;

  draft.points.forEach((p, i) => {
    if (![p.lat, p.lon, p.alt, p.frame].every(Number.isFinite)) {
      err(i, 'A value is not a number.');
      return;
    }
    if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) err(i, 'Position is outside valid latitude/longitude.');
    else if (p.lat === 0 && p.lon === 0) err(i, 'Rally point has no position.');
    const f = normalFrame(p.frame);
    if (f !== MAV_FRAME.GLOBAL && f !== MAV_FRAME.GLOBAL_RELATIVE_ALT && f !== MAV_FRAME.GLOBAL_TERRAIN_ALT) {
      warn(i, `Unusual altitude frame ${p.frame}.`);
    }
    if (f === MAV_FRAME.GLOBAL_TERRAIN_ALT) warn(i, 'Altitude is above terrain: the vehicle needs terrain data for this point.');
    if (f === MAV_FRAME.GLOBAL_RELATIVE_ALT && p.alt < 0) warn(i, 'Altitude is below home.');
    if (home && limitM !== null && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
      const d = distanceM(home.lat, home.lon, p.lat, p.lon);
      if (d > limitM) {
        warn(
          i,
          `${(d / 1000).toFixed(1)} km from home, beyond RALLY_LIMIT_KM (${ctx.limitKm} km): the vehicle ignores it and returns home instead.`
        );
      }
    }
  });
  return issues;
}

// ------------------------------------------------------------------------------------------------
// Comparison and read-back
// ------------------------------------------------------------------------------------------------

/**
 * How rally points `b` differ from `a`, point by point in order. Positions match to MISSION_ITEM_INT's 1e-7°,
 * altitudes to 1 cm, frames with _INT variants counted as their plain equivalents.
 */
export function compareRallyDrafts(a: RallyDraft, b: RallyDraft): string[] {
  const out: string[] = [];
  if (a.points.length !== b.points.length) out.push(`${a.points.length} points vs ${b.points.length}`);
  const n = Math.min(a.points.length, b.points.length);
  for (let i = 0; i < n; i++) {
    const p = a.points[i];
    const q = b.points[i];
    if (Math.abs(p.lat - q.lat) > 1.5e-7 || Math.abs(p.lon - q.lon) > 1.5e-7) out.push(`R${i + 1}: position differs`);
    if (Math.abs(p.alt - q.alt) > 0.01 + 1e-9) out.push(`R${i + 1}: altitude ${p.alt} vs ${q.alt}`);
    if (normalFrame(p.frame) !== normalFrame(q.frame)) out.push(`R${i + 1}: frame ${p.frame} vs ${q.frame}`);
  }
  return out;
}

export function rallyDraftsEqual(a: RallyDraft, b: RallyDraft): boolean {
  return compareRallyDrafts(a, b).length === 0;
}

export interface RallyReadBackCheck {
  /** verified: matches. mismatch: differs. unreadable: nothing came back although points were uploaded. */
  status: 'verified' | 'mismatch' | 'unreadable';
  vehicle: RallyDraft;
  differences: string[];
}

/**
 * Judge a rally upload by what the vehicle sent back. Unlike a mission (which always reads back home), no rally
 * points is a valid answer, but only when none were uploaded and the read completed (`readOk`).
 */
export function checkRallyReadBack(uploaded: RallyDraft, readBack: RallyPoint[], readOk = true): RallyReadBackCheck {
  const vehicle = rallyDraftFromPoints(readBack);
  const differences = compareRallyDrafts(uploaded, vehicle);
  // A failed read can't verify anything, even an upload of no points (its empty result proves nothing).
  const status =
    !readOk || (readBack.length === 0 && uploaded.points.length > 0)
      ? 'unreadable'
      : differences.length > 0
        ? 'mismatch'
        : 'verified';
  return { status, vehicle, differences };
}
