import { MAVLINK_MSG_ID, MAVLINK_MESSAGE_CRC_EXTRA, MAV_CMD } from './messages';
import { calculateCrc } from './parser';

export interface MissionItemIntData {
  seq: number;
  command: number;
  frame?: number;
  current?: number | boolean;
  autocontinue?: number | boolean;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  x?: number; // lat in degrees
  y?: number; // lon in degrees
  z?: number; // alt in meters
  mission_type?: number;
}

export class MavlinkEncoder {
  private sequence = 0;
  private systemId: number;
  private componentId: number;

  constructor(systemId = 255, componentId = 190) { // GCS default IDs (255 matches ArduPilot SYSID_MYGCS)
    this.systemId = systemId;
    this.componentId = componentId;
  }

  public setSourceId(systemId: number, componentId = 190) {
    this.systemId = systemId;
    this.componentId = componentId;
  }

  public getSystemId(): number {
    return this.systemId;
  }

  private nextSequence(): number {
    const seq = this.sequence;
    this.sequence = (this.sequence + 1) & 0xff;
    return seq;
  }

  public packV2(messageId: number, payload: Uint8Array): Uint8Array {
    const seq = this.nextSequence();
    const payloadLen = payload.length;
    const packetLen = 10 + payloadLen + 2;
    const packet = new Uint8Array(packetLen);

    // Header
    packet[0] = 0xfd; // magic
    packet[1] = payloadLen;
    packet[2] = 0; // incompat flags
    packet[3] = 0; // compat flags
    packet[4] = seq;
    packet[5] = this.systemId;
    packet[6] = this.componentId;
    packet[7] = messageId & 0xff;
    packet[8] = (messageId >> 8) & 0xff;
    packet[9] = (messageId >> 16) & 0xff;

    // Payload
    packet.set(payload, 10);

    // CRC
    const crcExtra = MAVLINK_MESSAGE_CRC_EXTRA[messageId] ?? 0;
    const crc = calculateCrc(packet, 1, 9 + payloadLen, crcExtra);
    packet[10 + payloadLen] = crc & 0xff;
    packet[10 + payloadLen + 1] = (crc >> 8) & 0xff;

    return packet;
  }

  // Generate GCS Heartbeat
  public createHeartbeat(): Uint8Array {
    const payload = new Uint8Array(9);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 0, true); // custom_mode
    view.setUint8(4, 6); // type = MAV_TYPE_GCS
    view.setUint8(5, 0); // autopilot = MAV_AUTOPILOT_GENERIC
    view.setUint8(6, 0); // base_mode
    view.setUint8(7, 4); // system_status = MAV_STATE_ACTIVE
    view.setUint8(8, 3); // mavlink_version = 3
    return this.packV2(MAVLINK_MSG_ID.HEARTBEAT, payload);
  }

  // Generate COMMAND_LONG (Used for ARM/DISARM, SET_MODE, SET_MESSAGE_INTERVAL, etc.)
  public createCommandLong(
    targetSystem: number,
    targetComponent: number,
    command: number,
    params: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0],
    confirmation = 0
  ): Uint8Array {
    const payload = new Uint8Array(33);
    const view = new DataView(payload.buffer);

    for (let i = 0; i < 7; i++) {
      view.setFloat32(i * 4, params[i], true);
    }
    view.setUint16(28, command, true);
    view.setUint8(30, targetSystem);
    view.setUint8(31, targetComponent);
    view.setUint8(32, confirmation);

    return this.packV2(MAVLINK_MSG_ID.COMMAND_LONG, payload);
  }

  // Generate COMMAND_INT (Used for location-sensitive commands like DO_REPOSITION, NAV_WAYPOINT, etc.)
  public createCommandInt(
    targetSystem: number,
    targetComponent: number,
    command: number,
    frame = 3, // MAV_FRAME_GLOBAL_RELATIVE_ALT
    params: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0]
  ): Uint8Array {
    const payload = new Uint8Array(35);
    const view = new DataView(payload.buffer);

    view.setFloat32(0, params[0], true);
    view.setFloat32(4, params[1], true);
    view.setFloat32(8, params[2], true);
    view.setFloat32(12, params[3], true);
    view.setInt32(16, Math.round(params[4]), true); // x: lat * 1e7
    view.setInt32(20, Math.round(params[5]), true); // y: lon * 1e7
    view.setFloat32(24, params[6], true); // z: alt (m)
    view.setUint16(28, command, true);
    view.setUint8(30, targetSystem);
    view.setUint8(31, targetComponent);
    view.setUint8(32, frame);
    view.setUint8(33, 0); // current
    view.setUint8(34, 0); // autocontinue

    return this.packV2(MAVLINK_MSG_ID.COMMAND_INT, payload);
  }

  // DO_REPOSITION with explicit coordinate frame, target position, and NaN yaw (maintain heading)
  public createDoReposition(
    targetSystem = 1,
    targetComponent = 1,
    latDeg: number,
    lonDeg: number,
    altM: number,
    frame = 3 // MAV_FRAME_GLOBAL_RELATIVE_ALT
  ): Uint8Array {
    return this.createCommandInt(
      targetSystem,
      targetComponent,
      MAV_CMD.DO_REPOSITION,
      frame,
      [-1, 1, 0, Number.NaN, latDeg * 1e7, lonDeg * 1e7, altM]
    );
  }

  // Arm / Disarm vehicle
  public createArmDisarm(targetSystem = 1, targetComponent = 1, arm: boolean, force = false): Uint8Array {
    return this.createCommandLong(
      targetSystem,
      targetComponent,
      MAV_CMD.COMPONENT_ARM_DISARM,
      [arm ? 1 : 0, force ? 21196 : 0, 0, 0, 0, 0, 0]
    );
  }

  // Set Flight Mode via MAV_CMD_DO_SET_MODE
  public createSetMode(targetSystem = 1, targetComponent = 1, customMode: number): Uint8Array {
    return this.createCommandLong(
      targetSystem,
      targetComponent,
      MAV_CMD.DO_SET_MODE,
      [1, customMode, 0, 0, 0, 0, 0] // 1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
    );
  }

  // Request Message / Set Message Interval (in microseconds, -1 to disable)
  public createSetMessageInterval(
    targetSystem = 1,
    targetComponent = 1,
    messageId: number,
    intervalUs: number
  ): Uint8Array {
    return this.createCommandLong(
      targetSystem,
      targetComponent,
      MAV_CMD.SET_MESSAGE_INTERVAL,
      [messageId, intervalUs, 0, 0, 0, 0, 0]
    );
  }

  // Request Autopilot Version & Capabilities (msg 148)
  public createRequestAutopilotVersion(targetSystem = 1, targetComponent = 1): Uint8Array {
    return this.createCommandLong(
      targetSystem,
      targetComponent,
      MAV_CMD.REQUEST_AUTOPILOT_CAPABILITIES,
      [1, 0, 0, 0, 0, 0, 0]
    );
  }

  // Request single parameter by index or ID
  public createParamRequestRead(
    targetSystem = 1,
    targetComponent = 1,
    paramIndex = -1,
    paramId = ''
  ): Uint8Array {
    const payload = new Uint8Array(20);
    const view = new DataView(payload.buffer);
    view.setInt16(0, paramIndex, true);
    payload[2] = targetSystem;
    payload[3] = targetComponent;
    for (let i = 0; i < 16; i++) {
      payload[4 + i] = i < paramId.length ? paramId.charCodeAt(i) : 0;
    }
    return this.packV2(MAVLINK_MSG_ID.PARAM_REQUEST_READ, payload);
  }

  // Request Parameter List
  public createParamRequestList(targetSystem = 1, targetComponent = 1): Uint8Array {
    const payload = new Uint8Array(2);
    payload[0] = targetSystem;
    payload[1] = targetComponent;
    return this.packV2(MAVLINK_MSG_ID.PARAM_REQUEST_LIST, payload);
  }

  // Set Parameter Value
  public createParamSet(
    targetSystem = 1,
    targetComponent = 1,
    paramId: string,
    paramValue: number,
    paramType = 9 // MAV_PARAM_TYPE_REAL32
  ): Uint8Array {
    const payload = new Uint8Array(23);
    const view = new DataView(payload.buffer);
    view.setFloat32(0, paramValue, true);
    payload[4] = targetSystem;
    payload[5] = targetComponent;

    // Param ID (up to 16 bytes ASCII)
    for (let i = 0; i < 16; i++) {
      payload[6 + i] = i < paramId.length ? paramId.charCodeAt(i) : 0;
    }
    payload[22] = paramType;

    return this.packV2(MAVLINK_MSG_ID.PARAM_SET, payload);
  }

  // Request Mission Count / List (Msg ID 43)
  public createMissionRequestList(targetSystem = 1, targetComponent = 1, missionType = 0): Uint8Array {
    const payload = new Uint8Array(3);
    payload[0] = targetSystem;
    payload[1] = targetComponent;
    payload[2] = missionType;
    return this.packV2(MAVLINK_MSG_ID.MISSION_REQUEST_LIST, payload);
  }

  // Request Mission Item INT (Msg ID 51)
  public createMissionRequestInt(targetSystem = 1, targetComponent = 1, seq: number, missionType = 0): Uint8Array {
    const payload = new Uint8Array(5);
    const view = new DataView(payload.buffer);
    view.setUint16(0, seq, true);
    payload[2] = targetSystem;
    payload[3] = targetComponent;
    payload[4] = missionType;
    return this.packV2(MAVLINK_MSG_ID.MISSION_REQUEST_INT, payload);
  }

  // Request Mission Item Float (Msg ID 40)
  public createMissionRequest(targetSystem = 1, targetComponent = 1, seq: number, missionType = 0): Uint8Array {
    const payload = new Uint8Array(5);
    const view = new DataView(payload.buffer);
    view.setUint16(0, seq, true);
    payload[2] = targetSystem;
    payload[3] = targetComponent;
    payload[4] = missionType;
    return this.packV2(MAVLINK_MSG_ID.MISSION_REQUEST, payload);
  }

  // Mission ACK (Msg ID 47)
  public createMissionAck(targetSystem = 1, targetComponent = 1, type = 0, missionType = 0): Uint8Array {
    const payload = new Uint8Array(4);
    payload[0] = targetSystem;
    payload[1] = targetComponent;
    payload[2] = type; // 0 = MAV_MISSION_ACCEPTED
    payload[3] = missionType;
    return this.packV2(MAVLINK_MSG_ID.MISSION_ACK, payload);
  }

  // Create MISSION_COUNT (Msg ID 44)
  public createMissionCount(targetSystem = 1, targetComponent = 1, count: number, missionType = 0): Uint8Array {
    const payload = new Uint8Array(5);
    const view = new DataView(payload.buffer);
    view.setUint16(0, count, true);
    payload[2] = targetSystem;
    payload[3] = targetComponent;
    payload[4] = missionType;
    return this.packV2(MAVLINK_MSG_ID.MISSION_COUNT, payload);
  }

  // Create MISSION_ITEM_INT (Msg ID 73)
  public createMissionItemInt(targetSystem: number, targetComponent: number, item: MissionItemIntData): Uint8Array {
    const payload = new Uint8Array(38);
    const view = new DataView(payload.buffer);
    view.setFloat32(0, item.param1 ?? 0, true);
    view.setFloat32(4, item.param2 ?? 0, true);
    view.setFloat32(8, item.param3 ?? 0, true);
    view.setFloat32(12, item.param4 ?? 0, true);
    view.setInt32(16, Math.round((item.x ?? 0) * 1e7), true);
    view.setInt32(20, Math.round((item.y ?? 0) * 1e7), true);
    view.setFloat32(24, item.z ?? 0, true);
    view.setUint16(28, item.seq, true);
    view.setUint16(30, item.command, true);
    payload[32] = targetSystem;
    payload[33] = targetComponent;
    payload[34] = item.frame ?? 3; // 3 = MAV_FRAME_GLOBAL_RELATIVE_ALT
    payload[35] = typeof item.current === 'boolean' ? (item.current ? 1 : 0) : (item.current ?? 0);
    payload[36] = typeof item.autocontinue === 'boolean' ? (item.autocontinue ? 1 : 0) : (item.autocontinue ?? 1);
    payload[37] = item.mission_type ?? 0;
    return this.packV2(MAVLINK_MSG_ID.MISSION_ITEM_INT, payload);
  }

  // Inject GPS RTCM Data (Msg ID 233)
  public createGpsRtcmData(flags: number, data: Uint8Array): Uint8Array {
    const len = Math.min(data.length, 180);
    const payload = new Uint8Array(2 + len);
    payload[0] = flags;
    payload[1] = len;
    payload.set(data.subarray(0, len), 2);
    return this.packV2(MAVLINK_MSG_ID.GPS_RTCM_DATA, payload);
  }
}
