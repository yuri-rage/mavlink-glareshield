/**
 * The Camera widget's commands (src/mavlink/camera.ts) against ArduCopter SITL with a servo-triggered camera
 * (CAM1_TYPE 1): a photo is taken and reported (CAMERA_FEEDBACK), an interval runs (CAMERA_CAPTURE_STATUS says so,
 * photos keep coming) and stops, video, which a servo camera can't do, is answered as failed rather than ignored, and
 * zoom drives the camera's zoom servo output (accepted). Not part of `npm test`.
 *
 *   printf 'CAM1_TYPE 1\nSERVO9_FUNCTION 10\n' > /tmp/cam.parm
 *   build/sitl/bin/arducopter -w --model + --defaults Tools/autotest/default_params/copter.parm,/tmp/cam.parm --home 35,-106,1600,0 -I0
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56791 --allow-all-origins
 *   SITL_WS=ws://127.0.0.1:56791/ npx tsx tests/sitl/camera.sitl.ts
 */
export {};
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { mavlinkConnection } = await import('../../src/mavlink/connection.ts');
const { useTelemetryStore, sendTrackedCommand } = await import('../../src/store/telemetryStore.ts');
const { cameraCommands, decodeCaptureStatus, intervalRunning } = await import('../../src/mavlink/camera.ts');
const { decodePacket } = await import('../../src/mavlink/parser.ts');

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

mavlinkConnection.setLink({ kind: 'websocket', url: process.env.SITL_WS ?? 'ws://127.0.0.1:56791/' });
mavlinkConnection.connect();
const st = () => useTelemetryStore.getState();
check(
  'SITL: vehicle heard',
  await until(() => st().heartbeat.systemId > 0 && st().heartbeat.lastHeartbeatTime > 0, 60_000)
);
const sys = st().heartbeat.systemId;
const enc = mavlinkConnection.getEncoder();

const feedback: any[] = [];
let status = null as ReturnType<typeof decodeCaptureStatus> | null;
mavlinkConnection.onPacket((p) => {
  if (p.messageId === 180) feedback.push(decodePacket(p));
  if (p.messageId === 262) status = decodeCaptureStatus(p.payload);
});
// CAMERA_CAPTURE_STATUS at 2 Hz, as the widget's rate requirement asks.
mavlinkConnection.send(enc.createCommandLong(sys, 1, 511, [262, 500_000, 0, 0, 0, 0, 0]));

const send = (c: { command: number; params: any }, label: string) =>
  sendTrackedCommand(enc.createCommandLong(sys, 1, c.command, c.params), { label, targetKey: 'cam' });

let ack = await send(cameraCommands.photo(1), 'photo');
check('photo: accepted', ack.result === 0, ack.resultText);
check('…and reported (CAMERA_FEEDBACK)', await until(() => feedback.length >= 1, 5000), `${feedback.length}`);
check('capture status streams', await until(() => status !== null, 5000));

const before = feedback.length;
ack = await send(cameraCommands.startInterval(1), 'interval');
check('interval 1 s: accepted', ack.result === 0, ack.resultText);
check('…the status says it runs', await until(() => intervalRunning(status), 5000), JSON.stringify(status));
check(
  '…photos keep coming',
  await until(() => feedback.length >= before + 3, 8000),
  `${feedback.length - before} in the interval`
);
ack = await send(cameraCommands.stopInterval(), 'stop');
check('stop: accepted', ack.result === 0, ack.resultText);
check('…the status says idle', await until(() => !intervalRunning(status), 5000), JSON.stringify(status));
await sleep(1500);
const settled = feedback.length;
await sleep(2500);
check('…and the photos stop', feedback.length === settled, `${feedback.length - settled} after stopping`);
check(
  'photo count read back (image_count)',
  (status?.imageCount ?? -1) >= feedback.length - 1,
  `status ${status?.imageCount}, feedback ${feedback.length}`
);

ack = await send(cameraCommands.startVideo(), 'video');
check(
  'video on a servo camera: answered, not accepted',
  ack.result !== 0 && ack.resultText !== 'TIMEOUT',
  ack.resultText
);
ack = await send(cameraCommands.zoom(1), 'zoom');
check('zoom in: accepted (the zoom servo output)', ack.result === 0, ack.resultText);
ack = await send(cameraCommands.zoom(0), 'zoom stop');
check('zoom stop: accepted', ack.result === 0, ack.resultText);

mavlinkConnection.disconnect();
quiet(failures.length ? `\n${failures.length} camera SITL check(s) FAILED` : '\nAll camera SITL checks PASSED');
process.exit(failures.length ? 1 : 0);
