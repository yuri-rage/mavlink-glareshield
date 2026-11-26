// Telemetry log replay, the pure part: a .tlog (8-byte big-endian µs timestamp, then a MAVLink frame, repeated: see
// tlog.ts) made into a timeline, and a player that hands its frames out in time as a clock advances. The transport
// that drives it with timers and feeds the frames to the connection is transport/replayTransport.ts.
//
// Read-only by design: a replay only ever produces frames for the parser; nothing goes back to any vehicle (the
// connection drops every send while a replay is its link).

import { readTlog } from './tlog';

/** MAV_COMP_ID_MISSIONPLANNER: the component Glareshield, Mission Planner and QGroundControl send from. */
export const GCS_COMPONENT_ID = 190;
/** A pause in the log longer than this (a log continued after an interruption) is played as COMPRESSED_GAP_MS. */
export const MAX_GAP_MS = 60_000;
export const COMPRESSED_GAP_MS = 1000;

export interface ReplayTimeline {
  /** The frames to play, in order. */
  frames: Uint8Array[];
  /** Each frame's playback time, ms from the first frame (gaps compressed, never decreasing). */
  timesMs: number[];
  durationMs: number;
  /** Wall-clock time of the first frame (ms since 1970), from the log. */
  startEpochMs: number;
  /** Pauses longer than MAX_GAP_MS played as COMPRESSED_GAP_MS. */
  gapsCompressed: number;
  /** Frames the ground station sent (left out: the replay shows the vehicle). */
  gcsFrames: number;
  /** Bytes at the end that weren't a whole record (a log cut off mid-write). */
  trailingBytes: number;
}

/** A frame's sender (system and component id) and message id, from its header (MAVLink 1 or 2). */
export function frameHeader(frame: Uint8Array): { systemId: number; componentId: number; messageId: number } | null {
  if (frame[0] === 0xfd && frame.length >= 12)
    return { systemId: frame[5], componentId: frame[6], messageId: frame[7] | (frame[8] << 8) | (frame[9] << 16) };
  if (frame[0] === 0xfe && frame.length >= 8) return { systemId: frame[3], componentId: frame[4], messageId: frame[5] };
  return null;
}

/**
 * The timeline of a tlog: the vehicle's frames (the ground station's own are left out) with playback times. Time
 * never runs backwards (a clock step in the log holds the time), and a long pause is compressed, so a log continued
 * after an interruption doesn't play minutes of nothing.
 */
export function buildReplayTimeline(
  bytes: Uint8Array,
  opts: { maxGapMs?: number; compressedGapMs?: number; gcsComponentId?: number } = {}
): ReplayTimeline {
  const maxGap = opts.maxGapMs ?? MAX_GAP_MS;
  const compressed = opts.compressedGapMs ?? COMPRESSED_GAP_MS;
  const gcs = opts.gcsComponentId ?? GCS_COMPONENT_ID;
  const records = readTlog(bytes);
  const consumed = records.reduce((n, r) => n + 8 + r.frame.length, 0);
  const frames: Uint8Array[] = [];
  const timesMs: number[] = [];
  let gapsCompressed = 0;
  let gcsFrames = 0;
  let startEpochMs = 0;
  let lastLogMs: number | null = null;
  let t = 0;
  for (const r of records) {
    const h = frameHeader(r.frame);
    if (!h) continue;
    if (h.componentId === gcs) {
      gcsFrames++;
      continue;
    }
    const logMs = r.timeUs / 1000;
    if (lastLogMs === null) {
      startEpochMs = logMs;
    } else {
      const dt = logMs - lastLogMs;
      if (dt > maxGap) {
        t += compressed;
        gapsCompressed++;
      } else if (dt > 0) {
        t += dt;
      }
    }
    // A clock step backwards holds the time (and the next step is measured from the new clock).
    lastLogMs = logMs;
    frames.push(r.frame);
    timesMs.push(t);
  }
  return {
    frames,
    timesMs,
    durationMs: t,
    startEpochMs,
    gapsCompressed,
    gcsFrames,
    trailingBytes: bytes.length - consumed,
  };
}

/** Index of the first frame after `ms` (binary search over the never-decreasing times). */
export function frameIndexAfter(timesMs: number[], ms: number): number {
  let lo = 0;
  let hi = timesMs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timesMs[mid] <= ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;

/**
 * Plays a timeline: `advance` moves the playback position on by real time × speed and hands out the frames now due;
 * `seekTo` moves it anywhere (backwards: `onRestart` first, so everything shown can start over, then the frames up
 * to the target are handed out again, in bounded batches). Owns no timers.
 */
export class TlogPlayer {
  positionMs = 0;
  /** The next frame to hand out. */
  index = 0;
  playing = false;
  speed = 1;
  /** The last vehicle heartbeat handed out (repeated while paused, so the vehicle doesn't look lost). */
  lastHeartbeat: Uint8Array | null = null;

  constructor(
    readonly timeline: ReplayTimeline,
    private readonly emit: (frame: Uint8Array) => void,
    private readonly onRestart: () => void = () => {}
  ) {}

  get ended(): boolean {
    return this.index >= this.timeline.frames.length;
  }

  play() {
    if (this.ended) this.seekTo(0);
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  /** Real time passed: move on and hand out what's due. Returns the frames handed out. */
  advance(realMs: number): number {
    if (!this.playing || !(realMs >= 0)) return 0;
    const target = Math.min(this.timeline.durationMs, this.positionMs + realMs * this.speed);
    const before = this.index;
    this.emitUntil(target, Infinity);
    this.positionMs = target;
    if (this.ended) this.playing = false;
    return this.index - before;
  }

  /**
   * Hand out the frames up to `targetMs`, at most `budget` of them. True when all are out (the position is then
   * `targetMs`); false when the budget ran out first (call again).
   */
  emitUntil(targetMs: number, budget: number): boolean {
    const { frames, timesMs } = this.timeline;
    let n = 0;
    while (this.index < frames.length && timesMs[this.index] <= targetMs) {
      if (n >= budget) return false;
      const frame = frames[this.index++];
      const h = frameHeader(frame);
      if (h && h.messageId === 0) this.lastHeartbeat = frame;
      this.emit(frame);
      n++;
    }
    this.positionMs = Math.max(this.positionMs, Math.min(targetMs, this.timeline.durationMs));
    return true;
  }

  /**
   * Start a seek: backwards restarts from the beginning (onRestart, then everything again up to the target). The
   * caller then calls emitUntil(target, budget) until it returns true.
   */
  beginSeek(targetMs: number): number {
    const target = Math.max(0, Math.min(this.timeline.durationMs, targetMs));
    if (target < this.positionMs || (target === 0 && this.index > 0)) {
      this.onRestart();
      this.index = 0;
      this.positionMs = 0;
      this.lastHeartbeat = null;
    }
    return target;
  }

  /** A whole seek at once (tests, short logs). */
  seekTo(targetMs: number) {
    this.emitUntil(this.beginSeek(targetMs), Infinity);
  }
}
