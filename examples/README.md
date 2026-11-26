# Examples

Files to import into Glareshield, to use as they are or as a starting point.

| File | What it is | How to import |
| :--- | :--- | :--- |
| `ground-station.profile.json` | A whole dashboard: flying, the map and tuning | Edit Mode → **Profiles & Backup** → Import Profile |
| `zero-turn-mower.widget.json` | One custom widget: GPS, engine RPM and both drive throttles for a zero-turn mower | Edit Mode → **Add Widget** → **Upload .json Widget** |

## Ground Station (`ground-station.profile.json`)

A full ground-station dashboard in three Cockpit tabs. It starts from an arrangement Mission Planner users will know
(HUD at the top left, the map filling the right) and builds on it with what Glareshield adds: values that warn,
health bars, charts, curated parameter lists and a layout for ultrawide screens.

- **Flight**: the HUD over Vitals on the left; the map fills the right, with Track Error and Messages under it.
  Arming and the quick modes are the slim bar pinned on top.
  - **Vitals**: battery %, voltage and current; GNSS HDOP, link loss and autopilot CPU load; a throttle gauge with
    vibration and EKF variance bars. Battery (30 / 15 %), HDOP (1.4, ArduPilot's GPS_HDOP_GOOD default, / 2.0), link
    loss (5 / 15 %) and CPU load (80 / 95 %) turn amber, then red, past their limits, as do the vibration and EKF bars
    at theirs; the card's border shows the worst.
  - **Track Error** (cross-track and altitude error, charted): how well it holds its path in Auto and Guided, for
    every vehicle type. Mission progress is on the map itself.
  - A **wide layout** for ultrawide screens: HUD and Vitals, the map, then Track Error over Messages.
- **Map**: the map, full window, to fly from (fly here, guided actions, mission control) and to plan (the map's
  **Mission** menu → **Edit mission on map**).
- **Tuning**: PID tuning, wide so its charts have room, over three curated parameter lists; on the right, a map (to
  watch the vehicle during a tuning flight) over the full parameter list:
  - **Attitude Tuning**: the rate and angle controllers' gains (Copter and Rover `ATC_*`; Plane `RLL_RATE_*`,
    `PTCH_RATE_*`, `YAW_RATE_*`), without the filter and slew settings.
  - **Navigation**: Copter `WPNAV_*`, `LOIT_*` and the position controller's gains; Plane `NAVL1_*`, `WP_*`, the main
    `TECS_*` limits and the airspeeds.
  - **Failsafes & RTL**: `FS_*`, the battery failsafes, `RTL_*` and the fence's enable and action.

  The lists are patterns, so each vehicle shows only the parameters it has: one profile serves Copter, Plane and Rover.
  Edit a list's patterns with the widget's **Edit** button (`-` leaves matches out, e.g. `-*_SMAX`). Writes always ask
  first.

**Importing a profile replaces your whole dashboard**, every tab and custom widget. Export yours first (**Profiles &
Backup** → Export Active Profile) if you want to keep it, or use **Reset to Default Layout** there to go back to the
defaults.

Vitals, Track Error and the parameter lists are ordinary custom widgets: change their values and limits in Edit
Mode with the widget's **Edit** button (set the battery limits for your pack). The Flight tab needs about 1920×970 to
show as panes; smaller windows show it stacked.
