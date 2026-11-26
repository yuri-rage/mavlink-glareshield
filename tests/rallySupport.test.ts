/**
 * Whether the vehicle takes rally points, as the telemetry store learns it: the AUTOPILOT_VERSION capability bit
 * confirms support, a missing bit proves nothing, an explicit "unsupported" stands, and another vehicle (or a new
 * connection) starts over. The mission manager's side (the vehicle's MAV_MISSION_UNSUPPORTED answer) is tested
 * against the simulated vehicle in ftp_ardupilot.test.ts.
 *
 * Run: npx tsx tests/rallySupport.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { useTelemetryStore, CAPABILITY_MISSION_RALLY } = await import('../src/store/telemetryStore.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MavlinkParser, decodePayload } = await import('../src/mavlink/parser.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const parser = new MavlinkParser();
const vehicle = (sysId: number) => new MavlinkEncoder(sysId, 1);
const feed = (bytes: Uint8Array) => {
  for (const p of parser.parse(bytes)) useTelemetryStore.getState().processPacket(p);
};

/** AUTOPILOT_VERSION with the given capabilities (low 32 bits) and firmware 4.6.0. */
function autopilotVersion(sysId: number, capabilities: number): Uint8Array {
  const payload = new Uint8Array(78);
  const v = new DataView(payload.buffer);
  v.setUint32(0, capabilities, true);
  v.setUint32(16, (4 << 24) | (6 << 16) | (0 << 8) | 255, true);
  return vehicle(sysId).packV2(MAVLINK_MSG_ID.AUTOPILOT_VERSION, payload);
}
const heartbeat = (sysId: number) =>
  vehicle(sysId).packV2(
    MAVLINK_MSG_ID.HEARTBEAT,
    new Uint8Array([0, 0, 0, 0, /*quad*/ 2, /*ArduPilot*/ 3, /*disarmed*/ 0x01, 4, 3])
  );

// Decoding
{
  const payload = new Uint8Array(78);
  new DataView(payload.buffer).setUint32(0, CAPABILITY_MISSION_RALLY | 4, true);
  const d = decodePayload(MAVLINK_MSG_ID.AUTOPILOT_VERSION, payload);
  check(
    'AUTOPILOT_VERSION: capabilities decoded',
    (d.capabilities & CAPABILITY_MISSION_RALLY) !== 0 && (d.capabilities & 4) !== 0,
    String(d.capabilities)
  );
}

feed(heartbeat(1));
check('starts unknown', useTelemetryStore.getState().rallySupport === 'unknown');

feed(autopilotVersion(1, 4)); // MISSION_INT only
check('capability bit absent: still unknown, not unsupported', useTelemetryStore.getState().rallySupport === 'unknown');

feed(autopilotVersion(1, 4 | CAPABILITY_MISSION_RALLY));
check('capability bit set: supported', useTelemetryStore.getState().rallySupport === 'supported');

useTelemetryStore.setState({ rallySupport: 'unsupported' });
feed(autopilotVersion(1, 4 | CAPABILITY_MISSION_RALLY));
check(
  'an explicit "unsupported" answer stands over the bit',
  useTelemetryStore.getState().rallySupport === 'unsupported'
);

// Another vehicle: start over. (The store only switches vehicle after 10 s of silence from the first.)
{
  const realNow = Date.now;
  Date.now = () => realNow() + 20000;
  feed(heartbeat(2));
  Date.now = realNow;
  check(
    'another vehicle: back to unknown',
    useTelemetryStore.getState().heartbeat.systemId === 2 && useTelemetryStore.getState().rallySupport === 'unknown',
    `${useTelemetryStore.getState().heartbeat.systemId} ${useTelemetryStore.getState().rallySupport}`
  );
}

// The same vehicle back after a silence (rebooted, reflashed, another SITL binary): start over too.
{
  useTelemetryStore.setState({ rallySupport: 'unsupported' });
  feed(heartbeat(2)); // still talking: kept
  check('same vehicle, still talking: kept', useTelemetryStore.getState().rallySupport === 'unsupported');
  const realNow = Date.now;
  Date.now = () => realNow() + 60000;
  feed(heartbeat(2));
  Date.now = realNow;
  check('same vehicle back after a silence: back to unknown', useTelemetryStore.getState().rallySupport === 'unknown');
}

console.log(
  failures.length ? `\n${failures.length} rally support check(s) FAILED` : '\nAll rally support checks PASSED'
);
process.exit(failures.length ? 1 : 0);
