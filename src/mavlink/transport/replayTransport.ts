// A recorded telemetry log as the link: plays a timeline (tlogReplay.ts) to the connection as if the frames were
// arriving, with play / pause, speed and seek. Read-only: send() never goes anywhere (and the connection doesn't call
// it while replaying).

import { MAVLINK_MESSAGE_CRC_EXTRA, MAVLINK_MSG_ID } from '../messages';
import { calculateCrc } from '../parser';
import { TlogPlayer, type ReplayTimeline } from '../tlogReplay';
import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types';

/** Frames handed out per step of a seek, so a long seek doesn't freeze the page. */
const SEEK_BATCH = 4000;
/** While paused, the last heartbeat is repeated this often, so the vehicle doesn't read as lost. */
const PAUSED_HEARTBEAT_MS = 1000;

/**
 * `frame` (an unsigned MAVLink 1 or 2 heartbeat) with sequence number `seq` and its checksum redone. The same frame
 * repeated is a duplicate to the link-quality count, which then reads the pause as silence (0 %); renumbered, it's a
 * link that's there. A signed frame (its signature covers the sequence) is returned as it is.
 */
export function renumberFrame(frame: Uint8Array, seq: number): Uint8Array {
  const v2 = frame[0] === 0xfd;
  if (v2 && (frame[2] & 0x01) !== 0) return frame;
  const header = v2 ? 10 : 6;
  const len = frame[1];
  if (frame.length < header + len + 2) return frame;
  const out = frame.slice(0, header + len + 2);
  out[v2 ? 4 : 2] = seq & 0xff;
  const crc = calculateCrc(out, 1, header + len - 1, MAVLINK_MESSAGE_CRC_EXTRA[MAVLINK_MSG_ID.HEARTBEAT]);
  out[header + len] = crc & 0xff;
  out[header + len + 1] = crc >> 8;
  return out;
}

export interface ReplayState {
  positionMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  /** A seek is handing out frames. */
  seeking: boolean;
  ended: boolean;
}

export interface ReplayTransportOptions {
  /** Everything shown must start over (a seek backwards). Called before the frames are handed out again. */
  onRestart?: () => void;
  /** Position, play state and speed changed (at most a few times a second while playing). */
  onState?: (state: ReplayState) => void;
  tickMs?: number;
  now?: () => number;
}

export class ReplayTransport implements Transport {
  readonly kind = 'replay' as const;
  readonly player: TlogPlayer;
  /** Sends refused (none should arrive: the connection drops them first). */
  refusedSends = 0;
  private status: TransportStatus = { kind: 'idle' };
  private frameListeners = new Set<FrameListener>();
  private statusListeners = new Set<StatusListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private lastStateAt = 0;
  private lastKeepAlive = 0;
  /** Paused heartbeats sent since the last real one (each numbered on from it). */
  private keepAlives = 0;
  private keepAliveFor: Uint8Array | null = null;
  private seekGeneration = 0;
  private seeking = false;
  /** Whether to play once the seek in progress is done (kept across a seek that starts before the last finished). */
  private resumeAfterSeek = false;
  private readonly tickMs: number;
  private readonly now: () => number;

  constructor(
    readonly id: string,
    timeline: ReplayTimeline,
    private readonly opts: ReplayTransportOptions = {}
  ) {
    this.tickMs = opts.tickMs ?? 50;
    this.now = opts.now ?? (() => performance.now());
    this.player = new TlogPlayer(
      timeline,
      (frame) => this.frameListeners.forEach((l) => l(frame)),
      () => opts.onRestart?.()
    );
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.setStatus({ kind: 'connected' });
    this.lastTick = this.now();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.seekGeneration++;
    this.player.pause();
    if (this.status.kind !== 'disconnected') this.setStatus({ kind: 'disconnected' });
  }

  /** Never sends: a replay has no vehicle to send to. */
  async send(_frame: Uint8Array): Promise<void> {
    this.refusedSends++;
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  play() {
    if (this.seeking) {
      this.resumeAfterSeek = true;
      return;
    }
    this.player.play();
    this.lastTick = this.now();
    this.publish(true);
  }

  pause() {
    if (this.seeking) this.resumeAfterSeek = false;
    this.player.pause();
    this.publish(true);
  }

  setSpeed(speed: number) {
    if (Number.isFinite(speed) && speed > 0) this.player.speed = speed;
    this.publish(true);
  }

  /** Move to `ms` (from the start of the log). Backwards starts over (onRestart) and plays forward to it quickly. */
  seek(ms: number) {
    const generation = ++this.seekGeneration;
    // A seek started while another is still stepping: the first one's paused the player, so its play state is the
    // one to restore.
    if (!this.seeking) this.resumeAfterSeek = this.player.playing;
    this.player.pause();
    const target = this.player.beginSeek(ms);
    this.seeking = true;
    this.publish(true);
    const step = () => {
      if (generation !== this.seekGeneration) return;
      if (!this.player.emitUntil(target, SEEK_BATCH)) {
        setTimeout(step, 0);
        return;
      }
      this.seeking = false;
      this.lastTick = this.now();
      if (this.resumeAfterSeek && !this.player.ended) this.player.playing = true;
      this.publish(true);
    };
    step();
  }

  getState(): ReplayState {
    return {
      positionMs: this.player.positionMs,
      durationMs: this.player.timeline.durationMs,
      playing: this.player.playing,
      speed: this.player.speed,
      seeking: this.seeking,
      ended: this.player.ended,
    };
  }

  /** One timer step (exposed for tests). */
  tick() {
    const now = this.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.seeking) return;
    if (this.player.playing) {
      this.player.advance(dt);
      this.publish(!this.player.playing);
    } else if (this.player.lastHeartbeat && now - this.lastKeepAlive >= PAUSED_HEARTBEAT_MS) {
      // Paused (or at the end): the vehicle as it was at this moment, still there.
      this.lastKeepAlive = now;
      const last = this.player.lastHeartbeat;
      if (this.keepAliveFor !== last) {
        this.keepAliveFor = last;
        this.keepAlives = 0;
      }
      const seq = last[0] === 0xfd ? last[4] : last[2];
      const hb = renumberFrame(last, seq + ++this.keepAlives);
      this.frameListeners.forEach((l) => l(hb));
    }
  }

  private publish(force: boolean) {
    const now = this.now();
    if (!force && now - this.lastStateAt < 250) return;
    this.lastStateAt = now;
    this.opts.onState?.(this.getState());
  }

  private setStatus(status: TransportStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
