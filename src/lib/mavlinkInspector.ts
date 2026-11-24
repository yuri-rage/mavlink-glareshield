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
  /** MAVLink version of the last frame (1 or 2) and whether it was signed. */
  version: number;
}

const RATE_WINDOW = 40;
/** Rates are over the arrivals of the last few seconds; older than this counts as stopped. */
export const RATE_SPAN_MS = 5000;

export class InspectorCollector {
  entries = new Map<string, InspectorEntry>();
  paused = false;
  private users = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(private subscribe: (fn: (p: MavlinkPacket) => void) => () => void, private now: () => number = () => Date.now()) {}

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

  add(p: MavlinkPacket) {
    if (this.paused) return;
    const key = `${p.systemId}:${p.componentId}:${p.messageId}`;
    const t = this.now();
    let e = this.entries.get(key);
    if (!e) {
      e = { key, sysId: p.systemId, compId: p.componentId, msgId: p.messageId, count: 0, times: [], lastAt: t, lastPayload: p.payload, version: p.version };
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

  /** Messages per second over the recent arrivals; 0 when it has stopped coming. */
  rate(e: InspectorEntry): number {
    const t = this.now();
    const recent = e.times.filter((x) => t - x <= RATE_SPAN_MS);
    if (recent.length < 2) return recent.length === 1 && t - recent[0] < 1500 ? 1 : 0;
    const span = Math.max(t - recent[0], recent[recent.length - 1] - recent[0]);
    return span > 0 ? ((recent.length - 1) * 1000) / span : 0;
  }
}
