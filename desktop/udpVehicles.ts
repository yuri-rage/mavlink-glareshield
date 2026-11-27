// Which UDP senders are vehicles: the desktop app's UDP link replies to the endpoints vehicle heartbeats come from
// (desktop/main.ts), as the bridge does (bridge.py), so another program's packets on the port don't redirect them.

/** A UDP endpoint counts as a vehicle while its heartbeats keep coming (as the bridge, bridge.py). */
export const UDP_VEHICLE_TIMEOUT_MS = 10_000;
/** MAV_TYPEs that aren't vehicles: GCS, onboard controller, gimbal, ADS-B, camera, charging station, ... */
const NON_VEHICLE_TYPES = new Set([6, 18, 26, 27, 30, 31, 33, 34]);

/** Whether a datagram holds a HEARTBEAT (MAVLink 1 or 2) from a vehicle (not a GCS, gimbal, camera, ...). */
export function hasVehicleHeartbeat(b: Uint8Array): boolean {
  let i = 0;
  while (i < b.length) {
    if (b[i] === 0xfd && i + 10 <= b.length) {
      const len = b[i + 1];
      const signed = (b[i + 2] & 1) !== 0;
      const msgId = b[i + 7] | (b[i + 8] << 8) | (b[i + 9] << 16);
      // MAVLink 2 trims trailing zero bytes: a missing type byte is 0 (generic, a vehicle).
      if (msgId === 0) {
        const type = len > 4 ? b[i + 10 + 4] : 0;
        if (!NON_VEHICLE_TYPES.has(type)) return true;
      }
      i += 10 + len + 2 + (signed ? 13 : 0);
    } else if (b[i] === 0xfe && i + 6 <= b.length) {
      const len = b[i + 1];
      if (b[i + 5] === 0 && len >= 5 && !NON_VEHICLE_TYPES.has(b[i + 6 + 4])) return true;
      i += 6 + len + 2;
    } else {
      i++;
    }
  }
  return false;
}
