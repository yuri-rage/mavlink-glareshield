// The compare dialog's rules: which file parameters differ, are missing or unread, and what a write came to.
import { compareParams, filterEntries, writeOutcome } from '../src/lib/paramCompare.ts';
import type { ParamMeta } from '../src/mavlink/paramMetadata.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const META: Record<string, ParamMeta> = {
  WPNAV_SPEED: { description: 'Waypoint horizontal speed', units: 'cm/s' },
  STAT_RUNTIME: { description: 'Total runtime', readOnly: true },
  GPS_TYPE: { description: 'GPS type', rebootRequired: true },
};
const meta = (n: string) => META[n];
const vehicle = {
  WPNAV_SPEED: { value: 1000, defaultValue: 1000 },
  STAT_RUNTIME: { value: 5 },
  GPS_TYPE: { value: 1 },
  FENCE_ENABLE: { value: 0 },
  ARMING_CHECK: { value: 1 },
};
const file = { WPNAV_SPEED: 750, STAT_RUNTIME: 99, GPS_TYPE: 2, FENCE_ENABLE: 0, Q_ENABLE: 1 };

let r = compareParams(file, vehicle, true, meta);
const by = (n: string) => r.entries.find((e) => e.name === n)!;
check('same values are counted, not listed', r.same === 1 && !r.entries.some((e) => e.name === 'FENCE_ENABLE'));
check(
  'differs: vehicle, file and default shown, writable',
  by('WPNAV_SPEED').status === 'differs' &&
    by('WPNAV_SPEED').vehicle === 1000 &&
    by('WPNAV_SPEED').defaultValue === 1000 &&
    by('WPNAV_SPEED').writable &&
    by('WPNAV_SPEED').units === 'cm/s'
);
check('read-only: listed, not writable', by('STAT_RUNTIME').readOnly && !by('STAT_RUNTIME').writable);
check('reboot required flagged', by('GPS_TYPE').rebootRequired);
check(
  'full list read and not in it: missing, not writable',
  by('Q_ENABLE').status === 'missing' && !by('Q_ENABLE').writable
);
check("the vehicle's parameters the file doesn't mention counted", r.notInFile === 1, String(r.notInFile));
r = compareParams(file, vehicle, false, meta);
check(
  'list not complete: unread, writable',
  r.entries.find((e) => e.name === 'Q_ENABLE')!.status === 'unread' &&
    r.entries.find((e) => e.name === 'Q_ENABLE')!.writable
);
check('sorted by name', r.entries.map((e) => e.name).join() === [...r.entries.map((e) => e.name)].sort().join());

check('write echoed with the value: ok', writeOutcome(750, 750) === 'ok');
check('float32 round trip (0.1 -> 0.100000001): ok', writeOutcome(0.1, Math.fround(0.1)) === 'ok');
check('another value echoed (refused or clamped): kept', writeOutcome(750, 1000) === 'kept');
check('no echo: no answer', writeOutcome(750, undefined) === 'no-answer');

check(
  'filter by name or description',
  filterEntries(r.entries, 'speed', meta)
    .map((e) => e.name)
    .join() === 'WPNAV_SPEED' &&
    filterEntries(r.entries, 'gps', meta)
      .map((e) => e.name)
      .join() === 'GPS_TYPE' &&
    filterEntries(r.entries, '', meta).length === r.entries.length
);

console.log(failures.length ? `\n${failures.length} compare check(s) FAILED` : '\nAll compare checks PASSED');
process.exit(failures.length ? 1 : 0);
