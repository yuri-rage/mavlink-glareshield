// History of PID_TUNING, one series per controller axis and field, recorded as each message arrives.
//
// The shared value sampler (valueSampler.ts) samples at 10 Hz, which would alias a fast step response and, since
// PID_TUNING carries one axis per message, would mix axes. Here every message is stored at its arrival time in
// its own axis's buffers, so desired and achieved from one message always share a timestamp. A pause in the
// stream (link loss, GCS_PID_MASK cleared) leaves a gap rather than a straight line across it.

import { SampleRing } from './valueSampler';
import { PID_TUNING_FIELDS, type PidTuningField } from '../mavlink/pidTuning';

/** Five minutes (the longest chart window) at up to 25 Hz per axis. */
export const PID_HISTORY_MS = 5 * 60 * 1000;
const CAPACITY = Math.ceil((PID_HISTORY_MS / 1000) * 25) + 64;
/** A longer silence than this breaks the line. */
export const PID_GAP_MS = 1000;

interface AxisHistory {
  rings: Record<PidTuningField, SampleRing>;
  lastTime: number;
  count: number;
}

type Listener = () => void;

class PidTuningRecorder {
  private axes = new Map<number, AxisHistory>();
  private listeners = new Set<Listener>();

  private history(axis: number): AxisHistory {
    let h = this.axes.get(axis);
    if (!h) {
      const rings = {} as Record<PidTuningField, SampleRing>;
      for (const f of PID_TUNING_FIELDS) rings[f] = new SampleRing(CAPACITY);
      h = { rings, lastTime: 0, count: 0 };
      this.axes.set(axis, h);
    }
    return h;
  }

  /** Store one decoded PID_TUNING message. */
  record(fields: Record<string, number>, now = Date.now()): void {
    const axis = fields.axis;
    if (!Number.isInteger(axis) || axis <= 0) return;
    const isNew = !this.axes.has(axis);
    const h = this.history(axis);
    const gap = h.lastTime > 0 && now - h.lastTime > PID_GAP_MS;
    for (const f of PID_TUNING_FIELDS) {
      if (gap) h.rings[f].push(h.lastTime + 1, NaN);
      const v = fields[f];
      h.rings[f].push(now, typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    }
    h.lastTime = now;
    h.count++;
    if (isNew) this.listeners.forEach((l) => l());
  }

  /** The buffer for one axis and field (created empty if that axis hasn't arrived yet). */
  ring(axis: number, field: PidTuningField): SampleRing {
    return this.history(axis).rings[field];
  }

  /** Axes that have arrived at least once, ascending. */
  seenAxes(): number[] {
    return [...this.axes.entries()].filter(([, h]) => h.count > 0).map(([a]) => a).sort((a, b) => a - b);
  }

  /** When this axis last arrived (ms epoch), or 0. */
  lastSeen(axis: number): number {
    return this.axes.get(axis)?.lastTime ?? 0;
  }

  /** Hear about an axis arriving for the first time (for the axis picker). Returns an unsubscribe function. */
  onNewAxis(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Forget everything (a different vehicle, or the user clearing the chart). */
  clear(): void {
    for (const h of this.axes.values()) {
      for (const f of PID_TUNING_FIELDS) h.rings[f].clear();
      h.lastTime = 0;
      h.count = 0;
    }
    this.listeners.forEach((l) => l());
  }
}

export const pidTuningRecorder = new PidTuningRecorder();
