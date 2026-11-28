// Which UDP senders are vehicles: the desktop app's UDP link replies to the endpoints vehicle heartbeats come from
// (desktop/main.ts), as the bridge does (bridge.py), so another program's packets on the port don't redirect them.

/** A UDP endpoint counts as a vehicle while its heartbeats keep coming (as the bridge, bridge.py). */
export const UDP_VEHICLE_TIMEOUT_MS = 10_000;
/** MAV_TYPEs that aren't vehicles: GCS, onboard controller, gimbal, ADS-B, camera, charging station, ... */
const NON_VEHICLE_TYPES = new Set([6, 18, 26, 27, 30, 31, 33, 34]);

/** MAV_AUTOPILOT_INVALID: a component that isn't an autopilot (as bridge.py also excludes). */
const AUTOPILOT_INVALID = 8;

/**
 * Whether a datagram holds a HEARTBEAT (MAVLink 1 or 2) from a vehicle: an autopilot (not MAV_AUTOPILOT_INVALID) of a
 * vehicle type (not a GCS, gimbal, camera, ...). A frame cut short by the datagram's end is not read.
 */
export function hasVehicleHeartbeat(b: Uint8Array): boolean {
  let i = 0;
  while (i < b.length) {
    if (b[i] === 0xfd && i + 10 <= b.length) {
      const len = b[i + 1];
      const signed = (b[i + 2] & 1) !== 0;
      if (i + 10 + len > b.length) return false; // truncated
      const msgId = b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16);
      // MAVLink 2 trims trailing zero bytes: a byte past the payload's length is 0.
      if (msgId === 0) {
        const type = len > 4 ? b[i + 14] : 0;
        const autopilot = len > 5 ? b[i + 15] : 0;
        if (!NON_VEHICLE_TYPES.has(type) && autopilot !== AUTOPILOT_INVALID) return true;
      }
      i += 10 + len + 2 + (signed ? 13 : 0);
    } else if (b[i] === 0xfe && i + 6 <= b.length) {
      const len = b[i + 1];
      if (i + 6 + len > b.length) return false; // truncated
      if (b[i + 5] === 0 && len >= 6 && !NON_VEHICLE_TYPES.has(b[i + 10]) && b[i + 11] !== AUTOPILOT_INVALID)
        return true;
      i += 6 + len + 2;
    } else {
      i++;
    }
  }
  return false;
}
