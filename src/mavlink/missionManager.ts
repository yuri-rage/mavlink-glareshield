import { mavlinkConnection } from './connection';
import { onActiveVehicleChange } from './vehicleRoster';
import { MAVLINK_MSG_ID, cmdHasLocation } from './messages';
import { decodePayload, MavlinkPacket } from './parser';
import { mavFtpClient } from './ftp';
import { MissionItemIntData } from './encoder';
import { parseDroppedMissionFile, packDatFile, readDat, MissionFileType } from './missionFileParser';
import { useTelemetryStore, applyHomeFromMissionItem0, MissionWaypoint, FencePoint, RallyPoint } from '../store/telemetryStore';

export interface MissionManagerStatus {
  isFetching: boolean;
  isUploading?: boolean;
  method: 'idle' | 'ftp' | 'legacy';
  waypointCount: number;
  fenceCount: number;
  rallyCount: number;
  message?: string;
  uploadProgress?: {
    type: MissionFileType;
    current: number;
    total: number;
    method: 'ftp' | 'legacy';
  };
}

/** MAV_MISSION_RESULT, as words for messages. */
const MISSION_RESULT_TEXT: Record<number, string> = {
  1: 'an error',
  2: 'an unsupported coordinate frame',
  3: 'not supported by the vehicle',
  4: 'not enough space on the vehicle',
  5: 'invalid',
  6: 'an invalid param 1',
  7: 'an invalid param 2',
  8: 'an invalid param 3',
  9: 'an invalid param 4',
  10: 'an invalid param 5 / latitude',
  11: 'an invalid param 6 / longitude',
  12: 'an invalid param 7 / altitude',
  13: 'an item out of sequence',
  14: 'denied',
  15: 'cancelled',
};
export const MAV_MISSION_UNSUPPORTED = 3;
/** MAV_MISSION_RESULT for an item the vehicle didn't request next. */
const MAV_MISSION_INVALID_SEQUENCE = 13;
const RALLY_TYPE = 2;

/** The vehicle said it doesn't take rally points: remember it for this vehicle (cleared on vehicle change). */
function markRallyUnsupported() {
  if (useTelemetryStore.getState().rallySupport !== 'unsupported') useTelemetryStore.setState({ rallySupport: 'unsupported' });
}

export class MissionManager {
  private status: MissionManagerStatus = {
    isFetching: false,
    method: 'idle',
    waypointCount: 0,
    fenceCount: 0,
    rallyCount: 0,
    message: '',
  };

  private isCancelled = false;
  /** The last streamed (MISSION_REQUEST_LIST) read got everything the vehicle reported: its count was reached, or
   *  it reported none. False after a timeout or cancel, whose (possibly empty) result is partial. */
  private lastLegacyComplete = false;
  /** The last fetchRally read the vehicle's rally points completely. An empty list is only "none" when true. */
  public lastRallyReadOk = false;
  /** The last fetchFence read the vehicle's fence completely (see lastRallyReadOk). */
  public lastFenceReadOk = false;
  /** MAV_MISSION_RESULT the vehicle rejected the last streamed upload with, or null (accepted, or no answer). */
  private lastUploadRejection: number | null = null;
  private legacyAbort: (() => void) | null = null;
  private messageClearTimer: any = null;
  private listeners: Set<(isFetching: boolean, count?: number, method?: string, status?: MissionManagerStatus) => void> = new Set();
  private statusListeners: Set<(status: MissionManagerStatus) => void> = new Set();

  public scheduleMessageClear(delayMs = 5000) {
    if (this.messageClearTimer) {
      clearTimeout(this.messageClearTimer);
    }
    this.messageClearTimer = setTimeout(() => {
      this.messageClearTimer = null;
      if (!this.status.isFetching && !this.status.isUploading) {
        this.setStatus({ message: '' });
      }
    }, delayMs);
  }

  public cancelFetch() {
    if (!this.status.isFetching) return;
    this.isCancelled = true;
    mavFtpClient.abortCurrent();
    if (this.legacyAbort) {
      this.legacyAbort();
      this.legacyAbort = null;
    }
    this.setStatus({
      isFetching: false,
      method: 'idle',
      message: 'Mission & fence sync cancelled',
    });
    this.scheduleMessageClear(3500);
  }

  /**
   * Stop any transfer (download or upload) at once: another vehicle is now active. What was sent of an upload may
   * have reached the old vehicle; the message says the transfer stopped.
   */
  public stopForVehicleSwitch() {
    if (!this.status.isFetching && !this.status.isUploading) return;
    this.isCancelled = true;
    mavFtpClient.abortCurrent();
    if (this.legacyAbort) {
      this.legacyAbort();
      this.legacyAbort = null;
    }
    this.setStatus({ isFetching: false, isUploading: false, method: 'idle', uploadProgress: undefined, message: 'Mission transfer stopped: switched to another vehicle' });
    this.scheduleMessageClear(6000);
  }

  public onStateChange(listener: (isFetching: boolean, count?: number, method?: string, status?: MissionManagerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status.isFetching, this.status.waypointCount, this.status.method, this.status);
    return () => this.listeners.delete(listener);
  }

  /** The current status (what's under way). */
  public getStatus() {
    return this.status;
  }

  public onStatusChange(listener: (status: MissionManagerStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(patch: Partial<MissionManagerStatus>) {
    if (patch.isFetching || patch.isUploading) {
      if (this.messageClearTimer) {
        clearTimeout(this.messageClearTimer);
        this.messageClearTimer = null;
      }
    }
    this.status = { ...this.status, ...patch };
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l(this.status.isFetching, this.status.waypointCount, this.status.method, this.status));
    this.statusListeners.forEach((l) => l(this.status));
  }

  /**
   * Universal sequential MAVLink Mission protocol uploader for a specific mission_type.
   * missionType: 0 = Waypoints, 1 = Geofence, 2 = Rally points.
   */
  public uploadLegacyItems(
    missionType: number,
    items: MissionItemIntData[],
    targetSys: number,
    targetComp: number,
    timeoutMs = 2000,
    onProgress?: (sent: number, total: number) => void
  ): Promise<boolean> {
    this.lastUploadRejection = null;
    if (this.isCancelled) return Promise.resolve(false);

    return new Promise((resolve) => {
      let isDone = false;
      let retryCount = 0;
      let timer: any = null;
      const encoder = mavlinkConnection.getEncoder();

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
      };

      const finish = (success: boolean) => {
        if (isDone) return;
        isDone = true;
        this.legacyAbort = null;
        cleanup();
        resolve(success);
      };

      this.legacyAbort = () => {
        if (isDone) return;
        console.log(`[MissionManager] Legacy upload for type=${missionType} cancelled.`);
        finish(false);
      };

      const setTimer = (fn: () => void, ms = timeoutMs) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (isDone) return;
          if (retryCount < 3) {
            retryCount++;
            console.log(`[MissionManager] Retrying legacy upload for type=${missionType} (attempt ${retryCount + 1})...`);
            fn();
          } else {
            console.warn(`[MissionManager] Timeout waiting for legacy upload type=${missionType}.`);
            finish(false);
          }
        }, ms);
      };

      const sendItem = (seq: number) => {
        if (isDone) return;
        const item = items.find((it) => it.seq === seq) || items[seq];
        if (!item) {
          console.warn(`[MissionManager] Requested item seq ${seq} not found in upload list (size ${items.length}).`);
          finish(false);
          return;
        }

        const itemPacket = encoder.createMissionItemInt(targetSys, targetComp, {
          ...item,
          seq,
          mission_type: missionType,
        });
        mavlinkConnection.send(itemPacket);
        if (onProgress) {
          onProgress(seq + 1, items.length);
        }
        setTimer(() => sendItem(seq));
      };

      const sendCount = () => {
        const countPacket = encoder.createMissionCount(targetSys, targetComp, items.length, missionType);
        mavlinkConnection.send(countPacket);
        setTimer(sendCount);
      };

      const unsubscribe = mavlinkConnection.onPacket((packet: MavlinkPacket) => {
        if (isDone) return;

        if (
          packet.messageId === MAVLINK_MSG_ID.MISSION_REQUEST_INT ||
          packet.messageId === MAVLINK_MSG_ID.MISSION_REQUEST
        ) {
          const data = decodePayload(packet.messageId, packet.payload);
          const packetType = data.mission_type ?? 0;
          if (packetType !== missionType) return;

          retryCount = 0;
          const reqSeq = data.seq;
          sendItem(reqSeq);
        } else if (packet.messageId === MAVLINK_MSG_ID.MISSION_ACK) {
          const data = decodePayload(packet.messageId, packet.payload);
          const packetType = data.mission_type ?? 0;
          if (packetType !== missionType) return;

          // MAV_MISSION_INVALID_SEQUENCE is not the end of the upload. ArduPilot sends it for an item it didn't ask
          // for next, typically a duplicate: it may request an item twice, and a slow answer to MISSION_COUNT makes
          // us resend the count; the extra copies of the item it just took are refused while it carries on
          // requesting the next one (seen against SITL while armed in AUTO). Ignore it; a real stall still ends in
          // the retry timeouts.
          if (data.type === MAV_MISSION_INVALID_SEQUENCE) {
            console.warn(`[MissionManager] Vehicle refused an out-of-sequence item for type=${missionType} (a duplicate); continuing.`);
            return;
          }

          retryCount = 0;
          if (data.type === 0) {
            console.log(`[MissionManager] Vehicle accepted all ${items.length} items for mission_type=${missionType}!`);
            if (missionType === RALLY_TYPE) useTelemetryStore.setState({ rallySupport: 'supported' });
            finish(true);
          } else {
            console.warn(`[MissionManager] Vehicle rejected mission upload for type=${missionType} with ACK code ${data.type}`);
            this.lastUploadRejection = data.type;
            if (missionType === RALLY_TYPE && data.type === MAV_MISSION_UNSUPPORTED) markRallyUnsupported();
            finish(false);
          }
        }
      });

      sendCount();
    });
  }

  private updateStoreItems(type: 'mission' | 'fence' | 'rally', items: MissionItemIntData[]) {
    if (type === 'mission') {
      const wps: MissionWaypoint[] = items.map((it) => ({
        seq: it.seq,
        command: it.command,
        lat: it.x ?? 0,
        lon: it.y ?? 0,
        alt: it.z ?? 0,
        current: Boolean(it.current),
        frame: it.frame ?? 3,
        param1: it.param1,
        param2: it.param2,
        param3: it.param3,
        param4: it.param4,
        autocontinue: typeof it.autocontinue === 'boolean' ? (it.autocontinue ? 1 : 0) : it.autocontinue,
      }));
      useTelemetryStore.setState({ missionWaypoints: wps });
    } else if (type === 'fence') {
      const fps: FencePoint[] = items.map((it) => {
        const isCircle = it.command === 5004 || it.command === 5005 || (it.command === 5003 && (it.param1 ?? 0) > 0);
        const isInclusion = it.command === 5001 || it.command === 5005 || (it.command === 5003 && (it.param1 ?? 0) > 0);
        return {
          seq: it.seq,
          command: it.command,
          lat: it.x ?? 0,
          lon: it.y ?? 0,
          alt: it.z ?? 0,
          param1: it.param1,
          vertexCount: !isCircle ? Math.round(it.param1 ?? 0) : undefined,
          radius: isCircle ? it.param1 : undefined,
          inclusion: isInclusion,
        };
      });
      useTelemetryStore.setState({ fencePoints: fps });
    } else if (type === 'rally') {
      const rps: RallyPoint[] = items.map((it) => ({
        seq: it.seq,
        lat: it.x ?? 0,
        lon: it.y ?? 0,
        alt: it.z ?? 0,
        frame: it.frame,
      }));
      useTelemetryStore.setState({ rallyPoints: rps });
    }
  }

  /**
   * Uploads an individual section (mission, fence, or rally) via MAVFTP with item-by-item fallback.
   */
  public async uploadSection(
    type: 'mission' | 'fence' | 'rally',
    missionType: number,
    items: MissionItemIntData[],
    rawDat?: Uint8Array,
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; method: 'ftp' | 'legacy'; error?: string }> {
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? (hb.systemId > 0 ? hb.systemId : 1);
    const compId = targetComp ?? (hb.componentId > 0 ? hb.componentId : 1);
    const typeName = type === 'mission' ? 'Mission' : type === 'fence' ? 'Geofence' : 'Rally points';
    const ftpPath = type === 'mission' ? '@MISSION/mission.dat' : type === 'fence' ? '@MISSION/fence.dat' : '@MISSION/rally.dat';

    // Not a mission over MAVFTP while armed in AUTO / AUTO_RTL. ArduPilot's mission.dat upload clears the mission first,
    // but AP_Mission::clear() refuses while armed with the mission running, and the items are then written by index: a
    // shorter mission leaves the old mission's last items behind (AP_Filesystem_Mission::finish_upload_mission). The
    // item-by-item protocol truncates to the new count whatever the state (MissionItemProtocol_Waypoints::truncate).
    // Every vehicle stops its mission on leaving AUTO (ModeAuto::exit; Sub's exit_mode), so in other modes clear()
    // works and MAVFTP is safe. A mode the app doesn't recognise (named by number, e.g. COPTER_31) might be one
    // running the mission: treat it as running. A switch into AUTO during a MAVFTP upload can still beat the clear;
    // the read-back after the upload reports that as not verified.
    const unrecognisedMode = /_\d+$/.test(hb.modeName);
    const missionRunningMode = hb.modeName === 'AUTO' || hb.modeName === 'AUTO_RTL' || unrecognisedMode;
    const useFtp = !(type === 'mission' && hb.isArmed && missionRunningMode);

    this.setStatus({
      isUploading: true,
      method: useFtp ? 'ftp' : 'legacy',
      message: useFtp
        ? `Uploading ${typeName} (${items.length} items) via MAVFTP...`
        : `Uploading ${typeName} item-by-item (armed in ${hb.modeName})...`,
      uploadProgress: {
        type,
        current: 0,
        total: items.length,
        method: useFtp ? 'ftp' : 'legacy',
      },
    });

    // 1. Try fast MAVFTP
    let ftpSuccess = false;
    const datBuffer = rawDat || packDatFile(items, missionType);

    if (useFtp) {
      try {
        console.log(`[MissionManager] Attempting MAVFTP upload to ${ftpPath} (${datBuffer.length} bytes)...`);
        ftpSuccess = await mavFtpClient.writeFile(
          sysId,
          compId,
          ftpPath,
          datBuffer,
          239,
          1500,
          (written, total) => {
            const pct = total > 0 ? Math.round((written / total) * 100) : 0;
            this.setStatus({
              message: `MAVFTP Upload: ${(written / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB (${pct}%)`,
            });
          }
        );
      } catch (err) {
        console.warn(`[MissionManager] MAVFTP upload failed with exception:`, err);
        ftpSuccess = false;
      }
    }

    if (ftpSuccess) {
      console.log(`[MissionManager] MAVFTP upload to ${ftpPath} succeeded and verified!`);
      this.updateStoreItems(type, items);
      return { success: true, method: 'ftp' };
    }

    // 2. Fall back to MAVLink item-by-item protocol
    if (useFtp) {
      console.warn(`[MissionManager] MAVFTP upload unavailable or rejected for ${typeName}, falling back to legacy item-by-item stream...`);
    } else {
      console.log(`[MissionManager] Vehicle armed in ${hb.modeName}: uploading the ${typeName.toLowerCase()} item-by-item, not via MAVFTP.`);
    }
    this.setStatus({
      isUploading: true,
      method: 'legacy',
      message: `Uploading ${typeName} via MAVLink item-by-item (0 / ${items.length})...`,
      uploadProgress: {
        type,
        current: 0,
        total: items.length,
        method: 'legacy',
      },
    });

    const legacySuccess = await this.uploadLegacyItems(
      missionType,
      items,
      sysId,
      compId,
      2000,
      (sent, total) => {
        this.setStatus({
          message: `Uploading ${typeName} item-by-item: ${sent} / ${total}`,
          uploadProgress: {
            type,
            current: sent,
            total,
            method: 'legacy',
          },
        });
      }
    );

    if (legacySuccess) {
      console.log(`[MissionManager] Legacy item-by-item upload for ${typeName} completed successfully!`);
      this.updateStoreItems(type, items);
      return { success: true, method: 'legacy' };
    }

    // Say why: a refusal names the vehicle's reason; only silence is "did not acknowledge".
    const code = this.lastUploadRejection;
    const errMsg =
      code !== null
        ? code === MAV_MISSION_UNSUPPORTED
          ? `${type === 'mission' ? 'Missions' : type === 'fence' ? 'Geofences' : 'Rally points'} are not supported by this vehicle.`
          : `The vehicle rejected the ${typeName.toLowerCase()}: ${MISSION_RESULT_TEXT[code] ?? `result ${code}`}.`
        : `Failed to upload ${typeName} to vehicle. Vehicle did not acknowledge transfer.`;
    return { success: false, method: 'legacy', error: errMsg };
  }

  /** Show a message in the map's status line, cleared after `clearMs`. */
  public report(message: string, clearMs = 6000) {
    this.setStatus({ message });
    this.scheduleMessageClear(clearMs);
  }

  /**
   * Upload a mission (seq 0 = home first) and then download it again, so the caller can check what the vehicle
   * actually holds. `readBack` is what the vehicle sent; it is empty when the read failed.
   */
  public uploadMissionAndReadBack(
    items: MissionItemIntData[],
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; method: 'ftp' | 'legacy'; readBack: MissionWaypoint[]; readOk: boolean; error?: string }> {
    // A mission always reads back at least home, so an empty read-back already means the read failed.
    return this.uploadAndReadBack(
      'mission',
      0,
      items,
      async (sys, comp) => {
        const wps = await this.fetchWaypoints(sys, comp);
        return { items: wps, ok: wps.length > 0 };
      },
      targetSys,
      targetComp
    );
  }

  /**
   * Upload rally points (mission_type 2) and download them again, like uploadMissionAndReadBack. An empty
   * `readBack` after uploading points means the read failed; after uploading none, that the vehicle has none.
   */
  public uploadRallyAndReadBack(
    items: MissionItemIntData[],
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; method: 'ftp' | 'legacy'; readBack: RallyPoint[]; readOk: boolean; error?: string }> {
    return this.uploadAndReadBack(
      'rally',
      2,
      items,
      async (sys, comp) => {
        const points = await this.fetchRally(sys, comp);
        return { items: points, ok: this.lastRallyReadOk };
      },
      targetSys,
      targetComp
    );
  }

  /**
   * Upload a geofence (mission_type 1) and download it again, like the rally points: an empty `readBack` is the
   * vehicle's answer only when `readOk` (the read completed).
   */
  public uploadFenceAndReadBack(
    items: MissionItemIntData[],
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; method: 'ftp' | 'legacy'; readBack: FencePoint[]; readOk: boolean; error?: string }> {
    return this.uploadAndReadBack(
      'fence',
      1,
      items,
      async (sys, comp) => {
        const points = await this.fetchFence(sys, comp);
        return { items: points, ok: this.lastFenceReadOk };
      },
      targetSys,
      targetComp
    );
  }

  private async uploadAndReadBack<T>(
    type: 'mission' | 'rally' | 'fence',
    missionType: number,
    items: MissionItemIntData[],
    read: (sysId: number, compId: number) => Promise<{ items: T[]; ok: boolean }>,
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; method: 'ftp' | 'legacy'; readBack: T[]; readOk: boolean; error?: string }> {
    const name = type === 'mission' ? 'Mission' : type === 'fence' ? 'Geofence' : 'Rally points';
    if (this.status.isFetching || this.status.isUploading) {
      return { success: false, method: 'legacy', readBack: [], readOk: false, error: 'A mission transfer is already in progress.' };
    }
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? (hb.systemId > 0 ? hb.systemId : 1);
    const compId = targetComp ?? (hb.componentId > 0 ? hb.componentId : 1);
    this.isCancelled = false;

    try {
      const res = await this.uploadSection(type, missionType, items, undefined, sysId, compId);
      if (!res.success) {
        this.setStatus({ message: res.error || `${name} upload failed.` });
        this.scheduleMessageClear(8000);
        return { success: false, method: res.method, readBack: [], readOk: false, error: res.error };
      }

      this.setStatus({
        isUploading: false,
        isFetching: true,
        method: 'ftp',
        uploadProgress: undefined,
        message: `Reading the ${type === 'mission' ? 'mission' : type === 'fence' ? 'geofence' : 'rally points'} back from the vehicle...`,
      });
      const { items: readBack, ok: readOk } = await read(sysId, compId);
      if (!readOk) {
        // The read failed. The vehicle acknowledged the upload, so keep showing what was uploaded rather than a
        // partial list or nothing.
        this.updateStoreItems(type, items);
      }
      if (type === 'mission') this.setStatus({ waypointCount: readBack.length });
      else if (type === 'fence') this.setStatus({ fenceCount: readBack.length });
      else this.setStatus({ rallyCount: readBack.length });
      return { success: true, method: res.method, readBack, readOk };
    } catch (err: any) {
      const error = `${name} upload failed: ${err?.message || err}`;
      this.setStatus({ message: error });
      this.scheduleMessageClear(8000);
      return { success: false, method: 'legacy', readBack: [], readOk: false, error };
    } finally {
      // Whatever happened, the transfer is over: never leave the map stuck "in progress".
      this.setStatus({ isUploading: false, isFetching: false, method: 'idle', uploadProgress: undefined });
    }
  }

  /**
   * Uploads dropped file (mission, fence, rally, or full multi-section plan) via MAVFTP with item-by-item fallback.
   */
  public async uploadFile(
    filename: string,
    buffer: Uint8Array,
    targetSys?: number,
    targetComp?: number
  ): Promise<{ success: boolean; type: MissionFileType; count: number; method: 'ftp' | 'legacy'; error?: string }> {
    let parsed;
    try {
      parsed = parseDroppedMissionFile(filename, buffer);
    } catch (err: any) {
      return {
        success: false,
        type: 'mission',
        count: 0,
        method: 'idle' as any,
        error: err?.message || 'Failed to parse mission file.',
      };
    }

    if (!parsed || parsed.items.length === 0) {
      return {
        success: false,
        type: 'mission',
        count: 0,
        method: 'idle' as any,
        error: 'Unable to parse file. Format not recognized or empty.',
      };
    }

    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? (hb.systemId > 0 ? hb.systemId : 1);
    const compId = targetComp ?? (hb.componentId > 0 ? hb.componentId : 1);
    this.isCancelled = false;

    // Handle multi-section QGC .plan files
    if (parsed.sections && parsed.sections.length > 0) {
      let finalMethod: 'ftp' | 'legacy' = 'ftp';
      let totalCount = 0;

      for (const section of parsed.sections) {
        if (this.isCancelled) {
          return { success: false, type: parsed.type, count: totalCount, method: finalMethod, error: 'Upload cancelled.' };
        }
        const res = await this.uploadSection(section.type, section.missionType, section.items, section.rawDat, sysId, compId);
        if (!res.success) {
          this.setStatus({
            isUploading: false,
            method: 'idle',
            message: res.error || `Failed to upload ${section.type}`,
            uploadProgress: undefined,
          });
          return {
            success: false,
            type: parsed.type,
            count: totalCount,
            method: res.method,
            error: res.error,
          };
        }
        if (res.method === 'legacy') finalMethod = 'legacy';
        totalCount += section.items.length;
      }

      this.setStatus({
        isUploading: false,
        method: 'idle',
        message: `Plan uploaded successfully (${totalCount} total items across ${parsed.sections.length} sections)!`,
        uploadProgress: undefined,
      });

      return {
        success: true,
        type: parsed.type,
        count: totalCount,
        method: finalMethod,
      };
    }

    // Single section upload
    const sectionType = parsed.type === 'plan' ? 'mission' : parsed.type;
    const res = await this.uploadSection(sectionType, parsed.missionType, parsed.items, parsed.rawDat, sysId, compId);

    this.setStatus({
      isUploading: false,
      method: 'idle',
      message: res.success
        ? `${parsed.type} (${parsed.items.length} items) uploaded successfully!`
        : res.error || `Failed to upload ${parsed.type}`,
      uploadProgress: undefined,
    });
    this.scheduleMessageClear(5000);

    return {
      success: res.success,
      type: parsed.type,
      count: parsed.items.length,
      method: res.method,
      error: res.error,
    };
  }

  /**
   * Universal sequential MAVLink Mission protocol downloader for a specific mission_type.
   * missionType: 0 = Waypoints, 1 = Geofence, 2 = Rally points.
   */
  public fetchLegacyItems(missionType: number, targetSys: number, targetComp: number, timeoutMs = 2000): Promise<any[]> {
    if (this.isCancelled) return Promise.resolve([]);

    this.lastLegacyComplete = false;
    return new Promise((resolve) => {
      let isDone = false;
      let expectedCount = 0;
      let retryCount = 0;
      let timer: any = null;
      const items: any[] = [];
      const encoder = mavlinkConnection.getEncoder();

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        unsubscribe();
      };

      const finish = (result: any[]) => {
        if (isDone) return;
        isDone = true;
        this.legacyAbort = null;
        cleanup();
        resolve(result);
      };

      this.legacyAbort = () => {
        if (isDone) return;
        console.log(`[MissionManager] Legacy stream for type=${missionType} cancelled.`);
        finish(items);
      };

      const setTimer = (fn: () => void, ms = timeoutMs) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          if (isDone) return;
          if (retryCount < 2) {
            retryCount++;
            console.log(`[MissionManager] Retrying legacy request for type=${missionType} (attempt ${retryCount + 1})...`);
            fn();
          } else {
            console.warn(`[MissionManager] Timeout waiting for legacy items type=${missionType}.`);
            finish(items);
          }
        }, ms);
      };

      const requestSeq = (seq: number) => {
        if (isDone) return;
        // Always use MISSION_REQUEST_INT (Msg 51). ArduPilot warns and deprecates MISSION_REQUEST (Msg 40).
        const reqInt = encoder.createMissionRequestInt(targetSys, targetComp, seq, missionType);
        mavlinkConnection.send(reqInt);
        setTimer(() => requestSeq(seq));
      };

      const sendReqList = () => {
        const reqList = encoder.createMissionRequestList(targetSys, targetComp, missionType);
        mavlinkConnection.send(reqList);
        setTimer(sendReqList);
      };

      const unsubscribe = mavlinkConnection.onPacket((packet: MavlinkPacket) => {
        if (isDone) return;

        // A refusal (e.g. MAV_MISSION_UNSUPPORTED for rally points on a vehicle without them) is the vehicle's
        // answer: stop now instead of waiting out every retry. Still not a complete read.
        if (packet.messageId === MAVLINK_MSG_ID.MISSION_ACK) {
          const data = decodePayload(packet.messageId, packet.payload);
          if ((data.mission_type ?? 0) !== missionType || data.type === 0) return;
          console.warn(`[MissionManager] Vehicle refused the download for mission_type=${missionType} with ACK code ${data.type}`);
          if (missionType === RALLY_TYPE && data.type === MAV_MISSION_UNSUPPORTED) markRallyUnsupported();
          finish(items);
          return;
        }

        if (packet.messageId === MAVLINK_MSG_ID.MISSION_COUNT) {
          const data = decodePayload(packet.messageId, packet.payload);
          const packetType = data.mission_type ?? 0;
          if (packetType !== missionType) return;

          retryCount = 0;
          expectedCount = data.count;
          console.log(`[MissionManager] Vehicle reported MISSION_COUNT=${expectedCount} for mission_type=${missionType}`);

          if (expectedCount === 0) {
            const ack = encoder.createMissionAck(targetSys, targetComp, 0, missionType);
            mavlinkConnection.send(ack);
            this.lastLegacyComplete = true;
            finish([]);
            return;
          }

          requestSeq(0);
        } else if (
          packet.messageId === MAVLINK_MSG_ID.MISSION_ITEM_INT ||
          packet.messageId === MAVLINK_MSG_ID.MISSION_ITEM
        ) {
          const data = decodePayload(packet.messageId, packet.payload);
          const packetType = data.mission_type ?? 0;
          if (packetType !== missionType) return;

          retryCount = 0;

          // Strictly deduplicate by sequence number
          const existingIdx = items.findIndex((it) => it.seq === data.seq);
          if (existingIdx >= 0) {
            if (packet.messageId === MAVLINK_MSG_ID.MISSION_ITEM_INT) {
              items[existingIdx] = data;
            }
          } else {
            items.push(data);
          }

          const pct = expectedCount > 0 ? Math.round((items.length / expectedCount) * 100) : 0;
          const typeName = missionType === 0 ? 'WP' : missionType === 1 ? 'Fence point' : 'Rally point';
          this.setStatus({
            message: `Streaming ${typeName} ${items.length} / ${expectedCount} (${pct}%)`,
          });

          if (items.length >= expectedCount) {
            items.sort((a, b) => a.seq - b.seq);
            console.log(`[MissionManager] Successfully streamed all ${items.length} items for mission_type=${missionType}`);
            const ack = encoder.createMissionAck(targetSys, targetComp, 0, missionType);
            mavlinkConnection.send(ack);
            this.lastLegacyComplete = true;
            finish(items);
          } else {
            // Find next missing sequence number
            const receivedSeqs = new Set(items.map((it) => it.seq));
            let nextMissing = 0;
            while (receivedSeqs.has(nextMissing) && nextMissing < expectedCount) {
              nextMissing++;
            }
            if (nextMissing < expectedCount) {
              requestSeq(nextMissing);
            }
          }
        }
      });

      sendReqList();
    });
  }

  /**
   * Fetches mission waypoints (MAVFTP -> fallback sequential stream)
   */
  public async fetchWaypoints(sysId: number, compId: number): Promise<MissionWaypoint[]> {
    if (this.isCancelled) return [];
    this.setStatus({ message: 'Downloading waypoints via MAVFTP (@MISSION/mission.dat)...' });

    const onProgress = (received: number, total: number) => {
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        this.setStatus({ message: `MAVFTP Waypoints: ${(received / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB (${pct}%)` });
      } else if (received > 0) {
        this.setStatus({ message: `MAVFTP Waypoints: ${(received / 1024).toFixed(1)} KB received...` });
      }
    };

    // 1. Try fast MAVFTP
    try {
      let datData = await mavFtpClient.readFile(sysId, compId, '@MISSION/mission.dat', 239, 1500, onProgress);
      if (this.isCancelled) return [];

      if (!datData) {
        datData = await mavFtpClient.readFile(sysId, compId, 'mission.dat', 239, 1500, onProgress);
        if (this.isCancelled) return [];
      }

      if (datData && datData.length >= 10) {
        const unpacked = this.unpackMissionDat(datData);
        if (unpacked !== null) {
          console.log(`[MissionManager] Successfully unpacked ${unpacked.length} waypoints via MAVFTP!`);
          useTelemetryStore.setState({ missionWaypoints: unpacked });
          applyHomeFromMissionItem0(unpacked);
          this.setStatus({ waypointCount: unpacked.length });
          return unpacked;
        }
      }
    } catch (err) {
      console.warn('[MissionManager] MAVFTP waypoint read failed:', err);
    }

    if (this.isCancelled) return [];

    // 2. Fall back to MAVLink mission stream
    console.log('[MissionManager] MAVFTP mission.dat unavailable, streaming waypoints via MISSION_REQUEST_LIST...');
    this.setStatus({ method: 'legacy', message: 'Streaming waypoints via MAVLink...' });
    const legacyItems = await this.fetchLegacyItems(0, sysId, compId);
    if (this.isCancelled) return [];

    const waypoints: MissionWaypoint[] = legacyItems.map((data) => ({
      seq: data.seq,
      command: data.command,
      lat: data.x,
      lon: data.y,
      alt: data.z,
      current: data.current === 1,
      frame: data.frame,
      param1: data.param1,
      param2: data.param2,
      param3: data.param3,
      param4: data.param4,
      autocontinue: data.autocontinue,
    }));

    waypoints.sort((a, b) => a.seq - b.seq);
    useTelemetryStore.setState({ missionWaypoints: waypoints });
    this.setStatus({ waypointCount: waypoints.length });
    return waypoints;
  }

  /**
   * Fetches geofence items (MAVFTP -> fallback sequential stream -> fallback parameter fence)
   */
  public async fetchFence(sysId: number, compId: number): Promise<FencePoint[]> {
    this.lastFenceReadOk = false;
    if (this.isCancelled) return [];
    this.setStatus({ message: 'Checking geofence via MAVFTP (@MISSION/fence.dat)...' });

    const onProgress = (received: number, total: number) => {
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        this.setStatus({ message: `MAVFTP Fence: ${(received / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB (${pct}%)` });
      }
    };

    // 1. Try fast MAVFTP
    try {
      let fenceData = await mavFtpClient.readFile(sysId, compId, '@MISSION/fence.dat', 239, 1500, onProgress);
      if (this.isCancelled) return [];

      if (!fenceData) {
        fenceData = await mavFtpClient.readFile(sysId, compId, 'fence.dat', 239, 1500, onProgress);
        if (this.isCancelled) return [];
      }

      if (fenceData && fenceData.length >= 10) {
        const unpacked = this.unpackFenceDat(fenceData);
        if (unpacked !== null) {
          console.log(`[MissionManager] Successfully unpacked ${unpacked.length} fence items via MAVFTP!`);
          useTelemetryStore.setState({ fencePoints: unpacked });
          this.setStatus({ fenceCount: unpacked.length });
          this.lastFenceReadOk = true;
          return unpacked;
        }
      }
    } catch (err) {
      console.warn('[MissionManager] MAVFTP fence.dat read error:', err);
    }

    if (this.isCancelled) return [];

    // 2. Fall back to MAVLink mission protocol (mission_type = 1)
    console.log('[MissionManager] MAVFTP fence.dat not found, requesting fence via MISSION_REQUEST_LIST(type=1)...');
    this.setStatus({ method: 'legacy', message: 'Requesting geofence via MAVLink stream...' });
    const legacyFence = await this.fetchLegacyItems(1, sysId, compId);
    if (this.isCancelled) return [];
    if (!this.lastLegacyComplete) {
      // Timed out or cancelled: what arrived (maybe nothing) is not the vehicle's fence. Keep the one the map shows,
      // and return it so a caller's count agrees; lastFenceReadOk stays false.
      console.warn('[MissionManager] Fence stream incomplete; keeping the fence already known.');
      return useTelemetryStore.getState().fencePoints;
    }

    if (legacyFence && legacyFence.length > 0) {
      const fencePoints: FencePoint[] = legacyFence.map((data) => {
        const isCircle = data.command === 5004 || data.command === 5005 || (data.command === 5003 && data.param1 > 0);
        const isInclusion = data.command === 5001 || data.command === 5005 || (data.command === 5003 && data.param1 > 0);
        return {
          seq: data.seq,
          command: data.command,
          lat: data.x,
          lon: data.y,
          alt: data.z,
          param1: data.param1,
          radius: isCircle ? data.param1 : undefined,
          vertexCount: !isCircle ? Math.round(data.param1) : undefined,
          inclusion: isInclusion,
        };
      });

      fencePoints.sort((a, b) => a.seq - b.seq);
      console.log(`[MissionManager] Successfully downloaded ${fencePoints.length} fence points via MAVLink stream!`);
      useTelemetryStore.setState({ fencePoints });
      this.setStatus({ fenceCount: fencePoints.length });
      this.lastFenceReadOk = true;
      return fencePoints;
    }
    // A complete read of no items: the vehicle has no fence.
    useTelemetryStore.setState({ fencePoints: [] });
    this.setStatus({ fenceCount: 0 });
    this.lastFenceReadOk = true;
    return [];
  }

  /**
   * Fetches rally points (MAVFTP -> fallback sequential stream)
   */
  public async fetchRally(sysId: number, compId: number): Promise<RallyPoint[]> {
    this.lastRallyReadOk = false;
    if (this.isCancelled) return [];
    if (useTelemetryStore.getState().rallySupport === 'unsupported') {
      // The vehicle has told us it has none to give; asking again would only wait out the timeouts.
      return [];
    }
    this.setStatus({ message: 'Checking rally points via MAVFTP (@MISSION/rally.dat)...' });

    const onProgress = (received: number, total: number) => {
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        this.setStatus({ message: `MAVFTP Rally: ${(received / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} KB (${pct}%)` });
      }
    };

    // 1. Try fast MAVFTP
    try {
      let rallyData = await mavFtpClient.readFile(sysId, compId, '@MISSION/rally.dat', 239, 1500, onProgress);
      if (this.isCancelled) return [];

      if (!rallyData) {
        rallyData = await mavFtpClient.readFile(sysId, compId, 'rally.dat', 239, 1500, onProgress);
        if (this.isCancelled) return [];
      }

      if (rallyData && rallyData.length >= 10) {
        const unpacked = this.unpackRallyDat(rallyData);
        if (unpacked !== null) {
          console.log(`[MissionManager] Successfully unpacked ${unpacked.length} rally points via MAVFTP!`);
          useTelemetryStore.setState({ rallyPoints: unpacked, ...(unpacked.length > 0 ? { rallySupport: 'supported' as const } : {}) });
          this.setStatus({ rallyCount: unpacked.length });
          this.lastRallyReadOk = true;
          return unpacked;
        }
      }
    } catch (err) {
      console.warn('[MissionManager] MAVFTP rally.dat read error:', err);
    }

    if (this.isCancelled) return [];

    // 2. Fall back to MAVLink mission protocol (mission_type = 2)
    console.log('[MissionManager] MAVFTP rally.dat not found, requesting rally points via MISSION_REQUEST_LIST(type=2)...');
    this.setStatus({ method: 'legacy', message: 'Requesting rally points via MAVLink stream...' });
    const legacyRally = await this.fetchLegacyItems(2, sysId, compId);
    if (this.isCancelled) return [];

    const rallyPoints: RallyPoint[] = legacyRally.map((data) => ({
      seq: data.seq,
      lat: data.x,
      lon: data.y,
      alt: data.z,
      frame: data.frame,
    }));

    rallyPoints.sort((a, b) => a.seq - b.seq);
    if (!this.lastLegacyComplete) {
      // Timed out or cancelled: what arrived (maybe nothing) is not the vehicle's list. Keep the rally points the map
      // already shows rather than replacing them with a partial or empty one, and return those, so a caller's count
      // (the download summary) agrees with the map. lastRallyReadOk stays false: callers that check it know.
      console.warn('[MissionManager] Rally point stream incomplete; keeping the rally points already known.');
      return useTelemetryStore.getState().rallyPoints;
    }
    useTelemetryStore.setState({ rallyPoints, ...(rallyPoints.length > 0 ? { rallySupport: 'supported' as const } : {}) });
    this.setStatus({ rallyCount: rallyPoints.length });
    this.lastRallyReadOk = true;
    return rallyPoints;
  }

  /**
   * Complete mission fetch sequence: waypoints -> geofence -> rally points
   */
  public async fetchMission(targetSys?: number, targetComp?: number) {
    if (mavlinkConnection.getStatus() !== 'connected') {
      console.warn('Cannot fetch mission: not connected.');
      return;
    }

    if (this.status.isFetching) return;

    this.isCancelled = false;
    const hb = useTelemetryStore.getState().heartbeat;
    const sysId = targetSys ?? (hb.systemId > 0 ? hb.systemId : 1);
    const compId = targetComp ?? (hb.componentId > 0 ? hb.componentId : 1);
    this.setStatus({
      isFetching: true,
      method: 'ftp',
      waypointCount: 0,
      fenceCount: 0,
      rallyCount: 0,
      message: 'Starting synchronized mission & fence download...',
    });

    const startTime = Date.now();

    // 1. Waypoints
    const wps = await this.fetchWaypoints(sysId, compId);
    if (this.isCancelled) return;

    // 2. Geofence
    const fences = await this.fetchFence(sysId, compId);
    if (this.isCancelled) return;

    // 3. Rally Points
    const rallies = await this.fetchRally(sysId, compId);
    if (this.isCancelled) return;

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summaryMsg = `Synced ${wps.length} WPs, ${fences.length} fence pts, ${rallies.length} rally pts in ${duration}s`;
    console.log(`[MissionManager] Mission sync complete: ${summaryMsg}`);

    this.setStatus({
      isFetching: false,
      method: 'idle',
      waypointCount: wps.length,
      fenceCount: fences.length,
      rallyCount: rallies.length,
      message: summaryMsg,
    });
    this.scheduleMessageClear(5000);
  }

  /**
   * Unpacks ArduPilot mission.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   * Standard ArduPilot MAVLink 2 entry is 38 bytes (with mission_type); legacy is 37 bytes.
   */
  public unpackMissionDat(data: Uint8Array): MissionWaypoint[] | null {
    const dat = readDat(data);
    if (!dat) {
      console.warn('[MissionManager] Not a mission.dat file (bad length or magic, expected 0x763d)');
      return null;
    }
    return dat.items.map((it) => {
      const scale = cmdHasLocation(it.command) ? 1e7 : 1;
      return {
        seq: it.seq,
        command: it.command,
        lat: it.rawX / scale,
        lon: it.rawY / scale,
        alt: it.z,
        current: it.current,
        frame: it.frame,
        param1: it.param1,
        param2: it.param2,
        param3: it.param3,
        param4: it.param4,
      };
    });
  }

  /**
   * Unpacks ArduPilot fence.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   */
  public unpackFenceDat(data: Uint8Array): FencePoint[] | null {
    const dat = readDat(data);
    if (!dat) {
      console.warn('[MissionManager] Not a fence.dat file (bad length or magic, expected 0x763d)');
      return null;
    }
    return dat.items.map((it) => {
      const { command, param1 } = it;
      const isCircle = command === 5004 || command === 5005 || (command === 5003 && param1 > 0);
      const isInclusion = command === 5001 || command === 5005 || (command === 5003 && param1 > 0);
      return {
        seq: it.seq,
        command,
        lat: it.rawX / 1e7,
        lon: it.rawY / 1e7,
        alt: it.z,
        param1,
        vertexCount: !isCircle ? Math.round(param1) : undefined,
        radius: isCircle ? param1 : undefined,
        inclusion: isInclusion,
      };
    });
  }

  /**
   * Unpacks ArduPilot rally.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   */
  public unpackRallyDat(data: Uint8Array): RallyPoint[] | null {
    const dat = readDat(data);
    if (!dat) {
      console.warn('[MissionManager] Not a rally.dat file (bad length or magic, expected 0x763d)');
      return null;
    }
    return dat.items.map((it) => ({ seq: it.seq, lat: it.rawX / 1e7, lon: it.rawY / 1e7, alt: it.z, frame: it.frame }));
  }
}

export const missionManager = new MissionManager();
// Another vehicle: a transfer to or from the old one stops.
onActiveVehicleChange(() => missionManager.stopForVehicleSwitch());

export interface FencePolygon {
  type: 'inclusion' | 'exclusion';
  command: number;
  expectedCount?: number;
  points: [number, number][];
  seqs: number[];
}

/**
 * Groups raw fence items into distinct polygons so consecutive polygon fences
 * do not run together on the map, ensuring each polygon contains only the number
 * of points described by the fence file.
 */
export function groupFencePolygons(fencePoints: FencePoint[]): FencePolygon[] {
  if (!fencePoints || fencePoints.length === 0) return [];

  // Guarantee order by sequence number and strictly deduplicate by sequence
  const sorted = [...fencePoints].sort((a, b) => a.seq - b.seq);
  const uniquePoints: FencePoint[] = [];
  const seenSeqs = new Set<number>();
  for (const p of sorted) {
    if (!seenSeqs.has(p.seq)) {
      seenSeqs.add(p.seq);
      uniquePoints.push(p);
    }
  }

  const polygons: FencePolygon[] = [];
  let currentPoly: FencePolygon | null = null;

  for (const fp of uniquePoints) {
    const isPolyInclusion = fp.command === 5001;
    const isPolyExclusion = fp.command === 5002;

    if (isPolyInclusion || isPolyExclusion) {
      const polyType: 'inclusion' | 'exclusion' = isPolyInclusion ? 'inclusion' : 'exclusion';
      const declaredCount =
        fp.vertexCount && fp.vertexCount >= 3
          ? fp.vertexCount
          : fp.param1 && fp.param1 >= 3
            ? Math.round(fp.param1)
            : undefined;

      // Determine if a new polygon should begin:
      // 1. If we don't have an active polygon
      // 2. Or command changed (switching between inclusion and exclusion)
      // 3. Or current polygon already reached its expected vertex count described by the fence file
      // 4. Or vertex count changed for a new polygon while current polygon has at least 3 points
      let startNew = false;
      if (!currentPoly) {
        startNew = true;
      } else if (currentPoly.command !== fp.command) {
        startNew = true;
      } else if (
        currentPoly.expectedCount !== undefined &&
        currentPoly.points.length >= currentPoly.expectedCount
      ) {
        startNew = true;
      } else if (
        declaredCount !== undefined &&
        currentPoly.expectedCount !== undefined &&
        declaredCount !== currentPoly.expectedCount &&
        currentPoly.points.length >= 3
      ) {
        startNew = true;
      }

      if (startNew) {
        if (currentPoly && currentPoly.points.length >= 3) {
          polygons.push(currentPoly);
        }
        currentPoly = {
          type: polyType,
          command: fp.command,
          expectedCount: declaredCount,
          points: [],
          seqs: [],
        };
      } else if (currentPoly && currentPoly.expectedCount === undefined && declaredCount !== undefined) {
        currentPoly.expectedCount = declaredCount;
      }

      // Add valid coordinates (filter out null/zero coordinates and consecutive identical coordinates)
      if ((fp.lat !== 0 || fp.lon !== 0) && !isNaN(fp.lat) && !isNaN(fp.lon)) {
        const lastPt = currentPoly!.points[currentPoly!.points.length - 1];
        const isDuplicateOfLast =
          lastPt &&
          Math.abs(lastPt[0] - fp.lat) < 1e-7 &&
          Math.abs(lastPt[1] - fp.lon) < 1e-7;

        if (!isDuplicateOfLast) {
          currentPoly!.points.push([fp.lat, fp.lon]);
          currentPoly!.seqs.push(fp.seq);
        }
      }

      // If current polygon has reached the point count described by the fence file, close it
      if (
        currentPoly!.expectedCount !== undefined &&
        currentPoly!.points.length >= currentPoly!.expectedCount
      ) {
        polygons.push(currentPoly!);
        currentPoly = null;
      }
    } else {
      // Non-polygon fence item (circle fence, return point)
      if (currentPoly && currentPoly.points.length >= 3) {
        polygons.push(currentPoly);
      }
      currentPoly = null;
    }
  }

  if (currentPoly && currentPoly.points.length >= 3) {
    polygons.push(currentPoly);
  }

  return polygons;
}
