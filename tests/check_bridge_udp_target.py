#!/usr/bin/env python3
"""
UDP reply-target checks for bridge/bridge.py.

In UDP mode the bridge learns where to send Glareshield's traffic (its GCS heartbeat and every
command) from incoming datagrams. When another GCS (e.g. Mission Planner) shares the same
telemetry port, any packet it sends to the bridge must not become the reply target. Otherwise
Glareshield's commands go to Mission Planner instead of the vehicle, and Mission Planner's
AutoConnect treats the bridge as a new vehicle.

Starts the bridge in UDP listen mode on spare local ports, plays simulated vehicles and a
simulated second GCS, and records which ones receive Glareshield's commands. Also checks that
vehicle endpoints are not locked permanently: a second vehicle on the same port is served, a
silent vehicle expires, and a returning one is picked up again (takes about 15 s).

Usage:
    pip install pymavlink websockets
    python3 tests/check_bridge_udp_target.py

Exits 0 if every check passes, 1 otherwise.
"""

import asyncio
import os
import socket
import subprocess
import sys
import time

os.environ["MAVLINK20"] = "1"
from pymavlink.dialects.v20 import ardupilotmega as mav

try:
    import websockets
except ImportError:
    sys.exit("This check needs the websockets package: pip install websockets")

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BRIDGE = os.path.join(REPO, "bridge", "bridge.py")
EXPIRY_S = 10.0  # bridge.UDP_VEHICLE_TIMEOUT_S
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def free_port(kind: int = socket.SOCK_STREAM) -> int:
    with socket.socket(socket.AF_INET, kind) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Peer:
    """A UDP endpoint (vehicle or GCS) that sends MAVLink to the bridge and counts what comes back."""

    def __init__(self, sysid: int, compid: int, mav_type: int, autopilot: int):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.05)
        self.mav = mav.MAVLink(None, srcSystem=sysid, srcComponent=compid)
        self.mav_type, self.autopilot = mav_type, autopilot

    def heartbeat(self) -> bytes:
        return self.mav.heartbeat_encode(self.mav_type, self.autopilot, 0, 0, 4).pack(
            self.mav
        )

    def send(self, data: bytes, port: int) -> None:
        self.sock.sendto(data, ("127.0.0.1", port))

    def drain(self) -> int:
        n = 0
        while True:
            try:
                self.sock.recv(4096)
                n += 1
            except TimeoutError:
                return n

    def rebind(self) -> None:
        """Simulate the vehicle reconnecting from a new source port."""
        self.sock.close()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.05)


async def main(udp_port: int, ws_port: int) -> None:
    glareshield = mav.MAVLink(None, srcSystem=255, srcComponent=190)
    arm = glareshield.command_long_encode(1, 1, 400, 0, 1, 0, 0, 0, 0, 0, 0).pack(
        glareshield
    )
    vehicle = Peer(1, 1, mav.MAV_TYPE_QUADROTOR, mav.MAV_AUTOPILOT_ARDUPILOTMEGA)
    mp = Peer(255, 190, mav.MAV_TYPE_GCS, mav.MAV_AUTOPILOT_INVALID)  # Mission Planner
    # RTK base station (dock-of-the-base): broadcasts an ONBOARD_CONTROLLER heartbeat on the same port
    base = Peer(250, 191, mav.MAV_TYPE_ONBOARD_CONTROLLER, mav.MAV_AUTOPILOT_INVALID)
    mp_params = mp.mav.param_request_list_encode(1, 1).pack(mp.mav)

    async with websockets.connect(
        f"ws://127.0.0.1:{ws_port}", origin="http://localhost:3000"
    ) as ws:

        async def send_cmd_and_count() -> tuple[int, int]:
            vehicle.drain()
            mp.drain()
            await ws.send(arm)
            await asyncio.sleep(0.25)
            return vehicle.drain(), mp.drain()

        # 1. Mission Planner talks to the bridge before the vehicle does
        mp.send(mp.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        v, m = await send_cmd_and_count()
        check(
            "another GCS's heartbeat before any vehicle does not become the reply target",
            m == 0,
            f"vehicle {v}, other GCS {m}",
        )

        # 1b. An RTK base station / companion heartbeat is not a vehicle
        base.send(base.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        base.drain()
        v, m = await send_cmd_and_count()
        b = base.drain()
        check(
            "a non-vehicle heartbeat (RTK base station, ONBOARD_CONTROLLER) is not a vehicle endpoint",
            b == 0 and m == 0,
            f"base station {b}, other GCS {m}",
        )

        # 2. Vehicle heartbeat adds the vehicle endpoint
        vehicle.send(vehicle.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        v, m = await send_cmd_and_count()
        check(
            "commands reach the vehicle after its heartbeat",
            v == 1 and m == 0,
            f"vehicle {v}, other GCS {m}",
        )

        # 3. Mission Planner keeps talking (heartbeats, requests): commands still go to the vehicle
        mp.send(mp.heartbeat(), udp_port)
        mp.send(mp_params, udp_port)
        await asyncio.sleep(0.2)
        v, m = await send_cmd_and_count()
        check(
            "another GCS's traffic does not steal the reply target",
            v == 1 and m == 0,
            f"vehicle {v}, other GCS {m}",
        )

        # 4. Vehicle reconnects from a new source port: the target follows it
        vehicle.rebind()
        vehicle.send(vehicle.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        v, m = await send_cmd_and_count()
        check(
            "reply target follows the vehicle to a new source port",
            v == 1 and m == 0,
            f"vehicle {v}, other GCS {m}",
        )

        # 5. Glareshield still receives the vehicle's telemetry
        got = 0
        vehicle.send(vehicle.heartbeat(), udp_port)
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), 0.5)
                if isinstance(msg, bytes):
                    got += 1
                    break
        except TimeoutError:
            pass
        check("vehicle telemetry is still forwarded to Glareshield", got == 1)

        # 6. A second vehicle on the same port: both receive Glareshield's traffic, MP still nothing
        vehicle2 = Peer(2, 1, mav.MAV_TYPE_GROUND_ROVER, mav.MAV_AUTOPILOT_ARDUPILOTMEGA)
        arm2 = glareshield.command_long_encode(2, 1, 400, 0, 1, 0, 0, 0, 0, 0, 0).pack(
            glareshield
        )
        vehicle.send(vehicle.heartbeat(), udp_port)
        vehicle2.send(vehicle2.heartbeat(), udp_port)
        mp.send(mp.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        for p in (vehicle, vehicle2, mp):
            p.drain()
        await ws.send(arm)
        await ws.send(arm2)
        await asyncio.sleep(0.25)
        v1, v2, m = vehicle.drain(), vehicle2.drain(), mp.drain()
        check(
            "two vehicles on one port both receive Glareshield's traffic",
            v1 == 2 and v2 == 2 and m == 0,
            f"vehicle1 {v1}, vehicle2 {v2}, other GCS {m}",
        )

        # 7. Vehicle 1 goes silent (powered off / swapped): its endpoint expires, vehicle 2 carries on
        deadline = time.monotonic() + EXPIRY_S + 1.5
        while time.monotonic() < deadline:
            vehicle2.send(vehicle2.heartbeat(), udp_port)
            mp.send(mp.heartbeat(), udp_port)
            await asyncio.sleep(1.0)
        for p in (vehicle, vehicle2, mp):
            p.drain()
        await ws.send(arm2)
        await asyncio.sleep(0.25)
        v1, v2, m = vehicle.drain(), vehicle2.drain(), mp.drain()
        check(
            f"a vehicle silent for over {EXPIRY_S:.0f}s is dropped; the remaining vehicle still gets traffic",
            v1 == 0 and v2 == 1 and m == 0,
            f"vehicle1 {v1}, vehicle2 {v2}, other GCS {m}",
        )

        # 8. The silent vehicle comes back: it is picked up again without restarting the bridge
        vehicle.send(vehicle.heartbeat(), udp_port)
        await asyncio.sleep(0.2)
        v, m = await send_cmd_and_count()
        check(
            "a returning vehicle is picked up again without restarting the bridge",
            v == 1 and m == 0,
            f"vehicle {v}, other GCS {m}",
        )


def check_frame_parser() -> None:
    sys.path.insert(0, os.path.join(REPO, "bridge"))
    from bridge import BridgeServer

    if not hasattr(BridgeServer, "mavlink_sources"):
        check(
            "frame parser reads sysid/msgid/type from v2, signed v2 and v1 frames in one datagram",
            False,
            "BridgeServer.mavlink_sources not found",
        )
        return

    v2 = mav.MAVLink(None, srcSystem=7, srcComponent=1)
    hb2 = v2.heartbeat_encode(
        mav.MAV_TYPE_FIXED_WING, mav.MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, 4
    ).pack(v2)
    att = v2.attitude_encode(1, 0.1, 0.2, 0.3, 0, 0, 0).pack(v2)
    signed = mav.MAVLink(None, srcSystem=9, srcComponent=1)
    signed.signing.secret_key = bytes(32)
    signed.signing.link_id = 0
    signed.signing.timestamp = 1
    signed.signing.sign_outgoing = True
    hb_signed = signed.heartbeat_encode(
        mav.MAV_TYPE_GROUND_ROVER, mav.MAV_AUTOPILOT_ARDUPILOTMEGA, 0, 0, 4
    ).pack(signed)
    os.environ["MAVLINK20"] = ""
    from pymavlink.dialects.v10 import ardupilotmega as mav1

    v1 = mav1.MAVLink(None, srcSystem=3, srcComponent=1)
    hb1 = v1.heartbeat_encode(
        mav1.MAV_TYPE_GCS, mav1.MAV_AUTOPILOT_INVALID, 0, 0, 4
    ).pack(v1)

    got = BridgeServer.mavlink_sources(hb2 + att + hb_signed + hb1)
    expected = [
        (7, 1, 0, mav.MAV_TYPE_FIXED_WING, mav.MAV_AUTOPILOT_ARDUPILOTMEGA),
        (7, 1, 30, None, None),
        (9, 1, 0, mav.MAV_TYPE_GROUND_ROVER, mav.MAV_AUTOPILOT_ARDUPILOTMEGA),
        (3, 1, 0, 6, 8),
    ]
    check(
        "frame parser reads sysid/msgid/type/autopilot from v2, signed v2 and v1 frames in one datagram",
        got == expected,
        f"{got}",
    )


if __name__ == "__main__":
    check_frame_parser()
    udp_port, ws_port = free_port(socket.SOCK_DGRAM), free_port()
    proc = subprocess.Popen(
        [
            sys.executable,
            BRIDGE,
            "--udp",
            f"0.0.0.0:{udp_port}",
            "--port",
            str(ws_port),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", ws_port), timeout=0.1).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            err = (
                proc.stderr.read().decode(errors="replace")[-500:]
                if proc.stderr
                else ""
            )
            sys.exit(f"bridge did not start: {err}")
        asyncio.run(main(udp_port, ws_port))
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    print(
        f"\n{len(failures)} UDP reply-target check(s) FAILED"
        if failures
        else "\nAll UDP reply-target checks PASSED"
    )
    sys.exit(1 if failures else 0)
