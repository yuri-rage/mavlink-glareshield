/**
 * Spline waypoints against ArduCopter SITL: fly a mission with spline legs and compare the vehicle's actual track
 * with the path the map draws (missionPath), and with the straight chord. Not part of `npm test`.
 *
 *   build/sitl/bin/arducopter -w --model + --defaults Tools/autotest/default_params/copter.parm --home 35,-106,1600,0 -I0 --speedup 4
 *   (-w wipes parameters and mission: a mission left mid-takeoff by an earlier run can hold the next one up)
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56790 --allow-all-origins
 *   npx tsx tests/sitl/spline.sitl.ts            (SITL_WS=ws://host:port/ for another bridge)
 *
 * It uploads a mission, arms and flies it in AUTO, then RTLs: use a throwaway SITL instance.
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
const { messageRateManager } = await import('../../src/mavlink/rateManager.ts');
const { MAVLINK_MSG_ID } = await import('../../src/mavlink/messages.ts');
const { useTelemetryStore } = await import('../../src/store/telemetryStore.ts');
const path = await import('../../src/mavlink/missionPath.ts');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const failures: string[] = [];
const quiet = console.log;
function check(name: string, ok: boolean, detail = '') {
  quiet(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const log = (...a: unknown[]) => quiet('   ', ...a);
console.log = () => {}; // the app's transfer logs
async function until(what: string, fn: () => boolean, ms = 60000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

mavlinkConnection.setLink({ kind: 'websocket', url: process.env.SITL_WS ?? 'ws://127.0.0.1:56790/' });
mavlinkConnection.connect();
const st = () => useTelemetryStore.getState();
await until('a heartbeat', () => st().heartbeat.systemId > 0);
messageRateManager.registerRequirement('sitl-spline', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
messageRateManager.registerRequirement('sitl-spline', MAVLINK_MSG_ID.GPS_RAW_INT);
// The current mission item comes from MISSION_CURRENT (RTL as a mission item stays in AUTO, so it is the signal).
messageRateManager.registerRequirement('sitl-spline', MAVLINK_MSG_ID.MISSION_CURRENT);
const sys = st().heartbeat.systemId;
const comp = st().heartbeat.componentId || 1;
await until('a 3D GPS fix', () => st().gps.fixType >= 3, 120000);
log(`connected: system ${sys}, vehicle type ${st().heartbeat.type}`);

// Home, takeoff, WP 80 m north, spline 80 m east, spline 80 m north, WP back west, RTL.
const H = { lat: 35, lon: -106 };
const N = (m: number) => m / 111320;
const E = (m: number) => m / (111320 * Math.cos((H.lat * Math.PI) / 180));
const mk = (seq: number, command: number, lat: number, lon: number, z: number, frame = 3) => ({
  seq, command, frame, current: seq === 0 ? 1 : 0, autocontinue: 1, param1: 0, param2: 0, param3: 0, param4: 0, x: lat, y: lon, z, mission_type: 0,
});
const items = [
  mk(0, 16, H.lat, H.lon, 1600, 0), // home as the vehicle reports it: MSL (SITL's --home altitude)
  mk(1, 22, 0, 0, 20),
  mk(2, 16, H.lat + N(80), H.lon, 20),
  mk(3, 82, H.lat + N(80), H.lon + E(80), 20),
  mk(4, 82, H.lat + N(160), H.lon + E(80), 20),
  mk(5, 16, H.lat + N(160), H.lon, 20),
  mk(6, 20, 0, 0, 0),
];
const up = await missionManager.uploadMissionAndReadBack(items as any, sys, comp);
check('spline mission uploaded', up.success, up.error ?? up.method);

// The path the map draws for it (vehicle home where the mission was planned: SITL's --home).
const pathItems = items.map((it) => ({ command: it.command, lat: it.x, lon: it.y, alt: it.z, frame: it.frame, param1: it.param1 }));
const legs = path.missionPathLegs(pathItems, path.routeIndices(pathItems, true), true);
const splineLegs = legs.filter((l) => l.spline);
check('drawn path has the two spline legs, curved', splineLegs.length === 2 && splineLegs.every((l) => l.latLngs.length > 10));

// Fly it: take off in GUIDED (the usual SITL pattern; SITL has no RC throttle for an AUTO takeoff), then start the
// mission at waypoint #2 in AUTO, so the vehicle flies straight into the legs being checked.
const enc = mavlinkConnection.getEncoder();
mavlinkConnection.send(enc.createSetMode(sys, comp, 4));
await until('GUIDED', () => st().heartbeat.modeName === 'GUIDED', 15000);
for (let i = 0; i < 30 && !st().heartbeat.isArmed; i++) {
  mavlinkConnection.send(enc.createArmDisarm(sys, comp, true, false));
  await sleep(2000);
}
check('armed in GUIDED', st().heartbeat.isArmed);
mavlinkConnection.send(enc.createCommandLong(sys, comp, 22, [0, 0, 0, 0, 0, 0, 20]));
await until('20 m', () => st().position.relativeAlt > 18, 60000);
log(`airborne at ${st().position.relativeAlt.toFixed(1)} m`);
mavlinkConnection.send(enc.createMissionSetCurrent(sys, comp, 2));
await sleep(500);
mavlinkConnection.send(enc.createSetMode(sys, comp, 3));
await until('AUTO', () => st().heartbeat.modeName === 'AUTO', 15000);

// Record the track per current mission item until the vehicle starts the RTL.
const track: { seq: number; lat: number; lon: number }[] = [];
let lastLat = 0;
let lastLon = 0;
const unsub = useTelemetryStore.subscribe((s) => {
  if (s.position.lat === lastLat && s.position.lon === lastLon) return;
  lastLat = s.position.lat;
  lastLon = s.position.lon;
  track.push({ seq: s.currentWaypointSeq, lat: lastLat, lon: lastLon });
});
// Progress every 10 s, and fail fast if the current item stops changing for 60 s (a stall, not a slow flight).
let lastSeq = -1;
let lastChange = Date.now();
const progress = setInterval(() => {
  log(`item ${st().currentWaypointSeq}, ${st().heartbeat.modeName}, alt ${st().position.relativeAlt.toFixed(1)} m, ${track.length} positions`);
}, 10000);
try {
  await until('the mission to reach the RTL', () => {
    const seq = st().currentWaypointSeq;
    if (seq !== lastSeq) {
      lastSeq = seq;
      lastChange = Date.now();
    }
    if (Date.now() - lastChange > 60000) throw new Error(`stalled on item ${seq} for 60 s`);
    return seq >= 6;
  }, 240000);
} finally {
  clearInterval(progress);
}
unsub();
log(`recorded ${track.length} positions`);

// Distance from each track point to a drawn polyline, in metres (flat earth, fine at this size).
const toXY = (lat: number, lon: number) => [(lon - H.lon) * 111320 * Math.cos((H.lat * Math.PI) / 180), (lat - H.lat) * 111320];
function distToLine(pt: [number, number], line: [number, number][]): number {
  const [px, py] = toXY(pt[0], pt[1]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = toXY(line[i - 1][0], line[i - 1][1]);
    const [bx, by] = toXY(line[i][0], line[i][1]);
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

for (const leg of splineLegs) {
  // While the current item is the spline waypoint, the vehicle flies the leg ending there.
  const pts = track.filter((p) => p.seq === leg.to).map((p) => [p.lat, p.lon] as [number, number]);
  const chord: [number, number][] = [leg.latLngs[0], leg.latLngs[leg.latLngs.length - 1]];
  const curveErr = pts.map((q) => distToLine(q, leg.latLngs));
  const chordErr = pts.map((q) => distToLine(q, chord));
  const max = (a: number[]) => (a.length ? Math.max(...a) : NaN);
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  log(`leg to #${leg.to}: ${pts.length} points; off the drawn curve max ${max(curveErr).toFixed(2)} m (mean ${mean(curveErr).toFixed(2)}), off the straight chord max ${max(chordErr).toFixed(2)} m`);
  const worst = curveErr.indexOf(max(curveErr));
  // Where along the leg the worst point is (0 = start, 1 = end), and the error away from the ends.
  const inner = curveErr.slice(Math.floor(pts.length * 0.1), Math.ceil(pts.length * 0.9));
  log(`   worst point at ${(worst / Math.max(1, pts.length - 1)).toFixed(2)} of the leg; middle 80% max ${max(inner).toFixed(2)} m`);
  // Judged on the middle 80% of the leg: at its ends the track is assigned to a leg by the current mission item, which
  // switches a moment before the waypoint on a fast waypoint, so a few points belong to the turn into the next leg.
  check(`leg to #${leg.to}: the vehicle flies the drawn curve (within 2 m, middle 80%)`, pts.length > 5 && max(inner) < 2, `${max(inner).toFixed(2)} m`);
  check(`leg to #${leg.to}: and clearly not the straight chord (3× further off)`, max(chordErr) > 3 * Math.max(0.5, max(inner)), `${max(chordErr).toFixed(2)} m`);
}

quiet(failures.length ? `\n${failures.length} SITL spline check(s) FAILED` : '\nAll SITL spline checks PASSED');
mavlinkConnection.disconnect();
process.exit(failures.length ? 1 : 0);
