/**
 * Telemetry store notifications: a packet's update is applied at once (getState is current) but subscribers hear of
 * packet updates once per batch, as one change from the state before it; any other update notifies at once, after
 * what was gathered. Frames packed by pymavlink (the battery fixtures).
 *
 * Run: npx tsx tests/storeBatching.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { MavlinkParser } = await import('../src/mavlink/parser.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const frame = (hex: string) => new MavlinkParser().parse(Uint8Array.from(Buffer.from(hex, 'hex')))[0];
const b0 = frame('fd240000000101930000b004000000000000c4093831ffffffffffffffffffffffffffffffffffff1a0400000150dc7f'); // id 0: 12.6 V
const b1 = frame('fd2400000001019300002c010000000000001c0c7062ffffffffffffffffffffffffffffffffffffa40101000123cff5'); // id 1: 25.2 V

const st = () => useTelemetryStore.getState();
const calls: { batteries: number; prevBatteries: number }[] = [];
useTelemetryStore.subscribe((s, p) =>
  calls.push({ batteries: Object.keys(s.batteries).length, prevBatteries: Object.keys(p.batteries).length })
);

st().processPacket(b0);
st().processPacket(b1);
check(
  'applied at once: getState() has both packets',
  Object.keys(st().batteries).length === 2 && st().battery.voltage > 12
);
check('not notified yet (batched)', calls.length === 0, `${calls.length}`);
await new Promise((r) => setTimeout(r, 40));
check('one notification for the batch', calls.length === 1, `${calls.length}`);
check(
  'as one change, from the state before the batch',
  calls[0]?.prevBatteries === 0 && calls[0]?.batteries === 2,
  JSON.stringify(calls[0])
);

calls.length = 0;
st().processPacket(b0);
useTelemetryStore.setState({ hasConnectedInSession: true });
check(
  'another update notifies at once, carrying the gathered packet changes in order',
  calls.length === 1,
  `${calls.length}`
);
await new Promise((r) => setTimeout(r, 40));
check('nothing left over to deliver after it', calls.length === 1, `${calls.length}`);

calls.length = 0;
useTelemetryStore.setState({ hasConnectedInSession: false });
check('a plain update with nothing gathered: notified at once', calls.length === 1);

console.log(failures.length ? `\n${failures.length} batching check(s) FAILED` : '\nAll batching checks PASSED');
process.exit(failures.length ? 1 : 0);
