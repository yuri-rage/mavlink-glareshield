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
import math
import socket
import struct
import sys
import time
from typing import Set
import websockets

# Message IDs
MSG_HEARTBEAT = 0
MSG_SYS_STATUS = 1
MSG_PARAM_REQUEST_LIST = 21
MSG_PARAM_VALUE = 22
MSG_GPS_RAW_INT = 24
MSG_ATTITUDE = 30
MSG_GLOBAL_POSITION_INT = 33
MSG_MISSION_ITEM = 39
MSG_MISSION_REQUEST = 40
MSG_MISSION_REQUEST_LIST = 43
MSG_MISSION_COUNT = 44
MSG_MISSION_ACK = 47
MSG_MISSION_REQUEST_INT = 51
MSG_MISSION_ITEM_INT = 73
MSG_COMMAND_LONG = 76
MSG_COMMAND_ACK = 77
MSG_VFR_HUD = 74
MSG_FILE_TRANSFER_PROTOCOL = 110
MSG_BATTERY_STATUS = 147
MSG_STATUSTEXT = 253

# CRC Extra seeds
CRC_EXTRA = {
    MSG_HEARTBEAT: 50,
    MSG_SYS_STATUS: 124,
    MSG_PARAM_VALUE: 220,
    MSG_GPS_RAW_INT: 24,
    MSG_ATTITUDE: 39,
    MSG_GLOBAL_POSITION_INT: 104,
    MSG_MISSION_ITEM: 254,
    MSG_MISSION_REQUEST: 230,
    MSG_MISSION_REQUEST_LIST: 132,
    MSG_MISSION_COUNT: 221,
    MSG_MISSION_ACK: 153,
    MSG_MISSION_REQUEST_INT: 196,
    MSG_MISSION_ITEM_INT: 38,
    MSG_COMMAND_LONG: 152,
    MSG_COMMAND_ACK: 143,
    MSG_VFR_HUD: 20,
    MSG_FILE_TRANSFER_PROTOCOL: 84,
    MSG_BATTERY_STATUS: 154,
    MSG_STATUSTEXT: 83,
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
        header = struct.pack(
            "<BBBBBBBIB",
            0xFD,           # Magic
            len(payload),   # Length
            0,              # Incompat flags
            0,              # Compat flags
            seq,
            self.sysid,
            self.compid,
            msgid & 0xFF,
            (msgid >> 8) & 0xFF
        ) + bytes([(msgid >> 16) & 0xFF])
        # Note: struct <BBBBBBBIB has 10 bytes:
        # Magic (1), Len (1), Incompat (1), Compat (1), Seq (1), Sysid (1), Compid (1), MsgId (3 bytes)
        # Let's pack exactly 10 bytes:
        hdr = bytes([
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
        ])
        body = hdr[1:] + payload
        crc = calculate_crc(body, CRC_EXTRA.get(msgid, 0))
        return hdr + payload + struct.pack("<H", crc)

class BridgeServer:
    def __init__(self, host: str, port: int, mode: str, target: str):
        self.host = host
        self.port = port
        self.mode = mode
        self.target = target
        self.clients: Set[websockets.WebSocketServerProtocol] = set()
        self.encoder = MavlinkV2Encoder(sysid=1, compid=1)
        self.transport = None

        # Vehicle simulated state
        self.armed = False
        self.flight_mode = 0  # STABILIZE
        self.sim_lat = 37.7749
        self.sim_lon = -122.4194
        self.sim_alt = 45.0
        self.sim_battery_pct = 95
        self.sim_voltage = 16.4
        self.sim_start_time = time.time()

    async def broadcast(self, data: bytes):
        if not self.clients:
            return
        dead = []
        for client in self.clients:
            try:
                await client.send(data)
            except Exception:
                dead.append(client)
        for d in dead:
            self.clients.discard(d)

    async def ws_handler(self, websocket):
        self.clients.add(websocket)
        print(f"[WS] Client connected from {websocket.remote_address}. Active: {len(self.clients)}")
        if self.mode == "mock":
            # Send initial boot status messages
            boot_messages = [
                (6, "ArduCopter V4.5.2 (78057ebe)"),
                (6, "ChibiOS: 6a85082c"),
                (6, "EKF3 IMU0 initialised"),
                (6, "GPS 1: detected as u-blox at 115200 baud"),
                (5, "Arm: Safety switch engaged"),
            ]
            for sev, txt in boot_messages:
                txt_bytes = txt.encode('ascii')[:50].ljust(50, b'\x00')
                try:
                    await websocket.send(self.encoder.pack(MSG_STATUSTEXT, struct.pack("<B", sev) + txt_bytes))
                except Exception:
                    pass
        try:
            async for message in websocket:
                if isinstance(message, bytes):
                    if self.mode == "mock":
                        await self.handle_mock_command(message)
                    elif self.transport:
                        self.send_to_vehicle(message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"[WS] Client disconnected. Active: {len(self.clients)}")

    def send_to_vehicle(self, data: bytes):
        if self.mode == "udp" and self.transport:
            self.transport.sendto(data, self.udp_target)
        elif self.mode == "tcp" and self.transport:
            self.transport.write(data)
        elif self.mode == "serial" and self.serial_conn:
            self.serial_conn.write(data)

    async def handle_mock_command(self, data: bytes):
        # Inspect MAVLink message ID
        if len(data) >= 10 and data[0] == 0xFD:
            msgid = data[7] | (data[8] << 8) | (data[9] << 16)
            payload = data[10:-2]

            if msgid == MSG_COMMAND_LONG and len(payload) >= 33:
                # COMMAND_LONG unpack
                p1, p2, p3, p4, p5, p6, p7 = struct.unpack("<7f", payload[:28])
                cmd, target_sys, target_comp, conf = struct.unpack("<HBBB", payload[28:33])

                if cmd == 400: # MAV_CMD_COMPONENT_ARM_DISARM
                    self.armed = (p1 == 1.0)
                    print(f"[MOCK] Vehicle {'ARMED' if self.armed else 'DISARMED'}")
                    # Send ACK
                    ack_payload = struct.pack("<HBBIBB", 400, 0, 0, 0, 1, 1) # 0 = MAV_RESULT_ACCEPTED
                    await self.broadcast(self.encoder.pack(MSG_COMMAND_ACK, ack_payload))
                    # Send STATUSTEXT
                    status_str = f"Throttle {'armed' if self.armed else 'disarmed'}"
                    txt_bytes = status_str.encode('ascii')[:50].ljust(50, b'\x00')
                    await self.broadcast(self.encoder.pack(MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes))

                elif cmd == 176: # MAV_CMD_DO_SET_MODE
                    mode_num = int(p2)
                    self.flight_mode = mode_num
                    print(f"[MOCK] Flight mode changed to {mode_num}")
                    ack_payload = struct.pack("<HBBIBB", 176, 0, 0, 0, 1, 1)
                    await self.broadcast(self.encoder.pack(MSG_COMMAND_ACK, ack_payload))
                    mode_name = "STABILIZE" if mode_num == 0 else "ALT_HOLD" if mode_num == 2 else "AUTO" if mode_num == 3 else "GUIDED" if mode_num == 4 else "LOITER" if mode_num == 5 else "RTL" if mode_num == 6 else f"MODE_{mode_num}"
                    txt_bytes = f"Flight mode set to {mode_name}".encode('ascii')[:50].ljust(50, b'\x00')
                    await self.broadcast(self.encoder.pack(MSG_STATUSTEXT, struct.pack("<B", 6) + txt_bytes))

            elif msgid == MSG_PARAM_REQUEST_LIST:
                print("[MOCK] Received PARAM_REQUEST_LIST. Streaming sample parameters...")
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
                    id_bytes = p_id.encode('ascii')[:16].ljust(16, b'\x00')
                    val_bytes = struct.pack("<fHH", p_val, len(sample_params), idx) + id_bytes + struct.pack("<B", p_type)
                    await self.broadcast(self.encoder.pack(MSG_PARAM_VALUE, val_bytes))
                    await asyncio.sleep(0.02)

            elif msgid == MSG_MISSION_REQUEST_LIST:
                print("[MOCK] Received MISSION_REQUEST_LIST. Sending MISSION_COUNT = 4...")
                # Prepare mock mission waypoints around current vehicle location
                self.mock_waypoints = [
                    (self.sim_lat, self.sim_lon, 0.0, 0),
                    (self.sim_lat + 0.0015, self.sim_lon + 0.0010, 30.0, 1),
                    (self.sim_lat + 0.0018, self.sim_lon - 0.0015, 35.0, 2),
                    (self.sim_lat + 0.0002, self.sim_lon - 0.0008, 20.0, 3),
                ]
                # Send MISSION_COUNT = 4
                await self.broadcast(self.encoder.pack(MSG_MISSION_COUNT, struct.pack("<HBB", len(self.mock_waypoints), 1, 1)))

            elif msgid in (MSG_MISSION_REQUEST_INT, MSG_MISSION_REQUEST) and len(payload) >= 2:
                req_seq = struct.unpack("<H", payload[:2])[0]
                print(f"[MOCK] Received request for WP #{req_seq}...")
                if hasattr(self, 'mock_waypoints') and req_seq < len(self.mock_waypoints):
                    lat, lon, alt, seq = self.mock_waypoints[req_seq]
                    item_payload = struct.pack(
                        "<4fiifHBBBBB",
                        0.0, 0.0, 0.0, 0.0,
                        int(lat * 1e7), int(lon * 1e7), float(alt),
                        seq, 16, 1, 1, 3, (1 if seq == 0 else 0), 1
                    )
                    await self.broadcast(self.encoder.pack(MSG_MISSION_ITEM_INT, item_payload))

            elif msgid == MSG_MISSION_ACK:
                ack_type = payload[2] if len(payload) > 2 else 0
                print(f"[MOCK] Received MISSION_ACK (type={ack_type}). Waypoint sync complete!")

            elif msgid == MSG_FILE_TRANSFER_PROTOCOL and len(payload) >= 15:
                # payload[0]=net, [1]=sys, [2]=comp
                # FTP header at payload[3:]: seq(2), session(1), opcode(1), size(1), req_op(1), burst(1), pad(1), offset(4)
                ftp_data = payload[3:]
                f_seq, f_session, f_opcode, f_size, f_req_op, f_burst, f_pad, f_offset = struct.unpack("<HBBBBBBI", ftp_data[:12])
                f_body = ftp_data[12:12+f_size]

                if f_opcode == 4: # OpenFileRO
                    filename = f_body.decode('utf-8', errors='ignore').strip('\x00')
                    print(f"[MOCK MAVFTP] OpenFileRO request for: {filename}")
                    if "@PARAM" in filename or "param.pck" in filename:
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
                        buf += struct.pack("<HHH", 0x671b, len(params), len(params))
                        last_name = ""
                        for name, val, ptype in params:
                            common_len = 0
                            while common_len < len(last_name) and common_len < len(name) and last_name[common_len] == name[common_len] and common_len < 15:
                                common_len += 1
                            suffix = name[common_len:]
                            name_len = len(suffix) - 1
                            plen = (name_len << 4) | (common_len & 0x0F)
                            buf += struct.pack("<BB", ptype, plen)
                            buf += suffix.encode("utf-8")
                            buf += struct.pack("<f", val)
                            last_name = name
                        self.ftp_files = getattr(self, 'ftp_files', {})
                        self.ftp_files[1] = bytes(buf)
                        # Return Ack with file size
                        ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, 1, 128, 4, 4, 0, 0, 0) + struct.pack("<I", len(buf))
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))
                    elif "mission.dat" in filename:
                        pts = [
                            (self.sim_lat, self.sim_lon, 0.0, 0),
                            (self.sim_lat + 0.0015, self.sim_lon + 0.0010, 30.0, 1),
                            (self.sim_lat + 0.0018, self.sim_lon - 0.0015, 35.0, 2),
                            (self.sim_lat + 0.0002, self.sim_lon - 0.0008, 20.0, 3),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763d, 0, 0, 0, len(pts))
                        for lat, lon, alt, seq in pts:
                            buf += struct.pack("<4fiifHHBBBBBB", 0.0, 0.0, 0.0, 0.0, int(lat*1e7), int(lon*1e7), float(alt), seq, 16, 1, 1, 3, (1 if seq == 0 else 0), 1, 0)
                        self.ftp_files = getattr(self, 'ftp_files', {})
                        self.ftp_files[2] = bytes(buf)
                        ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, 2, 128, 4, 4, 0, 0, 0) + struct.pack("<I", len(buf))
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))
                    elif "fence.dat" in filename:
                        # 4 vertices forming an inclusion polygon
                        fpts = [
                            (self.sim_lat + 0.0025, self.sim_lon - 0.0025, 0),
                            (self.sim_lat + 0.0025, self.sim_lon + 0.0025, 1),
                            (self.sim_lat - 0.0025, self.sim_lon + 0.0025, 2),
                            (self.sim_lat - 0.0025, self.sim_lon - 0.0025, 3),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763d, 1, 0, 0, len(fpts))
                        for lat, lon, seq in fpts:
                            # command 5001 = MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION, param1 = 4 (vertex count)
                            buf += struct.pack("<4fiifHHBBBBBB", 4.0, 0.0, 0.0, 0.0, int(lat*1e7), int(lon*1e7), 0.0, seq, 5001, 1, 1, 3, 0, 1, 1)
                        self.ftp_files = getattr(self, 'ftp_files', {})
                        self.ftp_files[3] = bytes(buf)
                        ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, 3, 128, 4, 4, 0, 0, 0) + struct.pack("<I", len(buf))
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))
                    elif "rally.dat" in filename:
                        # 1 rally point
                        rpts = [
                            (self.sim_lat - 0.0010, self.sim_lon + 0.0015, 25.0, 0),
                        ]
                        buf = bytearray()
                        buf += struct.pack("<5H", 0x763d, 2, 0, 0, len(rpts))
                        for lat, lon, alt, seq in rpts:
                            # command 5100 = MAV_CMD_NAV_RALLY_POINT
                            buf += struct.pack("<4fiifHHBBBBBB", 0.0, 0.0, 0.0, 0.0, int(lat*1e7), int(lon*1e7), float(alt), seq, 5100, 1, 1, 3, 0, 1, 2)
                        self.ftp_files = getattr(self, 'ftp_files', {})
                        self.ftp_files[4] = bytes(buf)
                        ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, 4, 128, 4, 4, 0, 0, 0) + struct.pack("<I", len(buf))
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))
                    else:
                        nack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, 0, 129, 1, 4, 0, 0, 0) + bytes([2])
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, nack_payload))

                elif f_opcode == 15: # BurstReadFile
                    session_buf = getattr(self, 'ftp_files', {}).get(f_session, b"")
                    curr_offset = f_offset
                    chunk_size = 239
                    while curr_offset < len(session_buf):
                        chunk = session_buf[curr_offset:curr_offset+chunk_size]
                        is_last = (curr_offset + len(chunk) >= len(session_buf))
                        ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, f_session, 128, len(chunk), 15, (1 if is_last else 0), 0, curr_offset) + chunk
                        await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))
                        curr_offset += len(chunk)
                    # Send EOF
                    eof_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, f_session, 129, 1, 15, 1, 0, curr_offset) + bytes([6])
                    await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, eof_payload))

                elif f_opcode == 5: # ReadFile
                    session_buf = getattr(self, 'ftp_files', {}).get(f_session, b"")
                    chunk = session_buf[f_offset:f_offset+min(f_size, 239)]
                    ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, f_session, 128, len(chunk), 5, 0, 0, f_offset) + chunk
                    await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))

                elif f_opcode == 1: # TerminateSession
                    ack_payload = bytes([0, 1, 1]) + struct.pack("<HBBBBBBI", f_seq, f_session, 128, 0, 1, 0, 0, 0)
                    await self.broadcast(self.encoder.pack(MSG_FILE_TRANSFER_PROTOCOL, ack_payload))

    async def mock_telemetry_loop(self):
        """Generates realistic ArduPilot telemetry stream"""
        print("[MOCK] Starting mock telemetry generator...")
        step = 0
        while True:
            await asyncio.sleep(0.05) # 20Hz loop tick
            now = time.time()
            elapsed = now - self.sim_start_time
            step += 1

            # 1Hz: Heartbeat & SysStatus & Battery
            if step % 20 == 0:
                # HEARTBEAT
                # base_mode: 0x80 (armed flag) if armed
                base_mode = 0x80 | 0x01 if self.armed else 0x01
                hb = struct.pack("<IBBBBB", self.flight_mode, 2, 3, base_mode, 4, 3) # Quad, ArduPilot, Active
                await self.broadcast(self.encoder.pack(MSG_HEARTBEAT, hb))

                # SYS_STATUS
                load = int(180) # 18.0%
                v_bat = int(self.sim_voltage * 1000)
                c_bat = int(450 if self.armed else 45) # 4.5A or 0.45A
                sys_st = struct.pack("<IIIHHhHhh", 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, load, v_bat, c_bat, int(self.sim_battery_pct), 0, 0)
                await self.broadcast(self.encoder.pack(MSG_SYS_STATUS, sys_st))

                # BATTERY_STATUS
                bat_st = bytes(14) + struct.pack("<10H", v_bat, 0, 0, 0, 0, 0, 0, 0, 0, 0) + struct.pack("<hiiB", c_bat, int(elapsed * 5), int(elapsed * 20), int(self.sim_battery_pct))
                await self.broadcast(self.encoder.pack(MSG_BATTERY_STATUS, bat_st))

                # Slowly discharge battery
                self.sim_battery_pct = max(10, 95 - (elapsed / 60.0))
                self.sim_voltage = max(14.2, 16.4 - (elapsed / 300.0))

            # 10Hz: Attitude
            if step % 2 == 0:
                roll = math.sin(elapsed * 0.8) * 0.15
                pitch = math.cos(elapsed * 0.6) * 0.12
                yaw = (elapsed * 0.05) % (2 * math.pi)
                att = struct.pack("<I6f", int(elapsed * 1000), roll, pitch, yaw, 0.01, 0.01, 0.05)
                await self.broadcast(self.encoder.pack(MSG_ATTITUDE, att))

            # 5Hz: VFR_HUD
            if step % 4 == 0:
                gs = 5.2 if self.armed else 0.0
                climb = math.sin(elapsed * 0.5) * 0.8
                throttle = 45 if self.armed else 0
                hud = struct.pack("<ffhHff", gs, gs, int(math.degrees((elapsed * 0.05) % (2 * math.pi))), throttle, self.sim_alt, climb)
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
                pos = struct.pack("<IiiiihhhH", int(elapsed * 1000), lat_i, lon_i, alt_i, alt_i, 50, 0, 0, hdg_u)
                await self.broadcast(self.encoder.pack(MSG_GLOBAL_POSITION_INT, pos))

                # GPS_RAW_INT (3D Fix, 14 satellites, HDOP 0.85)
                gps = struct.pack("<QBi2i2H2HB", int(now * 1e6), 3, lat_i, lon_i, alt_i, 85, 120, 520, int(hdg_u / 100), 14)
                await self.broadcast(self.encoder.pack(MSG_GPS_RAW_INT, gps))

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
                lambda: UdpProtocol(self),
                local_addr=("0.0.0.0", target_port)
            )
            self.transport = transport
            print(f"[UDP] Listening on 0.0.0.0:{target_port}, target {target_ip}:{target_port}")
        except Exception as e:
            # Fallback if port already in use (e.g., connect mode)
            transport, _ = await loop.create_datagram_endpoint(
                lambda: UdpProtocol(self),
                remote_addr=(target_ip, target_port)
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
            except Exception as e:
                print(f"[TCP] Connection failed ({e}), retrying in 2s...")
                await asyncio.sleep(2)

    async def setup_serial(self):
        import serial
        parts = self.target.split(":")
        port = parts[0]
        baud = int(parts[1]) if len(parts) > 1 else 57600
        print(f"[SERIAL] Opening {port} at {baud} baud...")
        ser = serial.Serial(port, baud, timeout=0.1)
        self.serial_conn = ser
        loop = asyncio.get_running_loop()
        while True:
            data = await loop.run_in_executor(None, ser.read, 1024)
            if data:
                await self.broadcast(data)

    async def run(self):
        ws_server = await websockets.serve(self.ws_handler, self.host, self.port)
        print(f"============================================================")
        print(f" MAVLink Glareshield Bridge running on ws://{self.host}:{self.port}")
        print(f" Mode: {self.mode.upper()} {f'-> {self.target}' if self.target else ''}")
        print(f"============================================================")

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
    parser.add_argument("--host", default="0.0.0.0", help="WebSocket bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=56781, help="WebSocket bind port (default: 56781)")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--mock", action="store_true", help="Run simulated ArduPilot mock telemetry")
    group.add_argument("--udp", type=str, help="Connect to UDP MAVLink target (e.g. 127.0.0.1:14550)")
    group.add_argument("--tcp", type=str, help="Connect to TCP MAVLink target (e.g. 127.0.0.1:5760)")
    group.add_argument("--serial", type=str, help="Connect to Serial port (e.g. /dev/ttyUSB0:57600)")

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

    server = BridgeServer(args.host, args.port, mode, target)
    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        print("\nBridge stopped.")

if __name__ == "__main__":
    main()
