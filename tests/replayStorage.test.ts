// A replay never touches what the app remembers about the vehicle: the saved mission, fence, rally points and home
// (nav cache) and the last vehicle's type and planning parameters. Starting and stopping one used to save the emptied
// (and then the log's) mission over the user's.
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
};
const NAV = 'mavlink_glareshield_nav_cache';
const LAST = 'mavlink_glareshield_last_vehicle';
const savedMission = [
  { seq: 0, command: 16, lat: 40.1, lon: -105.1, alt: 1600, current: false, frame: 0 },
  { seq: 1, command: 16, lat: 40.11, lon: -105.1, alt: 30, current: false, frame: 3 },
];
mem.set(
  NAV,
  JSON.stringify({ missionWaypoints: savedMission, fencePoints: [], rallyPoints: [], home: { lat: 40.1, lon: -105.1 } })
);
mem.set(LAST, JSON.stringify({ type: 10, params: { WP_RADIUS: 2 } }));
const navBefore = mem.get(NAV);
const lastBefore = mem.get(LAST);

const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
await import('../src/store/lastVehicleStore.ts');
const { startReplay, stopReplay, getReplayTransport } = await import('../src/mavlink/replay.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');
const { encodeTlogRecord } = await import('../src/mavlink/tlog.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

check('saved mission loaded at start', useTelemetryStore.getState().missionWaypoints.length === 2);

// A Plane log with a different home and a streamed one-item mission.
const plane = new MavlinkEncoder(1, 1);
const hb = () => {
  const p = new Uint8Array(9);
  p[4] = 1; // fixed wing
  p[5] = 3; // ArduPilot
  p[6] = 0x81; // armed
  return plane.packV2(MAVLINK_MSG_ID.HEARTBEAT, p);
};
const item = (() => {
  const p = new Uint8Array(38);
  const v = new DataView(p.buffer);
  v.setInt32(16, -353_632_620, true); // x (lat e7)
  v.setInt32(20, 1_491_652_370, true); // y
  v.setFloat32(24, 584, true); // z
  v.setUint16(28, 0, true); // seq 0
  v.setUint16(30, 16, true); // command
  v.setUint8(34, 0); // frame
  return plane.packV2(MAVLINK_MSG_ID.MISSION_ITEM_INT, p);
})();
const frames: [number, Uint8Array][] = [
  [0, hb()],
  [100, item],
  [1000, hb()],
];
const parts = frames.map(([ms, f]) => encodeTlogRecord((1_700_000_000_000 + ms) * 1000, f));
const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
let o = 0;
for (const p of parts) {
  bytes.set(p, o);
  o += p.length;
}

startReplay(bytes, 'plane.tlog');
getReplayTransport()!.player.seekTo(1000);
await sleep(600);
check(
  'the replay shows the log (its mission item)',
  useTelemetryStore.getState().missionWaypoints.some((w) => Math.abs(w.lat + 35.363262) < 1e-5)
);
check('while it plays, the saved mission is untouched', mem.get(NAV) === navBefore);
check('while it plays, the last vehicle (a Rover) is untouched', mem.get(LAST) === lastBefore);

stopReplay();
await sleep(600);
check('after Stop, the saved mission is untouched', mem.get(NAV) === navBefore, mem.get(NAV)?.slice(0, 120));
check('after Stop, the last vehicle is untouched', mem.get(LAST) === lastBefore, mem.get(LAST));
const st = useTelemetryStore.getState();
check(
  "after Stop, the store shows the saved mission and home again (not the log's, not empty)",
  st.missionWaypoints.length === 2 && st.missionWaypoints[1].lat === 40.11 && st.homePosition.lat === 40.1,
  JSON.stringify({ n: st.missionWaypoints.length, home: st.homePosition })
);

console.log(
  failures.length ? `\n${failures.length} replay storage check(s) FAILED` : '\nAll replay storage checks PASSED'
);
process.exit(failures.length ? 1 : 0);
