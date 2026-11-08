// Reading, transforming and judging the values custom widgets are bound to.
//
// Values come from the telemetry store first (its curated fields, aliases and the RC / servo scaling that needs
// parameters), then from the generic message cache, which covers every decoded field of every message.

import type { CustomWidgetDefinition, WidgetDataBinding, WidgetUnitKind } from '../types/widget';
import { baseMessageName, getCachedField, getLastSeen } from './messageCache';

export const DEFAULT_STALE_AFTER_SEC = 3;

/**
 * Scales a raw PWM value using ArduPilot min, max, and trim parameters to the [-1, 1] range.
 * If pwm <= trim: (pwm - trim) / (trim - min)
 * If pwm > trim: (pwm - trim) / (max - trim)
 * Falls back to min=1000, trim=1500, max=2000 if parameters are missing.
 */
export function scalePwmToUnitRange(
  pwm: number,
  minParam: number = 1000,
  maxParam: number = 2000,
  trimParam: number = 1500
): number {
  if (pwm <= trimParam) {
    if (trimParam > minParam) {
      const scaled = (pwm - trimParam) / (trimParam - minParam);
      return Math.max(-1, Math.min(1, scaled));
    }
    return 0;
  } else {
    if (maxParam > trimParam) {
      const scaled = (pwm - trimParam) / (maxParam - trimParam);
      return Math.max(-1, Math.min(1, scaled));
    }
    return 0;
  }
}

const FIELD_ALIASES: Record<string, string> = {
  voltage_battery: 'voltage',
  current_battery: 'current',
  battery_remaining: 'remaining',
  current_consumed: 'consumedMah',
  drop_rate_comm: 'dropRateComm',
  errors_comm: 'errorsComm',
  satellites_visible: 'satellites',
  eph: 'hdop',
  epv: 'vdop',
  vel: 'groundspeed',
  relative_alt: 'relativeAlt',
  roll_deg: 'rollDeg',
  pitch_deg: 'pitchDeg',
  yaw_deg: 'yawDeg',
  nav_roll: 'navRoll',
  nav_pitch: 'navPitch',
  nav_bearing: 'navBearing',
  target_bearing: 'targetBearing',
  wp_dist: 'wpDist',
  alt_error: 'altError',
  aspd_error: 'aspdError',
  xtrack_error: 'xtrackError',
  speed_z: 'speedZ',
  vibration_x: 'vibrationX',
  vibration_y: 'vibrationY',
  vibration_z: 'vibrationZ',
  clipping_0: 'clipping0',
  clipping_1: 'clipping1',
  clipping_2: 'clipping2',
  velocity_variance: 'velocityVariance',
  pos_horiz_variance: 'posHorizVariance',
  pos_vert_variance: 'posVertVariance',
  compass_variance: 'compassVariance',
  terrain_alt_variance: 'terrainAltVariance',
  airspeed_variance: 'airspeedVariance',
  current_distance: 'distance',
  min_distance: 'minDistance',
  max_distance: 'maxDistance',
  signal_quality: 'signalQuality',
  Vcc: 'vcc',
  Vservo: 'vservo',
  press_abs: 'pressAbs',
  press_diff: 'pressDiff',
};

/** Store slice holding each message's curated fields. */
const STORE_SLICES: Record<string, string[]> = {
  ATTITUDE: ['attitude'],
  GLOBAL_POSITION_INT: ['position'],
  VFR_HUD: ['vfr'],
  SYS_STATUS: ['battery', 'sysStatus'],
  BATTERY_STATUS: ['battery'],
  GPS_RAW_INT: ['gps'],
  HEARTBEAT: ['heartbeat'],
  RAW_IMU: ['imu'],
  SCALED_IMU: ['imu'],
  HIGHRES_IMU: ['imu'],
  NAV_CONTROLLER_OUTPUT: ['navController'],
  WIND: ['wind'],
  VIBRATION: ['vibration'],
  EKF_STATUS_REPORT: ['ekf'],
  RANGEFINDER: ['rangefinder'],
  DISTANCE_SENSOR: ['rangefinder'],
  RPM: ['rpm'],
  POWER_STATUS: ['power'],
  SCALED_PRESSURE: ['pressure'],
};

/** One bit of an integer field (0 or 1): bit 0 is the least significant. */
export function extractBit(value: number, bit: number): number {
  return Math.floor(value / 2 ** bit) % 2;
}

/**
 * The raw bound value, before multiplier/offset: a number, a string for the few text fields, `null` for an
 * input that reports "unused" (RC 65535, servo 0), or undefined when nothing is known yet. With `bit` set, it is
 * that bit of the field (0 or 1).
 */
export function resolveRawValue(
  binding: Pick<WidgetDataBinding, 'messageName' | 'fieldName' | 'bit'> | undefined,
  state: any
): number | string | null | undefined {
  const raw = resolveFieldValue(binding, state);
  if (binding?.bit === undefined || typeof raw !== 'number' || !Number.isFinite(raw)) return raw;
  return extractBit(Math.trunc(Math.abs(raw)), binding.bit);
}

function resolveFieldValue(
  binding: Pick<WidgetDataBinding, 'messageName' | 'fieldName'> | undefined,
  state: any
): number | string | null | undefined {
  if (!binding || !binding.messageName || !binding.fieldName) return undefined;
  const { messageName, fieldName } = binding;
  const msg = messageName.toUpperCase();
  const targetKey = FIELD_ALIASES[fieldName] || fieldName;

  if (msg === 'RC_CHANNELS' || msg === 'RC_CHANNELS_RAW' || msg === 'RC_CHANNELS (SCALED)') {
    const isScaled = msg === 'RC_CHANNELS (SCALED)' || fieldName.includes('scaled');
    if (fieldName === 'rssi') {
      const rssi = state.rc?.rssi;
      return rssi === 255 || rssi === undefined ? null : rssi;
    }
    const chanMatch = fieldName.match(/^chan(\d+)(?:_raw|_scaled)?$/i);
    if (chanMatch) {
      const chNum = parseInt(chanMatch[1], 10);
      const chancount = state.rc?.chancount ?? 18;
      if (chNum - 1 >= chancount) return null;
      const val = state.rc?.channels?.[chNum - 1];
      if (val === undefined) return undefined;
      if (val === 65535 || (isScaled && val === 0)) return null;
      if (!isScaled) return val;
      const minP = state.parameters?.[`RC${chNum}_MIN`]?.value ?? 1000;
      const maxP = state.parameters?.[`RC${chNum}_MAX`]?.value ?? 2000;
      const trimP = state.parameters?.[`RC${chNum}_TRIM`]?.value ?? 1500;
      return scalePwmToUnitRange(val, minP, maxP, trimP);
    }
    const v = state.rc?.[targetKey] ?? state.rc?.[fieldName];
    return v ?? getCachedField(msg, fieldName);
  }

  if (msg === 'SERVO_OUTPUT_RAW' || msg === 'SERVO_OUTPUT_RAW (SCALED)') {
    const isScaled = msg === 'SERVO_OUTPUT_RAW (SCALED)' || fieldName.includes('scaled');
    const srvMatch = fieldName.match(/^servo(\d+)(?:_raw|_scaled)?$/i);
    if (srvMatch) {
      const svNum = parseInt(srvMatch[1], 10);
      const val = state.servo?.servos?.[svNum - 1];
      if (val === undefined) return undefined;
      if (val === 0 || val === 65535) return null;
      if (!isScaled) return val;
      const p = state.parameters ?? {};
      const minP = p[`SERVO${svNum}_MIN`]?.value ?? p[`RC${svNum}_MIN`]?.value ?? 1000;
      const maxP = p[`SERVO${svNum}_MAX`]?.value ?? p[`RC${svNum}_MAX`]?.value ?? 2000;
      const trimP = p[`SERVO${svNum}_TRIM`]?.value ?? p[`RC${svNum}_TRIM`]?.value ?? 1500;
      return scalePwmToUnitRange(val, minP, maxP, trimP);
    }
    const v = state.servo?.[targetKey] ?? state.servo?.[fieldName];
    return v ?? getCachedField(msg, fieldName);
  }

  if (msg === 'ESC_TELEMETRY_1_TO_4') {
    const escMatch = fieldName.match(/^(rpm|temp|curr|volt)(\d)$/);
    if (escMatch) {
      const idx = parseInt(escMatch[2], 10) - 1;
      const key = { rpm: 'rpm', temp: 'temperature', curr: 'current', volt: 'voltage' }[escMatch[1]]!;
      return state.esc?.[key]?.[idx];
    }
    return state.esc?.[targetKey] ?? state.esc?.[fieldName] ?? getCachedField(msg, fieldName);
  }

  for (const slice of STORE_SLICES[msg] ?? []) {
    const v = state[slice]?.[targetKey];
    if (v !== undefined && v !== null) return v;
  }
  for (const slice of STORE_SLICES[msg] ?? []) {
    const v = state[slice]?.[fieldName];
    if (v !== undefined && v !== null) return v;
  }
  return getCachedField(msg, fieldName);
}

// -----------------------------------------------------------------------------------------------------------------
// Numeric pipeline
// -----------------------------------------------------------------------------------------------------------------

export type UnitSystem = 'ms' | 'kmh' | 'mph' | 'kts';

/** Display conversion for a unit kind under the user's unit system. */
function unitConversion(kind: WidgetUnitKind | undefined, system: UnitSystem): { factor: number; unit: string } | null {
  if (!kind || kind === 'none') return null;
  const imperial = system === 'mph' || system === 'kts';
  if (kind === 'speed') {
    if (system === 'ms') return { factor: 1, unit: 'm/s' };
    if (system === 'kts') return { factor: 1.94384, unit: 'kts' };
    if (system === 'mph') return { factor: 2.23694, unit: 'mph' };
    return { factor: 3.6, unit: 'km/h' };
  }
  // altitude and distance
  return imperial ? { factor: 3.28084, unit: 'ft' } : { factor: 1, unit: 'm' };
}

/** raw * multiplier + offset: the value in the binding's base units (SI when a unit kind is set). */
export function applyBindingTransform(raw: number, binding: WidgetDataBinding): number {
  return raw * (binding.multiplier ?? 1) + (binding.offset ?? 0);
}

export interface BindingReading {
  /**
   * Value in the binding's base units (raw * multiplier + offset; m/s or m when a unit kind is set). Min, max and
   * thresholds are expressed in these units, so they keep their meaning when the user changes unit system.
   */
  base: number | null;
  /** Value in display units, or null when unknown / unused. */
  value: number | null;
  /** Formatted value ('--' when unknown). */
  text: string;
  unit: string;
  stale: boolean;
  /** Milliseconds since the bound message last arrived, if it ever has. */
  ageMs?: number;
}

export function bindingUnit(binding: WidgetDataBinding, system: UnitSystem): string {
  return unitConversion(binding.unitKind, system)?.unit ?? binding.unit ?? '';
}

/** Convert a base-unit value (after transform) into display units. */
export function toDisplayUnits(base: number, binding: WidgetDataBinding, system: UnitSystem): number {
  const conv = unitConversion(binding.unitKind, system);
  return conv ? base * conv.factor : base;
}

/**
 * Decimals for a binding that doesn't set any: none for raw PWM / RC / RSSI values (whole microseconds or counts,
 * where 1850.0 only adds noise), one otherwise.
 */
function defaultDecimals(binding: WidgetDataBinding): number {
  const msg = baseMessageName(binding.messageName);
  const rawRc =
    (msg === 'RC_CHANNELS' || msg === 'RC_CHANNELS_RAW') && (binding.fieldName === 'rssi' || /^chan\d+(?:_raw)?$/i.test(binding.fieldName));
  const rawServo = msg === 'SERVO_OUTPUT_RAW' && /^servo\d+_raw$/i.test(binding.fieldName);
  return rawRc || rawServo ? 0 : 1;
}

function formatNumber(value: number, decimals: number | undefined): string {
  if (!Number.isFinite(value)) return '--';
  return value.toFixed(Math.max(0, Math.min(6, decimals ?? 1)));
}

export function isStale(binding: WidgetDataBinding, staleAfterSec: number | undefined, now = Date.now()): { stale: boolean; ageMs?: number } {
  const seen = getLastSeen(binding.messageName);
  if (seen === undefined) return { stale: false };
  const ageMs = now - seen;
  return { stale: ageMs > (staleAfterSec ?? DEFAULT_STALE_AFTER_SEC) * 1000, ageMs };
}

export function readBinding(
  binding: WidgetDataBinding | undefined,
  state: any,
  system: UnitSystem,
  staleAfterSec?: number,
  now = Date.now()
): BindingReading {
  if (!binding) return { base: null, value: null, text: '--', unit: '', stale: false };
  const unit = bindingUnit(binding, system);
  const raw = resolveRawValue(binding, state);
  const { stale, ageMs } = isStale(binding, staleAfterSec, now);
  if (typeof raw === 'string') {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return { base: null, value: null, text: raw, unit, stale, ageMs };
    const base = applyBindingTransform(parsed, binding);
    const v = toDisplayUnits(base, binding, system);
    return { base, value: v, text: formatNumber(v, binding.decimals ?? defaultDecimals(binding)), unit, stale, ageMs };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { base: null, value: null, text: '--', unit, stale, ageMs };
  const base = applyBindingTransform(raw, binding);
  const value = toDisplayUnits(base, binding, system);
  return { base, value, text: formatNumber(value, binding.decimals ?? defaultDecimals(binding)), unit, stale, ageMs };
}

export type AlertState = 'normal' | 'warn' | 'crit';

export function evaluateAlert(value: number | null, binding: WidgetDataBinding | undefined): AlertState {
  if (value === null || !binding || !Number.isFinite(value)) return 'normal';
  const { warnThreshold, critThreshold, thresholdInvert } = binding;
  if (thresholdInvert) {
    if (critThreshold !== undefined && value <= critThreshold) return 'crit';
    if (warnThreshold !== undefined && value <= warnThreshold) return 'warn';
  } else {
    if (critThreshold !== undefined && value >= critThreshold) return 'crit';
    if (warnThreshold !== undefined && value >= warnThreshold) return 'warn';
  }
  return 'normal';
}

/** The primary binding followed by any additional ones. */
export function getAllBindings(def: Pick<CustomWidgetDefinition, 'binding' | 'bindings'>): WidgetDataBinding[] {
  return [def.binding, ...(def.bindings ?? [])].filter((b): b is WidgetDataBinding => Boolean(b && b.messageName));
}

/** Stable identity of a binding's base-unit series (what the sampler records). */
export function bindingKey(binding: WidgetDataBinding): string {
  return [binding.messageName, binding.fieldName, binding.multiplier ?? 1, binding.offset ?? 0, binding.bit ?? ''].join('|');
}
