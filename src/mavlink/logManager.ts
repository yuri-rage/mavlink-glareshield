// Onboard (DataFlash) logs: list, download and erase.
//
// The list comes from LOG_REQUEST_LIST, which every ArduPilot vehicle answers (but not while armed). Its ids are
// list entries, oldest first (1 = oldest log), not the log numbers in the file names.
//
// Downloads try MAVFTP first, which is much faster: the log's file is /APM/LOGS/<number>.BIN (or logs/ on SITL),
// where number = LASTLOG.TXT − (logs listed − entry). That holds when the log numbers are consecutive, which they
// are unless files were deleted by hand, so a file is only read when the size the vehicle reports on opening it
// matches the listed size; a mismatch (a gap in the numbering, or the active log still growing) falls back to the
// LOG_DATA stream, which always works.

import { mavlinkConnection } from './connection';
import { mavFtpClient } from './ftp';
import { MAVLINK_MSG_ID } from './messages';
import { decodePayload, type MavlinkPacket } from './parser';

export interface LogEntry {
  /** List entry, 1 = oldest. */
  id: number;
  /** Bytes. */
  size: number;
  /** Seconds since 1970 (UTC) when the log started, or 0 when the vehicle had no time then (no GPS). */
  timeUtc: number;
}

export interface LogList {
  entries: LogEntry[];
  /** How many logs the vehicle says it has. */
  numLogs: number;
}

export type LogTransferMethod = 'mavftp' | 'mavlink';

export interface LogProgress {
  received: number;
  total: number;
  method: LogTransferMethod;
}

/** Directories ArduPilot keeps logs in: SD card on flight controllers, ./logs on SITL. */
const LOG_DIRS = ['/APM/LOGS', 'logs'];
/** ArduPilot's LOG_MAX_FILES default: log numbers wrap after this. */
const DEFAULT_MAX_LOG_FILES = 500;
const LOG_DATA_LEN = 90;
const LIST_QUIET_MS = 1500;
const STALL_MS = 1500;
const MAX_STALLS = 12;

export class LogTransferError extends Error {}

/** The log number in a file name for list entry `id`, assuming consecutive numbering (see top). */
export function logFileNumber(id: number, numLogs: number, lastLogNum: number, maxLogFiles = DEFAULT_MAX_LOG_FILES): number {
  let n = lastLogNum - (numLogs - id);
  while (n < 1) n += maxLogFiles;
  return n;
}

export const logFileName = (n: number) => `${String(n).padStart(8, '0')}.BIN`;

/** A file name for the downloaded log: log_<entry>_<start time>.bin. */
export function downloadName(entry: LogEntry): string {
  if (!entry.timeUtc) return `log_${entry.id}.bin`;
  const d = new Date(entry.timeUtc * 1000);
  const p = (v: number) => String(v).padStart(2, '0');
  return `log_${entry.id}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.bin`;
}

/**
 * Collects LOG_DATA into a buffer of the log's size, tracking which 90-byte blocks have arrived, and says
 * where the first missing block is so it can be asked for again. Pure, for tests.
 */
export class LogAssembler {
  readonly data: Uint8Array;
  private have: Uint8Array;
  private blocks: number;
  received = 0;

  constructor(readonly size: number) {
    this.data = new Uint8Array(size);
    this.blocks = Math.ceil(size / LOG_DATA_LEN);
    this.have = new Uint8Array(this.blocks);
  }

  /** Store one LOG_DATA; true when it added something new. */
  add(ofs: number, bytes: Uint8Array): boolean {
    if (bytes.length === 0 || ofs >= this.size || ofs % LOG_DATA_LEN !== 0) return false;
    const block = ofs / LOG_DATA_LEN;
    if (this.have[block]) return false;
    const n = Math.min(bytes.length, this.size - ofs);
    this.data.set(bytes.subarray(0, n), ofs);
    this.have[block] = 1;
    this.received += n;
    return true;
  }

  get complete(): boolean {
    return this.received >= this.size;
  }

  /** The first missing range as [offset, count] (to the next block that has arrived), or null. */
  firstGap(): [number, number] | null {
    const first = this.have.indexOf(0);
    if (first < 0) return null;
    let end = first;
    while (end < this.blocks && !this.have[end]) end++;
    const ofs = first * LOG_DATA_LEN;
    return [ofs, Math.min(this.size, end * LOG_DATA_LEN) - ofs];
  }
}

class LogManager {
  private cancelCurrent: (() => void) | null = null;

  get busy(): boolean {
    return this.cancelCurrent !== null;
  }

  /** Asks for the list of logs. Rejects when the vehicle doesn't answer (armed, or no logging). */
  listLogs(sysId: number, compId: number): Promise<LogList> {
    const enc = mavlinkConnection.getEncoder();
    return new Promise((resolve, reject) => {
      const entries = new Map<number, LogEntry>();
      let numLogs = -1;
      let rounds = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const done = (err?: Error) => {
        if (timer) clearTimeout(timer);
        off();
        // Listing counts as log transfer activity on ArduPilot; end it so normal logging resumes.
        mavlinkConnection.send(enc.createLogRequestEnd(sysId, compId));
        if (err) reject(err);
        else resolve({ entries: [...entries.values()].sort((a, b) => a.id - b.id), numLogs: Math.max(0, numLogs) });
      };
      const quiet = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (numLogs < 0) {
            if (rounds++ < 1) {
              mavlinkConnection.send(enc.createLogRequestList(sysId, compId));
              quiet();
              return;
            }
            done(new LogTransferError('The vehicle did not answer the log list request (it ignores it while armed).'));
            return;
          }
          // Ask again for any entries that went missing, a few times, then settle for what arrived.
          const missing: number[] = [];
          for (let id = 1; id <= numLogs; id++) if (!entries.has(id)) missing.push(id);
          if (missing.length === 0 || rounds++ >= 3) return done();
          for (const id of missing.slice(0, 20)) mavlinkConnection.send(enc.createLogRequestList(sysId, compId, id, id));
          quiet();
        }, LIST_QUIET_MS);
      };
      const off = mavlinkConnection.onPacket((packet: MavlinkPacket) => {
        if (packet.messageId !== MAVLINK_MSG_ID.LOG_ENTRY || packet.systemId !== sysId) return;
        const e = decodePayload(packet.messageId, packet.payload);
        numLogs = e.num_logs;
        if (numLogs === 0) return done();
        if (e.id >= 1 && e.id <= numLogs) entries.set(e.id, { id: e.id, size: e.size, timeUtc: e.time_utc });
        if (entries.size >= numLogs) return done();
        quiet();
      });
      mavlinkConnection.send(enc.createLogRequestList(sysId, compId));
      quiet();
    });
  }

  /**
   * Downloads one log, by MAVFTP when its file can be found (and matches the listed size), otherwise by
   * LOG_DATA. Rejects on cancel or failure.
   */
  async download(
    entry: LogEntry,
    list: LogList,
    sysId: number,
    compId: number,
    onProgress: (p: LogProgress) => void,
    maxLogFiles = DEFAULT_MAX_LOG_FILES
  ): Promise<{ data: Uint8Array; method: LogTransferMethod }> {
    if (this.busy) throw new LogTransferError('Another log transfer is in progress.');
    if (entry.size === 0) return { data: new Uint8Array(0), method: 'mavlink' };
    let cancelled = false;
    this.cancelCurrent = () => {
      cancelled = true;
      mavFtpClient.abortCurrent();
    };
    try {
      const viaFtp = await this.tryFtp(entry, list, sysId, compId, onProgress, maxLogFiles, () => cancelled);
      if (cancelled) throw new LogTransferError('Cancelled');
      if (viaFtp) return { data: viaFtp, method: 'mavftp' };
      const data = await this.streamLogData(entry, sysId, compId, onProgress, (cancel) => {
        this.cancelCurrent = () => {
          cancelled = true;
          cancel();
        };
      });
      return { data, method: 'mavlink' };
    } finally {
      this.cancelCurrent = null;
    }
  }

  cancel(): void {
    this.cancelCurrent?.();
  }

  /** Deletes every onboard log. */
  erase(sysId: number, compId: number): void {
    mavlinkConnection.send(mavlinkConnection.getEncoder().createLogErase(sysId, compId));
  }

  private async tryFtp(
    entry: LogEntry,
    list: LogList,
    sysId: number,
    compId: number,
    onProgress: (p: LogProgress) => void,
    maxLogFiles: number,
    isCancelled: () => boolean
  ): Promise<Uint8Array | null> {
    for (const dir of LOG_DIRS) {
      if (isCancelled()) return null;
      const last = await mavFtpClient.readFile(sysId, compId, `${dir}/LASTLOG.TXT`, 239, 1000);
      if (!last) continue;
      const lastLogNum = parseInt(new TextDecoder().decode(last).trim(), 10);
      if (!Number.isFinite(lastLogNum) || lastLogNum < 1) continue;
      const n = logFileNumber(entry.id, list.numLogs, lastLogNum, maxLogFiles);
      const data = await mavFtpClient.readFile(
        sysId,
        compId,
        `${dir}/${logFileName(n)}`,
        239,
        1500,
        (received, total) => onProgress({ received, total: total || entry.size, method: 'mavftp' }),
        { expectedSize: entry.size }
      );
      return data && data.length === entry.size ? data : null;
    }
    return null;
  }

  private streamLogData(
    entry: LogEntry,
    sysId: number,
    compId: number,
    onProgress: (p: LogProgress) => void,
    setCancel: (cancel: () => void) => void
  ): Promise<Uint8Array> {
    const enc = mavlinkConnection.getEncoder();
    const asm = new LogAssembler(entry.size);
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stalls = 0;
      let lastReport = 0;
      /** End offset of the gap last asked for, while gaps are being filled after the main stream. */
      let gapEnd = 0;
      /** The end of the current stream was seen (it can be marked twice: a short last block, then an empty one). */
      let endSeen = false;
      let done = false;
      const finish = (err?: Error) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        off();
        mavlinkConnection.send(enc.createLogRequestEnd(sysId, compId));
        if (err) reject(err);
        else resolve(asm.data);
      };
      setCancel(() => finish(new LogTransferError('Cancelled')));
      const request = (ofs: number, count: number) => mavlinkConnection.send(enc.createLogRequestData(sysId, compId, entry.id, ofs, count));
      const requestNextGap = () => {
        const gap = asm.firstGap();
        if (!gap) return;
        gapEnd = gap[0] + gap[1];
        request(gap[0], gap[1]);
      };
      const watchdog = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const gap = asm.firstGap();
          if (!gap) return finish();
          if (++stalls > MAX_STALLS) return finish(new LogTransferError('The log stream stopped and did not resume.'));
          if (endSeen) {
            // Filling gaps after the stream ended: ask for the missing one again.
            requestNextGap();
          } else {
            // The stream itself stopped: ask from the first gap to the end, which refills gaps and continues.
            gapEnd = 0;
            request(gap[0], entry.size - gap[0]);
          }
          watchdog();
        }, STALL_MS);
      };
      const off = mavlinkConnection.onPacket((packet: MavlinkPacket) => {
        if (packet.messageId !== MAVLINK_MSG_ID.LOG_DATA || packet.systemId !== sysId) return;
        const d = decodePayload(packet.messageId, packet.payload);
        if (d.id !== entry.id) return;
        if (done) return;
        if (asm.add(d.ofs, d.data)) stalls = 0;
        const now = Date.now();
        if (now - lastReport > 100 || asm.complete) {
          lastReport = now;
          onProgress({ received: asm.received, total: entry.size, method: 'mavlink' });
        }
        if (asm.complete) return finish();
        if (done) return; // cancelled from the progress callback
        // The end of the stream (a short or empty block at the end) with gaps left: fill them one by one, asking
        // for the next as each one completes.
        const streamEnded = !endSeen && gapEnd === 0 && d.count < LOG_DATA_LEN && d.ofs + d.count >= entry.size;
        if (streamEnded) endSeen = true;
        // The last block of the gap asked for (a block inside it, reaching its end).
        const gapFilled = gapEnd > 0 && d.count > 0 && d.ofs < gapEnd && d.ofs + d.count >= gapEnd;
        if (streamEnded || gapFilled) requestNextGap();
        watchdog();
      });
      request(0, 0xffffffff);
      watchdog();
    });
  }
}

export const logManager = new LogManager();
