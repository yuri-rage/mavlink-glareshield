import { MAVLINK_MSG_ID, MAVLINK_MESSAGE_CRC_EXTRA } from './messages';

export interface MavlinkPacket {
  version: 1 | 2;
  sequence: number;
  systemId: number;
  componentId: number;
  messageId: number;
  payload: Uint8Array;
  crc: number;
  raw: Uint8Array;
}

export function crcAccumulate(byte: number, crc: number): number {
  let tmp = (byte ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function calculateCrc(buffer: Uint8Array, start: number, length: number, crcExtra: number): number {
  let crc = 0xffff;
  for (let i = 0; i < length; i++) {
    crc = crcAccumulate(buffer[start + i], crc);
  }
  crc = crcAccumulate(crcExtra, crc);
  return crc;
}

export class MavlinkParser {
  private buffer: Uint8Array = new Uint8Array(2048);
  private bufferLength = 0;

  public parse(chunk: Uint8Array): MavlinkPacket[] {
    const packets: MavlinkPacket[] = [];

    // Ensure internal buffer capacity
    if (this.bufferLength + chunk.length > this.buffer.length) {
      const newBuffer = new Uint8Array(Math.max(this.buffer.length * 2, this.bufferLength + chunk.length + 1024));
      newBuffer.set(this.buffer.subarray(0, this.bufferLength));
      this.buffer = newBuffer;
    }

    this.buffer.set(chunk, this.bufferLength);
    this.bufferLength += chunk.length;

    let offset = 0;

    while (offset < this.bufferLength) {
      const magic = this.buffer[offset];

      if (magic === 0xfd) {
        // MAVLink v2
        if (this.bufferLength - offset < 12) break; // Incomplete header + CRC

        const payloadLen = this.buffer[offset + 1];
        const incompatFlags = this.buffer[offset + 2];
        const hasSignature = (incompatFlags & 0x01) !== 0;
        const sigLen = hasSignature ? 13 : 0;
        const totalLen = 10 + payloadLen + 2 + sigLen;

        if (this.bufferLength - offset < totalLen) break; // Incomplete packet

        const seq = this.buffer[offset + 4];
        const sysid = this.buffer[offset + 5];
        const compid = this.buffer[offset + 6];
        const msgid =
          this.buffer[offset + 7] |
          (this.buffer[offset + 8] << 8) |
          (this.buffer[offset + 9] << 16);

        const crcOffset = offset + 10 + payloadLen;
        const packetCrc = this.buffer[crcOffset] | (this.buffer[crcOffset + 1] << 8);

        const crcExtra = MAVLINK_MESSAGE_CRC_EXTRA[msgid];
        if (crcExtra === undefined) {
          // Unknown message ID cannot be verified against CRC-X25 seed.
          // Advance 1 byte and continue hunting for a valid frame header (matches pymavlink standard)
          offset++;
          continue;
        }

        const expectedCrc = calculateCrc(this.buffer, offset + 1, 9 + payloadLen, crcExtra);

        if (packetCrc === expectedCrc) {
          const payload = this.buffer.slice(offset + 10, offset + 10 + payloadLen);
          const raw = this.buffer.slice(offset, offset + totalLen);

          packets.push({
            version: 2,
            sequence: seq,
            systemId: sysid,
            componentId: compid,
            messageId: msgid,
            payload,
            crc: packetCrc,
            raw,
          });
          offset += totalLen;
          continue;
        } else {
          // CRC mismatch, advance 1 byte
          offset++;
          continue;
        }
      } else if (magic === 0xfe) {
        // MAVLink v1
        if (this.bufferLength - offset < 8) break; // Incomplete header + CRC

        const payloadLen = this.buffer[offset + 1];
        const totalLen = 6 + payloadLen + 2;

        if (this.bufferLength - offset < totalLen) break; // Incomplete packet

        const seq = this.buffer[offset + 2];
        const sysid = this.buffer[offset + 3];
        const compid = this.buffer[offset + 4];
        const msgid = this.buffer[offset + 5];

        const crcOffset = offset + 6 + payloadLen;
        const packetCrc = this.buffer[crcOffset] | (this.buffer[crcOffset + 1] << 8);

        const crcExtra = MAVLINK_MESSAGE_CRC_EXTRA[msgid];
        if (crcExtra === undefined) {
          offset++;
          continue;
        }

        const expectedCrc = calculateCrc(this.buffer, offset + 1, 5 + payloadLen, crcExtra);

        if (packetCrc === expectedCrc) {
          const payload = this.buffer.slice(offset + 6, offset + 6 + payloadLen);
          const raw = this.buffer.slice(offset, offset + totalLen);

          packets.push({
            version: 1,
            sequence: seq,
            systemId: sysid,
            componentId: compid,
            messageId: msgid,
            payload,
            crc: packetCrc,
            raw,
          });
          offset += totalLen;
          continue;
        } else {
          offset++;
          continue;
        }
      } else {
        // Not a magic byte, advance
        offset++;
      }
    }

    // Retain unprocessed remainder
    if (offset > 0) {
      if (offset < this.bufferLength) {
        this.buffer.copyWithin(0, offset, this.bufferLength);
        this.bufferLength -= offset;
      } else {
        this.bufferLength = 0;
      }
    }

    return packets;
  }
}

// Payload Decoders
export function decodePayload(messageId: number, payload: Uint8Array): any {
  // MAVLink 2 zero-byte trimming: trailing zero bytes are omitted on the wire.
  // Pad payload into a 280-byte buffer so all fields can be read at their full offsets without bounds failure.
  let safePayload = payload;
  if (payload.length < 280) {
    const padded = new Uint8Array(280);
    padded.set(payload);
    safePayload = padded;
  }
  const view = new DataView(safePayload.buffer, safePayload.byteOffset, safePayload.byteLength);

  const getUint8 = (offset: number) => (offset < 280 ? view.getUint8(offset) : 0);
  const getInt8 = (offset: number) => (offset < 280 ? view.getInt8(offset) : 0);
  const getUint16 = (offset: number) => (offset + 2 <= 280 ? view.getUint16(offset, true) : 0);
  const getInt16 = (offset: number) => (offset + 2 <= 280 ? view.getInt16(offset, true) : 0);
  const getUint32 = (offset: number) => (offset + 4 <= 280 ? view.getUint32(offset, true) : 0);
  const getInt32 = (offset: number) => (offset + 4 <= 280 ? view.getInt32(offset, true) : 0);
  const getFloat32 = (offset: number) => (offset + 4 <= 280 ? view.getFloat32(offset, true) : 0);
  const getBigUint64 = (offset: number) => (offset + 8 <= 280 ? view.getBigUint64(offset, true) : 0n);

  switch (messageId) {
    case MAVLINK_MSG_ID.HEARTBEAT:
      return {
        custom_mode: getUint32(0),
        type: getUint8(4),
        autopilot: getUint8(5),
        base_mode: getUint8(6),
        system_status: getUint8(7),
        mavlink_version: getUint8(8),
      };

    case MAVLINK_MSG_ID.SYS_STATUS: {
      const rawVoltage = getUint16(14);
      const rawCurrent = getInt16(16);
      return {
        onboard_control_sensors_present: getUint32(0),
        onboard_control_sensors_enabled: getUint32(4),
        onboard_control_sensors_health: getUint32(8),
        load: getUint16(12) / 10, // percentage 0-100%
        voltage_battery: rawVoltage === 65535 ? 0 : rawVoltage / 1000, // Volts
        current_battery: rawCurrent === -1 ? undefined : rawCurrent / 100, // Amperes
        battery_remaining: getInt8(30), // percentage -1 or 0-100%
        drop_rate_comm: getUint16(18),
        errors_comm: getUint16(20),
      };
    }

    case MAVLINK_MSG_ID.ATTITUDE:
      return {
        time_boot_ms: getUint32(0),
        roll: getFloat32(4), // radians
        pitch: getFloat32(8), // radians
        yaw: getFloat32(12), // radians
        rollspeed: getFloat32(16),
        pitchspeed: getFloat32(20),
        yawspeed: getFloat32(24),
      };

    case MAVLINK_MSG_ID.SCALED_IMU: {
      const zacc = getInt16(8);
      return {
        time_boot_ms: getUint32(0),
        xacc: getInt16(4),
        yacc: getInt16(6),
        zacc,
        nz: -zacc / 1000,
      };
    }

    case MAVLINK_MSG_ID.RAW_IMU: {
      const zacc = getInt16(12);
      return {
        time_usec: Number(getBigUint64(0)),
        xacc: getInt16(8),
        yacc: getInt16(10),
        zacc,
        nz: -zacc / 1000,
      };
    }

    case MAVLINK_MSG_ID.HIGHRES_IMU: {
      const zacc = getFloat32(16);
      return {
        time_usec: Number(getBigUint64(0)),
        xacc: getFloat32(8),
        yacc: getFloat32(12),
        zacc,
        nz: -zacc / 9.80665,
      };
    }

    case MAVLINK_MSG_ID.GLOBAL_POSITION_INT: {
      const rawHdg = getUint16(26);
      return {
        time_boot_ms: getUint32(0),
        lat: getInt32(4) / 1e7, // degrees
        lon: getInt32(8) / 1e7, // degrees
        alt: getInt32(12) / 1000, // meters MSL
        relative_alt: getInt32(16) / 1000, // meters AGL
        vx: getInt16(20) / 100, // m/s
        vy: getInt16(22) / 100, // m/s
        vz: getInt16(24) / 100, // m/s
        hdg: rawHdg === 65535 ? 0 : rawHdg / 100, // degrees
        rawHdg,
      };
    }

    case MAVLINK_MSG_ID.GPS_RAW_INT:
      return {
        time_usec: Number(getBigUint64(0)),
        lat: getInt32(8) / 1e7,
        lon: getInt32(12) / 1e7,
        alt: getInt32(16) / 1000,
        eph: getUint16(20) === 65535 ? 0 : getUint16(20) / 100, // HDOP
        epv: getUint16(22) === 65535 ? 0 : getUint16(22) / 100, // VDOP
        vel: getUint16(24) === 65535 ? 0 : getUint16(24) / 100, // Groundspeed m/s
        cog: getUint16(26) === 65535 ? 0 : getUint16(26) / 100, // Course over ground deg
        fix_type: getUint8(28),
        satellites_visible: getUint8(29),
      };

    case MAVLINK_MSG_ID.VFR_HUD: {
      const rawHeading = getInt16(16);
      const rawThrottle = getInt16(18);
      // Valid MAVLink throttle is percentage (-100 to 100% for reverse/forward).
      // Sentinel -1 or -32768 indicates unmeasured.
      let throttle = 0;
      if (rawThrottle === -1 || rawThrottle === -32768) {
        throttle = 0;
      } else if (rawThrottle >= -100 && rawThrottle <= 100) {
        throttle = rawThrottle;
      }

      return {
        airspeed: getFloat32(0), // m/s
        groundspeed: getFloat32(4), // m/s
        alt: getFloat32(8), // meters
        climb: getFloat32(12), // m/s
        heading: ((rawHeading % 360) + 360) % 360, // degrees 0-359
        throttle,
      };
    }

    case MAVLINK_MSG_ID.BATTERY_STATUS: {
      const voltages: number[] = [];
      for (let i = 0; i < 10; i++) {
        const v = getUint16(10 + i * 2);
        if (v !== 65535 && v > 0) voltages.push(v / 1000);
      }
      const rawCurrent = getInt16(30);
      const rawConsumed = getInt32(0);
      return {
        id: getUint8(32),
        battery_function: getUint8(33),
        type: getUint8(34),
        temperature: getInt16(8) === 32767 ? undefined : getInt16(8) / 100,
        voltages,
        current_battery: rawCurrent === -1 ? undefined : rawCurrent / 100, // A
        current_consumed: rawConsumed === -1 ? undefined : rawConsumed, // mAh
        energy_consumed: getInt32(4) === -1 ? undefined : getInt32(4), // hJ
        battery_remaining: getInt8(35), // %
      };
    }

    case MAVLINK_MSG_ID.AUTOPILOT_VERSION: {
      const flight_sw_version = getUint32(16);
      let versionStr: string | undefined;
      if (flight_sw_version > 0) {
        const major = (flight_sw_version >> 24) & 0xff;
        const minor = (flight_sw_version >> 16) & 0xff;
        const patch = (flight_sw_version >> 8) & 0xff;
        const typeCode = flight_sw_version & 0xff;
        let typeStr = '';
        if (typeCode === 0) typeStr = '-dev';
        else if (typeCode === 64) typeStr = '-alpha';
        else if (typeCode === 128) typeStr = '-beta';
        else if (typeCode === 192) typeStr = '-rc';
        versionStr = `${major}.${minor}.${patch}${typeStr}`;
      }
      return {
        flight_sw_version,
        versionStr,
      };
    }

    case MAVLINK_MSG_ID.STATUSTEXT: {
      const severity = getUint8(0);
      let text = '';
      for (let i = 1; i < Math.min(51, payload.length); i++) {
        const charCode = payload[i];
        if (charCode === 0) break;
        text += String.fromCharCode(charCode);
      }
      return { severity, text: text.trim() };
    }

    case MAVLINK_MSG_ID.PARAM_VALUE: {
      const param_value = getFloat32(0);
      const param_count = getUint16(4);
      const param_index = getUint16(6);
      let param_id = '';
      for (let i = 8; i < 24; i++) {
        const b = getUint8(i);
        if (b === 0) break;
        param_id += String.fromCharCode(b);
      }
      const param_type = getUint8(24);
      return {
        param_id: param_id.trim(),
        param_value,
        param_type,
        param_count,
        param_index,
      };
    }

    case MAVLINK_MSG_ID.COMMAND_ACK:
      return {
        command: getUint16(0),
        result: getUint8(2),
        progress: getUint8(3),
        result_param2: getInt32(4),
        target_system: getUint8(8),
        target_component: getUint8(9),
      };

    case MAVLINK_MSG_ID.MISSION_CURRENT:
      return {
        seq: getUint16(0),
      };

    case MAVLINK_MSG_ID.MISSION_COUNT:
      return {
        count: getUint16(0),
        target_system: getUint8(2),
        target_component: getUint8(3),
        mission_type: getUint8(4),
      };

    case MAVLINK_MSG_ID.MISSION_ITEM:
      return {
        param1: getFloat32(0),
        param2: getFloat32(4),
        param3: getFloat32(8),
        param4: getFloat32(12),
        x: getFloat32(16), // latitude (float)
        y: getFloat32(20), // longitude (float)
        z: getFloat32(24), // altitude (float)
        seq: getUint16(28),
        command: getUint16(30),
        target_system: getUint8(32),
        target_component: getUint8(33),
        frame: getUint8(34),
        current: getUint8(35),
        autocontinue: getUint8(36),
        mission_type: getUint8(37),
      };

    case MAVLINK_MSG_ID.MISSION_ITEM_INT:
      return {
        param1: getFloat32(0),
        param2: getFloat32(4),
        param3: getFloat32(8),
        param4: getFloat32(12),
        x: getInt32(16) / 1e7, // latitude (int32 * 1e7)
        y: getInt32(20) / 1e7, // longitude (int32 * 1e7)
        z: getFloat32(24), // altitude (float)
        seq: getUint16(28),
        command: getUint16(30),
        target_system: getUint8(32),
        target_component: getUint8(33),
        frame: getUint8(34),
        current: getUint8(35),
        autocontinue: getUint8(36),
        mission_type: getUint8(37),
      };

    case MAVLINK_MSG_ID.MISSION_ACK:
      return {
        target_system: getUint8(0),
        target_component: getUint8(1),
        type: getUint8(2),
        mission_type: getUint8(3),
      };

    default:
      return { rawPayload: payload };
  }
}
