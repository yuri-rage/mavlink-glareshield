// Telemetry logs (.tlog): the MAVLink frames sent and received, each after an 8-byte big-endian timestamp in
// microseconds since 1970 (the format Mission Planner, QGroundControl, MAVExplorer and pymavlink read). A tlog has
// no header or end marker, so a file can be continued after an interruption; readers show the time gap.
//
// This module is the pure part: the record format, whether a new connection continues the last log or starts a new
// one, and which old logs to delete to stay under the size cap. Storage and recording are in tlogStorage.ts and
// tlogRecorder.ts.

import { MavlinkParser } from './parser';

/** One record: the timestamp, then the frame exactly as it was on the wire. */
export function encodeTlogRecord(timeUs: number, frame: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + frame.length);
  new DataView(out.buffer).setBigUint64(0, BigInt(Math.max(0, Math.floor(timeUs))), false);
  out.set(frame, 8);
  return out;
}

/** The records in a tlog (for checks and tests; reading needs to know each frame's length from its header). */
export function readTlog(bytes: Uint8Array): { timeUs: number; frame: Uint8Array }[] {
  const out: { timeUs: number; frame: Uint8Array }[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 0;
  while (i + 8 < bytes.length) {
    const timeUs = Number(view.getBigUint64(i, false));
    const start = i + 8;
    const magic = bytes[start];
    let len: number;
    if (magic === 0xfd) len = 12 + bytes[start + 1] + ((bytes[start + 2] & 1) !== 0 ? 13 : 0);
    else if (magic === 0xfe) len = 8 + bytes[start + 1];
    else break;
    if (start + len > bytes.length) break;
    out.push({ timeUs, frame: bytes.subarray(start, start + len) });
    i = start + len;
  }
  return out;
}

/**
 * Splits outgoing data into frames, so each gets its own record: a record holding two frames would make readers
 * lose their place. Data that isn't a complete, known frame is dropped.
 */
export class TlogFrameSplitter {
  private parser = new MavlinkParser();
  split(data: Uint8Array): Uint8Array[] {
    return this.parser.parse(data).map((p) => p.raw);
  }
}

/** What the app keeps about each log, beside the file. */
export interface TlogMeta {
  /** File name, e.g. 2026-11-24_15-04-05_sys1.tlog. */
  name: string;
  /** The vehicle logged (its system id and MAV_TYPE), once heard. */
  sysId: number;
  vehicleType: number;
  /** When the log started and was last written (ms since 1970). */
  startMs: number;
  lastWriteMs: number;
  bytes: number;
  /** Closed by a disconnect (or by starting another log); an open log was interrupted (reload, crash, link loss). */
  closed: boolean;
  /** Never deleted to make room. */
  kept: boolean;
  /** When the vehicle powered up (ms since 1970, from its time since boot), if known: a change means it rebooted. */
  bootEpochMs?: number;
  /** Armed when last written. */
  armed?: boolean;
}

/** How long an interruption can last and still continue the same log (unless the vehicle is armed). */
export const TLOG_RESUME_GAP_MS = 5 * 60 * 1000;
/** Boot times closer than this are the same power-up (they are derived from message times, so they jitter). */
export const BOOT_TOLERANCE_MS = 15_000;

/**
 * Whether a connection to the vehicle `now` continues the last log (`last`) or starts a new one. It continues only
 * when the last log was interrupted rather than closed, it is the same vehicle (system id and type), the vehicle
 * hasn't rebooted (when both boot times are known), and the gap is short or the vehicle is armed: so one flight stays
 * in one file across a reload or a crash, and a deliberate reconnect, another vehicle or a later session gets its own.
 */
export function tlogResumeDecision(
  last: TlogMeta | null,
  now: { timeMs: number; sysId: number; vehicleType: number; armed: boolean; bootEpochMs?: number }
): { resume: boolean; reason: string } {
  if (!last) return { resume: false, reason: 'no earlier log' };
  if (last.closed) return { resume: false, reason: 'the last log was closed' };
  if (last.sysId !== now.sysId || last.vehicleType !== now.vehicleType)
    return { resume: false, reason: 'a different vehicle' };
  if (
    last.bootEpochMs !== undefined &&
    now.bootEpochMs !== undefined &&
    Math.abs(last.bootEpochMs - now.bootEpochMs) > BOOT_TOLERANCE_MS
  ) {
    return { resume: false, reason: 'the vehicle rebooted' };
  }
  const gap = now.timeMs - last.lastWriteMs;
  if (gap < 0) return { resume: false, reason: 'the clock went back' };
  if (gap <= TLOG_RESUME_GAP_MS) return { resume: true, reason: `continuing after ${Math.round(gap / 1000)} s` };
  if (now.armed) return { resume: true, reason: 'continuing: the vehicle is still armed' };
  return { resume: false, reason: 'too long since the last log' };
}

/**
 * Which logs to delete, oldest first, to bring the total to `capBytes` or less. Kept logs and the active one are
 * never deleted; if they alone exceed the cap, nothing more can be done (the caller reports it).
 */
export function tlogsToPrune(
  logs: Pick<TlogMeta, 'name' | 'bytes' | 'kept' | 'startMs'>[],
  capBytes: number,
  active: string | null
): string[] {
  let total = logs.reduce((t, l) => t + l.bytes, 0);
  const out: string[] = [];
  for (const l of [...logs].sort((a, b) => a.startMs - b.startMs)) {
    if (total <= capBytes) break;
    if (l.kept || l.name === active) continue;
    out.push(l.name);
    total -= l.bytes;
  }
  return out;
}

/** A log's file name: its local start time and the vehicle, sortable by time. */
export function tlogFileName(startMs: number, sysId: number): string {
  const d = new Date(startMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}_sys${sysId}.tlog`;
}
