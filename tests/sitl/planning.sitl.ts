/**
 * Mission and rally planning against ArduPilot SITL, through the app's own connection, mission manager, store and
 * draft models (not a simulator). Not part of `npm test`: it needs SITL and the bridge running.
 *
 *   # SITL (Rover shown; any vehicle with a mission works), from an ArduPilot tree built for --board sitl:
 *   build/sitl/bin/ardurover --model rover --defaults Tools/autotest/default_params/rover.parm --home 35,-106,1600,0 -I0
 *   # bridge, from this repo:
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56790 --allow-all-origins
 *   # then:
 *   npx tsx tests/sitl/planning.sitl.ts            (or SITL_WS=ws://host:port/ to use another bridge)
 *
 * It uploads and reads back over MAVFTP and item-by-item, uploads rally points (whole meters, an MSL frame) and
 * clears them, then arms in AUTO to show why a mission upload while the mission runs must go item-by-item. It changes the SITL
 * vehicle's mission, rally points, mode and arming state: use a throwaway SITL instance.
 */
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const { mavlinkConnection } = await import('../../src/mavlink/connection.ts');
const { missionManager } = await import('../../src/mavlink/missionManager.ts');
const { mavFtpClient } = await import('../../src/mavlink/ftp.ts');
const { useTelemetryStore } = await import('../../src/store/telemetryStore.ts');
const d = await import('../../src/mavlink/missionDraft.ts');
const r = await import('../../src/mavlink/rallyDraft.ts');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
async function until(what: string, fn: () => boolean, ms = 30000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}
const quiet = console.log;
const log = (...a: unknown[]) => quiet('   ', ...a);
// The app logs every transfer step; keep this run's output to the checks.
console.log = (...a: unknown[]) => {
  if (typeof a[0] === 'string' && /^(PASS|FAIL|\n|All |\d+ SITL)/.test(a[0])) quiet(...a);
};

mavlinkConnection.setLink({ kind: 'websocket', url: process.env.SITL_WS ?? 'ws://127.0.0.1:56790/' });
mavlinkConnection.connect();
await until('a heartbeat from SITL', () => useTelemetryStore.getState().heartbeat.systemId > 0);
const hb = () => useTelemetryStore.getState().heartbeat;
const sys = hb().systemId;
const comp = hb().componentId || 1;
log(`connected: system ${sys}, type ${hb().type}, mode ${hb().modeName}`);
// Let the vehicle settle (home, parameters stream) before transfers.
await sleep(3000);

const HOME = { lat: 35, lon: -106, alt: 1600 };
function mission(n: number) {
  let m = d.draftFromItems([{ seq: 0, command: 16, frame: 0, x: HOME.lat, y: HOME.lon, z: HOME.alt }]);
  for (let i = 0; i < n; i++) m = d.appendWaypoint(m, HOME.lat + 0.0005 * (i + 1), HOME.lon + 0.0003 * (i % 2), 0);
  return m;
}

// 1. Mission over MAVFTP: upload, read back, verify (alt in cm, frames, home rewritten by the vehicle).
{
  let m = mission(5);
  m = d.insertItems(m, 3, [
    { command: 178, frame: 2, param1: 1, param2: 2.5, param3: -1, param4: 0, x: 0, y: 0, z: 0, autocontinue: 1 },
  ]);
  m = d.insertItems(m, m.items.length, [
    { command: 177, frame: 2, param1: 2, param2: 1, param3: 0, param4: 0, x: 0, y: 0, z: 0, autocontinue: 1 },
  ]);
  const res = await missionManager.uploadMissionAndReadBack(d.draftToItems(m), sys, comp);
  const v = d.checkReadBack(m, res.readBack);
  check(
    'mission over MAVFTP: uploaded and verified',
    res.success && res.method === 'ftp' && v.status === 'verified',
    `${res.method} ${v.status} ${[...v.comparison.structural, ...v.comparison.params].slice(0, 3).join('; ')}`
  );
}

// 2. Item-by-item (MAVFTP made unavailable): upload a shorter mission, stream it back, verify.
{
  const realWrite = mavFtpClient.writeFile.bind(mavFtpClient);
  const realRead = mavFtpClient.readFile.bind(mavFtpClient);
  (mavFtpClient as any).writeFile = async () => false;
  (mavFtpClient as any).readFile = async () => null;
  const m = mission(3);
  const res = await missionManager.uploadMissionAndReadBack(d.draftToItems(m), sys, comp);
  const v = d.checkReadBack(m, res.readBack);
  (mavFtpClient as any).writeFile = realWrite;
  (mavFtpClient as any).readFile = realRead;
  check(
    'mission item-by-item: uploaded, streamed back, verified (shorter mission truncated)',
    res.success && res.method === 'legacy' && v.status === 'verified',
    `${res.method} ${v.status} ${v.comparison.structural.slice(0, 3).join('; ')}`
  );
}

// 3. Rally points: whole meters, an MSL point, read back and verified; then cleared.
{
  let rally = r.addRallyPoint({ points: [] }, null, HOME.lat + 0.002, HOME.lon - 0.001).draft;
  rally = r.addRallyPoint(rally, 0, HOME.lat - 0.0015, HOME.lon + 0.001).draft;
  rally = r.updateRallyPoint(rally, 1, { alt: 1630.48, frame: 0 }); // e.g. typed in feet: kept to whole meters
  const res = await missionManager.uploadRallyAndReadBack(r.rallyDraftToItems(rally), sys, comp);
  const v = r.checkRallyReadBack(rally, res.readBack, res.readOk);
  check(
    'rally points: uploaded and verified (whole meters, MSL frame kept)',
    res.success && v.status === 'verified',
    `${res.method} ${v.status} ${v.differences.join('; ')} frames ${res.readBack.map((p) => p.frame).join(',')}`
  );

  const cleared = await missionManager.uploadRallyAndReadBack([], sys, comp);
  const vc = r.checkRallyReadBack({ points: [] }, cleared.readBack, cleared.readOk);
  check(
    'rally points cleared: verified',
    cleared.success && vc.status === 'verified',
    `${cleared.method} ${vc.status} readOk=${cleared.readOk}`
  );
  check(
    'the vehicle reports rally support (capability bit or accepted upload)',
    useTelemetryStore.getState().rallySupport === 'supported',
    useTelemetryStore.getState().rallySupport
  );
}

// 4. Armed in AUTO, running the mission: why a mission upload must not go over MAVFTP.
{
  const enc = mavlinkConnection.getEncoder();
  const long = mission(6);
  const up = await missionManager.uploadMissionAndReadBack(d.draftToItems(long), sys, comp);
  check(
    'setup: 6-waypoint mission on the vehicle',
    up.success && d.checkReadBack(long, up.readBack).status === 'verified'
  );

  // The mission must be running, not merely AUTO: arm in HOLD, then enter AUTO, which starts it from the top.
  mavlinkConnection.send(enc.createSetMode(sys, comp, 4)); // Rover HOLD
  await sleep(500);
  mavlinkConnection.send(enc.createArmDisarm(sys, comp, true, true));
  try {
    await until('armed', () => hb().isArmed, 15000);
    mavlinkConnection.send(enc.createSetMode(sys, comp, 10)); // Rover AUTO
    await until('AUTO', () => hb().modeName === 'AUTO', 15000);
    await sleep(1500);
  } catch (e) {
    log(`could not arm in AUTO (${(e as Error).message}); mode ${hb().modeName}, armed ${hb().isArmed}`);
  }
  if (hb().isArmed && hb().modeName === 'AUTO') {
    // The bug, reproduced: force MAVFTP by hiding the armed state from the upload's check.
    const short = mission(2);
    const realHb = hb();
    useTelemetryStore.setState({ heartbeat: { ...realHb, isArmed: false } });
    const forced = await missionManager.uploadSection('mission', 0, d.draftToItems(short), undefined, sys, comp);
    const afterFtp = await missionManager.fetchWaypoints(sys, comp);
    useTelemetryStore.setState({ heartbeat: { ...hb(), isArmed: true } });
    // uploadSection is the low-level step (the app's paths reset the transfer state after it): reset it here.
    (missionManager as any).setStatus({
      isUploading: false,
      isFetching: false,
      method: 'idle',
      uploadProgress: undefined,
    });
    log(
      `forced MAVFTP while armed in AUTO: method ${forced.method}, vehicle now holds ${afterFtp.length - 1} items (sent ${short.items.length - 1})`
    );
    check(
      "armed in AUTO over MAVFTP: the old mission's tail survives (the ArduPilot behavior the fix avoids)",
      forced.method === 'ftp' && afterFtp.length > short.items.length,
      `${afterFtp.length - 1} items`
    );

    // The fix: the app's normal path while armed.
    const fixed = await missionManager.uploadMissionAndReadBack(d.draftToItems(short), sys, comp);
    const v = d.checkReadBack(short, fixed.readBack);
    check(
      "armed in AUTO, the app's path: item-by-item, verified, no stale tail",
      fixed.success && fixed.method === 'legacy' && v.status === 'verified',
      `${fixed.method} ${v.status} ${fixed.readBack.length - 1} items ${fixed.error ?? ''}`
    );
  } else {
    failures.push('could not arm in AUTO');
  }
  mavlinkConnection.send(enc.createArmDisarm(sys, comp, false, true));
  await sleep(500);
  mavlinkConnection.send(enc.createSetMode(sys, comp, 4)); // back to HOLD
  await sleep(500);
}

console.log(failures.length ? `\n${failures.length} SITL check(s) FAILED` : '\nAll SITL checks PASSED');
mavlinkConnection.disconnect();
process.exit(failures.length ? 1 : 0);
