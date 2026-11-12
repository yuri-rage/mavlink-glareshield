// PID_TUNING: what each vehicle type reports, and how GCS_PID_MASK selects it.
//
// The autopilot sends one PID_TUNING message per selected controller per interval, each tagged with an `axis`
// (MAVLink's PID_TUNING_AXIS). Which controllers exist, which GCS_PID_MASK bit selects each, and which axis
// number it is sent under all differ by vehicle type (from each vehicle's GCS_MAVLINK::send_pid_tuning):
//
// - Copter: bits 0-3 select the roll, pitch and yaw rate controllers and the vertical acceleration controller,
//   sent as axes 1-4.
// - Sub: bits 0-2, roll, pitch and yaw rate, as axes 1-3.
// - Plane: bits 0-2 roll, pitch, yaw; bit 3 ground steering (axis 5); bit 4 deep-stall landing (axis 6). In a
//   VTOL mode, roll, pitch and yaw report the QuadPlane's multicopter rate controllers instead of the
//   fixed-wing ones.
// - Rover: bit 0 steering rate (axis 5), bit 1 speed-to-throttle (sent as axis 4), bit 2 balance-bot pitch (axis 2),
//   bits 3-4 the left and right wheel rate controllers (axes 7-8), bit 5 sailboat heel (axis 9), bits 6-7 the
//   position controller's north and east velocity (axes 10-11), bit 8 the Stanley path controller (sent as
//   axis 16, yaw angle) in firmware that has it.
// - Antenna Tracker: bit 0 pitch (axis 2), bit 1 yaw (axis 3).
//
// When the version-matched parameter metadata is loaded, its GCS_PID_MASK bitmask decides which of these the
// connected firmware actually has, so an older version doesn't offer a controller it can't report. Metadata is
// downloaded from ArduPilot's published releases, so it can lag firmware built from source; a controller with
// `presentWithParam` is also offered whenever the vehicle reports that parameter, whatever the metadata says.

import type { VehicleCategory } from './messages';
import { hasBit, withBit } from './paramBits';

/** MAVLink PID_TUNING_AXIS values, named as in the enum, for cache names that stay the same on every vehicle. */
export const PID_AXIS_ENUM_NAMES: Record<number, string> = {
  1: 'ROLL',
  2: 'PITCH',
  3: 'YAW',
  4: 'ACCZ',
  5: 'STEER',
  6: 'LANDING',
  7: 'WHEEL_LEFT',
  8: 'WHEEL_RIGHT',
  9: 'SAIL_HEEL',
  10: 'VEL_NORTH',
  11: 'VEL_EAST',
  12: 'VEL_DOWN',
  13: 'POS_NORTH',
  14: 'POS_EAST',
  15: 'POS_DOWN',
  16: 'YAW_ANGLE',
};

/** Name under which one axis's latest values are kept for custom widget bindings: PID_TUNING_ROLL, … */
export function pidAxisMessageName(axis: number): string {
  return `PID_TUNING_${PID_AXIS_ENUM_NAMES[axis] ?? `AXIS${axis}`}`;
}

export interface PidController {
  /** PID_TUNING `axis` this controller is reported under. */
  axis: number;
  /** GCS_PID_MASK bit (0 = least significant) that turns it on. */
  bit: number;
  /** Short name for the axis picker. */
  label: string;
  /** What the controller does, for the picker's tooltip. */
  description: string;
  /** A parameter that only firmware with this controller has; when the vehicle reports it, the controller is offered even if the metadata's bitmask lacks the bit. */
  presentWithParam?: string;
}

const COPTER: PidController[] = [
  { axis: 1, bit: 0, label: 'Roll', description: 'Roll rate controller (ATC_RAT_RLL_*)' },
  { axis: 2, bit: 1, label: 'Pitch', description: 'Pitch rate controller (ATC_RAT_PIT_*)' },
  { axis: 3, bit: 2, label: 'Yaw', description: 'Yaw rate controller (ATC_RAT_YAW_*)' },
  { axis: 4, bit: 3, label: 'Accel Z', description: 'Vertical acceleration controller (PSC_ACCZ_*)' },
];

const SUB: PidController[] = COPTER.filter((c) => c.axis <= 3);

const PLANE: PidController[] = [
  { axis: 1, bit: 0, label: 'Roll', description: 'Roll rate controller (RLL_RATE_*; Q_A_RAT_RLL_* in VTOL modes)' },
  { axis: 2, bit: 1, label: 'Pitch', description: 'Pitch rate controller (PTCH_RATE_*; Q_A_RAT_PIT_* in VTOL modes)' },
  { axis: 3, bit: 2, label: 'Yaw', description: 'Yaw controller (YAW_RATE_* or the yaw damper; Q_A_RAT_YAW_* in VTOL modes)' },
  { axis: 5, bit: 3, label: 'Steering', description: 'Ground steering rate controller (STEER2SRV_*)' },
  { axis: 6, bit: 4, label: 'Landing', description: 'Deep-stall landing steering (LAND_DS_*)' },
];

const ROVER: PidController[] = [
  { axis: 5, bit: 0, label: 'Steering', description: 'Steering rate controller (ATC_STR_RAT_*)' },
  { axis: 4, bit: 1, label: 'Throttle', description: 'Speed-to-throttle controller (ATC_SPEED_*)' },
  { axis: 2, bit: 2, label: 'Pitch', description: 'Balance bot pitch-to-throttle controller (ATC_BAL_*)' },
  { axis: 7, bit: 3, label: 'Left wheel', description: 'Left wheel rate controller (WRC_RATE_*)' },
  { axis: 8, bit: 4, label: 'Right wheel', description: 'Right wheel rate controller (WRC_RATE_*)' },
  { axis: 9, bit: 5, label: 'Sail heel', description: 'Sailboat heel controller (ATC_SAIL_*)' },
  { axis: 10, bit: 6, label: 'Vel north', description: 'Position controller, north velocity (PSC_VEL_*)' },
  { axis: 11, bit: 7, label: 'Vel east', description: 'Position controller, east velocity (PSC_VEL_*)' },
  {
    axis: 16,
    bit: 8,
    label: 'Stanley',
    description: 'Stanley path controller (ATC_STAN_*), sent as the yaw angle axis',
    presentWithParam: 'ATC_STAN_USE',
  },
];

const TRACKER: PidController[] = [
  { axis: 2, bit: 0, label: 'Pitch', description: 'Pitch servo controller (PITCH2SRV_*)' },
  { axis: 3, bit: 1, label: 'Yaw', description: 'Yaw servo controller (YAW2SRV_*)' },
];

const BY_VEHICLE: Partial<Record<VehicleCategory, PidController[]>> = {
  copter: COPTER,
  plane: PLANE,
  rover: ROVER,
  sub: SUB,
  tracker: TRACKER,
};

/**
 * The controllers this vehicle type can report, in picker order. With the firmware's GCS_PID_MASK bitmask
 * (from the parameter metadata), only bits the firmware has are kept, except that a controller whose
 * `presentWithParam` is in `hasParam` is always kept. Empty when the vehicle has no GCS_PID_MASK (unknown
 * vehicle types).
 */
export function pidControllersFor(
  category: VehicleCategory,
  maskBitmask?: Record<number, string> | null,
  hasParam?: (name: string) => boolean
): PidController[] {
  const all = BY_VEHICLE[category] ?? [];
  const useMeta = !!maskBitmask && Object.keys(maskBitmask).length > 0;
  return all
    .filter((c) => !useMeta || maskBitmask[c.bit] !== undefined || (!!c.presentWithParam && !!hasParam?.(c.presentWithParam)))
    .map((c) => ({ ...c }));
}

/** Parameters whose presence on the vehicle reveals a controller newer than the published metadata. */
export function pidPresenceParams(category: VehicleCategory): string[] {
  return (BY_VEHICLE[category] ?? []).flatMap((c) => (c.presentWithParam ? [c.presentWithParam] : []));
}

/**
 * What to offer in the picker: the vehicle's controllers, plus any axis that is actually arriving but isn't
 * in the list (a newer firmware, or a vehicle type with no list), so data is never hidden.
 */
export function pidPickerAxes(controllers: PidController[], seenAxes: Iterable<number>): PidController[] {
  const out = controllers.map((c) => ({ ...c }));
  const have = new Set(out.map((c) => c.axis));
  for (const axis of [...seenAxes].sort((a, b) => a - b)) {
    if (have.has(axis)) continue;
    have.add(axis);
    const name = PID_AXIS_ENUM_NAMES[axis];
    out.push({
      axis,
      bit: -1,
      label: name ? name.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : `Axis ${axis}`,
      description: `Reported as PID_TUNING axis ${axis}`,
    });
  }
  return out;
}

/** Whether `bit` is set in a GCS_PID_MASK value (false for an axis with no bit, -1). */
export function maskHasBit(mask: number, bit: number): boolean {
  return bit >= 0 && hasBit(mask, bit);
}

/** GCS_PID_MASK with `bit` set or cleared (unchanged for an axis with no bit, -1). */
export function withMaskBit(mask: number, bit: number, on: boolean): number {
  return bit < 0 ? Math.max(0, Math.trunc(mask)) : withBit(mask, bit, on);
}

/** The PID_TUNING fields, in chart order. */
export const PID_TUNING_FIELDS = ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'] as const;
export type PidTuningField = (typeof PID_TUNING_FIELDS)[number];
