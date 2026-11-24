/**
 * Geofence planning against ArduCopter SITL: upload and read back over MAVFTP and item-by-item, then show what the
 * upload safety check guards against: a new fence takes effect at once, so one that excludes an armed vehicle with
 * fencing on triggers its fence action. The app's breach rule (fenceBreached) must predict the vehicle each time.
 * Not part of `npm test`.
 *
 *   build/sitl/bin/arducopter -w --model + --defaults Tools/autotest/default_params/copter.parm --home 35,-106,1600,0 -I0 --speedup 4
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56790 --allow-all-origins
 *   npx tsx tests/sitl/fence.sitl.ts            (SITL_WS=ws://host:port/ for another bridge)
 *
 * It changes fence parameters, arms, flies and triggers a fence breach: use a throwaway SITL instance.
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
const { messageRateManager } = await import('../../src/mavlink/rateManager.ts');
const { MAVLINK_MSG_ID } = await import('../../src/mavlink/messages.ts');
const { useTelemetryStore } = await import('../../src/store/telemetryStore.ts');
const fd = await import('../../src/mavlink/fenceDraft.ts');

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const failures: string[] = [];
const quiet = console.log;
function check(name: string, ok: boolean, detail = '') {
  quiet(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const log = (...a: unknown[]) => quiet('   ', ...a);
console.log = () => {};
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
messageRateManager.registerRequirement('sitl-fence', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
messageRateManager.registerRequirement('sitl-fence', MAVLINK_MSG_ID.GPS_RAW_INT);
const sys = st().heartbeat.systemId;
const comp = st().heartbeat.componentId || 1;
await until('a 3D GPS fix', () => st().gps.fixType >= 3, 120000);
const enc = mavlinkConnection.getEncoder();

const H = { lat: 35, lon: -106 };
// 1. Round trip: an inclusion square around home, an exclusion circle off to one side, a return point.
let fence = fd.addShape(fd.EMPTY_FENCE, fd.squareAt(H, 600, true)).draft;
fence = fd.addShape(fence, { kind: 'circle', inclusion: false, center: fd.offsetPoint(H, 150, 90), radius: 40.5 }).draft;
fence = fd.setReturnPoint(fence, fd.offsetPoint(H, 50, 180));
{
  const res = await missionManager.uploadFenceAndReadBack(fd.fenceDraftToItems(fence), sys, comp);
  const v = fd.checkFenceReadBack(fence, res.readBack, res.readOk);
  check('fence over MAVFTP: uploaded and verified', res.success && res.method === 'ftp' && v.status === 'verified', `${res.method} ${v.status} ${v.differences.join('; ')} ${res.error ?? ''}`);
}
{
  const realWrite = mavFtpClient.writeFile.bind(mavFtpClient);
  const realRead = mavFtpClient.readFile.bind(mavFtpClient);
  (mavFtpClient as any).writeFile = async () => false;
  (mavFtpClient as any).readFile = async () => null;
  const res = await missionManager.uploadFenceAndReadBack(fd.fenceDraftToItems(fence), sys, comp);
  (mavFtpClient as any).writeFile = realWrite;
  (mavFtpClient as any).readFile = realRead;
  const v = fd.checkFenceReadBack(fence, res.readBack, res.readOk);
  check('fence item-by-item: uploaded, streamed back, verified', res.success && res.method === 'legacy' && v.status === 'verified', `${res.method} ${v.status} ${v.differences.join('; ')} ${res.error ?? ''}`);
}

// 2. Fencing on (polygons and circles only, action RTL or land), hover at 20 m over home.
mavlinkConnection.send(enc.createParamSet(sys, comp, 'FENCE_TYPE', 4));
mavlinkConnection.send(enc.createParamSet(sys, comp, 'FENCE_ACTION', 1));
mavlinkConnection.send(enc.createParamSet(sys, comp, 'FENCE_ENABLE', 1));
await sleep(1500);
mavlinkConnection.send(enc.createSetMode(sys, comp, 4)); // GUIDED
await until('GUIDED', () => st().heartbeat.modeName === 'GUIDED', 15000);
for (let i = 0; i < 30 && !st().heartbeat.isArmed; i++) {
  mavlinkConnection.send(enc.createArmDisarm(sys, comp, true, false));
  await sleep(2000);
}
check('armed in GUIDED with fencing on', st().heartbeat.isArmed);
mavlinkConnection.send(enc.createCommandLong(sys, comp, 22, [0, 0, 0, 0, 0, 0, 20]));
await until('20 m', () => st().position.relativeAlt > 18, 60000);
await sleep(2000);
const here = () => ({ lat: st().position.lat, lon: st().position.lon });
log(`hovering at ${st().position.relativeAlt.toFixed(1)} m, mode ${st().heartbeat.modeName}`);

// 2a. A fence the vehicle is inside: predicted not breached, and the vehicle carries on in GUIDED.
{
  const res = await missionManager.uploadFenceAndReadBack(fd.fenceDraftToItems(fence), sys, comp);
  check('safe fence uploaded while armed', res.success, res.error ?? res.method);
  check('app predicts: not breached', !fd.fenceBreached(fence, here()));
  await sleep(6000);
  check('vehicle stays in GUIDED (no fence action)', st().heartbeat.modeName === 'GUIDED', st().heartbeat.modeName);
}

// 2b. A fence that puts the vehicle inside an exclusion zone: predicted breached, and the vehicle takes its action.
{
  const trap = fd.addShape(fence, { kind: 'circle', inclusion: false, center: here(), radius: 60 }).draft;
  check('app predicts: breached (the vehicle is inside the new exclusion circle)', fd.fenceBreached(trap, here()));
  const res = await missionManager.uploadFenceAndReadBack(fd.fenceDraftToItems(trap), sys, comp);
  check('breaching fence uploaded while armed (the vehicle accepts it)', res.success, res.error ?? res.method);
  try {
    await until('the fence action', () => st().heartbeat.modeName !== 'GUIDED', 20000);
  } catch {
    // reported below
  }
  check('vehicle takes its fence action at once (leaves GUIDED: RTL or land)', ['RTL', 'LAND', 'SMART_RTL', 'BRAKE'].includes(st().heartbeat.modeName),
    st().heartbeat.modeName);
  log(`messages: ${st().statusMessages.slice(-5).map((m: any) => m.text).join(' | ')}`);
}

quiet(failures.length ? `\n${failures.length} SITL fence check(s) FAILED` : '\nAll SITL fence checks PASSED');
mavlinkConnection.disconnect();
process.exit(failures.length ? 1 : 0);
