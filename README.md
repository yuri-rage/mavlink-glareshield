# MAVLink Glareshield

A widget-based web application for bidirectional ArduPilot control and telemetry over WebSocket. Features a main dashboard panel, heads-up display (HUD), tactical map, dynamic bandwidth negotiation, and a declarative JSON custom widget engine.

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

- **Heads-Up Display (HUD) & Tactical Map**: Canvas artificial horizon, speed/altitude tapes, Leaflet moving map with waypoints, polygon geofences, rally points, and drag-and-drop mission upload.
- **Flight Controls & Autopilot Commands**: Slide-to-confirm Arm/Disarm, flight mode switching, speed adjustment, and quick actions (RTL, Pause/Loiter, Land, Takeoff).
- **Fast MAVLink & MAVFTP Engine**: Native in-browser MAVLink framing and high-speed MAVFTP parameter and mission sync with automatic legacy streaming fallback.
- **RTK / NTRIP Correction Injection**: Real-time RTCM3 correction streaming to your vehicle from NTRIP casters or local USB base stations.
- **Telemetry & Voice Alerts**: Battery, dual-GNSS, vibration, and autopilot notices with configurable audio chimes and text-to-speech callouts.
- **Customizable Dashboard**: Multi-tab drag-and-drop layout with declarative widgets (gauges, charts, switches, sliders, and parameter controls).

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
2. Click **Connect** in the top right.
3. Enter your bridge address:
   - **Same computer (Mission Planner)**: `ws://localhost:56781`
   - **Local network (Docker)**: `wss://<bridge-ip>:56781/`
4. Click **Connect Now**.

**USB serial, no bridge (Chrome / Edge, or Chrome on Android):** in the same dialog choose **Link Type → USB Serial**, pick the baud rate, click **Connect Now**, and select your telemetry radio or flight controller. See [Direct USB Serial](docs/connection-guide.md#option-5-direct-usb-serial-no-bridge).

📖 **For detailed setup (including USB Serial radios, TCP, direct Python bridge usage, self-signed certificate acceptance, and remote tunnels), see the [Browser & Network Connection Guide](docs/connection-guide.md).**

---

## Local Development & Building from Source

For contributors or anyone wishing to run a local development server or build offline bundles:

### Requirements
- Node.js 18+ and npm
- Python 3.10+ (for bridge or mock telemetry)

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
# Run unit tests and pymavlink golden vector validation
npm test

# Run regression tests
npm run test:regressions

# Build production bundle
npm run build
```

For advanced testing workflows (e.g. regenerating golden vectors or running mock bridge telemetry validation), see [tests/README.md](tests/README.md).

---

## Custom Widget Specification

Custom widgets are declarative JSON definitions safe from arbitrary code execution. Build them in **Edit Mode → Add Widget → Build Custom Widget** (with a live preview), or import a `.widget.json` file.

```json
{
  "id": "custom-bus-voltage",
  "name": "Bus Voltage Monitor",
  "category": "telemetry",
  "displayType": "gauge-radial",
  "binding": {
    "messageName": "SYS_STATUS",
    "fieldName": "voltage_battery",
    "unit": "V",
    "min": 13.0,
    "max": 16.8,
    "decimals": 2,
    "warnThreshold": 14.8,
    "critThreshold": 14.2,
    "thresholdInvert": true
  },
  "gauge": { "sweep": 240, "style": "both", "majorTicks": 5, "minorTicks": 4, "showZones": true }
}
```

**Display types:** `stat-card`, `value-list`, `gauge-radial`, `gauge-linear`, `sparkline` (time-series chart), `compass-rose`, `multi-bar`, `indicator-led`, `text-display`, `param-control`, `action-button`, `toggle-switch`, `slider-control`.

**Bindings.** `binding` is the primary value. Any decoded field of any message the vehicle sends can be bound; the creator lists the fields actually received (marked ●). Values are computed as `raw × multiplier + offset`.

| Key | Meaning |
|---|---|
| `unitKind` | `speed` (from m/s), `altitude` or `distance` (from m): shown in the units chosen in Link & Display Settings. Min, max and thresholds stay in the base units. |
| `warnThreshold` / `critThreshold` / `thresholdInvert` | Alert colouring, and the green / amber / red zones on gauges. |
| `label`, `color` | Row / series label and hex colour (value lists and charts). |

**Several values.** `bindings` lists further values after `binding`:
- **Charts** plot every value as its own series.
- **Value lists** show one row per value.
- **Radial and linear gauges and the compass rose** draw the first extra value as a magenta marker, for example a target against the actual value.
- **Radial and linear gauges with `gauge.layout: "multiple"`** draw one gauge per value: up to 6 dials, which arrange themselves in a grid to fit the card, or up to 8 stacked bars. Each gauge has its own label, multiplier, offset, range and thresholds. A gauge with no min or max uses the first gauge's. The card's border and badge show the worst alert among them.

**Options**

| Key | Applies to | Options |
|---|---|---|
| `gauge` | radial gauge | `layout` (`marker` or `multiple`), `sweep` (180, 240 or 270), `style` (`arc`, `needle` or `both`), `majorTicks`, `minorTicks`, `showZones` |
| `gauge` | linear gauge | `layout`, `majorTicks`, `showZones` |
| `chart` | time-series chart | `windowSec` (default window; 10 s, 30 s, 1 min or 5 min can be picked on the chart), `yScale` (`auto`, `zero` or `fixed`), `showGrid`, `fill` |
| `staleAfterSec` | all telemetry widgets | Seconds without the message before values dim and show **Stale** (default 3). |
| `stateThreshold` | LED, toggle feedback | On when the value is above this (default 0). |
| `feedback` | toggle switch | A binding to the field that reports the real state, e.g. `SERVO_OUTPUT_RAW.servo9_raw` with `stateThreshold: 1500`. The switch then shows what the vehicle reports, not what was last sent. |

Charts sample at 10 Hz and keep 10 minutes of history, shared between widgets bound to the same field. Pause a chart, then hover over it to read past values.

Action buttons, toggles and sliders show the vehicle's acknowledgement: accepted, denied, or no response. Imported widgets always require confirmation before sending:

```json
{
  "id": "custom-rtl-trigger",
  "name": "One-Touch RTL",
  "category": "control",
  "displayType": "action-button",
  "action": {
    "label": "Execute Return to Launch",
    "commandId": 20,
    "params": [0, 0, 0, 0, 0, 0, 0],
    "confirmation": true
  }
}
```

---

## Acknowledgements

The link transports in `src/mavlink/transport/` (WebSocket, Web Serial, and serial over WebUSB for Android) are adapted from [ArduConfigurator](https://github.com/j-w9/arduconfigurator) (GPL-3.0-only). Each adapted file names its source and what was changed.
