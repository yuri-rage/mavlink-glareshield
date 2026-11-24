// Guided actions while flying: change altitude, orbit a point, set home. Each is built as a COMMAND_INT the way the
// vehicle handles it (ArduPilot master):
//
// - Change altitude. Plane: DO_CHANGE_ALTITUDE (param1 alt, param2 frame) changes the current target's altitude in
//   any mode (GCS_MAVLINK_Plane::handle_change_alt_request); in AUTO the next waypoint sets its own again. Copter:
//   no such command; DO_REPOSITION to the same point at the new altitude (a reposition without a position is
//   refused: Location::sanitize), which needs GUIDED (asked for with the change-mode flag). Rover: no altitude.
// - Orbit. Plane: DO_REPOSITION with param3 the loiter radius and param4 the direction (non-zero: counter-clockwise);
//   GUIDED then circles the point. Copter has no DO_ORBIT, and CIRCLE mode can't be given a centre; Rover doesn't.
// - Set home. DO_SET_HOME, common to all: param1 1 for the vehicle's own position, else the point given (frame
//   GLOBAL: altitude above sea level).

import type { VehicleCategory } from './messages';

export const MAV_CMD_DO_SET_HOME = 179;
export const MAV_CMD_DO_CHANGE_ALTITUDE = 186;
export const MAV_CMD_DO_REPOSITION = 192;
const MAV_FRAME_GLOBAL = 0;
const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;
/** DO_REPOSITION param2: switch to GUIDED to do it. */
const REPOSITION_CHANGE_MODE = 1;

/** A COMMAND_INT's command, frame and params 1-4, x, y (degE7), z. */
export interface CommandIntSpec {
  command: number;
  frame: number;
  params: [number, number, number, number, number, number, number];
  label: string;
}

export interface ChangeAltitudePlan {
  spec: CommandIntSpec;
  /** It switches the vehicle to GUIDED (stopping a mission or other mode). */
  switchesToGuided: boolean;
  /** What happens, in a line for the card. */
  note: string;
}

const e7 = (deg: number) => Math.round(deg * 1e7);

/** Whether this vehicle has a guided altitude change. */
export const canChangeAltitude = (c: VehicleCategory) => c === 'plane' || c === 'copter';

/**
 * Change altitude to `altRelM` above home. Copter repositions to `holdAt` (the guided target it is flying to, or
 * its own position) at the new height; Plane changes the target's height in place.
 */
export function changeAltitude(
  category: VehicleCategory,
  modeName: string,
  altRelM: number,
  holdAt: { lat: number; lon: number; isTarget: boolean } | null,
  fmtAlt: (m: number) => string = (m) => `${Math.round(m)} m`
): ChangeAltitudePlan | null {
  if (!Number.isFinite(altRelM) || altRelM <= 0) return null;
  const label = `Change altitude to ${fmtAlt(altRelM)}`;
  if (category === 'plane') {
    return {
      spec: { command: MAV_CMD_DO_CHANGE_ALTITUDE, frame: MAV_FRAME_GLOBAL_RELATIVE_ALT, params: [altRelM, MAV_FRAME_GLOBAL_RELATIVE_ALT, 0, 0, 0, 0, 0], label },
      switchesToGuided: false,
      note: modeName === 'AUTO' ? 'Changes the current target only: the next waypoint sets its own altitude.' : `Climbs or descends in ${modeName || 'the current mode'}.`,
    };
  }
  if (category === 'copter') {
    if (!holdAt) return null;
    const guided = modeName === 'GUIDED';
    return {
      spec: {
        command: MAV_CMD_DO_REPOSITION,
        frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
        params: [-1, REPOSITION_CHANGE_MODE, 0, Number.NaN, e7(holdAt.lat), e7(holdAt.lon), altRelM],
        label,
      },
      switchesToGuided: !guided,
      note: guided
        ? holdAt.isTarget
          ? 'Keeps flying to the Fly-to target, at the new altitude.'
          : 'Holds this position at the new altitude.'
        : `Switches from ${modeName || 'the current mode'} to GUIDED and holds this position at the new altitude${modeName === 'AUTO' ? ': the mission pauses' : ''}.`,
    };
  }
  return null;
}

/** Whether this vehicle can orbit a chosen point. */
export const canOrbit = (c: VehicleCategory) => c === 'plane';

/** Plane: circle (lat, lon) at `altRelM` above home, radius `radiusM`, counter-clockwise when `ccw`. */
export function orbit(lat: number, lon: number, altRelM: number, radiusM: number, ccw: boolean, fmtLen: (m: number) => string = (m) => `${Math.round(m)} m`): CommandIntSpec | null {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || !Number.isFinite(altRelM) || altRelM <= 0) return null;
  return {
    command: MAV_CMD_DO_REPOSITION,
    frame: MAV_FRAME_GLOBAL_RELATIVE_ALT,
    params: [-1, REPOSITION_CHANGE_MODE, radiusM, ccw ? 1 : 0, e7(lat), e7(lon), altRelM],
    label: `Orbit ${fmtLen(radiusM)} ${ccw ? 'CCW' : 'CW'} (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
  };
}

/** Home at (lat, lon), `altMslM` above sea level; or, with no point, at the vehicle's own position. */
export function setHome(at: { lat: number; lon: number; altMslM: number } | null): CommandIntSpec {
  return at
    ? { command: MAV_CMD_DO_SET_HOME, frame: MAV_FRAME_GLOBAL, params: [0, 0, 0, 0, e7(at.lat), e7(at.lon), at.altMslM], label: `Set home (${at.lat.toFixed(5)}, ${at.lon.toFixed(5)})` }
    : { command: MAV_CMD_DO_SET_HOME, frame: MAV_FRAME_GLOBAL, params: [1, 0, 0, 0, 0, 0, 0], label: 'Set home to the vehicle position' };
}
