# MAVLink Glareshield 🛸

A modern, mobile-friendly, widget-based web application for bidirectional ArduPilot control and telemetry over WebSocket. Styled with the clean aesthetic of **shadcn/ui**, it features interactive avionics, an Autopilot Glareshield control panel, a tactical navigation map, dynamic bandwidth negotiation, and a declarative JSON custom widget engine.

---

## ✨ Features

- **Bidirectional MAVLink v2/v1 & MAVFTP Acceleration**:
  - Direct raw binary framing and parsing in the browser via TypeScript.
  - Supports ArduPilot Mega (Copter, Plane, Rover) dialect.
  - **High-Speed MAVFTP**: Attempts MAVFTP (`FILE_TRANSFER_PROTOCOL` msg 110) first for both `@PARAM/param.pck` (compressed parameters) and `mission.dat` (waypoints), downloading in seconds. Automatically and seamlessly falls back to legacy streaming (`PARAM_REQUEST_LIST` and sequential `MISSION_REQUEST_LIST`) if MAVFTP is unavailable or times out.
  - Periodic GCS heartbeat broadcast with automatic reconnection.
- **Autopilot Glareshield & Flight Controls**:
  - Safety slide-to-confirm Arm / Disarm interlock.
  - Flight mode switcher (Loiter, RTL, Auto, Guided, FBWA, Cruise, Stabilize, Land).
  - Target Altitude and Speed adjusters with direct Guided commands.
  - Quick action buttons (RTL, Pause/Loiter, Land, Takeoff).
- **Tactical Navigation Map (Leaflet)**:
  - Real-time vehicle marker with heading orientation vector and position trail.
  - Live mission waypoint fetcher (`MISSION_REQUEST_LIST` / `MISSION_ITEM_INT`) displaying planned routes.
  - Center/Follow vehicle toggle.
- **Primary Flight Display (PFD)**:
  - High-performance HTML5 Canvas artificial horizon with pitch ladder and roll arc.
  - Dynamic airspeed and altitude indicator tapes.
  - Heading tape readout.
- **Dynamic Bandwidth Management**:
  - Automatically queries active dashboard widgets and requests `MAV_CMD_SET_MESSAGE_INTERVAL` only for rendered data.
  - Bandwidth profiles:
    - **SiK / Low Bandwidth (57600 baud)**: Clamped rates (max 4Hz) to protect serial radios.
    - **Standard (115200 baud)**: Balanced telemetry (max 10Hz).
    - **High Speed (WiFi / Ethernet)**: High-rate telemetry (up to 25Hz).
- **Declarative Custom Widgets (JSON-Driven)**:
  - Define custom telemetry instruments (stat cards, horizontal gauges, LED indicators, switches, action buttons) via pure JSON schema.
  - Visual In-App Widget Builder.
  - Upload or download `.widget.json` files.
- **User-Editable Multi-Tab Dashboard**:
  - Edit mode allowing users to resize (1/3, 1/2, Full width), reorder, add, or remove widgets.
  - Create and manage custom dashboard tabs (e.g. *Flight Deck*, *Tactical Map*, *Instruments*, *Console*).
  - Complete layout profile export and import via JSON.
- **Lightweight Companion Bridge**:
  - Standalone Python script (`bridge/bridge.py`) bridging UDP (SITL `14550`), TCP (`5760`), or Serial (`/dev/ttyUSB0`) to raw WebSockets.
  - Built-in `--mock` simulator for offline development without needing physical hardware or SITL.

---

## 🚀 Quickstart

### 1. Requirements
If using Nix/NixOS, run `nix-shell` (or `direnv allow`) which provides Node.js, Python 3, and `websockets`. Otherwise ensure:
- Node.js 18+ & npm
- Python 3.8+ with `pip install websockets pyserial` (for the bridge)

### 2. Start the Telemetry Bridge
You can run the built-in simulated ArduPilot mock telemetry or connect to SITL / a serial radio:

```bash
# Option A: Start in simulated mock mode (no ArduPilot needed)
python3 bridge/bridge.py --mock

# Option B: Connect to ArduPilot SITL over UDP
python3 bridge/bridge.py --udp 127.0.0.1:14550

# Option C: Connect to physical telemetry radio over Serial
python3 bridge/bridge.py --serial /dev/ttyUSB0:57600
```
The bridge runs on `ws://0.0.0.0:56781`.

### 3. Start the Web App
In a new terminal:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. The app will automatically connect to `ws://localhost:56781` (and will remember any custom host or port entered in Link Settings across page reloads).

---

## 🛠 Custom Widget JSON Specification

Custom widgets are declarative and safe to share without arbitrary code execution:

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

Or for a command trigger button:

```json
{
  "id": "custom-rtl-trigger",
  "name": "One-Touch RTL",
  "category": "control",
  "displayType": "action-button",
  "action": {
    "label": "Execute Return to Launch",
    "commandId": 20,
    "params": [0, 0, 0, 0, 0, 0, 0]
  }
}
```

---

## 🧪 Testing

Run unit tests for MAVLink v2 encoding, CRC-X25 calculation, and message decoders:

```bash
npm test
```

Build production bundle:

```bash
npm run build
```
