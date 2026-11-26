// Replay hardening (review): a seek back starts the vehicle list over; overlapping seeks stay in step and keep the
// play state; a vehicle switch during a replay doesn't clear what's remembered; a reset doesn't bring back the saved
// mission's home, and clears mission state and the second GPS.
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
const NAV = 'mavlink_glareshield_nav_cache';
const LAST = 'mavlink_glareshield_last_vehicle';
mem.set(
  NAV,
  JSON.stringify({
    missionWaypoints: [{ seq: 0, command: 16, lat: 40.1, lon: -105.1, alt: 1600, current: false, frame: 0 }],
    fencePoints: [],
    rallyPoints: [],
    home: { lat: 40.1, lon: -105.1 },
  })
);
mem.set(LAST, JSON.stringify({ type: 10, params: { WP_RADIUS: 2 } }));
const lastBefore = mem.get(LAST);

const { useTelemetryStore, resetVehicleState } = await import('../src/store/telemetryStore.ts');
await import('../src/store/lastVehicleStore.ts');
const { startReplay, stopReplay, getReplayTransport } = await import('../src/mavlink/replay.ts');
const { useVehicleRosterStore, switchToVehicle } = await import('../src/mavlink/vehicleRoster.ts');
const { buildReplayTimeline, TlogPlayer } = await import('../src/mavlink/tlogReplay.ts');
const { ReplayTransport } = await import('../src/mavlink/transport/replayTransport.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { encodeTlogRecord } = await import('../src/mavlink/tlog.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hb = (sys: number, armed = false) => {
  const p = new Uint8Array(9);
  p[4] = 1; // fixed wing
  p[5] = 3; // ArduPilot
  p[6] = armed ? 0x81 : 0x01;
  return new MavlinkEncoder(sys, 1).packV2(MAVLINK_MSG_ID.HEARTBEAT, p);
};
const tlog = (frames: [number, Uint8Array][]) => {
  const parts = frames.map(([ms, f]) => encodeTlogRecord((1_700_000_000_000 + ms) * 1000, f));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// The saved mission's home is shown at start (offline planning).
check('at start: home from the saved mission', useTelemetryStore.getState().homePosition.lat === 40.1);
// A reset (a replay starting, a vehicle switch) has no home until the vehicle gives one: not the saved mission's.
useTelemetryStore.setState({ missionState: 1, gps2: { hasYaw: true } as any });
resetVehicleState();
{
  const st = useTelemetryStore.getState();
  check('reset: no home from the saved mission', st.homePosition.source === 'none' && st.homePosition.lat === 0);
  check('reset: mission state and the second GPS cleared', st.missionState === 0 && st.gps2 === null);
}

// A two-vehicle log: vehicle 1 from the start, vehicle 2 from 10 s.
const frames: [number, Uint8Array][] = [];
for (let s = 0; s <= 20; s++) {
  frames.push([s * 1000, hb(1, true)]);
  if (s >= 10) frames.push([s * 1000 + 100, hb(2)]);
}
startReplay(tlog(frames), 'two.tlog');
const tr = getReplayTransport()!;
tr.player.seekTo(20_000);
await sleep(50);
check(
  'played to the end: both vehicles heard together',
  Object.keys(useVehicleRosterStore.getState().vehicles).length === 2 && useVehicleRosterStore.getState().multiSeen
);
// A vehicle switch inside the replay doesn't clear the remembered vehicle.
switchToVehicle(2);
await sleep(50);
check(
  'a vehicle switch during a replay leaves the remembered vehicle alone',
  mem.get(LAST) === lastBefore,
  mem.get(LAST)
);
// Seek back to 2 s: the list starts over from the log (only vehicle 1 heard by then).
tr.seek(2000);
await sleep(100);
{
  const r = useVehicleRosterStore.getState();
  check(
    'seek back: the vehicle list starts over (vehicle 2 not heard yet, not "together")',
    Object.keys(r.vehicles).join() === '1' && !r.multiSeen && r.activeSystemId === 1,
    JSON.stringify({ v: Object.keys(r.vehicles), m: r.multiSeen, a: r.activeSystemId })
  );
}
stopReplay();

// Overlapping seeks: a long seek interrupted by a seek back.
{
  const many: [number, Uint8Array][] = [];
  for (let i = 0; i < 12_000; i++) many.push([i * 10, hb(1)]);
  const t = buildReplayTimeline(tlog(many));
  const restarts: number[] = [];
  const p = new TlogPlayer(
    t,
    () => {},
    () => restarts.push(1)
  );
  // Part of a long seek: out of budget partway.
  p.beginSeek(100_000);
  p.emitUntil(100_000, 4000);
  check(
    'out of budget: the position is where the frames reached',
    p.positionMs === t.timesMs[3999],
    String(p.positionMs)
  );
  // A seek back to before that point must start over.
  p.beginSeek(10_000);
  check('a seek back after a partial seek starts over', restarts.length === 1 && p.index === 0);

  // The transport: two seeks in a row while playing end up playing.
  let clock = 0;
  const transport = new ReplayTransport('t', t, { tickMs: 1_000_000, now: () => clock });
  await transport.connect();
  transport.play();
  transport.seek(110_000);
  transport.seek(50_000); // before the first finished
  for (let i = 0; i < 20 && transport.getState().seeking; i++) await sleep(5);
  const st = transport.getState();
  check('two seeks in a row: the second wins', Math.abs(st.positionMs - 50_000) < 20, String(st.positionMs));
  check('two seeks in a row: still playing afterwards', st.playing && !st.seeking, JSON.stringify(st));
  // Paused, then two seeks: stays paused.
  transport.pause();
  transport.seek(80_000);
  transport.seek(30_000);
  for (let i = 0; i < 20 && transport.getState().seeking; i++) await sleep(5);
  check('paused, two seeks: still paused', !transport.getState().playing);
  await transport.disconnect();
}

// 8a. Paused: the repeated heartbeat is renumbered (a valid frame), so link quality doesn't read the pause as silence.
{
  const { renumberFrame } = await import('../src/mavlink/transport/replayTransport.ts');
  const { MavlinkParser } = await import('../src/mavlink/parser.ts');
  const { LinkQualityMeter } = await import('../src/mavlink/linkQuality.ts');
  const orig = hb(1);
  const parser = new MavlinkParser();
  const meter = new LinkQualityMeter();
  const seq0 = orig[4];
  meter.record(seq0, 0);
  let parsed = 0;
  for (let k = 1; k <= 8; k++) {
    const f = renumberFrame(orig, seq0 + k);
    const pk = parser.parse(f);
    if (pk.length === 1 && pk[0].sequence === ((seq0 + k) & 0xff)) parsed++;
    meter.record(f[4], k * 1000);
  }
  check('renumbered heartbeats parse with valid checksums', parsed === 8, String(parsed));
  const q = meter.snapshot(8000).quality;
  check('paused 8 s: link quality stays 100 %, not 0', q === 100, String(q));
}

// 8b. Heartbeat age limit stretches when a replay plays slower than real time.
{
  const { setReplayClock, heartbeatLiveMs, HEARTBEAT_LIVE_MS } = await import('../src/mavlink/replayClock.ts');
  check('live: 3.5 s', heartbeatLiveMs() === HEARTBEAT_LIVE_MS);
  setReplayClock({ now: () => 0, speed: () => 0.5 });
  check('replay at 0.5x: twice as long', heartbeatLiveMs() === HEARTBEAT_LIVE_MS * 2);
  setReplayClock({ now: () => 0, speed: () => 10 });
  check('replay at 10x: unchanged', heartbeatLiveMs() === HEARTBEAT_LIVE_MS);
  setReplayClock(null);
}

// 8c. The log's clock after a compressed pause: the real time of day, not start + position.
{
  const { epochAt } = await import('../src/mavlink/tlogReplay.ts');
  const t = buildReplayTimeline(
    tlog([
      [0, hb(1)],
      [1000, hb(1)],
      [301_000, hb(1)], // a 5-minute pause, played as 1 s
      [302_000, hb(1)],
    ])
  );
  const start = 1_700_000_000_000;
  check('compressed: playback is 3 s long', t.durationMs === 3000, String(t.durationMs));
  check(
    'clock after the pause: the log time (301.5 s in), not 2.5 s in',
    epochAt(t, 2500) === start + 301_500,
    String(epochAt(t, 2500) - start)
  );
  check('clock before the pause', epochAt(t, 500) === start + 500);
}

// 8d. Home hoisted after the autopilot's first heartbeat (not a gimbal's), and that vehicle's home.
{
  const { hoistHomePosition } = await import('../src/mavlink/replay.ts');
  const gimbalHb = (() => {
    const p = new Uint8Array(9);
    p[4] = 26; // MAV_TYPE_GIMBAL
    p[5] = 8; // MAV_AUTOPILOT_INVALID
    return new MavlinkEncoder(1, 154).packV2(MAVLINK_MSG_ID.HEARTBEAT, p);
  })();
  const home = (sys: number) => new MavlinkEncoder(sys, 1).packV2(MAVLINK_MSG_ID.HOME_POSITION, new Uint8Array(52));
  const t = buildReplayTimeline(
    tlog([
      [0, gimbalHb],
      [100, hb(1)],
      [200, hb(2)],
      [5000, home(2)],
      [6000, home(1)],
    ])
  );
  check('hoisted', hoistHomePosition(t));
  const { frameHeader } = await import('../src/mavlink/tlogReplay.ts');
  const at2 = frameHeader(t.frames[2]);
  check(
    "right after the autopilot's heartbeat (not the gimbal's), and the active vehicle's home (sys 1)",
    at2?.messageId === MAVLINK_MSG_ID.HOME_POSITION && at2.systemId === 1 && t.timesMs[2] === 100,
    JSON.stringify(at2)
  );
}

// 8e. A mission rebuilt from MAVFTP takes the current waypoint the log already gave (MISSION_CURRENT), not the file's.
{
  const { applyReplayMissionFile } = await import('../src/mavlink/replay.ts');
  const { recordPacket } = await import('../src/lib/messageCache.ts');
  const { MavlinkParser } = await import('../src/mavlink/parser.ts');
  const { packDatFile } = await import('../src/mavlink/missionFileParser.ts');
  const parser = new MavlinkParser();
  const mc = new Uint8Array(18);
  new DataView(mc.buffer).setUint16(0, 2, true); // seq 2
  for (const f of [hb(1), new MavlinkEncoder(1, 1).packV2(MAVLINK_MSG_ID.MISSION_CURRENT, mc)])
    for (const p of parser.parse(f)) recordPacket(p);
  useTelemetryStore.setState({ currentWaypointSeq: 2 });
  const items = [0, 1, 2, 3].map((i) => ({
    seq: i,
    command: 16,
    frame: 3,
    current: i === 0,
    x: 35 + i / 1000,
    y: -106,
    z: 50,
  }));
  applyReplayMissionFile({ kind: 'mission', atMs: 0, data: packDatFile(items, 0) });
  const wps = useTelemetryStore.getState().missionWaypoints;
  check(
    'rebuilt mission: the current waypoint is the one MISSION_CURRENT gave (2)',
    wps.length === 4 && wps.find((w) => w.current)?.seq === 2 && wps.filter((w) => w.current).length === 1,
    JSON.stringify(wps.map((w) => [w.seq, w.current]))
  );
}

console.log(
  failures.length ? `\n${failures.length} replay hardening check(s) FAILED` : '\nAll replay hardening checks PASSED'
);
process.exit(failures.length ? 1 : 0);
