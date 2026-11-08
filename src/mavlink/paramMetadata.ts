export interface ParamMeta {
  description: string;
  /** Short name, e.g. "Battery monitoring". */
  displayName?: string;
  units?: string;
  min?: number;
  max?: number;
  /** Suggested step when editing. */
  increment?: number;
  rebootRequired?: boolean;
  readOnly?: boolean;
  /** ArduPilot's audience for the parameter. */
  user?: 'Standard' | 'Advanced';
  /** Named values, for a parameter that takes one of a set. */
  values?: Record<number, string>;
  /** Named bits (bit number → name), for a parameter that is a bitmask. */
  bitmask?: Record<number, string>;
}

/**
 * Curated ArduPilot parameter metadata dictionary covering common safety,
 * navigation, battery, geofence, failsafe, GPS, and controller parameters.
 * Fallback prefix matching provides helpful context for unlisted parameters.
 */
export const ARDUPILOT_PARAM_META: Record<string, ParamMeta> = {
  // Arming & Safety
  ARMING_CHECK: {
    description: 'Bitmask of pre-arm checks to run before allowing arming (1 = All)',
    min: 0,
    values: { 0: 'Disabled', 1: 'All Checks Enabled' },
  },
  ARMING_REQUIRE: {
    description: 'Require arming before throttle output is enabled',
    values: { 0: 'Disabled', 1: 'THR_MIN PWM', 2: 'Zero PWM' },
  },
  ARMING_ACCTHRESH: {
    description: 'Accelerometer error threshold for pre-arm checks',
    units: 'm/s²',
    min: 0.25,
    max: 3.0,
  },
  BRD_SAFETY_DEFLT: {
    description: 'Default state of hardware safety switch at boot',
    values: { 0: 'Disabled', 1: 'Enabled' },
    rebootRequired: true,
  },

  // Battery & Power
  BATT_MONITOR: {
    description: 'Battery monitor sensor type',
    values: { 0: 'Disabled', 3: 'Analog Voltage Only', 4: 'Analog Voltage and Current', 7: 'SMBus', 9: 'UAVCAN' },
    rebootRequired: true,
  },
  BATT_CAPACITY: {
    description: 'Total battery pack capacity',
    units: 'mAh',
    min: 0,
    max: 100000,
  },
  BATT_LOW_VOLT: {
    description: 'Voltage threshold that triggers a low-battery failsafe',
    units: 'V',
    min: 0,
    max: 120,
  },
  BATT_CRT_VOLT: {
    description: 'Voltage threshold that triggers a critical-battery failsafe',
    units: 'V',
    min: 0,
    max: 120,
  },
  BATT_LOW_MAH: {
    description: 'Remaining capacity threshold for low-battery failsafe',
    units: 'mAh',
    min: 0,
    max: 100000,
  },
  BATT_CRT_MAH: {
    description: 'Remaining capacity threshold for critical-battery failsafe',
    units: 'mAh',
    min: 0,
    max: 100000,
  },
  BATT_FS_LOW_ACT: {
    description: 'Action taken when low-battery failsafe triggers',
    values: { 0: 'None', 1: 'Land', 2: 'RTL', 3: 'SmartRTL or RTL', 4: 'SmartRTL or Land', 5: 'Terminate' },
  },
  BATT_FS_CRT_ACT: {
    description: 'Action taken when critical-battery failsafe triggers',
    values: { 0: 'None', 1: 'Land', 2: 'RTL', 3: 'SmartRTL or RTL', 4: 'SmartRTL or Land', 5: 'Terminate' },
  },

  // Failsafes
  FS_THR_ENABLE: {
    description: 'Throttle (RC receiver) failsafe enable and action',
    values: { 0: 'Disabled', 1: 'Always RTL', 2: 'Continue Mission in Auto', 3: 'Always Land', 4: 'SmartRTL or RTL', 5: 'SmartRTL or Land' },
  },
  FS_THR_VALUE: {
    description: 'PWM threshold below which throttle failsafe triggers',
    units: 'PWM',
    min: 910,
    max: 1100,
  },
  FS_GCS_ENABLE: {
    description: 'Ground Control Station heartbeat failsafe action',
    values: { 0: 'Disabled', 1: 'Always RTL', 2: 'Continue Mission in Auto', 3: 'SmartRTL or RTL', 4: 'SmartRTL or Land', 5: 'Always Land' },
  },
  FS_EKF_ACTION: {
    description: 'Action taken on EKF attitude/position variance failsafe',
    values: { 1: 'Land', 2: 'AltHold', 3: 'Land Even in Stabilize' },
  },
  FS_EKF_THRESH: {
    description: 'EKF failsafe variance threshold',
    min: 0.6,
    max: 1.0,
  },

  // RTL & Navigation
  RTL_ALT: {
    description: 'Minimum return altitude during RTL (0 = maintain current altitude)',
    units: 'cm',
    min: 0,
    max: 300000,
  },
  RTL_ALT_FINAL: {
    description: 'Final loiter altitude after returning home in RTL (0 = auto-land)',
    units: 'cm',
    min: 0,
    max: 10000,
  },
  RTL_SPEED: {
    description: 'Horizontal cruise speed during Return-to-Launch (0 = use WPNAV_SPEED)',
    units: 'cm/s',
    min: 0,
    max: 5000,
  },
  RTL_LOIT_TIME: {
    description: 'Pause time above home before final descent in RTL',
    units: 'ms',
    min: 0,
    max: 60000,
  },
  WPNAV_SPEED: {
    description: 'Horizontal waypoint navigation target speed',
    units: 'cm/s',
    min: 20,
    max: 5000,
  },
  WPNAV_SPEED_UP: {
    description: 'Maximum climb rate during autonomous waypoint navigation',
    units: 'cm/s',
    min: 10,
    max: 1000,
  },
  WPNAV_SPEED_DN: {
    description: 'Maximum descent rate during autonomous waypoint navigation',
    units: 'cm/s',
    min: 10,
    max: 1000,
  },
  WPNAV_RADIUS: {
    description: 'Distance from a waypoint at which it is considered reached',
    units: 'cm',
    min: 5,
    max: 10000,
  },
  WPNAV_ACCEL: {
    description: 'Horizontal acceleration used during autonomous navigation',
    units: 'cm/s²',
    min: 50,
    max: 500,
  },
  PILOT_SPEED_UP: {
    description: 'Maximum pilot-commanded vertical climb rate',
    units: 'cm/s',
    min: 50,
    max: 500,
  },
  PILOT_SPEED_DN: {
    description: 'Maximum pilot-commanded vertical descent rate (0 = same as PILOT_SPEED_UP)',
    units: 'cm/s',
    min: 0,
    max: 500,
  },
  ANGLE_MAX: {
    description: 'Maximum lean angle in all flight modes',
    units: 'cdeg',
    min: 1000,
    max: 8000,
  },

  // Geofence
  FENCE_ENABLE: {
    description: 'Enable geofence boundary protection',
    values: { 0: 'Disabled', 1: 'Enabled' },
  },
  FENCE_TYPE: {
    description: 'Bitmask of enabled geofence types (1=Max Alt, 2=Circle, 4=Polygon, 8=Min Alt)',
    min: 0,
    max: 15,
  },
  FENCE_ACTION: {
    description: 'Action taken when vehicle breaches the geofence',
    values: { 0: 'Report Only', 1: 'RTL or Land', 2: 'Always Land', 3: 'SmartRTL or RTL', 4: 'Brake or Land' },
  },
  FENCE_ALT_MAX: {
    description: 'Maximum altitude allowed inside the geofence',
    units: 'm',
    min: 10,
    max: 1000,
  },
  FENCE_RADIUS: {
    description: 'Radius of the circular geofence around Home',
    units: 'm',
    min: 30,
    max: 10000,
  },
  FENCE_MARGIN: {
    description: 'Safety buffer distance before geofence boundary triggers recovery',
    units: 'm',
    min: 1,
    max: 20,
  },

  // GPS & Compass
  GPS_TYPE: {
    description: 'Primary GPS receiver protocol type',
    values: { 0: 'None', 1: 'Auto', 2: 'u-blox', 5: 'NMEA', 9: 'UAVCAN', 14: 'MAV' },
    rebootRequired: true,
  },
  GPS_AUTO_SWITCH: {
    description: 'Automatic switching rule between dual GPS receivers',
    values: { 0: 'Use Primary', 1: 'Use Best', 2: 'Blend', 3: 'Use Secondary' },
  },
  COMPASS_USE: {
    description: 'Enable primary compass for heading estimation',
    values: { 0: 'Disabled', 1: 'Enabled' },
  },
  COMPASS_AUTODEC: {
    description: 'Automatically calculate magnetic declination from GPS coordinates',
    values: { 0: 'Disabled', 1: 'Enabled' },
  },

  // Plane / Rover specifics
  AIRSPEED_CRUISE: {
    description: 'Target cruise airspeed in automatic flight modes (Plane)',
    units: 'm/s',
    min: 3,
    max: 100,
  },
  AIRSPEED_MIN: {
    description: 'Minimum airspeed allowed in Fly-By-Wire and autonomous modes (Plane)',
    units: 'm/s',
    min: 3,
    max: 100,
  },
  AIRSPEED_MAX: {
    description: 'Maximum airspeed allowed in Fly-By-Wire and autonomous modes (Plane)',
    units: 'm/s',
    min: 5,
    max: 200,
  },
  ARSPD_FBW_MIN: {
    description: 'Minimum airspeed allowed in Fly-By-Wire and autonomous modes (legacy alias for AIRSPEED_MIN)',
    units: 'm/s',
    min: 3,
    max: 100,
  },
  ARSPD_FBW_MAX: {
    description: 'Maximum airspeed allowed in Fly-By-Wire and autonomous modes (legacy alias for AIRSPEED_MAX)',
    units: 'm/s',
    min: 5,
    max: 200,
  },
  CRUISE_SPEED: {
    description: 'Target ground speed in automatic modes (Rover)',
    units: 'm/s',
    min: 0.1,
    max: 50,
  },
  WP_RADIUS: {
    description: 'Distance from waypoint to consider reached (Plane / Rover)',
    units: 'm',
    min: 1,
    max: 1000,
  },

  // System & Telemetry
  SYSID_THISMAV: {
    description: 'MAVLink system ID of this vehicle',
    min: 1,
    max: 255,
  },
  SR0_EXTRA1: {
    description: 'Stream rate for attitude and rotational telemetry on port 0',
    units: 'Hz',
    min: 0,
    max: 50,
  },
  SR0_POSITION: {
    description: 'Stream rate for position telemetry on port 0',
    units: 'Hz',
    min: 0,
    max: 50,
  },
};

const PARAM_ALIASES: Record<string, string> = {
  AIRSPEED_MIN: 'ARSPD_FBW_MIN',
  ARSPD_FBW_MIN: 'AIRSPEED_MIN',
  AIRSPEED_MAX: 'ARSPD_FBW_MAX',
  ARSPD_FBW_MAX: 'AIRSPEED_MAX',
};

// The catalogue for the connected vehicle and firmware, from ArduPilot's ParameterRepository (see paramCatalog.ts).
let activeCatalog: Record<string, ParamMeta> | null = null;

/** Sets the catalogue that getParamMetadata looks in first; null falls back to the built-in descriptions. */
export function setActiveParamCatalog(catalog: Record<string, ParamMeta> | null) {
  activeCatalog = catalog;
}

export function getParamMetadata(name: string): ParamMeta | null {
  const upper = name.toUpperCase();

  if (activeCatalog?.[upper]) {
    return activeCatalog[upper];
  }

  if (ARDUPILOT_PARAM_META[upper]) {
    return ARDUPILOT_PARAM_META[upper];
  }

  const alias = PARAM_ALIASES[upper];
  if (alias) {
    if (activeCatalog?.[alias]) return activeCatalog[alias];
    if (ARDUPILOT_PARAM_META[alias]) return ARDUPILOT_PARAM_META[alias];
  }

  if (/^FLTMODE\d+$/.test(upper)) {
    return {
      description: 'Flight mode assigned to RC mode switch position',
      min: 0,
      max: 27,
    };
  }
  if (/^SERVO\d+_FUNCTION$/.test(upper)) {
    return {
      description: 'Output function assignment for this servo/motor channel',
    };
  }
  if (/^SERVO\d+_(MIN|MAX|TRIM)$/.test(upper)) {
    return {
      description: 'PWM pulse limit or trim for this output channel',
      units: 'PWM',
      min: 800,
      max: 2200,
    };
  }
  if (/^RC\d+_(MIN|MAX|TRIM)$/.test(upper)) {
    return {
      description: 'Calibrated RC input PWM limit or center trim',
      units: 'PWM',
      min: 800,
      max: 2200,
    };
  }
  if (/^ATC_/.test(upper)) {
    return {
      description: 'Attitude controller tuning gain or rate limit',
    };
  }
  if (/^PSC_/.test(upper)) {
    return {
      description: 'Position controller tuning gain',
    };
  }
  if (/^MOT_/.test(upper)) {
    return {
      description: 'Motor mixer, throttle curve, or spin threshold setting',
    };
  }
  if (/^INS_/.test(upper)) {
    return {
      description: 'Inertial measurement unit (IMU) calibration or filter setting',
    };
  }
  if (/^EK3_/.test(upper)) {
    return {
      description: 'Extended Kalman Filter (EKF3) sensor fusion parameter',
    };
  }
  return null;
}

/**
 * Parse a standard ArduPilot / Mission Planner / QGroundControl `.param` file.
 * Supports lines formatted as `PARAM_NAME,VALUE`, `PARAM_NAME VALUE`, or tab-separated,
 * as well as QGC tabular `compId\tdevId\tNAME\tVALUE\tTYPE` lines.
 */
export function parseParamFile(content: string): Record<string, number> {
  const result: Record<string, number> = {};
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    // Check QGC 5-column format: sysId compId NAME VALUE TYPE
    const tabParts = line.split(/\t+/);
    if (tabParts.length >= 4 && /^\d+$/.test(tabParts[0].trim()) && /^[A-Z][A-Z0-9_]{1,15}$/i.test(tabParts[2].trim())) {
      const name = tabParts[2].trim().toUpperCase();
      const val = Number(tabParts[3].trim());
      if (Number.isFinite(val)) {
        result[name] = val;
      }
      continue;
    }

    // Standard ArduPilot format: NAME,VALUE or NAME VALUE
    const parts = line.split(/[,\s]+/);
    if (parts.length >= 2) {
      const name = parts[0].trim().toUpperCase();
      const val = Number(parts[1].trim());
      if (/^[A-Z][A-Z0-9_]{1,15}$/.test(name) && Number.isFinite(val)) {
        result[name] = val;
      }
    }
  }

  return result;
}

/**
 * Format a parameter value for display and for .param files: the fewest significant digits (7 to 9) that read
 * back as the same 32-bit float the vehicle stores. Most values need 7 (0.2, not 0.200000003); some need 8 or 9
 * (123456.78 is stored as 123456.78125, and "123456.8" would load back as a different float), so files saved
 * here reload exactly and a value typed back in is the value that was shown.
 */
export function formatParamValue(val: number): string {
  if (val === undefined || val === null || Number.isNaN(val)) return '-';
  if (!Number.isFinite(val)) return String(val);
  if (Number.isInteger(val)) return String(val);
  const target = Math.fround(val);
  for (let digits = 7; digits < 9; digits++) {
    const candidate = parseFloat(val.toPrecision(digits));
    if (Math.fround(candidate) === target) return String(candidate);
  }
  return String(parseFloat(val.toPrecision(9)));
}

/**
 * Check if two parameter values are meaningfully different, combining relative tolerance
 * with an absolute epsilon floor for values near zero.
 */
export function areParamsDifferent(val1?: number, val2?: number, relTol = 1e-6, absTol = 1e-12): boolean {
  if (val1 === undefined || val2 === undefined) return val1 !== val2;
  const diff = Math.abs(val1 - val2);
  if (diff <= absTol) return false;
  const maxAbs = Math.max(Math.abs(val1), Math.abs(val2));
  return diff / maxAbs > relTol;
}

/**
 * Serialize a parameter map into a sorted ArduPilot `.param` file string.
 */
export function serializeParamFile(params: Record<string, number>, firmwareVersion?: string | null): string {
  const header = [
    `# ArduPilot Parameter File exported by MAVLink Glareshield`,
    `# Exported at: ${new Date().toISOString()}`,
    ...(firmwareVersion ? [`# Firmware: ${firmwareVersion}`] : []),
  ];

  const sortedKeys = Object.keys(params).sort();
  const body = sortedKeys.map((key) => {
    const val = params[key];
    const formatted = formatParamValue(val);
    return `${key},${formatted}`;
  });

  return [...header, ...body, ''].join('\n');
}
