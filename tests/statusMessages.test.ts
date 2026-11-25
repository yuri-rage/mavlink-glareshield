// How the message log merges repeats (appendStatusMessage in src/store/telemetryStore.ts).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { appendStatusMessage } = await import('../src/store/telemetryStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const info = (text: string) => ({ severity: 6, severityLabel: 'INFO', text });
const warn = (text: string) => ({ severity: 4, severityLabel: 'WARNING', text });
let log = appendStatusMessage([], info('ArduPlane V4.8.0-dev'), 1000);
log = appendStatusMessage(log, info('eb2eb3e1'), 1010);
// The banner again (a MAVFTP read of the parameter file): counted, not listed twice.
log = appendStatusMessage(log, info('ArduPlane V4.8.0-dev'), 2000);
log = appendStatusMessage(log, info('eb2eb3e1'), 2010);
check(
  'banner repeated within 10 s: two lines, each counted twice',
  log.length === 2 && log.every((m) => m.count === 2),
  JSON.stringify(log.map((m) => [m.text, m.count]))
);
// Much later: listed again.
log = appendStatusMessage(log, info('ArduPlane V4.8.0-dev'), 20_000);
check('the same line much later is listed again', log.length === 3 && log[0].count === 1);
// A warning repeated a few lines back comes to the top again.
log = appendStatusMessage(log, warn('PreArm: Throttle below failsafe'), 21_000);
log = appendStatusMessage(log, info('something'), 21_100);
log = appendStatusMessage(log, warn('PreArm: Throttle below failsafe'), 21_200);
check(
  'a repeated warning is listed at the top again',
  log[0].text.startsWith('PreArm') && log[0].count === 1 && log.length === 6,
  JSON.stringify(log.map((m) => m.text))
);
// Consecutive repeats still merge as before.
log = appendStatusMessage(log, warn('PreArm: Throttle below failsafe'), 21_300);
check('consecutive repeats merge at the top', log.length === 6 && log[0].count === 2);
console.log(
  failures.length ? `\n${failures.length} status-message check(s) FAILED` : '\nAll status-message checks PASSED'
);
if (failures.length) process.exit(1);
