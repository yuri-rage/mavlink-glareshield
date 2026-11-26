// Ready-made COMMAND_LONG payloads for custom command buttons. Picking one fills the command ID and all seven
// params; the params stay editable afterwards. The "Vehicle actions" group mirrors Mission Planner's Actions tab,
// with the params Mission Planner (or ArduPilot) uses for each.

export type Params7 = [number, number, number, number, number, number, number];

export interface CommandPreset {
  key: string;
  group: string;
  /** Option text in the picker. */
  title: string;
  /** Default button label when the widget is still on the default label. */
  label: string;
  commandId: number;
  params: Params7;
  /** What the params mean, shown under the picker. */
  hint?: string;
  /**
   * Offered on toggle switches, which send on/off in param 1 (param 2 for relay and servo) and overwrite what the
   * preset has there. Only commands where that on/off is the meaning are offered; a string is the title to show on
   * a toggle. Commands like reboot-to-mass-storage (P1 = 5) or parachute release (P1 = 2) would turn into something
   * else, so they stay button-only.
   */
  toggle?: true | string;
  /** Offered on sliders, which send the slider value in param 2 (speed, servo): the only presets where that fits. */
  slider?: true;
  /** Not a command (see WidgetAction.special): buttons only. */
  special?: 'system-time';
}

/**
 * Why a command can't be taken back, or null: terminate the flight, release the parachute, reboot or shut down the
 * autopilot, format the SD card. A widget sending one always confirms first, whatever its setting. `params` as sent;
 * null for toggles and sliders, which put their own value in the params (only the command counts then).
 */
export function irreversibleCommand(commandId: number, params: readonly number[] | null): string | null {
  const p1 = params ? Math.round(params[0] ?? 0) : null;
  switch (commandId) {
    case 185: // MAV_CMD_DO_FLIGHTTERMINATION
      return p1 === null || p1 >= 1 ? 'terminates the flight' : null;
    case 208: // MAV_CMD_DO_PARACHUTE
      return p1 === null || p1 === 2 ? 'releases the parachute' : null;
    case 246: // MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN
      return p1 === null || p1 !== 0 ? 'reboots or shuts down the autopilot' : null;
    case 526: // MAV_CMD_STORAGE_FORMAT
      return 'erases the SD card';
    default:
      return null;
  }
}

/** Whether a widget's command must confirm: its own setting, or always for an irreversible command. */
export function actionNeedsConfirmation(
  action: { commandId: number; params: readonly number[]; confirmation?: boolean; special?: string } | undefined,
  displayType: string | undefined
): boolean {
  if (!action) return false;
  if (action.confirmation) return true;
  if (action.special) return false;
  return irreversibleCommand(action.commandId, presetKindFor(displayType) === 'button' ? action.params : null) !== null;
}

export type PresetWidgetKind = 'button' | 'toggle' | 'slider';

/** The preset kind for a widget display type: toggles and sliders have their own; everything else is a button. */
export function presetKindFor(displayType: string | undefined): PresetWidgetKind {
  return displayType === 'toggle-switch' ? 'toggle' : displayType === 'slider-control' ? 'slider' : 'button';
}

/** Whether a preset is offered on a widget of this kind. Buttons send the params as written, so they get all. */
export function presetFitsWidget(preset: CommandPreset, kind: PresetWidgetKind): boolean {
  if (preset.special) return kind === 'button';
  return kind === 'button' || (kind === 'toggle' ? Boolean(preset.toggle) : Boolean(preset.slider));
}

/** The picker title for a preset on a widget of this kind. */
export function presetTitle(preset: CommandPreset, kind: PresetWidgetKind): string {
  return kind === 'toggle' && typeof preset.toggle === 'string' ? preset.toggle : preset.title;
}

const p = (...v: number[]): Params7 => [0, 0, 0, 0, 0, 0, 0].map((d, i) => v[i] ?? d) as Params7;

export const COMMAND_PRESETS: CommandPreset[] = [
  // Navigation
  { key: 'rtl', group: 'Navigation', title: 'Return to Launch', label: 'RTL', commandId: 20, params: p() },
  { key: 'land', group: 'Navigation', title: 'Land', label: 'Land', commandId: 21, params: p() },
  {
    // A default altitude, so P4–P7 open with it and the button never sends a 0 m takeoff unnoticed.
    key: 'takeoff',
    group: 'Navigation',
    title: 'Takeoff',
    label: 'Takeoff',
    commandId: 22,
    params: p(0, 0, 0, 0, 0, 0, 10),
    hint: 'P7 = altitude (m). Vehicle must be armed and in GUIDED.',
  },
  {
    key: 'loiter-unlim',
    group: 'Navigation',
    title: 'Loiter unlimited',
    label: 'Loiter',
    commandId: 17,
    params: p(),
    hint: 'P3 = radius (m, plane).',
  },
  {
    key: 'mission-start',
    group: 'Navigation',
    title: 'Mission start',
    label: 'Start Mission',
    commandId: 300,
    params: p(),
  },
  {
    key: 'set-mode',
    group: 'Navigation',
    title: 'Set mode (DO_SET_MODE)',
    label: 'Set Mode',
    commandId: 176,
    params: p(1),
    hint: 'P1 = 1 (custom mode), P2 = mode number.',
  },
  {
    key: 'change-speed',
    group: 'Navigation',
    title: 'Change speed',
    label: 'Set Speed',
    commandId: 178,
    params: p(1, 0, -1),
    slider: true,
    hint: 'P1 = speed type (0 air, 1 ground), P2 = speed (m/s), P3 = throttle (% or -1).',
  },

  // Outputs
  {
    key: 'relay',
    group: 'Outputs',
    title: 'Set relay',
    label: 'Relay',
    commandId: 181,
    params: p(0, 1),
    toggle: true,
    hint: 'P1 = relay instance (0 = RELAY1), P2 = 1 on / 0 off.',
  },
  {
    key: 'servo',
    group: 'Outputs',
    title: 'Set servo',
    label: 'Servo',
    commandId: 183,
    params: p(9, 1900, 1100),
    toggle: true,
    slider: true,
    hint: 'P1 = servo output #, P2 = PWM (toggles: on PWM), P3 = off PWM for toggles.',
  },
  {
    key: 'camera',
    group: 'Outputs',
    title: 'Trigger camera',
    label: 'Trigger Camera',
    commandId: 203,
    params: p(0, 0, 0, 0, 1),
    hint: 'DO_DIGICAM_CONTROL: P5 = 1 takes a picture.',
  },

  // Vehicle actions (Mission Planner)
  {
    key: 'arm',
    group: 'Vehicle actions',
    title: 'Arm / disarm',
    label: 'Arm',
    commandId: 400,
    params: p(1),
    toggle: true,
    hint: 'P1 = 1 arm / 0 disarm, P2 = 21196 to force.',
  },
  {
    key: 'cal-gyro',
    group: 'Vehicle actions',
    title: 'Preflight calibration: gyro',
    label: 'Calibrate Gyro',
    commandId: 241,
    params: p(1),
    hint: 'Disarmed and still. P1 = gyro.',
  },
  {
    key: 'cal-baro',
    group: 'Vehicle actions',
    title: 'Preflight calibration: baro / airspeed',
    label: 'Calibrate Baro',
    commandId: 241,
    params: p(0, 0, 1),
    hint: 'Disarmed. P3 = baro (and airspeed on plane).',
  },
  {
    key: 'battery-reset',
    group: 'Vehicle actions',
    title: 'Battery reset',
    label: 'Reset Battery',
    commandId: 42651,
    params: p(255, 100),
    hint: 'P1 = battery bitmask (255 = all), P2 = remaining %.',
  },
  {
    key: 'engine-start',
    group: 'Vehicle actions',
    title: 'Engine start',
    label: 'Start Engine',
    commandId: 223,
    params: p(1),
    toggle: 'Engine start / stop',
    hint: 'ICE engines. P1 = 1 start.',
  },
  {
    key: 'engine-stop',
    group: 'Vehicle actions',
    title: 'Engine stop',
    label: 'Stop Engine',
    commandId: 223,
    params: p(0),
  },
  {
    key: 'parachute',
    group: 'Vehicle actions',
    title: 'Parachute release',
    label: 'Release Parachute',
    commandId: 208,
    params: p(2),
    hint: 'P1 = 0 disable, 1 enable, 2 release.',
  },
  {
    key: 'terminate',
    group: 'Vehicle actions',
    title: 'Terminate flight',
    label: 'Terminate',
    commandId: 185,
    params: p(1),
    hint: 'Irreversible in flight: the vehicle stops flying (AFS/termination behavior).',
  },
  {
    key: 'scripting-restart',
    group: 'Vehicle actions',
    title: 'Scripting: stop and restart',
    label: 'Restart Scripts',
    commandId: 42701,
    params: p(3),
  },
  {
    key: 'scripting-stop',
    group: 'Vehicle actions',
    title: 'Scripting: stop',
    label: 'Stop Scripts',
    commandId: 42701,
    params: p(2),
  },
  {
    key: 'high-latency-on',
    group: 'Vehicle actions',
    title: 'High latency: enable',
    label: 'High Latency On',
    commandId: 2600,
    params: p(1),
    toggle: 'High latency on / off',
  },
  {
    key: 'high-latency-off',
    group: 'Vehicle actions',
    title: 'High latency: disable',
    label: 'High Latency Off',
    commandId: 2600,
    params: p(0),
  },

  // System
  {
    key: 'reboot',
    group: 'System',
    title: 'Reboot autopilot',
    label: 'Reboot',
    commandId: 246,
    params: p(1),
    hint: 'Disarmed only.',
  },
  {
    key: 'reboot-mass-storage',
    group: 'System',
    title: 'Reboot to mass storage',
    label: 'Mass Storage',
    commandId: 246,
    params: p(5),
    hint: 'Disarmed only. The SD card appears as a USB drive.',
  },
  {
    key: 'format-sd',
    group: 'System',
    title: 'Format SD card',
    label: 'Format SD',
    commandId: 526,
    params: p(1, 1),
    hint: 'Erases the SD card, logs included. P1 and P2 must both be 1.',
  },
  {
    // Mission Planner's safety switch: DO_SET_MODE with only MAV_MODE_FLAG_DECODE_POSITION_SAFETY (128) as the base
    // mode, which every ArduPilot version takes (GCS_MAVLINK::_set_mode_common). P2 0 = safety off (outputs live),
    // 1 = safety on. Not P1 = 1: that is the custom-mode flag, and P2 0 would then mean mode 0 (Stabilize on Copter).
    key: 'safety-off',
    group: 'Vehicle actions',
    title: 'Safety switch: off (outputs live)',
    label: 'Safety off',
    commandId: 176,
    params: p(128, 0),
    hint: 'Like pressing the safety button: outputs to the motors and servos go live. P1 = 128 (safety flag), P2 = 0.',
  },
  {
    key: 'safety-on',
    group: 'Vehicle actions',
    title: 'Safety switch: on (outputs off)',
    label: 'Safety on',
    commandId: 176,
    params: p(128, 1),
    hint: 'Stops outputs to the motors and servos. ArduPilot refuses it while armed. P1 = 128 (safety flag), P2 = 1.',
  },
  {
    key: 'adsb-ident',
    group: 'Vehicle actions',
    title: 'ADS-B transponder IDENT',
    label: 'IDENT',
    commandId: 10001,
    params: p(),
    hint: 'Only when air traffic control asks for an IDENT. Needs an ADS-B-out transponder (ArduPilot 4.5+).',
  },
  {
    key: 'system-time',
    group: 'System',
    title: 'Set vehicle clock (SYSTEM_TIME)',
    label: 'Set clock',
    commandId: 0,
    params: p(),
    special: 'system-time',
    hint: "Sends this device's clock. Not acknowledged; ArduPilot uses it only without GPS time (RTC_TYPES).",
  },
];

export const COMMAND_PRESET_GROUPS = [...new Set(COMMAND_PRESETS.map((c) => c.group))];

/**
 * The preset a saved command matches: exact command and params first, else the first preset for that command ID
 * (e.g. a relay button for relay 3 is still "Set relay"), among the presets offered on `kind`. Undefined for
 * commands without one.
 */
export function findCommandPreset(
  commandId: number,
  params: readonly number[],
  kind: PresetWidgetKind = 'button',
  special?: 'system-time'
): CommandPreset | undefined {
  // A special action matches only its own preset; a command never matches one.
  if (special) return COMMAND_PRESETS.find((c) => c.special === special && presetFitsWidget(c, kind));
  const same = COMMAND_PRESETS.filter((c) => !c.special && c.commandId === commandId && presetFitsWidget(c, kind));
  return same.find((c) => c.params.every((v, i) => (params[i] ?? 0) === v)) ?? same[0];
}
