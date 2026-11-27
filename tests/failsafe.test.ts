// The HUD failsafe banner from STATUSTEXT, over the log as the store keeps it (newest first).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { appendStatusMessage } = await import('../src/store/telemetryStore.ts');
const { isFailsafeActive } = await import('../src/lib/failsafe.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures.push(name);
};
// Wall-clock times: a timestamp of 0 is treated as unknown, which would hide the bug this guards against.
const T0 = 1_780_000_000_000;
const hb = { systemStatus: 4, modeName: 'LOITER' };
const crit = (text: string) => ({ severity: 2, severityLabel: 'CRITICAL', text });
const info = (text: string) => ({ severity: 6, severityLabel: 'INFO', text });

// The boot banner long ago, then a failsafe now: the banner's age mustn't end the search before the newest line.
let log = appendStatusMessage([], info('ArduCopter V4.6.0'), T0);
log = appendStatusMessage(log, info('Frame: QUAD/X'), T0 + 10);
const t = T0 + 600_000;
log = appendStatusMessage(log, crit('Radio Failsafe'), t);
check('failsafe now, boot banner 10 min old: banner up', isFailsafeActive(hb, log, t + 1000));

// Cleared after: the newer line wins.
log = appendStatusMessage(log, crit('Radio Failsafe Cleared'), t + 5000);
check('failsafe then cleared: banner down', !isFailsafeActive(hb, log, t + 6000));

// A new failsafe after the clear: up again.
log = appendStatusMessage(log, crit('Battery Failsafe'), t + 8000);
check('cleared then a new failsafe: banner up', isFailsafeActive(hb, log, t + 9000));

// Unrelated lines after it don't hide it.
log = appendStatusMessage(log, info('EKF3 IMU0 is using GPS'), t + 9500);
check('newer unrelated line: still up', isFailsafeActive(hb, log, t + 10_000));

// Past the window: down.
check('failsafe 31 s old: banner down', !isFailsafeActive(hb, log, t + 8000 + 31_000));

// Within 30 s of boot, a failsafe cleared: an older event mustn't outrank the newer clear.
let early = appendStatusMessage([], info('ArduCopter V4.6.0'), T0);
early = appendStatusMessage(early, crit('GCS Failsafe'), T0 + 1000);
early = appendStatusMessage(early, crit('GCS Failsafe Cleared'), T0 + 2000);
check('event then clear, both recent: banner down', !isFailsafeActive(hb, early, T0 + 3000));

// The heartbeat's own state still counts on its own.
check('MAV_STATE_CRITICAL: banner up', isFailsafeActive({ systemStatus: 5 }, [], 0));

console.log(failures.length ? `\n${failures.length} failsafe check(s) FAILED` : '\nAll failsafe checks PASSED');
if (failures.length) process.exit(1);
