// The desktop app's UDP link replies to vehicles (desktop/udpVehicles.ts): which datagrams hold a vehicle's
// HEARTBEAT, so another program's packets on the port (a GCS, a gimbal) don't redirect the replies.
export {};
const { hasVehicleHeartbeat } = await import('../desktop/udpVehicles.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
};

/** A HEARTBEAT payload: custom_mode (4), type, autopilot, base_mode, system_status, mavlink_version. */
const hb = (type: number) => new Uint8Array([0, 0, 0, 0, type, 3, 0x51, 4, 3]);
const v2 = (msgId: number, payload: Uint8Array) => new MavlinkEncoder(1, 1).packV2(msgId, payload);
/** A MAVLink 1 frame (the checksum isn't checked here). */
const v1 = (msgId: number, payload: Uint8Array) =>
  new Uint8Array([0xfe, payload.length, 0, 1, 1, msgId, ...payload, 0, 0]);
const cat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((p) => [...p]));

check('a quadcopter heartbeat (MAVLink 2): a vehicle', hasVehicleHeartbeat(v2(0, hb(2))));
check('a plane heartbeat (MAVLink 1): a vehicle', hasVehicleHeartbeat(v1(0, hb(1))));
check('a ground station heartbeat: not a vehicle', !hasVehicleHeartbeat(v2(0, hb(6))));
check('a gimbal heartbeat: not a vehicle', !hasVehicleHeartbeat(v2(0, hb(26))));
check('other messages only: not a vehicle', !hasVehicleHeartbeat(v2(30, new Uint8Array(28))));
check(
  'several frames in one datagram, the heartbeat second',
  hasVehicleHeartbeat(cat(v2(30, new Uint8Array(28)), v2(0, hb(2))))
);
check(
  'a GCS heartbeat then attitude: not a vehicle',
  !hasVehicleHeartbeat(cat(v2(0, hb(6)), v2(30, new Uint8Array(28))))
);
check('junk and a truncated frame: no throw, not a vehicle', !hasVehicleHeartbeat(new Uint8Array([0x12, 0xfd, 9, 0])));
check('empty: not a vehicle', !hasVehicleHeartbeat(new Uint8Array(0)));

// A datagram cut short (its length says more than it holds) is not read past its end: not a vehicle.
const whole = v2(0, hb(2));
check('a heartbeat cut short: not a vehicle', !hasVehicleHeartbeat(whole.slice(0, 12)));
// A component that isn't an autopilot (MAV_AUTOPILOT_INVALID, 8), even of a vehicle-looking type: not a vehicle.
const peripheral = new Uint8Array([0, 0, 0, 0, 0, 8, 0, 4, 3]); // type 0 (generic), autopilot 8
check('MAV_AUTOPILOT_INVALID: not a vehicle', !hasVehicleHeartbeat(v2(0, peripheral)));
check('MAV_AUTOPILOT_INVALID (MAVLink 1): not a vehicle', !hasVehicleHeartbeat(v1(0, peripheral)));

console.log(failures.length ? `\n${failures.length} UDP vehicle check(s) FAILED` : '\nAll UDP vehicle checks PASSED');
process.exit(failures.length ? 1 : 0);
