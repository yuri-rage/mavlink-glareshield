/**
 * The Takeoff checklist's Auto: Takeoff (src/lib/autoTakeoff.ts) against ArduCopter SITL: its stand-down never
 * forces a disarm, so an Abort on the ground disarms and an Abort in the climb holds (LOITER) with the motors on,
 * offering the operator a forced disarm, which ArduCopter carries out in the air when confirmed.
 * Not part of `npm test`.
 *
 *   build/sitl/bin/arducopter -w --model + --defaults Tools/autotest/default_params/copter.parm --home 35,-106,1600,0 -I0
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56790 --allow-all-origins
 *   npx tsx tests/sitl/autoTakeoff.sitl.ts
 */
export {};
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { mavlinkConnection } = await import('../../src/mavlink/connection.ts');
const { useTelemetryStore, sendTrackedCommand } = await import('../../src/store/telemetryStore.ts');
const { AutoTakeoffSequence } = await import('../../src/lib/autoTakeoff.ts');
const { offerForceDisarm } = await import('../../src/lib/forceDisarm.ts');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const quiet = console.log;
console.log = () => {};
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  quiet(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const until = async (cond: () => boolean, ms: number) => {
  for (let t = 0; t < ms && !cond(); t += 100) await sleep(100);
  return cond();
};
mavlinkConnection.setLink({ kind: 'websocket', url: process.env.SITL_WS ?? 'ws://127.0.0.1:56790/' });
mavlinkConnection.connect();
const st = () => useTelemetryStore.getState();
await until(() => st().heartbeat.systemId > 0 && st().heartbeat.lastHeartbeatTime > 0, 60_000);
const sys = st().heartbeat.systemId;
const enc = mavlinkConnection.getEncoder();
// No widgets ask for streams here: SYS_STATUS, GPS_RAW_INT and GLOBAL_POSITION_INT at 5 Hz (SET_MESSAGE_INTERVAL), and home.
for (const id of [1, 24, 33]) mavlinkConnection.send(enc.createCommandLong(sys, 1, 511, [id, 200_000, 0, 0, 0, 0, 0]));
mavlinkConnection.send(enc.createRequestMessage(sys, 1, 242));
// Ready to arm: a 3D fix and the EKF's home.
const enoughGps = await until(() => st().gps.fixType >= 3 && st().homePosition.source !== 'none', 120_000);
check('SITL: GPS fix and home', enoughGps);
// Pre-arm checks passing (SYS_STATUS's MAV_SYS_STATUS_PREARM_CHECK healthy): the EKF has settled on GPS.
const PREARM = 0x10000000;
check('SITL: pre-arm checks pass', await until(() => (st().sysStatus.sensorsHealth & PREARM) !== 0, 120_000));
// GUIDED arms only with a position estimate: the EKF reports when it is using GPS.
const usingGps = () => st().statusMessages.some((m: any) => /is using GPS/.test(m.text));
check('SITL: EKF using GPS', await until(usingGps, 120_000));
await sleep(3000);

// Every command the sequence sends, with its answer.
const log: { label: string; result: number; force: boolean }[] = [];
const forceSend = async (packet: Uint8Array, meta: { label: string; targetKey: string }) => {
  // COMMAND_LONG param2 (bytes 14..17 of the payload): 21196 is the force code.
  const p2 = new DataView(packet.buffer, packet.byteOffset + 10 + 4, 4).getFloat32(0, true);
  const ack = await sendTrackedCommand(packet, meta);
  log.push({ label: meta.label, result: ack.result, force: p2 === 21196 });
  return ack;
};
/** `holdTakeoffAck`: the NAV_TAKEOFF ACK is held back until this is true (a slow link), so an Abort can come in the
 * climb. ArduCopter answers it at once, and the sequence (and its Abort button) ends there. */
const sequence = (holdTakeoffAck?: () => boolean) => {
  const steps: string[] = [];
  let refused = 0;
  const seq = new AutoTakeoffSequence(
    {
      sysId: sys,
      compId: 1,
      fixedWing: false,
      takeoffModeNum: 4, // GUIDED
      takeoffModeLabel: 'GUIDED',
      holdModeNum: 5, // LOITER
      altM: 20,
      dispAlt: '20 m',
    },
    {
      send: async (packet, meta) => {
        const ack = await forceSend(packet, meta);
        if (holdTakeoffAck && /^Takeoff \(/.test(meta.label)) await until(holdTakeoffAck, 60_000);
        return ack;
      },
      encoder: enc,
      vehicle: () => st().heartbeat,
      wait: sleep,
      onStep: (t) => t && steps.push(t),
      onError: () => {},
      onDisarmRefused: () => refused++,
    }
  );
  return { seq, steps, refused: () => refused };
};

// 1. Abort in the climb: the disarm is refused (flying), the vehicle holds in LOITER with the motors on.
{
  log.length = 0;
  const { seq, steps, refused } = sequence(() => st().position.relativeAlt > 4);
  void seq.run();
  const climbing = await until(
    () => steps.some((s) => s.startsWith('Step 3')) && st().position.relativeAlt > 4,
    60_000
  );
  if (!climbing)
    quiet(
      '  status:',
      st()
        .statusMessages.slice(0, 6)
        .map((m: any) => m.text)
        .join(' | ')
    );
  check('climbing after NAV_TAKEOFF', climbing, `alt ${st().position.relativeAlt.toFixed(1)} m`);
  seq.abort();
  await until(() => log.some((l) => /Hold/.test(l.label)), 15_000);
  await sleep(3000);
  const disarm = log.find((l) => /Safety Disarm/.test(l.label));
  check('abort in the climb: disarm sent without the force code', !!disarm && !disarm.force, JSON.stringify(log));
  check('abort in the climb: ArduCopter refused it (flying)', disarm?.result === 4, `result ${disarm?.result}`);
  check(
    'abort in the climb: still armed, in LOITER, in the air',
    st().heartbeat.isArmed && st().heartbeat.modeName === 'LOITER' && st().position.relativeAlt > 3,
    `${st().heartbeat.modeName}, armed ${st().heartbeat.isArmed}, alt ${st().position.relativeAlt.toFixed(1)} m`
  );
  check(
    'never forced',
    log.every((l) => !l.force)
  );
  check('abort in the climb: the refused disarm offers a forced one', refused() === 1);
}

// Land and wait for the disarm.
mavlinkConnection.send(enc.createSetMode(sys, 1, 9)); // LAND
const landed = await until(() => !st().heartbeat.isArmed, 120_000);
check('landed and disarmed', landed);
await until(() => (st().sysStatus.sensorsHealth & PREARM) !== 0, 30_000);
await sleep(3000);

// 2. Abort while the arm is on its way: the sequence waits for its ACK, then disarms (accepted on the ground).
{
  log.length = 0;
  const { seq, steps } = sequence();
  void seq.run();
  await until(() => steps.some((s) => s.startsWith('Step 2')), 20_000);
  seq.abort();
  await until(() => log.some((l) => /Safety Disarm/.test(l.label)), 15_000);
  await sleep(2000);
  const disarm = log.find((l) => /Safety Disarm/.test(l.label));
  check('abort on the ground: disarm accepted', disarm?.result === 0 && !disarm.force, JSON.stringify(log));
  check(
    'abort on the ground: disarmed, no takeoff sent',
    !st().heartbeat.isArmed && !log.some((l) => /Takeoff \(/.test(l.label))
  );
}

// 3. The offered force disarm, confirmed, in the air: ArduCopter stops the motors (the vehicle falls; SITL only).
{
  log.length = 0;
  const { seq, steps } = sequence();
  void seq.run();
  const up = await until(() => steps.some((s) => s.startsWith('Step 3')) && st().position.relativeAlt > 8, 60_000);
  check('climbing again', up, `alt ${st().position.relativeAlt.toFixed(1)} m`);
  const ack = await offerForceDisarm(sys, 1, { ask: async () => true, send: forceSend, encoder: enc });
  const down = await until(() => !st().heartbeat.isArmed, 5000);
  check(
    'confirmed force disarm in the air: sent with 21196, accepted, disarmed',
    ack?.result === 0 && log.some((l) => l.force) && down,
    `result ${ack?.result}, armed ${st().heartbeat.isArmed}, alt ${st().position.relativeAlt.toFixed(1)} m`
  );
}

quiet(
  failures.length ? `\n${failures.length} SITL auto-takeoff check(s) FAILED` : '\nAll SITL auto-takeoff checks PASSED'
);
mavlinkConnection.disconnect();
process.exit(failures.length ? 1 : 0);
