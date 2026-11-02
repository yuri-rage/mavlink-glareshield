# MAVLink Glareshield

A widget-based web application for bidirectional ArduPilot control and telemetry over WebSocket. Features a main dashboard panel, heads-up display (HUD), tactical map, dynamic bandwidth negotiation, and a declarative JSON custom widget engine.

Designed to remove the "glare" from more fully featured GCS applications and focus on core display elements with a high degree of flexibility and user customization options.

---

## Features

- **MAVLink v2/v1 & MAVFTP Engine**:
  - In-browser binary framing, parsing, and CRC verification in TypeScript.
  - ArduPilot Mega (Copter, Plane, Rover) dialect support with vehicle lock-on.
  - High-speed MAVFTP for parameters (`@PARAM/param.pck`) and missions (`mission.dat`), with automatic fallback to legacy parameter and mission streaming.
  - Periodic GCS heartbeat broadcast with automatic reconnection.
- **Autopilot Glareshield & Controls**:
  - Slide-and-release confirmation to Arm / Disarm.
  - Mode switcher (Loiter, RTL, Auto, Guided, FBWA, Cruise, Stabilize, Land).
  - Target altitude and speed adjusters via `DO_REPOSITION` and `DO_CHANGE_SPEED`.
  - Quick action buttons (RTL, Pause/Loiter, Land, Takeoff).
- **Heads-Up Display (HUD) & Tactical Map**:
  - Canvas artificial horizon with pitch ladder, roll arc, airspeed, altitude, and heading tapes.
  - Leaflet-based map with vehicle trail, mission waypoints, fences, and follow mode.
- **Dynamic Bandwidth Management**:
  - Requests message intervals via `MAV_CMD_SET_MESSAGE_INTERVAL` only for widgets on screen.
  - Bandwidth profiles: Low (SiK 57600 baud), Standard (115200 baud), and High (WiFi/Ethernet).
- **Custom Widget Engine**:
  - Declarative JSON widgets (stat cards, gauges, LED indicators, switches, action buttons with confirmation).
  - Multi-tab customizable dashboard with layout persistence.
- **Companion Bridge**:
  - Python bridge (`bridge/bridge.py`) for UDP (SITL `14550`), TCP (`5760`), or Serial (`/dev/ttyUSB0`) to WebSockets.
  - Built-in `--mock` mode for offline testing.

---

## Quickstart

### 1. Requirements
- Node.js 18+ and npm
- Python 3.8+ with `websockets` and `pyserial` (or use `nix-shell` / `direnv`)

### 2. Start the Telemetry Bridge

```bash
# Option A: Start simulated mock telemetry
python3 bridge/bridge.py --mock

# Option B: Connect to ArduPilot SITL over UDP
python3 bridge/bridge.py --udp 127.0.0.1:14550

# Option C: Connect to physical telemetry radio over Serial
python3 bridge/bridge.py --serial /dev/ttyUSB0:57600
```
By default, the bridge listens on `ws://127.0.0.1:56781`.

### 3. Start the Web Application

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. The application connects automatically to `ws://localhost:56781` (custom endpoints entered in Link Settings are saved to localStorage).

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

---

## Testing & Build

```bash
# Run unit tests and pymavlink golden vector validation
npm test

# Build production bundle
npm run build
```

For advanced testing workflows (e.g. regenerating golden vectors or running mock bridge telemetry validation), see [tests/README.md](tests/README.md).
