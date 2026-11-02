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

    case MAVLINK_MSG_ID.GPS_RAW_INT: {
      const rawYaw = getUint16(50);
      const yaw =
        rawYaw === 36000
          ? 0
          : rawYaw > 0 && rawYaw < 36000
          ? rawYaw / 100
          : undefined;
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
        yaw,
        raw_yaw: rawYaw,
      };
    }

    case MAVLINK_MSG_ID.GPS2_RAW: {
      const rawYaw = getUint16(35);
      const yaw =
        rawYaw === 36000
          ? 0
          : rawYaw > 0 && rawYaw < 36000
          ? rawYaw / 100
          : undefined;
      return {
        time_usec: Number(getBigUint64(0)),
        lat: getInt32(8) / 1e7,
        lon: getInt32(12) / 1e7,
        alt: getInt32(16) / 1000,
        dgps_age: getUint32(20),
        eph: getUint16(24) === 65535 ? 0 : getUint16(24) / 100, // HDOP
        epv: getUint16(26) === 65535 ? 0 : getUint16(26) / 100, // VDOP
        vel: getUint16(28) === 65535 ? 0 : getUint16(28) / 100, // Groundspeed m/s
        cog: getUint16(30) === 65535 ? 0 : getUint16(30) / 100, // Course over ground deg
        fix_type: getUint8(32),
        satellites_visible: getUint8(33),
        dgps_numch: getUint8(34),
        yaw,
        raw_yaw: rawYaw,
      };
    }

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

    case MAVLINK_MSG_ID.MISSION_REQUEST:
    case MAVLINK_MSG_ID.MISSION_REQUEST_INT:
      return {
        seq: getUint16(0),
        target_system: getUint8(2),
        target_component: getUint8(3),
        mission_type: getUint8(4),
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

    case MAVLINK_MSG_ID.SCALED_PRESSURE:
      return {
        time_boot_ms: getUint32(0),
        press_abs: getFloat32(4), // hPa
        press_diff: getFloat32(8), // hPa
        temperature: getInt16(12) / 100, // degC
        temperature_press_diff: getInt16(14) / 100, // degC
      };

    case MAVLINK_MSG_ID.RC_CHANNELS_RAW: {
      const channels = [
        getUint16(4),
        getUint16(6),
        getUint16(8),
        getUint16(10),
        getUint16(12),
        getUint16(14),
        getUint16(16),
        getUint16(18),
      ];
      return {
        time_boot_ms: getUint32(0),
        chan1_raw: channels[0],
        chan2_raw: channels[1],
        chan3_raw: channels[2],
        chan4_raw: channels[3],
        chan5_raw: channels[4],
        chan6_raw: channels[5],
        chan7_raw: channels[6],
        chan8_raw: channels[7],
        channels,
        port: getUint8(20),
        rssi: getUint8(21),
      };
    }

    case MAVLINK_MSG_ID.RC_CHANNELS: {
      const channels: number[] = [];
      for (let i = 0; i < 18; i++) {
        channels.push(getUint16(4 + i * 2));
      }
      return {
        time_boot_ms: getUint32(0),
        chan1_raw: channels[0],
        chan2_raw: channels[1],
        chan3_raw: channels[2],
        chan4_raw: channels[3],
        chan5_raw: channels[4],
        chan6_raw: channels[5],
        chan7_raw: channels[6],
        chan8_raw: channels[7],
        chan9_raw: channels[8],
        chan10_raw: channels[9],
        chan11_raw: channels[10],
        chan12_raw: channels[11],
        chan13_raw: channels[12],
        chan14_raw: channels[13],
        chan15_raw: channels[14],
        chan16_raw: channels[15],
        chan17_raw: channels[16],
        chan18_raw: channels[17],
        channels,
        chancount: getUint8(40),
        rssi: getUint8(41),
      };
    }

    case MAVLINK_MSG_ID.SERVO_OUTPUT_RAW: {
      const servos: number[] = [];
      for (let i = 0; i < 8; i++) {
        servos.push(getUint16(4 + i * 2));
      }
      const port = getUint8(20);
      for (let i = 0; i < 8; i++) {
        servos.push(getUint16(21 + i * 2));
      }
      return {
        time_usec: getUint32(0),
        port,
        servo1_raw: servos[0],
        servo2_raw: servos[1],
        servo3_raw: servos[2],
        servo4_raw: servos[3],
        servo5_raw: servos[4],
        servo6_raw: servos[5],
        servo7_raw: servos[6],
        servo8_raw: servos[7],
        servo9_raw: servos[8],
        servo10_raw: servos[9],
        servo11_raw: servos[10],
        servo12_raw: servos[11],
        servo13_raw: servos[12],
        servo14_raw: servos[13],
        servo15_raw: servos[14],
        servo16_raw: servos[15],
        servos,
      };
    }

    case MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT:
      return {
        nav_roll: getFloat32(0),
        nav_pitch: getFloat32(4),
        alt_error: getFloat32(8),
        aspd_error: getFloat32(12),
        xtrack_error: getFloat32(16),
        nav_bearing: getInt16(20),
        target_bearing: getInt16(22),
        wp_dist: getUint16(24),
      };

    case MAVLINK_MSG_ID.POWER_STATUS: {
      const vccMv = getUint16(0);
      const vservoMv = getUint16(2);
      return {
        Vcc: vccMv / 1000, // Volts
        Vservo: vservoMv / 1000, // Volts
        vcc_mv: vccMv,
        vservo_mv: vservoMv,
        flags: getUint16(4),
      };
    }

    case MAVLINK_MSG_ID.DISTANCE_SENSOR:
      return {
        time_boot_ms: getUint32(0),
        min_distance: getUint16(4) / 100, // m
        max_distance: getUint16(6) / 100, // m
        current_distance: getUint16(8) / 100, // m
        type: getUint8(10),
        id: getUint8(11),
        orientation: getUint8(12),
        covariance: getUint8(13),
        horizontal_fov: getFloat32(14),
        vertical_fov: getFloat32(18),
        signal_quality: getUint8(38),
      };

    case MAVLINK_MSG_ID.WIND:
      return {
        direction: getFloat32(0), // deg
        speed: getFloat32(4), // m/s
        speed_z: getFloat32(8), // m/s
      };

    case MAVLINK_MSG_ID.RANGEFINDER:
      return {
        distance: getFloat32(0), // m
        voltage: getFloat32(4), // V
      };

    case MAVLINK_MSG_ID.EKF_STATUS_REPORT:
      return {
        velocity_variance: getFloat32(0),
        pos_horiz_variance: getFloat32(4),
        pos_vert_variance: getFloat32(8),
        compass_variance: getFloat32(12),
        terrain_alt_variance: getFloat32(16),
        flags: getUint16(20),
        airspeed_variance: getFloat32(22),
      };

    case MAVLINK_MSG_ID.RPM:
      return {
        rpm1: getFloat32(0),
        rpm2: getFloat32(4),
      };

    case MAVLINK_MSG_ID.VIBRATION:
      return {
        time_usec: Number(getBigUint64(0)),
        vibration_x: getFloat32(8),
        vibration_y: getFloat32(12),
        vibration_z: getFloat32(16),
        clipping_0: getUint32(20),
        clipping_1: getUint32(24),
        clipping_2: getUint32(28),
      };

    case MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4: {
      const voltage = [getUint16(0) / 100, getUint16(2) / 100, getUint16(4) / 100, getUint16(6) / 100];
      const current = [getUint16(8) / 100, getUint16(10) / 100, getUint16(12) / 100, getUint16(14) / 100];
      const totalcurrent = [getUint16(16), getUint16(18), getUint16(20), getUint16(22)];
      const rpm = [getUint16(24), getUint16(26), getUint16(28), getUint16(30)];
      const count = [getUint16(32), getUint16(34), getUint16(36), getUint16(38)];
      const temperature = [getUint8(40), getUint8(41), getUint8(42), getUint8(43)];
      return {
        voltage,
        current,
        totalcurrent,
        rpm,
        count,
        temperature,
        rpm1: rpm[0],
        rpm2: rpm[1],
        rpm3: rpm[2],
        rpm4: rpm[3],
        temp1: temperature[0],
        temp2: temperature[1],
        temp3: temperature[2],
        temp4: temperature[3],
        curr1: current[0],
        curr2: current[1],
        curr3: current[2],
        curr4: current[3],
        volt1: voltage[0],
        volt2: voltage[1],
        volt3: voltage[2],
        volt4: voltage[3],
      };
    }

    case MAVLINK_MSG_ID.GPS_RTCM_DATA: {
      const len = getUint8(1);
      return {
        flags: getUint8(0),
        len,
        data: payload.subarray(2, 2 + Math.min(len, 180)),
      };
    }

    default:
      return { rawPayload: payload };
  }
}
