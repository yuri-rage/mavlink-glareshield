// Fixed-rate history of bound widget values, for time-series charts.
//
// Every registered binding is sampled on one clock (10 Hz) into a ring buffer holding the last ten minutes, so a
// chart has a real time axis, a steady value still draws a line, history survives a widget remounting (switching
// dashboard tabs), and widgets bound to the same field share one buffer. Values are stored in the binding's base
// units; charts convert to display units when drawing, so changing unit system rescales the whole history.

import type { WidgetDataBinding } from '../types/widget';
import { applyBindingTransform, bindingKey, isStale, resolveRawValue } from './widgetValues';

export const SAMPLE_INTERVAL_MS = 100;
export const RETENTION_MS = 10 * 60 * 1000;
const CAPACITY = Math.ceil(RETENTION_MS / SAMPLE_INTERVAL_MS) + 1;

/** Gaps (no value, unused input, stale message) are stored as NaN so the chart breaks the line there. */
export class SampleRing {
  readonly times: Float64Array;
  readonly values: Float64Array;
  private head = 0; // next write index
  private count = 0;

  constructor(readonly capacity = CAPACITY) {
    this.times = new Float64Array(capacity);
    this.values = new Float64Array(capacity);
  }

  push(time: number, value: number) {
    this.times[this.head] = time;
    this.values[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  get length() {
    return this.count;
  }

  /** Storage index of logical sample i (i = 0 is the oldest retained sample); read times[]/values[] with it. */
  index(i: number): number {
    return (this.head - this.count + i + this.capacity) % this.capacity;
  }

  at(i: number): { t: number; v: number } {
    const idx = this.index(i);
    return { t: this.times[idx], v: this.values[idx] };
  }

  /** Index of the first sample with time >= t (binary search over the time-ordered ring). */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.index(mid)] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }
}

interface SeriesEntry {
  binding: WidgetDataBinding;
  ring: SampleRing;
  refs: number;
  staleAfterSec?: number;
}

type StateGetter = () => any;

class ValueSampler {
  private series = new Map<string, SeriesEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private getState: StateGetter = () => ({});

  /** Where values are read from (the telemetry store); set once by the app, or by tests. */
  setStateGetter(getter: StateGetter) {
    this.getState = getter;
  }

  /** The ring for a binding, created if needed. Does not start sampling; see acquire(). */
  seriesFor(binding: WidgetDataBinding, staleAfterSec?: number): { key: string; ring: SampleRing } {
    const key = bindingKey(binding);
    let entry = this.series.get(key);
    if (!entry) {
      entry = { binding: { ...binding }, ring: new SampleRing(), refs: 0, staleAfterSec };
      this.series.set(key, entry);
    }
    if (staleAfterSec !== undefined) entry.staleAfterSec = staleAfterSec;
    return { key, ring: entry.ring };
  }

  /** Start recording a binding. Returns its ring and a release function; history is kept after release. */
  acquire(binding: WidgetDataBinding, staleAfterSec?: number): { key: string; ring: SampleRing; release: () => void } {
    const { key, ring } = this.seriesFor(binding, staleAfterSec);
    const entry = this.series.get(key)!;
    entry.refs++;
    this.ensureTimer();
    let released = false;
    return {
      key,
      ring,
      release: () => {
        if (released) return;
        released = true;
        entry.refs = Math.max(0, entry.refs - 1);
        if (![...this.series.values()].some((e) => e.refs > 0)) this.stopTimer();
      },
    };
  }

  /** Subscribers per series (tests). */
  refCount(key: string): number {
    return this.series.get(key)?.refs ?? 0;
  }

  getRing(key: string): SampleRing | undefined {
    return this.series.get(key)?.ring;
  }

  /** Take one sample of every binding that has a subscriber (exposed for tests). */
  sampleNow(now = Date.now()) {
    const state = this.getState();
    for (const entry of this.series.values()) {
      if (entry.refs === 0) continue;
      const raw = resolveRawValue(entry.binding, state);
      let value = NaN;
      if (typeof raw === 'number' && Number.isFinite(raw)) value = applyBindingTransform(raw, entry.binding);
      else if (typeof raw === 'string' && Number.isFinite(parseFloat(raw))) {
        value = applyBindingTransform(parseFloat(raw), entry.binding);
      }
      if (isStale(entry.binding, entry.staleAfterSec, now).stale) value = NaN;
      entry.ring.push(now, value);
    }
  }

  reset() {
    this.stopTimer();
    this.series.clear();
  }

  private ensureTimer() {
    if (this.timer || typeof setInterval === 'undefined') return;
    this.timer = setInterval(() => this.sampleNow(), SAMPLE_INTERVAL_MS);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const valueSampler = new ValueSampler();
