// Input units: what fields show and send, and how command params are read from their labels.
import { lengthUnit, speedUnit, paramUnitKind, relabel, RAW_LENGTH } from '../src/lib/inputUnits.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const near = (a: number, b: number, t = 1e-9) => Math.abs(a - b) <= t;

const ft = lengthUnit('kts');
check('mph / kts: lengths in feet', ft.unit === 'ft' && lengthUnit('mph').unit === 'ft' && near(ft.fromSi(100), 328.084, 1e-6));
check('feet round-trip to metres', near(ft.toSi(ft.fromSi(37.5)), 37.5));
check('m/s and km/h: lengths in metres, unchanged', lengthUnit('ms').unit === 'm' && lengthUnit('kmh').fromSi(12.3) === 12.3);
check('speed in the chosen unit', speedUnit('kts').unit === 'kts' && near(speedUnit('kts').fromSi(10), 19.4384) && near(speedUnit('kmh').toSi(36), 10) && near(speedUnit('mph').fromSi(1), 2.23694));
check('a loiter radius keeps its sign (direction)', near(ft.toSi(-328.084), -100, 1e-6));
check('raw: metres as stored', RAW_LENGTH.unit === 'm' && RAW_LENGTH.fromSi(5) === 5);

check('"Accept radius (m)" is a length', paramUnitKind('Accept radius (m)') === 'length');
check('"Speed (m/s)" is a speed', paramUnitKind('Speed (m/s)') === 'speed');
check('time, angle, % and plain labels are left alone', ['Hold (s)', 'Yaw (°)', 'Throttle (%, -1 no change)', 'Turns', 'Delay (s)'].every((l) => paramUnitKind(l) === null));
check('"Distance (m, 0 stops)" is a length too', paramUnitKind('Distance (m, 0 stops)') === 'length');
check('relabel keeps the rest: (ft, 0 stops)', relabel('Distance (m, 0 stops)', 'ft') === 'Distance (ft, 0 stops)', relabel('Distance (m, 0 stops)', 'ft'));
check('"(ms)" (shutter time) is not metres', paramUnitKind('Shutter (ms)') === null);
check('relabel: (m) to (ft), (m/s) to (kts)', relabel('Abort alt (m)', 'ft') === 'Abort alt (ft)' && relabel('Speed (m/s)', 'kts') === 'Speed (kts)');

console.log(failures.length ? `\n${failures.length} input-unit check(s) FAILED` : '\nAll input-unit checks PASSED');
if (failures.length) process.exit(1);
