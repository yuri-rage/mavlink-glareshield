import { mavlinkConnection } from './connection';
import { MAVLINK_MSG_ID } from './messages';
import { decodePayload, MavlinkPacket } from './parser';
import { mavFtpClient } from './ftp';
import { useTelemetryStore, MissionWaypoint, FencePoint, RallyPoint } from '../store/telemetryStore';

export interface MissionManagerStatus {
  isFetching: boolean;
  method: 'idle' | 'ftp' | 'legacy';
  waypointCount: number;
  fenceCount: number;
  rallyCount: number;
  message?: string;
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

  private waypoints: MissionWaypoint[] = [];
  private fenceItems: FencePoint[] = [];
  private rallyItems: RallyPoint[] = [];
  private targetSys = 1;
  private targetComp = 1;
  private isCancelled = false;
  private legacyAbort: (() => void) | null = null;
  private listeners: Set<(isFetching: boolean, count?: number, method?: string, status?: MissionManagerStatus) => void> = new Set();
  private statusListeners: Set<(status: MissionManagerStatus) => void> = new Set();

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
  }

  public onStateChange(listener: (isFetching: boolean, count?: number, method?: string, status?: MissionManagerStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status.isFetching, this.status.waypointCount, this.status.method, this.status);
    return () => this.listeners.delete(listener);
  }

  public onStatusChange(listener: (status: MissionManagerStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(patch: Partial<MissionManagerStatus>) {
    this.status = { ...this.status, ...patch };
    this.notify();
  }

  private notify() {
    this.listeners.forEach((l) => l(this.status.isFetching, this.status.waypointCount, this.status.method, this.status));
    this.statusListeners.forEach((l) => l(this.status));
  }

  /**
   * Universal sequential MAVLink Mission protocol downloader for a specific mission_type.
   * missionType: 0 = Waypoints, 1 = Geofence, 2 = Rally points.
   */
  public fetchLegacyItems(missionType: number, targetSys: number, targetComp: number, timeoutMs = 2000): Promise<any[]> {
    if (this.isCancelled) return Promise.resolve([]);

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
          this.waypoints = unpacked;
          useTelemetryStore.setState({ missionWaypoints: unpacked });
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
    }));

    waypoints.sort((a, b) => a.seq - b.seq);
    this.waypoints = waypoints;
    useTelemetryStore.setState({ missionWaypoints: waypoints });
    this.setStatus({ waypointCount: waypoints.length });
    return waypoints;
  }

  /**
   * Fetches geofence items (MAVFTP -> fallback sequential stream -> fallback parameter fence)
   */
  public async fetchFence(sysId: number, compId: number): Promise<FencePoint[]> {
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
          this.fenceItems = unpacked;
          useTelemetryStore.setState({ fencePoints: unpacked });
          this.setStatus({ fenceCount: unpacked.length });
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
      this.fenceItems = fencePoints;
      useTelemetryStore.setState({ fencePoints });
      this.setStatus({ fenceCount: fencePoints.length });
      return fencePoints;
    }

    this.fenceItems = [];
    useTelemetryStore.setState({ fencePoints: [] });
    this.setStatus({ fenceCount: 0 });
    return [];
  }

  /**
   * Fetches rally points (MAVFTP -> fallback sequential stream)
   */
  public async fetchRally(sysId: number, compId: number): Promise<RallyPoint[]> {
    if (this.isCancelled) return [];
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
          this.rallyItems = unpacked;
          useTelemetryStore.setState({ rallyPoints: unpacked });
          this.setStatus({ rallyCount: unpacked.length });
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
    }));

    rallyPoints.sort((a, b) => a.seq - b.seq);
    this.rallyItems = rallyPoints;
    useTelemetryStore.setState({ rallyPoints });
    this.setStatus({ rallyCount: rallyPoints.length });
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

    this.targetSys = sysId;
    this.targetComp = compId;
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
  }

  /**
   * Unpacks ArduPilot mission.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   * Standard ArduPilot MAVLink 2 entry is 38 bytes (with mission_type); legacy is 37 bytes.
   */
  public unpackMissionDat(data: Uint8Array): MissionWaypoint[] | null {
    if (data.length < 10) return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint16(0, true);

    if (magic !== 0x763d) {
      console.warn(`[MissionManager] Invalid mission.dat magic: 0x${magic.toString(16)}, expected 0x763d`);
      return null;
    }

    const numItems = view.getUint16(8, true);
    if (numItems === 0) return [];

    let itemSize = 38;
    if (numItems > 0) {
      const calcSize = Math.floor((data.length - 10) / numItems);
      if (calcSize === 37 || calcSize === 38) {
        itemSize = calcSize;
      }
    }

    const waypoints: MissionWaypoint[] = [];
    let offset = 10;
    for (let i = 0; i < numItems && offset + itemSize <= data.length; i++) {
      const p1 = view.getFloat32(offset + 0, true);
      const p2 = view.getFloat32(offset + 4, true);
      const p3 = view.getFloat32(offset + 8, true);
      const p4 = view.getFloat32(offset + 12, true);
      const x = view.getInt32(offset + 16, true) / 1e7;
      const y = view.getInt32(offset + 20, true) / 1e7;
      const z = view.getFloat32(offset + 24, true);
      const seq = view.getUint16(offset + 28, true);
      const command = view.getUint16(offset + 30, true);
      const frame = view.getUint8(offset + 34);
      const current = view.getUint8(offset + 35) === 1;

      waypoints.push({
        seq,
        command,
        lat: x,
        lon: y,
        alt: z,
        current,
        frame,
        param1: p1,
        param2: p2,
        param3: p3,
        param4: p4,
      });

      offset += itemSize;
    }

    return waypoints;
  }

  /**
   * Unpacks ArduPilot fence.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   */
  public unpackFenceDat(data: Uint8Array): FencePoint[] | null {
    if (data.length < 10) return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint16(0, true);

    if (magic !== 0x763d) {
      console.warn(`[MissionManager] Invalid fence.dat magic: 0x${magic.toString(16)}, expected 0x763d`);
      return null;
    }

    const numItems = view.getUint16(8, true);
    if (numItems === 0) return [];

    let itemSize = 38;
    if (numItems > 0) {
      const calcSize = Math.floor((data.length - 10) / numItems);
      if (calcSize === 37 || calcSize === 38) {
        itemSize = calcSize;
      }
    }

    const fencePoints: FencePoint[] = [];
    let offset = 10;
    for (let i = 0; i < numItems && offset + itemSize <= data.length; i++) {
      const param1 = view.getFloat32(offset + 0, true);
      const x = view.getInt32(offset + 16, true) / 1e7;
      const y = view.getInt32(offset + 20, true) / 1e7;
      const z = view.getFloat32(offset + 24, true);
      const seq = view.getUint16(offset + 28, true);
      const command = view.getUint16(offset + 30, true);

      const isCircle = command === 5004 || command === 5005 || (command === 5003 && param1 > 0);
      const isInclusion = command === 5001 || command === 5005 || (command === 5003 && param1 > 0);

      fencePoints.push({
        seq,
        command,
        lat: x,
        lon: y,
        alt: z,
        param1,
        vertexCount: !isCircle ? Math.round(param1) : undefined,
        radius: isCircle ? param1 : undefined,
        inclusion: isInclusion,
      });

      offset += itemSize;
    }

    return fencePoints;
  }

  /**
   * Unpacks ArduPilot rally.dat file format.
   * Header (10 bytes): magic (0x763d), data_type, options, start, num_items
   * Followed by num_items entries.
   */
  public unpackRallyDat(data: Uint8Array): RallyPoint[] | null {
    if (data.length < 10) return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = view.getUint16(0, true);

    if (magic !== 0x763d) {
      console.warn(`[MissionManager] Invalid rally.dat magic: 0x${magic.toString(16)}, expected 0x763d`);
      return null;
    }

    const numItems = view.getUint16(8, true);
    if (numItems === 0) return [];

    let itemSize = 38;
    if (numItems > 0) {
      const calcSize = Math.floor((data.length - 10) / numItems);
      if (calcSize === 37 || calcSize === 38) {
        itemSize = calcSize;
      }
    }

    const rallyPoints: RallyPoint[] = [];
    let offset = 10;
    for (let i = 0; i < numItems && offset + itemSize <= data.length; i++) {
      const x = view.getInt32(offset + 16, true) / 1e7;
      const y = view.getInt32(offset + 20, true) / 1e7;
      const z = view.getFloat32(offset + 24, true);
      const seq = view.getUint16(offset + 28, true);

      rallyPoints.push({
        seq,
        lat: x,
        lon: y,
        alt: z,
      });

      offset += itemSize;
    }

    return rallyPoints;
  }
}

export const missionManager = new MissionManager();

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
