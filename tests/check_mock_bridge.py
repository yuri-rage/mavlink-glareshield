#!/usr/bin/env python3
"""
Validate the output of `bridge/bridge.py --mock` with pymavlink.

Starts the mock bridge on a spare local port, records a few seconds of its WebSocket stream,
decodes every frame with pymavlink, and checks that each message carries what the mock intends
(e.g. 3D GPS fix near San Francisco, ~16 V battery, plausible heading/throttle).
A message whose fields are packed in the wrong order decodes with a valid CRC but nonsense values,
so these checks look at the values, not just the framing.

Usage:
    pip install pymavlink websockets
    python3 tests/check_mock_bridge.py              # starts its own mock bridge
    python3 tests/check_mock_bridge.py --url ws://127.0.0.1:56781   # check a bridge already running

Exits 0 if every check passes, 1 otherwise.
"""
import argparse
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

candidate_repo = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if not os.path.exists(os.path.join(candidate_repo, "bridge", "bridge.py")):
    candidate_repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REPO = candidate_repo
BRIDGE = os.path.join(REPO, "bridge", "bridge.py")

# Values the mock is written to send (see bridge.py mock_telemetry_loop)
SF_LAT, SF_LON = 37.7749, -122.4194


def near(value, target, tol):
    return abs(value - target) <= tol


CHECKS = {
    "HEARTBEAT": [
        ("type is quadrotor (2)", lambda m: m.type == 2),
        ("autopilot is ArduPilot (3)", lambda m: m.autopilot == 3),
        ("system_status is ACTIVE (4)", lambda m: m.system_status == 4),
    ],
    "SYS_STATUS": [
        ("voltage_battery 14-16.5 V", lambda m: 14000 <= m.voltage_battery <= 16500),
        ("current_battery 0-10 A (cA units)", lambda m: 0 <= m.current_battery <= 1000),
        ("battery_remaining 10-100 %", lambda m: 10 <= m.battery_remaining <= 100),
        ("load 0-100 % (per-mille units)", lambda m: 0 <= m.load <= 1000),
    ],
    "BATTERY_STATUS": [
        ("voltages[0] is the pack voltage (14-16.5 V)", lambda m: 14000 <= m.voltages[0] <= 16500),
        ("battery_remaining 10-100 %", lambda m: 10 <= m.battery_remaining <= 100),
        ("current_battery 0-10 A (cA units)", lambda m: 0 <= m.current_battery <= 1000),
    ],
    "GPS_RAW_INT": [
        ("fix_type is 3D (3)", lambda m: m.fix_type == 3),
        ("lat/lon near San Francisco", lambda m: near(m.lat / 1e7, SF_LAT, 0.05) and near(m.lon / 1e7, SF_LON, 0.05)),
        ("satellites_visible 14", lambda m: m.satellites_visible == 14),
        ("eph (HDOP x100) below 500", lambda m: m.eph < 500),
        ("cog 0-35999 cdeg", lambda m: 0 <= m.cog < 36000),
    ],
    "VFR_HUD": [
        ("heading 0-359", lambda m: 0 <= m.heading < 360),
        ("throttle 0-100 %", lambda m: 0 <= m.throttle <= 100),
        ("alt 35-55 m", lambda m: 35 <= m.alt <= 55),
        ("climb within +/-1 m/s", lambda m: abs(m.climb) <= 1.0),
    ],
    "GLOBAL_POSITION_INT": [
        ("lat/lon near San Francisco", lambda m: near(m.lat / 1e7, SF_LAT, 0.05) and near(m.lon / 1e7, SF_LON, 0.05)),
        ("relative_alt 35-55 m", lambda m: 35000 <= m.relative_alt <= 55000),
        ("hdg 0-35999 cdeg", lambda m: 0 <= m.hdg < 36000),
    ],
    "ATTITUDE": [
        ("roll within +/-0.2 rad", lambda m: abs(m.roll) <= 0.2),
        ("pitch within +/-0.2 rad", lambda m: abs(m.pitch) <= 0.2),
    ],
    "STATUSTEXT": [
        ("text is printable", lambda m: m.text and all(32 <= ord(c) < 127 for c in m.text)),
    ],
}


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def record(url, seconds):
    parser = mav.MAVLink(None)
    parser.robust_parsing = True
    latest, bad = {}, 0
    async with websockets.connect(url) as ws:
        loop = asyncio.get_running_loop()
        end = loop.time() + seconds
        while loop.time() < end:
            try:
                data = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except TimeoutError:
                continue
            if isinstance(data, str):
                continue
            for msg in parser.parse_buffer(data) or []:
                if msg.get_type() == "BAD_DATA":
                    bad += 1
                else:
                    latest.setdefault(msg.get_type(), []).append(msg)
    return latest, bad


def main():
    desc = __doc__.split("\n")[1] if __doc__ else "Validate mock bridge"
    ap = argparse.ArgumentParser(description=desc)
    ap.add_argument("--url", help="check an already-running bridge instead of starting one")
    ap.add_argument("--seconds", type=float, default=3.5, help="how long to record (default 3.5)")
    args = ap.parse_args()

    proc = None
    url = args.url
    if not url:
        port = free_port()
        url = f"ws://127.0.0.1:{port}"
        proc = subprocess.Popen([sys.executable, BRIDGE, "--mock", "--host", "127.0.0.1", "--port", str(port)],
                                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for _ in range(50):  # wait up to ~5 s for the server to accept connections
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            proc.kill()
            err = proc.stderr.read().decode(errors="replace") if proc.stderr else ""
            sys.exit("Mock bridge did not start:\n" + err)

    try:
        latest, bad = asyncio.run(record(url, args.seconds))
    finally:
        if proc:
            proc.terminate()
            proc.wait(timeout=5)

    failures = 0
    print(f"Mock bridge at {url}: {sum(len(v) for v in latest.values())} messages decoded, {bad} bad frames")
    if bad:
        failures += 1
        print(f"  FAIL  {bad} frame(s) failed CRC or framing")
    for name, checks in CHECKS.items():
        msgs = latest.get(name)
        if not msgs:
            failures += 1
            print(f"  FAIL  {name}: not received")
            continue
        for label, fn in checks:
            bad_msgs = [m for m in msgs if not _safe(fn, m)]
            if bad_msgs:
                failures += 1
                print(f"  FAIL  {name}: {label}  ->  got {_summary(bad_msgs[-1], label)}")
            else:
                print(f"  ok    {name}: {label}")
    print("PASS" if failures == 0 else f"{failures} check(s) failed")
    sys.exit(1 if failures else 0)


def _safe(fn, m):
    try:
        return bool(fn(m))
    except (AttributeError, IndexError, TypeError, ValueError, KeyError):
        return False


def _summary(m, label):
    """Show the fields the failed check is about (matched by name in the label); otherwise the whole message."""
    d = {k: v for k, v in m.to_dict().items() if k != "mavpackettype"}
    words = set(label.replace("/", " ").replace("[", " ").replace("(", " ").split())
    picked = {k: v for k, v in d.items() if k in words}
    return ", ".join(f"{k}={v}" for k, v in (picked or d).items())

if __name__ == "__main__":
    main()
