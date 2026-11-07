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
}

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

  constructor() {
    mavlinkConnection.onPacket((packet: MavlinkPacket) => {
      this.handlePacket(packet);
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

  private handlePacket(packet: MavlinkPacket) {
    if (!this.status.isFetching || this.status.method !== 'legacy') return;

    if (packet.messageId === MAVLINK_MSG_ID.PARAM_VALUE) {
      const data = decodePayload(packet.messageId, packet.payload);
      this.legacyIndices.add(data.param_index);
      this.legacyExpected = data.param_count || this.legacyExpected;

      const pct = this.legacyExpected > 0 ? Math.round((this.legacyIndices.size / this.legacyExpected) * 100) : 0;
      this.setStatus({
        paramCount: this.legacyIndices.size,
        message: `Streaming params: ${this.legacyIndices.size} / ${this.legacyExpected} (${pct}%)`,
      });

      if (this.legacyTimer) clearTimeout(this.legacyTimer);

      if (this.legacyExpected > 0 && this.legacyIndices.size >= this.legacyExpected) {
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

    this.isCancelled = false;
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

          useTelemetryStore.setState((state) => ({
            parameters: { ...state.parameters, ...unpacked },
          }));

          this.setStatus({
            isFetching: false,
            method: 'ftp',
            paramCount: count,
            hasDefaults,
            message: `Loaded ${count} params${hasDefaults ? ' (with defaults)' : ''} via MAVFTP in ${(duration / 1000).toFixed(1)}s`,
          });
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
  public unpackParamPck(data: Uint8Array): Record<string, { value: number; type: number; index: number; defaultValue?: number }> | null {
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

      let defaultVal: number | undefined = undefined;

      // If flags bit 0 is set, default value is included right after
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
