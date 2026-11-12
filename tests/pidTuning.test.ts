/**
 * PID_TUNING: per-vehicle controller lists, trimming by the firmware's GCS_PID_MASK bitmask, the mask bit
 * helpers, per-axis caching for custom bindings, and the arrival-time recorder behind the PID tuning chart.
 * (Wire decoding is checked against pymavlink in golden.test.ts.)
 *
 * Run: npx tsx tests/pidTuning.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { pidControllersFor, pidPickerAxes, maskHasBit, withMaskBit, pidAxisMessageName } = await import('../src/mavlink/pidTuning.ts');
const { pidTuningRecorder, PID_GAP_MS } = await import('../src/lib/pidTuningRecorder.ts');
const { recordPacket, getCachedField, getObservedCatalog, resetMessageCache } = await import('../src/lib/messageCache.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { requiredMessageIds } = await import('../src/components/widgets/custom/panelModel.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const labels = (cs: { label: string }[]) => cs.map((c) => c.label).join(',');
const pairs = (cs: { axis: number; bit: number }[]) => cs.map((c) => `${c.bit}:${c.axis}`).join(',');

// ------------------------------------------------------------------------------------------------
// Controllers per vehicle type
// ------------------------------------------------------------------------------------------------
check('copter: roll, pitch, yaw, accel Z on bits 0-3 as axes 1-4', pairs(pidControllersFor('copter')) === '0:1,1:2,2:3,3:4', labels(pidControllersFor('copter')));
check('sub: roll, pitch, yaw only', pairs(pidControllersFor('sub')) === '0:1,1:2,2:3', pairs(pidControllersFor('sub')));
check(
  'plane: steering is axis 5 on bit 3, landing axis 6 on bit 4',
  pairs(pidControllersFor('plane')) === '0:1,1:2,2:3,3:5,4:6',
  pairs(pidControllersFor('plane'))
);
const rover = pidControllersFor('rover');
check('rover: steering first, on bit 0 as axis 5', rover[0].label === 'Steering' && rover[0].bit === 0 && rover[0].axis === 5);
check('rover: throttle is bit 1 sent as axis 4; wheels are axes 7 and 8', pairs(rover).startsWith('0:5,1:4,2:2,3:7,4:8'), pairs(rover));
check('rover offers no roll or yaw', !/Roll|Yaw/.test(labels(rover)), labels(rover));
check('tracker: pitch on bit 0 (axis 2), yaw on bit 1 (axis 3)', pairs(pidControllersFor('tracker')) === '0:2,1:3');
check('unknown vehicles: nothing', pidControllersFor('generic').length === 0);

// The built-in lists agree with the GCS_PID_MASK bitmasks ArduPilot publishes (ParameterRepository, 4.5 / 4.6).
const published: Record<string, Record<number, string>> = {
  copter: { 0: 'Roll', 1: 'Pitch', 2: 'Yaw', 3: 'AccelZ' },
  plane: { 0: 'Roll', 1: 'Pitch', 2: 'Yaw', 3: 'Steering', 4: 'Landing' },
  rover: { 0: 'Steering', 1: 'Throttle', 2: 'Pitch', 3: 'Left Wheel', 4: 'Right Wheel', 5: 'Sailboat Heel', 6: 'Velocity North', 7: 'Velocity East' },
  sub: { 0: 'Roll', 1: 'Pitch', 2: 'Yaw' },
  tracker: { 0: 'Pitch', 1: 'Yaw' },
};
// Bits newer than the published releases (Rover's Stanley, bit 8) are only offered when the firmware's bitmask has them.
const unreleased: Record<string, number[]> = { rover: [8] };
for (const [vehicle, bits] of Object.entries(published)) {
  const ours = pidControllersFor(vehicle as any)
    .map((c) => c.bit)
    .filter((b) => !(unreleased[vehicle] ?? []).includes(b))
    .join(',');
  check(`${vehicle}: built-in bits match the published bitmask`, ours === Object.keys(bits).join(','), ours);
  const trimmed = pidControllersFor(vehicle as any, bits).map((c) => c.bit).join(',');
  check(`${vehicle}: the published bitmask keeps only its own bits`, trimmed === Object.keys(bits).join(','), trimmed);
}
const stanley = rover.find((c) => c.label === 'Stanley');
check('rover: Stanley is bit 8 sent as axis 16 (yaw angle)', stanley?.bit === 8 && stanley?.axis === 16, JSON.stringify(stanley));
const newerRover = pidControllersFor('rover', { ...published.rover, 8: 'Stanley' });
check('rover: firmware with the Stanley bit offers it', newerRover.some((c) => c.bit === 8 && c.axis === 16), labels(newerRover));
check('rover: Stanley is cached as PID_TUNING_YAW_ANGLE', pidAxisMessageName(16) === 'PID_TUNING_YAW_ANGLE');

// The firmware's bitmask (from version-matched metadata) trims the list.
const olderRover = pidControllersFor('rover', { 0: 'Steering', 1: 'Throttle', 2: 'Pitch', 3: 'Left Wheel', 4: 'Right Wheel' });
check('metadata bitmask drops controllers the firmware lacks', labels(olderRover) === 'Steering,Throttle,Pitch,Left wheel,Right wheel', labels(olderRover));
check('an empty bitmask is ignored', pidControllersFor('copter', {}).length === 4);
check('the built-in lists are not mutated by callers', (() => {
  pidControllersFor('copter')[0].label = 'X';
  return pidControllersFor('copter')[0].label === 'Roll';
})());

// Axes that arrive but aren't listed still get a button, after the listed ones.
const picker = pidPickerAxes(pidControllersFor('copter'), [3, 16, 1]);
check('picker adds unlisted arriving axes, named from the enum', labels(picker) === 'Roll,Pitch,Yaw,Accel Z,Yaw angle' && picker[4].bit === -1, labels(picker));
check('picker for a vehicle with no list shows what arrives', labels(pidPickerAxes([], [5, 99])) === 'Steer,Axis 99');

// ------------------------------------------------------------------------------------------------
// GCS_PID_MASK bits
// ------------------------------------------------------------------------------------------------
check('mask bit test', maskHasBit(5, 0) && !maskHasBit(5, 1) && maskHasBit(5, 2) && !maskHasBit(5, -1));
check('set a bit', withMaskBit(1, 3, true) === 9 && withMaskBit(9, 3, true) === 9);
check('clear a bit', withMaskBit(9, 0, false) === 8 && withMaskBit(8, 0, false) === 8);
check('a bit outside the list leaves the mask alone', withMaskBit(6, -1, true) === 6);

// ------------------------------------------------------------------------------------------------
// Per-axis cache for custom bindings
// ------------------------------------------------------------------------------------------------
function pidPacket(axis: number, desired: number, achieved: number, p = 0) {
  const payload = new Uint8Array(33);
  const dv = new DataView(payload.buffer);
  [desired, achieved, 0.1, p, 0.2, 0.3].forEach((v, i) => dv.setFloat32(i * 4, v, true));
  dv.setUint8(24, axis);
  dv.setFloat32(25, 4, true);
  dv.setFloat32(29, 1, true);
  return {
    version: 2 as const,
    sequence: 0,
    systemId: 1,
    componentId: 1,
    messageId: MAVLINK_MSG_ID.PID_TUNING,
    payload,
    crc: 0,
    raw: new Uint8Array(),
  };
}
resetMessageCache();
pidTuningRecorder.clear();
recordPacket(pidPacket(1, 10, 9), 1000);
recordPacket(pidPacket(2, -5, -4), 1010);
check('each axis is cached under its own name', getCachedField('PID_TUNING_ROLL', 'desired') === 10 && getCachedField('PID_TUNING_PITCH', 'desired') === -5);
check('names are case-insensitive for bindings', getCachedField('pid_tuning_roll', 'achieved') === 9);
check('the mixed PID_TUNING entry is not offered', !('PID_TUNING' in getObservedCatalog()) && 'PID_TUNING_ROLL' in getObservedCatalog());
check('the constant axis field is excluded from observed fields', !getObservedCatalog().PID_TUNING_ROLL.includes('axis'));
check('extension fields decode', Math.abs((getCachedField('PID_TUNING_ROLL', 'SRate') ?? 0) - 4) < 1e-6);
check('axis names follow the MAVLink enum', pidAxisMessageName(5) === 'PID_TUNING_STEER' && pidAxisMessageName(42) === 'PID_TUNING_AXIS42');
const def = {
  id: 'w',
  name: 'w',
  displayType: 'stat-card',
  binding: { messageName: 'PID_TUNING_ROLL', fieldName: 'desired' },
} as any;
check('a per-axis binding asks the vehicle for PID_TUNING', requiredMessageIds(def).includes(MAVLINK_MSG_ID.PID_TUNING), JSON.stringify(requiredMessageIds(def)));

// ------------------------------------------------------------------------------------------------
// Recorder
// ------------------------------------------------------------------------------------------------
check('recorder saw both axes', JSON.stringify(pidTuningRecorder.seenAxes()) === '[1,2]');
const rollDesired = pidTuningRecorder.ring(1, 'desired');
check('every message is stored at its arrival time', rollDesired.length === 1 && rollDesired.at(0).t === 1000 && rollDesired.at(0).v === 10);
recordPacket(pidPacket(1, 11, 10), 1040);
recordPacket(pidPacket(1, 12, 11), 1040 + PID_GAP_MS + 500);
const pts = Array.from({ length: rollDesired.length }, (_, i) => rollDesired.at(i));
check('a silence breaks the line with a gap', pts.length === 4 && Number.isNaN(pts[2].v) && pts[3].v === 12, JSON.stringify(pts));
const ach = pidTuningRecorder.ring(1, 'achieved');
check('desired and achieved stay index-aligned', ach.length === rollDesired.length && ach.at(3).t === rollDesired.at(3).t);
check('axes are independent', pidTuningRecorder.ring(2, 'desired').length === 1);
let heard = 0;
const off = pidTuningRecorder.onNewAxis(() => heard++);
recordPacket(pidPacket(1, 1, 1), 5000);
recordPacket(pidPacket(5, 1, 1), 5000);
off();
check('new-axis listeners hear only new axes', heard === 1);
recordPacket(pidPacket(0, 1, 1), 5100);
check('axis 0 (invalid) is ignored', !pidTuningRecorder.seenAxes().includes(0));
function hbPacket(type: number) {
  const payload = new Uint8Array([0, 0, 0, 0, type, 3, 0, 0, 3]);
  return { version: 2 as const, sequence: 0, systemId: 1, componentId: 1, messageId: MAVLINK_MSG_ID.HEARTBEAT, payload, crc: 0, raw: new Uint8Array() };
}
recordPacket(hbPacket(10), 5200); // Rover
recordPacket(pidPacket(5, 1, 1), 5210);
recordPacket(hbPacket(2), 5300); // Copter (different vehicle type clears the old vehicle's recorder history)
check('switching vehicle type clears previous vehicle PID history', pidTuningRecorder.seenAxes().length === 0);
recordPacket(pidPacket(1, 2, 2), 5310);
pidTuningRecorder.clear();
check('clear empties the history', pidTuningRecorder.seenAxes().length === 0 && rollDesired.length === 0);

console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nAll PID tuning checks passed');
if (failures.length) process.exit(1);
