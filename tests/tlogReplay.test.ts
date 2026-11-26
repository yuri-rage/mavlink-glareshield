/**
 * Telemetry log replay (src/mavlink/tlogReplay.ts, transport/replayTransport.ts, replay.ts):
 *  - the timeline: playback times from the log, the ground station's own frames left out, long pauses compressed,
 *    a clock step backwards held;
 *  - the player: frames handed out in time, speed, the end, seeking (backwards starts over);
 *  - through the real connection and stores: the dashboard follows the log, and it is read-only: nothing the app
 *    tries to send (commands, parameter and mission downloads, logs, MAVFTP, stream rates, our heartbeat) reaches
 *    any transport.
 *
 * Run: npx tsx tests/tlogReplay.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { buildReplayTimeline, TlogPlayer, frameIndexAfter } = await import('../src/mavlink/tlogReplay.ts');
const { encodeTlogRecord } = await import('../src/mavlink/tlog.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { mavlinkConnection, MavlinkConnection } = await import('../src/mavlink/connection.ts');
const { ReplayTransport } = await import('../src/mavlink/transport/replayTransport.ts');
const { useTelemetryStore, sendTrackedCommand } = await import('../src/store/telemetryStore.ts');
const { startReplay, stopReplay, replayControls, getReplayTransport, gcsFailsafeNote } =
  await import('../src/mavlink/replay.ts');
const { useReplayStore } = await import('../src/store/replayStore.ts');
const { paramManager } = await import('../src/mavlink/paramManager.ts');
const { missionManager } = await import('../src/mavlink/missionManager.ts');
const { logManager } = await import('../src/mavlink/logManager.ts');
const { mavFtpClient } = await import('../src/mavlink/ftp.ts');
const { messageRateManager } = await import('../src/mavlink/rateManager.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A small flight: a plane (sys 1) at 1 Hz heartbeat with a position every second, the ground station's heartbeats
// in between (component 190), a 5-minute pause, and a clock step back.
const plane = new MavlinkEncoder(1, 1);
const gcs = new MavlinkEncoder(255, 190);
const hb = (armed: boolean) => {
  const p = new Uint8Array(9);
  p[4] = 1; // MAV_TYPE_FIXED_WING
  p[5] = 3; // ArduPilot
  p[6] = armed ? 0x81 : 0x01;
  p[7] = 4;
  p[8] = 3;
  return plane.packV2(MAVLINK_MSG_ID.HEARTBEAT, p);
};
const gpi = (lat: number, lon: number, relAltM: number) => {
  const p = new Uint8Array(28);
  const v = new DataView(p.buffer);
  v.setInt32(4, Math.round(lat * 1e7), true);
  v.setInt32(8, Math.round(lon * 1e7), true);
  v.setInt32(12, Math.round((584 + relAltM) * 1000), true);
  v.setInt32(16, Math.round(relAltM * 1000), true);
  v.setUint16(26, 9000, true);
  return plane.packV2(MAVLINK_MSG_ID.GLOBAL_POSITION_INT, p);
};
const T0 = Date.UTC(2026, 10, 26, 12, 0, 0) * 1000; // µs
const recs: Uint8Array[] = [];
const at = (ms: number, frame: Uint8Array) => recs.push(encodeTlogRecord(T0 + ms * 1000, frame));
for (let s = 0; s < 5; s++) {
  at(s * 1000, hb(s >= 2));
  at(s * 1000 + 100, gpi(-35 - s * 0.001, 149, 10 * s));
  at(s * 1000 + 500, gcs.createHeartbeat());
}
// A 5-minute pause (the log continued after an interruption), then one more second.
at(5 * 60_000 + 4000, hb(true));
at(5 * 60_000 + 4100, gpi(-35.009, 149, 90));
// The clock steps back 2 s: time holds, it doesn't run backwards.
at(5 * 60_000 + 2100, gpi(-35.01, 149, 100));
const bytes = new Uint8Array(recs.reduce((n, r) => n + r.length, 0));
recs.reduce((o, r) => (bytes.set(r, o), o + r.length), 0);

// --- the timeline --------------------------------------------------------------------------------------------
const tl = buildReplayTimeline(bytes);
check(
  'vehicle frames kept, the ground station left out',
  tl.frames.length === 13 && tl.gcsFrames === 5,
  `${tl.frames.length} ${tl.gcsFrames}`
);
check('starts at the log time', tl.startEpochMs === T0 / 1000);
check(
  'times from the log: 0, 100 ms, 1 s ...',
  tl.timesMs[0] === 0 && tl.timesMs[1] === 100 && tl.timesMs[2] === 1000,
  tl.timesMs.slice(0, 4).join()
);
check(
  'a 5-minute pause plays as 1 s',
  tl.gapsCompressed === 1 && tl.timesMs[10] === 4100 + 1000,
  `${tl.gapsCompressed} ${tl.timesMs[10]}`
);
check(
  'a clock step back holds the time',
  tl.timesMs[12] === tl.timesMs[11] && tl.durationMs === tl.timesMs[11],
  tl.timesMs.slice(9).join()
);
check('frameIndexAfter', frameIndexAfter(tl.timesMs, 100) === 2 && frameIndexAfter(tl.timesMs, -1) === 0);
check('an empty or foreign file: no frames', buildReplayTimeline(new Uint8Array([1, 2, 3])).frames.length === 0);
{
  const cut = buildReplayTimeline(bytes.subarray(0, bytes.length - 5));
  check('a log cut off mid-record: the whole records', cut.frames.length === 12 && cut.trailingBytes > 0);
}

// --- the player ------------------------------------------------------------------------------------------------
{
  const out: Uint8Array[] = [];
  let restarts = 0;
  const p = new TlogPlayer(
    tl,
    (f) => out.push(f),
    () => restarts++
  );
  p.advance(5000);
  check('paused: nothing', out.length === 0);
  p.play();
  p.advance(0);
  check('play: the frame at 0', out.length === 1);
  p.advance(1050);
  check('1.05 s later: up to 1 s', out.length === 3 && p.positionMs === 1050, `${out.length} ${p.positionMs}`);
  p.speed = 2;
  p.advance(500);
  check('2×: half a second is a second of log', out.length === 5 && p.positionMs === 2050, `${out.length}`);
  check('the last heartbeat is remembered', p.lastHeartbeat === tl.frames[4]);
  p.advance(60_000);
  check('the end: everything out, stopped', out.length === 13 && p.ended && !p.playing);
  p.seekTo(1500);
  check(
    'seek backwards: starts over, plays up to the target',
    restarts === 1 && out.length === 13 + 4 && p.positionMs === 1500 && p.index === 4,
    `${restarts} ${out.length} ${p.index}`
  );
  p.seekTo(3200);
  check('seek forwards: no restart, just the frames between', restarts === 1 && p.index === 8, `${p.index}`);
  p.play();
  p.advance(1);
  check('play after a seek continues from there', p.positionMs > 3200 && p.playing);
}

// --- read-only, on its own connection --------------------------------------------------------------------------
{
  const conn = new MavlinkConnection('ws://example.invalid:1');
  const t = new ReplayTransport('t', tl, { tickMs: 1_000_000 });
  let sendListener = 0;
  conn.onSend(() => sendListener++);
  conn.startReplay(t);
  check('a replay is the link: connected, replaying', conn.getStatus() === 'connected' && conn.isReplaying());
  const enc = conn.getEncoder();
  const results = [
    conn.send(enc.createHeartbeat()),
    conn.send(enc.createArmDisarm(1, 1, true)),
    conn.sendText('{"type":"ntrip"}'),
  ];
  check(
    'every send refused',
    results.every((r) => r === false)
  );
  check(
    'nothing reached the transport, the counters or the send listeners (tlog recorder)',
    t.refusedSends === 0 && conn.stats.packetsSent === 0 && conn.stats.bytesSent === 0 && sendListener === 0
  );
  check('counted as blocked', conn.stats.sendsBlocked === 2);
  conn.connect();
  check('Connect during a replay: still the replay', conn.isReplaying());
  conn.checkLinkSilence(Date.now() + 120_000);
  check('a silent (paused) replay is not a dead link', conn.getStatus() === 'connected' && conn.isReplaying());
  conn.stopReplay();
  check('stopped: disconnected, no replay', conn.getStatus() === 'disconnected' && !conn.isReplaying());
}

// --- the real thing: the app's connection, stores and managers -------------------------------------------------
{
  let sentFromApp = 0;
  mavlinkConnection.onSend(() => sentFromApp++);
  startReplay(bytes, 'test.tlog');
  replayControls.pause();
  const t = getReplayTransport()!;
  check('replay started: store and connection', useReplayStore.getState().active && mavlinkConnection.isReplaying());
  replayControls.seek(1200);
  await wait(10);
  let s = useTelemetryStore.getState();
  check(
    'the dashboard follows the log: vehicle, position',
    s.heartbeat.systemId === 1 && Math.abs(s.position.lat - -35.001) < 1e-6,
    `${s.heartbeat.systemId} ${s.position.lat}`
  );
  check('not armed yet at 1.2 s', !s.heartbeat.isArmed);
  replayControls.seek(3200);
  await wait(10);
  s = useTelemetryStore.getState();
  check('3.2 s: armed, further along', s.heartbeat.isArmed && Math.abs(s.position.lat - -35.003) < 1e-6);
  replayControls.seek(500);
  await wait(10);
  s = useTelemetryStore.getState();
  check(
    'seek back to 0.5 s: started over (disarmed, first position)',
    !s.heartbeat.isArmed && Math.abs(s.position.lat - -35) < 1e-6,
    `${s.heartbeat.isArmed} ${s.position.lat}`
  );
  replayControls.seek(4500);
  await wait(10);

  // Everything that would talk to the vehicle.
  const enc = mavlinkConnection.getEncoder();
  const ack = await sendTrackedCommand(enc.createArmDisarm(1, 1, false), { label: 'Disarm' });
  check('a command: NOT_SENT', ack.resultText === 'NOT_SENT', ack.resultText);
  const fb = useTelemetryStore.getState().commandFeedback;
  check('… and the feedback says why (a replay, not a lost link)', /Replaying/.test(fb?.reason ?? ''), fb?.reason);
  await paramManager.fetchParameters();
  check('parameter download: refused, says why', /Replaying/.test(paramManager.getStatus().message ?? ''));
  check('… and not fetching', !paramManager.getStatus().isFetching);
  await missionManager.fetchMission();
  check('mission download: refused, not fetching', !missionManager.getStatus().isFetching);
  const up = await missionManager.uploadMissionAndReadBack([]);
  check('mission upload: refused at once', !up.success && /Replaying/.test(up.error ?? ''));
  let logErr = '';
  await logManager.listLogs(1, 1).catch((e: Error) => (logErr = e.message));
  check('onboard log list: refused at once', /Replaying/.test(logErr), logErr);
  check('MAVFTP read: refused at once', (await mavFtpClient.readFile(1, 1, '@PARAM/param.pck')) === null);
  check('MAVFTP write: refused at once', (await mavFtpClient.writeFile(1, 1, 'x', new Uint8Array(4))) === false);
  messageRateManager.recalculateAndApply();
  paramManager.requestParam(1, 1, 'WP_SPEED');
  logManager.erase(1, 1);
  // Long enough for our heartbeat (1 Hz), the version poll and the gimbal poll, were any of them running.
  replayControls.play();
  await wait(3200);
  check(
    'read-only: nothing reached the transport or the recorder',
    t.refusedSends === 0 && sentFromApp === 0 && mavlinkConnection.stats.packetsSent === 0,
    `transport ${t.refusedSends}, listeners ${sentFromApp}, sent ${mavlinkConnection.stats.packetsSent}`
  );
  check('what was tried is counted as blocked', mavlinkConnection.stats.sendsBlocked > 0);
  check('played on to the end (paused at the end)', useReplayStore.getState().ended);

  stopReplay();
  s = useTelemetryStore.getState();
  check(
    'stopped: disconnected, the replay cleared from the dashboard',
    mavlinkConnection.getStatus() === 'disconnected' &&
      !mavlinkConnection.isReplaying() &&
      !useReplayStore.getState().active &&
      s.position.lat === 0 &&
      s.heartbeat.lastHeartbeatTime === 0,
    `${mavlinkConnection.getStatus()} ${s.position.lat} ${s.heartbeat.lastHeartbeatTime}`
  );
}

// Leaving a live link for a replay: the confirmation names the ground-station failsafe.
check(
  'failsafe unknown: said as a possibility',
  /If its ground-station failsafe \(FS_GCS_ENABLE\) is on/.test(gcsFailsafeNote({}))
);
check('failsafe off: said so', /is off/.test(gcsFailsafeNote({ FS_GCS_ENABLE: { value: 0 } })));
check(
  'failsafe on: said plainly, with its timeout',
  /is ON \(FS_GCS_ENABLE = 1\).*about 5 s/.test(
    gcsFailsafeNote({ FS_GCS_ENABLE: { value: 1 }, FS_GCS_TIMEOUT: { value: 5 } })
  )
);

console.log(failures.length ? `\n${failures.length} replay check(s) FAILED` : '\nAll replay checks PASSED');
process.exit(failures.length ? 1 : 0);
