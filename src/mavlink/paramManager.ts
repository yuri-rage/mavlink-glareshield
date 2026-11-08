import { mavlinkConnection } from './connection';
import { mavFtpClient } from './ftp';
import { useTelemetryStore } from '../store/telemetryStore';
import { MAVLINK_MSG_ID } from './messages';
import { decodePayload, MavlinkPacket } from './parser';

export interface ParamManagerStatus {
  isFetching: boolean;
  method: 'idle' | 'ftp' | 'legacy';
  paramCount: number;
  hasDefaults?: boolean;
  message?: string;
  /**
   * The stored values came from an earlier connection to this vehicle and haven't been refreshed yet (another
   * GCS or the vehicle itself may have changed them since).
   */
  fromPreviousConnection?: boolean;
}

/** One parameter as unpacked from param.pck. */
type ParamEntry = { value: number; type: number; index: number; defaultValue?: number };

export class ParamManager {
  private status: ParamManagerStatus = {
    isFetching: false,
    method: 'idle',
    paramCount: 0,
  };
  private listeners: Set<(status: ParamManagerStatus) => void> = new Set();
  private legacyTimer: any = null;
  private legacyExpected = 0;
  private legacyIndices = new Set<number>();
  private legacyTargetSys = 1;
  private legacyTargetComp = 1;
  private legacyRetries = 0;
  private isCancelled = false;
  /** Names any widget has asked for one at a time, so they aren't mistaken for a downloaded list. */
  private singleReads = new Set<string>();
  /** Firmware default values learned from @PARAM/param.pck?withdefaults=1. */
  private defaults = new Map<string, number>();
  private defaultsTimer: ReturnType<typeof setTimeout> | null = null;
  /** The background list read in progress (see scheduleBackgroundLoad), so a Download can wait for it. */
  private backgroundLoad: Promise<boolean> | null = null;
  /** Vehicles ("sys/comp/type") a background read has been tried for on this connection: once each. */
  private backgroundTried = new Set<string>();
  /** The vehicle ("sysid/type") the stored list belongs to; another vehicle's heartbeat clears it. */
  private listOwner: string | null = null;
  /** When the list's vehicle was last heard. */
  private ownerSeenAt = 0;

  constructor() {
    mavlinkConnection.onPacket((packet: MavlinkPacket) => {
      this.handlePacket(packet);
    });
    // A new connection may be a different vehicle: its defaults and single reads start over.
    // A new connection may be a different vehicle: its defaults and single reads start over. The stored values
    // are kept (a brief link drop to the same vehicle shouldn't empty the table) but flagged as old, and the
    // count is reset so they are read again once the vehicle is heard.
    mavlinkConnection.onStatus((status) => {
      if (status === 'connected') return;
      this.backgroundTried.clear();
      this.defaults.clear();
      this.singleReads.clear();
      if (this.defaultsTimer) {
        clearTimeout(this.defaultsTimer);
        this.defaultsTimer = null;
      }
      const hasValues = Object.keys(useTelemetryStore.getState().parameters).length > 0;
      if (this.status.paramCount > 0 || this.status.isFetching || hasValues) {
        this.setStatus({ isFetching: false, method: 'idle', paramCount: 0, fromPreviousConnection: hasValues });
      }
    });
  }

  public onStatusChange(callback: (status: ParamManagerStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.status);
    return () => this.listeners.delete(callback);
  }

  private setStatus(status: Partial<ParamManagerStatus>) {
    this.status = { ...this.status, ...status };
    this.listeners.forEach((l) => l(this.status));
  }

  private requestMissingLegacyParams() {
    if (this.legacyExpected <= 0 || this.isCancelled) return;
    const missing: number[] = [];
    for (let i = 0; i < this.legacyExpected; i++) {
      if (!this.legacyIndices.has(i)) {
        missing.push(i);
      }
    }

    if (missing.length === 0) {
      if (this.legacyTimer) clearTimeout(this.legacyTimer);
      this.setStatus({
        isFetching: false,
        method: 'idle',
        message: `Loaded all ${this.legacyExpected} params via stream`,
      });
      return;
    }

    if (this.legacyRetries >= 3) {
      console.warn(`[ParamManager] Gave up requesting missing params after 3 retries (${missing.length} missing).`);
      this.setStatus({
        isFetching: false,
        method: 'idle',
        message: `Loaded ${this.legacyIndices.size} / ${this.legacyExpected} params (${missing.length} missed)`,
      });
      return;
    }

    this.legacyRetries++;
    console.log(`[ParamManager] Re-requesting ${missing.length} missing params via PARAM_REQUEST_READ (attempt ${this.legacyRetries})...`);
    this.setStatus({
      message: `Filling gaps: requesting ${missing.length} missing params...`,
    });

    const encoder = mavlinkConnection.getEncoder();
    for (const idx of missing) {
      const req = encoder.createParamRequestRead(this.legacyTargetSys, this.legacyTargetComp, idx);
      mavlinkConnection.send(req);
    }

    if (this.legacyTimer) clearTimeout(this.legacyTimer);
    this.legacyTimer = setTimeout(() => {
      this.requestMissingLegacyParams();
    }, 2500);
  }

  /** "sysid/type" of the vehicle currently heard, or null. */
  private currentVehicleKey(): string | null {
    const hb = useTelemetryStore.getState().heartbeat;
    return hb.lastHeartbeatTime > 0 ? `${hb.systemId}/${hb.type}` : null;
  }

  /** The autopilot's own heartbeat: notices a different vehicle, and refreshes values from an earlier connection. */
  private handleHeartbeat(packet: MavlinkPacket) {
    const type = packet.payload[4];
    const autopilot = packet.payload[5];
    if (packet.componentId !== 1 || autopilot === 8 /* MAV_AUTOPILOT_INVALID */ || type === 6 /* MAV_TYPE_GCS */) return;
    const key = `${packet.systemId}/${type}`;
    const now = Date.now();
    if (key === this.listOwner) this.ownerSeenAt = now;
    // Another vehicle, and the list's own vehicle has gone quiet: it replaced it, so the stored list is not its
    // list. (Two vehicles heard at once on a shared network is not a replacement; the list is kept.)
    if (this.listOwner !== null && key !== this.listOwner && now - this.ownerSeenAt > 5000) {
      this.listOwner = null;
      this.defaults.clear();
      this.singleReads.clear();
      useTelemetryStore.setState({ parameters: {} });
      this.setStatus({ isFetching: false, method: 'idle', paramCount: 0, hasDefaults: false, fromPreviousConnection: false, message: undefined });
      return;
    }
    if (this.status.fromPreviousConnection && mavlinkConnection.getStatus() === 'connected') {
      // Same vehicle back: read the list again in the background (MAVFTP); the Parameters widget also refreshes.
      this.scheduleBackgroundLoad(packet.systemId, packet.componentId);
    }
  }

  private handlePacket(packet: MavlinkPacket) {
    if (packet.messageId === MAVLINK_MSG_ID.HEARTBEAT) {
      this.handleHeartbeat(packet);
      return;
    }
    if (packet.messageId !== MAVLINK_MSG_ID.PARAM_VALUE) return;
    const data = decodePayload(packet.messageId, packet.payload);

    if (!this.status.isFetching || this.status.method !== 'legacy') {
      // Any PARAM_VALUE arriving outside a list download (a single read, write echo, or onboard tune change)
      // is a single parameter update, not a full parameter list.
      if (data?.param_id) {
        const id = String(data.param_id).trim().toUpperCase();
        this.singleReads.add(id);
        const defVal = this.defaults.get(id);
        if (defVal !== undefined) {
          const cur = useTelemetryStore.getState().parameters[id];
          if (cur && cur.defaultValue === undefined) {
            useTelemetryStore.setState((s) => ({
              parameters: { ...s.parameters, [id]: { ...s.parameters[id], defaultValue: defVal } },
            }));
          }
        }
      }
      return;
    }

    this.legacyIndices.add(data.param_index);
    this.legacyExpected = data.param_count || this.legacyExpected;

    const pct = this.legacyExpected > 0 ? Math.round((this.legacyIndices.size / this.legacyExpected) * 100) : 0;
    this.listOwner = this.currentVehicleKey();
    this.ownerSeenAt = Date.now();
    this.setStatus({
      paramCount: this.legacyIndices.size,
      fromPreviousConnection: false,
      message: `Streaming params: ${this.legacyIndices.size} / ${this.legacyExpected} (${pct}%)`,
    });

    if (this.legacyTimer) clearTimeout(this.legacyTimer);

    if (this.legacyExpected > 0 && this.legacyIndices.size >= this.legacyExpected) {
      this.singleReads.clear();
      this.setStatus({
        isFetching: false,
        method: 'idle',
        message: `Loaded all ${this.legacyExpected} params via stream`,
      });
      return;
    }

    // If last index packet arrived or activity paused, check for gaps
    if (this.legacyExpected > 0 && data.param_index + 1 >= this.legacyExpected) {
      this.requestMissingLegacyParams();
      return;
    }

    this.legacyTimer = setTimeout(() => {
      this.requestMissingLegacyParams();
    }, 2500);
  }

  /** Ask the vehicle for one parameter by name (PARAM_REQUEST_READ). Widgets use this, not the encoder directly. */
  public requestParam(sysId: number, compId: number, name: string) {
    const id = name.trim().toUpperCase();
    if (!id) return;
    this.singleReads.add(id);
    mavlinkConnection.send(mavlinkConnection.getEncoder().createParamRequestRead(sysId, compId, -1, id));
    this.scheduleBackgroundLoad(sysId, compId);
  }

  /**
   * Once per vehicle and connection, after a widget reads a single parameter, quietly reads the whole list
   * via MAVFTP (@PARAM/param.pck?withdefaults=1). That one file is the full list with defaults, so it fills
   * the store as a Download would: widgets get defaults, and Parameter set patterns work, without opening the
   * Parameters widget. Not retried on that connection if it fails (no MAVFTP); a Download still falls back to
   * the PARAM_VALUE stream.
   */
  private scheduleBackgroundLoad(sysId: number, compId: number) {
    if (this.backgroundLoad || this.status.isFetching || this.status.paramCount > 0) return;
    if (mavlinkConnection.getStatus() !== 'connected') return;
    const hb = useTelemetryStore.getState().heartbeat;
    // Only once a vehicle is heard: with just the bridge connected the read would fail and use up the try.
    if (!(hb.lastHeartbeatTime > 0 && Date.now() - hb.lastHeartbeatTime < 5000)) return;
    const key = `${sysId}/${compId}/${hb.type}`;
    if (this.backgroundTried.has(key)) return;
    if (this.defaultsTimer) clearTimeout(this.defaultsTimer);
    this.defaultsTimer = setTimeout(() => {
      this.defaultsTimer = null;
      if (this.backgroundLoad || this.status.isFetching || this.backgroundTried.has(key)) return;
      this.backgroundTried.add(key);
      this.backgroundLoad = this.loadListQuietly(sysId, compId).finally(() => {
        this.backgroundLoad = null;
      });
    }, 300);
  }

  /** Stores an unpacked param.pck as the full list. */
  private applyFullList(unpacked: Record<string, ParamEntry>, method: 'ftp', message: string) {
    for (const [k, v] of Object.entries(unpacked)) {
      if (v.defaultValue !== undefined) this.defaults.set(k, v.defaultValue);
    }
    const count = Object.keys(unpacked).length;
    const hasDefaults = Object.values(unpacked).some((p) => p.defaultValue !== undefined);
    useTelemetryStore.setState((state) => ({ parameters: { ...state.parameters, ...unpacked } }));
    this.singleReads.clear();
    this.listOwner = this.currentVehicleKey();
    this.ownerSeenAt = Date.now();
    this.setStatus({ isFetching: false, method, paramCount: count, hasDefaults, message, fromPreviousConnection: false });
    return hasDefaults;
  }

  /** The background read: true when the list was loaded. */
  private async loadListQuietly(sysId: number, compId: number): Promise<boolean> {
    try {
      const startTime = Date.now();
      const pckData = await mavFtpClient.readFile(sysId, compId, '@PARAM/param.pck?withdefaults=1', 239, 1500);
      // No isFetching check: a Download started meanwhile waits for this read and uses its result. A cancel
      // aborts the MAVFTP read, which then returns null.
      if (!pckData || pckData.length < 6) return false;
      const unpacked = this.unpackParamPck(pckData);
      if (!unpacked || Object.keys(unpacked).length === 0) return false;
      const count = Object.keys(unpacked).length;
      this.applyFullList(unpacked, 'ftp', `Loaded ${count} params via MAVFTP in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      return true;
    } catch {
      // MAVFTP unavailable: single reads still work via PARAM_VALUE, without defaults.
      return false;
    }
  }

  /**
   * Whether the parameters in the store (`names`) are more than the ones read one at a time: a full download,
   * or a parameter file loaded into the store. Wildcard patterns need that; single reads only fill exact names.
   */
  public hasParamList(names: Iterable<string>): boolean {
    let any = false;
    for (const n of names) {
      any = true;
      if (!this.singleReads.has(n.toUpperCase())) return true;
    }
    return any && this.status.paramCount > 0;
  }

  public cancelFetch() {
    if (!this.status.isFetching) return;
    this.isCancelled = true;
    if (this.status.method === 'ftp') {
      mavFtpClient.abortCurrent();
    }
    if (this.legacyTimer) {
      clearTimeout(this.legacyTimer);
      this.legacyTimer = null;
    }
    this.setStatus({
      isFetching: false,
      method: 'idle',
      message: 'Parameter fetch cancelled',
    });
  }

  public async fetchParameters(targetSys?: number, targetComp?: number, withDefaults = true) {
    if (mavlinkConnection.getStatus() !== 'connected') {
      console.warn('Cannot fetch parameters: not connected.');
      return;
    }

    if (this.status.isFetching) return;
    if (this.defaultsTimer) {
      clearTimeout(this.defaultsTimer);
      this.defaultsTimer = null;
    }
    this.isCancelled = false;
    // A background read of the same file is already under way: wait for it instead of downloading it twice.
    // Cancel aborts it (MAVFTP abort) like a normal download.
    if (this.backgroundLoad) {
      this.setStatus({ isFetching: true, method: 'ftp', message: 'Downloading params via MAVFTP…' });
      const loaded = await this.backgroundLoad;
      if (loaded || this.isCancelled) return; // loaded, or the user cancelled while waiting
      this.setStatus({ isFetching: false, method: 'idle' });
    }

    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? (hb.systemId > 0 ? hb.systemId : 1);
    const compId = targetComp ?? (hb.componentId > 0 ? hb.componentId : 1);

    const primaryPath = withDefaults ? '@PARAM/param.pck?withdefaults=1' : '@PARAM/param.pck';
    const fallbackPath = withDefaults ? '@PARAM/param.pck' : '@PARAM/param.pck?withdefaults=1';

    this.setStatus({
      isFetching: true,
      method: 'ftp',
      message: `Connecting to MAVFTP (${primaryPath})...`,
    });

    console.log(`[ParamManager] Step 1: Trying MAVFTP on ${primaryPath} (target ${sysId}/${compId})...`);
    const startTime = Date.now();

    const onProgress = (received: number, total: number) => {
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        const recKb = (received / 1024).toFixed(1);
        const totKb = (total / 1024).toFixed(1);
        this.setStatus({
          message: `Downloading params via MAVFTP: ${recKb} / ${totKb} KB (${pct}%)`,
        });
      } else if (received > 0) {
        const recKb = (received / 1024).toFixed(1);
        this.setStatus({
          message: `Downloading params via MAVFTP: ${recKb} KB received...`,
        });
      }
    };

    try {
      let pckData = await mavFtpClient.readFile(sysId, compId, primaryPath, 239, 1500, onProgress);
      if (this.isCancelled) return;

      if (!pckData) {
        console.log(`[ParamManager] Retrying MAVFTP with ${fallbackPath}...`);
        this.setStatus({ message: `Retrying MAVFTP (${fallbackPath})...` });
        pckData = await mavFtpClient.readFile(sysId, compId, fallbackPath, 239, 1500, onProgress);
        if (this.isCancelled) return;
      }

      if (pckData && pckData.length >= 6) {
        this.setStatus({ message: 'Unpacking parameters...' });
        const unpacked = this.unpackParamPck(pckData);
        if (unpacked && Object.keys(unpacked).length > 0) {
          const count = Object.keys(unpacked).length;
          const duration = Date.now() - startTime;
          const hasDefaults = Object.values(unpacked).some((p) => p.defaultValue !== undefined);
          console.log(`[ParamManager] Successfully unpacked ${count} parameters via MAVFTP (hasDefaults=${hasDefaults}) in ${duration}ms!`);
          this.applyFullList(
            unpacked,
            'ftp',
            `Loaded ${count} params${hasDefaults ? ' (with defaults)' : ''} via MAVFTP in ${(duration / 1000).toFixed(1)}s`
          );
          return;
        }
      }
    } catch (err) {
      console.warn('[ParamManager] Error during MAVFTP parameter read:', err);
    }

    if (this.isCancelled) return;

    // Step 2: Fallback to Legacy PARAM_REQUEST_LIST
    console.log('[ParamManager] Step 2: MAVFTP unavailable or failed, falling back to PARAM_REQUEST_LIST...');
    this.fallbackToLegacy(sysId, compId);
  }

  private fallbackToLegacy(targetSys: number, targetComp: number) {
    this.legacyTargetSys = targetSys;
    this.legacyTargetComp = targetComp;
    this.legacyExpected = 0;
    this.legacyIndices.clear();
    this.legacyRetries = 0;
    this.setStatus({
      isFetching: true,
      method: 'legacy',
      message: 'Requesting parameters via PARAM_REQUEST_LIST...',
    });

    const encoder = mavlinkConnection.getEncoder();
    const packet = encoder.createParamRequestList(targetSys, targetComp);
    mavlinkConnection.send(packet);

    if (this.legacyTimer) clearTimeout(this.legacyTimer);
    this.legacyTimer = setTimeout(() => {
      this.requestMissingLegacyParams();
    }, 4000);
  }

  /**
   * Unpacks ArduPilot @PARAM/param.pck binary file format.
   * Header (6 bytes): magic (0x671b), num_params (uint16), total_params (uint16)
   * Followed by variable length blocks:
   *   ptype, plen (2 bytes)
   *   name suffix (name_len bytes)
   *   value (based on ptype)
   */
  public unpackParamPck(data: Uint8Array): Record<string, ParamEntry> | null {
    if (data.length < 6) return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint16(0, true);

    // 0x671b = standard param.pck, 0x671c = param.pck with defaults
    if (magic !== 0x671b && magic !== 0x671c) {
      console.warn(`[ParamManager] Invalid param.pck magic: 0x${magic.toString(16)}, expected 0x671b or 0x671c`);
      return null;
    }

    // Bytes 2-5 hold the parameter counts; the entries are read until the buffer ends instead.
    let offset = 6;
    let lastName = '';
    const result: Record<string, { value: number; type: number; index: number; defaultValue?: number }> = {};
    let count = 0;

    const decoder = new TextDecoder('utf-8');

    while (offset < data.length) {
      // Skip padding zero bytes
      while (offset < data.length && data[offset] === 0) {
        offset++;
      }
      if (offset + 2 > data.length) break;

      const ptypeByte = data[offset];
      const plenByte = data[offset + 1];
      offset += 2;

      const ptype = ptypeByte & 0x0f;
      const flags = (ptypeByte >> 4) & 0x0f;
      const hasDefault = (flags & 0x01) !== 0;

      const commonLen = plenByte & 0x0f;
      const nameLen = ((plenByte >> 4) & 0x0f) + 1;

      if (offset + nameLen > data.length) break;

      const suffix = decoder.decode(data.subarray(offset, offset + nameLen));
      offset += nameLen;

      const name = lastName.slice(0, commonLen) + suffix;
      lastName = name;

      let val = 0;
      let mavType = 9; // MAV_PARAM_TYPE_REAL32
      let valSize = 4;

      if (ptype === 1) {
        // 1 byte int8
        if (offset + 1 > data.length) break;
        val = view.getInt8(offset);
        valSize = 1;
        mavType = 1;
      } else if (ptype === 2) {
        // 2 bytes int16
        if (offset + 2 > data.length) break;
        val = view.getInt16(offset, true);
        valSize = 2;
        mavType = 2;
      } else if (ptype === 3) {
        // 4 bytes int32
        if (offset + 4 > data.length) break;
        val = view.getInt32(offset, true);
        valSize = 4;
        mavType = 4;
      } else if (ptype === 4) {
        // 4 bytes float32
        if (offset + 4 > data.length) break;
        val = view.getFloat32(offset, true);
        valSize = 4;
        mavType = 9;
      } else {
        console.warn(`[ParamManager] Unknown param type ${ptype} at offset ${offset}`);
        break;
      }
      offset += valSize;

      // In 0x671c (withdefaults=1), ArduPilot only sets flags bit 0 (hasDefault) when the current value differs
      // from the default; when the bit is 0, the parameter is at its default value (defaultVal === val).
      let defaultVal: number | undefined = magic === 0x671c ? val : undefined;

      // If flags bit 0 is set, an explicit default value follows right after
      if (hasDefault) {
        if (ptype === 1) {
          if (offset + 1 <= data.length) {
            defaultVal = view.getInt8(offset);
          }
        } else if (ptype === 2) {
          if (offset + 2 <= data.length) {
            defaultVal = view.getInt16(offset, true);
          }
        } else if (ptype === 3) {
          if (offset + 4 <= data.length) {
            defaultVal = view.getInt32(offset, true);
          }
        } else if (ptype === 4) {
          if (offset + 4 <= data.length) {
            defaultVal = view.getFloat32(offset, true);
          }
        }
        offset += valSize;
      }

      result[name] = {
        value: val,
        defaultValue: defaultVal,
        type: mavType,
        index: count,
      };
      count++;
    }

    return result;
  }
}

export const paramManager = new ParamManager();
