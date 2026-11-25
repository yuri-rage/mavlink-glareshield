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
  - **Vitals** under the HUD: a throttle gauge, vibration and EKF variance bars, battery % and GNSS HDOP. Battery
    (30 / 15 %) and HDOP (1.4, ArduPilot's GPS_HDOP_GOOD default, / 2.0) turn amber, then red, past their limits, as do
    the vibration and EKF bars at theirs; the card's border shows the worst.
  - **Waypoint Control** and **Messages** under the map: mission progress and the vehicle's messages.
  - Arming and the quick modes as the slim bar pinned on top (Mission Planner's Actions tab).
  - A **wide layout** for ultrawide screens: HUD and Vitals, the map, then a column with an altitude chart, Waypoint
    Control, the Battery card and Messages.
- **Flight Plan**: the map, full window, for planning (the map's **Mission** menu → **Edit mission on map**).
- **Config/Tuning**: parameters, with PID tuning and the message console beside them.

**Importing a profile replaces your whole dashboard**, every tab and custom widget. Export yours first (**Profiles &
Backup** → Export Active Profile) if you want to keep it, or use **Reset to Default Layout** there to go back to the
defaults.

Vitals and Altitude are ordinary custom widgets: change their values and limits in Edit Mode with the widget's **Edit**
button (set the battery limits for your pack). The Flight Data tab needs about 1920×970 to show as panes; smaller
windows show it stacked.
