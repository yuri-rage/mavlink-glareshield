# Examples

Files to import into Glareshield, to use as they are or as a starting point.

| File | What it is | How to import |
| :--- | :--- | :--- |
| `mission-planner.profile.json` | A whole dashboard laid out like Mission Planner | Edit Mode → **Profiles & Backup** → Import Profile |
| `zero-turn-mower.widget.json` | One custom widget: GPS, engine RPM and both drive throttles for a zero-turn mower | Edit Mode → **Add Widget** → **Upload .json Widget** |

## Mission Planner style (`mission-planner.profile.json`)

Three Cockpit tabs, named and arranged like Mission Planner's screens:

- **Flight Data**: Mission Planner's arrangement, HUD at the top left and the map filling the right, with Glareshield's
  strengths in place of Mission Planner's Quick numbers:
  - **Vitals** under the HUD: battery %, GNSS HDOP and a throttle gauge, with vibration and EKF variance bars
    beneath. Battery (30 / 15 %) and HDOP (1.4, ArduPilot's GPS_HDOP_GOOD default, / 2.0) turn amber, then red, past
    their limits, as do the vibration and EKF bars at theirs; the card's border shows the worst.
  - **Altitude** (a trend chart, the HUD's tape shows only now) and **Messages** under the map. Mission progress is on
    the map itself.
  - Arming and the quick modes as the slim bar pinned on top (Mission Planner's Actions tab).
  - A **wide layout** for ultrawide screens: HUD and Vitals, the map, then a column with the altitude chart, the
    Battery card and Messages.
- **Flight Plan**: the map, full window, for planning (the map's **Mission** menu → **Edit mission on map**).
- **Config/Tuning**: PID tuning across the full width, so its charts have room (the height it needs, about half on a
  tall screen), over three curated parameter lists and the full parameter list for anything else:
  - **Attitude Tuning**: the rate and angle controllers' gains (Copter and Rover `ATC_*`; Plane `RLL_RATE_*`,
    `PTCH_RATE_*`, `YAW_RATE_*`), without the filter and slew settings.
  - **Navigation**: Copter `WPNAV_*`, `LOIT_*` and the position controller's gains; Plane `NAVL1_*`, `WP_*`, the main
    `TECS_*` limits and the airspeeds.
  - **Failsafes & RTL**: `FS_*`, the battery failsafes, `RTL_*` and the fence's enable and action.

  The lists are patterns, so each vehicle shows only the parameters it has: one profile serves Copter, Plane and Rover.
  Edit a list's patterns with the widget's **Edit** button (`-` leaves matches out, e.g. `-*_SMAX`).

**Importing a profile replaces your whole dashboard**, every tab and custom widget. Export yours first (**Profiles &
Backup** → Export Active Profile) if you want to keep it, or use **Reset to Default Layout** there to go back to the
defaults.

Vitals and Altitude are ordinary custom widgets: change their values and limits in Edit Mode with the widget's **Edit**
button (set the battery limits for your pack). The Flight Data tab needs about 1920×970 to show as panes; smaller
windows show it stacked.
