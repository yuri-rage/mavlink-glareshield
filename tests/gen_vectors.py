#!/usr/bin/env python3
"""
Generate golden MAVLink test vectors from pymavlink (the reference implementation).

Writes tests/vectors.json, which tests/golden.test.ts uses to check:
  * decode  - pymavlink-encoded packets -> app parser + decodePayload -> expected values in app units
  * encode  - app encoder output payload bytes == pymavlink payload bytes for the same fields
  * ftp     - FILE_TRANSFER_PROTOCOL packets -> app parseFtpPayload
  * crc     - every CRC_EXTRA in the app's table == the dialect's crc_extra

Usage:
    pip install pymavlink
    python3 tests/gen_vectors.py
"""
import json
import os
import struct
import sys

os.environ["MAVLINK20"] = "1"  # must be set before importing the dialect
import pymavlink
from pymavlink.dialects.v20 import ardupilotmega as mav

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vectors.json")

vehicle = mav.MAVLink(None, srcSystem=1, srcComponent=1)


def packet_hex(msg) -> str:
    return msg.pack(vehicle).hex()


def payload_hex(msg) -> str:
    """Payload bytes only (header is 10 bytes, CRC is 2; pymavlink trims trailing zeros)."""
    raw = msg.pack(vehicle)
    return raw[10:-2].hex()


decode = []


def dcase(name, msg, expect):
    decode.append({"name": name, "msgid": msg.get_msgId(), "hex": packet_hex(msg), "expect": expect})


# --- HEARTBEAT -------------------------------------------------------------
dcase("HEARTBEAT armed copter LOITER",
      mav.MAVLink_heartbeat_message(2, 3, 0xC1, 5, 4, 3),  # SAFETY_ARMED | GUIDED_ENABLED | CUSTOM_MODE_ENABLED
      {"type": 2, "autopilot": 3, "base_mode": 0xC1, "custom_mode": 5, "system_status": 4, "mavlink_version": 3})

# --- SYS_STATUS ------------------------------------------------------------
dcase("SYS_STATUS typical",
      vehicle.sys_status_encode(1, 2, 3, 456, 12345, 1234, 77, 5, 6, 0, 0, 0, 0),
      {"onboard_control_sensors_present": 1, "onboard_control_sensors_enabled": 2,
       "onboard_control_sensors_health": 3, "load": 456 / 10, "voltage_battery": 12345 / 1000,
       "current_battery": 1234 / 100, "battery_remaining": 77, "drop_rate_comm": 5, "errors_comm": 6})
dcase("SYS_STATUS sentinels (unknown voltage/current/remaining)",
      vehicle.sys_status_encode(0, 0, 0, 0, 65535, -1, -1, 0, 0, 0, 0, 0, 0),
      {"voltage_battery": 0, "current_battery": None, "battery_remaining": -1})

# --- ATTITUDE --------------------------------------------------------------
att = vehicle.attitude_encode(1000, 0.1, -0.2, 3.0, 0.01, 0.02, 0.03)
dcase("ATTITUDE", att, {"time_boot_ms": 1000, "roll": att.roll, "pitch": att.pitch, "yaw": att.yaw,
                        "rollspeed": att.rollspeed, "pitchspeed": att.pitchspeed, "yawspeed": att.yawspeed})

# --- IMUs ------------------------------------------------------------------
dcase("SCALED_IMU level", vehicle.scaled_imu_encode(500, 12, -34, -1000, 0, 0, 0, 0, 0, 0),
      {"time_boot_ms": 500, "xacc": 12, "yacc": -34, "zacc": -1000, "nz": 1.0})
dcase("RAW_IMU 2g pull", vehicle.raw_imu_encode(123456789, 5, 6, -2000, 0, 0, 0, 0, 0, 0),
      {"time_usec": 123456789, "xacc": 5, "yacc": 6, "zacc": -2000, "nz": 2.0})
hr = vehicle.highres_imu_encode(42, 0.5, -0.25, -9.80665, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
dcase("HIGHRES_IMU level", hr, {"time_usec": 42, "xacc": 0.5, "yacc": -0.25, "zacc": struct.unpack("<f", struct.pack("<f", -9.80665))[0],
                                "nz": -struct.unpack("<f", struct.pack("<f", -9.80665))[0] / 9.80665})

# --- GLOBAL_POSITION_INT ---------------------------------------------------
dcase("GLOBAL_POSITION_INT",
      vehicle.global_position_int_encode(1000, 377749000, -1224194000, 45000, 30000, 100, -50, 20, 9000),
      {"time_boot_ms": 1000, "lat": 377749000 / 1e7, "lon": -1224194000 / 1e7, "alt": 45000 / 1000,
       "relative_alt": 30000 / 1000, "vx": 1.0, "vy": -0.5, "vz": 0.2, "hdg": 90.0})
dcase("GLOBAL_POSITION_INT unknown heading",
      vehicle.global_position_int_encode(1, 0, 0, 0, 0, 0, 0, 0, 65535),
      {"hdg": 0})

# --- GPS_RAW_INT -----------------------------------------------------------
dcase("GPS_RAW_INT 3D fix",
      vehicle.gps_raw_int_encode(123456, 3, 377749000, -1224194000, 45000, 85, 120, 520, 18000, 14),
      {"time_usec": 123456, "fix_type": 3, "lat": 377749000 / 1e7, "lon": -1224194000 / 1e7, "alt": 45.0,
       "eph": 0.85, "epv": 1.2, "vel": 5.2, "cog": 180.0, "satellites_visible": 14})
dcase("GPS_RAW_INT with dual-antenna yaw",
      vehicle.gps_raw_int_encode(123456, 3, 377749000, -1224194000, 45000, 85, 120, 520, 18000, 14, yaw=24550),
      {"yaw": 245.5, "raw_yaw": 24550})
dcase("GPS_RAW_INT with due north yaw (36000)",
      vehicle.gps_raw_int_encode(123456, 3, 377749000, -1224194000, 45000, 85, 120, 520, 18000, 14, yaw=36000),
      {"yaw": 0, "raw_yaw": 36000})
dcase("GPS_RAW_INT with unavailable yaw (0)",
      vehicle.gps_raw_int_encode(123456, 3, 377749000, -1224194000, 45000, 85, 120, 520, 18000, 14, yaw=0),
      {"yaw": None, "raw_yaw": 0})
dcase("GPS_RAW_INT RTK fixed, unknown DOP/vel/cog",
      vehicle.gps_raw_int_encode(1, 6, 1, 2, 3, 65535, 65535, 65535, 65535, 30),
      {"fix_type": 6, "eph": 0, "epv": 0, "vel": 0, "cog": 0, "satellites_visible": 30})

# --- GPS2_RAW --------------------------------------------------------------
dcase("GPS2_RAW RTK with yaw",
      vehicle.gps2_raw_encode(654321, 6, 377749000, -1224194000, 45000, 65, 95, 515, 18000, 18, 0, 0, yaw=12030),
      {"time_usec": 654321, "fix_type": 6, "lat": 377749000 / 1e7, "lon": -1224194000 / 1e7, "alt": 45.0,
       "eph": 0.65, "epv": 0.95, "vel": 5.15, "cog": 180.0, "satellites_visible": 18, "yaw": 120.3, "raw_yaw": 12030})
dcase("GPS2_RAW with due north yaw (36000)",
      vehicle.gps2_raw_encode(654321, 6, 377749000, -1224194000, 45000, 65, 95, 515, 18000, 18, 0, 0, yaw=36000),
      {"yaw": 0, "raw_yaw": 36000})
dcase("GPS2_RAW with uninitialized yaw (65535)",
      vehicle.gps2_raw_encode(654321, 6, 377749000, -1224194000, 45000, 65, 95, 515, 18000, 18, 0, 0, yaw=65535),
      {"yaw": None, "raw_yaw": 65535})

# --- VFR_HUD ---------------------------------------------------------------
dcase("VFR_HUD", vehicle.vfr_hud_encode(12.5, 11.0, 270, 45, 120.5, -1.5),
      {"airspeed": 12.5, "groundspeed": 11.0, "heading": 270, "throttle": 45, "alt": 120.5, "climb": -1.5})
dcase("VFR_HUD trailing zeros trimmed (on ground)", vehicle.vfr_hud_encode(0, 0, 0, 0, 0, 0),
      {"airspeed": 0, "groundspeed": 0, "heading": 0, "throttle": 0, "alt": 0, "climb": 0})

# --- BATTERY_STATUS --------------------------------------------------------
dcase("BATTERY_STATUS 3 cells",
      vehicle.battery_status_encode(0, 1, 2, 2850, [4100, 4110, 4120] + [65535] * 7, 1234, 1500, 900, 66),
      {"id": 0, "battery_function": 1, "type": 2, "temperature": 28.5, "voltages": [4.1, 4.11, 4.12],
       "current_battery": 12.34, "current_consumed": 1500, "energy_consumed": 900, "battery_remaining": 66})
dcase("BATTERY_STATUS sentinels",
      vehicle.battery_status_encode(1, 0, 0, 32767, [65535] * 10, -1, -1, -1, -1),
      {"id": 1, "temperature": None, "voltages": [], "current_battery": None, "current_consumed": None,
       "energy_consumed": None, "battery_remaining": -1})

# --- AUTOPILOT_VERSION -----------------------------------------------------
def ap_version(major, minor, patch, typ):
    return (major << 24) | (minor << 16) | (patch << 8) | typ


for ver, typ, label in [((4, 5, 2), 255, "4.5.2"), ((4, 8, 0), 0, "4.8.0-dev"), ((4, 6, 0), 128, "4.6.0-beta")]:
    fsw = ap_version(*ver, typ)
    dcase(f"AUTOPILOT_VERSION {label}",
          vehicle.autopilot_version_encode(0, fsw, 0, 0, 0, [0] * 8, [0] * 8, [0] * 8, 0, 0, 0),
          {"flight_sw_version": fsw, "versionStr": label})

# --- STATUSTEXT ------------------------------------------------------------
dcase("STATUSTEXT short", vehicle.statustext_encode(4, b"PreArm: GPS not healthy"),
      {"severity": 4, "text": "PreArm: GPS not healthy"})
dcase("STATUSTEXT full 50 chars", vehicle.statustext_encode(6, b"X" * 50), {"severity": 6, "text": "X" * 50})

# --- PARAM_VALUE -----------------------------------------------------------
dcase("PARAM_VALUE", vehicle.param_value_encode(b"RTL_ALT", 1500.0, 9, 1000, 42),
      {"param_id": "RTL_ALT", "param_value": 1500.0, "param_type": 9, "param_count": 1000, "param_index": 42})
dcase("PARAM_VALUE 16-char id", vehicle.param_value_encode(b"SERIAL1_PROTOCOL", 2.0, 2, 900, 899),
      {"param_id": "SERIAL1_PROTOCOL", "param_value": 2.0, "param_type": 2, "param_count": 900, "param_index": 899})

# --- COMMAND_ACK -----------------------------------------------------------
dcase("COMMAND_ACK denied", vehicle.command_ack_encode(400, 2, 0, 0, 255, 190),
      {"command": 400, "result": 2, "progress": 0, "result_param2": 0, "target_system": 255, "target_component": 190})

# --- Mission protocol ------------------------------------------------------
dcase("MISSION_CURRENT", vehicle.mission_current_encode(7), {"seq": 7})
dcase("MISSION_COUNT fence", vehicle.mission_count_encode(255, 190, 12, 1),
      {"count": 12, "target_system": 255, "target_component": 190, "mission_type": 1})
mi = vehicle.mission_item_encode(1, 1, 3, 3, 16, 0, 1, 1, 2, 3, 4, 37.7749, -122.4194, 30.0, 0)
dcase("MISSION_ITEM (float)", mi,
      {"param1": 1, "param2": 2, "param3": 3, "param4": 4, "x": mi.x, "y": mi.y, "z": 30.0, "seq": 3,
       "command": 16, "frame": 3, "current": 0, "autocontinue": 1, "mission_type": 0})
dcase("MISSION_ITEM_INT waypoint",
      vehicle.mission_item_int_encode(1, 1, 3, 3, 16, 0, 1, 1, 2, 3, 4, 377749000, -1224194000, 30.0, 0),
      {"param1": 1, "param2": 2, "param3": 3, "param4": 4, "x": 37.7749, "y": -122.4194, "z": 30.0, "seq": 3,
       "command": 16, "target_system": 1, "target_component": 1, "frame": 3, "current": 0, "autocontinue": 1,
       "mission_type": 0})
dcase("MISSION_ITEM_INT fence vertex",
      vehicle.mission_item_int_encode(1, 1, 0, 0, 5001, 0, 1, 4, 0, 0, 0, 377749000, -1224194000, 0, 1),
      {"command": 5001, "param1": 4, "seq": 0, "mission_type": 1})
dcase("MISSION_ACK", vehicle.mission_ack_encode(255, 190, 0, 2),
      {"target_system": 255, "target_component": 190, "type": 0, "mission_type": 2})

# --- Extended MAVLink Telemetry Messages -----------------------------------
dcase("SCALED_PRESSURE",
      vehicle.scaled_pressure_encode(2000, 1013.25, 0.5, 2550, 2600),
      {"time_boot_ms": 2000, "press_abs": 1013.25, "press_diff": 0.5, "temperature": 25.5, "temperature_press_diff": 26.0})

dcase("RC_CHANNELS_RAW",
      vehicle.rc_channels_raw_encode(3000, 0, 1500, 1510, 1000, 1490, 1800, 1200, 1500, 1500, 95),
      {"time_boot_ms": 3000, "port": 0, "chan1_raw": 1500, "chan2_raw": 1510, "chan3_raw": 1000, "chan4_raw": 1490,
       "chan5_raw": 1800, "chan6_raw": 1200, "chan7_raw": 1500, "chan8_raw": 1500, "rssi": 95})

dcase("RC_CHANNELS 18ch",
      vehicle.rc_channels_encode(3500, 16, 1500, 1500, 1100, 1500, 1200, 1800, 1500, 1500,
                                 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 0, 0, 88),
      {"time_boot_ms": 3500, "chancount": 16, "chan1_raw": 1500, "chan3_raw": 1100, "chan5_raw": 1200,
       "chan6_raw": 1800, "rssi": 88})

dcase("SERVO_OUTPUT_RAW with MAVLink 2 extensions",
      vehicle.servo_output_raw_encode(400000, 0, 1520, 1530, 1510, 1540, 1100, 1100, 1500, 1500,
                                      1600, 1700, 0, 0, 0, 0, 0, 0),
      {"time_usec": 400000, "port": 0, "servo1_raw": 1520, "servo2_raw": 1530, "servo3_raw": 1510,
       "servo4_raw": 1540, "servo9_raw": 1600, "servo10_raw": 1700})

dcase("NAV_CONTROLLER_OUTPUT",
      vehicle.nav_controller_output_encode(5.5, -2.25, 180, 185, 240, 1.5, 0.25, -0.75),
      {"nav_roll": 5.5, "nav_pitch": -2.25, "nav_bearing": 180, "target_bearing": 185,
       "wp_dist": 240, "alt_error": 1.5, "aspd_error": 0.25, "xtrack_error": -0.75})

dcase("POWER_STATUS",
      vehicle.power_status_encode(5050, 5200, 1),
      {"Vcc": 5.05, "Vservo": 5.2, "vcc_mv": 5050, "vservo_mv": 5200, "flags": 1})

dcase("DISTANCE_SENSOR",
      vehicle.distance_sensor_encode(5000, 20, 4000, 1250, 0, 1, 25, 0, 0.5, 0.5, [1.0, 0.0, 0.0, 0.0], 90),
      {"time_boot_ms": 5000, "min_distance": 0.2, "max_distance": 40.0, "current_distance": 12.5,
       "type": 0, "id": 1, "orientation": 25, "signal_quality": 90})

dcase("WIND",
      vehicle.wind_encode(245.0, 6.5, -0.5),
      {"direction": 245.0, "speed": 6.5, "speed_z": -0.5})

dcase("RANGEFINDER",
      vehicle.rangefinder_encode(14.25, 2.5),
      {"distance": 14.25, "voltage": 2.5})

dcase("EKF_STATUS_REPORT",
      vehicle.ekf_status_report_encode(0x01FF, 0.125, 0.25, 0.1, 0.05, 0.02, 0.01),
      {"flags": 0x01FF, "velocity_variance": 0.125, "pos_horiz_variance": 0.25, "pos_vert_variance": 0.1,
       "compass_variance": 0.05, "terrain_alt_variance": 0.02, "airspeed_variance": 0.01})

dcase("RPM",
      vehicle.rpm_encode(5400.0, 5420.0),
      {"rpm1": 5400.0, "rpm2": 5420.0})

dcase("VIBRATION",
      vehicle.vibration_encode(987654321, 4.5, 5.25, 8.75, 0, 1, 2),
      {"time_usec": 987654321, "vibration_x": 4.5, "vibration_y": 5.25, "vibration_z": 8.75,
       "clipping_0": 0, "clipping_1": 1, "clipping_2": 2})

dcase("ESC_TELEMETRY_1_TO_4",
      vehicle.esc_telemetry_1_to_4_encode([40, 42, 41, 43], [1620, 1610, 1615, 1625], [850, 860, 840, 870],
                                          [120, 125, 118, 130], [5100, 5120, 5090, 5140], [100, 100, 100, 100]),
      {"temperature": [40, 42, 41, 43], "voltage": [16.2, 16.1, 16.15, 16.25],
       "current": [8.5, 8.6, 8.4, 8.7], "totalcurrent": [120, 125, 118, 130],
       "rpm": [5100, 5120, 5090, 5140], "rpm1": 5100, "temp1": 40, "curr1": 8.5, "volt1": 16.2})

# --- Encoder cases: app method + args, and the pymavlink payload for the same fields ---
encode = []


def ecase(name, method, args, msg):
    encode.append({"name": name, "method": method, "args": args, "msgid": msg.get_msgId(),
                   "payload": payload_hex(msg), "crc_extra": msg.crc_extra})


def cl(cmd, params, conf=0, ts=1, tc=1):
    return vehicle.command_long_encode(ts, tc, cmd, conf, *params)


ecase("GCS heartbeat", "createHeartbeat", [], mav.MAVLink_heartbeat_message(6, 0, 0, 0, 4, 3))
ecase("COMMAND_LONG arbitrary", "createCommandLong", [2, 1, 183, [9, 1500, 0, 0, 0, 0, 0], 0],
      cl(183, [9, 1500, 0, 0, 0, 0, 0], ts=2))
ecase("Arm", "createArmDisarm", [1, 1, True, False], cl(400, [1, 0, 0, 0, 0, 0, 0]))
ecase("Force disarm", "createArmDisarm", [1, 1, False, True], cl(400, [0, 21196, 0, 0, 0, 0, 0]))
ecase("Set mode LOITER", "createSetMode", [1, 1, 5], cl(176, [1, 5, 0, 0, 0, 0, 0]))
ecase("Set message interval ATTITUDE 10Hz", "createSetMessageInterval", [1, 1, 30, 100000],
      cl(511, [30, 100000, 0, 0, 0, 0, 0]))
ecase("Disable message stream", "createSetMessageInterval", [1, 1, 33, -1], cl(511, [33, -1, 0, 0, 0, 0, 0]))
ecase("Request AUTOPILOT_VERSION", "createRequestAutopilotVersion", [1, 1], cl(520, [1, 0, 0, 0, 0, 0, 0]))
ecase("PARAM_REQUEST_LIST", "createParamRequestList", [1, 1], vehicle.param_request_list_encode(1, 1))
ecase("PARAM_SET", "createParamSet", [1, 1, "RTL_ALT", 1500, 9],
      vehicle.param_set_encode(1, 1, b"RTL_ALT", 1500.0, 9))
ecase("PARAM_SET 16-char id", "createParamSet", [1, 1, "SERIAL1_PROTOCOL", 2, 2],
      vehicle.param_set_encode(1, 1, b"SERIAL1_PROTOCOL", 2.0, 2))
ecase("MISSION_REQUEST_LIST rally", "createMissionRequestList", [1, 1, 2],
      vehicle.mission_request_list_encode(1, 1, 2))
ecase("MISSION_REQUEST_INT", "createMissionRequestInt", [1, 1, 7, 1], vehicle.mission_request_int_encode(1, 1, 7, 1))
ecase("MISSION_REQUEST (float)", "createMissionRequest", [1, 1, 7, 0], vehicle.mission_request_encode(1, 1, 7, 0))
ecase("MISSION_ACK", "createMissionAck", [1, 1, 0, 1], vehicle.mission_ack_encode(1, 1, 0, 1))

# --- FTP: app packFtpMessage encode + parseFtpPayload decode ---------------
FTP_HDR = "<HBBBBBBI"  # seq, session, opcode, size, req_opcode, burst_complete, padding, offset


def ftp_payload(seq, session, opcode, size, req_opcode, burst, offset, data=b""):
    body = struct.pack(FTP_HDR, seq, session, opcode, size, req_opcode, burst, 0, offset) + data
    return list(body.ljust(251, b"\0"))


ftp = []
path = b"@PARAM/param.pck"
ftp_open = vehicle.file_transfer_protocol_encode(0, 1, 1, ftp_payload(3, 0, 4, len(path), 0, 0, 0, path + b"\0"))
ftp.append({"name": "OpenFileRO request (encode)", "kind": "encode",
            "args": [1, 1, 3, 0, 4, len(path), 0, list(path + b"\0")],
            "payload": payload_hex(ftp_open), "crc_extra": ftp_open.crc_extra})
chunk = bytes(range(1, 240))  # 239 bytes, no trailing zeros
ftp_ack = vehicle.file_transfer_protocol_encode(0, 255, 190, ftp_payload(9, 2, 128, 239, 15, 1, 478, chunk))
ftp.append({"name": "BurstReadFile ACK, full chunk (decode)", "kind": "decode", "hex": packet_hex(ftp_ack),
            "expect": {"seq": 9, "session": 2, "opcode": 128, "size": 239, "req_opcode": 15,
                       "burst_complete": 1, "offset": 478, "data": chunk.hex()}})
tail = b"\x01\x02\x00\x00"  # data ending in zeros -> trimmed on the wire
ftp_tail = vehicle.file_transfer_protocol_encode(0, 255, 190, ftp_payload(10, 2, 128, 4, 5, 0, 717, tail))
ftp.append({"name": "ReadFile ACK, data trimmed on wire (decode)", "kind": "decode", "hex": packet_hex(ftp_tail),
            "expect": {"seq": 10, "session": 2, "opcode": 128, "size": 4, "req_opcode": 5,
                       "burst_complete": 0, "offset": 717, "data": tail.hex()}})
ftp_nack = vehicle.file_transfer_protocol_encode(0, 255, 190, ftp_payload(11, 2, 129, 1, 15, 1, 0, b"\x06"))
ftp.append({"name": "NACK EOF (decode)", "kind": "decode", "hex": packet_hex(ftp_nack),
            "expect": {"seq": 11, "session": 2, "opcode": 129, "size": 1, "req_opcode": 15,
                       "burst_complete": 1, "offset": 0, "data": "06"}})

# --- CRC extras for every message in the dialect ----------------------------
crc = {str(mid): cls.crc_extra for mid, cls in mav.mavlink_map.items()}
names = {str(mid): cls.msgname for mid, cls in mav.mavlink_map.items()}

with open(OUT, "w") as f:
    json.dump({"generator": "pymavlink " + getattr(pymavlink, "__version__", "unknown"),
               "dialect": "ardupilotmega", "decode": decode, "encode": encode, "ftp": ftp,
               "crc_extra": crc, "msg_names": names}, f, indent=1)

print(
    f"Wrote {len(decode)} decode, {len(encode)} encode, {len(ftp)} FTP vectors and "
    + f"{len(crc)} CRC extras to {os.path.relpath(OUT)}",
    file=sys.stderr,
)
