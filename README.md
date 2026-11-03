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

- **MAVLink v2/v1 & MAVFTP Engine**:
  - In-browser binary framing, parsing, and CRC verification in TypeScript.
  - ArduPilot Mega (Copter, Plane, Rover, Sub, Tracker) dialect support with vehicle lock-on.
  - High-speed MAVFTP for parameters (`@PARAM/param.pck`), missions (`mission.dat`), fences (`fence.dat`), and rally points (`rally.dat`), with automatic fallback to legacy parameter and mission streaming.
  - Periodic GCS heartbeat broadcast with automatic reconnection.
- **Autopilot Glareshield & Controls**:
  - Slide-and-release confirmation to Arm / Disarm.
  - Mode switcher (Loiter, RTL, Auto, Guided, FBWA, Cruise, Stabilize, Land).
  - Target speed adjusters via `DO_CHANGE_SPEED`.
  - Quick action buttons (RTL, Pause/Loiter, Land, Takeoff).
- **Heads-Up Display (HUD) & Tactical Map**:
  - Canvas artificial horizon with pitch ladder, roll arc, airspeed, altitude, and heading tapes.
  - Leaflet-based map with configurable aspect ratios (4:3, 16:9, or full), high-zoom map tile overzoom (up to level 22), vehicle trail, mission waypoints, polygon fences, rally points, and follow mode.
  - Drag-and-drop mission, geofence, and rally file upload directly onto the map with MAVFTP and sequential item-by-item fallback (supports `.waypoints`, `.fence`, `.rally`, `.plan`, and binary `.dat`).
- **RTK / NTRIP & Base Station Correction Injection**:
  - Built-in RTCM3 injector widget supporting both NTRIP casters (with automatic NMEA GGA VRS position feedback) and direct USB serial base stations via the Web Serial API.
  - Real-time RTCM3 frame extraction, QualComm CRC24Q verification, message type detection, fragmentation, and MAVLink `GPS_RTCM_DATA` (Msg 233) injection.
- **Flight & System Telemetry Widgets**:
  - GNSS / GPS monitor supporting dual-module setups (GPS1 / GPS2 fix badges), satellite counts, HDOP, speed, and dual-antenna yaw.
  - Battery monitor with pack voltage, current, capacity remaining, and individual cell voltages.
  - StatusText message console with consecutive message grouping, counter badges, and cross-tab audio alert chimes.
- **Dynamic Bandwidth Management**:
  - Requests message intervals via `MAV_CMD_SET_MESSAGE_INTERVAL` adaptively based on visible widgets on screen.
  - Bandwidth profiles: Low (SiK 57600 baud), Standard (115200 baud), and High (WiFi/Ethernet).
- **Custom Widget Engine & Dashboard Profiles**:
  - Declarative JSON widgets: stat cards, gauges, LED indicators, switches, sliders, multi-bar channel visualizers (RC, servos, ESCs), compass roses, sparklines, and parameter controls.
  - Safe parameter controls with autopilot type verification, vehicle echo confirmation, and out-of-bounds warning checks.
  - Component-level Error Boundaries isolating individual card crashes from taking down the dashboard.
  - Multi-tab customizable dashboard with drag-and-drop layout, import/export, and ID collision protection.
- **Companion Bridge**:
  - Python bridge (`bridge/bridge.py`) for UDP (SITL `14550`), TCP (`5760`), or Serial (`/dev/ttyUSB0`) to WebSockets.
  - Built-in `--mock` mode for offline testing and development.

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

Custom widgets are declarative JSON definitions safe from arbitrary code execution:

```json
{
  "id": "custom-bus-voltage",
  "name": "Bus Voltage Monitor",
  "category": "telemetry",
  "displayType": "gauge-linear",
  "binding": {
    "messageName": "SYS_STATUS",
    "fieldName": "voltage_battery",
    "unit": "V",
    "min": 10.0,
    "max": 16.8,
    "decimals": 2
  }
}
```

Action buttons enforce confirmation on execution:

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
