# Browser & Network Connection Guide

This guide explains how to connect Glareshield to your telemetry bridge (`bridge/bridge.py`), covering browser security policies, mixed-content restrictions, and secure `wss://` configuration.

---

## Quick Start

To explore the features of Glareshield, start a SITL session in Mission Planner or connect it to a live vehicle (Mission Planner automatically opens a WebSocket server on port 56781). On the same computer, open [Glareshield](https://glareshield.yurirage.com) in any modern web browser, click "Connect" in the upper right corner, enter `ws://localhost:56781` as the host:port, and click "Connect Now."

Alternatively, if you are not using Mission Planner, you can start the included companion bridge (`python3 bridge/bridge.py --udp 127.0.0.1:14550` or `--mock` for offline simulation).

To use Glareshield on other devices within the same local network (connecting to a LAN IP instead of localhost), continue reading below.

---

## Architecture

![Connection Diagram](conn-diagram.png)

When you host Glareshield over **HTTPS** (e.g. [https://glareshield.yurirage.com](https://glareshield.yurirage.com)) and connect to a telemetry bridge on your local network (e.g. `ws://192.168.1.69:56781`), two browser security safeguards apply:

1. **Mixed Active Content**: Browsers prohibit secure HTTPS pages from opening unencrypted WebSockets (`ws://`) to protect users against man-in-the-middle attacks.
2. **Private Network Access (PNA)**: Chromium browsers restrict public web origins from initiating connections to private RFC 1918 IP addresses (`10.x.x.x`, `192.168.x.x`, `172.16-31.x.x`).

Additionally, `bridge.py` enforces an origin check during the WebSocket handshake to protect your vehicle from cross-site hijacking.

Choose the setup that best fits your environment below.

---

## Option 1: Native TLS / `wss://` (Recommended for All Browsers & Mobile)

Configuring encrypted WebSockets (`wss://`) is the most robust, permanent solution. It works across all browsers (Chrome, Firefox, Safari, Edge) and mobile devices without requiring users to alter browser settings or flags.

### Method A: Automated Setup with Docker Compose (Zero Configuration)

If you use Docker, certificate generation, renewal, and LAN IP detection are completely automated without editing any config files:

1. Start the container:
   ```bash
   docker compose up -d
   ```
2. Check the logs:
   ```bash
   docker compose logs
   ```
   The container automatically detects your host's primary LAN IP (e.g. `192.168.1.69`) and hostname, generates a 2048-bit RSA TLS certificate with all IP/DNS Subject Alternative Names (`subjectAltName`) in `./certs/`, and prints your direct connection URL:
   ```text
   ============================================================
    MAVLink Glareshield Bridge Container
    Mode:       udp (0.0.0.0:14550)
    Protocol:   wss://0.0.0.0:56781
    TLS Active: true
    Connect at: wss://192.168.1.69:56781/
   ============================================================
   ```
   If your machine changes networks or receives a new DHCP address, the container detects the change on restart and automatically re-issues a matching certificate.

### Method B: Manual Python & OpenSSL Setup

#### 1. Generate SSL Certificates on your Bridge Machine

Run this command on the machine running `bridge.py` (replace `192.168.1.69` with your machine's IP or hostname):

```bash
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=192.168.1.69" \
  -addext "subjectAltName=IP:192.168.1.69,DNS:localhost,IP:127.0.0.1"
```

#### 2. Start the Bridge with TLS

Pass `--ssl-cert` and `--ssl-key` to `bridge.py`:

```bash
# Example with UDP (SITL or live broadcast):
python3 bridge/bridge.py --host 0.0.0.0 --port 56781 --udp 0.0.0.0:14550 \
  --ssl-cert cert.pem --ssl-key key.pem

# Example with physical telemetry radio (Serial):
python3 bridge/bridge.py --host 0.0.0.0 --port 56781 --serial /dev/ttyUSB0:57600 \
  --ssl-cert cert.pem --ssl-key key.pem
```

The console will confirm:
```
============================================================
 MAVLink Glareshield Bridge running on wss://0.0.0.0:56781
============================================================
```

### Trusting the Self-Signed Certificate in Browser (First Time Only)

Because the certificate is self-signed, your browser needs one-time confirmation:
1. Open a new tab and navigate directly to:
   ```text
   https://192.168.1.69:56781
   ```
2. Click **Advanced → Accept the Risk and Continue** (Firefox) or **Advanced → Proceed** (Chrome).
3. Close the tab, open [https://glareshield.yurirage.com](https://glareshield.yurirage.com), and in **Link Settings** connect to:
   ```text
   wss://192.168.1.69:56781/
   ```

---

## Option 2: Firefox Configuration (Connecting to a Remote LAN IP)

`localhost` connections work out-of-the-box in Firefox. However, if you are connecting across your local network to another computer's LAN IP (e.g. `ws://192.168.1.69:56781`), you can allow unencrypted WebSockets from HTTPS without needing SSL certificates:

1. In Firefox, open a new tab to:
   ```text
   about:config
   ```
2. Click **Accept the Risk and Continue**.
3. Search for:
   ```text
   network.websocket.allowInsecureFromHTTPS
   ```
4. Double-click to toggle the value to **`true`**.
5. Reload [https://glareshield.yurirage.com](https://glareshield.yurirage.com).
6. Open **Link Settings** (gear icon) and connect to:
   ```text
   ws://192.168.1.69:56781/
   ```

---

## Option 3: Chrome / Chromium Browser Configuration

Chromium-based browsers (Google Chrome, Microsoft Edge, Brave, Opera) require permitting insecure content for the specific site, and may require allowing private network access.

### Step 1: Allow Insecure Content (Per-Site)

1. Open [https://glareshield.yurirage.com](https://glareshield.yurirage.com).
2. Click the **tune / site information icon** (or padlock) immediately to the left of `https://` in the address bar.
3. Select **Site settings**.
4. Scroll down to **Insecure content** (default is *Block*).
5. Change the setting to **Allow**.
6. Switch back to your Glareshield tab and click **Reload**.

### Step 2: Private Network Access (Internet Origin → Local IP)

When a public web origin (`yurirage.com`) connects to a local RFC 1918 IP address (`10.x.x.x` or `192.168.x.x`), Chrome's Private Network Access security policy may block the handshake.

If the connection is still refused after Step 1:
1. In Chrome, open a new tab to:
   ```text
   chrome://flags/#block-insecure-private-network-requests
   ```
2. Set **Block insecure private network requests** to **Disabled**.
3. Click **Relaunch** at the bottom of the browser.

### Dedicated Desktop Launcher (Field Laptop Alternative)

You can launch a dedicated Chrome instance with mixed-content checks disabled for field use:

```bash
google-chrome \
  --allow-running-insecure-content \
  --unsafely-treat-insecure-origin-as-secure="ws://192.168.1.69:56781" \
  https://glareshield.yurirage.com
```

---

## Option 4: Local Reverse Proxy / Cloudflare Tunnel / Caddy

For an automated setup that handles real certificates (e.g. Let's Encrypt or Cloudflare Zero Trust) with zero browser configuration needed on any client:

### Caddy (Automatic HTTPS)

Create a `Caddyfile`:

```caddy
gcs-bridge.your-domain.com {
    reverse_proxy 127.0.0.1:56781
}
```

Run `caddy run`. Connect in Glareshield to `wss://gcs-bridge.your-domain.com`.

### Cloudflare Tunnel (`cloudflared`)

If you manage your domain via Cloudflare:
```bash
cloudflared tunnel --url ws://localhost:56781
```
Route a public hostname (e.g. `telemetry.yurirage.com`) to the tunnel. You can now connect securely over `wss://telemetry.yurirage.com` from anywhere in the world.

---

## Bridge Security & Origin Configuration

[`bridge/bridge.py`](../bridge/bridge.py) guards against Cross-Site WebSocket Hijacking by inspecting the `Origin` header during the initial HTTP handshake.

### Built-in Allowed Origins

By default, the bridge permits connections from:
- `http://localhost:*` and `http://127.0.0.1:*`
- Private network IPs: `192.168.*`, `10.*`, `172.16-31.*`
- `https://*.yurirage.com` and `https://*.pages.dev`
- `tauri://*` (desktop companion)
- Direct tools without an Origin header (`None`)

### Custom Domains

If hosting Glareshield on a different domain, pass `--allow-origin` when starting the bridge:

```bash
# Allow a specific custom origin:
python3 bridge/bridge.py --udp 127.0.0.1:14550 --allow-origin "https://gcs.example.com"

# Allow all origins (field/testing only):
python3 bridge/bridge.py --udp 127.0.0.1:14550 --allow-all-origins
```

If an unauthorized origin attempts to connect, the bridge prints:
```text
[SECURITY] Refused WebSocket connection from Origin: https://unauthorized-site.com
           To permit this, restart bridge with: --allow-origin "https://unauthorized-site.com" or --allow-all-origins
```

---

## Troubleshooting Checklist

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **"The connection to ws://... was interrupted while the page was loading"** | Browser Mixed Content policy blocking `ws://` from an `https://` site. | See [Option 1](#option-1-native-tls--wss-recommended-for-all-browsers--mobile) for `wss://` or [Option 2 / 3](#option-2-firefox-configuration-fastest-for-desktop-testing) for browser overrides. |
| **Bridge console shows `Refused WebSocket connection from Origin`** | Host domain not in bridge allowlist. | Pass `--allow-origin "https://yourdomain.com"` or `--allow-all-origins` to `bridge.py`. |
| **Bridge connected, but 0 pkts/s and no telemetry received over UDP** | Host firewall blocking inbound UDP port 14550. | On Linux/NixOS, ensure port 14550/udp is allowed in your firewall (e.g. `sudo iptables -I INPUT -p udp --dport 14550 -j ACCEPT` or `sudo ufw allow 14550/udp`). |
| **"WebSocket connection failed" / Connection timed out** | Bridge is only bound to `127.0.0.1`. | Restart the bridge with `--host 0.0.0.0` so it listens on all network interfaces. |
| **"An AudioContext was prevented from starting automatically"** | Browser autoplay policy requiring gesture. | Click or tap anywhere in the application window to unlock audio callouts. |
