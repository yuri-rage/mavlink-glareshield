/**
 * MAVLink Inspector collector: counts and rates per system/component/message, a message that stops coming, pause,
 * clear, and collecting only while some Inspector is open.
 *
 * Run: npx tsx tests/inspector.test.ts
 */
export {};
const { InspectorCollector } = await import('../src/lib/mavlinkInspector.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
let now = 100_000;
let listener: ((p: any) => void) | null = null;
let subs = 0;
const c = new InspectorCollector((fn) => ((listener = fn), subs++, () => ((listener = null), subs--)), () => now);
const pkt = (sys: number, comp: number, id: number) => ({ version: 2, sequence: 0, systemId: sys, componentId: comp, messageId: id, payload: new Uint8Array([id]), crc: 0, raw: new Uint8Array() });

const stopA = c.start();
const stopB = c.start();
check('one subscription for two Inspectors', subs === 1);
for (let i = 0; i < 20; i++) {
  listener!(pkt(1, 1, 30)); // ATTITUDE at 10 Hz
  if (i % 5 === 0) listener!(pkt(1, 1, 0)); // HEARTBEAT at 2 Hz
  now += 100;
}
listener!(pkt(1, 154, 285)); // a gimbal component
const att = c.entries.get('1:1:30')!;
check('counted per system, component and message', att.count === 20 && c.entries.get('1:1:0')!.count === 4 && c.entries.has('1:154:285'));
check('rate: ~10 Hz and ~2 Hz', Math.abs(c.rate(att) - 10) < 1 && Math.abs(c.rate(c.entries.get('1:1:0')!) - 2) < 0.6, `${c.rate(att)}, ${c.rate(c.entries.get('1:1:0')!)}`);
check('last payload kept', att.lastPayload[0] === 30);
now += 6000;
check('a message that stopped coming: 0 Hz', c.rate(att) === 0);
c.paused = true;
listener!(pkt(1, 1, 30));
check('paused: nothing changes', att.count === 20);
c.paused = false;
c.clear();
check('clear', c.entries.size === 0);
stopA();
check('still collecting while one Inspector is open', subs === 1 && listener !== null);
stopB();
stopB();
check('stops when the last closes (a second stop is harmless)', subs === 0 && listener === null);

console.log(failures.length ? `\n${failures.length} inspector check(s) FAILED` : '\nAll inspector checks PASSED');
process.exit(failures.length ? 1 : 0);
