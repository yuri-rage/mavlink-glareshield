// Link quality as Mission Planner shows it: of the vehicle's packets, the share that arrived. Every MAVLink packet carries
// its sender's sequence number (0-255, one more per packet), so a gap is packets lost on the way. Counted over a short
// sliding window, for the vehicle's autopilot only (each component numbers its own packets).

/** How far back the quality looks (ms). */
export const LINK_WINDOW_MS = 5000;

interface LinkEvent {
  t: number;
  received: number;
  lost: number;
}

export interface LinkSnapshot {
  /** % of the vehicle's packets received in the window; null before any packet. */
  quality: number | null;
  /** % lost (100 - quality); null before any packet. */
  loss: number | null;
  /** Packets received and lost in the window. */
  received: number;
  lost: number;
}

export class LinkQualityMeter {
  private last: number | null = null;
  private lastAt = 0;
  private events: LinkEvent[] = [];

  constructor(private readonly windowMs = LINK_WINDOW_MS) {}

  /** A packet from the vehicle's autopilot with sequence number `seq`. */
  record(seq: number, now: number): void {
    const s = seq & 0xff;
    let lost = 0;
    if (this.last !== null) {
      const gap = (s - this.last - 1 + 256) % 256;
      // The same number again: a duplicate, not a packet (and not 255 lost).
      if (gap === 255) return;
      // A jump of half the range or more is a reorder or the vehicle restarting its count, not that many losses
      // (a long dropout shows as silence instead, below).
      if (gap < 128) lost = gap;
    }
    this.last = s;
    this.lastAt = now;
    this.events.push({ t: now, received: 1, lost });
    this.prune(now);
  }

  snapshot(now: number): LinkSnapshot {
    this.prune(now);
    let received = 0;
    let lost = 0;
    for (const e of this.events) {
      received += e.received;
      lost += e.lost;
    }
    if (received + lost === 0) {
      // Nothing in the window: no link yet (unknown), or the vehicle went silent (nothing is getting through).
      if (this.last === null) return { quality: null, loss: null, received: 0, lost: 0 };
      return { quality: 0, loss: 100, received: 0, lost: 0 };
    }
    const quality = (100 * received) / (received + lost);
    return { quality, loss: 100 - quality, received, lost };
  }

  /** Time of the last packet counted (0 before any). */
  lastPacketAt(): number {
    return this.lastAt;
  }

  /**
   * The numbering starts over without the packets so far being forgotten: the next packet counts as received, no
   * gap measured from the last (a replay resuming after a pause, where the log's own numbering takes over again).
   */
  forgetSequence(): void {
    this.last = null;
  }

  /** A new link or another vehicle: start again. */
  reset(): void {
    this.last = null;
    this.lastAt = 0;
    this.events = [];
  }

  private prune(now: number) {
    const from = now - this.windowMs;
    let i = 0;
    while (i < this.events.length && this.events[i].t < from) i++;
    if (i) this.events.splice(0, i);
  }
}

/** Signal bars (0-4) for a quality %: 4 from 95, 3 from 85, 2 from 70, 1 above 0. */
export function linkBars(quality: number | null): number {
  if (quality === null) return 0;
  if (quality >= 95) return 4;
  if (quality >= 85) return 3;
  if (quality >= 70) return 2;
  return quality > 0 ? 1 : 0;
}

/** 'good' from 90 %, 'fair' from 70 %, else 'poor'; null when unknown. */
export function linkLevel(quality: number | null): 'good' | 'fair' | 'poor' | null {
  if (quality === null) return null;
  return quality >= 90 ? 'good' : quality >= 70 ? 'fair' : 'poor';
}
