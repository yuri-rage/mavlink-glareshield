// Gimbal pointing (ArduPilot AP_Mount through the MAVLink gimbal manager): the commands, whether pointing at a place
// will turn the vehicle, and where the camera is looking. Pure; the store is store/gimbalStore.ts, the UI
// components/map/GimbalControl.tsx.
//
// - MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW: pitch and yaw (deg); flags YAW_LOCK (yaw held in the earth frame; otherwise it
//   follows the vehicle), RETRACT, NEUTRAL; param7 the gimbal device id. With no angles or rates it only sets yaw lock.
// - MAV_CMD_DO_SET_ROI_LOCATION: point at a place; param1 the gimbal device id. MAV_CMD_DO_SET_ROI_NONE stops.
//   On Copter, a gimbal that can't pan (or older firmware, which ignores the device id) makes the vehicle yaw to face
//   the place.
// - ArduPilot's gimbal device id is the mount instance + 1 (MNT1 = 1) for gimbals it drives itself.

export const MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW = 1000;
export const MAV_CMD_DO_SET_ROI_LOCATION = 195;
export const MAV_CMD_DO_SET_ROI_NONE = 197;

export const GIMBAL_FLAGS = { RETRACT: 1, NEUTRAL: 2, YAW_LOCK: 16, YAW_IN_EARTH_FRAME: 64 } as const;
export const GIMBAL_CAP = {
  HAS_RETRACT: 1,
  HAS_NEUTRAL: 2,
  HAS_PITCH_AXIS: 32,
  HAS_YAW_AXIS: 256,
  HAS_YAW_LOCK: 1024,
  CAN_POINT_GLOBAL: 131072,
} as const;

export type CommandParams = [number, number, number, number, number, number, number];

/** COMMAND_LONG params for DO_GIMBAL_MANAGER_PITCHYAW. NaN leaves a value unset. */
export function pitchYawParams(o: {
  deviceId: number;
  pitchDeg?: number;
  yawDeg?: number;
  yawLock?: boolean;
  retract?: boolean;
  neutral?: boolean;
}): CommandParams {
  const flags =
    (o.yawLock ? GIMBAL_FLAGS.YAW_LOCK : 0) |
    (o.retract ? GIMBAL_FLAGS.RETRACT : 0) |
    (o.neutral ? GIMBAL_FLAGS.NEUTRAL : 0);
  const angles = o.pitchDeg !== undefined && o.yawDeg !== undefined;
  return [angles ? o.pitchDeg! : NaN, angles ? o.yawDeg! : NaN, NaN, NaN, flags, 0, o.deviceId];
}

/** Pointing at a place turns the vehicle: on Copter, when the gimbal can't pan. */
export function roiTurnsVehicle(category: string, capFlags: number | null): boolean {
  if (category !== 'copter') return false;
  return capFlags === null || (capFlags & GIMBAL_CAP.HAS_YAW_AXIS) === 0;
}

/**
 * Where the camera's center ray meets the ground, taken as flat at home's height: the vehicle `heightM` above it,
 * looking `pitchDeg` (negative down) along `headingDeg` (true). When the ray is level or points up, or the ground is
 * further than `maxM`, the point `maxM` along the heading is returned with `ground` false.
 */
export function aimPoint(o: {
  lat: number;
  lon: number;
  heightM: number;
  pitchDeg: number;
  headingDeg: number;
  maxM?: number;
}): {
  lat: number;
  lon: number;
  distanceM: number;
  ground: boolean;
} {
  const maxM = o.maxM ?? 1000;
  const down = -o.pitchDeg;
  let dist = maxM;
  let ground = false;
  if (down > 0.5 && o.heightM > 0) {
    const d = o.heightM / Math.tan((down * Math.PI) / 180);
    if (d <= maxM) {
      dist = d;
      ground = true;
    }
  }
  const R = 6371000;
  const b = (o.headingDeg * Math.PI) / 180;
  const lat = o.lat + ((dist * Math.cos(b)) / R) * (180 / Math.PI);
  const lon = o.lon + ((dist * Math.sin(b)) / (R * Math.cos((o.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat, lon, distanceM: dist, ground };
}

/** The gimbal's heading (true): yaw is relative to the vehicle unless the attitude says earth frame. */
export function gimbalHeading(yawDeg: number, earthFrame: boolean, vehicleHeadingDeg: number): number {
  return (((earthFrame ? yawDeg : vehicleHeadingDeg + yawDeg) % 360) + 360) % 360;
}

/**
 * Usable limits: what the gimbal reports, or a fallback where it reports nothing finite (MAVLink uses NaN for an
 * unknown or unbounded axis). With yaw lock the yaw is a true heading, so it spans the whole circle whatever the
 * mechanical yaw limits.
 */
export function gimbalLimits(
  info: { pitchMin: number; pitchMax: number; yawMin: number; yawMax: number } | null,
  yawLock: boolean
) {
  const fin = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v : d);
  return {
    pitchMin: fin(info?.pitchMin, -90),
    pitchMax: fin(info?.pitchMax, 30),
    yawMin: yawLock ? -180 : fin(info?.yawMin, -180),
    yawMax: yawLock ? 180 : fin(info?.yawMax, 180),
  };
}

/** A heading in -180..180. */
export const wrap180 = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * The yaw that means "along the vehicle": 0 relative to it, or with yaw lock (yaw is then a true heading) the
 * vehicle's own heading. Used by Forward and Down, which otherwise would point north under yaw lock.
 */
export function forwardYaw(yawLock: boolean, vehicleHeadingDeg: number): number {
  return yawLock ? wrap180(vehicleHeadingDeg) : 0;
}
