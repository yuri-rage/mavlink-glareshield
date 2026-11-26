// A paused replay repeats the shown vehicle's autopilot heartbeat (not a gimbal's, companion's or another vehicle's),
// numbered on from that autopilot's last packet, so the link meter sees neither a duplicate nor a gap.
export {};
const { buildReplayTimeline } = await import('../src/mavlink/tlogReplay.ts');
const { ReplayTransport } = await import('../src/mavlink/transport/replayTransport.ts');
const { encodeTlogRecord } = await import('../src/mavlink/tlog.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { LinkQualityMeter } = await import('../src/mavlink/linkQuality.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const autopilot = new MavlinkEncoder(1, 1);
const gimbal = new MavlinkEncoder(1, 154);
const hbPayload = (type: number, ap: number) => {
  const p = new Uint8Array(9);
  p[4] = type;
  p[5] = ap;
  return p;
};
const frames: [number, Uint8Array][] = [];
let t = 0;
frames.push([t, autopilot.packV2(MAVLINK_MSG_ID.HEARTBEAT, hbPayload(1, 3))]);
// 200 autopilot packets between heartbeats (a high-rate log): the heartbeat's own number is far behind the last.
for (let i = 0; i < 200; i++) frames.push([(t += 2), autopilot.packV2(MAVLINK_MSG_ID.ATTITUDE, new Uint8Array(28))]);
frames.push([(t += 2), gimbal.packV2(MAVLINK_MSG_ID.HEARTBEAT, hbPayload(26, 8))]); // gimbal heartbeat last
const parts = frames.map(([ms, f]) => encodeTlogRecord((1_700_000_000_000 + ms) * 1000, f));
const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
let o = 0;
for (const p of parts) {
  bytes.set(p, o);
  o += p.length;
}

let clock = 0;
const out: Uint8Array[] = [];
const tr = new ReplayTransport('t', buildReplayTimeline(bytes), { now: () => clock, activeSystem: () => 1 });
tr.onFrame((f) => out.push(f));
tr.player.seekTo(t);
const meter = new LinkQualityMeter();
for (const f of out) if (f[6] === 1) meter.record(f[4], clock);
const lastAutopilotSeq = out.filter((f) => f[6] === 1).pop()![4];
out.length = 0;
for (let i = 0; i < 6; i++) {
  clock += 1000;
  tr.tick();
}
check('paused: one repeated heartbeat a second', out.length === 6, String(out.length));
check(
  'the autopilot heartbeat repeated, not the gimbal one',
  out.every((f) => f[6] === 1 && f[7] === 0)
);
check(
  "numbered on from the autopilot's last packet",
  out[0][4] === ((lastAutopilotSeq + 1) & 0xff) && out[5][4] === ((lastAutopilotSeq + 6) & 0xff),
  `${lastAutopilotSeq} -> ${out.map((f) => f[4]).join(',')}`
);
for (const f of out) meter.record(f[4], clock);
const s = meter.snapshot(clock);
check('the link meter sees no loss across the pause', s.lost === 0 && s.quality === 100, JSON.stringify(s));
meter.forgetSequence();
meter.record(7, clock);
check('after forgetSequence, the next number is not a gap', meter.snapshot(clock).lost === 0);

console.log(failures.length ? `\n${failures.length} keepalive check(s) FAILED` : '\nAll keepalive checks PASSED');
process.exit(failures.length ? 1 : 0);
