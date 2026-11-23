// A mission being edited on the map, kept apart from the mission the vehicle holds until it is uploaded.
// Plain data and pure functions only (no store, no connection, no React) so every edit can be tested on its own.
//
// Rules every edit keeps:
// - Item 0 is home. The vehicle owns it, so edits never insert, delete, move or change it.
// - An item's sequence number is its index. Edits renumber the mission, and DO_JUMP targets follow the item they
//   pointed at. A jump whose target is deleted moves to the item that took its place.
// - Commands the editor doesn't know are carried unchanged, so a draft round-trips any mission.

import type { MissionItemIntData } from './encoder';
import { cmdHasLocation, type VehicleCategory } from './messages';
import type { MissionWaypoint } from '../store/telemetryStore';

export const MAV_FRAME = {
  GLOBAL: 0,
  MISSION: 2,
  GLOBAL_RELATIVE_ALT: 3,
  GLOBAL_INT: 5,
  GLOBAL_RELATIVE_ALT_INT: 6,
  GLOBAL_TERRAIN_ALT: 10,
  GLOBAL_TERRAIN_ALT_INT: 11,
} as const;

const CMD_NAV_WAYPOINT = 16;
const CMD_NAV_LAND = 21;
const CMD_NAV_TAKEOFF = 22;
const CMD_NAV_VTOL_TAKEOFF = 84;
const CMD_NAV_VTOL_LAND = 85;
export const CMD_DO_JUMP = 177;
/** MAV_CMD values below this are navigation commands (MAV_CMD_NAV_LAST). */
const NAV_LAST = 95;

/** Altitude for a new waypoint when nothing earlier in the mission has one (m, relative to home). */
export const DEFAULT_WAYPOINT_ALT = 30;

const LOCATION_FRAMES = new Set<number>([
  MAV_FRAME.GLOBAL,
  MAV_FRAME.GLOBAL_RELATIVE_ALT,
  MAV_FRAME.GLOBAL_INT,
  MAV_FRAME.GLOBAL_RELATIVE_ALT_INT,
  MAV_FRAME.GLOBAL_TERRAIN_ALT,
  MAV_FRAME.GLOBAL_TERRAIN_ALT_INT,
]);

/** One mission item. For location commands x/y are latitude/longitude in degrees and z the altitude in m;
 *  for other commands x, y and z are param5, param6 and param7 as sent. */
export interface DraftItem {
  command: number;
  frame: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  x: number;
  y: number;
  z: number;
  autocontinue: number;
}

/** A mission draft. items[0] is home. */
export interface MissionDraft {
  items: DraftItem[];
}

// ------------------------------------------------------------------------------------------------
// Conversions
// ------------------------------------------------------------------------------------------------

const finiteOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function homeItem(home?: { lat: number; lon: number; alt: number }): DraftItem {
  return {
    command: CMD_NAV_WAYPOINT,
    frame: MAV_FRAME.GLOBAL,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: home?.lat ?? 0,
    y: home?.lon ?? 0,
    z: home?.alt ?? 0,
    autocontinue: 1,
  };
}

/**
 * A draft from mission items in any order (a file, or what the vehicle sent). Without items the draft is home
 * alone, at `home` when given.
 */
export function draftFromItems(items: MissionItemIntData[], home?: { lat: number; lon: number; alt: number }): MissionDraft {
  if (items.length === 0) return { items: [homeItem(home)] };
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  return {
    items: sorted.map((it) => ({
      command: it.command,
      frame: finiteOr(it.frame, cmdHasLocation(it.command) ? MAV_FRAME.GLOBAL_RELATIVE_ALT : MAV_FRAME.MISSION),
      param1: finiteOr(it.param1, 0),
      param2: finiteOr(it.param2, 0),
      param3: finiteOr(it.param3, 0),
      param4: finiteOr(it.param4, 0),
      x: finiteOr(it.x, 0),
      y: finiteOr(it.y, 0),
      z: finiteOr(it.z, 0),
      autocontinue: typeof it.autocontinue === 'boolean' ? (it.autocontinue ? 1 : 0) : finiteOr(it.autocontinue, 1),
    })),
  };
}

/** A draft from the mission the vehicle reported (the telemetry store's waypoints). */
export function draftFromWaypoints(waypoints: MissionWaypoint[], home?: { lat: number; lon: number; alt: number }): MissionDraft {
  return draftFromItems(
    waypoints.map((w) => ({
      seq: w.seq,
      command: w.command,
      frame: w.frame,
      param1: w.param1,
      param2: w.param2,
      param3: w.param3,
      param4: w.param4,
      x: w.lat,
      y: w.lon,
      z: w.alt,
      autocontinue: w.autocontinue,
    })),
    home
  );
}

/** Items ready to upload or save: numbered from 0, home marked current. */
export function draftToItems(draft: MissionDraft): MissionItemIntData[] {
  return draft.items.map((it, seq) => ({
    seq,
    command: it.command,
    frame: it.frame,
    current: seq === 0 ? 1 : 0,
    autocontinue: it.autocontinue,
    param1: it.param1,
    param2: it.param2,
    param3: it.param3,
    param4: it.param4,
    x: it.x,
    y: it.y,
    z: it.z,
    mission_type: 0,
  }));
}

// ------------------------------------------------------------------------------------------------
// Edits
// ------------------------------------------------------------------------------------------------

function assertEditable(draft: MissionDraft, index: number, allowEnd = false) {
  const max = allowEnd ? draft.items.length : draft.items.length - 1;
  if (!Number.isInteger(index) || index < 1 || index > max) {
    throw new RangeError(`Mission item ${index} can't be edited (home is item 0; the mission has ${draft.items.length} items)`);
  }
}

/**
 * Rebuild the item list in a new order, keeping DO_JUMP targets on the items they pointed at.
 * `order` lists old indices in their new order (home first); an old index left out is deleted, and a jump that
 * targeted it moves to the next surviving item after it. Jump targets that were already invalid stay as written.
 */
function reorder(items: DraftItem[], order: (number | DraftItem)[]): DraftItem[] {
  const oldToNew = new Map<number, number>();
  order.forEach((o, i) => {
    if (typeof o === 'number') oldToNew.set(o, i);
  });
  const remapTarget = (t: number): number => {
    if (!Number.isInteger(t) || t < 1 || t >= items.length) return t;
    for (let old = t; old < items.length; old++) {
      const n = oldToNew.get(old);
      if (n !== undefined) return n;
    }
    // The target and everything after it were deleted: point past the end so validation reports it.
    return order.length;
  };
  return order.map((o) => {
    const it = typeof o === 'number' ? items[o] : o;
    if (it.command !== CMD_DO_JUMP || typeof o !== 'number') return it;
    return { ...it, param1: remapTarget(it.param1) };
  });
}

/** Insert items so the first lands at `at` (1 … length; length appends). */
export function insertItems(draft: MissionDraft, at: number, newItems: DraftItem[]): MissionDraft {
  assertEditable(draft, at, true);
  const order: (number | DraftItem)[] = draft.items.map((_, i) => i);
  order.splice(at, 0, ...newItems);
  return { items: reorder(draft.items, order) };
}

/** Delete items. Home (0) is never deleted. */
export function removeItems(draft: MissionDraft, indices: number[]): MissionDraft {
  indices.forEach((i) => assertEditable(draft, i));
  const drop = new Set(indices);
  const order = draft.items.map((_, i) => i).filter((i) => !drop.has(i));
  return { items: reorder(draft.items, order) };
}

/** Move one item so it ends up at index `to`. */
export function moveItem(draft: MissionDraft, from: number, to: number): MissionDraft {
  assertEditable(draft, from);
  assertEditable(draft, to);
  if (from === to) return draft;
  const order = draft.items.map((_, i) => i);
  order.splice(from, 1);
  order.splice(to, 0, from);
  return { items: reorder(draft.items, order) };
}

/** Change fields of one item. To change its command use changeCommand, which also clears stale params. */
export function updateItem(draft: MissionDraft, index: number, patch: Partial<Omit<DraftItem, 'command'>>): MissionDraft {
  assertEditable(draft, index);
  const items = [...draft.items];
  items[index] = { ...items[index], ...patch };
  return { items };
}

/** Move a location item to a new position, keeping its altitude. */
export function setItemPosition(draft: MissionDraft, index: number, lat: number, lon: number): MissionDraft {
  assertEditable(draft, index);
  if (!cmdHasLocation(draft.items[index].command)) {
    throw new RangeError(`Mission item ${index} has no position`);
  }
  return updateItem(draft, index, { x: lat, y: lon });
}

/**
 * Give an item a different command. Params 1–4 are cleared, since they mean something else for the new command.
 * A location command keeps the item's position and altitude when it had one, else takes `at` (or 0,0, which
 * validation warns about). A command without a location gets x, y and z cleared, as they become raw params.
 */
export function changeCommand(
  draft: MissionDraft,
  index: number,
  command: number,
  at?: { lat: number; lon: number }
): MissionDraft {
  assertEditable(draft, index);
  const old = draft.items[index];
  if (old.command === command) return draft;
  const hadLocation = cmdHasLocation(old.command);
  const hasLocation = cmdHasLocation(command);
  const item: DraftItem = { ...old, command, param1: 0, param2: 0, param3: 0, param4: 0 };
  if (hasLocation) {
    if (!hadLocation) {
      const ref = altitudeReference(draft, index);
      item.x = at?.lat ?? 0;
      item.y = at?.lon ?? 0;
      item.z = ref.alt;
      item.frame = ref.frame;
    }
  } else {
    item.x = 0;
    item.y = 0;
    item.z = 0;
    item.frame = MAV_FRAME.MISSION;
  }
  const items = [...draft.items];
  items[index] = item;
  return { items };
}

/** Altitude and frame for a new item at `index`: the nearest earlier location item's, skipping home. */
function altitudeReference(draft: MissionDraft, index: number, fallbackAlt = DEFAULT_WAYPOINT_ALT): { alt: number; frame: number } {
  for (let i = Math.min(index, draft.items.length) - 1; i >= 1; i--) {
    const it = draft.items[i];
    if (cmdHasLocation(it.command) && LOCATION_FRAMES.has(it.frame) && it.command !== CMD_NAV_LAND && it.command !== CMD_NAV_VTOL_LAND) {
      return { alt: it.z, frame: it.frame };
    }
  }
  return { alt: fallbackAlt, frame: MAV_FRAME.GLOBAL_RELATIVE_ALT };
}

/** A NAV_WAYPOINT for `index`, at the altitude and frame of the waypoint before it. */
export function newWaypoint(draft: MissionDraft, index: number, lat: number, lon: number, fallbackAlt = DEFAULT_WAYPOINT_ALT): DraftItem {
  const ref = altitudeReference(draft, index, fallbackAlt);
  return {
    command: CMD_NAV_WAYPOINT,
    frame: ref.frame,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: lat,
    y: lon,
    z: ref.alt,
    autocontinue: 1,
  };
}

/** Add a waypoint at the end of the mission. */
export function appendWaypoint(draft: MissionDraft, lat: number, lon: number, fallbackAlt = DEFAULT_WAYPOINT_ALT): MissionDraft {
  const at = draft.items.length;
  return insertItems(draft, at, [newWaypoint(draft, at, lat, lon, fallbackAlt)]);
}

/**
 * Add a waypoint after item `after` (the selection), or at the end when nothing editable is selected. Returns the
 * draft and the new item's index, so repeated adds chain one after another.
 */
export function insertWaypointAfter(
  draft: MissionDraft,
  after: number | null,
  lat: number,
  lon: number,
  fallbackAlt = DEFAULT_WAYPOINT_ALT
): { draft: MissionDraft; index: number } {
  const at = after !== null && after >= 1 && after < draft.items.length ? after + 1 : draft.items.length;
  return { draft: insertItems(draft, at, [newWaypoint(draft, at, lat, lon, fallbackAlt)]), index: at };
}

/**
 * Add a waypoint on the leg that ends at location item `legEnd`: it goes just before that item, after any
 * commands without a location on the way. Returns the draft and the new item's index.
 */
export function insertWaypointBefore(
  draft: MissionDraft,
  legEnd: number,
  lat: number,
  lon: number,
  fallbackAlt = DEFAULT_WAYPOINT_ALT
): { draft: MissionDraft; index: number } {
  assertEditable(draft, legEnd);
  return { draft: insertItems(draft, legEnd, [newWaypoint(draft, legEnd, lat, lon, fallbackAlt)]), index: legEnd };
}

/** Indices of the DO_JUMP items that target `index`, to warn before deleting or moving it. */
export function jumpsTargeting(draft: MissionDraft, index: number): number[] {
  const out: number[] = [];
  draft.items.forEach((it, i) => {
    if (it.command === CMD_DO_JUMP && it.param1 === index) out.push(i);
  });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------

export interface DraftIssue {
  /** Item index, or -1 for the mission as a whole. */
  index: number;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Problems to fix (errors) or check (warnings) before uploading. Errors block the upload. Home (item 0) is the
 * vehicle's and isn't checked.
 */
export function validateDraft(draft: MissionDraft, category?: VehicleCategory): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const n = draft.items.length;
  const err = (index: number, message: string) => issues.push({ index, severity: 'error', message });
  const warn = (index: number, message: string) => issues.push({ index, severity: 'warning', message });

  if (n <= 1) warn(-1, 'The mission is empty: uploading it clears the mission on the vehicle.');

  for (let i = 1; i < n; i++) {
    const it = draft.items[i];
    const fields = [it.param1, it.param2, it.param3, it.param4, it.x, it.y, it.z];
    if (!Number.isInteger(it.command) || it.command < 0 || it.command > 65535) {
      err(i, `Invalid command ${it.command}.`);
      continue;
    }
    if (fields.some((v) => !Number.isFinite(v))) {
      err(i, 'A parameter is not a number.');
      continue;
    }

    if (cmdHasLocation(it.command)) {
      if (Math.abs(it.x) > 90 || Math.abs(it.y) > 180) err(i, 'Position is outside valid latitude/longitude.');
      // ArduPilot reads 0,0 as "where the vehicle is": normal for a takeoff, likely a mistake elsewhere.
      else if (it.x === 0 && it.y === 0 && it.command !== CMD_NAV_TAKEOFF && it.command !== CMD_NAV_VTOL_TAKEOFF) {
        warn(i, 'Item has no position: the vehicle will use its current location.');
      }
      if (!LOCATION_FRAMES.has(it.frame)) warn(i, `Unusual altitude frame ${it.frame}.`);
      if (it.frame === MAV_FRAME.GLOBAL_TERRAIN_ALT || it.frame === MAV_FRAME.GLOBAL_TERRAIN_ALT_INT) {
        warn(i, 'Altitude is above terrain: the vehicle needs terrain data for this item.');
      }
      const relative = it.frame === MAV_FRAME.GLOBAL_RELATIVE_ALT || it.frame === MAV_FRAME.GLOBAL_RELATIVE_ALT_INT;
      if (relative && it.z < 0 && it.command !== CMD_NAV_LAND && it.command !== CMD_NAV_VTOL_LAND) {
        warn(i, 'Altitude is below home.');
      }
    }

    if (it.command === CMD_DO_JUMP) {
      const target = it.param1;
      if (!Number.isInteger(target) || target < 1 || target >= n) err(i, `Jump target ${target} is not an item in the mission.`);
      else if (target === i) err(i, 'Jump targets itself.');
      if (!Number.isInteger(it.param2) || it.param2 < -1) err(i, `Jump repeat count ${it.param2} is invalid (-1 repeats forever).`);
    }
  }

  if (category === 'copter' || category === 'plane') {
    const firstNav = draft.items.findIndex((it, i) => i > 0 && it.command < NAV_LAST);
    if (firstNav > 0) {
      const c = draft.items[firstNav].command;
      if (c !== CMD_NAV_TAKEOFF && c !== CMD_NAV_VTOL_TAKEOFF) {
        warn(firstNav, 'The first navigation item is not a takeoff: starting AUTO on the ground needs one.');
      }
    }
  }

  return issues;
}

// ------------------------------------------------------------------------------------------------
// Comparison (unsaved changes, and checking an upload against what the vehicle sends back)
// ------------------------------------------------------------------------------------------------

/** ArduPilot reports _INT frames as their plain equivalents, so compare those as the same. */
function normalFrame(f: number): number {
  if (f === MAV_FRAME.GLOBAL_INT) return MAV_FRAME.GLOBAL;
  if (f === MAV_FRAME.GLOBAL_RELATIVE_ALT_INT) return MAV_FRAME.GLOBAL_RELATIVE_ALT;
  if (f === MAV_FRAME.GLOBAL_TERRAIN_ALT_INT) return MAV_FRAME.GLOBAL_TERRAIN_ALT;
  return f;
}

/** Equal within float32 precision (params travel as float32). */
function sameFloat(a: number, b: number): boolean {
  return Math.fround(a) === Math.fround(b) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

export interface DraftComparison {
  /** Count, order, command, position or altitude differ: the missions would fly differently. */
  structural: string[];
  /** Params 1–4, or x/y/z of items without a location, differ. The vehicle may not store every param, so after
   *  an upload these are worth showing but are not by themselves a failed upload. */
  params: string[];
}

/**
 * How mission `b` differs from `a`, ignoring home (item 0, which the vehicle rewrites) and autocontinue (which
 * ArduPilot doesn't store). Positions match to MISSION_ITEM_INT's 1e-7°, altitudes to 1 cm (mission.dat's
 * resolution).
 */
export function compareDrafts(a: MissionDraft, b: MissionDraft): DraftComparison {
  const structural: string[] = [];
  const params: string[] = [];
  if (a.items.length !== b.items.length) {
    structural.push(`${a.items.length - 1} items vs ${b.items.length - 1}`);
  }
  const n = Math.min(a.items.length, b.items.length);
  for (let i = 1; i < n; i++) {
    const p = a.items[i];
    const q = b.items[i];
    if (p.command !== q.command) {
      structural.push(`#${i}: command ${p.command} vs ${q.command}`);
      continue;
    }
    const pn = [p.param1, p.param2, p.param3, p.param4];
    const qn = [q.param1, q.param2, q.param3, q.param4];
    if (cmdHasLocation(p.command)) {
      if (Math.abs(p.x - q.x) > 1.5e-7 || Math.abs(p.y - q.y) > 1.5e-7) structural.push(`#${i}: position differs`);
      if (Math.abs(p.z - q.z) > 0.01 + 1e-9) structural.push(`#${i}: altitude ${p.z} vs ${q.z}`);
      if (normalFrame(p.frame) !== normalFrame(q.frame)) structural.push(`#${i}: frame ${p.frame} vs ${q.frame}`);
    } else {
      pn.push(p.x, p.y, p.z);
      qn.push(q.x, q.y, q.z);
    }
    // A jump's target decides where the mission goes next.
    if (p.command === CMD_DO_JUMP && p.param1 !== q.param1) structural.push(`#${i}: jump target ${p.param1} vs ${q.param1}`);
    pn.forEach((v, k) => {
      if (!sameFloat(v, qn[k])) params.push(`#${i}: param${k + 1} ${v} vs ${qn[k]}`);
    });
  }
  return { structural, params };
}

/** True when the two drafts would upload the same mission (used for "unsaved changes"). */
export function draftsEqual(a: MissionDraft, b: MissionDraft): boolean {
  const c = compareDrafts(a, b);
  return c.structural.length === 0 && c.params.length === 0;
}

// ------------------------------------------------------------------------------------------------
// Undo / redo
// ------------------------------------------------------------------------------------------------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export function historyInit<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new state. Redo is lost; the oldest states drop off past `limit`. */
export function historyPush<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export function historyUndo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
