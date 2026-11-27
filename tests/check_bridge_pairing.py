#!/usr/bin/env python3
"""
Pairing-token checks for bridge/bridge.py.

With --token (over TLS, as the Docker bridge runs):
  1. a WebSocket without the token, or with the wrong one, is closed with 4001 / 4003 and a reason the app can
     show, before anything is sent to it;
  2. the right token gets telemetry;
  3. the Origin check still applies;
  4. a browser tab opening the bridge (the certificate step) gets a plain page;
  5. /pair with a wrong or missing token is refused, and never shows the token;
  6. /pair with the token redirects to the app with the link in the hash (never sent to the app's server); behind
     a TLS reverse proxy (X-Forwarded-Proto: https) the link is wss:// on the proxy's host;
  7. the startup log carries the pairing link, and the QR's SVG copy is readable only by its owner.
Without --token: no check (a bridge on loopback), and /pair says pairing is off.

Usage:
    pip install -r bridge/requirements-test.txt
    python3 tests/check_bridge_pairing.py

Needs the openssl command or the cryptography package for a test certificate. Exits 0 if every check passes.
"""

import asyncio
import http.client
import os
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
from typing import Any, cast

try:
    import websockets
except ImportError:
    sys.exit("This check needs the websockets package: pip install websockets")

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BRIDGE = os.path.join(REPO, "bridge", "bridge.py")
ORIGIN = cast(Any, "http://localhost:3000")
TOKEN = "Tk3J9-test_token"
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_cert(d):
    cert, key = os.path.join(d, "cert.pem"), os.path.join(d, "key.pem")
    if shutil.which("openssl"):
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1"]
            + ["-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
            check=True,
            capture_output=True,
        )
        return cert, key
    import datetime
    import ipaddress

    from cryptography import x509  # pyright: ignore[reportMissingImports]
    from cryptography.hazmat.primitives import hashes, serialization  # pyright: ignore[reportMissingImports]
    from cryptography.hazmat.primitives.asymmetric import rsa  # pyright: ignore[reportMissingImports]
    from cryptography.x509.oid import NameOID  # pyright: ignore[reportMissingImports]

    k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.UTC)
    san = x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))])
    c = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(k.public_key())
        .serial_number(1)
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(san, critical=False)
        .sign(k, hashes.SHA256())
    )
    with open(key, "wb") as f:
        f.write(
            k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        )
    with open(cert, "wb") as f:
        f.write(c.public_bytes(serialization.Encoding.PEM))
    return cert, key


def start(args, port, log):
    proc = subprocess.Popen(
        [sys.executable, "-u", BRIDGE, "--mock", "--host", "127.0.0.1", "--port", str(port), *args],
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    for _ in range(100):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=0.1).close()
            return proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    sys.exit("bridge did not start")


async def ws_result(url, tls, origin=ORIGIN):
    """('data', n) when telemetry arrives, ('closed', code, reason), or ('refused', detail)."""
    try:
        async with websockets.connect(url, origin=origin, ssl=tls, open_timeout=3) as ws:
            try:
                m = await asyncio.wait_for(ws.recv(), 3)
                return ("data", len(m))
            except websockets.exceptions.ConnectionClosed as e:
                return ("closed", e.rcvd.code if e.rcvd else None, e.rcvd.reason if e.rcvd else "")
    except websockets.exceptions.InvalidStatus as e:
        return ("refused", e.response.status_code)


def get(port, path, tls_ctx, headers=None):
    if tls_ctx is None:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    else:
        conn = http.client.HTTPSConnection("127.0.0.1", port, context=tls_ctx, timeout=3)
    conn.request("GET", path, headers=headers or {"Host": f"192.168.1.50:{port}"})
    r = conn.getresponse()
    return r.status, r.getheader("Location"), r.read().decode(errors="replace")


def main():
    tmp = tempfile.mkdtemp()
    cert, key = make_cert(tmp)
    tls = ssl.create_default_context()
    tls.check_hostname = False
    tls.verify_mode = ssl.CERT_NONE
    port = free_port()
    svg = os.path.join(tmp, "pair.svg")
    logpath = os.path.join(tmp, "bridge.log")
    with open(logpath, "w") as log:
        proc = start(["--token", TOKEN, "--ssl-cert", cert, "--ssl-key", key, "--pair-svg", svg], port, log)
    try:
        base = f"wss://127.0.0.1:{port}/"
        r = asyncio.run(ws_result(base, tls))
        check("no token: closed 4001, 'pairing token required'", r == ("closed", 4001, "pairing token required"), r)
        r = asyncio.run(ws_result(base + "?token=nope", tls))
        check("wrong token: closed 4003, 'wrong pairing token'", r == ("closed", 4003, "wrong pairing token"), r)
        r = asyncio.run(ws_result(base + f"?token={TOKEN}", tls))
        check("right token: telemetry arrives", r[0] == "data", r)
        r = asyncio.run(ws_result(base + f"?token={TOKEN}", tls, origin=cast(Any, "https://evil.example")))
        check("right token, foreign Origin: still refused", r == ("refused", 403), r)

        status, _, body = get(port, "/", tls)
        check(
            "a tab opening the bridge: a plain page (certificate step)", status == 200 and "certificate" in body, status
        )
        for path in ("/pair", "/pair?token=nope"):
            status, loc, body = get(port, path, tls)
            check(f"{path}: refused (403), token not shown", status == 403 and TOKEN not in body and not loc, status)
        status, loc, _ = get(port, f"/pair?token={TOKEN}", tls)
        want = "https://glareshield.yurirage.com/#link=" + urllib.parse.quote(
            f"wss://192.168.1.50:{port}/?token={TOKEN}", safe=""
        )
        check("/pair with the token: redirect to the app, link in the hash", status == 302 and loc == want, loc)
    finally:
        proc.terminate()
        proc.wait(timeout=5)
    with open(logpath) as f:
        out = f.read()
    check("startup log: the /pair link", f"/pair?token={TOKEN}" in out, out[-300:])
    if os.path.exists(svg):
        check("pair.svg: owner-only (it holds the token)", stat.S_IMODE(os.stat(svg).st_mode) == 0o600)
    else:
        print("SKIP  pair.svg (segno not installed)")

    # Behind a TLS reverse proxy (bridge without TLS; X-Forwarded-Proto https): /pair sends wss:// to the proxy host.
    port = free_port()
    with open(os.devnull, "w") as log:
        proc = start(["--token", TOKEN], port, log)
    try:
        status, loc, _ = get(
            port, f"/pair?token={TOKEN}", None, {"Host": "bridge.example.com", "X-Forwarded-Proto": "https"}
        )
        want = "https://glareshield.yurirage.com/#link=" + urllib.parse.quote(
            f"wss://bridge.example.com/?token={TOKEN}", safe=""
        )
        check("behind a TLS proxy: /pair links wss:// on the proxy host", status == 302 and loc == want, loc)
    finally:
        proc.terminate()
        proc.wait(timeout=5)

    # Without a token: unchanged, and /pair says pairing is off.
    port = free_port()
    env_token = os.environ.pop("BRIDGE_TOKEN", None)  # before the start: the bridge reads it
    with open(os.devnull, "w") as log:
        proc = start(["--ssl-cert", cert, "--ssl-key", key], port, log)
    try:
        r = asyncio.run(ws_result(f"wss://127.0.0.1:{port}/", tls))
        check("no token configured: no check, telemetry arrives", r[0] == "data", r)
        status, _, body = get(port, "/pair", tls)
        check("no token configured: /pair says pairing is off (404)", status == 404 and "off" in body, status)
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        if env_token is not None:
            os.environ["BRIDGE_TOKEN"] = env_token

    print(f"\n{len(failures)} bridge pairing check(s) FAILED" if failures else "\nAll bridge pairing checks PASSED")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
