# MAVLink Glareshield

A widget-based web ground control station for ArduPilot, in the browser: telemetry and control over WebSocket or USB serial, a heads-up display, a moving map with mission planning, and a dashboard you arrange yourself, from a phone to an ultrawide.

Designed to remove the "glare" from more fully featured GCS applications and focus on core display elements with a high degree of flexibility and user customization options.

> [!WARNING]
> **USE AT YOUR OWN RISK**
>
> Glareshield is experimental software and is **NOT certified for safety-critical or primary flight control operations**.
>
> This software directly issues commands to vehicle flight controllers and physical actuators. Network latency, browser performance, disconnection, software defects, or sensor inaccuracies can result in loss of control, flyaways, collisions, or catastrophic crashes.
>
> - **Always maintain an independent physical manual override (e.g., dedicated RC transmitter) powered and within reach.**
> - **The operator / pilot-in-command assumes all risk and sole responsibility for vehicle safety, operation, and regulatory compliance at all times.**

---

## Features

- **Flight display**: a canvas HUD (attitude, speed and altitude tapes, heading, an optional low-latency camera feed behind it) and a moving map with the vehicle, home, its trail, the mission, fences and rally points.
- **Flight controls**: slide-to-arm, flight modes, quick actions (Takeoff with a checklist, Auto, Loiter, RTL, Land), and guided actions from the map: fly here, orbit, change altitude and speed, pause, set home. Anything consequential asks first, naming what will happen.
- **Mission planning**: edit missions, geofences and rally points on the map, with checks as you go (route against the fence, altitude over terrain), an altitude profile, undo/redo, and QGC `.plan` / `.waypoints` / ArduPilot `.dat` files.
- **Dashboard**: tabs of widgets, either a scrolling grid (**Flow**) or panes that fill the window with no scrolling (**Cockpit**), with presets, drag-to-arrange, and a second layout for ultrawide screens. Phones get the same widgets stacked.
- **Maps offline**: keep the imagery you've browsed, download areas from your own tile server, import MBTiles, and store terrain for use without internet.
- **Awareness**: ADS-B traffic with warnings, terrain data (served to the vehicle and used for planning), several vehicles on one link, battery / GNSS / EKF / vibration health, and spoken alerts.
- **Parameters and logs**: the full parameter list with metadata and search, comparing against a `.param` file with verified writes, onboard (DataFlash) log download, and telemetry logs (`.tlog`) recorded in the browser.
- **Fast MAVLink and MAVFTP**: in-browser MAVLink framing, MAVFTP for parameters, missions and logs with item-by-item fallback, and RTK / NTRIP corrections to the vehicle.
- **Custom widgets**: declarative JSON widgets (gauges, charts, LEDs, switches, sliders, parameter controls), safe from arbitrary code.

📖 **[User Guide](docs/user-guide.md)**: how to use all of the above.

---

## Quickstart

Glareshield is deployed and ready to use at **[https://glareshield.yurirage.com](https://glareshield.yurirage.com)**. No installation or build steps are required for the web application.

### 1. Start a Telemetry Bridge

Choose either Mission Planner or the Docker bridge:

- **Mission Planner (Zero Install)**:
  If already running Mission Planner on Windows, it includes an automatic WebSocket server on port `56781`. Connect to your vehicle or start SITL in Mission Planner.

- **Docker Bridge (Recommended for Telemetry Radios, Network Vehicles & `wss://`)**:
  Provides zero-configuration telemetry bridging on UDP port 14550 with automated TLS certificate generation (`wss://`) for connecting from phones, tablets, or laptops over your local network:
  ```bash
  mkdir -p glareshield-bridge && cd glareshield-bridge
  curl -O https://raw.githubusercontent.com/yuri-rage/mavlink-glareshield/master/docker-compose.yml
  docker compose up -d
  docker compose logs
  ```

### 2. Connect in Glareshield

1. Open **[https://glareshield.yurirage.com](https://glareshield.yurirage.com)** in your browser.
2. Click the connection pill (top right) or **Settings** to open the **Link** tab.
3. Enter your bridge address:
   - **Same computer (Mission Planner)**: `ws://localhost:56781`
   - **Local network (Docker)**: `wss://<bridge-ip>:56781/`
4. Click **Connect**.

**USB serial, no bridge (Chrome / Edge, or Chrome on Android):** on the same tab choose **Link type → USB serial**, pick the baud rate, click **Connect**, and select your telemetry radio or flight controller. See [Direct USB Serial](docs/connection-guide.md#option-5-direct-usb-serial-no-bridge).

Then see the **[User Guide](docs/user-guide.md)** for the dashboard, flying, planning and the rest.

📖 **For detailed setup (including USB Serial radios, TCP, direct Python bridge usage, self-signed certificate acceptance, and remote tunnels), see the [Browser & Network Connection Guide](docs/connection-guide.md).** To serve the bridge over `wss://` with a trusted certificate from your own domain, see [Reverse Proxy Setup](docs/reverse-proxy.md).

---

## Local Development & Building from Source

For contributors or anyone wishing to run a local development server or build offline bundles:

### Requirements
- Node.js 22+ and npm (as CI uses)
- Python 3.10+ (for the bridge, mock telemetry and the bridge tests: `pip install -r bridge/requirements-test.txt`)

### Development Server
```bash
git clone https://github.com/yuri-rage/mavlink-glareshield.git
cd mavlink-glareshield
npm install
npm run dev
```
Open `http://localhost:3000` in your browser.

### Testing & Build
```bash
# Every tests/*.test.ts, in parallel (unit, golden vectors, MAVFTP simulator, regressions, ...)
npm test

# Only some: any part of a file name
npm test -- cockpit mission

# Type-check and build the production bundle
npm run build
```

The build is stamped with its commit (shown at the foot of Settings), and a running app offers to reload when a newer build is deployed. For the Python checks, regenerating golden vectors and the rest, see [tests/README.md](tests/README.md).

### Deployment

Pushes to `master` run `.github/workflows/ci.yml`: unit tests, bridge tests and the build, then (only when all pass) a deploy to Cloudflare Workers from the build's output, configured by `wrangler.jsonc`.

---

## Custom Widgets

Custom widgets are declarative JSON definitions, safe from arbitrary code execution. Build them in **Edit Mode → Add Widget → Build Custom Widget** (with a live preview), or import a `.widget.json` file. They can show one value or several, as stat cards, value lists, radial and linear gauges (including several gauges in one card, each with its own scale), time-series charts, compass roses, bar groups and LEDs. They can also send commands, switch relays and servos, and read and write parameters. Imported widgets always ask for confirmation before sending anything.

```json
{
  "id": "custom-bus-voltage",
  "name": "Bus Voltage",
  "category": "telemetry",
  "displayType": "gauge-radial",
  "binding": {
    "messageName": "SYS_STATUS", "fieldName": "voltage_battery", "unit": "V",
    "min": 13.0, "max": 16.8, "decimals": 2,
    "warnThreshold": 14.8, "critThreshold": 14.2, "thresholdInvert": true
  }
}
```

See the **[Custom Widget Guide](docs/custom-widgets.md)** for the full format, every display type with examples, control widgets, import rules and troubleshooting.

---

## Acknowledgements

The link transports in `src/mavlink/transport/` (WebSocket, Web Serial, and serial over WebUSB for Android) are adapted from [ArduConfigurator](https://github.com/j-w9/arduconfigurator) (GPL-3.0-only). Each adapted file names its source and what was changed.
