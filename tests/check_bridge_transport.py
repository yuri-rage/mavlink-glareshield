#!/usr/bin/env python3
"""
Transport checks for bridge/bridge.py.

  1. A client that stops reading (a phone on weak Wi-Fi) doesn't hold up the others: with a TCP "vehicle"
     streaming, a second client keeps receiving while the first is stalled.
  2. A UDP port the bridge can't bind stops it with an error (it used to run on, accepting the app and relaying
     nothing).

Usage:
    pip install websockets
    python3 tests/check_bridge_transport.py

Exits 0 if every check passes, 1 otherwise.
"""

import asyncio
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
ORIGIN = cast(Any, "http://localhost:3000")
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def free_port(kind=socket.SOCK_STREAM):
    with socket.socket(socket.AF_INET, kind) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_port(port, proc, seconds=10):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if proc.poll() is not None:
            return False
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
            return True
        except OSError:
            time.sleep(0.1)
    return False


class Vehicle:
    """A TCP 'vehicle' streaming 1 KB chunks as fast as the bridge reads them."""

    def __init__(self, port):
        self.sent = 0
        self.stop = False
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        c, _ = self.sock.accept()
        chunk = b"\xfd" + b"x" * 1023
        while not self.stop:
            try:
                c.sendall(chunk)
                self.sent += len(chunk)
            except OSError:
                return
            time.sleep(0.0005)

    def close(self):
        self.stop = True
        self.sock.close()


async def slow_client_check(ws_port):
    url = f"ws://127.0.0.1:{ws_port}"
    # The stalled client: a raw socket that does the WebSocket handshake by hand and then never reads, with a tiny
    # receive buffer, so its buffers (and the bridge's sends to it) fill in moments.
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    sock.connect(("127.0.0.1", ws_port))
    sock.sendall(
        (
            f"GET / HTTP/1.1\r\nHost: 127.0.0.1:{ws_port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n"
            "Origin: http://localhost:3000\r\n\r\n"
        ).encode()
    )
    sock.settimeout(3)
    upgraded = b" 101 " in sock.recv(256)
    check("stalled client: handshake accepted", upgraded)
    await asyncio.sleep(2)  # long enough to fill its buffers
    received = 0
    async with websockets.connect(url, origin=ORIGIN, open_timeout=3) as fast:
        end = time.monotonic() + 3
        while time.monotonic() < end:
            try:
                m = await asyncio.wait_for(fast.recv(), max(0.05, end - time.monotonic()))
            except TimeoutError:
                break
            received += len(m)
    sock.close()
    with_detail = f"{received / 1e6:.2f} MB in 3 s while another client was stalled"
    check("a stalled client doesn't hold up the others", received > 1_000_000, with_detail)


def main():
    # 1. Slow client, TCP vehicle
    tcp_port = free_port()
    vehicle = Vehicle(tcp_port)
    ws_port = free_port()
    proc = subprocess.Popen(
        [sys.executable, BRIDGE, "--tcp", f"127.0.0.1:{tcp_port}", "--host", "127.0.0.1", "--port", str(ws_port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    try:
        if not wait_for_port(ws_port, proc):
            check("bridge (TCP) started", False)
        else:
            asyncio.run(slow_client_check(ws_port))
    finally:
        vehicle.close()
        proc.terminate()
        proc.wait(timeout=5)

    # 2. UDP port taken: the bridge exits with an error
    udp_port = free_port(socket.SOCK_DGRAM)
    holder = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    holder.bind(("0.0.0.0", udp_port))
    proc = subprocess.Popen(
        [sys.executable, BRIDGE, "--udp", f"0.0.0.0:{udp_port}", "--host", "127.0.0.1", "--port", str(free_port())],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        code = proc.wait(timeout=10)
        out = proc.stdout.read().decode(errors="replace") if proc.stdout else ""
        check(
            "UDP port in use: the bridge stops with an error",
            code != 0 and "Could not bind" in out,
            f"exit {code}",
        )
    except subprocess.TimeoutExpired:
        proc.kill()
        check("UDP port in use: the bridge stops with an error", False, "still running after 10 s")
    finally:
        holder.close()

    print(f"\n{len(failures)} bridge transport check(s) FAILED" if failures else "\nAll bridge transport checks PASSED")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
