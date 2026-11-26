# User Guide

How to use Glareshield once it's connected. To connect, see the [README quickstart](../README.md#quickstart) and the
[Connection Guide](connection-guide.md). To build your own widgets, see the [Custom Widget Guide](custom-widgets.md).

- [Dashboard and layouts](#dashboard-and-layouts)
  - [The default dashboard](#the-default-dashboard)
  - [Flow tabs](#flow-tabs)
  - [Cockpit tabs](#cockpit-tabs)
  - [Arranging a Cockpit tab](#arranging-a-cockpit-tab)
  - [A wide layout for ultrawide screens](#a-wide-layout-for-ultrawide-screens)
  - [A compact layout for laptops](#a-compact-layout-for-laptops)
  - [Profiles and backup](#profiles-and-backup)
- [Flying](#flying)
  - [Arming, modes and quick actions](#arming-modes-and-quick-actions)
  - [Guided actions on the map](#guided-actions-on-the-map)
  - [Several vehicles on one link](#several-vehicles-on-one-link)
- [Planning missions, fences and rally points](#planning-missions-fences-and-rally-points)
- [Maps and offline use](#maps-and-offline-use)
- [Traffic (ADS-B) and terrain](#traffic-ads-b-and-terrain)
- [Video in the HUD](#video-in-the-hud)
- [Parameters and logs](#parameters-and-logs)
- [Settings, alerts and updates](#settings-alerts-and-updates)

---

## Dashboard and layouts

The dashboard is a set of tabs, each holding widgets: the HUD, the map, telemetry cards, Arm & Modes (arming and
quick modes), the message console, the parameter manager, charts, and your own custom widgets. **Edit Mode** (top
right of the tab bar) adds, removes and arranges them; while editing, the widgets' own controls are locked so nothing
is sent to the vehicle by accident. **Finish Edit** returns to flying.

In Edit Mode the toolbar has **Add Widget**, **Profiles & Backup**, and a switch for the tab's layout: **Flow** or
**Cockpit**. Tabs can be added, renamed, deleted and dragged into another order.

### The default dashboard

Out of the box the dashboard is three Cockpit tabs and a Flow tab. They start from an arrangement Mission Planner
users will know (the HUD at the top left, the map filling the right) and add values that warn, health bars, charts and
curated parameter lists, with layouts for ultrawide screens, laptops and phones.

- **Flight**: **Arm & Modes** pinned on top; the HUD over **Vitals** on the left; the map on the right, with **Track
  Error** and messages under it.
  - **Vitals**: battery %, voltage and current; GNSS HDOP, link loss and a throttle gauge; vibration and EKF variance
    bars. Battery (30 / 15 %), HDOP (1.4, ArduPilot's GPS_HDOP_GOOD default, / 2.0) and link loss (5 / 15 %) turn
    amber, then red, past their limits, as do the vibration and EKF bars at theirs; the card's border shows the worst.
    Values read "--" until the vehicle has sent them.
  - **Track Error** charts cross-track and altitude error: how well it holds its path in Auto and Guided, for every
    vehicle type. Mission progress is on the map.
  - On an ultrawide: HUD and Vitals, the map, then Track Error over the messages. On a laptop: HUD, Vitals and the map
    side by side, messages under the map.
- **Map**: the map, full window, to fly from (fly here, guided actions, mission control) and to plan (the map's
  **Mission** menu → **Edit mission on map**).
- **Tuning**: PID tuning over three curated parameter lists; on the right, a map and Track Error (to watch a tuning
  flight) over the full parameter list. On an ultrawide, PID tuning is a tall column and each list a full-height column
  beside it; on a laptop, PID tuning sits beside the parameter list. Where PID tuning is short of room, its two charts
  take turns (**Response** / **Terms**).
  - **Attitude Tuning**: the rate and angle controllers' gains (Copter and Rover `ATC_*`; Plane `RLL_RATE_*`,
    `PTCH_RATE_*`, `YAW_RATE_*`), without the filter and slew settings.
  - **Navigation**: Copter `WPNAV_*`, `LOIT_*` and the position controller's gains; Plane `NAVL1_*`, `WP_*`, the main
    `TECS_*` limits and the airspeeds.
  - **Failsafes & RTL**: `FS_*`, the battery failsafes, `RTL_*` and the fence's enable and action.

  The lists are patterns, so each vehicle shows only the parameters it has. Edit them with the widget's **Edit** button
  (`-` leaves matches out, e.g. `-*_SMAX`). Writes always ask first.

- **Mobile**: a Flow tab for a phone in the field: Arm & Modes, the HUD, the map, Vitals and messages, one under
  another (on a wider screen the HUD and map side by side). The Cockpit tabs work on a phone too, stacked; this one is
  in the order a phone wants.

Vitals, Track Error and the parameter lists are ordinary custom widgets: change their values and limits in Edit Mode
with the widget's **Edit** button (set the battery limits for your pack). A few more custom widgets (bus voltage, RC
channels, a wind rose, a speed setter, an RTL button) are in **Add Widget** as examples, on no tab.

Your dashboard is saved in the browser, so changing the default doesn't touch it. To get the default back without
touching your other settings, use **Reset to Default Layout** (Edit Mode → **Profiles & Backup**). **Restore defaults**
(Settings → Data) resets everything instead, including the link, units and alerts.

### Flow tabs

A Flow tab is a scrolling grid: widgets sit in rows and the page scrolls. It suits tabs with many cards, and any
screen size: on a narrow window the grid drops from four columns to three, two, then one.

In Edit Mode each widget has a width (¼ to full), a height (Compact, Normal, Tall), arrows to move it earlier or later,
and can be dragged onto another to swap them.

How wide a Flow tab may grow is set in **Settings → Display → Content width**: **Standard** (1280 px, centred),
**Wide** (1680 px) or **Full** (the whole window, for ultrawide and 4K screens). A full-width map keeps to the window's
height either way.

### Cockpit tabs

A Cockpit tab fills the window below the navbar, with no page scroll: a glass cockpit. Its widgets sit in panes
side by side and stacked, sized in proportion, so one layout scales from an HD laptop to a 4K screen. **Arm &
Modes** (arming and quick modes) is pinned above the panes as a single slim bar; its Takeoff checklist opens over the
panes rather than squeezing them. In Edit Mode, **Unpin** makes the bar a pane like any other (it starts across
the bottom; move and resize it from there), and the pane's pin button puts it back on top.

Each widget has a minimum size (the HUD 380×250, the map 320×240, a telemetry card 240×110, and so on). When the
window can't hold the layout at those sizes (a phone, a small window), the same widgets are shown stacked in reading
order instead, like a Flow tab. On a larger window the panes come back by themselves.

Cockpit tabs always fill the window; **Content width** doesn't apply to them.

### Arranging a Cockpit tab

Switch a tab to **Cockpit** in Edit Mode, then start from a **Preset…**:

| Preset | Layout |
| :--- | :--- |
| HD cockpit | HUD and map side by side, telemetry cards beneath (16:9 screens) |
| Ultrawide | HUD, map, and a column of telemetry and messages (21:9 screens) |
| Map first | A large map with the HUD and telemetry in a side column |
| This tab's widgets | The widgets already on the tab: large ones on top, small ones beneath |

A preset reuses the tab's own widgets and adds any it lacks. Then, in Edit Mode:

- **Resize**: drag the dividers between panes. Outside Edit Mode they're locked, so a stray drag in flight can't
  rearrange your instruments.
- **Move**: drag a pane (by its title or body) onto another. Dropping on an edge puts it on that side; dropping in the
  middle swaps the two. A highlight shows where it will go.
- **Across the whole layout**: once a drag moves away from where it started, a green strip appears along each outer
  edge of the layout. Drop on one to put the pane across the whole top or bottom, or down a whole side (a chart the
  full width of the screen, for example), rather than beside a single pane.
- **Add…**: put a widget on any side of a pane, or along a whole edge of the layout, either a new one or one hidden
  on the tab.
- **Replace…**: swap the pane with another, or show a different widget in it.
- **Edit** (custom widgets): open the custom widget editor.
- **Hide**: take the widget out of the layout. It stays on the tab, listed under **Not shown in this layout**, with
  **Show** to bring it back.
- **Delete**: remove the widget from the tab.

A custom widget fills its pane: a composite's rows share the pane's height and its values grow with the room. One
too tall for its pane scrolls inside its card.

If an edit would make the layout too big for the window, the tab is shown stacked while you edit it, with the same
controls, so you can hide or delete what you just added. While editing, the editor's own bars don't count against the
room: a layout that fits in flight stays as panes.

### A wide layout for ultrawide screens

A Cockpit tab can have a second layout for wide screens. In Edit Mode, **+ Wide** makes one as a copy of the
standard layout and starts editing it; arrange it as you like (the **Ultrawide** preset is a good start).

- The wide layout is used when the window is wider than 2.2:1 (and at least 1200 px wide): an ultrawide monitor. 16:9
  screens, laptops and phones use the standard layout.
- Edit Mode edits the layout on screen, and the toolbar says which: **(wide layout)** or **(standard layout)**. Its
  **Standard / Wide** switch edits either one from any screen.
- The layouts all show the tab's widgets. Hiding a widget in one leaves the others alone; deleting a widget from the
  tab removes it from every layout (you're asked first if another layout shows it).
- **Remove wide** drops the wide layout; the standard one is then used everywhere.

### A compact layout for laptops

A Cockpit tab arranged for a large screen may not fit a laptop's window; it's then shown stacked, as on a phone. A
**compact** layout is the tab arranged for that smaller window: **+ Compact** (Edit Mode) makes one as a copy of the
standard layout and starts editing it.

- It's used when the standard (or wide) layout doesn't fit the window and the compact one does, before falling back to
  the stacked list. There's no fixed size: a tab without a compact layout behaves as before, and one with it switches
  exactly where it would otherwise have stacked.
- While you edit it on a larger screen, it's shown in a dashed frame the size of a laptop's browser window, so what you
  arrange is what the laptop shows: **Preview** picks 1366×768 (the default), 1440×900 or 1536×864, or **off** to use
  the whole window.
- **Remove compact** drops it.

### Profiles and backup

**Profiles & Backup** (Edit Mode) exports the whole dashboard (tabs, layouts, custom widgets) as a JSON file and
imports one. An imported profile is checked first: anything in it that can act on the vehicle (custom widgets that send
commands or write parameters, built-in controls) is listed before you accept it, and imported custom widgets always ask
for confirmation before sending anything.

[`examples/`](../examples/) has widgets to import, such as one for a zero-turn mower.

---

## Flying

### Arming, modes and quick actions

- **Arm / disarm**: slide the **Slide to arm** control in **Arm & Modes**, or use the arm menu in the navbar. Force
  arm and force disarm are in that menu, each with its own confirmation.
- **Flight mode**: the mode badge in the navbar lists the vehicle's modes.
- **Quick actions**: Takeoff, Auto, Loiter, RTL and Land (Rover and boats get their own set). **Takeoff** opens a
  checklist: target altitude, then switching mode and arming in order, or **Auto: Takeoff** to run the sequence.
- **Pre-arm**: the navbar's health pill shows whether the vehicle is ready to arm, and why not.

Every command shows its result (accepted, refused and why, or no answer).

### Guided actions on the map

- **Fly here**: right-click the map (long-press on a touch screen), or use the map header's fly-to button (the arrow)
  then click the map. Choose the altitude above home, then **Switch to GUIDED & fly here**. The target is marked on the map
  until the vehicle arrives or leaves GUIDED.
- **Orbit here** (Plane): from the same card, with a radius.
- **Set home here**: from the same card; it asks again, since it moves home.
- **Fly to me**: after the fly-to button, the **Pick a point to fly to** bar has a button that sends the vehicle to
  where this device is (the browser asks for your location).
- The map header's **Altitude · speed · home** button changes altitude (Copter, Plane), changes speed (AUTO and
  GUIDED), pauses and resumes (Copter), and sets home to the vehicle's position.

Anything that moves home or takes the vehicle out of its mode asks for a second press that names the consequence.

### Several vehicles on one link

When more than one vehicle is heard on the link, a **SYS n / N** chip appears in the navbar: the vehicle being
commanded, of how many. The others show on the map as violet arrows labelled with their ID and mode.

- **Switching**: choose a vehicle from the chip's menu, or click its arrow on the map. If the current vehicle is armed,
  or a transfer (mission, parameters, logs) is under way, you're asked first, with what will happen. After a switch,
  the new vehicle's parameters and home are read afresh; download its mission to see it.
- **A silent vehicle**: if the commanded vehicle falls silent while another is heard, a banner offers to switch to it
  (**Switch to n** / **Keep waiting**). Glareshield never takes over another aircraft by itself once two have been
  heard together.

To run several SITL vehicles, give each its own system ID (`MAV_SYSID` on current ArduPilot, `SYSID_THISMAV` on
older releases) and point them all at the bridge's UDP port.

---

## Planning missions, fences and rally points

Open the map's **Mission** menu:

- **Download from vehicle**: read the vehicle's mission, fence and rally points.
- **Upload from file…** (or drop a file on the map): QGC `.plan`; `.waypoints`, `.fence` and `.rally` text files (as
  Mission Planner saves them); and ArduPilot's own `mission.dat`, `fence.dat` and `rally.dat`.
- **Save to file**: everything as `.plan`, or the mission, geofence or rally points as `.waypoints`.
- **Edit mission on map**: the planner.

In the planner, a **Mission / Fence / Rally** switch picks what you're editing:

- **Mission**: click the map to add waypoints, drag them to move them, and edit each item's command, altitude and frame
  in the list. An item's parameters can be shown in your units or raw. Waypoints show their acceptance radius (the
  item's own in yellow, the vehicle's default in white).
- **Fence**: draw inclusion and exclusion polygons and circles with **Place**, drag their vertices (each listed to edit
  or delete), and set a return point (used by ArduPlane on a breach).
- **Rally**: place rally points and set their altitudes.

Right-click (long-press on a touch screen) for more: on a waypoint, insert one before it, add one at a **bearing and
distance** from it (or from home), or delete it; on the map, place a point there. On the fence layer: switch a shape
between inclusion and exclusion, delete a shape or a vertex, or place the return point.

The draft is checked as you go: errors and warnings are listed, the route is checked against the fence, and with
terrain data on, the **Profile** strip under the map shows the mission's altitude over the ground, flagging legs too
close to it. Pointing at the profile marks the spot on the map, and pointing at the route moves the profile's cursor.

**Undo** and **Redo** cover every edit. **Upload** sends the draft and reads it back to confirm what the vehicle holds;
you can save the draft to a file at any time. If the vehicle's mission changes while you have unsaved edits, you're told
rather than having your draft replaced.

**Clear** (beside the "Vehicle's …" button) empties the mission, rally points or fence being edited, after asking
("Clear?"). It changes only the draft: **Undo** brings it back, and the vehicle keeps its own until you upload.

A takeoff happens where the vehicle is (only its altitude counts), so a waypoint changed to a takeoff loses its
position and is no longer drawn on the map.

---

## Maps and offline use

The map's **View** menu chooses the imagery (**Satellite** or **Street map**), its shape (on a full-width map in a Flow
tab; in a Cockpit pane the map fills the pane), whether ADS-B traffic is shown, **Fit vehicle and mission**, and
**Clear flight trace**. The header's crosshair button centres on the vehicle and follows it. While planning, the
planner's maximize button fills the window with the map.

While connected, a strip under the map shows the current waypoint, the distance to it, the cross-track error (how far
it is off the line to that waypoint) and the ETA, with controls to restart the mission or jump to a waypoint. Distance
and cross-track show while it follows a path (armed in Auto, Guided or RTL), "--" otherwise; small cross-track errors
show in tenths of an inch or of a centimetre, for RTK and precision work. If the mission hasn't been downloaded yet,
the strip says so and has a **Download** button; it says when the vehicle has no mission at all.

**Offline maps…** (View menu) keeps imagery for use without internet:

- **Keep while browsing**: name an area, **Start keeping**, and every tile the map loads is stored until you stop
  (the map shows a **KEEPING** chip; click it to stop and save).
- **Your tile source**: a tile server you run or are licensed to download from (a `{z}/{x}/{y}` URL template). It can be
  shown on the map, and **Download the area in view** fetches its tiles between two zoom levels. Downloads carry on with
  the panel closed.
- **Download terrain**: elevation tiles for the area in view, for terrain checks offline.
- **Import an MBTiles file**: shown as its own map layer.
- **Stored**: every kept, downloaded and imported area, with its size, to delete when no longer needed.

Stored tiles are kept in this browser and used whenever the network can't supply them.

---

## Traffic (ADS-B) and terrain

**ADS-B**: aircraft the vehicle reports (from an ADS-B receiver) are drawn on the map, coloured by threat, labelled
with callsign and relative height; click one for its details. An aircraft within the caution or alert limits raises a
banner and a spoken warning. **Settings → Traffic & terrain** shows or hides them, turns warnings on or off, and sets
the limits (range, height, and the predicted closest approach). The vehicle only forwards traffic within its
`ADSB_LIST_RADIUS`.

**Terrain**: with **Terrain data** on (Settings → Traffic & terrain), elevation tiles are fetched (AWS Terrain Tiles,
like the map imagery) and kept in this browser. They answer the vehicle's terrain requests (`TERRAIN_ENABLE`), feed the
mission's altitude profile and clearance checks, and set **Planning: warn below this height above terrain**. The map's
terrain chip shows the vehicle's height above the ground and the terrain status.

---

## Video in the HUD

The HUD can show a camera feed behind its symbology. Open the HUD's settings (the sliders icon in its header), then
**HUD & Video Settings → Video Background Feed**, turn it on, and set the **Stream URL** and **Format**:

- **WebRTC (WHEP), low latency** (usually well under a second behind): MediaMTX `http://HOST:8889/STREAM/whep`, or
  go2rtc `http://HOST:1984/api/webrtc?src=STREAM`, with an optional **Bearer token**. The server must allow this page
  (CORS; MediaMTX and go2rtc do by default) and the browser must reach its WebRTC port (MediaMTX 8189/UDP). Browsers
  play H.264, VP8, VP9 and AV1 over WebRTC, not H.265.
- **MJPEG Stream (HTTP)**, **Snapshot Polling (JPEG)**, or **HTML5 Video (MP4, HLS where the browser plays it)**.

**Aspect Ratio Fit** (cover or letterbox) and **Video Opacity** set how the feed sits behind the HUD. A stalled feed
reconnects by itself. To serve a camera over `https` from your own domain, see [Reverse Proxy Setup](reverse-proxy.md).

---

## Parameters and logs

**Parameters** (Configuration tab):

- **Refresh** reads the whole list (by MAVFTP, with defaults where the vehicle supplies them; else item by item).
- **Search**: names or words in their descriptions, with wildcards and exclusions (`BATT_*  FS_*  failsafe  -BATT2_*`;
  the help button lists the rules). **Modified Only** shows what differs from the default.
- Each parameter shows its units, range, options or bits, and whether it needs a reboot; choose a value or edit it.
- **Save .param** saves the vehicle's values to a file.
- **Compare .param** compares a file with the vehicle: what differs, what's the same, what's in the file but not on
  this vehicle, and (before the full list is read) what isn't read yet. Pick what to write; **Back up these first**
  saves the vehicle's current values of those; each write is confirmed by the value the vehicle reports back (written,
  kept another value, or no answer), and the summary names anything that needs a reboot.

**Onboard Logs** lists the vehicle's DataFlash logs and downloads them (by MAVFTP where it can, else over MAVLink),
and can erase them. ArduPilot doesn't send logs while armed.

**Telemetry logs (.tlog)**: Glareshield records the link to `.tlog` files in this browser while connected (**Settings →
Data**), keeping up to the size you choose (oldest first; logs you mark kept are spared). The **REC** chip in the navbar
shows it's recording and opens the list to download them for Mission Planner or other tools.

Other widgets: **PID Tuning** (charts per vehicle type), **MAVLink Inspector** (every message received, with its
fields), **RTK / NTRIP** (corrections to the vehicle), and **Gimbal** controls on the map when the vehicle has one.

---

## Settings, alerts and updates

**Settings** (the navbar's gear, or the connection pill) has five tabs:

| Tab | What's there |
| :--- | :--- |
| Link | WebSocket or USB serial, the bridge address, GCS system ID, telemetry rate; Connect / Disconnect |
| Display | Speed and distance units, altitude reference (AGL / MSL), theme (Dark cockpit / Daylight), content width |
| Alerts | Chimes, voice callouts (a neural voice, or the device's own), waypoint announcements |
| Traffic & terrain | ADS-B display, warnings and limits; terrain data and planning clearance |
| Data | Telemetry log recording; Restore defaults |

**Updates**: the build you're running is shown at the foot of Settings (e.g. `Glareshield 2026.11.25 · 55b37e4`).
When a newer version has been deployed, an **Update** button appears in the navbar; it reloads into the new version
when you click it, and waits (**Update after landing**) while the vehicle is armed. Nothing reloads by itself in
flight.
