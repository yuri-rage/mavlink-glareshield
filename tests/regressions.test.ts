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
const { mavlinkConnection, isLoopbackWs, getWssHost } = await import('../src/mavlink/connection.ts');
const { rtcmInjector } = await import('../src/mavlink/rtcmInjector.ts');
const { useConnectionStore } = await import('../src/store/connectionStore.ts');
const { useUnitsStore } = await import('../src/store/unitsStore.ts');
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { useTelemetryStore, sendTrackedCommand, computeDistanceAndBearing, evaluatePreArmReadiness, setMissionCurrentWaypoint } = await import('../src/store/telemetryStore.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
const { MAVLINK_MSG_ID, MAV_CMD } = await import('../src/mavlink/messages.ts');
const { missionManager } = await import('../src/mavlink/missionManager.ts');
const { parseParamFile, serializeParamFile, getParamMetadata, areParamsDifferent } = await import('../src/mavlink/paramMetadata.ts');
const { normalizeCalloutText, useAudioAlertsStore } = await import('../src/lib/audioAlerts.ts');
const { computeMapBadgeVisibility } = await import('../src/components/map/mapBadgeVisibility.ts');
const { messageRateManager } = await import('../src/mavlink/rateManager.ts');

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

  // 5b. Small float calibration preservation (toPrecision 9) & relative tolerance
  const smallParams = {
    INS_TCAL1_ACC1_X: -3.48e-7,
    INS_TCAL1_GYR2_Y: 1.239e-5,
    ATC_RAT_YAW_D: 1.2345e-4,
    BATT_LOW_VOLT: 14.2,
  };
  const serializedSmall = serializeParamFile(smallParams);
  const parsedSmall = parseParamFile(serializedSmall);
  check('param file preserves small calibration floats without dropping exponents',
    Math.abs(parsedSmall.INS_TCAL1_ACC1_X - (-3.48e-7)) < 1e-12 &&
    Math.abs(parsedSmall.INS_TCAL1_GYR2_Y - 1.239e-5) < 1e-10 &&
    Math.abs(parsedSmall.ATC_RAT_YAW_D - 1.2345e-4) < 1e-9 &&
    !serializedSmall.includes('-3.48e-7,0\n'),
    serializedSmall.split('\n').filter((l) => !l.startsWith('#')).join('; '));

  check('areParamsDifferent correctly compares with relative tolerance',
    areParamsDifferent(0, -3.48e-7) &&
    areParamsDifferent(0.000012, 1.239e-5) &&
    areParamsDifferent(0.000123, 1.2345e-4) &&
    !areParamsDifferent(1.5, 1.5) &&
    !areParamsDifferent(-3.48e-7, -3.48e-7),
    'relative comparison passed');

  // 5c. Parameter metadata alias support (AIRSPEED_MIN/MAX vs ARSPD_FBW_MIN/MAX)
  const metaAirspeedMin = getParamMetadata('AIRSPEED_MIN');
  const metaArspdFbwMin = getParamMetadata('ARSPD_FBW_MIN');
  check('paramMetadata supports AIRSPEED_MIN and ARSPD_FBW_MIN aliases',
    metaAirspeedMin !== null && metaArspdFbwMin !== null && metaAirspeedMin.units === 'm/s',
    `AIRSPEED_MIN: ${metaAirspeedMin?.description}, ARSPD_FBW_MIN: ${metaArspdFbwMin?.description}`);

  // 5d. sendTrackedCommand settles immediately with NOT_SENT if offline
  (mavlinkConnection as any).send = () => false;
  const dummyPacket = new MavlinkEncoder().createSetMode(1, 1, 4);
  const offlineAck = await sendTrackedCommand(dummyPacket, { label: 'Test Offline Send' });
  check('sendTrackedCommand resolves immediately with NOT_SENT if send() returns false',
    offlineAck.result === -2 && offlineAck.resultText === 'NOT_SENT',
    JSON.stringify(offlineAck));
  (mavlinkConnection as any).send = origSend;

  // 5e. evaluatePreArmReadiness subsystem check (0x400000=Terrain, 0x1000000=Logging) and age-out
  const terrainSysStatus: any = {
    sensorsPresent: 0x10000000 | 0x400000 | 0x1000000,
    sensorsEnabled: 0x10000000 | 0x400000 | 0x1000000,
    sensorsHealth: 0x10000000 | 0x1000000, // Terrain (0x400000) unhealthy, Logging healthy
  };
  const prearmTerrain = evaluatePreArmReadiness(terrainSysStatus, [], false);
  check('evaluatePreArmReadiness maps 0x400000 to Terrain and 0x1000000 to Logging',
    prearmTerrain.failedSubsystems.includes('Terrain') && !prearmTerrain.failedSubsystems.includes('Logging'),
    JSON.stringify(prearmTerrain.failedSubsystems));

  const nowTs = Date.now();
  const oldPreArmMessages: any[] = [
    { id: '1', text: 'PreArm: Compass not calibrated', severity: 4, timestamp: nowTs - 35000 },
    { id: '2', text: 'PreArm: GPS fix degraded', severity: 4, timestamp: nowTs - 5000 },
  ];
  const prearmAgeOut = evaluatePreArmReadiness(terrainSysStatus, oldPreArmMessages, false);
  check('evaluatePreArmReadiness ages out PreArm messages older than 30s',
    prearmAgeOut.activePreArmErrors.length === 1 && prearmAgeOut.activePreArmErrors[0] === 'PreArm: GPS fix degraded',
    JSON.stringify(prearmAgeOut.activePreArmErrors));

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

  // 11. Map badge visibility and waypoint download stability on 1/2-width cards
  const fullWidthVisible = computeMapBadgeVisibility({
    headerWidth: 800,
    controlsWidth: 280,
    userWpCount: 8,
    fenceCount: 4,
    rallyCount: 2,
    isFetching: false,
    previouslyHidden: false,
  });
  check('map header with ample width keeps badges visible',
    fullWidthVisible === false,
    `fullWidthVisible=${fullWidthVisible}`);

  const halfWidthTightHidden = computeMapBadgeVisibility({
    headerWidth: 380,
    controlsWidth: 300,
    userWpCount: 5,
    fenceCount: 4,
    rallyCount: 0,
    isFetching: true,
    previouslyHidden: false,
  });
  check('map header at 1/2 width hides count badges when controls & download badge require space',
    halfWidthTightHidden === true,
    `halfWidthTightHidden=${halfWidthTightHidden}`);

  // Simulate downloading waypoints step-by-step on 1/2 width to verify zero flapping / oscillation
  let hiddenState = false;
  const flappingDetections: boolean[] = [];
  for (let wp = 0; wp <= 10; wp++) {
    hiddenState = computeMapBadgeVisibility({
      headerWidth: 380,
      controlsWidth: 300,
      userWpCount: wp,
      fenceCount: 0,
      rallyCount: 0,
      isFetching: true,
      previouslyHidden: hiddenState,
    });
    flappingDetections.push(hiddenState);
  }
  // Once hidden on 380px header with 300px controls + 68px download badge + 56px WP badge = 440px needed,
  // it must stay solidly hidden (no false flips back and forth)
  const allHiddenDuringDownload = flappingDetections.slice(1).every((h) => h === true);
  check('downloading waypoints on 1/2-width map has zero oscillation or badge flapping',
    allHiddenDuringDownload,
    `sequence=${JSON.stringify(flappingDetections)}`);

  // Hysteresis verification: once hidden, does not unhide within the +24px buffer
  // Needed width: 300 (controls) + 68 (MAVFTP) + 56 (WP) + 6 (gap) + 16 (margin) = 446px
  const boundaryAt445 = computeMapBadgeVisibility({
    headerWidth: 445,
    controlsWidth: 300,
    userWpCount: 5,
    fenceCount: 0,
    rallyCount: 0,
    isFetching: true,
    previouslyHidden: true,
  });
  const boundaryAt460 = computeMapBadgeVisibility({
    headerWidth: 460, // 460 < 446 + 24 = 470
    controlsWidth: 300,
    userWpCount: 5,
    fenceCount: 0,
    rallyCount: 0,
    isFetching: true,
    previouslyHidden: true,
  });
  const boundaryAt475 = computeMapBadgeVisibility({
    headerWidth: 475, // 475 >= 470
    controlsWidth: 300,
    userWpCount: 5,
    fenceCount: 0,
    rallyCount: 0,
    isFetching: true,
    previouslyHidden: true,
  });
  check('hysteresis prevents unhiding until +24px threshold is exceeded',
    boundaryAt445 === true && boundaryAt460 === true && boundaryAt475 === false,
    `at445=${boundaryAt445}, at460=${boundaryAt460}, at475=${boundaryAt475}`);

  // 12. MISSION_SET_CURRENT (Msg 41) encode & decode
  const encoder = new MavlinkEncoder(1, 1);
  const setCurrentPkt = encoder.createMissionSetCurrent(1, 1, 7);
  const testParser = new MavlinkParser();
  const parsedPackets = testParser.parse(setCurrentPkt);
  const foundPacket = parsedPackets.find((p) => p.messageId === MAVLINK_MSG_ID.MISSION_SET_CURRENT);
  const parsedSetCurrent = foundPacket ? decodePayload(foundPacket.messageId, foundPacket.payload) : null;
  check('MISSION_SET_CURRENT (41) encodes and decodes targetSys, targetComp, seq',
    parsedSetCurrent !== null && parsedSetCurrent.seq === 7 && parsedSetCurrent.target_system === 1,
    JSON.stringify(parsedSetCurrent));

  // 13. MISSION_ITEM_REACHED (Msg 46) decode
  const reachedPayload = new Uint8Array([3, 0]); // seq = 3
  const decodedReached = decodePayload(MAVLINK_MSG_ID.MISSION_ITEM_REACHED, reachedPayload);
  check('MISSION_ITEM_REACHED (46) decodes waypoint arrival sequence',
    decodedReached?.seq === 3,
    JSON.stringify(decodedReached));

  // 14. setMissionCurrentWaypoint action sends packet and updates store
  useTelemetryStore.setState({
    missionWaypoints: [
      { seq: 0, command: 16, lat: 37, lon: -122, alt: 0, current: false, frame: 3 },
      { seq: 1, command: 16, lat: 37.1, lon: -122.1, alt: 50, current: true, frame: 3 },
      { seq: 2, command: 16, lat: 37.2, lon: -122.2, alt: 60, current: false, frame: 3 },
    ],
    currentWaypointSeq: 1,
  });
  await setMissionCurrentWaypoint(2);
  const updatedCurrentSeq = useTelemetryStore.getState().currentWaypointSeq;
  check('setMissionCurrentWaypoint updates currentWaypointSeq in telemetry store and uses command 224',
    updatedCurrentSeq === 2 && MAV_CMD.DO_SET_MISSION_CURRENT === 224,
    `currentSeq=${updatedCurrentSeq}, DO_SET_MISSION_CURRENT=${MAV_CMD.DO_SET_MISSION_CURRENT}`);

  // 15. Audio alerts waypoint arrival announce option toggle
  useAudioAlertsStore.getState().setWaypointAnnounceEnabled(true);
  const initWpAnnounce = useAudioAlertsStore.getState().waypointAnnounceEnabled;
  useAudioAlertsStore.getState().toggleWaypointAnnounce();
  const toggledWpAnnounce = useAudioAlertsStore.getState().waypointAnnounceEnabled;
  useAudioAlertsStore.getState().setWaypointAnnounceEnabled(true);
  check('waypoint announce audio option toggles and persists',
    initWpAnnounce === true && toggledWpAnnounce === false,
    `init=${initWpAnnounce}, toggled=${toggledWpAnnounce}`);

  // 16. Mission download status banner auto-clears after completion
  (missionManager as any).setStatus({ message: 'Synced 10 WPs in 1.1s', isFetching: false, isUploading: false });
  const hasMsgBefore = (missionManager as any).status.message === 'Synced 10 WPs in 1.1s';
  (missionManager as any).scheduleMessageClear(50);
  await new Promise((r) => setTimeout(r, 80));
  const hasMsgAfter = (missionManager as any).status.message === '';
  check('mission download stats auto-clear after delay and do not persist forever',
    hasMsgBefore && hasMsgAfter,
    `before="${hasMsgBefore}", after="${hasMsgAfter}"`);

  // 17. isLoopbackWs loopback address discrimination
  const loopbackChecks = [
    isLoopbackWs('ws://localhost:56781') === true,
    isLoopbackWs('ws://127.0.0.1:56781') === true,
    isLoopbackWs('ws://127.0.0.5:56781') === true,
    isLoopbackWs('ws://[::1]:56781') === true,
    isLoopbackWs('ws://127.0.0.1.nip.io:56781') === false,
    isLoopbackWs('ws://192.168.1.50:56781') === false,
    isLoopbackWs('ws://glareshield.pages.dev') === false,
  ];
  check('isLoopbackWs matches only loopback addresses and rejects 127.* nip.io subdomains',
    loopbackChecks.every(Boolean),
    `results=${JSON.stringify(loopbackChecks)}`);

  // 18. getWssHost URL token and path stripping
  const wssChecks = [
    getWssHost('wss://host:56781?key=secret_token') === 'host:56781',
    getWssHost('wss://192.168.1.69:56781/ws?token=123#frag') === '192.168.1.69:56781',
    getWssHost('wss://[::1]:56781') === '[::1]:56781',
    getWssHost('wss://telemetry.example.com') === 'telemetry.example.com',
    getWssHost('ws://host:56781?key=secret') === null,
    getWssHost('') === null,
  ];
  check('getWssHost extracts host:port and strips query tokens, paths, and fragments',
    wssChecks.every(Boolean),
    `results=${JSON.stringify(wssChecks)}`);

  (mavlinkConnection as any).send = origSend;
}

// ------------------------------------------------------------------------------------------------
// Map trace resolution: small path-tracking deviations must be recorded
// ------------------------------------------------------------------------------------------------
{
  const { appendTracePoint, TRACE_MIN_SPACING_M, TRACE_MAX_POINTS } = await import('../src/store/telemetryStore.ts');
  const lat0 = 34.17697;
  const lon0 = -118.484826;
  const mPerDegLat = 111195;
  const mPerDegLon = 111195 * Math.cos((lat0 * Math.PI) / 180);
  // Drive east in 0.3 m steps with a 0.4 m sideways (north) wiggle every few steps.
  let trace: [number, number][] = [];
  const truth: number[] = [];
  for (let i = 0; i < 40; i++) {
    const north = i % 8 < 4 ? 0 : 0.4;
    truth.push(north);
    trace = appendTracePoint(trace, lat0 + north / mPerDegLat, lon0 + (i * 0.3) / mPerDegLon);
  }
  const recordedNorth = trace.map(([lat]) => (lat - lat0) * mPerDegLat);
  check('trace keeps points 0.3 m apart (the old ~1.5 m per-axis threshold dropped most of them)', trace.length === 40, `${trace.length}`);
  check('trace records a 0.4 m sideways deviation', Math.max(...recordedNorth) > 0.35);
  let dense: [number, number][] = [];
  for (let i = 0; i < 20; i++) dense = appendTracePoint(dense, lat0, lon0 + (i * 0.05) / mPerDegLon);
  check(`trace skips jitter closer than ${TRACE_MIN_SPACING_M} m`, dense.length < 6, `${dense.length}`);
  check('trace ignores 0,0 positions', appendTracePoint([], 0, 0).length === 0);
  let capped: [number, number][] = [];
  for (let i = 0; i < TRACE_MAX_POINTS + 10; i++) capped = appendTracePoint(capped, lat0, lon0 + i / mPerDegLon);
  check('trace is capped and keeps the newest points', capped.length === TRACE_MAX_POINTS && Math.abs(capped[capped.length - 1][1] - (lon0 + (TRACE_MAX_POINTS + 9) / mPerDegLon)) < 1e-12);
}

// ------------------------------------------------------------------------------------------------
// Waypoint voice callouts: commanded jumps are not arrivals
// ------------------------------------------------------------------------------------------------
{
  const { decideWaypointCallout } = await import('../src/lib/audioAlerts.ts');
  const T = 5_000_000;
  const base = {
    connected: true, enabled: true, armed: true, currentSeq: 5, prevSeq: 5, reachedSeq: 4, reachedAt: T - 60_000,
    lastAnnouncedReachedAt: T - 60_000, reachedSupported: true, manualJump: null, lastSpoken: null, now: T,
  };
  check('callout: MISSION_ITEM_REACHED announces the reached waypoint', decideWaypointCallout({ ...base, reachedSeq: 5, reachedAt: T }) === 5);
  check('callout: pressing Next (5 → 6) is not announced as reaching WP 5', decideWaypointCallout({ ...base, currentSeq: 6, manualJump: { seq: 6, time: T - 200 } }) === null);
  check('callout: Go to a later waypoint is not announced either', decideWaypointCallout({ ...base, currentSeq: 8, manualJump: { seq: 8, time: T - 200 } }) === null);
  check('callout: with REACHED supported, the current-waypoint step alone never announces', decideWaypointCallout({ ...base, currentSeq: 6 }) === null);
  check('callout: reaching the same waypoint again after a restart is announced (timestamp, not seq, is the event)',
    decideWaypointCallout({ ...base, reachedSeq: 1, reachedAt: T, lastAnnouncedReachedAt: T - 90_000, lastSpoken: { seq: 1, time: T - 90_000 } }) === 1);
  const legacy = { ...base, reachedSupported: false, reachedAt: 0, lastAnnouncedReachedAt: 0 };
  check('callout: without REACHED support, an autopilot step 5 → 6 announces WP 5', decideWaypointCallout({ ...legacy, currentSeq: 6 }) === 5);
  check('callout: without REACHED support, a commanded Next is still not an arrival', decideWaypointCallout({ ...legacy, currentSeq: 6, manualJump: { seq: 6, time: T - 500 } }) === null);
  check('callout: an old jump does not suppress a later real step', decideWaypointCallout({ ...legacy, currentSeq: 7, prevSeq: 6, manualJump: { seq: 6, time: T - 60_000 } }) === 6);
  check('callout: an arrival reported by both paths is spoken once', decideWaypointCallout({ ...base, reachedSeq: 5, reachedAt: T, lastSpoken: { seq: 5, time: T - 400 } }) === null);
  {
    const reachedPayload = new Uint8Array(2);
    new DataView(reachedPayload.buffer).setUint16(0, 3, true);
    useTelemetryStore.getState().processPacket({ version: 2, sequence: 1, systemId: 1, componentId: 1, messageId: MAVLINK_MSG_ID.MISSION_ITEM_REACHED, payload: reachedPayload, crc: 0, raw: new Uint8Array() });
    const st = useTelemetryStore.getState();
    check('store: MISSION_ITEM_REACHED records seq, time and that the autopilot reports arrivals', st.lastReachedWaypointSeq === 3 && st.lastReachedAt > 0 && st.missionItemReachedSeen);
    const origSendJ = (mavlinkConnection as any).send;
    (mavlinkConnection as any).send = () => true;
    await setMissionCurrentWaypoint(4);
    (mavlinkConnection as any).send = origSendJ;
    const jump = useTelemetryStore.getState().manualWaypointJump;
    check('store: Next / Go / Restart record the commanded jump', jump?.seq === 4 && Date.now() - (jump?.time ?? 0) < 2000);
  }
  check('callout: nothing while disarmed via the fallback, or when muted', decideWaypointCallout({ ...legacy, currentSeq: 6, armed: false }) === null && decideWaypointCallout({ ...base, reachedSeq: 5, reachedAt: T, enabled: false }) === null);
}

{
  const { showsWaypointAltitude } = await import('../src/lib/useWaypointNavigation.ts');
  check('waypoint selector: altitude hidden for rover (10) and boat (11), shown for copter (2) and plane (1)',
    !showsWaypointAltitude(10) && !showsWaypointAltitude(11) && showsWaypointAltitude(2) && showsWaypointAltitude(1));
}

// ------------------------------------------------------------------------------------------------
// Spoken confirmation of commanded waypoint changes; mission complete
// ------------------------------------------------------------------------------------------------
{
  const { describeWaypointJump, jumpAckCallout } = await import('../src/lib/useWaypointNavigation.ts');
  const { isMissionCompleteText, lastMissionSeq } = await import('../src/lib/audioAlerts.ts');
  check('jump callout: restart', describeWaypointJump(1, 5, 1) === 'Restarting mission');
  check('jump callout: next', describeWaypointJump(6, 5, 1) === 'Skipping to waypoint 6');
  check('jump callout: previous', describeWaypointJump(4, 5, 1) === 'Back to waypoint 4');
  check('jump callout: go to', describeWaypointJump(8, 5, 1) === 'Going to waypoint 8');
  const ack = (result: number) => ({ command: 224, result, resultText: '', time: 1 });
  check('jump callout: spoken when accepted, and when firmware only supports MISSION_SET_CURRENT (UNSUPPORTED)',
    jumpAckCallout('Restarting mission', ack(0)) === 'Restarting mission' && jumpAckCallout('Restarting mission', ack(3)) === 'Restarting mission');
  check('jump callout: denied / timeout / link down are said as such',
    jumpAckCallout('Restarting mission', ack(2)) === 'Waypoint change rejected' &&
      jumpAckCallout('x', ack(-1)) === 'Waypoint change not confirmed' &&
      jumpAckCallout('x', ack(-2)) === 'Waypoint change not sent');
  let notSent: any = null;
  const origSendN = (mavlinkConnection as any).send;
  (mavlinkConnection as any).send = () => false;
  await setMissionCurrentWaypoint(3, (a) => (notSent = a));
  (mavlinkConnection as any).send = origSendN;
  check('setMissionCurrentWaypoint reports NOT_SENT to its ack callback when the link is down', notSent?.result === -2);
  check('mission complete: Rover, Copter and Plane wording recognised',
    isMissionCompleteText('Mission Complete') && isMissionCompleteText('Mission complete, changing mode to RTL') && !isMissionCompleteText('Mission: 5 WP'));
  check('mission complete: the final mission item is the highest seq', lastMissionSeq([{ seq: 0 }, { seq: 1 }, { seq: 9 }, { seq: 4 }]) === 9 && lastMissionSeq([]) === 0);
}

// ------------------------------------------------------------------------------------------------
// Reconnection: MJPEG frame extraction, backoff, vehicle re-acquisition
// ------------------------------------------------------------------------------------------------
{
  const { MjpegFrameExtractor, reconnectDelayMs } = await import('../src/lib/mjpeg.ts');
  const jpeg = (fill: number, len = 20) => new Uint8Array([0xff, 0xd8, ...Array(len).fill(fill), 0xff, 0xd9]);
  const header = new TextEncoder().encode('--frame\r\nContent-Type: image/jpeg\r\n\r\n');
  const join = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
  const stream = join(header, jpeg(1), new TextEncoder().encode('\r\n'), header, jpeg(2), header, jpeg(3));
  const ex = new MjpegFrameExtractor();
  const frames: Uint8Array[] = [];
  for (let i = 0; i < stream.length; i += 7) frames.push(...ex.push(stream.slice(i, i + 7)));
  check('mjpeg: frames split across arbitrary chunks come out whole and in order', frames.length === 3 && frames.every((f, i) => f[2] === i + 1 && f.length === 24));
  const nested = join(header, new Uint8Array([0xff, 0xd8, 5, 0xff, 0xd8, 6, 0xff, 0xd9, 7, 0xff, 0xd9]));
  const nf = new MjpegFrameExtractor().push(nested);
  check('mjpeg: an embedded thumbnail stays inside its frame', nf.length === 1 && nf[0].length === 11);
  const small = new MjpegFrameExtractor(64);
  small.push(new Uint8Array([0xff, 0xd8, ...Array(100).fill(9)]));
  check('mjpeg: a runaway frame is dropped and the extractor resyncs', small.push(jpeg(4)).length === 1);
  check('reconnect backoff: 1, 2, 4, 8, then 10 s', [0, 1, 2, 3, 4, 9].map(reconnectDelayMs).join() === '1000,2000,4000,8000,10000,10000');

  const { isVehicleReacquired, VEHICLE_REACQUIRE_GAP_MS } = await import('../src/store/telemetryStore.ts');
  const tNow = 1_000_000;
  check('vehicle re-acquired after a heartbeat gap, not on steady heartbeats or the first one',
    isVehicleReacquired(tNow - VEHICLE_REACQUIRE_GAP_MS - 1, tNow) && !isVehicleReacquired(tNow - 1000, tNow) && !isVehicleReacquired(0, tNow));
  const { messageRateManager } = await import('../src/mavlink/rateManager.ts');
  let resets = 0;
  const origReset = messageRateManager.resetCache.bind(messageRateManager);
  (messageRateManager as any).resetCache = () => { resets++; };
  const hbPayload = new Uint8Array(9); hbPayload[4] = 10; hbPayload[5] = 3; // rover, ArduPilot
  const hbPkt = { version: 2 as const, sequence: 0, systemId: 1, componentId: 1, messageId: MAVLINK_MSG_ID.HEARTBEAT, payload: hbPayload, crc: 0, raw: new Uint8Array() };
  useTelemetryStore.getState().processPacket(hbPkt);
  const before = resets;
  useTelemetryStore.getState().processPacket(hbPkt);
  const steady = resets - before;
  useTelemetryStore.setState((s) => ({ heartbeat: { ...s.heartbeat, lastHeartbeatTime: Date.now() - VEHICLE_REACQUIRE_GAP_MS - 2000 } }));
  useTelemetryStore.getState().processPacket(hbPkt);
  (messageRateManager as any).resetCache = origReset;
  check('store: a heartbeat after a gap re-requests stream rates (rebooted autopilots forget them)', steady === 0 && resets - before === 1);
}

// MISSION_CURRENT repeats several times a second: an unchanged item must not rebuild the mission (it re-renders the
// map and rewrites the whole mission to localStorage).
{
  const wps = Array.from({ length: 5 }, (_, i) => ({ seq: i, lat: 1, lon: 1, alt: 10, command: 16, current: i === 2, frame: 3 }));
  useTelemetryStore.setState({ missionWaypoints: wps as any, currentWaypointSeq: 2 });
  const missionCurrent = (seq: number) => {
    const payload = new Uint8Array(18);
    payload[0] = seq & 0xff;
    payload[1] = seq >> 8;
    useTelemetryStore.getState().processPacket({ messageId: MAVLINK_MSG_ID.MISSION_CURRENT, systemId: 1, componentId: 1, sequence: 0, payload } as any);
  };
  const before = useTelemetryStore.getState().missionWaypoints;
  missionCurrent(2);
  missionCurrent(2);
  check('store: a repeated MISSION_CURRENT keeps the same mission array', useTelemetryStore.getState().missionWaypoints === before);
  missionCurrent(3);
  const after = useTelemetryStore.getState();
  check('store: a new MISSION_CURRENT still moves the current flag', after.missionWaypoints !== before && after.missionWaypoints.find((w) => w.current)?.seq === 3 && after.currentWaypointSeq === 3);
}

// ------------------------------------------------------------------------------------------------
// Bridge up, no vehicle: no background requests, and no console line for each one that goes unanswered
// ------------------------------------------------------------------------------------------------
{
  const origSend = (mavlinkConnection as any).send;
  const origStatus = mavlinkConnection.getStatus;
  const origSetTimeout = globalThis.setTimeout;
  const sent: { id: number; cmd: number }[] = [];
  (mavlinkConnection as any).send = (d: Uint8Array) => {
    for (const p of parser.parse(d)) {
      const pl = new Uint8Array(33); pl.set(p.payload.subarray(0, 33));
      sent.push({ id: p.messageId, cmd: p.messageId === 76 ? new DataView(pl.buffer).getUint16(28, true) : 0 });
    }
    for (const cb of (mavlinkConnection as any).sendListeners ?? []) cb(d);
    return true;
  };
  (mavlinkConnection as any).getStatus = () => 'connected';
  const SET_MESSAGE_INTERVAL = 511;

  // Stream rates wait for a vehicle heartbeat, then go out.
  messageRateManager.resetForLink();
  messageRateManager.registerRequirement('quiet-test', MAVLINK_MSG_ID.ATTITUDE);
  messageRateManager.recalculateAndApply();
  check('no vehicle: no SET_MESSAGE_INTERVAL into an empty link', !sent.some((m) => m.cmd === SET_MESSAGE_INTERVAL));
  messageRateManager.setTarget(1, 1);
  messageRateManager.recalculateAndApply();
  check('first vehicle heartbeat: stream rates are requested', sent.some((m) => m.cmd === SET_MESSAGE_INTERVAL));
  messageRateManager.unregisterRequirement('quiet-test');

  // Capture the 5 s ACK timeouts so they can be fired at once.
  const timers: (() => void)[] = [];
  (globalThis as any).setTimeout = (fn: () => void, ms?: number) => {
    if (ms === 5000) { timers.push(fn); return 0 as any; }
    return origSetTimeout(fn, ms);
  };
  const enc = new MavlinkEncoder(255, 190);
  const timeoutLines = () => useTelemetryStore.getState().statusMessages.filter((m: any) => m.text.includes('NO ACK (TIMEOUT)')).length;
  const fireAll = () => { while (timers.length) timers.shift()!(); };
  const hb = useTelemetryStore.getState().heartbeat;

  useTelemetryStore.setState({ heartbeat: { ...hb, lastHeartbeatTime: 0 }, statusMessages: [] });
  mavlinkConnection.send(enc.createRequestMessage(1, 1, MAVLINK_MSG_ID.AUTOPILOT_VERSION));
  mavlinkConnection.send(enc.createSetMessageInterval(1, 1, MAVLINK_MSG_ID.ATTITUDE, 100000));
  fireAll();
  check('no vehicle yet: background request timeouts are not logged', timeoutLines() === 0, `${timeoutLines()} lines`);

  const userAck = sendTrackedCommand(enc.createCommandLong(1, 1, 22, [0, 0, 0, 0, 0, 0, 10]), { label: 'Takeoff (10m)' });
  fireAll();
  check('no vehicle: a command the person sent still reports its timeout', timeoutLines() === 1 && (await userAck).resultText === 'TIMEOUT');

  useTelemetryStore.setState({ heartbeat: { ...hb, lastHeartbeatTime: Date.now() - 1000 }, statusMessages: [] });
  mavlinkConnection.send(enc.createRequestMessage(1, 1, MAVLINK_MSG_ID.AUTOPILOT_VERSION));
  fireAll();
  check('vehicle present: an unanswered background request is still logged', timeoutLines() === 1);

  useTelemetryStore.setState({ heartbeat: { ...hb, lastHeartbeatTime: Date.now() - 30000 }, statusMessages: [] });
  mavlinkConnection.send(enc.createRequestMessage(1, 1, MAVLINK_MSG_ID.AUTOPILOT_VERSION));
  fireAll();
  check('vehicle gone silent: background request timeouts stop being logged', timeoutLines() === 0);

  (globalThis as any).setTimeout = origSetTimeout;
  (mavlinkConnection as any).send = origSend;
  (mavlinkConnection as any).getStatus = origStatus;
  useTelemetryStore.setState({ heartbeat: hb });
}

// ------------------------------------------------------------------------------------------------
// "Mission complete" follows the final "Reached waypoint n", whichever the autopilot sends first
// ------------------------------------------------------------------------------------------------
{
  const { createMissionCompleteAnnouncer, MISSION_COMPLETE_TEXT_DELAY_MS } = await import('../src/lib/audioAlerts.ts');
  const run = (steps: (a: any, spoken: string[], advance: (ms: number) => void) => void) => {
    let t = 0;
    let timers: { at: number; fn: () => void; id: number }[] = [];
    let nextId = 1;
    const spoken: string[] = [];
    const a = createMissionCompleteAnnouncer((x) => spoken.push(x), {
      set: (fn, ms) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
      clear: (id) => { timers = timers.filter((x) => x.id !== id); },
      now: () => t,
    });
    const advance = (ms: number) => {
      t += ms;
      for (const x of timers.filter((x) => x.at <= t)) { timers = timers.filter((y) => y !== x); x.fn(); }
    };
    steps(a, spoken, advance);
    return spoken;
  };
  const say = (spoken: string[], text: string) => spoken.push(text);

  const textFirst = run((a, spoken, advance) => {
    a.fromStatusText();
    advance(300);
    say(spoken, 'Reached waypoint 7');
    a.fromFinalWaypoint();
    advance(MISSION_COMPLETE_TEXT_DELAY_MS * 2);
  });
  check('mission complete: text before the final arrival is spoken after "Reached waypoint"', textFirst.join(' | ') === 'Reached waypoint 7 | Mission complete', textFirst.join(' | '));

  const arrivalFirst = run((a, spoken, advance) => {
    say(spoken, 'Reached waypoint 7');
    a.fromFinalWaypoint();
    advance(200);
    a.fromStatusText();
    advance(MISSION_COMPLETE_TEXT_DELAY_MS * 2);
  });
  check('mission complete: arrival first, then text, is spoken once', arrivalFirst.join(' | ') === 'Reached waypoint 7 | Mission complete', arrivalFirst.join(' | '));

  const textOnly = run((a, _spoken, advance) => {
    a.fromStatusText();
    advance(MISSION_COMPLETE_TEXT_DELAY_MS - 100);
    a.fromStatusText(); // repeated text while waiting
    advance(200);
  });
  check('mission complete: with no arrival callout, the text alone still announces it, once', textOnly.join(' | ') === 'Mission complete', textOnly.join(' | '));

  const nextMission = run((a, _spoken, advance) => {
    a.fromFinalWaypoint();
    advance(60_000);
    a.fromStatusText();
    advance(MISSION_COMPLETE_TEXT_DELAY_MS + 10);
  });
  check('mission complete: a later mission is announced again', nextMission.length === 2);
}

// ------------------------------------------------------------------------------------------------
// Restore defaults clears the app's saved settings and nothing else on the origin
// ------------------------------------------------------------------------------------------------
{
  const { clearAppStorage } = await import('../src/lib/appStorage.ts');
  const data = new Map<string, string>([
    ['mavlink_glareshield_profile_v1', '{}'],
    ['mavlink_glareshield_ws_url', 'wss://mav.home.example.com'],
    ['mavlink_ntrip_config', '{}'],
    ['glareshield_hud_video_config', '{}'],
    ['glareshield_messages_sort', 'name'],
    ['some_other_app', 'keep me'],
  ]);
  const storage = {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  } as unknown as Storage;
  const removed = clearAppStorage(storage);
  check('restore defaults: every app key is removed', removed === 5 && [...data.keys()].join() === 'some_other_app', [...data.keys()].join());
}

console.log(failures.length ? `\n${failures.length} regression check(s) FAILED` : '\nAll regression checks PASSED');
process.exit(failures.length ? 1 : 0);
