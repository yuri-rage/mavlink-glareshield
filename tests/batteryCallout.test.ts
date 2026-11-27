// Battery callouts and the remaining % as the store keeps it: -1 is unknown (MAVLink's value with no capacity set),
// apart from a real 0%, which is critical.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { decideBatteryCallout, batteryWarnedAt } = await import('../src/lib/audioAlerts.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const say = (r: number, w: 'none' | 'low' | 'critical' = 'none') => decideBatteryCallout(r, w);

check('0% is critical', say(0).speak === 'critical');
check('connected at 0%: critical once', say(0).warned === 'critical' && say(0, 'critical').speak === null);
check('-1 (unknown) says nothing', say(-1).speak === null && say(-1, 'low').warned === 'low');
check('NaN says nothing', say(NaN).speak === null);
check('15% critical, 16% low', say(15).speak === 'critical' && say(16).speak === 'low');
check('low then critical', say(14, 'low').speak === 'critical');
check('low once', say(20, 'low').speak === null);
check('re-arms above 30%', say(31, 'critical').warned === 'none' && say(28, 'critical').warned === 'critical');
check('seek to 0%: already critical', batteryWarnedAt(0) === 'critical');
check('seek to unknown: none', batteryWarnedAt(-1) === 'none');

check('store starts unknown (-1), not 0%', useTelemetryStore.getState().battery.remaining === -1);

// A disconnect forgets the pack: the next vehicle's unreported % mustn't be this one's.
useTelemetryStore.setState({
  battery: { voltage: 12.4, current: 3, remaining: 42, consumedMah: 900, cellVoltages: [] },
});
(mavlinkConnection as any).setStatus('connected');
(mavlinkConnection as any).setStatus('disconnected');
const after = useTelemetryStore.getState().battery;
check('disconnect: battery reset', after.remaining === -1 && after.voltage === 0, JSON.stringify(after));

console.log(failures.length ? `\n${failures.length} battery check(s) FAILED` : '\nAll battery checks PASSED');
process.exit(failures.length ? 1 : 0);
