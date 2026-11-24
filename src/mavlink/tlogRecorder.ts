// Records the link to a telemetry log (.tlog) while logging is on: every frame received, and every frame sent.
//
// Which file: nothing is written until the vehicle is heard. On its first heartbeat (and its time since boot, if it
// arrives within a few seconds) tlogResumeDecision picks the file: the interrupted last log when this is the same
// flight continuing (a reload, a crash, a dropped link), or a new one. What arrived meanwhile is held in memory and
// written first. A deliberate disconnect, turning logging off, or starting another log closes a log, so it is never
// continued; a reload leaves it open, which is how the next load knows it was interrupted.
//
// Writes go out about once a second (each batch is on disk when the write returns). After each 16 MB, and when a
// log starts, the oldest logs are deleted to keep the total under the cap (kept logs never). If storage is full, or
// the browser can't store files, recording stops and says so.

import {
  BOOT_TOLERANCE_MS,
  TLOG_RESUME_GAP_MS,
  TlogFrameSplitter,
  encodeTlogRecord,
  tlogFileName,
  tlogResumeDecision,
  tlogsToPrune,
  type TlogMeta,
} from './tlog';
import { isVehicleAutopilotHeartbeat, MAVLINK_MSG_ID } from './messages';
import type { MavlinkPacket } from './parser';
import { TlogStorageError, loadTlogIndex, metaFromFile, saveTlogIndex, type TlogStorage } from '../lib/tlogStorage';
import { useTlogStore } from '../store/tlogStore';

export interface TlogRecorderDeps {
  storage: TlogStorage | null;
  /** Microseconds since 1970. */
  nowUs?: () => number;
  /** How long to wait after the first heartbeat for the vehicle's time since boot before choosing the file. */
  bootWaitMs?: number;
  flushMs?: number;
}

const FLUSH_BYTES = 256 * 1024;
const PENDING_MAX_BYTES = 4 * 1024 * 1024;
const PRUNE_EVERY_BYTES = 16 * 1024 * 1024;
/** The logged vehicle silent this long while another vehicle is heard: it was swapped (the link stayed up). */
const VEHICLE_SWAP_SILENCE_MS = 5000;

export class TlogRecorder {
  private storage: TlogStorage | null;
  private nowUs: () => number;
  private bootWaitMs: number;
  private flushMs: number;
  private splitter = new TlogFrameSplitter();
  private index: Record<string, TlogMeta> = loadTlogIndex();

  private connected = false;
  /** The file open for writing (it can stay open across a dropped link, waiting to see if the flight continues). */
  private openName: string | null = null;
  private recording = false;
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private queue: Uint8Array[] = [];
  private queueBytes = 0;
  private vehicle: { sysId: number; type: number; armed: boolean; lastHeardMs: number } | null = null;
  private bootEpochMs: number | undefined;
  private decideTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private sincePrune = 0;

  constructor(deps: TlogRecorderDeps) {
    this.storage = deps.storage;
    this.nowUs = deps.nowUs ?? (() => Math.round((performance.timeOrigin + performance.now()) * 1000));
    this.bootWaitMs = deps.bootWaitMs ?? 3000;
    this.flushMs = deps.flushMs ?? 1000;
  }

  private get enabled() {
    return useTlogStore.getState().enabled;
  }
  private nowMs() {
    return Math.floor(this.nowUs() / 1000);
  }

  /** The link connected or went away. A deliberate disconnect closes the log; a dropped link leaves it open. */
  onStatus(status: string, manual: boolean) {
    const was = this.connected;
    this.connected = status === 'connected';
    if (this.connected && !was) {
      this.vehicle = null;
      this.bootEpochMs = undefined;
      // A new connection tries again after a stop (e.g. storage was full and logs have been deleted since).
      if (this.enabled) useTlogStore.setState({ phase: 'waiting', error: null });
    } else if (!this.connected && was) {
      this.recording = false;
      this.clearPending();
      if (manual) this.enqueue(() => this.closeLog());
      else this.enqueue(() => this.flush());
      useTlogStore.setState({ phase: 'idle' });
    }
  }

  /** Logging turned on or off in Settings. */
  setEnabled(enabled: boolean) {
    if (!enabled) {
      this.recording = false;
      this.clearPending();
      this.enqueue(() => this.closeLog());
      useTlogStore.setState({ phase: 'idle', error: null });
    } else {
      this.vehicle = null;
      useTlogStore.setState({ phase: this.connected ? 'waiting' : 'idle', error: null });
    }
  }

  onReceived(p: MavlinkPacket) {
    if (!this.enabled || !this.connected || useTlogStore.getState().phase === 'stopped') return;
    this.watchVehicle(p);
    this.add(encodeTlogRecord(this.nowUs(), p.raw));
  }

  onSent(data: Uint8Array) {
    if (!this.enabled || !this.connected || useTlogStore.getState().phase === 'stopped') return;
    const t = this.nowUs();
    for (const frame of this.splitter.split(data)) this.add(encodeTlogRecord(t, frame));
  }

  /** Before the page goes away: write what's queued (best effort; the log stays open, so it can be continued). */
  onPageHide() {
    // The worker's reply may never be handled once the page is going: record the time now, so the next load
    // judges the gap from here.
    const m = this.openName ? this.index[this.openName] : undefined;
    if (m) {
      m.lastWriteMs = this.nowMs();
      if (this.vehicle) m.armed = this.vehicle.armed;
      if (this.bootEpochMs !== undefined) m.bootEpochMs = this.bootEpochMs;
      saveTlogIndex(this.index);
    }
    this.enqueue(() => this.flush());
  }

  /** Delete a log (not the one being written). */
  async remove(name: string) {
    if (name === this.openName) return;
    await this.storage?.remove(name).catch(() => {});
    delete this.index[name];
    saveTlogIndex(this.index);
    await this.refreshList();
  }

  setKept(name: string, kept: boolean) {
    const m = this.index[name];
    if (!m) return;
    m.kept = kept;
    saveTlogIndex(this.index);
    void this.refreshList();
  }

  async file(name: string): Promise<Blob | null> {
    if (name === this.openName) await this.enqueue(() => this.flush());
    return this.storage ? this.storage.file(name).catch(() => null) : null;
  }

  /** Re-read the folder into the list (files the index doesn't know are added from their names). */
  async refreshList() {
    if (!this.storage) return;
    try {
      const files = await this.storage.files();
      const names = new Set(files.map((f) => f.name));
      for (const f of files) {
        const m = this.index[f.name];
        if (m) m.bytes = f.size;
        else this.index[f.name] = metaFromFile(f);
      }
      for (const n of Object.keys(this.index)) if (!names.has(n)) delete this.index[n];
      saveTlogIndex(this.index);
      this.publish();
    } catch {
      // Listing failed: keep the last list.
    }
  }

  // ---------------------------------------------------------------------------------------------

  private watchVehicle(p: MavlinkPacket) {
    const pl = p.payload;
    // Anything from the logged vehicle means it's still there (not only its heartbeat).
    if (this.vehicle && p.systemId === this.vehicle.sysId) this.vehicle.lastHeardMs = this.nowMs();
    if (p.messageId === MAVLINK_MSG_ID.HEARTBEAT && pl.length >= 7) {
      const type = pl[4];
      const autopilot = pl[5];
      if (!isVehicleAutopilotHeartbeat(type, autopilot, p.componentId)) return;
      const now = this.nowMs();
      if (this.vehicle && p.systemId !== this.vehicle.sysId && now - this.vehicle.lastHeardMs > VEHICLE_SWAP_SILENCE_MS) {
        // The link stayed up but the vehicle changed: this one gets its own log.
        this.rotate();
      }
      if (!this.vehicle) {
        this.vehicle = { sysId: p.systemId, type, armed: (pl[6] & 128) !== 0, lastHeardMs: now };
        if (!this.recording) this.decideTimer ??= setTimeout(() => this.decide(), this.bootWaitMs);
      } else if (p.systemId === this.vehicle.sysId) {
        this.vehicle.armed = (pl[6] & 128) !== 0;
        this.vehicle.lastHeardMs = now;
      }
      return;
    }
    // Time since boot: ATTITUDE and GLOBAL_POSITION_INT start with time_boot_ms.
    if (this.vehicle && p.systemId === this.vehicle.sysId && (p.messageId === MAVLINK_MSG_ID.ATTITUDE || p.messageId === MAVLINK_MSG_ID.GLOBAL_POSITION_INT) && pl.length >= 4) {
      const bootMs = new DataView(pl.buffer, pl.byteOffset, 4).getUint32(0, true);
      if (bootMs > 0) {
        const boot = this.nowMs() - bootMs;
        // Rebooted with the link up (a bridge stays connected): a new power-up gets its own log. Only a jump later
        // counts: a vehicle clock running fast (SITL sped up) moves the derived boot time steadily earlier.
        if (this.recording && this.bootEpochMs !== undefined && boot - this.bootEpochMs > BOOT_TOLERANCE_MS) {
          this.rotate();
        }
        this.bootEpochMs = boot;
        if (!this.recording && this.decideTimer) {
          clearTimeout(this.decideTimer);
          this.decideTimer = null;
          this.decide();
        }
      }
    }
  }

  /**
   * Close the current log (it is complete) and choose again: the next vehicle heartbeat (and boot time) picks the
   * file, which is a new one since this one is closed. What arrives meanwhile is held, as at connection.
   */
  private rotate() {
    if (!this.recording) return;
    this.recording = false;
    this.vehicle = null;
    this.bootEpochMs = undefined;
    this.clearPending();
    this.enqueue(() => this.closeLog());
    useTlogStore.setState({ phase: 'waiting' });
  }

  /** The cap changed in Settings: apply it now. */
  pruneNow() {
    this.enqueue(() => this.prune());
  }

  private add(rec: Uint8Array) {
    if (this.recording) {
      this.queue.push(rec);
      this.queueBytes += rec.length;
      if (this.queueBytes >= FLUSH_BYTES) this.enqueue(() => this.flush());
      return;
    }
    // Not yet chosen: hold it (the most recent few MB).
    this.pending.push(rec);
    this.pendingBytes += rec.length;
    while (this.pendingBytes > PENDING_MAX_BYTES && this.pending.length > 1) this.pendingBytes -= this.pending.shift()!.length;
  }

  private clearPending() {
    if (this.decideTimer) clearTimeout(this.decideTimer);
    this.decideTimer = null;
    this.pending = [];
    this.pendingBytes = 0;
  }

  private decide() {
    this.decideTimer = null;
    const v = this.vehicle;
    if (!v || this.recording || !this.connected || !this.enabled) return;
    this.recording = true; // further frames queue behind the held ones
    const held = this.pending;
    this.pending = [];
    this.pendingBytes = 0;
    this.queue = [...held, ...this.queue];
    this.queueBytes = this.queue.reduce((t, r) => t + r.length, 0);
    this.enqueue(async () => {
      if (!this.storage) {
        this.stop('This browser can’t store telemetry logs (no private file storage).');
        return;
      }
      const now = this.nowMs();
      const candidates = Object.values(this.index).sort((a, b) => b.lastWriteMs - a.lastWriteMs);
      const last = (this.openName && this.index[this.openName]) || candidates[0] || null;
      const d = tlogResumeDecision(last, { timeMs: now, sysId: v.sysId, vehicleType: v.type, armed: v.armed, bootEpochMs: this.bootEpochMs });
      let name: string | null = null;
      let reason = d.reason;
      if (d.resume && last) {
        if (this.openName === last.name) name = last.name;
        else {
          await this.closeLog();
          try {
            await this.storage.open(last.name, true);
            name = last.name;
          } catch {
            reason = 'the last log is open in another tab';
          }
        }
      }
      if (!name) {
        await this.closeLog();
        name = tlogFileName(now, v.sysId);
        for (let k = 2; this.index[name]; k++) name = tlogFileName(now, v.sysId).replace('.tlog', `-${k}.tlog`);
        try {
          await this.storage.open(name, false);
        } catch (err) {
          this.fail(err);
          return;
        }
        this.index[name] = { name, sysId: v.sysId, vehicleType: v.type, startMs: now, lastWriteMs: now, bytes: 0, closed: false, kept: false };
        // Only the newest log can ever be continued.
        for (const m of Object.values(this.index)) if (m.name !== name) m.closed = true;
      } else {
        this.index[name].closed = false;
      }
      this.openName = name;
      saveTlogIndex(this.index);
      useTlogStore.setState({ phase: 'recording', active: name, activeBytes: this.index[name].bytes, decision: reason, error: null });
      await this.prune();
      await this.flush();
    });
    this.flushTimer ??= setInterval(() => {
      if (this.queueBytes > 0) this.enqueue(() => this.flush());
    }, this.flushMs);
  }

  /** Run storage work one step at a time, in order. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn).catch((err) => this.fail(err));
    return this.chain;
  }

  private async flush() {
    if (!this.openName || !this.storage || this.queue.length === 0) return;
    const batch = this.queue;
    const size = this.queueBytes;
    this.queue = [];
    this.queueBytes = 0;
    const buf = new Uint8Array(size);
    let o = 0;
    for (const r of batch) {
      buf.set(r, o);
      o += r.length;
    }
    let total: number;
    try {
      total = await this.storage.write(buf);
    } catch (err) {
      this.fail(err);
      return;
    }
    const m = this.index[this.openName];
    if (m) {
      m.bytes = total;
      m.lastWriteMs = this.nowMs();
      if (this.vehicle) m.armed = this.vehicle.armed;
      if (this.bootEpochMs !== undefined) m.bootEpochMs = this.bootEpochMs;
      saveTlogIndex(this.index);
    }
    useTlogStore.setState({ activeBytes: total });
    this.publish();
    this.sincePrune += size;
    if (this.sincePrune >= PRUNE_EVERY_BYTES) await this.prune();
  }

  private async closeLog() {
    await this.flush();
    if (!this.openName || !this.storage) return;
    const m = this.index[this.openName];
    if (m) m.closed = true;
    saveTlogIndex(this.index);
    this.openName = null;
    await this.storage.close().catch(() => {});
    useTlogStore.setState({ active: null, activeBytes: 0 });
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    await this.refreshList();
  }

  private async prune() {
    this.sincePrune = 0;
    await this.refreshList();
    const capBytes = useTlogStore.getState().capMb * 1024 * 1024;
    const logs = Object.values(this.index);
    for (const name of tlogsToPrune(logs, capBytes, this.openName)) {
      await this.storage?.remove(name).catch(() => {});
      delete this.index[name];
    }
    saveTlogIndex(this.index);
    const total = Object.values(this.index).reduce((t, l) => t + l.bytes, 0);
    useTlogStore.setState({ overCap: total > capBytes });
    this.publish();
  }

  /** The list for the UI: copies, so the store never shares objects the recorder changes. */
  private publish() {
    useTlogStore.setState({ logs: Object.values(this.index).map((m) => ({ ...m })).sort((a, b) => b.startMs - a.startMs) });
  }

  private fail(err: unknown) {
    const quota = err instanceof TlogStorageError ? err.quota : (err as any)?.name === 'QuotaExceededError';
    this.stop(quota ? 'Browser storage is full: telemetry logging stopped. Delete old logs or lower the cap.' : `Telemetry logging stopped: ${(err as any)?.message || err}`);
  }

  private stop(message: string) {
    this.recording = false;
    this.queue = [];
    this.queueBytes = 0;
    this.clearPending();
    useTlogStore.setState({ phase: 'stopped', error: message });
    // Close what was written (it is a complete log up to here).
    this.enqueue(() => this.closeLog());
  }
}

export { TLOG_RESUME_GAP_MS };
