/**
 * Action presets and COMMAND_INT against ArduPilot SITL: the packets the app's action buttons send (actionPacket),
 * and the vehicle's answers. Not part of `npm test`.
 *
 *   build/sitl/bin/arducopter -w --model + --defaults Tools/autotest/default_params/copter.parm,<file with ADSB_TYPE 1> --home 35,-106,1600,0 -I0
 *   python3 bridge/bridge.py --tcp 127.0.0.1:5760 --port 56790 --allow-all-origins
 *   npx tsx tests/sitl/actions.sitl.ts
 */
export {};
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { mavlinkConnection } = await import('../../src/mavlink/connection.ts');
const { useTelemetryStore, sendTrackedCommand } = await import('../../src/store/telemetryStore.ts');
const { actionPacket } = await import('../../src/components/widgets/custom/panelModel.ts');
const { COMMAND_PRESETS } = await import('../../src/mavlink/commandPresets.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quiet = console.log;
console.log = () => {};
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  quiet(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
mavlinkConnection.setLink({ kind: 'websocket', url: process.env.SITL_WS ?? 'ws://127.0.0.1:56790/' });
mavlinkConnection.connect();
const st = () => useTelemetryStore.getState();
for (let i = 0; i < 300 && st().heartbeat.systemId === 0; i++) await sleep(200);
const sys = st().heartbeat.systemId;
const enc = mavlinkConnection.getEncoder();
// A GPS fix and home first (setting home needs them).
for (let i = 0; i < 600 && (st().gps.fixType < 3 || st().homePosition.source === 'none'); i++) {
  if (i % 25 === 0) mavlinkConnection.send(enc.createRequestMessage(sys, 1, 242));
  await sleep(200);
}
const preset = (k: string) => COMMAND_PRESETS.find((c) => c.key === k)!;
const run = async (name: string, action: any, params: number[]) => {
  const info = await sendTrackedCommand(actionPacket(enc, sys, 1, action, params), { label: name });
  return info.result;
};
const texts = () => st().statusMessages.slice(-6).map((m: any) => m.text).join(' | ');

// In ALT_HOLD first: a wrong safety flag (custom mode) with P2 0 would switch to mode 0, STABILIZE.
mavlinkConnection.send(enc.createSetMode(sys, 1, 2));
for (let i = 0; i < 50 && st().heartbeat.modeName !== 'ALT_HOLD'; i++) await sleep(200);
check('safety on (DO_SET_MODE, safety flag 128, P2 1): accepted', (await run('safety on', preset('safety-on'), preset('safety-on').params)) === 0);
check('safety off (P2 0): accepted', (await run('safety off', preset('safety-off'), preset('safety-off').params)) === 0);
await sleep(1500);
check('the safety presets don\'t change the flight mode (still ALT_HOLD)', st().heartbeat.modeName === 'ALT_HOLD', st().heartbeat.modeName);
const ident = await run('ident', preset('adsb-ident'), preset('adsb-ident').params);
check('ADS-B IDENT reaches the ADS-B library (accepted, or failed for want of a healthy transponder)', ident === 0 || ident === 4, `result ${ident}`);
// COMMAND_INT in a global frame: DO_SET_HOME at a given place (P1 0 = use the given location).
const home = await run('set home', { commandId: 179, send: 'int', frame: 0 }, [0, 0, 0, 0, 35.001, -106.002, 1601]);
await sleep(1500);
mavlinkConnection.send(enc.createRequestMessage(sys, 1, 242));
await sleep(1500);
const h = st().homePosition;
check('COMMAND_INT, global frame: DO_SET_HOME accepted and home moved there', home === 0 && Math.abs(h.lat - 35.001) < 1e-6 && Math.abs(h.lon + 106.002) < 1e-6, `result ${home}, home ${h.lat}, ${h.lon}`);
// COMMAND_INT without a frame: a non-position command (REQUEST_MESSAGE for HOME_POSITION).
check('COMMAND_INT, no frame: REQUEST_MESSAGE accepted', (await run('request', { commandId: 512, send: 'int', frame: 2 }, [242, 0, 0, 0, 0, 0, 0])) === 0);
// SYSTEM_TIME: not acknowledged; just check it goes out without disturbing the link.
mavlinkConnection.send(actionPacket(enc, sys, 1, { commandId: 0, special: 'system-time' }, [0, 0, 0, 0, 0, 0, 0]));
await sleep(1500);
check('SYSTEM_TIME sent; the link carries on', Date.now() - st().heartbeat.lastHeartbeatTime < 3000);
quiet('    messages:', texts());
quiet(failures.length ? `\n${failures.length} SITL action check(s) FAILED` : '\nAll SITL action checks PASSED');
mavlinkConnection.disconnect();
process.exit(failures.length ? 1 : 0);
