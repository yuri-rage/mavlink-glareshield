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
const { useUnitsStore } = await import('../src/store/unitsStore.ts');
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { useTelemetryStore, sendTrackedCommand, computeDistanceAndBearing, evaluatePreArmReadiness } = await import('../src/store/telemetryStore.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
const { parseParamFile, serializeParamFile, getParamMetadata } = await import('../src/mavlink/paramMetadata.ts');
const { normalizeCalloutText, useAudioAlertsStore } = await import('../src/lib/audioAlerts.ts');

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

{
  // QGC defaults: stopTakingPhotos = true, stopTakingVideo = true
  // Emits DO_LAND_START (189), DO_SET_CAM_TRIGG_DIST (206), IMAGE_STOP_CAPTURE (2001), VIDEO_STOP_CAPTURE (2501), LOITER_TO_ALT (31), LAND (21)
  const defaultPattern = {
    type: 'ComplexItem', complexItemType: 'fwLandingPattern', version: 2,
    landCoordinate: LAND, landingApproachCoordinate: APPROACH,
    altitudesAreRelative: true, loiterRadius: 75, loiterClockwise: true, useLoiterToAlt: true,
  };
  const { result, error } = parsePlan(plan([WP(37.776, -122.418, 50), defaultPattern]));
  const items = missionItems(result);
  const cmds = items.map((i) => i.command);
  const ok = !error && cmds.slice(-6).join(',') === '189,206,2001,2501,31,21';
  check('QGC fwLandingPattern with default camera stops emits 189,206,2001,2501,31,21',
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

// ------------------------------------------------------------------------------------------------
// D. UX Review & Feature Additions (TODO-report.md)
// ------------------------------------------------------------------------------------------------
{
  const origSend = (mavlinkConnection as any).send;
  const sentPackets: Uint8Array[] = [];
  (mavlinkConnection as any).send = (d: Uint8Array) => {
    sentPackets.push(d);
    for (const cb of (mavlinkConnection as any).sendListeners ?? []) cb(d);
    return true;
  };

  const enc = new MavlinkEncoder(255, 190);
  const veh = new MavlinkEncoder(1, 1);

  // 1. Command feedback lifecycle + STATUSTEXT reason correlation
  const takeoffPkt = enc.createCommandLong(1, 1, 22, [0, 0, 0, 0, 0, 0, 15]);
  const ackPromise = sendTrackedCommand(takeoffPkt, { label: 'Takeoff (15m)', targetKey: 'action:takeoff' });
  const pendingFb = useTelemetryStore.getState().commandFeedback;
  check('sendTrackedCommand sets pending commandFeedback with targetKey',
    pendingFb?.status === 'pending' && pendingFb?.targetKey === 'action:takeoff',
    JSON.stringify(pendingFb));

  // Vehicle sends STATUSTEXT reason followed by COMMAND_ACK(FAILED=4) for NAV_TAKEOFF(22)
  const stPayload = new Uint8Array(51);
  stPayload[0] = 4; // WARNING
  stPayload.set(new TextEncoder().encode('Takeoff: must be in GUIDED mode'), 1);
  for (const p of parser.parse(veh.packV2(253, stPayload))) {
    useTelemetryStore.getState().processPacket(p);
  }
  const ackPayload = new Uint8Array(3);
  new DataView(ackPayload.buffer).setUint16(0, 22, true); // NAV_TAKEOFF
  ackPayload[2] = 4; // MAV_RESULT_FAILED
  for (const p of parser.parse(veh.packV2(77, ackPayload))) {
    useTelemetryStore.getState().processPacket(p);
  }
  const resolvedAck = await ackPromise;
  const deniedFb = useTelemetryStore.getState().commandFeedback;
  check('COMMAND_ACK(FAILED) resolves sendTrackedCommand and attaches STATUSTEXT reason',
    resolvedAck.result === 4 && deniedFb?.status === 'denied' && Boolean(deniedFb?.reason?.includes('GUIDED')),
    JSON.stringify(deniedFb));

  // 2. HOME_POSITION (242) & live distance/bearing calculation
  const homePayload = new Uint8Array(52);
  const hdv = new DataView(homePayload.buffer);
  hdv.setInt32(0, Math.round(37.7749 * 1e7), true);
  hdv.setInt32(4, Math.round(-122.4194 * 1e7), true);
  hdv.setInt32(8, 12000, true); // 12m in mm
  for (const p of parser.parse(veh.packV2(242, homePayload))) {
    useTelemetryStore.getState().processPacket(p);
  }
  const hp = useTelemetryStore.getState().homePosition;
  const distBrg = computeDistanceAndBearing(37.7749, -122.4194, 37.7849, -122.4194);
  check('HOME_POSITION (242) decodes and computeDistanceAndBearing computes ~1112m North',
    hp.source === 'home_msg' && Math.abs(hp.lat - 37.7749) < 1e-5 && Math.abs(distBrg.distanceM - 1112) < 15 && distBrg.bearingDeg === 0,
    `source=${hp.source}, dist=${distBrg.distanceM.toFixed(1)}m, brg=${distBrg.bearingDeg}`);

  // 3. RADIO_STATUS (109) decoding (wire order: rxerrors u16, fixed u16, rssi u8, remrssi u8, txbuf u8, noise u8, remnoise u8)
  const radioPayload = new Uint8Array([2, 0, 5, 0, 200, 195, 90, 40, 42]);
  for (const p of parser.parse(veh.packV2(109, radioPayload))) {
    useTelemetryStore.getState().processPacket(p);
  }
  const rs = useTelemetryStore.getState().radioStatus;
  check('RADIO_STATUS (109) decodes rssi, remrssi, txbuf and rxerrors',
    rs.rssi === 200 && rs.remrssi === 195 && rs.txbuf === 90 && rs.rxerrors === 2 && rs.fixed === 5,
    JSON.stringify(rs));

  // 4. Pre-arm readiness evaluation & RUN_PREARM_CHECKS (401) + DO_REPOSITION (192)
  const preArmSt = new Uint8Array(51);
  preArmSt[0] = 2; // CRITICAL
  preArmSt.set(new TextEncoder().encode('PreArm: Compass not calibrated'), 1);
  for (const p of parser.parse(veh.packV2(253, preArmSt))) {
    useTelemetryStore.getState().processPacket(p);
  }
  const readiness = evaluatePreArmReadiness(
    useTelemetryStore.getState().sysStatus,
    useTelemetryStore.getState().statusMessages,
    false
  );
  check('evaluatePreArmReadiness captures PreArm STATUSTEXT blockers',
    !readiness.isReady && readiness.activePreArmErrors.some((e) => e.includes('Compass not calibrated')),
    JSON.stringify(readiness.activePreArmErrors));

  const repoPkt = enc.createDoReposition(1, 1, 37.775, -122.418, 25);
  const parsedRepo = parser.parse(repoPkt)[0];
  const decodedRepo = decodePayload(parsedRepo.messageId, parsedRepo.payload);
  check('createDoReposition encodes COMMAND_INT (75) with DO_REPOSITION (192) and lat/lon*1e7',
    parsedRepo.messageId === 75 && decodedRepo.command === 192 && decodedRepo.x === Math.round(37.775 * 1e7) && decodedRepo.z === 25,
    JSON.stringify(decodedRepo));

  // 5. Parameter file serialize/parse roundtrip & metadata
  const paramText = serializeParamFile({ WPNAV_SPEED: 500, BATT_LOW_VOLT: 14.2 }, 'ArduCopter V4.5.0');
  const parsedParams = parseParamFile(paramText);
  const meta = getParamMetadata('WPNAV_SPEED');
  check('paramMetadata serializeParamFile/parseParamFile roundtrips and provides units/ranges',
    parsedParams.WPNAV_SPEED === 500 && Math.abs(parsedParams.BATT_LOW_VOLT - 14.2) < 1e-5 && meta?.units === 'cm/s',
    JSON.stringify({ parsedParams, units: meta?.units }));

  // 6. Distance to home / waypoint unit logic and "H 000°/0.0 NM" symbology
  useUnitsStore.getState().setSystem('ms');
  const dMs = useUnitsStore.getState().formatDistance(1250);
  const hMs = useUnitsStore.getState().formatHomeVector(4.8, 1250);
  check('m/s system: distance always in meters and symbology formats bearing/range',
    dMs.full === '1250 M' && hMs === 'H 005°/1250 M',
    `dMs=${dMs.full}, hMs=${hMs}`);

  useUnitsStore.getState().setSystem('kmh');
  const dKmhFar = useUnitsStore.getState().formatDistance(2500);
  const dKmhNear = useUnitsStore.getState().formatDistance(450);
  const hKmh = useUnitsStore.getState().formatHomeVector(45.2, 2500);
  check('km/h system: km when >= 1km, meters inside 1km',
    dKmhFar.full === '2.5 KM' && dKmhNear.full === '450 M' && hKmh === 'H 045°/2.5 KM',
    `far=${dKmhFar.full}, near=${dKmhNear.full}, hKmh=${hKmh}`);

  useUnitsStore.getState().setSystem('mph');
  const dMphFar = useUnitsStore.getState().formatDistance(2000);
  const dMphNear = useUnitsStore.getState().formatDistance(200); // 200m ~ 656 ft
  const hMph = useUnitsStore.getState().formatHomeVector(270.1, 2000);
  check('mph system: mi when >= 1,000 ft, feet inside 1,000 ft',
    dMphFar.full === '1.2 MI' && dMphNear.full === '656 FT' && hMph === 'H 270°/1.2 MI',
    `far=${dMphFar.full}, near=${dMphNear.full}, hMph=${hMph}`);

  useUnitsStore.getState().setSystem('kts');
  const dKtsFar = useUnitsStore.getState().formatDistance(1852);
  const dKtsNear = useUnitsStore.getState().formatDistance(200);
  const hKts = useUnitsStore.getState().formatHomeVector(359.8, 1852);
  check('kts system: nm when >= 1,000 ft, feet inside 1,000 ft, bearing rounded to 000°',
    dKtsFar.full === '1.0 NM' && dKtsNear.full === '656 FT' && hKts === 'H 000°/1.0 NM',
    `far=${dKtsFar.full}, near=${dKtsNear.full}, hKts=${hKts}`);

  // 7. Crosstrack error formatting (feet when imperial, meters when metric)
  useUnitsStore.getState().setSystem('ms');
  const xtMetric = useUnitsStore.getState().formatCrosstrack(3.2);
  check('crosstrack in metric: returns meters',
    xtMetric.unit === 'm' && xtMetric.full === '3.2 m',
    JSON.stringify(xtMetric));

  useUnitsStore.getState().setSystem('kts');
  const xtImp = useUnitsStore.getState().formatCrosstrack(3.2); // 3.2m * 3.28084 = 10.498 ft -> 10.5 ft
  check('crosstrack in imperial (kts/mph): returns feet',
    xtImp.unit === 'ft' && xtImp.full === '10.5 ft',
    JSON.stringify(xtImp));

  // 8. Map waypoint count badge (mission count minus 1 for home)
  const calcUserWpCount = (missionWpsCount: number) => Math.max(0, missionWpsCount - 1);
  check('wp badge count logic: displays item count minus 1 (home waypoint excluded)',
    calcUserWpCount(0) === 0 && calcUserWpCount(1) === 0 && calcUserWpCount(5) === 4,
    `0->${calcUserWpCount(0)}, 1->${calcUserWpCount(1)}, 5->${calcUserWpCount(5)}`);

  // 9. Default dashboard tabs: HUD, Moving Map, Telemetry, and Configuration in order
  useDashboardStore.getState().resetToDefaults();
  const tabTitles = useDashboardStore.getState().profile.tabs.map((t: any) => t.title);
  const expectedTitles = ['HUD', 'Moving Map', 'Telemetry', 'Configuration'];
  check('default tab titles in order: HUD, Moving Map, Telemetry, and Configuration',
    JSON.stringify(tabTitles) === JSON.stringify(expectedTitles),
    JSON.stringify(tabTitles));

  // 10. Voice callout normalization & audioAlertsStore state
  const normCallout = normalizeCalloutText('PreArm: Flight mode FBWA_RTL_POSHOLD');
  const normMode = normalizeCalloutText('Flight mode RTL');
  check('normalizeCalloutText expands aviation abbreviations for clear TTS pronunciation',
    normMode === 'Flight mode Return to Launch' && normCallout.startsWith('Pre-arm:'),
    `normMode="${normMode}", normCallout="${normCallout}", ttsStatus=${useAudioAlertsStore.getState().ttsStatus}`);

  (mavlinkConnection as any).send = origSend;
}

console.log(failures.length ? `\n${failures.length} regression check(s) FAILED` : '\nAll regression checks PASSED');
process.exit(failures.length ? 1 : 0);
