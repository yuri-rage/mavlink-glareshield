# Reverse Proxy Setup (Own Domain, Trusted Certificates)

This guide puts the telemetry bridge behind a reverse proxy on your local network, so every browser on the LAN can connect to it over `wss://` with a real, trusted certificate. No certificate warnings, no per-device trust steps, and no browser flags.

It describes one working setup:
- **Nginx Proxy Manager** (NPM) holds a Let's Encrypt wildcard certificate for a domain you own.
- **Pi-hole** resolves the bridge's hostname to the proxy, but only inside your network.
- **bridge.py** and **Dock of the Base** each run in their own LXC container on a Proxmox host.

The same pattern works with other proxies (Caddy, Traefik, plain nginx), other local DNS servers, and Docker instead of LXC. Only the screens differ.

Throughout this guide, `home.example.com` stands in for a subdomain of a domain you own, and `192.168.1.x` for your LAN addresses.

---

## How it fits together

![Reverse proxy architecture](proxy-diagram.svg)

1. **The browser loads Glareshield** from `https://glareshield.yurirage.com`. That site only serves the app's files. It never sees your telemetry.
2. **The app opens `wss://mav.home.example.com`.**
   - Pi-hole answers that name with the proxy's LAN address.
   - The proxy presents the trusted certificate, decrypts the connection, and forwards it as a plain WebSocket to `bridge.py`.
3. **`https://dotb.home.example.com` works the same way** for the Dock of the Base web UI. Glareshield doesn't talk to Dock of the Base; it's just a second site behind the same proxy.
4. **On the vehicle side,** `bridge.py` and Dock of the Base each exchange MAVLink with the vehicle over UDP 14550. The vehicle is on the LAN through HaLow networking.

The legs from the proxy to the containers are unencrypted, but they never leave your network.

### Why a proxy?

- **No plain `ws://` from an `https://` page.** Glareshield is served over HTTPS, and browsers block an HTTPS page from opening an unencrypted `ws://` connection to another host (mixed content).
- **No self-signed certificates.** Running the bridge with its own self-signed certificate works, but every device must accept that certificate once by hand (see the [connection guide](connection-guide.md#option-1-native-tls--wss-recommended-for-encrypted-connections)). Phones, tablets and new laptops make that tedious.
- **Trusted everywhere.** A certificate from Let's Encrypt for a name you own is trusted by every browser out of the box.
- **Nothing exposed to the internet.** The DNS challenge proves domain ownership through your DNS provider, so you don't open any port on your router.

> [!CAUTION]
> The bridge has no authentication: anything that can reach it can command the vehicle. Keep the proxy reachable only from your LAN, and do not port-forward 80/443 to it. [Step 6](#6-limit-the-bridge-to-your-lan-recommended) adds an access list as a second guard.

---

## What you need

- **A domain you own,** with DNS hosted by a provider that NPM supports for DNS challenges (Cloudflare, Route 53, DigitalOcean, and many others). A subdomain such as `home.example.com` keeps local names apart from anything public.
- **Nginx Proxy Manager**, Pi-hole (or another local DNS server your devices use), and a machine for `bridge.py`.
- **A vehicle that sends MAVLink over UDP** to the machines that need it (here, a flight controller on the LAN through HaLow).

The example addresses used below:

| Service | Address | Listens on |
|---|---|---|
| Nginx Proxy Manager | `192.168.1.10` | 80, 443 (and 81 for its admin UI) |
| bridge.py | `192.168.1.11` | WebSocket `56781`, MAVLink UDP `14550` |
| Dock of the Base | `192.168.1.12` | web UI `8765`, MAVLink UDP `14550` |
| Vehicle | on the LAN via HaLow | MAVLink UDP |

Each service has its own IP address because each runs in its own LXC container. That is also why `bridge.py` and Dock of the Base can both use UDP 14550. Both bind `0.0.0.0:<port>`, so on one shared host only one of them could have that port (see [Sharing one host](#sharing-one-host-docker-instead-of-lxc)).

---

## 1. Run the bridge without TLS

The proxy handles encryption, so the bridge serves plain `ws://` on the LAN.

**Docker** (the image's own entrypoint): in `docker-compose.yml`, set:

```yaml
environment:
  - MODE=udp
  - TARGET=0.0.0.0:14550
  - AUTO_TLS=false
```

**Python:**

```bash
python3 bridge/bridge.py --host 0.0.0.0 --port 56781 --udp 0.0.0.0:14550
```

The bridge must listen on `0.0.0.0` (or its LAN address), not `127.0.0.1`, because the proxy reaches it from another container.

You don't need to add an allowed origin. The proxy passes the browser's `Origin: https://glareshield.yurirage.com` header through unchanged, and the bridge allows that origin by default. If you host Glareshield yourself on another domain, add `--allow-origin "https://your-gcs.example.com"` (Docker: `ALLOW_ORIGINS=`).

## 2. Point the vehicle at the containers

The vehicle must send MAVLink to each container that needs it:
- **`192.168.1.11:14550`** for `bridge.py`.
- **`192.168.1.12:14550`** for Dock of the Base.

How you do that depends on the vehicle's network hardware:
- **Flight controller with networking:** ArduPilot's own networking can run two UDP client ports, one per address (`NET_P1_*`, `NET_P2_*`).
- **Companion computer or radio bridge:** set it to send to both addresses, or to broadcast on the subnet.

Neither service needs the vehicle's address up front. Each learns it from the vehicle's first heartbeat and replies there.

> [!IMPORTANT]
> Only one RTCM source may inject corrections on a MAVLink link. With Dock of the Base sending RTCM3, leave NTRIP and RTK injection off in Glareshield's RTK widget. Two injectors interleave their `GPS_RTCM_DATA` fragments and corrupt each other.

## 3. Issue a wildcard certificate with the DNS challenge

In the NPM admin UI (port 81):

1. Go to **SSL Certificates → Add SSL Certificate → Let's Encrypt**.
2. For **Domain Names**, enter `*.home.example.com`. Optionally add `home.example.com` itself.
3. Turn on **Use a DNS Challenge** and pick your DNS provider. Paste an API token into the credentials box. For Cloudflare that's a token with **Zone → DNS → Edit** on the zone:
   ```ini
   dns_cloudflare_api_token = <your token>
   ```
4. Agree to the terms and save. Issuing takes a minute while the challenge record propagates.

NPM renews the certificate on its own. Because validation happens in DNS, the proxy never has to be reachable from the internet.

## 4. Add the proxy hosts

Under **Hosts → Proxy Hosts → Add Proxy Host**, add one host for each service:

| Setting | Bridge | Dock of the Base |
|---|---|---|
| Domain Names | `mav.home.example.com` | `dotb.home.example.com` |
| Scheme | `http` | `http` |
| Forward Hostname / IP | `192.168.1.11` | `192.168.1.12` |
| Forward Port | `56781` | `8765` |
| **Websockets Support** | **On** (required) | Off (the UI is plain HTTP) |
| SSL tab → SSL Certificate | the `*.home.example.com` certificate | same |
| SSL tab → Force SSL | On | On |

Set the scheme to `http` even though browsers connect over HTTPS: it describes the proxy's connection to the container, which is plain. If the bridge still has TLS on (`AUTO_TLS=true` or `--ssl-cert`), turn it off as in step 1. Otherwise the proxy speaks plain HTTP to a TLS port and the WebSocket handshake fails.

**Keep idle WebSockets open.** nginx closes a proxied connection after 60 s without data from the upstream. A bridge with no vehicle behind it can be quiet that long, which makes Glareshield drop and reconnect every minute. On the bridge host's **Advanced** tab, add:

```nginx
proxy_read_timeout 1h;
proxy_send_timeout 1h;
```

## 5. Resolve the names locally with Pi-hole

Both names should resolve to the proxy, not to the containers. The proxy decides where each request goes by its hostname.

- **Pi-hole v6:** **Settings → Local DNS Records**.
- **Pi-hole v5:** **Local DNS → DNS Records**.

Add:

| Domain | IP |
|---|---|
| `mav.home.example.com` | `192.168.1.10` |
| `dotb.home.example.com` | `192.168.1.10` |

To cover every name under the subdomain at once, add a wildcard instead. On Pi-hole v6, go to **Settings → All settings → Miscellaneous → `misc.dnsmasq_lines`**, enable the expert settings, and add:

```text
address=/home.example.com/192.168.1.10
```

Devices only use these records if they use Pi-hole for DNS. That usually means handing out Pi-hole's address through your router's DHCP settings. Check from a client:

```bash
nslookup mav.home.example.com
# should answer 192.168.1.10
```

## 6. Limit the bridge to your LAN (recommended)

The names only resolve inside your network, but an access list keeps the bridge private even if a name leaks or a port is forwarded by mistake.

1. Go to **Access Lists → Add Access List** and name it `LAN only`.
2. On the **Access** tab, add an **allow** rule for your subnet, `192.168.1.0/24`. NPM refuses every address the list doesn't allow. Leave Authorization empty: browsers can't send Basic Auth credentials on a WebSocket handshake.
3. Edit the `mav.home.example.com` proxy host and set **Access List** to `LAN only`.

## 7. Connect

1. Open [https://glareshield.yurirage.com](https://glareshield.yurirage.com) on any device on the LAN.
2. Open **Link Settings** (gear icon) and connect to:
   ```text
   wss://mav.home.example.com
   ```
   Leave off the port: the proxy listens on 443.
3. Chrome and Edge may ask *"Allow Glareshield to connect to devices on your local network?"* the first time, because a public site is reaching a private address. Click **Allow**.

To open Dock of the Base, browse to `https://dotb.home.example.com`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Connection fails at once; the name doesn't resolve | The device isn't using Pi-hole, or uses its own encrypted DNS: Chrome **Secure DNS**, Android **Private DNS**, iCloud **Private Relay**, or a VPN | Point the device's DNS at Pi-hole, or turn the private DNS feature off for this network |
| Certificate error in the browser | The proxy host is missing the wildcard certificate, or the name isn't covered by it (`*.home.example.com` doesn't cover `a.b.home.example.com`) | Select the certificate on the proxy host's SSL tab; use a name one level below the wildcard |
| `502 Bad Gateway`, or the WebSocket closes during the handshake | The proxy can't reach the bridge, or **Websockets Support** is off, or the scheme doesn't match the bridge (TLS on the bridge, `http` on the proxy) | Check the bridge listens on `0.0.0.0:56781`; turn on Websockets Support; run the bridge without TLS |
| Glareshield reconnects about once a minute while idle | nginx's 60 s read timeout | Add the `proxy_read_timeout` lines from step 4 |
| Bridge log: `Refused WebSocket connection from Origin` | Glareshield is served from a domain the bridge doesn't allow | Start the bridge with `--allow-origin "https://<that domain>"` |
| Connected, but no telemetry (0 pkts/s) | The vehicle isn't sending to the bridge's address, or a firewall on the container drops UDP 14550 | Check the vehicle's UDP output targets (step 2); allow 14550/udp on the container |
| RTK fix drops in and out, corrections look corrupt | Two RTCM injectors on one link | Disable NTRIP/RTK injection in Glareshield while Dock of the Base supplies corrections |

---

## Variations

### Sharing one host (Docker instead of LXC)

On a single Docker host with host networking, `bridge.py` and Dock of the Base can't both bind UDP 14550. Give one of them another port (for example, run the bridge with `--udp 0.0.0.0:14551`) and point the vehicle's second output there. The proxy steps don't change; use the host's address with each service's port.

### Other proxies

The requirements carry over to any reverse proxy:
- terminate TLS with a trusted certificate;
- forward WebSocket upgrades (`Upgrade` and `Connection` headers) to the bridge's plain `ws://` port;
- keep the read timeout well above a minute;
- pass the `Origin` header through.

Caddy does all of this by default; see the [connection guide](connection-guide.md#option-4-local-reverse-proxy--cloudflare-tunnel--caddy).

### Reaching the bridge from outside the LAN

Don't open the proxy to the internet. Use a VPN such as Tailscale or WireGuard, and point the VPN's DNS at Pi-hole so the same names resolve. The bridge has no authentication of its own; the [connection guide](connection-guide.md#option-4-local-reverse-proxy--cloudflare-tunnel--caddy) explains the risks.
