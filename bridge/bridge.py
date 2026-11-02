#!/usr/bin/env python3
"""
MAVLink WebSocket Bridge & Mock Telemetry Simulator
===================================================
Bridges ArduPilot (Serial / UDP / TCP) to raw WebSocket clients for MAVLink Glareshield.
Includes a built-in `--mock` mode for offline UI testing and development.

Usage:
    python3 bridge.py --mock                     # Start in mock mode (instant test)
    python3 bridge.py --udp 127.0.0.1:14550      # Connect to SITL UDP
    python3 bridge.py --tcp 127.0.0.1:5760       # Connect to SITL TCP
    python3 bridge.py --serial /dev/ttyUSB0:57600# Connect to physical telemetry radio
"""

import argparse
import asyncio
import base64
import json
import math
import re
import struct
import time
from typing import Any, cast

import websockets

DEFAULT_ALLOWED_ORIGINS: list[Any] = [
    re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"),
    re.compile(
        r"^https?://(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$"
    ),
    re.compile(r"^tauri://.*$"),
    re.compile(r"^https?://tauri\.localhost(:\d+)?$"),
    "null",
    None,
]

# Message IDs
MSG_HEARTBEAT = 0
MSG_SYS_STATUS = 1
MSG_PARAM_REQUEST_LIST = 21
MSG_PARAM_VALUE = 22
MSG_PARAM_SET = 23
MSG_GPS_RAW_INT = 24
MSG_SCALED_PRESSURE = 29
MSG_ATTITUDE = 30
MSG_GLOBAL_POSITION_INT = 33
MSG_RC_CHANNELS_RAW = 35
MSG_SERVO_OUTPUT_RAW = 36
MSG_MISSION_ITEM = 39
MSG_MISSION_REQUEST = 40
MSG_MISSION_REQUEST_LIST = 43
MSG_MISSION_COUNT = 44
MSG_MISSION_ACK = 47
MSG_MISSION_REQUEST_INT = 51
MSG_NAV_CONTROLLER_OUTPUT = 62
MSG_RC_CHANNELS = 65
MSG_MISSION_ITEM_INT = 73
MSG_COMMAND_LONG = 76
MSG_COMMAND_ACK = 77
MSG_VFR_HUD = 74
MSG_FILE_TRANSFER_PROTOCOL = 110
MSG_GPS2_RAW = 124
MSG_POWER_STATUS = 125
MSG_DISTANCE_SENSOR = 132
MSG_BATTERY_STATUS = 147
MSG_WIND = 168
MSG_RANGEFINDER = 173
MSG_EKF_STATUS_REPORT = 193
MSG_RPM = 226
MSG_VIBRATION = 241
MSG_GPS_RTCM_DATA = 233
MSG_STATUSTEXT = 253
MSG_ESC_TELEMETRY_1_TO_4 = 11030

# CRC Extra seeds
CRC_EXTRA = {
    MSG_HEARTBEAT: 50,
    MSG_SYS_STATUS: 124,
    MSG_PARAM_VALUE: 220,
    MSG_PARAM_SET: 168,
    MSG_GPS_RAW_INT: 24,
    MSG_SCALED_PRESSURE: 115,
    MSG_ATTITUDE: 39,
    MSG_GLOBAL_POSITION_INT: 104,
    MSG_RC_CHANNELS_RAW: 244,
    MSG_SERVO_OUTPUT_RAW: 222,
    MSG_MISSION_ITEM: 254,
    MSG_MISSION_REQUEST: 230,
    MSG_MISSION_REQUEST_LIST: 132,
    MSG_MISSION_COUNT: 221,
    MSG_MISSION_ACK: 153,
    MSG_MISSION_REQUEST_INT: 196,
    MSG_NAV_CONTROLLER_OUTPUT: 183,
    MSG_RC_CHANNELS: 118,
    MSG_MISSION_ITEM_INT: 38,
    MSG_COMMAND_LONG: 152,
    MSG_COMMAND_ACK: 143,
    MSG_VFR_HUD: 20,
    MSG_FILE_TRANSFER_PROTOCOL: 84,
    MSG_GPS2_RAW: 87,
    MSG_POWER_STATUS: 203,
    MSG_DISTANCE_SENSOR: 85,
    MSG_BATTERY_STATUS: 154,
    MSG_WIND: 1,
    MSG_RANGEFINDER: 83,
    MSG_EKF_STATUS_REPORT: 71,
    MSG_RPM: 207,
    MSG_VIBRATION: 90,
    MSG_GPS_RTCM_DATA: 35,
    MSG_STATUSTEXT: 83,
    MSG_ESC_TELEMETRY_1_TO_4: 144,
}


def crc_accumulate(b: int, crc: int) -> int:
    tmp = (b ^ (crc & 0xFF)) & 0xFF
    tmp = (tmp ^ (tmp << 4)) & 0xFF
    return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xFFFF


def calculate_crc(buf: bytes, crc_extra: int) -> int:
    crc = 0xFFFF
    for b in buf:
        crc = crc_accumulate(b, crc)
    crc = crc_accumulate(crc_extra, crc)
    return crc


class MavlinkV2Encoder:
    def __init__(self, sysid=1, compid=1):
        self.sysid = sysid
        self.compid = compid
        self.seq = 0

    def pack(self, msgid: int, payload: bytes) -> bytes:
        seq = self.seq
        self.seq = (self.seq + 1) & 0xFF
        hdr = bytes(
            [
                0xFD,
                len(payload),
                0,
                0,
                seq,
                self.sysid,
                self.compid,
                msgid & 0xFF,
                (msgid >> 8) & 0xFF,
                (msgid >> 16) & 0xFF,
            ]
        )
        body = hdr[1:] + payload
        crc = calculate_crc(body, CRC_EXTRA.get(msgid, 0))
        return hdr + payload + struct.pack("<H", crc)


class ClientSession:
    def __init__(self, websocket: Any):
        self.websocket = websocket
        self.ntrip_writer: asyncio.StreamWriter | None = None
        self.ntrip_task: asyncio.Task[None] | None = None

    async def stop_ntrip(self) -> None:
        if self.ntrip_task:
            self.ntrip_task.cancel()
            try:
                await self.ntrip_task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001, S110
                pass
            self.ntrip_task = None
        if self.ntrip_writer:
            try:
                self.ntrip_writer.close()
                await self.ntrip_writer.wait_closed()
            except Exception:  # noqa: BLE001, S110
                pass
            self.ntrip_writer = None
        try:
            await self.websocket.send(
                json.dumps({"type": "ntrip_status", "status": "disconnected"})
            )
        except Exception:  # noqa: BLE001, S110
            pass


class BridgeServer:
    def __init__(
        self,
        host: str,
        port: int,
        mode: str,
        target: str,
        allowed_origins: list[Any] | None = None,
    ):
        self.host = host
        self.port = port
        self.mode = mode
        self.target = target
        self.allowed_origins = (
            allowed_origins if allowed_origins is not None else DEFAULT_ALLOWED_ORIGINS
        )
        self.clients: set[Any] = set()
        self.client_sessions: dict[Any, ClientSession] = {}
        self.encoder = MavlinkV2Encoder(sysid=1, compid=1)
        self.transport = None
        self.serial_conn = None
        self.udp_target = None

        # Vehicle simulated state
        self.armed = False
        self.flight_mode = 0  # STABILIZE
        self.sim_lat = 37.7749
        self.sim_lon = -122.4194
        self.sim_alt = 45.0
        self.sim_battery_pct = 95
        self.sim_voltage = 16.4
        self.sim_start_time = time.time()

        # Mock MAVFTP file store and session tracking
        self.mock_files: dict[str, bytearray] = {}
        self.mock_ftp_sessions: dict[int, dict[str, Any]] = {}
        self.next_ftp_session_id = 1

        # Mock MAVLink mission upload state
        self.mock_mission_upload_count = 0
        self.mock_mission_upload_type = 0
        self.mock_mission_items: list[bytes] = []

    async def broadcast(self, data: bytes):
        if not self.clients:
            return
        dead = []
        for client in list(self.clients):
            try:
                await client.send(data)
            except websockets.exceptions.ConnectionClosed:
                dead.append(client)
            except Exception:  # noqa: BLE001
                dead.append(client)
        for d in dead:
            self.clients.discard(d)

    async def ws_handler(self, websocket):
        session = ClientSession(websocket)
        self.client_sessions[websocket] = session
        self.clients.add(websocket)
        print(
            f"[WS] Client connected from {websocket.remote_address}. Active: {len(self.clients)}"
        )
        if self.mode == "mock":
            # Send initial boot status messages
            boot_messages = [
                (6, "ArduCopter V4.5.2 (78057ebe)"),
                (6, "ChibiOS: 6a85082c"),
                (6, "EKF3 IMU0 initialised"),
                (6, "GPS 1: detected as u-blox at 115200 baud"),
                (6, "GPS 2: detected as u-blox at 115200 baud"),
                (5, "Arm: Safety switch engaged"),
            ]
            for sev, txt in boot_messages:
                txt_bytes = txt.encode("ascii")[:50].ljust(50, b"\x00")
                try:
                    await websocket.send(
                        self.encoder.pack(
                            MSG_STATUSTEXT, struct.pack("<B", sev) + txt_bytes
                        )
                    )
                except Exception:  # noqa: BLE001, S110
                    pass
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    if self.mode == "mock":
                        await self.handle_mock_command(message)
                    elif self.transport:
                        self.send_to_vehicle(message)
                elif isinstance(message, str):
                    await self.handle_text_command(session, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await session.stop_ntrip()
            self.client_sessions.pop(websocket, None)
            self.clients.discard(websocket)
            print(f"[WS] Client disconnected. Active: {len(self.clients)}")

    async def handle_text_command(self, session: ClientSession, message: str) -> None:
        try:
            cmd = json.loads(message)
        except Exception:  # noqa: BLE001
            return

        cmd_type = cmd.get("type")
        if cmd_type == "ntrip_connect":
            await self.start_ntrip_stream(session, cmd)
        elif cmd_type == "ntrip_disconnect":
            await session.stop_ntrip()
        elif cmd_type == "ntrip_gga":
            await self.send_ntrip_gga(session, cmd.get("gga", ""))

    async def start_ntrip_stream(self, session: ClientSession, cmd: dict[str, Any]) -> None:
        await session.stop_ntrip()
        websocket = session.websocket
        host = str(cmd.get("host", "")).strip()
        port = int(cmd.get("port", 2101))
        mountpoint = str(cmd.get("mountpoint", "")).strip().lstrip("/")
        username = str(cmd.get("username", "")).strip()
        password = str(cmd.get("password", "")).strip()

        if not host or not mountpoint:
            await websocket.send(
                json.dumps({"type": "ntrip_error", "message": "Missing host or mountpoint"})
            )
            return

        auth_header = ""
        if username or password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
            auth_header = f"Authorization: Basic {token}\r\n"

        req = (
            f"GET /{mountpoint} HTTP/1.0\r\n"
            f"User-Agent: NTRIP MavlinkGlareshield/1.0\r\n"
            f"{auth_header}\r\n"
        )

        try:
            reader, writer = await asyncio.open_connection(host, port)
            session.ntrip_writer = writer
            writer.write(req.encode("latin1"))
            await writer.drain()

            resp_buf = bytearray()
            header_parsed = False

            while not header_parsed:
                chunk = await reader.read(512)
                if not chunk:
                    msg = "Caster closed connection before response"
                    raise ConnectionError(msg)
                resp_buf.extend(chunk)

                split_at = -1
                double_crlf = resp_buf.find(b"\r\n\r\n")
                icy_idx = resp_buf.find(b"ICY 200 OK\r\n")

                if double_crlf != -1:
                    split_at = double_crlf + 4
                elif icy_idx != -1:
                    split_at = icy_idx + 12

                if split_at != -1:
                    header_parsed = True
                    header_str = bytes(resp_buf[:split_at]).decode("latin1", errors="replace")
                    if "200 OK" not in header_str:
                        writer.close()
                        await writer.wait_closed()
                        session.ntrip_writer = None
                        await websocket.send(
                            json.dumps({
                                "type": "ntrip_error",
                                "message": f"Caster rejected: {header_str.strip()}",
                            })
                        )
                        return

                    await websocket.send(
                        json.dumps({"type": "ntrip_status", "status": "streaming"})
                    )
                    body_start = bytes(resp_buf[split_at:])
                    if body_start:
                        await websocket.send(
                            json.dumps({
                                "type": "ntrip_data",
                                "data": base64.b64encode(body_start).decode("ascii"),
                            })
                        )

            async def ntrip_read_loop() -> None:
                try:
                    while True:
                        data = await reader.read(1024)
                        if not data:
                            break
                        await websocket.send(
                            json.dumps({
                                "type": "ntrip_data",
                                "data": base64.b64encode(data).decode("ascii"),
                            })
                        )
                except Exception:  # noqa: BLE001, S110
                    pass
                finally:
                    await session.stop_ntrip()

            session.ntrip_task = asyncio.create_task(ntrip_read_loop())

        except Exception as e:  # noqa: BLE001
            if session.ntrip_writer:
                try:
                    session.ntrip_writer.close()
                except Exception:  # noqa: BLE001, S110
                    pass
                session.ntrip_writer = None
            await websocket.send(json.dumps({"type": "ntrip_error", "message": str(e)}))

    async def send_ntrip_gga(self, session: ClientSession, gga: str) -> None:
        if session.ntrip_writer and gga:
            try:
                session.ntrip_writer.write(gga.encode("ascii"))
                await session.ntrip_writer.drain()
            except Exception:  # noqa: BLE001, S110
                pass

    def send_to_vehicle(self, data: bytes):
        if self.mode == "udp" and self.transport:
            cast(Any, self.transport).sendto(data, self.udp_target)
        elif self.mode == "tcp" and self.transport:
            cast(Any, self.transport).write(data)
        elif self.mode == "serial" and self.serial_conn:
            self.serial_conn.write(data)

    async def handle_mock_command(self, data: bytes):
        # Inspect MAVLink message ID (extract exact payload length so signed or coalesced frames work cleanly)
        if len(data) >= 12 and data[0] == 0xFD:
            payload_len = data[1]
            msgid = data[7] | (data[8] << 8) | (data[9] << 16)
            payload = data[10 : 10 + payload_len]

            if msgid == MSG_COMMAND_LONG:
                if len(payload) < 33:
                    payload = payload.ljust(33, b"\x00")
                # COMMAND_LONG unpack
                p1, p2, _p3, _p4, _p5, _p6, _p7 = struct.unpack("<7f", payload[:28])
                cmd, _target_sys, _target_comp, _conf = struct.unpack(
                    "<HBBB", payload[28:33]
                )

                if cmd == 400:  # MAV_CMD_COMPONENT_ARM_DISARM
                    self.armed = p1 == 1.0
                    print(f"[MOCK] Vehicle {'ARMED' if self.armed else 'DISARMED'}")
                    # Send ACK
                    ack_payload = struct.pack(
                        "<HBBIBB", 400, 0, 0, 0, 1, 1
                    )  # 0 = MAV_RESULT_ACCEPTED
                    await self.broadcast(
                        self.encoder.pack(MSG_COMMAND_ACK, ack_payload)
                    )
                    # Send STATUSTEXT
                    status_str = f"Throttle {'armed' if self.armed else 'disarmed'}"
                    txt_bytes = status_str.encode("ascii")[:50].ljust(50, b"\x00")
                    await self.broadcast(
                        self.encoder.pack(
                            MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes
                        )
                    )

                elif cmd == 176:  # MAV_CMD_DO_SET_MODE
                    mode_num = int(p2)
                    self.flight_mode = mode_num
                    print(f"[MOCK] Flight mode changed to {mode_num}")
                    ack_payload = struct.pack("<HBBIBB", 176, 0, 0, 0, 1, 1)
                    await self.broadcast(
                        self.encoder.pack(MSG_COMMAND_ACK, ack_payload)
                    )
                    mode_name = (
                        "STABILIZE"
                        if mode_num == 0
                        else "ALT_HOLD"
                        if mode_num == 2
                        else "AUTO"
                        if mode_num == 3
                        else "GUIDED"
                        if mode_num == 4
                        else "LOITER"
                        if mode_num == 5
                        else "RTL"
                        if mode_num == 6
                        else f"MODE_{mode_num}"
                    )
                    txt_bytes = f"Flight mode set to {mode_name}".encode("ascii")[
                        :50
                    ].ljust(50, b"\x00")
                    await self.broadcast(
                        self.encoder.pack(
                            MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes
                        )
                    )

                elif cmd == 42428:  # MAV_CMD_DO_SEND_BANNER
                    ack_payload = struct.pack(
                        "<HBBIBB", 42428, 0, 0, 0, 1, 1
                    )  # 0 = MAV_RESULT_ACCEPTED
                    await self.broadcast(
                        self.encoder.pack(MSG_COMMAND_ACK, ack_payload)
                    )
                    banner_str = "ArduCopter V4.5.2 (78057ebe)"
                    txt_bytes = banner_str.encode("ascii")[:50].ljust(50, b"\x00")
                    await self.broadcast(
                        self.encoder.pack(
                            MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes
                        )
                    )

                else:
                    # Acknowledge other commands (housekeeping, message intervals, capabilities, etc.)
                    ack_payload = struct.pack(
                        "<HBBIBB", cmd, 0, 0, 0, 1, 1
                    )  # 0 = MAV_RESULT_ACCEPTED
                    await self.broadcast(
                        self.encoder.pack(MSG_COMMAND_ACK, ack_payload)
                    )

            elif msgid == MSG_PARAM_SET:
                if len(payload) < 23:
                    payload = payload.ljust(23, b"\x00")
                param_val = struct.unpack("<f", payload[0:4])[0]
                param_id = payload[6:22].decode("ascii", errors="ignore").strip("\x00")
                param_type = payload[22] if len(payload) > 22 else 9
                print(f"[MOCK] PARAM_SET {param_id} = {param_val}")
                id_bytes = param_id.encode("ascii")[:16].ljust(16, b"\x00")
                val_bytes = (
                    struct.pack("<fHH", param_val, 9, 0)
                    + id_bytes
                    + struct.pack("<B", param_type or 9)
                )
                await self.broadcast(self.encoder.pack(MSG_PARAM_VALUE, val_bytes))

            elif msgid == MSG_PARAM_REQUEST_LIST:
                print(
                    "[MOCK] Received PARAM_REQUEST_LIST. Streaming sample parameters..."
                )
                sample_params = [
                    ("BATT_CAPACITY", 5000.0, 9),
                    ("WPNAV_SPEED", 500.0, 9),
                    ("RTL_ALT", 2000.0, 9),
                    ("PILOT_SPEED_UP", 250.0, 9),
                    ("FLTMODE1", 0.0, 9),
                    ("FLTMODE2", 5.0, 9),
                    ("FLTMODE3", 6.0, 9),
                ]
                for idx, (p_id, p_val, p_type) in enumerate(sample_params):
                    id_bytes = p_id.encode("ascii")[:16].ljust(16, b"\x00")
                    val_bytes = (
                        struct.pack("<fHH", p_val, len(sample_params), idx)
                        + id_bytes
                        + struct.pack("<B", p_type)
                    )
                    await self.broadcast(self.encoder.pack(MSG_PARAM_VALUE, val_bytes))
                    await asyncio.sleep(0.02)

            elif msgid == MSG_MISSION_REQUEST_LIST:
                print(
                    "[MOCK] Received MISSION_REQUEST_LIST. Sending MISSION_COUNT = 4..."
                )
                # Prepare mock mission waypoints around current vehicle location
                self.mock_waypoints = [
                    (self.sim_lat, self.sim_lon, 0.0, 0),
                    (self.sim_lat + 0.0015, self.sim_lon + 0.0010, 30.0, 1),
                    (self.sim_lat + 0.0018, self.sim_lon - 0.0015, 35.0, 2),
                    (self.sim_lat + 0.0002, self.sim_lon - 0.0008, 20.0, 3),
                ]
                # Send MISSION_COUNT = 4
                await self.broadcast(
                    self.encoder.pack(
                        MSG_MISSION_COUNT,
                        struct.pack("<HBB", len(self.mock_waypoints), 1, 1),
                    )
                )

            elif (
                msgid in (MSG_MISSION_REQUEST_INT, MSG_MISSION_REQUEST)
                and len(payload) >= 2
            ):
                req_seq = struct.unpack("<H", payload[:2])[0]
                print(f"[MOCK] Received request for WP #{req_seq}...")
                if hasattr(self, "mock_waypoints") and req_seq < len(
                    self.mock_waypoints
                ):
                    lat, lon, alt, seq = self.mock_waypoints[req_seq]
                    item_payload = struct.pack(
                        "<4fiifHBBBBB",
                        0.0,
                        0.0,
                        0.0,
                        0.0,
                        int(lat * 1e7),
                        int(lon * 1e7),
                        float(alt),
                        seq,
                        16,
                        1,
                        1,
                        3,
                        (1 if seq == 0 else 0),
                        1,
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_MISSION_ITEM_INT, item_payload)
                    )

            elif msgid == MSG_MISSION_COUNT and len(payload) >= 5:
                count, _target_sys, _target_comp, m_type = struct.unpack("<HBBB", payload[:5])
                self.mock_mission_upload_count = count
                self.mock_mission_upload_type = m_type
                self.mock_mission_items = []
                print(f"[MOCK] Received MISSION_COUNT = {count} (type={m_type})")
                if count > 0:
                    req_payload = struct.pack("<HBBB", 0, 1, 1, m_type)
                    await self.broadcast(self.encoder.pack(MSG_MISSION_REQUEST_INT, req_payload))
                else:
                    ack_payload = struct.pack("<BBBB", 1, 1, 0, m_type)
                    await self.broadcast(self.encoder.pack(MSG_MISSION_ACK, ack_payload))

            elif msgid == MSG_MISSION_ITEM_INT and len(payload) >= 38:
                seq, cmd = struct.unpack("<HH", payload[28:32])
                m_type = payload[37] if len(payload) > 37 else 0
                self.mock_mission_items.append(payload)
                print(f"[MOCK] Received MISSION_ITEM_INT seq={seq} cmd={cmd}")
                if seq + 1 < getattr(self, "mock_mission_upload_count", 0):
                    req_payload = struct.pack("<HBBB", seq + 1, 1, 1, m_type)
                    await self.broadcast(self.encoder.pack(MSG_MISSION_REQUEST_INT, req_payload))
                else:
                    ack_payload = struct.pack("<BBBB", 1, 1, 0, m_type)
                    await self.broadcast(self.encoder.pack(MSG_MISSION_ACK, ack_payload))
                    status_str = f"Flight plan received: {len(self.mock_mission_items)} items"
                    txt_bytes = status_str.encode("ascii")[:50].ljust(50, b"\x00")
                    await self.broadcast(self.encoder.pack(MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes))

            elif msgid == MSG_MISSION_ACK:
                ack_type = payload[2] if len(payload) > 2 else 0
                print(
                    f"[MOCK] Received MISSION_ACK (type={ack_type}). Waypoint sync complete!"
                )

            elif msgid == MSG_GPS_RTCM_DATA:
                pass  # Successfully accepted RTCM frame in mock

            elif msgid == MSG_FILE_TRANSFER_PROTOCOL and len(payload) >= 15:
                # payload[0]=net, [1]=sys, [2]=comp
                # FTP header at payload[3:]: seq(2), session(1), opcode(1), size(1), req_op(1), burst(1), pad(1), offset(4)
                ftp_data = payload[3:]
                (
                    f_seq,
                    f_session,
                    f_opcode,
                    f_size,
                    _f_req_op,
                    _f_burst,
                    _f_pad,
                    f_offset,
                ) = struct.unpack("<HBBBBBBI", ftp_data[:12])
                f_body = ftp_data[12 : 12 + f_size]

                if f_opcode == 4:  # OpenFileRO
                    filename = f_body.decode("utf-8", errors="ignore").strip("\x00")
                    print(f"[MOCK MAVFTP] OpenFileRO request for: {filename}")
                    if filename in self.mock_files:
                        buf = bytes(self.mock_files[filename])
                        sess_id = 50 + (len(getattr(self, "ftp_files", {})) % 100)
                        self.ftp_files = getattr(self, "ftp_files", {})
                        self.ftp_files[sess_id] = buf
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, sess_id, 128, 4, 4, 0, 0, 0)
                            + struct.pack("<I", len(buf))
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    elif "@PARAM" in filename or "param.pck" in filename:
                        params = [
                            ("BATT_CAPACITY", 5000.0, 4),
                            ("WPNAV_SPEED", 500.0, 4),
                            ("RTL_ALT", 2000.0, 4),
                            ("PILOT_SPEED_UP", 250.0, 4),
                            ("FLTMODE1", 0.0, 4),
                            ("FLTMODE2", 5.0, 4),
                            ("FLTMODE3", 6.0, 4),
                            ("SYSID_THISMAV", 1.0, 4),
                            ("MOT_SPIN_ARM", 0.15, 4),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<HHH", 0x671B, len(params), len(params))
                        last_name = ""
                        for name, val, ptype in params:
                            common_len = 0
                            while (
                                common_len < len(last_name)
                                and common_len < len(name)
                                and last_name[common_len] == name[common_len]
                                and common_len < 15
                            ):
                                common_len += 1
                            suffix = name[common_len:]
                            name_len = len(suffix) - 1
                            plen = (name_len << 4) | (common_len & 0x0F)
                            buf += struct.pack("<BB", ptype, plen)
                            buf += suffix.encode("utf-8")
                            buf += struct.pack("<f", val)
                            last_name = name
                        self.ftp_files = getattr(self, "ftp_files", {})
                        self.ftp_files[1] = bytes(buf)
                        # Return Ack with file size
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, 1, 128, 4, 4, 0, 0, 0)
                            + struct.pack("<I", len(buf))
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    elif "mission.dat" in filename:
                        pts = [
                            (self.sim_lat, self.sim_lon, 0.0, 0),
                            (self.sim_lat + 0.0015, self.sim_lon + 0.0010, 30.0, 1),
                            (self.sim_lat + 0.0018, self.sim_lon - 0.0015, 35.0, 2),
                            (self.sim_lat + 0.0002, self.sim_lon - 0.0008, 20.0, 3),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763D, 0, 0, 0, len(pts))
                        for lat, lon, alt, seq in pts:
                            buf += struct.pack(
                                "<4fiifHHBBBBBB",
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                int(lat * 1e7),
                                int(lon * 1e7),
                                float(alt),
                                seq,
                                16,
                                1,
                                1,
                                3,
                                (1 if seq == 0 else 0),
                                1,
                                0,
                            )
                        self.ftp_files = getattr(self, "ftp_files", {})
                        self.ftp_files[2] = bytes(buf)
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, 2, 128, 4, 4, 0, 0, 0)
                            + struct.pack("<I", len(buf))
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    elif "fence.dat" in filename:
                        # 4 vertices forming an inclusion polygon
                        fpts = [
                            (self.sim_lat + 0.0025, self.sim_lon - 0.0025, 0),
                            (self.sim_lat + 0.0025, self.sim_lon + 0.0025, 1),
                            (self.sim_lat - 0.0025, self.sim_lon + 0.0025, 2),
                            (self.sim_lat - 0.0025, self.sim_lon - 0.0025, 3),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763D, 1, 0, 0, len(fpts))
                        for lat, lon, seq in fpts:
                            # command 5001 = MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION, param1 = 4 (vertex count)
                            buf += struct.pack(
                                "<4fiifHHBBBBBB",
                                4.0,
                                0.0,
                                0.0,
                                0.0,
                                int(lat * 1e7),
                                int(lon * 1e7),
                                0.0,
                                seq,
                                5001,
                                1,
                                1,
                                3,
                                0,
                                1,
                                1,
                            )
                        self.ftp_files = getattr(self, "ftp_files", {})
                        self.ftp_files[3] = bytes(buf)
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, 3, 128, 4, 4, 0, 0, 0)
                            + struct.pack("<I", len(buf))
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    elif "rally.dat" in filename:
                        # 1 rally point
                        rpts = [
                            (self.sim_lat - 0.0010, self.sim_lon + 0.0015, 25.0, 0),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763D, 2, 0, 0, len(rpts))
                        for lat, lon, alt, seq in rpts:
                            # command 5100 = MAV_CMD_NAV_RALLY_POINT
                            buf += struct.pack(
                                "<4fiifHHBBBBBB",
                                0.0,
                                0.0,
                                0.0,
                                0.0,
                                int(lat * 1e7),
                                int(lon * 1e7),
                                float(alt),
                                seq,
                                5100,
                                1,
                                1,
                                3,
                                0,
                                1,
                                2,
                            )
                        self.ftp_files = getattr(self, "ftp_files", {})
                        self.ftp_files[4] = bytes(buf)
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, 4, 128, 4, 4, 0, 0, 0)
                            + struct.pack("<I", len(buf))
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    else:
                        nack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, 0, 129, 1, 4, 0, 0, 0)
                            + bytes([2])
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, nack_payload)
                        )

                elif f_opcode == 15:  # BurstReadFile
                    session_buf = getattr(self, "ftp_files", {}).get(f_session, b"")
                    curr_offset = f_offset
                    chunk_size = 239
                    while curr_offset < len(session_buf):
                        chunk = session_buf[curr_offset : curr_offset + chunk_size]
                        is_last = curr_offset + len(chunk) >= len(session_buf)
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack(
                                "<HBBBBBBI",
                                f_seq,
                                f_session,
                                128,
                                len(chunk),
                                15,
                                (1 if is_last else 0),
                                0,
                                curr_offset,
                            )
                            + chunk
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                        curr_offset += len(chunk)
                    # Send EOF
                    eof_payload = (
                        bytes([0, 1, 1])
                        + struct.pack(
                            "<HBBBBBBI", f_seq, f_session, 129, 1, 15, 1, 0, curr_offset
                        )
                        + bytes([6])
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, eof_payload)
                    )

                elif f_opcode == 5:  # ReadFile
                    session_buf = getattr(self, "ftp_files", {}).get(f_session, b"")
                    chunk = session_buf[f_offset : f_offset + min(f_size, 239)]
                    ack_payload = (
                        bytes([0, 1, 1])
                        + struct.pack(
                            "<HBBBBBBI",
                            f_seq,
                            f_session,
                            128,
                            len(chunk),
                            5,
                            0,
                            0,
                            f_offset,
                        )
                        + chunk
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                    )

                elif f_opcode == 6:  # CreateFile
                    filename = f_body.decode("utf-8", errors="ignore").strip("\x00")
                    print(f"[MOCK MAVFTP] CreateFile: {filename}")
                    sess_id = 20 + (len(self.mock_files) % 100)
                    self.mock_files[filename] = bytearray()
                    self.ftp_files = getattr(self, "ftp_files", {})
                    self.ftp_files[sess_id] = self.mock_files[filename]
                    ack_payload = (
                        bytes([0, 1, 1])
                        + struct.pack("<HBBBBBBI", f_seq, sess_id, 128, 0, 6, 0, 0, 0)
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                    )

                elif f_opcode == 7:  # WriteFile
                    buf = getattr(self, "ftp_files", {}).get(f_session)
                    if buf is not None and isinstance(buf, bytearray):
                        if f_offset > len(buf):
                            buf.extend(b"\x00" * (f_offset - len(buf)))
                        buf[f_offset : f_offset + f_size] = f_body
                        ack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, f_session, 128, 0, 7, 0, 0, f_offset)
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                        )
                    else:
                        nack_payload = (
                            bytes([0, 1, 1])
                            + struct.pack("<HBBBBBBI", f_seq, f_session, 129, 1, 7, 0, 0, f_offset)
                            + bytes([4])
                        )
                        await self.broadcast(
                            self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, nack_payload)
                        )

                elif f_opcode == 2:  # ResetSessions
                    if hasattr(self, "ftp_files"):
                        self.ftp_files.clear()
                    ack_payload = (
                        bytes([0, 1, 1])
                        + struct.pack("<HBBBBBBI", f_seq, 0, 128, 0, 2, 0, 0, 0)
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                    )

                elif f_opcode == 1:  # TerminateSession
                    if hasattr(self, "ftp_files") and f_session in self.ftp_files:
                        self.ftp_files.pop(f_session, None)
                    ack_payload = bytes([0, 1, 1]) + struct.pack(
                        "<HBBBBBBI", f_seq, f_session, 128, 0, 1, 0, 0, 0
                    )
                    await self.broadcast(
                        self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload)
                    )

    async def mock_telemetry_loop(self):
        """Generates realistic ArduPilot telemetry stream"""
        print("[MOCK] Starting mock telemetry generator...")
        step = 0
        while True:
            await asyncio.sleep(0.05)  # 20Hz loop tick
            now = time.time()
            elapsed = now - self.sim_start_time
            step += 1

            # 1Hz: Heartbeat & SysStatus & Battery
            if step % 20 == 0:
                # HEARTBEAT
                # base_mode: 0x80 (armed flag) if armed
                base_mode = 0x80 | 0x01 if self.armed else 0x01
                hb = struct.pack(
                    "<IBBBBB", self.flight_mode, 2, 3, base_mode, 4, 3
                )  # Quad, ArduPilot, Active
                await self.broadcast(self.encoder.pack(MSG_HEARTBEAT, hb))

                # SYS_STATUS
                load = 180  # 18.0%
                v_bat = int(self.sim_voltage * 1000)
                c_bat = 450 if self.armed else 45  # 4.5A or 0.45A in 10mA units
                sys_st = struct.pack(
                    "<IIIHHhHHHHHHb",
                    0xFFFFFFFF,
                    0xFFFFFFFF,
                    0xFFFFFFFF,
                    load,
                    v_bat,
                    c_bat,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    int(self.sim_battery_pct),
                )
                await self.broadcast(self.encoder.pack(MSG_SYS_STATUS, sys_st))

                # BATTERY_STATUS
                bat_st = struct.pack(
                    "<iih10HhBBBb",
                    int(elapsed * 5),
                    int(elapsed * 20),
                    2500,
                    v_bat,
                    *([65535] * 9),
                    c_bat,
                    0,
                    0,
                    1,
                    int(self.sim_battery_pct),
                )
                await self.broadcast(self.encoder.pack(MSG_BATTERY_STATUS, bat_st))

                # Slowly discharge battery
                self.sim_battery_pct = max(10, 95 - (elapsed / 60.0))
                self.sim_voltage = max(14.2, 16.4 - (elapsed / 300.0))

            # 10Hz: Attitude
            if step % 2 == 0:
                roll = math.sin(elapsed * 0.8) * 0.15
                pitch = math.cos(elapsed * 0.6) * 0.12
                yaw = (elapsed * 0.05) % (2 * math.pi)
                att = struct.pack(
                    "<I6f", int(elapsed * 1000), roll, pitch, yaw, 0.01, 0.01, 0.05
                )
                await self.broadcast(self.encoder.pack(MSG_ATTITUDE, att))

            # 5Hz: VFR_HUD (airspeed, groundspeed, alt, climb, heading, throttle)
            if step % 4 == 0:
                gs = 5.2 if self.armed else 0.0
                climb = math.sin(elapsed * 0.5) * 0.8
                throttle = 45 if self.armed else 0
                heading = int(math.degrees((elapsed * 0.05) % (2 * math.pi)))
                hud = struct.pack(
                    "<ffffhH", gs, gs, self.sim_alt, climb, heading, throttle
                )
                await self.broadcast(self.encoder.pack(MSG_VFR_HUD, hud))

            # 2Hz: Global Position & GPS
            if step % 10 == 0:
                if self.armed:
                    self.sim_lat += 0.000005 * math.cos(elapsed * 0.1)
                    self.sim_lon += 0.000005 * math.sin(elapsed * 0.1)
                    self.sim_alt = 45.0 + 5.0 * math.sin(elapsed * 0.2)

                lat_i = int(self.sim_lat * 1e7)
                lon_i = int(self.sim_lon * 1e7)
                alt_i = int(self.sim_alt * 1000)
                hdg_u = int(((elapsed * 0.05) % (2 * math.pi)) * 180 / math.pi * 100)
                pos = struct.pack(
                    "<IiiiihhhH",
                    int(elapsed * 1000),
                    lat_i,
                    lon_i,
                    alt_i,
                    alt_i,
                    50,
                    0,
                    0,
                    hdg_u,
                )
                await self.broadcast(self.encoder.pack(MSG_GLOBAL_POSITION_INT, pos))

                # GPS_RAW_INT (time_usec, lat, lon, alt, eph, epv, vel, cog, fix_type, satellites_visible, alt_ellipsoid, h_acc, v_acc, vel_acc, hdg_acc, yaw)
                gps = struct.pack(
                    "<QiiiHHHHBBiIIIIH",
                    int(now * 1e6),
                    lat_i,
                    lon_i,
                    alt_i,
                    85,
                    120,
                    520,
                    hdg_u,
                    3,
                    14,
                    alt_i,
                    150,
                    200,
                    50,
                    100,
                    hdg_u,
                )
                await self.broadcast(self.encoder.pack(MSG_GPS_RAW_INT, gps))

                # GPS2_RAW (time_usec, lat, lon, alt, dgps_age, eph, epv, vel, cog, fix_type, satellites_visible, dgps_numch, yaw)
                gps2 = struct.pack(
                    "<QiiiIHHHHBBBH",
                    int(now * 1e6),
                    lat_i,
                    lon_i,
                    alt_i,
                    0,
                    65,
                    95,
                    515,
                    hdg_u,
                    6,
                    18,
                    0,
                    hdg_u,
                )
                await self.broadcast(self.encoder.pack(MSG_GPS2_RAW, gps2))

                # RC_CHANNELS & SERVO_OUTPUT_RAW & WIND & VIBRATION & EKF & RANGEFINDER & ESC
                ch1 = int(1500 + 200 * math.sin(elapsed * 0.8))
                ch2 = int(1500 + 180 * math.cos(elapsed * 0.6))
                ch3 = 1580 if self.armed else 1000
                ch4 = int(1500 + 80 * math.sin(elapsed * 0.4))
                rc_chans = [ch1, ch2, ch3, ch4, 1500, 1800, 1200, 1500] + [1500] * 10
                rc_pkt = struct.pack("<I18HBB", int(elapsed * 1000), *rc_chans, 16, 92)
                await self.broadcast(self.encoder.pack(MSG_RC_CHANNELS, rc_pkt))

                s_base = 1520 if self.armed else 1100
                servos = [
                    int(s_base + 40 * math.sin(elapsed + i)) for i in range(4)
                ] + [1500] * 12
                srv_pkt = struct.pack(
                    "<I8HB8H", int(now * 1e6) & 0xFFFFFFFF, *servos[:8], 0, *servos[8:]
                )
                await self.broadcast(self.encoder.pack(MSG_SERVO_OUTPUT_RAW, srv_pkt))

                nav_pkt = struct.pack(
                    "<fffffhhH",
                    math.degrees(math.sin(elapsed * 0.8) * 0.15),
                    math.degrees(math.cos(elapsed * 0.6) * 0.12),
                    1.2 * math.sin(elapsed * 0.3),
                    0.3,
                    0.8 * math.cos(elapsed * 0.2),
                    int((elapsed * 3) % 360),
                    int(((elapsed * 3) + 12) % 360),
                    145,
                )
                await self.broadcast(
                    self.encoder.pack(MSG_NAV_CONTROLLER_OUTPUT, nav_pkt)
                )

                wind_pkt = struct.pack(
                    "<fff",
                    (245.0 + 5.0 * math.sin(elapsed * 0.1)) % 360.0,
                    4.2 + 0.6 * math.cos(elapsed * 0.2),
                    -0.2,
                )
                await self.broadcast(self.encoder.pack(MSG_WIND, wind_pkt))

                vibe_pkt = struct.pack(
                    "<QfffIII",
                    int(now * 1e6),
                    4.5 + abs(math.sin(elapsed)),
                    5.1 + abs(math.cos(elapsed)),
                    7.8 + abs(math.sin(elapsed * 0.7)),
                    0,
                    0,
                    0,
                )
                await self.broadcast(self.encoder.pack(MSG_VIBRATION, vibe_pkt))

                ekf_pkt = struct.pack(
                    "<fffffHf", 0.08, 0.12, 0.09, 0.05, 0.04, 0x01FF, 0.02
                )
                await self.broadcast(self.encoder.pack(MSG_EKF_STATUS_REPORT, ekf_pkt))

                rf_pkt = struct.pack("<ff", max(0.5, self.sim_alt * 0.8), 2.4)
                await self.broadcast(self.encoder.pack(MSG_RANGEFINDER, rf_pkt))

                rpm_val = 4850.0 if self.armed else 0.0
                rpm_pkt = struct.pack("<ff", rpm_val, rpm_val + 40.0)
                await self.broadcast(self.encoder.pack(MSG_RPM, rpm_pkt))

                esc_v = [int(self.sim_voltage * 100)] * 4
                esc_c = [(450 if self.armed else 10)] * 4
                esc_tc = [int(elapsed * 2)] * 4
                esc_r = [int(rpm_val + i * 25) if self.armed else 0 for i in range(4)]
                esc_cnt = [int(step)] * 4
                esc_t = [38, 40, 39, 41]
                esc_pkt = struct.pack(
                    "<4H4H4H4H4H4B", *esc_v, *esc_c, *esc_tc, *esc_r, *esc_cnt, *esc_t
                )
                await self.broadcast(
                    self.encoder.pack(MSG_ESC_TELEMETRY_1_TO_4, esc_pkt)
                )

                pwr_pkt = struct.pack("<HHH", 5020, 5150, 1)
                await self.broadcast(self.encoder.pack(MSG_POWER_STATUS, pwr_pkt))

                press_pkt = struct.pack(
                    "<Iffhh", int(elapsed * 1000), 1013.25, 0.12, 2850, 2800
                )
                await self.broadcast(self.encoder.pack(MSG_SCALED_PRESSURE, press_pkt))

    async def setup_udp(self):
        parts = self.target.split(":")
        target_ip = parts[0]
        target_port = int(parts[1]) if len(parts) > 1 else 14550

        loop = asyncio.get_running_loop()

        class UdpProtocol(asyncio.DatagramProtocol):
            def __init__(self, server):
                self.server = server

            def datagram_received(self, data, addr):
                self.server.udp_target = addr
                asyncio.create_task(self.server.broadcast(data))

            def error_received(self, exc):
                print(f"[UDP] Error: {exc}")

        self.udp_target = (target_ip, target_port)
        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: UdpProtocol(self), local_addr=("0.0.0.0", target_port)
            )
            self.transport = transport
            print(
                f"[UDP] Listening on 0.0.0.0:{target_port}, target {target_ip}:{target_port}"
            )
        except Exception:  # noqa: BLE001
            # Fallback if port already in use (e.g., connect mode)
            transport, _ = await loop.create_datagram_endpoint(
                lambda: UdpProtocol(self), remote_addr=(target_ip, target_port)
            )
            self.transport = transport
            print(f"[UDP] Connected to {target_ip}:{target_port}")

    async def setup_tcp(self):
        parts = self.target.split(":")
        tcp_ip = parts[0]
        tcp_port = int(parts[1]) if len(parts) > 1 else 5760
        print(f"[TCP] Connecting to {tcp_ip}:{tcp_port}...")
        while True:
            try:
                reader, writer = await asyncio.open_connection(tcp_ip, tcp_port)
                self.transport = writer
                print(f"[TCP] Connected to {tcp_ip}:{tcp_port}")
                while True:
                    data = await reader.read(4096)
                    if not data:
                        break
                    await self.broadcast(data)
            except Exception as e:  # noqa: BLE001
                print(f"[TCP] Connection failed ({e}), retrying in 2s...")
                await asyncio.sleep(2)

    async def setup_serial(self):
        try:
            import serial  # pyright: ignore[reportMissingImports,reportMissingModuleSource]
        except ImportError:
            print("[SERIAL] Error: pyserial is not installed. Please install pyserial.")
            return

        parts = self.target.split(":")
        port = parts[0]
        baud = int(parts[1]) if len(parts) > 1 else 57600
        loop = asyncio.get_running_loop()
        while True:
            try:
                print(f"[SERIAL] Opening {port} at {baud} baud...")
                ser = serial.Serial(port, baud, timeout=0.1)
                self.serial_conn = ser
                print(f"[SERIAL] Connected to {port} at {baud} baud")
                while True:
                    data = await loop.run_in_executor(None, ser.read, 1024)
                    if data:
                        await self.broadcast(data)
            except Exception as e:  # noqa: BLE001
                self.serial_conn = None
                print(f"[SERIAL] Connection error ({e}), retrying in 2s...")
                await asyncio.sleep(2)

    async def run(self):
        origins_arg = (
            None
            if (self.allowed_origins and "*" in self.allowed_origins)
            else self.allowed_origins
        )
        await websockets.serve(
            self.ws_handler, self.host, self.port, origins=origins_arg
        )
        print("============================================================")
        print(f" MAVLink Glareshield Bridge running on ws://{self.host}:{self.port}")
        print(
            f" Mode: {self.mode.upper()} {f'-> {self.target}' if self.target else ''}"
        )
        print("============================================================")

        if self.mode == "mock":
            await self.mock_telemetry_loop()
        elif self.mode == "udp":
            await self.setup_udp()
            await asyncio.Future()
        elif self.mode == "tcp":
            await self.setup_tcp()
        elif self.mode == "serial":
            await self.setup_serial()


def main():
    parser = argparse.ArgumentParser(description="MAVLink WebSocket Bridge & Simulator")
    parser.add_argument(
        "--host", default="127.0.0.1", help="WebSocket bind host (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", type=int, default=56781, help="WebSocket bind port (default: 56781)"
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        dest="allowed_origins",
        help="Allowed WebSocket Origin (e.g. 'http://my-domain:5173' or '*' for any origin). Can be passed multiple times.",
    )
    parser.add_argument(
        "--allow-all-origins",
        action="store_true",
        help="Allow WebSocket connections from any Origin (*)",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--mock", action="store_true", help="Run simulated ArduPilot mock telemetry"
    )
    group.add_argument(
        "--udp", type=str, help="Connect to UDP MAVLink target (e.g. 127.0.0.1:14550)"
    )
    group.add_argument(
        "--tcp", type=str, help="Connect to TCP MAVLink target (e.g. 127.0.0.1:5760)"
    )
    group.add_argument(
        "--serial", type=str, help="Connect to Serial port (e.g. /dev/ttyUSB0:57600)"
    )

    args = parser.parse_args()

    mode = "mock"
    target = ""
    if args.udp:
        mode = "udp"
        target = args.udp
    elif args.tcp:
        mode = "tcp"
        target = args.tcp
    elif args.serial:
        mode = "serial"
        target = args.serial

    allowed_origins = list(DEFAULT_ALLOWED_ORIGINS)
    if args.allow_all_origins:
        allowed_origins = ["*"]
    elif args.allowed_origins:
        if "*" in args.allowed_origins:
            allowed_origins = ["*"]
        else:
            allowed_origins.extend(args.allowed_origins)

    server = BridgeServer(
        args.host, args.port, mode, target, allowed_origins=allowed_origins
    )
    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        print("\nBridge stopped.")


if __name__ == "__main__":
    main()
