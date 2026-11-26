// Link quality from MAVLink sequence numbers (src/mavlink/linkQuality.ts).
export {};
const { LinkQualityMeter, linkBars, linkLevel } = await import('../src/mavlink/linkQuality.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const feed = (m: InstanceType<typeof LinkQualityMeter>, seqs: number[], t0 = 0, dt = 10) =>
  seqs.forEach((s, i) => m.record(s, t0 + i * dt));

{
  const m = new LinkQualityMeter();
  check('before any packet: unknown', m.snapshot(0).quality === null);
  feed(
    m,
    Array.from({ length: 50 }, (_, i) => i)
  );
  check('every packet: 100 %', m.snapshot(500).quality === 100 && m.snapshot(500).lost === 0);
}
{
  const m = new LinkQualityMeter();
  // 0..99 with every 10th missing: 90 received, 10 lost (the first is the start, not a loss).
  feed(
    m,
    Array.from({ length: 100 }, (_, i) => i).filter((i) => i % 10 !== 5)
  );
  const s = m.snapshot(1000);
  check(
    'one in ten lost: 90 %',
    s.received === 90 && s.lost === 10 && Math.round(s.quality!) === 90,
    JSON.stringify(s)
  );
}
{
  const m = new LinkQualityMeter();
  feed(m, [250, 251, 252, 253, 254, 255, 0, 1, 3, 4]);
  const s = m.snapshot(100);
  check(
    'wraps from 255 to 0 without a loss; a skipped number counted',
    s.lost === 1 && s.received === 10,
    JSON.stringify(s)
  );
}
{
  const m = new LinkQualityMeter();
  feed(m, [10, 11, 11, 12, 13]);
  check('a duplicate is neither a packet nor 255 losses', m.snapshot(100).received === 4 && m.snapshot(100).lost === 0);
}
{
  const m = new LinkQualityMeter();
  feed(m, [10, 11, 12, 200, 201]);
  check('a jump of half the range or more (restart, reorder) is not counted as losses', m.snapshot(100).lost === 0);
}
{
  const m = new LinkQualityMeter(5000);
  feed(
    m,
    Array.from({ length: 20 }, (_, i) => i),
    0,
    100
  );
  check('the window: old packets drop out', m.snapshot(7000).received === 0);
  check('silence after packets: 0 % (nothing getting through), not unknown', m.snapshot(7000).quality === 0);
  m.reset();
  check('reset: unknown again', m.snapshot(7000).quality === null);
}
check('bars: 4 / 3 / 2 / 1 / 0', [100, 90, 75, 30, 0].map(linkBars).join() === '4,3,2,1,0' && linkBars(null) === 0);
check(
  'level: good / fair / poor',
  [linkLevel(95), linkLevel(80), linkLevel(50), linkLevel(null)].join() === 'good,fair,poor,'
);

console.log(failures.length ? `\n${failures.length} link-quality check(s) FAILED` : '\nAll link-quality checks PASSED');
process.exit(failures.length ? 1 : 0);
