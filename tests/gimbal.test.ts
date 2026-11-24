/**
 * Gimbal checks: the gimbal manager messages (frames packed by pymavlink), the pointing command parameters, when
 * pointing at a place turns the vehicle, where the camera's centre ray meets the ground, and when a gimbal counts as
 * enabled.
 *
 * Run: npx tsx tests/gimbal.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
const g = await import('../src/mavlink/gimbal.ts');
const { gimbalEnabled } = await import('../src/store/gimbalStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];

{
  const p = frame('fd210000000101180100e8030000230502000000000000000000db0fc9bf920a063fc2b832c0c2b83240015ec4');
  const d = p && decodePayload(p.messageId, p.payload);
  check('GIMBAL_MANAGER_INFORMATION decoded (CRC seed known)', p?.messageId === 280 && d.gimbal_device_id === 1 && (d.cap_flags & g.GIMBAL_CAP.HAS_YAW_AXIS) !== 0 && near(d.pitch_min, -90) && near(d.pitch_max, 30) && near(d.yaw_min, -160), JSON.stringify(d));
  const q = frame('fd0b0000000101190100d00700001c00000001ffbe514d');
  const s = q && decodePayload(q.messageId, q.payload);
  check('GIMBAL_MANAGER_STATUS decoded: yaw lock flag, device id', q?.messageId === 281 && (s.flags & g.GIMBAL_FLAGS.YAW_LOCK) !== 0 && s.gimbal_device_id === 1 && s.primary_control_sysid === 255, JSON.stringify(s));
}

// Commands
{
  const p = g.pitchYawParams({ deviceId: 1, pitchDeg: -45, yawDeg: 20, yawLock: true });
  check('pitch/yaw: angles, rates unset, yaw-lock flag in param5, device id in param7', p[0] === -45 && p[1] === 20 && Number.isNaN(p[2]) && Number.isNaN(p[3]) && p[4] === 16 && p[6] === 1);
  const r = g.pitchYawParams({ deviceId: 2, retract: true });
  check('retract: angles unset, retract flag', Number.isNaN(r[0]) && Number.isNaN(r[1]) && r[4] === 1 && r[6] === 2);
  const f = g.pitchYawParams({ deviceId: 1, yawLock: false });
  check('follow (yaw lock off, no angles): every value unset, no flags', [0, 1, 2, 3].every((i) => Number.isNaN(f[i])) && f[4] === 0);
}

// Pointing at a place turns the vehicle
check('Copter, gimbal without pan: turns', g.roiTurnsVehicle('copter', 1 | 2 | 32));
check('Copter, gimbal with pan: doesn\'t', !g.roiTurnsVehicle('copter', 256));
check('Copter, capabilities unknown: assume it turns (ask first)', g.roiTurnsVehicle('copter', null));
check('Plane or Rover: never', !g.roiTurnsVehicle('plane', null) && !g.roiTurnsVehicle('rover', 0));

// Where the camera looks
{
  const at = { lat: 35, lon: -106 };
  const a = g.aimPoint({ ...at, heightM: 100, pitchDeg: -45, headingDeg: 90 });
  check('45° down from 100 m: ground 100 m ahead (east)', a.ground && near(a.distanceM, 100, 0.01) && near(a.lat, 35, 1e-9) && a.lon > -106, JSON.stringify(a));
  const d = g.aimPoint({ ...at, heightM: 50, pitchDeg: -90, headingDeg: 0 });
  check('straight down: right below', d.ground && d.distanceM < 1e-6);
  const h = g.aimPoint({ ...at, heightM: 50, pitchDeg: 0, headingDeg: 0, maxM: 1000 });
  check('level: no ground, line to the limit', !h.ground && near(h.distanceM, 1000));
  const far = g.aimPoint({ ...at, heightM: 100, pitchDeg: -2, headingDeg: 0, maxM: 1000 });
  check('nearly level: ground beyond the limit, stops at it', !far.ground && near(far.distanceM, 1000));
  check('heading: relative yaw adds to the vehicle\'s, earth-frame yaw is its own', g.gimbalHeading(30, false, 350) === 20 && g.gimbalHeading(30, true, 350) === 30);
}

// Enabled
{
  const now = 100_000;
  check('mount type set: enabled', gimbalEnabled({ mountTypes: [1, 0], info: null, attitude: null }, now));
  check('no mount type, no reports: not enabled', !gimbalEnabled({ mountTypes: [0, 0], info: null, attitude: null }, now));
  check('a fresh attitude report: enabled (e.g. a MAVLink gimbal before the params arrive)', gimbalEnabled({ mountTypes: [], info: null, attitude: { pitch: 0, yaw: 0, earthFrame: false, at: now - 1000 } }, now));
  check('an old attitude report alone: not enabled', !gimbalEnabled({ mountTypes: [0], info: null, attitude: { pitch: 0, yaw: 0, earthFrame: false, at: now - 10_000 } }, now));
}

console.log(failures.length ? `\n${failures.length} gimbal check(s) FAILED` : '\nAll gimbal checks PASSED');
process.exit(failures.length ? 1 : 0);
