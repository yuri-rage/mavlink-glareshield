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
const c = new InspectorCollector(
  (fn) => ((listener = fn), subs++, () => ((listener = null), subs--)),
  () => now
);
const pkt = (sys: number, comp: number, id: number) => ({
  version: 2,
  sequence: 0,
  systemId: sys,
  componentId: comp,
  messageId: id,
  payload: new Uint8Array([id]),
  crc: 0,
  raw: new Uint8Array(),
});

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
check(
  'counted per system, component and message',
  att.count === 20 && c.entries.get('1:1:0')!.count === 4 && c.entries.has('1:154:285')
);
check(
  'rate: ~10 Hz and ~2 Hz',
  Math.abs(c.rate(att) - 10) < 1 && Math.abs(c.rate(c.entries.get('1:1:0')!) - 2) < 0.6,
  `${c.rate(att)}, ${c.rate(c.entries.get('1:1:0')!)}`
);
check('last payload kept', att.lastPayload[0] === 30);
now += 6000;
check('a message that stopped coming: 0 Hz', c.rate(att) === 0);
c.setPaused(true);
listener!(pkt(1, 1, 30));
check('paused: nothing changes', att.count === 20);
c.setPaused(false);
c.clear();
check('clear', c.entries.size === 0);
// Steady streams: rates hold between arrivals (no flicker), slow ones keep their rate, pause freezes, stops decay.
{
  c.clear();
  const feed = (id: number, everyMs: number, untilMs: number) => {
    const end = now + untilMs;
    const ids: number[] = [];
    for (let at = now; at <= end; at += everyMs) ids.push(at);
    return ids.map((at) => ({ at, id }));
  };
  const events = [...feed(0, 1000, 20_000), ...feed(1, 4000, 20_000)].sort((a, b) => a.at - b.at);
  const start = now;
  const seen1: number[] = [];
  const seen4: number[] = [];
  for (let t = start; t <= start + 20_000; t += 100) {
    now = t;
    for (const ev of events.filter((e) => e.at === t)) listener!(pkt(1, 1, ev.id));
    if (t > start + 8000) {
      seen1.push(c.rate(c.entries.get('1:1:0')!));
      seen4.push(c.rate(c.entries.get('1:1:1')!));
    }
  }
  const range = (xs: number[]) => `${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)}`;
  check(
    'a steady 1 Hz stream reads 1.0 Hz throughout (no 0.8 flicker)',
    seen1.every((r) => Math.abs(r - 1) < 0.01),
    range(seen1)
  );
  check(
    'a steady 0.25 Hz stream reads 0.25 Hz (no jump to 1 Hz)',
    seen4.every((r) => Math.abs(r - 0.25) < 0.01),
    range(seen4)
  );
  c.setPaused(true);
  const frozen = c.rate(c.entries.get('1:1:0')!);
  now += 8000;
  check(
    'paused: rates and ages stay as they were',
    c.rate(c.entries.get('1:1:0')!) === frozen && c.clock() === now - 8000
  );
  c.setPaused(false);
  now -= 8000;
  const r0 = c.rate(c.entries.get('1:1:0')!);
  now += 2500;
  const r1 = c.rate(c.entries.get('1:1:0')!);
  now += 2000;
  const r2 = c.rate(c.entries.get('1:1:0')!);
  check(
    'a stream that stops: the rate falls away, then 0',
    r1 < r0 && r2 < r1 && ((now += 2000), c.rate(c.entries.get('1:1:0')!)) === 0,
    `${r0.toFixed(2)} ${r1.toFixed(2)} ${r2.toFixed(2)}`
  );
}

stopA();
check('still collecting while one Inspector is open', subs === 1 && listener !== null);
stopB();
stopB();
check('stops when the last closes (a second stop is harmless)', subs === 0 && listener === null);

console.log(failures.length ? `\n${failures.length} inspector check(s) FAILED` : '\nAll inspector checks PASSED');
process.exit(failures.length ? 1 : 0);
