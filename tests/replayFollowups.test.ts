// Replay follow-ups: a mission downloaded over MAVFTP rebuilt from the log, home known from the start, the flight's
// clock (log time) for flight time and packet rate.
export {};
const { scanReplayMissionFiles, missionFileKind } = await import('../src/mavlink/replayMissionFiles.ts');
const { buildReplayTimeline, TlogPlayer } = await import('../src/mavlink/tlogReplay.ts');
const { encodeTlogRecord } = await import('../src/mavlink/tlog.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { FTP_OPCODE, packFtpMessage } = await import('../src/mavlink/ftp.ts');
const { packDatFile } = await import('../src/mavlink/missionFileParser.ts');
const { missionManager } = await import('../src/mavlink/missionManager.ts');
const { hoistHomePosition } = await import('../src/mavlink/replay.ts');
const { setReplayClock, flightNow, replaySpeed } = await import('../src/mavlink/replayClock.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const vehicle = new MavlinkEncoder(1, 1);
/** The vehicle's MAVFTP ACK to `reqOpcode`, with `data` at `offset`. */
function vehicleAck(seq: number, session: number, reqOpcode: number, offset: number, data: Uint8Array) {
  const payload = new Uint8Array(254);
  payload[1] = 255;
  payload[2] = 190;
  const v = new DataView(payload.buffer, 3, 251);
  v.setUint16(0, seq, true);
  v.setUint8(2, session);
  v.setUint8(3, FTP_OPCODE.Ack);
  v.setUint8(4, data.length);
  v.setUint8(5, reqOpcode);
  v.setUint32(8, offset, true);
  payload.set(data, 15);
  return vehicle.packV2(MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL, payload);
}
const heartbeat = () => {
  const p = new Uint8Array(9);
  p[4] = 1; // fixed wing
  p[5] = 3; // ArduPilot
  return vehicle.packV2(MAVLINK_MSG_ID.HEARTBEAT, p);
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

check(
  'file kinds: @MISSION/mission.dat, fence.dat, rally.dat',
  [
    missionFileKind('@MISSION/mission.dat'),
    missionFileKind('fence.dat'),
    missionFileKind('@MISSION/rally.dat\0junk'),
    missionFileKind('@PARAM/param.pck'),
  ].join() === 'mission,fence,rally,'
);

// A mission of 9 items (10 + 9 * 38 = 352 bytes): two chunks of 239 and 113.
const items = Array.from({ length: 9 }, (_, i) => ({
  seq: i,
  command: 16,
  frame: 3,
  x: -35.36 + i * 0.001,
  y: 149.16,
  z: i === 0 ? 584 : 50,
}));
const dat = packDatFile(items, 0);
const path = new TextEncoder().encode('@MISSION/mission.dat');
const open = packFtpMessage(1, 1, 10, 0, FTP_OPCODE.OpenFileRO, path.length, 0, path);
const size = new Uint8Array(4);
new DataView(size.buffer).setUint32(0, dat.length, true);
const bytes = tlog([
  [0, heartbeat()],
  [100, open],
  [120, vehicleAck(11, 3, FTP_OPCODE.OpenFileRO, 0, size)],
  [200, vehicleAck(12, 3, FTP_OPCODE.BurstReadFile, 0, dat.subarray(0, 239))],
  [210, heartbeat()],
  [300, vehicleAck(13, 3, FTP_OPCODE.BurstReadFile, 239, dat.subarray(239))],
  [400, heartbeat()],
]);
const timeline = buildReplayTimeline(bytes);
const files = scanReplayMissionFiles(bytes, timeline);
check(
  'one mission file rebuilt',
  files.length === 1 && files[0].kind === 'mission',
  JSON.stringify(files.map((f) => f.kind))
);
check('rebuilt byte for byte', files[0]?.data.length === dat.length && files[0].data.every((b, i) => b === dat[i]));
check('completed when the last chunk arrived (300 ms in)', files[0]?.atMs === 300, String(files[0]?.atMs));
const wps = files[0] ? missionManager.unpackMissionDat(files[0].data) : null;
check(
  'unpacks to the mission: 9 items, home first',
  wps?.length === 9 && Math.abs(wps[0].lat + 35.36) < 1e-6 && wps[0].alt === 584,
  JSON.stringify(wps?.[0])
);

// A file whose chunks never complete, and one the ground station didn't ask for as a mission file.
const partial = tlog([
  [0, open],
  [10, vehicleAck(11, 3, FTP_OPCODE.OpenFileRO, 0, size)],
  [20, vehicleAck(12, 3, FTP_OPCODE.BurstReadFile, 0, dat.subarray(0, 239))],
]);
check(
  'an incomplete download gives nothing',
  scanReplayMissionFiles(partial, buildReplayTimeline(partial)).length === 0
);
const paramPath = new TextEncoder().encode('@PARAM/param.pck');
const other = tlog([
  [0, packFtpMessage(1, 1, 20, 0, FTP_OPCODE.OpenFileRO, paramPath.length, 0, paramPath)],
  [10, vehicleAck(21, 4, FTP_OPCODE.OpenFileRO, 0, size)],
  [20, vehicleAck(22, 4, FTP_OPCODE.BurstReadFile, 0, dat.subarray(0, 239))],
  [30, vehicleAck(23, 4, FTP_OPCODE.BurstReadFile, 239, dat.subarray(239))],
]);
check(
  'another file (param.pck) is not a mission',
  scanReplayMissionFiles(other, buildReplayTimeline(other)).length === 0
);

// Home: a HOME_POSITION late in the log also plays right after the first heartbeat.
const home = vehicle.packV2(MAVLINK_MSG_ID.HOME_POSITION, new Uint8Array(52));
const hl = buildReplayTimeline(
  tlog([
    [0, heartbeat()],
    [500, heartbeat()],
    [90_000 - 60_000, heartbeat()],
    [31_000, home],
  ])
);
const before = hl.frames.length;
check('home hoisted', hoistHomePosition(hl) && hl.frames.length === before + 1);
check(
  'right after the first heartbeat, at its time',
  hl.frames[1] === hl.frames[hl.frames.length - 1] && hl.timesMs[1] === 0
);
check(
  'times still never decrease',
  hl.timesMs.every((t, i) => i === 0 || t >= hl.timesMs[i - 1])
);
const noHome = buildReplayTimeline(
  tlog([
    [0, heartbeat()],
    [10, heartbeat()],
  ])
);
check('no HOME_POSITION: nothing changes', !hoistHomePosition(noHome) && noHome.frames.length === 2);

// The flight's clock: during a seek each frame is timed as itself, not as the seek's target.
{
  const t = buildReplayTimeline(
    tlog([
      [0, heartbeat()],
      [1000, heartbeat()],
      [5000, heartbeat()],
    ])
  );
  const seen: number[] = [];
  const player = new TlogPlayer(t, () => seen.push(player.clockMs));
  player.seekTo(5000);
  check('clock during a seek: each frame its own time', seen.join() === '0,1000,5000', seen.join());
  check('clock between frames: the position', player.clockMs === 5000);
}
setReplayClock({ now: () => 1234, speed: () => 10 });
check('replay clock: log time and speed', flightNow() === 1234 && replaySpeed() === 10);
setReplayClock(null);
check('no replay: the wall clock, speed 1', Math.abs(flightNow() - Date.now()) < 50 && replaySpeed() === 1);

console.log(
  failures.length ? `\n${failures.length} replay follow-up check(s) FAILED` : '\nAll replay follow-up checks PASSED'
);
process.exit(failures.length ? 1 : 0);
