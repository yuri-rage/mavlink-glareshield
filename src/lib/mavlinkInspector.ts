// The MAVLink Inspector's collector: every message received, per system, component and message ID, with counts,
// rates and the last payload. Runs only while an Inspector is open (start/stop are counted), and does nothing per
// packet but count and keep the payload: decoding happens when a message is looked at (dialectDecode.ts).

import type { MavlinkPacket } from '../mavlink/parser';

export interface InspectorEntry {
  key: string;
  sysId: number;
  compId: number;
  msgId: number;
  count: number;
  /** Arrival times (ms) of the most recent messages, for the rate. */
  times: number[];
  lastAt: number;
  lastPayload: Uint8Array;
  /** MAVLink version of the last frame (1 or 2). */
  version: number;
}

const RATE_WINDOW = 40;
/** Rates are over the arrivals of the last few seconds; older than this counts as stopped. */
export const RATE_SPAN_MS = 5000;

export class InspectorCollector {
  entries = new Map<string, InspectorEntry>();
  /** Paused at this time (ms), or null: rates and ages are then taken at this moment, so the snapshot stays still. */
  private pausedAt: number | null = null;
  private users = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private subscribe: (fn: (p: MavlinkPacket) => void) => () => void,
    private now: () => number = () => Date.now()
  ) {}

  /** Start collecting (an Inspector opened); returns the stop for it. */
  start(): () => void {
    if (this.users++ === 0) this.unsubscribe = this.subscribe((p) => this.add(p));
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      if (--this.users === 0) {
        this.unsubscribe?.();
        this.unsubscribe = null;
      }
    };
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  setPaused(on: boolean) {
    this.pausedAt = on ? this.now() : null;
  }

  /** The time rates and ages are measured at: now, or when paused. */
  clock(): number {
    return this.pausedAt ?? this.now();
  }

  add(p: MavlinkPacket) {
    if (this.pausedAt !== null) return;
    const key = `${p.systemId}:${p.componentId}:${p.messageId}`;
    const t = this.now();
    let e = this.entries.get(key);
    if (!e) {
      e = {
        key,
        sysId: p.systemId,
        compId: p.componentId,
        msgId: p.messageId,
        count: 0,
        times: [],
        lastAt: t,
        lastPayload: p.payload,
        version: p.version,
      };
      this.entries.set(key, e);
    }
    e.count++;
    e.lastAt = t;
    e.lastPayload = p.payload;
    e.version = p.version;
    e.times.push(t);
    if (e.times.length > RATE_WINDOW) e.times.shift();
  }

  clear() {
    this.entries.clear();
  }

  /**
   * Messages per second: the intervals between the recent arrivals (those in the last RATE_SPAN_MS, plus the one
   * before them, so a slow stream still has an interval) over the time they span. Steady while messages keep coming;
   * once the next one is overdue (more than one usual interval since the last), the wait beyond that counts too, so
   * the rate falls away smoothly; 0 when nothing came for RATE_SPAN_MS, or only one message ever.
   */
  rate(e: InspectorEntry): number {
    const t = this.clock();
    const ts = e.times;
    if (ts.length < 2 || t - ts[ts.length - 1] > RATE_SPAN_MS) return 0;
    let first = ts.length - 1;
    while (first > 0 && t - ts[first - 1] <= RATE_SPAN_MS) first--;
    if (first > 0) first--; // the arrival just before the window
    const n = ts.length - 1 - first; // intervals
    if (n < 1) return 0;
    const last = ts[ts.length - 1];
    const observed = last - ts[first];
    const span = Math.max(observed, t - ts[first] - observed / n); // overdue: the wait beyond one interval counts
    return span > 0 ? (n * 1000) / span : 0;
  }
}
