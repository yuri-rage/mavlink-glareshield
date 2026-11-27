#!/usr/bin/env python3
"""
Security checks for bridge/bridge.py.

Starts the mock bridge on a spare local port and checks that:
  1. a WebSocket from an arbitrary website's Origin is refused;
  2. Origin "null" is refused. Any website can produce it: a sandboxed <iframe> or a data: URL
     sends "null". In browsers without Chrome's Local Network Access gate (Firefox, Safari,
     older Chrome) that is a full bypass of the allowlist;
  3. a localhost Origin is still accepted (control);
  4. the bridge's NTRIP client cannot be pointed at an arbitrary local port and used as a TCP relay
     (the same class of issue that was fixed in the Vite dev proxy);
  5. the NTRIP mountpoint cannot inject extra lines into the caster request;
  6. a malformed text command (bad port, wrong JSON type) is ignored without ending the session;
  7. only one well-formed NMEA GGA sentence reaches the caster (no raw bytes or extra lines through ntrip_gga),
     and the request names the caster (Host header);
  8. a caster whose response header never ends is cut off, not buffered without limit.

Usage:
    pip install websockets
    python3 tests/check_bridge_security.py

Exits 0 if every check passes, 1 otherwise.
"""

import asyncio
import contextlib
import json
import os
import socket
import subprocess
import sys
import threading
import time
from typing import Any, cast

try:
    import websockets
except ImportError:
    sys.exit("This check needs the websockets package: pip install websockets")

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BRIDGE = os.path.join(REPO, "bridge", "bridge.py")
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Listener:
    """A local TCP service that records whatever it is sent and answers like an HTTP server."""

    def __init__(self, port):
        self.received = b""
        self.connected = threading.Event()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen()
        self.sock.settimeout(0.2)
        self.stop = False
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while not self.stop:
            try:
                c, _ = self.sock.accept()
            except OSError:
                continue
            self.connected.set()
            c.settimeout(1)
            try:
                self.received += c.recv(4096)
                c.sendall(b"HTTP/1.0 200 OK\r\nX-Internal-Token: SECRET123\r\n\r\ninternal service body")
                time.sleep(0.5)
            except OSError:
                pass
            c.close()

    def close(self):
        self.stop = True
        self.sock.close()


class Caster:
    """A local NTRIP caster on port 2101: answers ICY 200 OK (or an endless header) and records what it is sent."""

    def __init__(self, endless_header=False):
        self.received = b""
        self.endless = endless_header
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        # The previous check's connection to 2101 may take a moment to close.
        for attempt in range(30):
            try:
                self.sock.bind(("127.0.0.1", 2101))
                break
            except OSError:
                if attempt == 29:
                    raise
                time.sleep(0.1)
        self.sock.listen()
        self.sock.settimeout(0.2)
        self.stop = False
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while not self.stop:
            try:
                c, _ = self.sock.accept()
            except OSError:
                continue
            c.settimeout(0.2)
            with contextlib.suppress(OSError):
                if self.endless:
                    while not self.stop:
                        c.sendall(b"X-Pad: " + b"a" * 1000 + b"\r\n")
                        time.sleep(0.01)
                else:
                    c.sendall(b"ICY 200 OK\r\n")
                    while not self.stop:
                        try:
                            data = c.recv(4096)
                        except TimeoutError:
                            continue
                        if not data:
                            break
                        self.received += data
            c.close()

    def close(self):
        self.stop = True
        time.sleep(0.3)
        self.sock.close()


async def handshake(url: str, origin: Any):
    """Return 'accepted' or 'rejected (...)' for a WebSocket handshake with the given Origin header."""
    try:
        async with websockets.connect(url, origin=cast(Any, origin), open_timeout=3):
            return "accepted"
    except Exception as e:  # noqa: BLE001
        return f"rejected ({type(e).__name__})"


async def ntrip_attempt(url: str, cmd: dict[str, Any], seconds: float = 2.5):
    """Send an ntrip_connect from an allowed Origin; return the text replies seen."""
    replies = []
    async with websockets.connect(url, origin=cast(Any, "http://localhost:3000"), open_timeout=3) as ws:
        await ws.send(json.dumps({"type": "ntrip_connect", **cmd}))
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            try:
                m = await asyncio.wait_for(ws.recv(), max(0.05, end - time.monotonic()))
            except TimeoutError:
                break
            if isinstance(m, str):
                replies.append(json.loads(m))
        with contextlib.suppress(Exception):
            await ws.send(json.dumps({"type": "ntrip_disconnect"}))
    return replies


async def main(url):
    # 1-3: Origin allowlist
    r = await handshake(url, "https://evil.example")
    check("Origin https://evil.example is refused", r.startswith("rejected"), r)
    r = await handshake(url, "null")
    check(
        'Origin "null" (sandboxed iframe on any site) is refused',
        r.startswith("rejected"),
        r,
    )
    r = await handshake(url, "http://localhost:3000")
    check("Origin http://localhost:3000 is accepted (control)", r == "accepted", r)
    r = await handshake(url, "https://glareshield.yurirage.com")
    check(
        "Origin https://glareshield.yurirage.com is accepted",
        r == "accepted",
        r,
    )
    r = await handshake(url, "https://other.yurirage.com")
    check(
        "Origin https://other.yurirage.com is refused",
        r.startswith("rejected"),
        r,
    )
    # The site is served by a Cloudflare Worker, not Pages: no pages.dev origin is trusted.
    r = await handshake(url, "https://glareshield.pages.dev")
    check(
        "Origin https://glareshield.pages.dev is refused",
        r.startswith("rejected"),
        r,
    )
    r = await handshake(url, "https://my-branch.glareshield.pages.dev")
    check(
        "Origin https://my-branch.glareshield.pages.dev is refused",
        r.startswith("rejected"),
        r,
    )
    r = await handshake(url, "https://anything-i-deploy.pages.dev")
    check(
        "Origin https://anything-i-deploy.pages.dev is refused",
        r.startswith("rejected"),
        r,
    )

    # 4: NTRIP client as a relay to an arbitrary local port
    port = free_port()
    lst = Listener(port)
    replies = await ntrip_attempt(url, {"host": "127.0.0.1", "port": port, "mountpoint": "admin"})
    lst.close()
    leaked = any(m.get("type") == "ntrip_data" for m in replies)
    check(
        f"NTRIP connect to a non-caster port ({port}) is refused before any connection is made",
        not lst.connected.is_set(),
        f"service received {lst.received[:40]!r}" + ("; response body relayed back to the page" if leaked else ""),
    )

    # 5: CRLF injection through the mountpoint (needs a listener on a standard caster port)
    try:
        lst = Listener(2101)
    except OSError:
        print("SKIP  mountpoint CRLF injection (port 2101 is in use on this machine)")
        return
    replies = await ntrip_attempt(
        url,
        {
            "host": "127.0.0.1",
            "port": 2101,
            "mountpoint": "MP HTTP/1.0\r\nX-Injected: yes\r\nX-Pad: ",
        },
    )
    lst.close()
    injected = b"\r\nX-Injected: yes" in lst.received
    check(
        "NTRIP mountpoint cannot inject request lines",
        not injected,
        "injected header reached the caster" if injected else "",
    )

    # 6: malformed text commands are ignored; the session stays up and still answers
    async with websockets.connect(url, origin=cast(Any, "http://localhost:3000"), open_timeout=3) as ws:
        for bad in (
            json.dumps({"type": "ntrip_connect", "host": "x", "port": "abc", "mountpoint": "m"}),
            json.dumps({"type": "ntrip_connect", "host": "x", "port": None, "mountpoint": "m"}),
            json.dumps(["ntrip_connect"]),
            json.dumps("ntrip_connect"),
            json.dumps({"type": "ntrip_gga", "gga": {"not": "a string"}}),
            "not json at all",
        ):
            await ws.send(bad)
        alive = True
        try:
            for _ in range(20):
                await asyncio.wait_for(ws.recv(), 2)
        except Exception as e:  # noqa: BLE001
            alive = False
            detail = f"{type(e).__name__}: {e}"
        check("malformed text commands are ignored; the session stays up", alive, "" if alive else detail)

    # 7: GGA forwarding and the Host header
    try:
        caster = Caster()
    except OSError:
        print("SKIP  NTRIP GGA / Host checks (port 2101 is in use on this machine)")
        caster = None
    if caster:
        valid = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"
        async with websockets.connect(url, origin=cast(Any, "http://localhost:3000"), open_timeout=3) as ws:
            await ws.send(json.dumps({"type": "ntrip_connect", "host": "127.0.0.1", "port": 2101, "mountpoint": "MP"}))
            for _ in range(20):
                raw = await asyncio.wait_for(ws.recv(), 3)
                if not isinstance(raw, str):
                    continue  # mock telemetry
                m = json.loads(raw)
                if isinstance(m, dict) and m.get("status") == "streaming":
                    break
            for gga in (
                "$GPGGA,1\r\nGET /admin HTTP/1.0\r\n",  # an extra request line
                "\x00\x01raw bytes",
                "$GPGGA," + "9" * 500,  # over the length cap
                f"{valid}\r\n",  # the app's own (with its CRLF)
            ):
                await ws.send(json.dumps({"type": "ntrip_gga", "gga": gga}))
            await asyncio.sleep(0.5)
            await ws.send(json.dumps({"type": "ntrip_disconnect"}))
        caster.close()
        request, _, after = caster.received.partition(b"\r\n\r\n")
        check("the caster request carries a Host header", b"\r\nHost: 127.0.0.1:2101" in request, repr(request[:120]))
        check(
            "only the well-formed GGA reaches the caster, once, CRLF-terminated",
            after == f"{valid}\r\n".encode(),
            repr(after[:120]),
        )

    # 8: an endless response header is cut off
    try:
        caster = Caster(endless_header=True)
    except OSError:
        caster = None
    if caster:
        t0 = time.monotonic()
        replies = await ntrip_attempt(url, {"host": "127.0.0.1", "port": 2101, "mountpoint": "MP"}, seconds=4)
        caster.close()
        errs = [m for m in replies if m.get("type") == "ntrip_error"]
        check(
            "an endless caster header is cut off with an error",
            bool(errs) and "header" in errs[0].get("message", ""),
            f"{errs[:1]} after {time.monotonic() - t0:.1f} s",
        )

    sys.path.insert(0, os.path.join(REPO, "bridge"))
    from bridge import BridgeServer

    cases = [
        (
            "/dev/serial/by-path/p-0:1.2:1.0-port0:115200",
            ("/dev/serial/by-path/p-0:1.2:1.0-port0", 115200),
        ),
        (
            "/dev/serial/by-path/p-0:1.2:1.0-port0",
            ("/dev/serial/by-path/p-0:1.2:1.0-port0", 57600),
        ),
        ("/dev/ttyUSB0:57600", ("/dev/ttyUSB0", 57600)),
        ("/dev/ttyUSB0", ("/dev/ttyUSB0", 57600)),
    ]
    all_ok = all(BridgeServer.parse_serial_target(target) == expected for target, expected in cases)
    check("Serial target rsplit correctly parses by-path device names with colons", all_ok)


if __name__ == "__main__":
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, BRIDGE, "--mock", "--host", "127.0.0.1", "--port", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
                break
            except OSError:
                time.sleep(0.1)
        else:
            err = proc.stderr.read().decode(errors="replace")[-500:] if proc.stderr is not None else ""
            sys.exit(f"bridge did not start: {err}")
        asyncio.run(main(f"ws://127.0.0.1:{port}"))
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    print(f"\n{len(failures)} bridge security check(s) FAILED" if failures else "\nAll bridge security checks PASSED")
    sys.exit(1 if failures else 0)
