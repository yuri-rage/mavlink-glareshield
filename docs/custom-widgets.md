# Custom Widgets

Glareshield's custom widgets are **declarative JSON definitions**. A definition says which MAVLink fields to show, how to scale them and how to draw them. For control widgets, it also says which command or parameter to send. A definition contains no code, so a widget file from someone else can't run anything in your browser. Every imported file is validated and cleaned before it is used (see [Importing safely](#importing-safely)).

This guide covers:

- [Creating a widget in the app](#creating-a-widget-in-the-app)
- [Sharing widgets: export and import](#sharing-widgets-export-and-import)
- [The definition format](#the-definition-format)
- [Data bindings](#data-bindings)
- [Display types](#display-types), each with an example
- [Control widgets](#control-widgets): commands, toggles, sliders and parameters
- [Composite widgets](#composite-widgets): several panels in one card, in JSON or the creator
- [Stale data, alerts and colours](#stale-data-alerts-and-colours)
- [Limits and validation rules](#limits-and-validation-rules)
- [Troubleshooting](#troubleshooting)

---

## Creating a widget in the app

The quickest way to write a definition is to let the app write it for you.

1. Connect to the vehicle, or to SITL. You can build widgets offline, but a live link lets the creator list the fields the vehicle is actually sending.
2. Turn on **Edit Mode** (the pencil button in the dashboard header). Then choose **Add Widget → Build Custom Widget**.
3. Pick a **display type** and a **category**. Name the widget and, if you like, describe it.
4. Bind the value. Choose a message, then a field:
   - Fields the vehicle is sending now are marked **●**.
   - **Other field…** lets you type any field name the app decodes.
5. Set the scaling, units, range and thresholds. The **live preview** updates as you type. It shows real telemetry but is inert: control widgets in the preview never send anything.
6. Add more values if the display type takes them (**Add value**, **Add gauge** or **Add marker**).
7. Choose **Save & Place** to add the widget to the current tab. Choose **Export Widget JSON** to download it as `<name>.widget.json`.

To change a widget later, enter Edit Mode and click the pencil on the widget's card. The same creator opens with its settings filled in.

## Sharing widgets: export and import

| To share | Do this | File |
|---|---|---|
| One widget | **Export Widget JSON** in the creator | `<name>.widget.json`: a single definition |
| A whole layout | The **Layout Profile & Backup Manager**: **Export Active Profile** | A profile: tabs, layout and every custom widget |

**To import a widget,** open **Edit Mode → Add Widget** and choose **Upload .json Widget**. Select a `.json` file containing one definition. An **Import Preview** shows what the widget is:

- its display type, category and binding;
- for command widgets, the exact `MAV_CMD` and the seven parameters;
- for parameter widgets, the target parameter, its allowed range and options.

Nothing is placed until you confirm.

**To import a profile,** use the Profile Manager. Choose **Import Profile (.json)** or paste the JSON. After a preview, **Confirm & Apply Profile** replaces your tabs and layout. Its custom widgets go through the same cleaning as single widget imports.

### Importing safely

Every imported definition is cleaned before use:

- **Confirmation is always on.** `action.confirmation` and `paramControl.confirmation` are forced to `true`, whatever the file says. An imported widget can't send a command or write a parameter without you confirming it. You can turn confirmation off afterwards in the creator if you trust the widget.
- **IDs never collide.** If the imported `id` already exists, the widget gets a fresh ID and an **(imported)** suffix on its name, so your existing widget is never overwritten.
- **Invalid values are clamped or dropped.** The full list is under [Limits and validation rules](#limits-and-validation-rules).
- **Unknown display types fall back.** An unknown `displayType` becomes `stat-card`. An unknown multi-bar group becomes `rc-8`.

Review the preview for every **control** widget you import, as you would any command someone hands you.

---

## The definition format

The smallest useful widget:

```json
{
  "id": "custom-groundspeed",
  "name": "Ground Speed",
  "category": "telemetry",
  "displayType": "stat-card",
  "binding": {
    "messageName": "VFR_HUD",
    "fieldName": "groundspeed",
    "unitKind": "speed",
    "decimals": 1
  }
}
```

### Top-level fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique ID. Prefix it with `custom-` by convention. |
| `name` | string | yes | Title shown on the card. |
| `description` | string | | Shown in the widget picker. A `text-display` also uses it as its label. |
| `category` | `telemetry` \| `control` \| `avionics` \| `custom` | yes | Where the widget is listed in **Add Widget**. |
| `displayType` | string | yes | How the widget is drawn. See [Display types](#display-types). |
| `binding` | [binding](#data-bindings) | telemetry types | The primary value. |
| `bindings` | binding[] | | Extra values after `binding` (series, rows, markers or extra gauges). |
| `gauge` | object | | Options for radial and linear gauges. |
| `chart` | object | | Options for the time-series chart. |
| `multiBarConfig` | `{ "group": … }` | `multi-bar` | Which preset group of bars to draw. |
| `action` | object | command types | The command for buttons, toggles and sliders. |
| `paramControl` | object | `param-control` | The parameter to read and write. |
| `feedback` | binding | | `toggle-switch` only: the field that reports the real on/off state. |
| `stateThreshold` | number | | `indicator-led` and toggle `feedback`: "on" means the value is above this. Default `0`. |
| `staleAfterSec` | number | | Seconds without the message before the widget shows **Stale**. Default `3`. |
| `colorScheme` | `default` \| `green` \| `amber` \| `blue` \| `red` | | The widget's accent colour. |
| `panels` | panel[] | `composite` | The panels of a [composite widget](#composite-widgets). |
| `minWidth`, `minHeight` | number | | Reserved. Not used yet. |

---

## Data bindings

A binding says where a value comes from and how to present it.

```json
{
  "messageName": "SYS_STATUS",
  "fieldName": "voltage_battery",
  "unit": "V",
  "multiplier": 1,
  "offset": 0,
  "decimals": 2,
  "min": 13.0,
  "max": 16.8,
  "warnThreshold": 14.8,
  "critThreshold": 14.2,
  "thresholdInvert": true,
  "label": "Bus",
  "color": "#38bdf8"
}
```

| Field | Meaning |
|---|---|
| `messageName` | MAVLink message name, for example `VFR_HUD`. Use `RC_CHANNELS (scaled)` or `SERVO_OUTPUT_RAW (scaled)` for normalised RC and servo values (see below). |
| `fieldName` | Field within the message. |
| `multiplier`, `offset` | The displayed value is `raw × multiplier + offset`. Defaults are 1 and 0. |
| `bit` | Read one bit of a bitmask field (0 = least significant, up to 31): the raw value becomes 0 or 1. For example, `RELAY_STATUS.on` with `bit: 2` is relay 3. |
| `unit` | Unit text shown after the value. |
| `unitKind` | `none` (default), `speed`, `altitude` or `distance`. See [Units](#units). |
| `decimals` | Decimal places, 0–6. |
| `min`, `max` | The range of a gauge, bar or fixed chart axis. |
| `warnThreshold`, `critThreshold` | Values where the widget turns amber and red. Gauges also draw these as zones. |
| `thresholdInvert` | `false` (default): alert when the value is **above** the thresholds, as for temperature. `true`: alert when it is **below** them, as for voltage or satellite count. |
| `label` | Name of the row, series or gauge, for widgets showing several values. A time-series chart always shows a label you set in its legend, even for a single series. |
| `color` | Hex colour of the series or row, for example `#f59e0b`. Only hex colours are accepted. |

### Which fields can be bound

**Any decoded field of any message the vehicle sends.** The creator lists a catalogue of common fields, adds the fields it has actually received from the vehicle (marked ●), and accepts any other name through **Other field…**.

The messages the dashboard itself uses, such as `ATTITUDE`, `VFR_HUD`, `GLOBAL_POSITION_INT`, `SYS_STATUS` and `GPS_RAW_INT`, arrive already converted to engineering units: volts, amps, metres and degrees. For example, `SYS_STATUS.voltage_battery` is in volts and `GLOBAL_POSITION_INT.relative_alt` is in metres. A few convenience fields are also provided, such as `ATTITUDE.rollDeg`, `pitchDeg` and `yawDeg`. Fields of other messages are in their raw MAVLink units, for example centidegrees or millivolts. Check the value in the live preview, then set `multiplier` to convert it.

**Normalised RC and servo values.** `RC_CHANNELS (scaled)` (`chan1_scaled` … `chan16_scaled`) and `SERVO_OUTPUT_RAW (scaled)` (`servo1_scaled` … `servo16_scaled`) give each PWM value as a number from −1 to 1. The scaling uses the vehicle's own calibration:

- RC channels use `RCn_MIN`, `RCn_TRIM` and `RCn_MAX`.
- Servo outputs use `SERVOn_MIN`, `SERVOn_TRIM` and `SERVOn_MAX`.

Trim maps to 0. When the parameters haven't been downloaded yet, the scaling assumes 1000 / 1500 / 2000. To show a percentage, multiply by 100.

### Units

With `unitKind` set, the value is converted into the units chosen in **Link & Display Settings**:

| `unitKind` | Source value must be in | Shown as |
|---|---|---|
| `speed` | m/s | m/s, km/h, mph or kn |
| `altitude` | m | m or ft |
| `distance` | m | m, km, ft or mi |

`min`, `max` and the thresholds always stay in the **source units** (m/s or m), so a widget behaves the same whatever display units someone picks. If you set `unitKind`, leave `unit` empty: the unit label comes from the user's setting.

### Order of operations

1. The raw value is read.
2. `raw × multiplier + offset` gives the value in base units. Ranges and thresholds are compared against this value.
3. `unitKind` converts it to display units.
4. `decimals` rounds it for display.

---

## Display types

Telemetry types take one value in `binding`. Some also take more in `bindings`:

| Display type | Extra values in `bindings` |
|---|---|
| `stat-card`, `text-display`, `indicator-led` | none |
| `value-list` | up to 15 (16 rows) |
| `sparkline` (time-series chart) | up to 7 (8 series) |
| `gauge-radial`, `gauge-linear`, `compass-rose` | 1 marker |
| `gauge-radial` with `gauge.layout: "multiple"` | up to 5 (6 dials) |
| `gauge-linear` with `gauge.layout: "multiple"` | up to 7 (8 bars) |

### `stat-card`

One large number with its unit, coloured by the thresholds.

### `text-display`

A compact one-line readout, `<description>: <value> <unit>`, for when space is tight.

```json
{
  "id": "custom-gps-hdop",
  "name": "GPS HDOP",
  "description": "HDOP",
  "category": "telemetry",
  "displayType": "text-display",
  "binding": { "messageName": "GPS_RAW_INT", "fieldName": "eph", "decimals": 2 }
}
```

### `value-list`

A table with one row per value. Each row has its own label, scaling, thresholds and colour, so related numbers fit in one card.

```json
{
  "id": "custom-power-summary",
  "name": "Power",
  "category": "telemetry",
  "displayType": "value-list",
  "binding": { "messageName": "SYS_STATUS", "fieldName": "voltage_battery", "label": "Voltage", "unit": "V", "decimals": 2, "warnThreshold": 14.8, "critThreshold": 14.2, "thresholdInvert": true },
  "bindings": [
    { "messageName": "SYS_STATUS", "fieldName": "current_battery", "label": "Current", "unit": "A", "decimals": 1 },
    { "messageName": "SYS_STATUS", "fieldName": "battery_remaining", "label": "Remaining", "unit": "%", "decimals": 0, "warnThreshold": 30, "critThreshold": 15, "thresholdInvert": true },
    { "messageName": "POWER_STATUS", "fieldName": "Vcc", "label": "Board 5V", "unit": "V", "decimals": 2 }
  ]
}
```

### `gauge-radial`

A dial. `binding.min` and `binding.max` set its range, and the thresholds draw green, amber and red zones.

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
  },
  "gauge": { "sweep": 240, "style": "both", "majorTicks": 5, "minorTicks": 4, "showZones": true }
}
```

| `gauge` option | Values | Default |
|---|---|---|
| `layout` | `marker`: one gauge, with the first extra value as a magenta marker. `multiple`: one gauge per value. | `marker` |
| `sweep` | `180`, `240` or `270` degrees of arc | `240` |
| `style` | `arc` (filled arc), `needle`, or `both` | `both` |
| `majorTicks` | 2–12 labelled ticks | 5 |
| `minorTicks` | 0–9 ticks between major ticks | 4 |
| `showZones` | draw threshold zones on the scale | `true` |

**Marker layout.** The marker shows a second value on the same scale, such as airspeed against groundspeed:

```json
{
  "id": "custom-ground-vs-air",
  "name": "Ground vs Air Speed",
  "category": "telemetry",
  "displayType": "gauge-radial",
  "binding": { "messageName": "VFR_HUD", "fieldName": "groundspeed", "unitKind": "speed", "min": 0, "max": 10, "decimals": 1 },
  "bindings": [ { "messageName": "VFR_HUD", "fieldName": "airspeed", "label": "Air", "unitKind": "speed" } ],
  "gauge": { "layout": "marker" }
}
```

**Multiple layout.** Each value gets its own dial, with its own label, multiplier, offset, range and thresholds. A dial with no `min` or `max` takes the first dial's. The dials arrange themselves in a grid to fit the card. The card's border and badge show the worst alert among them.

```json
{
  "id": "custom-esc-temps",
  "name": "Motor Temps",
  "category": "telemetry",
  "displayType": "gauge-radial",
  "binding": { "messageName": "ESC_TELEMETRY_1_TO_4", "fieldName": "temp1", "label": "M1", "unit": "°C", "min": 0, "max": 120, "warnThreshold": 80, "critThreshold": 100 },
  "bindings": [
    { "messageName": "ESC_TELEMETRY_1_TO_4", "fieldName": "temp2", "label": "M2", "unit": "°C", "warnThreshold": 80, "critThreshold": 100 },
    { "messageName": "ESC_TELEMETRY_1_TO_4", "fieldName": "temp3", "label": "M3", "unit": "°C", "warnThreshold": 80, "critThreshold": 100 },
    { "messageName": "ESC_TELEMETRY_1_TO_4", "fieldName": "temp4", "label": "M4", "unit": "°C", "warnThreshold": 80, "critThreshold": 100 }
  ],
  "gauge": { "layout": "multiple", "sweep": 240, "style": "arc", "majorTicks": 4, "minorTicks": 1 }
}
```

Each dial keeps its own scale, so dials with very different ranges sit side by side. For example, a −100…100 throttle dial can sit next to a 0…4000 RPM dial.

### `gauge-linear`

A horizontal bar gauge. It uses the same `binding`, range and threshold rules as the radial gauge. Its `gauge` options are `layout`, `majorTicks` and `showZones`. With `layout: "multiple"`, it draws up to 8 stacked bars, each with its own scale. This is handy for a column of RC channels or servo outputs:

```json
{
  "id": "custom-steer-throttle",
  "name": "Steering & Throttle",
  "category": "telemetry",
  "displayType": "gauge-linear",
  "binding": { "messageName": "SERVO_OUTPUT_RAW (scaled)", "fieldName": "servo1_scaled", "label": "Steer", "unit": "%", "multiplier": 100, "min": -100, "max": 100, "decimals": 0 },
  "bindings": [
    { "messageName": "SERVO_OUTPUT_RAW (scaled)", "fieldName": "servo3_scaled", "label": "Throttle", "unit": "%", "multiplier": 100, "min": -100, "max": 100, "decimals": 0 }
  ],
  "gauge": { "layout": "multiple", "majorTicks": 5, "showZones": false }
}
```

### `sparkline` (time-series chart)

A live line chart that plots each value as its own series, with a legend and each series' latest value. The values are sampled at 10 Hz into a 10-minute history. Charts bound to the same field share one history.

On the chart itself you can:

- pick a window of 10 s, 30 s, 1 min or 5 min;
- **pause** it, then hover over it to read past values at any moment.

```json
{
  "id": "custom-attitude-trend",
  "name": "Roll & Pitch",
  "category": "telemetry",
  "displayType": "sparkline",
  "binding": { "messageName": "ATTITUDE", "fieldName": "rollDeg", "label": "Roll", "unit": "°", "decimals": 1, "color": "#38bdf8" },
  "bindings": [
    { "messageName": "ATTITUDE", "fieldName": "pitchDeg", "label": "Pitch", "unit": "°", "decimals": 1, "color": "#f59e0b" }
  ],
  "chart": { "windowSec": 30, "yScale": "auto", "showGrid": true, "fill": false }
}
```

| `chart` option | Values | Default |
|---|---|---|
| `windowSec` | Window shown when the widget loads, 5–600 s | 30 |
| `yScale` | `auto`: fit the data. `zero`: fit the data but always include 0. `fixed`: use the first binding's `min` and `max`. | `auto` |
| `showGrid` | Draw grid lines | `true` |
| `fill` | Shade the area under a single-series line | `false` |

### `compass-rose`

A heading rose for a value in degrees, such as `VFR_HUD.heading` or `GPS_RAW_INT.cog`. The first extra value is drawn as a second pointer, for example the bearing to the next waypoint (`NAV_CONTROLLER_OUTPUT.target_bearing`).

### `multi-bar`

A preset group of bars, chosen with `multiBarConfig.group`. These take no `binding`:

| `group` | Shows |
|---|---|
| `rc-8` / `rc-8-scaled` | RC inputs 1–8, raw PWM or normalised −1…1 |
| `servo-8` / `servo-8-scaled` | Servo outputs 1–8, raw PWM or normalised |
| `esc-rpm`, `esc-temp`, `esc-current` | ESC telemetry, motors 1–4 |
| `vibration-xyz` | Vibration on X, Y and Z |
| `ekf-variances` | EKF velocity, horizontal and vertical position, and compass variances |
| `battery-cells` | Per-cell voltages, from `BATTERY_STATUS` |

```json
{
  "id": "custom-rc-inputs",
  "name": "RC Inputs",
  "category": "telemetry",
  "displayType": "multi-bar",
  "multiBarConfig": { "group": "rc-8-scaled" }
}
```

### `indicator-led`

A status light. It is **on** when the value is above `stateThreshold` and the data isn't stale.

```json
{
  "id": "custom-pump-led",
  "name": "Pump Running",
  "category": "avionics",
  "displayType": "indicator-led",
  "binding": { "messageName": "SERVO_OUTPUT_RAW", "fieldName": "servo9_raw" },
  "stateThreshold": 1500,
  "colorScheme": "green"
}
```

---

## Control widgets

Control widgets send a MAVLink `COMMAND_LONG`, or a `PARAM_SET`, to the vehicle. They report the vehicle's answer on the card: **accepted**, **denied**, or **no response**.

The `action` object, used by `action-button`, `toggle-switch` and `slider-control`:

| Field | Meaning |
|---|---|
| `label` | Button text and the name used in status messages. |
| `commandId` | The `MAV_CMD` number, for example `20` for `MAV_CMD_NAV_RETURN_TO_LAUNCH`. |
| `params` | Seven numbers, `param1` … `param7`. |
| `confirmation` | Ask for a second click before sending (toggles: slide to switch instead). Always `true` after an import. |

### `action-button`

Sends `commandId` with `params` exactly as written.

```json
{
  "id": "custom-rtl",
  "name": "Return to Launch",
  "category": "control",
  "displayType": "action-button",
  "action": { "label": "Return to Launch", "commandId": 20, "params": [0, 0, 0, 0, 0, 0, 0], "confirmation": true }
}
```

### `toggle-switch`

An on/off switch. What it sends depends on the command:

| `commandId` | Sent when switched |
|---|---|
| `181` `DO_SET_RELAY` | `param1` = relay number, as written. `param2` = 1 for on, 0 for off. |
| `183` `DO_SET_SERVO` | `param1` = servo number, as written. `param2` = the ON PWM when on, and the OFF PWM (your `params[2]`) when off. Defaults are 1900 and 1100. |
| anything else | `param1` = 1 for on, 0 for off. The other params are sent as written. |

With `confirmation` on (always the case after an import), the switch is a **slide-to-confirm** control, like the arming slider: drag the handle from the left end all the way to the right and let go. Anything shorter springs back and sends nothing, so there's no separate confirm step. The slider is locked while there's no vehicle link. With `confirmation` off, it's a plain tap switch.

**Relay toggles follow the vehicle on their own.** A toggle that sends `181` `DO_SET_RELAY` with no `feedback` reads the vehicle's `RELAY_STATUS` message, which reports every relay as one bit of its `on` field (bit *n* is relay instance *n*, as in `param1`). The app asks the vehicle to stream it at 1 Hz. The card then shows the relay's real state, for example **RELAY3 ON**, even when something else switched it. If the vehicle reports that relay as not configured (its bit of `RELAY_STATUS.present` is 0), the card says so. Firmware that doesn't send `RELAY_STATUS` falls back to the last value sent.

```json
{
  "id": "custom-pump-relay",
  "name": "Pump",
  "category": "control",
  "displayType": "toggle-switch",
  "action": { "label": "Pump", "commandId": 181, "params": [2, 0, 0, 0, 0, 0, 0], "confirmation": true }
}
```

Without feedback, a toggle shows what it last sent; a command the vehicle rejects or doesn't answer leaves the switch where it was. For other commands (or to override the automatic relay state), add `feedback` to make the switch show what the vehicle reports instead. For example, read back the servo output, which is on above `stateThreshold`:

```json
{
  "id": "custom-lights",
  "name": "Lights",
  "category": "control",
  "displayType": "toggle-switch",
  "action": { "label": "Lights", "commandId": 183, "params": [9, 1900, 1100, 0, 0, 0, 0], "confirmation": true },
  "feedback": { "messageName": "SERVO_OUTPUT_RAW", "fieldName": "servo9_raw" },
  "stateThreshold": 1500
}
```

The card then shows **Vehicle State** and the reported value. Until feedback arrives, or while it is stale, the card falls back to the last value sent and says so.

### `slider-control`

A slider whose value is sent with the command. `binding` sets the slider's range and unit through `min`, `max`, `unit` and `decimals`.

- For commands `178` `DO_CHANGE_SPEED`, `181` `DO_SET_RELAY` and `183` `DO_SET_SERVO`, the value goes in `param2`.
- For any other command, it goes in `param1`.

```json
{
  "id": "custom-cruise-speed",
  "name": "Cruise Speed",
  "category": "control",
  "displayType": "slider-control",
  "binding": { "messageName": "VFR_HUD", "fieldName": "groundspeed", "unit": "m/s", "min": 0, "max": 5, "decimals": 1 },
  "action": { "label": "Set Speed", "commandId": 178, "params": [1, 0, -1, 0, 0, 0, 0], "confirmation": true }
}
```

### `param-control`

Reads a vehicle parameter and writes a new value to it. The widget shows the parameter's current value. It refuses to write until it knows the parameter's type from the vehicle, and if the type is unknown it requests the parameter first. It then waits for the vehicle to echo the new value back. If no echo arrives, it warns you.

| `paramControl` field | Meaning |
|---|---|
| `paramId` | Parameter name, for example `WPNAV_SPEED`. |
| `min`, `max` | The expected range. A value outside it asks for a separate, explicit confirmation, even when `confirmation` is off. |
| `step` | Step for the input. |
| `unit` | Unit text. |
| `options` | A list of `{ "label", "value" }` pairs. When present, the widget shows a dropdown instead of a number box. |
| `confirmation` | Ask before every write. Always `true` after an import. |

```json
{
  "id": "custom-fence-action",
  "name": "Fence Action",
  "category": "control",
  "displayType": "param-control",
  "paramControl": {
    "paramId": "FENCE_ACTION",
    "options": [
      { "label": "Report only", "value": 0 },
      { "label": "RTL or Land", "value": 1 },
      { "label": "Always Land", "value": 2 },
      { "label": "SmartRTL or RTL or Land", "value": 3 },
      { "label": "Brake or Land", "value": 4 }
    ],
    "confirmation": true
  }
}
```

---

## Composite widgets

A composite widget puts several panels in one card: a gauge, a toggle and a chart, for example. Set `displayType` to `composite` and list the panels in `panels`. Each panel takes the same settings as a single widget of that type (`displayType`, `binding`, `bindings`, `gauge`, `chart`, `action`, `paramControl`, `feedback`, and so on), plus two of its own:

| Panel field | Meaning |
|---|---|
| `title` | Small heading above the panel. Control panels also use it to name what they send. |
| `span` | Width in twelfths of the card: `12` (the default) is a full row, `9` is three quarters, `6` is half and `4` is a third. Panels fill rows left to right. |
| `widgetId` | `builtin` panels only: which [built-in widget](#built-in-widgets-as-panels) to show. |

The card's `name`, `category`, `colorScheme` and `staleAfterSec` apply to every panel that doesn't set its own.

```json
{
  "id": "custom-pump-station",
  "name": "Pump Station",
  "category": "control",
  "displayType": "composite",
  "panels": [
    { "title": "Pressure", "span": 6, "displayType": "gauge-radial",
      "binding": { "messageName": "SCALED_PRESSURE", "fieldName": "press_diff", "unit": "hPa", "min": 0, "max": 50, "warnThreshold": 40 } },
    { "title": "Pump", "span": 6, "displayType": "toggle-switch",
      "action": { "label": "Pump", "commandId": 183, "params": [9, 1900, 1100, 0, 0, 0, 0], "confirmation": true },
      "feedback": { "messageName": "SERVO_OUTPUT_RAW", "fieldName": "servo9_raw" }, "stateThreshold": 1500 },
    { "title": "Pressure history", "displayType": "sparkline",
      "binding": { "messageName": "SCALED_PRESSURE", "fieldName": "press_diff", "label": "Pressure" }, "chart": { "windowSec": 60 } }
  ]
}
```

### Built-in widgets as panels

A panel can also hold one of the dashboard's built-in widgets: set `displayType` to `builtin` and name it in `widgetId`. It works exactly as on the dashboard, with its own title row and badges (the panel's `title` names it in the creator's list only). Its own frame is dropped, because the panel draws one.

```json
{
  "id": "custom-nav-station",
  "name": "Nav Station",
  "category": "telemetry",
  "displayType": "composite",
  "panels": [
    { "displayType": "builtin", "widgetId": "built-in-gps-card", "span": 6 },
    { "displayType": "builtin", "widgetId": "built-in-battery-card", "span": 6 },
    { "displayType": "builtin", "widgetId": "built-in-map" }
  ]
}
```

| `widgetId` | Widget | Notes |
|---|---|---|
| `built-in-gps-card` | GNSS / GPS | |
| `built-in-battery-card` | Battery & Power | |
| `built-in-vfr-hud` | VFR Flight Metrics | |
| `built-in-hud` | Heads-Up Display | At least 300 px tall. A second HUD opens a second camera stream. |
| `built-in-charts` | Telemetry Charts | At least 300 px tall |
| `built-in-statustext` | STATUSTEXT Console | At least 280 px tall |
| `built-in-statustext-mini` | Mini STATUSTEXT | Compact; newest at the top or the bottom (header toggle). Grows with the panels beside it. |
| `built-in-glareshield` | Flight Controls | Controls: arm / disarm, flight modes |
| `built-in-all-modes` | All Flight Modes | Controls: flight modes |
| `built-in-set-speed` | Set Speed Controller | Controls: speed |
| `built-in-waypoints` | Waypoint Navigation | Controls: waypoint changes, mission restart |
| `built-in-map` | Navigation Map | Large. Controls: waypoint changes, mission restart. Uses its full-width layout when the panel is at least 900 px wide. |
| `built-in-parameters` | Parameter Manager | Large, at least 480 px tall. Controls: parameter writes |
| `built-in-ntrip` | RTK / NTRIP Injector | Large. Controls: RTCM injection |

Built-in controls keep their own confirmations, exactly as when you place the widget yourself; the import preview lists which panels have them. A `builtin` panel with an unknown `widgetId` is dropped on import, and a custom widget can't be embedded this way.

How a composite card behaves:

- **Alerts.** Each panel's border turns amber or red with its own thresholds. The card's border and badge show the worst panel.
- **Stale data.** The card's **Stale** badge covers every panel's values. Each panel dims on its own.
- **Controls.** Each control panel confirms, sends and shows the vehicle's acknowledgement on its own. Arming one never affects another.
- **Narrow cards.** In a card narrower than about 360 px, such as on a phone, every panel takes a full row.
- **Import.** The import preview lists every panel and every command or parameter write in it, and confirmation is forced on all of them.

### Building a composite in the creator

1. In the creator, set **Display UI Type** to **Composite (several panels in one card)**. Whatever you had set up becomes panel 1. For a built-in widget, set the panel type to **Built-in Widget** and pick one.
2. **Add panel** adds another, up to 8. Click a panel in the list to edit it: the settings below the list then apply to that panel (its type, title, width, accent colour and everything else).
3. Set each panel's width in the list, and reorder panels with the arrows. The preview shows the card as laid out.
4. **Save & Place** adds the card full width. **Export Widget JSON** saves the whole composite as one file.

The card's name, description and accent colour are at the top, as for any widget. A panel left on **Same as the card** uses the card's colour. The list counts the values the card reads; past 32, the card can't be saved until some are removed.

To turn a composite back into a single widget, choose **Single widget** in **Display UI Type**. The selected panel is kept, and the creator asks before dropping any others. This isn't offered while a built-in panel is selected: place a built-in widget from **Add Widget** instead.

---

## Stale data, alerts and colours

**Stale data.** If a widget's message hasn't arrived for `staleAfterSec` seconds (default 3), the value dims and the card shows **Stale**. A stale value never lights an LED, and it never drives a toggle's feedback state. Raise `staleAfterSec` for messages the vehicle sends slowly, such as `BATTERY_STATUS` at 1 Hz or less.

**Alerts.** When a value crosses `warnThreshold` it turns amber, and past `critThreshold` it turns red. `thresholdInvert` decides which direction counts. On widgets showing several values, the card's border shows the worst state among them.

**Colours.** `colorScheme` sets the widget's accent colour. Alerts override it. Series and row colours come from each binding's `color`, or from a built-in palette.

---

## Limits and validation rules

These rules apply to everything imported, and to everything saved from the creator:

| Item | Rule |
|---|---|
| `displayType` | Must be a known type, otherwise it becomes `stat-card`. |
| `panels` | At most 8, each cleaned by these same rules. A panel can't be `composite`. A composite reads at most 32 values in all; extra values are trimmed from the last panels first. |
| `action` | Needs a numeric `commandId`, otherwise it is dropped. `params` always becomes seven numbers; missing or invalid ones are 0. |
| `span` | 1–12 |
| `widgetId` | Must name a built-in widget, otherwise the panel is dropped. |
| `multiBarConfig.group` | Must be a known group, otherwise it becomes `rc-8`. |
| `bindings` | At most 16. The display type then uses as many as it supports (see [Display types](#display-types)). |
| `decimals` | 0–6 |
| `bit` | 0–31, whole numbers |
| `color` | Hex only, such as `#rgb` or `#rrggbb`. Anything else is dropped. |
| `gauge.majorTicks` / `minorTicks` | 2–12 / 0–9 |
| `gauge.sweep` | 180, 240 or 270 |
| `chart.windowSec` | 5–600 |
| `staleAfterSec` | 0.5–600 |
| `action.confirmation`, `paramControl.confirmation` | Forced to `true` on import. |
| Duplicate `id` | Reassigned, with **(imported)** added to the name. |

Fields the app doesn't recognise are kept in the file but have no effect.

---

## Troubleshooting

**The value shows `--`.** The vehicle isn't sending that message, or the field name is wrong. In the creator, fields marked **●** are arriving now. If the message never appears, ask the autopilot for it. In ArduPilot, raise the matching `SRn_` stream rate, or the message's own rate.

**The number is 100× or 1000× too big.** The field is in raw MAVLink units, such as cm, mV or centidegrees. Set `multiplier`, for example `0.01` or `0.001`.

**The gauge needle sits at one end.** `min` and `max` are in the wrong units. They must be in base units, after `multiplier` and `offset` but before `unitKind` conversion.

**A gauge in the "multiple" layout uses the wrong range.** Give that binding its own `min` and `max`. Otherwise it takes the first gauge's.

**The toggle switch flips back.** Its `feedback` field reports a value that doesn't cross `stateThreshold`. Check the reported value shown on the card, and adjust the threshold or the ON and OFF PWM values.

**A command shows "denied" or "no response".** The autopilot rejected or ignored the command. Check the `commandId` and the parameter order in the MAVLink common message set. Some commands also only work in certain flight modes.
