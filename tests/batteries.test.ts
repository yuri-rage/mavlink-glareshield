/**
 * Several battery monitors (BATTERY_STATUS id 0, 1, ...): kept apart in the telemetry store (the primary battery is
 * id 0 only) and in the message cache (BATTERY_STATUS_2 for id 1), and a binding to another pack asks for
 * BATTERY_STATUS. Frames packed by pymavlink.
 *
 * Run: npx tsx tests/batteries.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { MavlinkParser } = await import('../src/mavlink/parser.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
const cache = await import('../src/lib/messageCache.ts');
const { requiredMessageIds } = await import('../src/components/widgets/custom/panelModel.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];
const b0 = frame('fd240000000101930000b004000000000000c4093831ffffffffffffffffffffffffffffffffffff1a0400000150dc7f'); // id 0: 12.6 V, 10.5 A, 1200 mAh, 80 %, 25.0 C
const b1 = frame('fd2400000001019300002c010000000000001c0c7062ffffffffffffffffffffffffffffffffffffa40101000123cff5'); // id 1: 25.2 V, 4.2 A, 300 mAh, 35 %, 31.0 C

const st = () => useTelemetryStore.getState();
st().processPacket(b0);
st().processPacket(b1);
st().processPacket(b1);
check('the primary battery is battery 0 only (battery 1 doesn\'t overwrite it)', st().battery.current === 10.5 && st().battery.consumedMah === 1200 && st().battery.remaining === 80, JSON.stringify(st().battery));
const p1 = st().batteries[1];
check('battery 1 kept apart, with its own numbers', p1 && p1.voltage === 25.2 && p1.current === 4.2 && p1.consumedMah === 300 && p1.remaining === 35 && p1.temperature === 31, JSON.stringify(p1));
check('battery 0 also listed', st().batteries[0]?.voltage === 12.6 && st().batteries[0]?.temperature === 25);

cache.resetMessageCache();
cache.recordPacket(b0, 1000);
cache.recordPacket(b1, 2000);
check('cache: BATTERY_STATUS is battery 0, BATTERY_STATUS_2 is battery 1', cache.getCachedField('BATTERY_STATUS', 'current_consumed') === 1200 && cache.getCachedField('BATTERY_STATUS_2', 'current_consumed') === 300);
check('cache: battery 1 reporting doesn\'t freshen battery 0\'s bindings', cache.getLastSeen('BATTERY_STATUS') === 1000 && cache.getLastSeen('BATTERY_STATUS_2') === 2000);
const def = { id: 'w', name: 'W', category: 'telemetry', displayType: 'stat-card', binding: { messageName: 'BATTERY_STATUS_2', fieldName: 'current_consumed' } } as any;
check('a binding to another pack asks for BATTERY_STATUS', requiredMessageIds(def).includes(MAVLINK_MSG_ID.BATTERY_STATUS), JSON.stringify(requiredMessageIds(def)));

console.log(failures.length ? `\n${failures.length} battery check(s) FAILED` : '\nAll battery checks PASSED');
process.exit(failures.length ? 1 : 0);
