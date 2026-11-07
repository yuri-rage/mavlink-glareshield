// MAVLink Message IDs
export const MAVLINK_MSG_ID = {
  HEARTBEAT: 0,
  SYS_STATUS: 1,
  SYSTEM_TIME: 2,
  PARAM_REQUEST_READ: 20,
  PARAM_REQUEST_LIST: 21,
  PARAM_VALUE: 22,
  PARAM_SET: 23,
  GPS_RAW_INT: 24,
  GPS2_RAW: 124,
  SCALED_IMU: 26,
  RAW_IMU: 27,
  SCALED_PRESSURE: 29,
  ATTITUDE: 30,
  ATTITUDE_QUATERNION: 31,
  GLOBAL_POSITION_INT: 33,
  RC_CHANNELS_RAW: 35,
  SERVO_OUTPUT_RAW: 36,
  MISSION_ITEM: 39,
  MISSION_REQUEST: 40,
  MISSION_SET_CURRENT: 41,
  MISSION_CURRENT: 42,
  MISSION_REQUEST_LIST: 43,
  MISSION_COUNT: 44,
  MISSION_ITEM_REACHED: 46,
  MISSION_ACK: 47,
  MISSION_REQUEST_INT: 51,
  MISSION_ITEM_INT: 73,
  COMMAND_INT: 75,
  COMMAND_LONG: 76,
  COMMAND_ACK: 77,
  NAV_CONTROLLER_OUTPUT: 62,
  RC_CHANNELS: 65,
  VFR_HUD: 74,
  RADIO_STATUS: 109,
  FILE_TRANSFER_PROTOCOL: 110,
  HIGHRES_IMU: 105,
  POWER_STATUS: 125,
  DISTANCE_SENSOR: 132,
  BATTERY_STATUS: 147,
  AUTOPILOT_VERSION: 148,
  WIND: 168,
  RANGEFINDER: 173,
  EKF_STATUS_REPORT: 193,
  PID_TUNING: 194,
  RPM: 226,
  GPS_RTCM_DATA: 233,
  VIBRATION: 241,
  RELAY_STATUS: 376,
  HOME_POSITION: 242,
  STATUSTEXT: 253,
  ESC_TELEMETRY_1_TO_4: 11030,
} as const;

// CRC Extra seed byte per message ID for ArduPilot / Common dialect
export const MAVLINK_MESSAGE_CRC_EXTRA: Record<number, number> = {
  [MAVLINK_MSG_ID.HEARTBEAT]: 50,
  [MAVLINK_MSG_ID.SYS_STATUS]: 124,
  [MAVLINK_MSG_ID.SYSTEM_TIME]: 137,
  [MAVLINK_MSG_ID.PARAM_REQUEST_READ]: 214,
  [MAVLINK_MSG_ID.PARAM_REQUEST_LIST]: 159,
  [MAVLINK_MSG_ID.PARAM_VALUE]: 220,
  [MAVLINK_MSG_ID.PARAM_SET]: 168,
  [MAVLINK_MSG_ID.GPS_RAW_INT]: 24,
  [MAVLINK_MSG_ID.GPS2_RAW]: 87,
  [MAVLINK_MSG_ID.SCALED_IMU]: 170,
  [MAVLINK_MSG_ID.RAW_IMU]: 144,
  [MAVLINK_MSG_ID.SCALED_PRESSURE]: 115,
  [MAVLINK_MSG_ID.ATTITUDE]: 39,
  [MAVLINK_MSG_ID.ATTITUDE_QUATERNION]: 246,
  [MAVLINK_MSG_ID.GLOBAL_POSITION_INT]: 104,
  [MAVLINK_MSG_ID.RC_CHANNELS_RAW]: 244,
  [MAVLINK_MSG_ID.SERVO_OUTPUT_RAW]: 222,
  [MAVLINK_MSG_ID.MISSION_ITEM]: 254,
  [MAVLINK_MSG_ID.MISSION_REQUEST]: 230,
  [MAVLINK_MSG_ID.MISSION_SET_CURRENT]: 28,
  [MAVLINK_MSG_ID.MISSION_CURRENT]: 28,
  [MAVLINK_MSG_ID.MISSION_REQUEST_LIST]: 132,
  [MAVLINK_MSG_ID.MISSION_COUNT]: 221,
  [MAVLINK_MSG_ID.MISSION_ITEM_REACHED]: 11,
  [MAVLINK_MSG_ID.MISSION_ACK]: 153,
  [MAVLINK_MSG_ID.MISSION_REQUEST_INT]: 196,
  [MAVLINK_MSG_ID.MISSION_ITEM_INT]: 38,
  [MAVLINK_MSG_ID.COMMAND_INT]: 158,
  [MAVLINK_MSG_ID.COMMAND_LONG]: 152,
  [MAVLINK_MSG_ID.COMMAND_ACK]: 143,
  [MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT]: 183,
  [MAVLINK_MSG_ID.RC_CHANNELS]: 118,
  [MAVLINK_MSG_ID.VFR_HUD]: 20,
  [MAVLINK_MSG_ID.RADIO_STATUS]: 185,
  [MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL]: 84,
  [MAVLINK_MSG_ID.HIGHRES_IMU]: 93,
  [MAVLINK_MSG_ID.POWER_STATUS]: 203,
  [MAVLINK_MSG_ID.DISTANCE_SENSOR]: 85,
  [MAVLINK_MSG_ID.BATTERY_STATUS]: 154,
  [MAVLINK_MSG_ID.AUTOPILOT_VERSION]: 178,
  [MAVLINK_MSG_ID.WIND]: 1,
  [MAVLINK_MSG_ID.RANGEFINDER]: 83,
  [MAVLINK_MSG_ID.EKF_STATUS_REPORT]: 71,
  [MAVLINK_MSG_ID.PID_TUNING]: 98,
  [MAVLINK_MSG_ID.RPM]: 207,
  [MAVLINK_MSG_ID.GPS_RTCM_DATA]: 35,
  [MAVLINK_MSG_ID.VIBRATION]: 90,
  [MAVLINK_MSG_ID.RELAY_STATUS]: 199,
  [MAVLINK_MSG_ID.HOME_POSITION]: 104,
  [MAVLINK_MSG_ID.STATUSTEXT]: 83,
  [MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4]: 144,
};

// Common MAV_CMD IDs
export const MAV_CMD = {
  NAV_WAYPOINT: 16,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_LAND: 21,
  NAV_TAKEOFF: 22,
  DO_SET_MODE: 176,
  DO_JUMP: 177,
  DO_CHANGE_SPEED: 178,
  DO_REPOSITION: 192,
  DO_SET_MISSION_CURRENT: 224,
  DO_SET_SERVO: 183,
  DO_SET_RELAY: 181,
  COMPONENT_ARM_DISARM: 400,
  RUN_PREARM_CHECKS: 401,
  GET_HOME_POSITION: 410,
  SET_MESSAGE_INTERVAL: 511,
  REQUEST_MESSAGE: 512,
  REQUEST_AUTOPILOT_CAPABILITIES: 520,
  DO_SEND_BANNER: 42428,
} as const;

// ArduPilot Autopilot Types (MAV_AUTOPILOT)
export const MAV_AUTOPILOT = {
  GENERIC: 0,
  RESERVED: 1,
  SLUGS: 2,
  ARDUPILOTMEGA: 3,
  OPENPILOT: 4,
  GENERIC_WAYPOINTS_ONLY: 5,
  GENERIC_WAYPOINTS_AND_SIMPLE_NAVIGATION_ONLY: 6,
  GENERIC_MISSION_FULL: 7,
  INVALID: 8,
  PPZ: 9,
  UDB: 10,
  FP: 11,
  PX4: 12,
} as const;

// Helper to determine if a heartbeat is from a true vehicle autopilot (and not a gimbal, companion computer, or GCS)
export function isVehicleAutopilotHeartbeat(type: number, autopilot: number, compId: number): boolean {
  // Reject GCS (type 6) and antenna trackers (type 5)
  if (type === MAV_TYPE.GCS || type === MAV_TYPE.ANTENNA_TRACKER) return false;
  // Reject MAV_AUTOPILOT_INVALID (8)
  if (autopilot === MAV_AUTOPILOT.INVALID) return false;
  // Component 154 = gimbal, 190 = GCS, 191 = companion computer, 156 = ADSB
  if (compId === 154 || compId === 190 || compId === 191 || compId === 156) return false;
  // Primary autopilot component is compId 1 (MAV_COMP_ID_AUTOPILOT1)
  return compId === 1 || (compId < 10 && autopilot !== 0);
}

// ArduPilot Vehicle Types (MAV_TYPE)
export const MAV_TYPE = {
  GENERIC: 0,
  FIXED_WING: 1,
  QUADROTOR: 2,
  COAXIAL: 3,
  HELICOPTER: 4,
  ANTENNA_TRACKER: 5,
  GCS: 6,
  AIRSHIP: 7,
  FREE_BALLOON: 8,
  ROCKET: 9,
  GROUND_ROVER: 10,
  SURFACE_BOAT: 11,
  SUBMARINE: 12,
  HEXAROTOR: 13,
  OCTOROTOR: 14,
  TRICOPTER: 15,
  FLAPPING_WING: 16,
  KITE: 17,
  VTOL_DUOROTOR: 19,
  VTOL_QUADROTOR: 20,
  VTOL_TILTROTOR: 21,
  VTOL_RESERVED2: 22,
  VTOL_RESERVED3: 23,
  VTOL_RESERVED4: 24,
  VTOL_RESERVED5: 25,
  PARAFOIL: 28,
  DODECAROTOR: 29,
  DECAROTOR: 35,
} as const;

export type VehicleCategory = 'copter' | 'plane' | 'rover' | 'sub' | 'tracker' | 'generic';

export function getVehicleCategory(type: number): VehicleCategory {
  switch (type) {
    case MAV_TYPE.FIXED_WING:
    case MAV_TYPE.FLAPPING_WING:
    case MAV_TYPE.KITE:
    case MAV_TYPE.VTOL_DUOROTOR:
    case MAV_TYPE.VTOL_QUADROTOR:
    case MAV_TYPE.VTOL_TILTROTOR:
    case MAV_TYPE.VTOL_RESERVED2:
    case MAV_TYPE.VTOL_RESERVED3:
    case MAV_TYPE.VTOL_RESERVED4:
    case MAV_TYPE.VTOL_RESERVED5:
    case MAV_TYPE.PARAFOIL:
      return 'plane';

    case MAV_TYPE.GROUND_ROVER:
    case MAV_TYPE.SURFACE_BOAT:
      return 'rover';

    case MAV_TYPE.SUBMARINE:
      return 'sub';

    case MAV_TYPE.ANTENNA_TRACKER:
      return 'tracker';

    case MAV_TYPE.QUADROTOR:
    case MAV_TYPE.COAXIAL:
    case MAV_TYPE.HELICOPTER:
    case MAV_TYPE.HEXAROTOR:
    case MAV_TYPE.OCTOROTOR:
    case MAV_TYPE.TRICOPTER:
    case MAV_TYPE.DODECAROTOR:
    case MAV_TYPE.DECAROTOR:
    case MAV_TYPE.AIRSHIP:
      return 'copter';

    default:
      return 'generic';
  }
}

export function getVehicleCategoryLabel(type: number): string {
  switch (type) {
    case MAV_TYPE.FIXED_WING:
      return 'Plane';
    case MAV_TYPE.QUADROTOR:
      return 'Copter (Quad)';
    case MAV_TYPE.COAXIAL:
      return 'Copter (Coax)';
    case MAV_TYPE.HELICOPTER:
      return 'Helicopter';
    case MAV_TYPE.HEXAROTOR:
      return 'Copter (Hexa)';
    case MAV_TYPE.OCTOROTOR:
      return 'Copter (Octo)';
    case MAV_TYPE.TRICOPTER:
      return 'Tricopter';
    case MAV_TYPE.GROUND_ROVER:
      return 'Rover';
    case MAV_TYPE.SURFACE_BOAT:
      return 'Boat';
    case MAV_TYPE.SUBMARINE:
      return 'Submarine';
    case MAV_TYPE.ANTENNA_TRACKER:
      return 'Tracker';
    case MAV_TYPE.VTOL_DUOROTOR:
    case MAV_TYPE.VTOL_QUADROTOR:
    case MAV_TYPE.VTOL_TILTROTOR:
    case MAV_TYPE.VTOL_RESERVED2:
    case MAV_TYPE.VTOL_RESERVED3:
    case MAV_TYPE.VTOL_RESERVED4:
    case MAV_TYPE.VTOL_RESERVED5:
      return 'VTOL Plane';
    default:
      const cat = getVehicleCategory(type);
      return cat === 'generic' ? 'Vehicle' : cat.charAt(0).toUpperCase() + cat.slice(1);
  }
}

// ArduPilot Flight Modes mapping
export const COPTER_MODES: Record<number, string> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  9: 'LAND',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
  17: 'BRAKE',
  18: 'THROW',
  19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS',
  21: 'SMART_RTL',
  22: 'FLOWHOLD',
  23: 'FOLLOW',
  24: 'ZIGZAG',
  25: 'SYSTEMID',
  26: 'AUTOROTATE',
  27: 'AUTO_RTL',
};

export const PLANE_MODES: Record<number, string> = {
  0: 'MANUAL',
  1: 'CIRCLE',
  2: 'STABILIZE',
  3: 'TRAINING',
  4: 'ACRO',
  5: 'FLY_BY_WIRE_A',
  6: 'FLY_BY_WIRE_B',
  7: 'CRUISE',
  8: 'AUTOTUNE',
  10: 'AUTO',
  11: 'RTL',
  12: 'LOITER',
  13: 'TAKEOFF',
  14: 'AVOID_ADSB',
  15: 'GUIDED',
  16: 'INITIALISING',
  17: 'QSTABILIZE',
  18: 'QHOVER',
  19: 'QLOITER',
  20: 'QLAND',
  21: 'QRTL',
  22: 'QAUTOTUNE',
  23: 'QACRO',
  24: 'THERMAL',
};

export const ROVER_MODES: Record<number, string> = {
  0: 'MANUAL',
  1: 'ACRO',
  3: 'STEERING',
  4: 'HOLD',
  5: 'LOITER',
  6: 'FOLLOW',
  7: 'SIMPLE',
  8: 'DOCK',
  9: 'CIRCLE',
  10: 'AUTO',
  11: 'RTL',
  12: 'SMART_RTL',
  14: 'GUIDED_NO_GPS',
  15: 'GUIDED',
  16: 'INITIALISING',
};

export const SUB_MODES: Record<number, string> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  7: 'CIRCLE',
  9: 'SURFACE',
  16: 'POSHOLD',
  19: 'MANUAL',
  20: 'MOTOR_DETECT',
  21: 'SURFTRAK',
};

export const TRACKER_MODES: Record<number, string> = {
  0: 'MANUAL',
  1: 'STOP',
  2: 'SCAN',
  3: 'SERVO_TEST',
  10: 'AUTO',
  16: 'INITIALISING',
};

export function getVehicleModeName(type: number, customMode: number): string {
  const category = getVehicleCategory(type);
  switch (category) {
    case 'rover':
      return ROVER_MODES[customMode] ?? `ROVER_${customMode}`;
    case 'plane':
      return PLANE_MODES[customMode] ?? `PLANE_${customMode}`;
    case 'sub':
      return SUB_MODES[customMode] ?? `SUB_${customMode}`;
    case 'tracker':
      return TRACKER_MODES[customMode] ?? `TRACKER_${customMode}`;
    case 'copter':
      return COPTER_MODES[customMode] ?? `COPTER_${customMode}`;
    default:
      return COPTER_MODES[customMode] ?? `MODE_${customMode}`;
  }
}

export function getVehicleFlightModes(type: number): { label: string; mode: number }[] {
  const category = getVehicleCategory(type);
  switch (category) {
    case 'rover':
      return [
        { label: 'HOLD', mode: 4 },
        { label: 'MANUAL', mode: 0 },
        { label: 'ACRO', mode: 1 },
        { label: 'AUTO', mode: 10 },
        { label: 'STEERING', mode: 3 },
        { label: 'LOITER', mode: 5 },
        { label: 'RTL', mode: 11 },
        { label: 'GUIDED', mode: 15 },
      ];
    case 'plane':
      return [
        { label: 'MANUAL', mode: 0 },
        { label: 'FBWA', mode: 5 },
        { label: 'CRUISE', mode: 7 },
        { label: 'LOITER', mode: 12 },
        { label: 'AUTO', mode: 10 },
        { label: 'RTL', mode: 11 },
        { label: 'GUIDED', mode: 15 },
        { label: 'TAKEOFF', mode: 13 },
      ];
    case 'sub':
      return [
        { label: 'MANUAL', mode: 19 },
        { label: 'STABILIZE', mode: 0 },
        { label: 'ALT HOLD', mode: 2 },
        { label: 'POSHOLD', mode: 16 },
        { label: 'AUTO', mode: 3 },
        { label: 'SURFACE', mode: 9 },
      ];
    case 'tracker':
      return [
        { label: 'MANUAL', mode: 0 },
        { label: 'STOP', mode: 1 },
        { label: 'SCAN', mode: 2 },
        { label: 'AUTO', mode: 10 },
      ];
    case 'copter':
    default:
      return [
        { label: 'LOITER', mode: 5 },
        { label: 'ALT HOLD', mode: 2 },
        { label: 'POSHOLD', mode: 16 },
        { label: 'GUIDED', mode: 4 },
        { label: 'AUTO', mode: 3 },
        { label: 'RTL', mode: 6 },
        { label: 'LAND', mode: 9 },
        { label: 'STABILIZE', mode: 0 },
      ];
  }
}

export function getAllVehicleFlightModes(type: number): { label: string; mode: number }[] {
  const category = getVehicleCategory(type);
  switch (category) {
    case 'rover': {
      const isBoat = type === MAV_TYPE.SURFACE_BOAT;
      if (isBoat) {
        return [
          { label: 'HOLD', mode: 4 },
          { label: 'MANUAL', mode: 0 },
          { label: 'LOITER', mode: 5 },
          { label: 'STEERING', mode: 3 },
          { label: 'ACRO', mode: 1 },
          { label: 'AUTO', mode: 10 },
          { label: 'RTL', mode: 11 },
          { label: 'SMART RTL', mode: 12 },
          { label: 'GUIDED', mode: 15 },
          { label: 'GUIDED NO GPS', mode: 14 },
          { label: 'FOLLOW', mode: 6 },
          { label: 'SIMPLE', mode: 7 },
          { label: 'DOCK', mode: 8 },
          { label: 'CIRCLE', mode: 9 },
        ];
      }
      return [
        { label: 'HOLD', mode: 4 },
        { label: 'MANUAL', mode: 0 },
        { label: 'STEERING', mode: 3 },
        { label: 'ACRO', mode: 1 },
        { label: 'AUTO', mode: 10 },
        { label: 'LOITER', mode: 5 },
        { label: 'RTL', mode: 11 },
        { label: 'SMART RTL', mode: 12 },
        { label: 'GUIDED', mode: 15 },
        { label: 'GUIDED NO GPS', mode: 14 },
        { label: 'FOLLOW', mode: 6 },
        { label: 'SIMPLE', mode: 7 },
        { label: 'DOCK', mode: 8 },
        { label: 'CIRCLE', mode: 9 },
      ];
    }
    case 'plane':
      return [
        { label: 'MANUAL', mode: 0 },
        { label: 'FBWA', mode: 5 },
        { label: 'FBWB', mode: 6 },
        { label: 'CRUISE', mode: 7 },
        { label: 'LOITER', mode: 12 },
        { label: 'AUTO', mode: 10 },
        { label: 'RTL', mode: 11 },
        { label: 'GUIDED', mode: 15 },
        { label: 'TAKEOFF', mode: 13 },
        { label: 'STABILIZE', mode: 2 },
        { label: 'TRAINING', mode: 3 },
        { label: 'ACRO', mode: 4 },
        { label: 'AUTOTUNE', mode: 8 },
        { label: 'CIRCLE', mode: 1 },
        { label: 'THERMAL', mode: 24 },
        { label: 'AVOID ADSB', mode: 14 },
        { label: 'QSTABILIZE', mode: 17 },
        { label: 'QHOVER', mode: 18 },
        { label: 'QLOITER', mode: 19 },
        { label: 'QLAND', mode: 20 },
        { label: 'QRTL', mode: 21 },
        { label: 'QAUTOTUNE', mode: 22 },
        { label: 'QACRO', mode: 23 },
      ];
    case 'sub':
      return [
        { label: 'MANUAL', mode: 19 },
        { label: 'STABILIZE', mode: 0 },
        { label: 'ALT HOLD', mode: 2 },
        { label: 'POSHOLD', mode: 16 },
        { label: 'AUTO', mode: 3 },
        { label: 'GUIDED', mode: 4 },
        { label: 'SURFACE', mode: 9 },
        { label: 'SURFTRAK', mode: 21 },
        { label: 'CIRCLE', mode: 7 },
        { label: 'ACRO', mode: 1 },
      ];
    case 'tracker':
      return [
        { label: 'MANUAL', mode: 0 },
        { label: 'STOP', mode: 1 },
        { label: 'SCAN', mode: 2 },
        { label: 'SERVO TEST', mode: 3 },
        { label: 'AUTO', mode: 10 },
      ];
    case 'copter':
    default:
      return [
        { label: 'STABILIZE', mode: 0 },
        { label: 'ALT HOLD', mode: 2 },
        { label: 'LOITER', mode: 5 },
        { label: 'POSHOLD', mode: 16 },
        { label: 'AUTO', mode: 3 },
        { label: 'GUIDED', mode: 4 },
        { label: 'RTL', mode: 6 },
        { label: 'SMART RTL', mode: 21 },
        { label: 'LAND', mode: 9 },
        { label: 'BRAKE', mode: 17 },
        { label: 'ACRO', mode: 1 },
        { label: 'SPORT', mode: 13 },
        { label: 'DRIFT', mode: 11 },
        { label: 'CIRCLE', mode: 7 },
        { label: 'FOLLOW', mode: 23 },
        { label: 'AUTOTUNE', mode: 15 },
        { label: 'FLIP', mode: 14 },
        { label: 'THROW', mode: 18 },
        { label: 'AUTOROTATE', mode: 26 },
        { label: 'FLOWHOLD', mode: 22 },
        { label: 'ZIGZAG', mode: 24 },
        { label: 'GUIDED NOGPS', mode: 20 },
        { label: 'AVOID ADSB', mode: 19 },
        { label: 'AUTO RTL', mode: 27 },
      ];
  }
}

export function getGuidedModeNum(type: number): number {
  const category = getVehicleCategory(type);
  if (category === 'plane' || category === 'rover') {
    return 15;
  }
  return 4;
}

export function getAutoModeNum(type: number): number {
  const category = getVehicleCategory(type);
  if (category === 'plane' || category === 'rover' || category === 'tracker') {
    return 10;
  }
  return 3;
}

export function getMavCmdName(commandId: number): string {
  for (const [name, val] of Object.entries(MAV_CMD)) {
    if (val === commandId) {
      return name;
    }
  }
  return `CMD_${commandId}`;
}

/**
 * Determines whether a MAVLink mission command has geographic location (lat/lon in param 5 & 6).
 * Matches ArduPilot AP_Mission::cmd_has_location() / stored_in_location().
 * Non-location commands (e.g. DO_DIGICAM_CONTROL, DO_SET_SERVO, NAV_DELAY, etc.)
 * pass param 5 & 6 as raw integers/floats and MUST NOT be scaled by 1e7.
 */
export function cmdHasLocation(command: number): boolean {
  switch (command) {
    case 16: // MAV_CMD_NAV_WAYPOINT
    case 17: // MAV_CMD_NAV_LOITER_UNLIM
    case 18: // MAV_CMD_NAV_LOITER_TURNS
    case 19: // MAV_CMD_NAV_LOITER_TIME
    case 21: // MAV_CMD_NAV_LAND
    case 22: // MAV_CMD_NAV_TAKEOFF
    case 30: // MAV_CMD_NAV_CONTINUE_AND_CHANGE_ALT
    case 31: // MAV_CMD_NAV_LOITER_TO_ALT
    case 82: // MAV_CMD_NAV_SPLINE_WAYPOINT
    case 84: // MAV_CMD_NAV_VTOL_TAKEOFF
    case 85: // MAV_CMD_NAV_VTOL_LAND
    case 92: // MAV_CMD_NAV_GUIDED_ENABLE
    case 94: // MAV_CMD_NAV_PAYLOAD_PLACE
    case 95: // MAV_CMD_NAV_ARC_WAYPOINT
    case 179: // MAV_CMD_DO_SET_HOME
    case 180: // MAV_CMD_DO_RETURN_PATH_START
    case 189: // MAV_CMD_DO_LAND_START
    case 191: // MAV_CMD_DO_GO_AROUND
    case 195: // MAV_CMD_DO_SET_ROI_LOCATION
    case 201: // MAV_CMD_DO_SET_ROI
    case 5000: // MAV_CMD_NAV_FENCE_RETURN_POINT
    case 5001: // MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
    case 5002: // MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
    case 5003: // MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION
    case 5004: // MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
    case 5100: // MAV_CMD_NAV_RALLY_POINT
      return true;
    default:
      return false;
  }
}

/**
 * Extract clean firmware version string from ArduPilot/PX4 boot banner or STATUSTEXT.
 * E.g., "ArduPlane V4.8.0-dev (1d44127b)" -> "4.8.0-dev"
 * E.g., "ArduCopter V4.5.2 (78057ebe)" -> "4.5.2"
 * E.g., "Rover V4.2.0 (52bca1c3)" -> "4.2.0"
 */
export function extractFirmwareVersion(text: string): string | null {
  if (!text) return null;
  const bannerMatch = text.match(
    /(?:Ardu[A-Za-z]+|Rover|AntennaTracker|APM:[A-Za-z]+|PX4[A-Za-z0-9\s]*)\s+[Vv]?([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[a-zA-Z0-9.]+)?)/i
  );
  if (bannerMatch) return bannerMatch[1];
  const genericMatch = text.match(/\b[Vv]([0-9]+\.[0-9]+(?:\.[0-9]+)?(?:-[a-zA-Z0-9.]+)?)\b/);
  if (genericMatch) return genericMatch[1];
  return null;
}
