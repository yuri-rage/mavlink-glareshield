// Mission commands the planning editor offers by name, with what each param means in ArduPilot. Commands not
// listed still load, edit (as raw params) and upload unchanged.

import { cmdHasLocation } from './messages';

export interface MissionCommandInfo {
  id: number;
  name: string;
  /** Short label for list rows and markers. */
  short: string;
  group: 'Navigation' | 'Condition' | 'Do';
  /** Labels for params 1–4; an empty string hides that param. */
  params: [string, string, string, string];
  /** For commands without a location: labels for x, y, z (params 5–7); empty hides. */
  extra?: [string, string, string];
}

const none: [string, string, string, string] = ['', '', '', ''];

export const MISSION_COMMANDS: MissionCommandInfo[] = [
  { id: 16, name: 'Waypoint', short: 'WP', group: 'Navigation', params: ['Hold (s)', 'Accept radius (m)', 'Pass radius (m)', 'Yaw (°)'] },
  { id: 82, name: 'Spline waypoint', short: 'SPLINE', group: 'Navigation', params: ['Hold (s)', '', '', ''] },
  { id: 22, name: 'Takeoff', short: 'TAKEOFF', group: 'Navigation', params: ['Pitch (°, plane)', '', '', ''] },
  { id: 84, name: 'VTOL takeoff', short: 'VTOL TO', group: 'Navigation', params: none },
  { id: 17, name: 'Loiter (unlimited)', short: 'LOITER', group: 'Navigation', params: ['', '', 'Radius (m)', ''] },
  { id: 18, name: 'Loiter (turns)', short: 'LTR TURNS', group: 'Navigation', params: ['Turns', '', 'Radius (m)', 'Exit xtrack (plane)'] },
  { id: 19, name: 'Loiter (time)', short: 'LTR TIME', group: 'Navigation', params: ['Time (s)', '', 'Radius (m)', 'Exit xtrack (plane)'] },
  { id: 31, name: 'Loiter to altitude', short: 'LTR ALT', group: 'Navigation', params: ['Heading required', 'Radius (m)', '', 'Exit xtrack'] },
  { id: 21, name: 'Land', short: 'LAND', group: 'Navigation', params: ['Abort alt (m)', 'Precision land', '', 'Yaw (°)'] },
  { id: 85, name: 'VTOL land', short: 'VTOL LAND', group: 'Navigation', params: ['Options', '', '', ''] },
  { id: 20, name: 'Return to launch', short: 'RTL', group: 'Navigation', params: none },
  { id: 93, name: 'Delay', short: 'DELAY', group: 'Navigation', params: ['Delay (s)', '', '', ''], extra: ['Hour (UTC)', 'Minute', 'Second'] },
  { id: 94, name: 'Payload place', short: 'PAYLOAD', group: 'Navigation', params: ['Max descent (m)', '', '', ''] },
  { id: 189, name: 'Landing sequence start', short: 'LAND START', group: 'Do', params: none },
  { id: 112, name: 'Condition: delay', short: 'COND DELAY', group: 'Condition', params: ['Delay (s)', '', '', ''] },
  { id: 114, name: 'Condition: distance', short: 'COND DIST', group: 'Condition', params: ['Distance (m)', '', '', ''] },
  { id: 115, name: 'Condition: yaw', short: 'COND YAW', group: 'Condition', params: ['Angle (°)', 'Rate (°/s)', 'Direction (-1 ccw, 1 cw)', 'Relative (1) / absolute (0)'] },
  { id: 177, name: 'Jump', short: 'JUMP', group: 'Do', params: ['Target item', 'Repeat (-1 forever)', '', ''] },
  { id: 178, name: 'Change speed', short: 'SPEED', group: 'Do', params: ['Type (0 air, 1 ground)', 'Speed (m/s)', 'Throttle (%, -1 no change)', ''] },
  { id: 181, name: 'Set relay', short: 'RELAY', group: 'Do', params: ['Relay instance', 'On (1) / off (0)', '', ''] },
  { id: 182, name: 'Repeat relay', short: 'RPT RELAY', group: 'Do', params: ['Relay instance', 'Count', 'Period (s)', ''] },
  { id: 183, name: 'Set servo', short: 'SERVO', group: 'Do', params: ['Servo output', 'PWM', '', ''] },
  { id: 184, name: 'Repeat servo', short: 'RPT SERVO', group: 'Do', params: ['Servo output', 'PWM', 'Count', 'Period (s)'] },
  { id: 201, name: 'Region of interest', short: 'ROI', group: 'Do', params: none },
  { id: 197, name: 'ROI none', short: 'ROI NONE', group: 'Do', params: none },
  { id: 203, name: 'Camera trigger', short: 'CAMERA', group: 'Do', params: none, extra: ['Shoot (1)', '', ''] },
  { id: 206, name: 'Camera trigger distance', short: 'CAM DIST', group: 'Do', params: ['Distance (m, 0 stops)', 'Shutter (ms)', 'Trigger once now (1)', ''] },
  { id: 205, name: 'Mount control', short: 'MOUNT', group: 'Do', params: ['Pitch (°)', 'Roll (°)', 'Yaw (°)', ''] },
  { id: 208, name: 'Parachute', short: 'CHUTE', group: 'Do', params: ['0 disable, 1 enable, 2 release', '', '', ''] },
  { id: 211, name: 'Gripper', short: 'GRIPPER', group: 'Do', params: ['Gripper instance', 'Release (0) / grab (1)', '', ''] },
  { id: 223, name: 'Engine control', short: 'ENGINE', group: 'Do', params: ['Start (1) / stop (0)', 'Cold start', 'Height delay (m)', ''] },
];

const BY_ID = new Map(MISSION_COMMANDS.map((c) => [c.id, c]));

/** Known command, or a generic description that shows every param raw. */
export function missionCommandInfo(id: number): MissionCommandInfo {
  return (
    BY_ID.get(id) ?? {
      id,
      name: `Command ${id}`,
      short: `CMD ${id}`,
      group: id < 95 ? 'Navigation' : id < 159 ? 'Condition' : 'Do',
      params: ['Param 1', 'Param 2', 'Param 3', 'Param 4'],
      extra: cmdHasLocation(id) ? undefined : ['Param 5', 'Param 6', 'Param 7'],
    }
  );
}

export const ALTITUDE_FRAMES: { value: number; label: string }[] = [
  { value: 3, label: 'Relative to home' },
  { value: 0, label: 'Above sea level' },
  { value: 10, label: 'Above terrain' },
];
