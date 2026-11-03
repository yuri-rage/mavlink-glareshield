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
  5. the NTRIP mountpoint cannot inject extra lines into the caster request.

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
                c.sendall(
                    b"HTTP/1.0 200 OK\r\nX-Internal-Token: SECRET123\r\n\r\ninternal service body"
                )
                time.sleep(0.5)
            except OSError:
                pass
            c.close()

    def close(self):
        self.stop = True
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
    async with websockets.connect(
        url, origin=cast(Any, "http://localhost:3000"), open_timeout=3
    ) as ws:
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
    r = await handshake(url, "https://glareshield.pages.dev")
    check("Origin https://glareshield.pages.dev is accepted", r == "accepted", r)
    r = await handshake(url, "https://my-branch.glareshield.pages.dev")
    check(
        "Origin https://my-branch.glareshield.pages.dev is accepted",
        r == "accepted",
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
    replies = await ntrip_attempt(
        url, {"host": "127.0.0.1", "port": port, "mountpoint": "admin"}
    )
    lst.close()
    leaked = any(m.get("type") == "ntrip_data" for m in replies)
    check(
        f"NTRIP connect to a non-caster port ({port}) is refused before any connection is made",
        not lst.connected.is_set(),
        f"service received {lst.received[:40]!r}"
        + ("; response body relayed back to the page" if leaked else ""),
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
            err = (
                proc.stderr.read().decode(errors="replace")[-500:]
                if proc.stderr is not None
                else ""
            )
            sys.exit(f"bridge did not start: {err}")
        asyncio.run(main(f"ws://127.0.0.1:{port}"))
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    print(
        f"\n{len(failures)} bridge security check(s) FAILED"
        if failures
        else "\nAll bridge security checks PASSED"
    )
    sys.exit(1 if failures else 0)
