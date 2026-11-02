/**
 * Regression checks for review findings that the existing suite does not cover.
 *
 *  A. QGC .plan parsing against what QGroundControl actually writes for ArduPilot
 *     (src/FirmwarePlugin/APM/APM-MavCmdInfoCommon.json, src/MissionManager/LandingComplexItem.cc)
 *  B. RTCM fragmentation edge at exactly 720 bytes (AP_GPS::handle_gps_rtcm_fragment)
 *  C. Firmware-version polling must not turn into a repeating full parameter download
 *
 * Run: npx tsx tests/regressions.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { parseDroppedMissionFile } = await import('../src/mavlink/missionFileParser.ts');
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { rtcmInjector } = await import('../src/mavlink/rtcmInjector.ts');
const { useConnectionStore } = await import('../src/store/connectionStore.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser } = await import('../src/mavlink/parser.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const parser = new MavlinkParser();

// ------------------------------------------------------------------------------------------------
// A. QGC .plan files
// ------------------------------------------------------------------------------------------------
const HOME = [37.7749, -122.4194, 10];
const simple = (command: number, params: (number | null)[], frame = 3) =>
  ({ type: 'SimpleItem', command, frame, autoContinue: true, doJumpId: 1, params });
const plan = (items: any[], extra: Record<string, any> = {}) => ({
  fileType: 'Plan', groundStation: 'QGroundControl', version: 1,
  mission: { cruiseSpeed: 15, hoverSpeed: 5, firmwareType: 3, vehicleType: 2, version: 2, plannedHomePosition: HOME, items },
  geoFence: { circles: [], polygons: [], version: 2 },
  rallyPoints: { points: [], version: 2 },
  ...extra,
});
function parsePlan(obj: any): { result: any; error: string | null } {
  try {
    return { result: parseDroppedMissionFile('test.plan', new TextEncoder().encode(JSON.stringify(obj))), error: null };
  } catch (e: any) {
    return { result: null, error: String(e?.message ?? e) };
  }
}
const missionItems = (r: any) => (r?.sections?.find((s: any) => s.type === 'mission')?.items ?? r?.items ?? []) as any[];
const WP = (lat: number, lon: number, alt = 30) => simple(16, [0, 0, 0, null, lat, lon, alt]);

// For ArduPilot, QGC marks TAKEOFF / VTOL_TAKEOFF as "specifiesCoordinate": false, so it saves lat/lon = 0.
// ArduPilot also treats 0,0 as "here" for LAND, LOITER_UNLIM and VTOL_LAND, and QGC writes
// DO_LAND_START without coordinates for ArduPilot >= 4.2.
const zeroCoordAllowed: [string, number][] = [
  ['NAV_TAKEOFF (22) as QGC saves it for ArduCopter', 22],
  ['NAV_VTOL_TAKEOFF (84)', 84],
  ['DO_LAND_START (189) as QGC saves it for ArduPilot >= 4.2', 189],
  ['NAV_LAND (21) at current position', 21],
  ['NAV_LOITER_UNLIM (17) at current position', 17],
];
for (const [label, cmd] of zeroCoordAllowed) {
  const { result, error } = parsePlan(plan([simple(cmd, [0, 0, 0, null, 0, 0, 20]), WP(37.776, -122.418)]));
  const kept = missionItems(result).some((i) => i.command === cmd);
  check(`.plan with ${label} at 0,0 is accepted`, !error && kept, error ?? (kept ? '' : 'item missing'));
}
{
  const { error } = parsePlan(plan([WP(37.776, -122.418), WP(0, 0)]));
  check('.plan with a NAV_WAYPOINT at 0,0 is still rejected', !!error, error ? '' : 'accepted');
}

// QGC fixed-wing landing pattern (keys from LandingComplexItem::_saveItem, version 2)
const LAND = [37.7700, -122.4100, 0];
const APPROACH = [37.7750, -122.4250, 40];
const landingPattern = (complexItemType: string, opts: Record<string, any> = {}) => ({
  type: 'ComplexItem', complexItemType, version: 2,
  landCoordinate: LAND, landingApproachCoordinate: APPROACH,
  altitudesAreRelative: true, loiterRadius: 75, loiterClockwise: true, useLoiterToAlt: true,
  useDoChangeSpeed: false, finalApproachSpeed: 18, stopTakingPhotos: false, stopVideoPhotos: false,
  valueSetIsDistance: false, glideSlope: 6, landingDistance: 300, landingHeading: 270,
  ...opts,
});
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
// LandingComplexItem::appendMissionItems: DO_LAND_START, [DO_CHANGE_SPEED], [camera stops], approach, land
for (const [type, landCmd, opts, label] of [
  ['fwLandingPattern', 21, {}, 'loiter-to-alt approach'],
  ['fwLandingPattern', 21, { useLoiterToAlt: false, useDoChangeSpeed: true }, 'waypoint approach + DO_CHANGE_SPEED'],
  ['vtolLandingPattern', 85, {}, 'VTOL'],
] as [string, number, Record<string, any>, string][]) {
  const { result, error } = parsePlan(plan([WP(37.776, -122.418, 50), landingPattern(type, opts)]));
  const items = missionItems(result);
  const cmds = items.map((i) => i.command);
  const start = cmds.indexOf(189);
  const land = items[items.length - 1];
  const approach = items[items.length - 2];
  const approachCmd = opts.useLoiterToAlt === false ? 16 : 31;
  const ok = !error && start > 0
    && land?.command === landCmd && near(land.x, LAND[0]) && near(land.y, LAND[1])
    && approach?.command === approachCmd && near(approach.x, APPROACH[0]) && near(approach.y, APPROACH[1]) && near(approach.z, APPROACH[2], 0.01)
    && (!opts.useDoChangeSpeed || cmds.slice(start, -2).includes(178));
  check(`QGC ${type} (${label}) expands to DO_LAND_START ... ${approachCmd === 31 ? 'LOITER_TO_ALT' : 'WAYPOINT'} -> ${landCmd === 85 ? 'VTOL_LAND' : 'LAND'}`,
    ok, error ?? `commands: ${cmds.join(',')}`);
}

// ------------------------------------------------------------------------------------------------
// B. RTCM: every fragmented frame must be completable by ArduPilot
//    (fragment ids 0-3; completion is signalled by a fragment shorter than 180 bytes)
// ------------------------------------------------------------------------------------------------
{
  const sent: Uint8Array[] = [];
  const origSend = (mavlinkConnection as any).send;
  (mavlinkConnection as any).send = (d: Uint8Array) => { sent.push(d); return true; };
  useConnectionStore.getState().setBandwidthProfile('high' as any);
  for (const size of [179, 180, 181, 359, 360, 539, 540, 719, 720]) {
    sent.length = 0;
    const frame = Uint8Array.from({ length: size }, (_, i) => (i * 13 + 1) & 0xff);
    rtcmInjector.injectRtcmFrame(frame, 1004);
    const pkts = sent.flatMap((b) => parser.parse(b)).filter((p) => p.messageId === 233).map((p) => {
      const pl = new Uint8Array(182); pl.set(p.payload.subarray(0, 182));
      return { flags: pl[0], len: pl[1], data: pl.subarray(2, 2 + pl[1]) };
    });
    let delivered: number[] | null = null;
    if (pkts.length === 1 && !(pkts[0].flags & 1)) delivered = [...pkts[0].data];
    else if (pkts.length > 0 && pkts.length <= 4 && pkts[pkts.length - 1].len < 180) delivered = pkts.flatMap((p) => [...p.data]);
    const intact = !!delivered && delivered.length === size && delivered.every((x, i) => x === frame[i]);
    const ok = intact || pkts.length === 0;    // either delivered intact, or deliberately dropped (and counted)
    check(`RTCM ${size}-byte frame is delivered intact or dropped, never sent undeliverable`, ok,
      `${pkts.length} packet(s), lens ${pkts.map((p) => p.len).join('/') || '-'}`);
  }
  (mavlinkConnection as any).send = origSend;
}

// ------------------------------------------------------------------------------------------------
// C. Version polling against a vehicle that heartbeats but never answers the version requests
// ------------------------------------------------------------------------------------------------
{
  // Record every outgoing message (and the MAV_CMD for COMMAND_LONG) with the simulated time it was sent
  const sent: { id: number; cmd: number; t: number }[] = [];
  const realNow = Date.now;
  let t = realNow();
  const t0 = t;
  const origSend = (mavlinkConnection as any).send;
  (mavlinkConnection as any).send = (d: Uint8Array) => {
    for (const p of parser.parse(d)) {
      const pl = new Uint8Array(33); pl.set(p.payload.subarray(0, 33));
      sent.push({ id: p.messageId, cmd: p.messageId === 76 ? new DataView(pl.buffer).getUint16(28, true) : 0, t });
    }
    return true;
  };
  Date.now = () => t;
  const vehicle = new MavlinkEncoder(1, 1);
  const hbPayload = new Uint8Array([0, 0, 0, 0, /*type quad*/ 2, /*ArduPilot*/ 3, 0x81, 4, 3]);
  for (let s = 0; s < 120; s++) {
    for (const p of parser.parse(vehicle.packV2(0, hbPayload))) useTelemetryStore.getState().processPacket(p);
    t += 1000;
  }
  Date.now = realNow;
  (mavlinkConnection as any).send = origSend;
  const PARAM_REQUEST_LIST = 21;
  const VERSION_CMDS = new Set([520 /*REQUEST_AUTOPILOT_CAPABILITIES*/, 512 /*REQUEST_MESSAGE*/, 42428 /*DO_SEND_BANNER*/]);
  const paramLists = sent.filter((m) => m.id === PARAM_REQUEST_LIST).length;
  const versionReqs = sent.filter((m) => m.id === 76 && VERSION_CMDS.has(m.cmd));
  const late = versionReqs.filter((m) => m.t - t0 > 60000).length;
  check('silent vehicle: at most one PARAM_REQUEST_LIST in 2 minutes of version polling', paramLists <= 1, `${paramLists} sent`);
  check('silent vehicle: version requests stop within the first minute', late === 0, `${versionReqs.length} version requests, ${late} after 60 s`);
}

console.log(failures.length ? `\n${failures.length} regression check(s) FAILED` : '\nAll regression checks PASSED');
process.exit(failures.length ? 1 : 0);
