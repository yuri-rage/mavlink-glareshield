// Does the mission's route stay inside the fence? Warnings while planning (not errors: a fence can be off, or the
// route deliberately cross it), one per leg at the leg's end item:
// - polygons and circles (FENCE_TYPE bit 2, value 4): each leg flown (jump returns and RTL's included) sampled
//   every few metres along the route as drawn;
//   each shape it goes outside (inclusion) or inside (exclusion) is named once (as fenceBreachReasons);
// - the circle around home (FENCE_TYPE bit 1, value 2): farther than FENCE_RADIUS;
// - the maximum altitude (FENCE_TYPE bit 0, value 1): an item above FENCE_ALT_MAX (above home, the default
//   FENCE_ALT_MAX_TP), for items given relative to home.
// With FENCE_TYPE unknown, the drawn fence shapes are still checked (they're what the user is looking at).

import { fenceBreachReasons, type FenceDraft } from './fenceDraft';
import type { DraftIssue } from './missionDraft';

/** A leg to check: item indices of its ends (0 is home), the item a warning goes on, and the route drawn. */
export interface FenceLeg {
  from: number;
  to: number;
  /** The item the warning goes on (the leg's end, or the RTL that flies it); `to` when absent. */
  at?: number;
  latLngs: [number, number][];
}

const FENCE_TYPE_ALT_MAX = 1;
const FENCE_TYPE_CIRCLE = 2;
const FENCE_TYPE_POLYGON = 4;
/** Spacing of the samples along a leg, m; at most MAX_SAMPLES per leg. */
const SAMPLE_M = 5;
const MAX_SAMPLES = 2000;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = 6;

export interface RouteFenceContext {
  /** Home, when known: only the circle around home needs it. */
  home?: { lat: number; lon: number };
  /** FENCE_TYPE, when known. */
  types?: number;
  /** FENCE_OPTIONS bit 1: inclusion zones are a union. */
  inclusionUnion?: boolean;
  altMax?: number;
  circleRadius?: number;
  /** Fencing on (true), off (false), unknown (undefined): an off fence is said so in the messages. */
  enabled?: boolean;
  fmtLen?: (m: number) => string;
}

const M_PER_DEG = 111320;
function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dx = (b.lon - a.lon) * M_PER_DEG * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/**
 * Points along a polyline, evenly about every `step` metres (coarser for a long one: at most MAX_SAMPLES over the
 * whole of it, never cut short), its vertices included.
 */
function samples(pts: [number, number][], step: number): { lat: number; lon: number }[] {
  let total = 0;
  for (let i = 1; i < pts.length; i++)
    total += distanceM({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
  const spacing = Math.max(step, total / MAX_SAMPLES);
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = { lat: pts[i][0], lon: pts[i][1] };
    out.push(a);
    if (i === pts.length - 1) break;
    const b = { lat: pts[i + 1][0], lon: pts[i + 1][1] };
    const n = Math.floor(distanceM(a, b) / spacing);
    for (let k = 1; k < n; k++)
      out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n });
  }
  return out;
}

export function routeFenceIssues(
  legs: FenceLeg[],
  items: { command: number; frame: number; z: number }[],
  fence: FenceDraft,
  ctx: RouteFenceContext
): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const fmt = ctx.fmtLen ?? ((m: number) => `${Math.round(m)} m`);
  const off = ctx.enabled === false ? ' (fencing is off)' : '';
  const known = ctx.types !== undefined;
  const polygons = fence.shapes.length > 0 && (!known || (ctx.types! & FENCE_TYPE_POLYGON) !== 0);
  const circle =
    known &&
    ctx.home !== undefined &&
    (ctx.types! & FENCE_TYPE_CIRCLE) !== 0 &&
    ctx.circleRadius !== undefined &&
    ctx.circleRadius > 0;
  const altMax = known && (ctx.types! & FENCE_TYPE_ALT_MAX) !== 0 && ctx.altMax !== undefined && ctx.altMax > 0;
  const name = (i: number) => (i === 0 ? 'home' : `#${i}`);

  for (const leg of legs) {
    if (!polygons && !circle) break;
    // Every different way the leg breaches, in the order met along it.
    const reasons: string[] = [];
    for (const p of samples(leg.latLngs, SAMPLE_M)) {
      const here = polygons ? fenceBreachReasons(fence, p, { inclusionUnion: ctx.inclusionUnion }) : [];
      if (circle && distanceM(ctx.home!, p) > ctx.circleRadius!)
        here.push(`beyond the ${fmt(ctx.circleRadius!)} circle around home`);
      for (const r of here) if (!reasons.includes(r)) reasons.push(r);
    }
    if (reasons.length > 0) {
      issues.push({
        index: leg.at ?? leg.to,
        severity: 'warning',
        message: `The leg from ${name(leg.from)} to ${name(leg.to)} goes ${reasons.join(', and ')}${off}.`,
      });
    }
  }
  if (altMax) {
    items.forEach((it, i) => {
      if (i === 0) return;
      const relative = it.frame === MAV_FRAME_GLOBAL_RELATIVE_ALT || it.frame === MAV_FRAME_GLOBAL_RELATIVE_ALT_INT;
      if (relative && it.z > ctx.altMax!)
        issues.push({
          index: i,
          severity: 'warning',
          message: `#${i} is above the fence's maximum altitude (${fmt(ctx.altMax!)})${off}.`,
        });
    });
  }
  return issues;
}
