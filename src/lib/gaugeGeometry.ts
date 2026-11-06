// Pure geometry for dials and axes: value-to-angle mapping, "nice" tick values, arc paths and threshold zones.
// Angles are degrees clockwise from 12 o'clock; a sweep is centred on 12 o'clock.

import type { WidgetDataBinding } from '../types/widget';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Map a value onto the dial: min sits at -sweep/2, max at +sweep/2. Out-of-range values pin to the ends. */
export function valueToAngle(value: number, min: number, max: number, sweep: number): number {
  const half = sweep / 2;
  if (!(max > min) || !Number.isFinite(value)) return -half;
  return -half + clamp((value - min) / (max - min), 0, 1) * sweep;
}

export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
}

/** SVG path for an arc from angle a0 to a1 (clockwise). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  if (a1 < a0) [a0, a1] = [a1, a0];
  const span = a1 - a0;
  if (span <= 0.001) {
    const p = polar(cx, cy, r, a0);
    return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  }
  const start = polar(cx, cy, r, a0);
  const end = polar(cx, cy, r, a1);
  const large = span > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/** A tick step of 1, 2, 2.5 or 5 × 10^n giving roughly `count` intervals over [min, max]. */
export function niceStep(min: number, max: number, count: number): number {
  const span = Math.abs(max - min);
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

/** Tick values that are multiples of a nice step, inside [min, max] (both ends included when they land on it). */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const step = niceStep(min, max, count);
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = first; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (ticks.length > 200) break;
  }
  return ticks;
}

/** Decimal places needed to print a tick step without noise (0.25 → 2, 5 → 0). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let d = 0; d <= 6; d++) {
    if (Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) < 1e-6) return d;
  }
  return 6;
}

export interface Zone {
  from: number;
  to: number;
  level: 'normal' | 'warn' | 'crit';
}

/**
 * Bands from a binding's thresholds. Normal → warn → crit going up (or down, when thresholdInvert is set).
 * Returns no zones when no threshold is configured.
 */
export function thresholdZones(binding: WidgetDataBinding | undefined, min: number, max: number): Zone[] {
  if (!binding || !(max > min)) return [];
  const { warnThreshold: w, critThreshold: c, thresholdInvert } = binding;
  if (w === undefined && c === undefined) return [];
  const zones: Zone[] = [];
  const add = (from: number, to: number, level: Zone['level']) => {
    const a = clamp(from, min, max);
    const b = clamp(to, min, max);
    if (b > a) zones.push({ from: a, to: b, level });
  };
  if (!thresholdInvert) {
    const warnAt = w ?? c!;
    const critAt = c ?? Infinity;
    add(min, warnAt, 'normal');
    if (w !== undefined) add(w, Math.min(critAt, max), 'warn');
    if (c !== undefined) add(c, max, 'crit');
  } else {
    const warnAt = w ?? c!;
    const critAt = c ?? -Infinity;
    if (c !== undefined) add(min, c, 'crit');
    if (w !== undefined) add(Math.max(critAt, min), w, 'warn');
    add(warnAt, max, 'normal');
  }
  return zones;
}
