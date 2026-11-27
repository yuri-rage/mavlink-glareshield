// NTRIP through the bridge (src/mavlink/rtcmInjector.ts): when the link to the bridge drops (the bridge then ends
// the caster session), the RTK state says so instead of staying "streaming", and the caster is asked for again once
// the link is back; Disconnect stops that, and only a bridge stream tells the bridge to stop.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { mavlinkConnection } = await import('../src/mavlink/connection.ts');
const { rtcmInjector } = await import('../src/mavlink/rtcmInjector.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

// The bridge's side of the text channel: what the app sends, and replies played into its text listeners.
const sent: any[] = [];
let linkUp = true;
let textChannel = true; // false: a link without one (USB serial)
(mavlinkConnection as any).sendText = (m: string) => {
  if (!linkUp || !textChannel) return false;
  sent.push(JSON.parse(m));
  return true;
};
const fromBridge = (msg: object) =>
  (mavlinkConnection as any).textListeners.forEach((l: any) => l(JSON.stringify(msg)));
const setLink = (s: string) => {
  linkUp = s === 'connected';
  (mavlinkConnection as any).setStatus(s);
};
const kinds = () => sent.map((m) => m.type).join(',');

const config = { host: 'rtk2go.com', port: 2101, mountpoint: 'MP', username: '', password: '', sendGga: false } as any;
await rtcmInjector.connectViaBridge(config);
fromBridge({ type: 'ntrip_status', status: 'streaming' });
check('streaming through the bridge', rtcmInjector.getState().status === 'streaming');

setLink('disconnected');
let st = rtcmInjector.getState();
check('link to the bridge lost: no longer "streaming"', st.status === 'connecting', st.status);
check('…and says why', /Link to the bridge lost/.test(st.error ?? ''), st.error ?? '');

sent.length = 0;
setLink('connected');
check('link back: the caster is asked for again', kinds() === 'ntrip_connect' && sent[0].mountpoint === 'MP', kinds());
fromBridge({ type: 'ntrip_status', status: 'streaming' });
st = rtcmInjector.getState();
check('streaming again, the message cleared', st.status === 'streaming' && st.error === null);

sent.length = 0;
await rtcmInjector.disconnect();
check('Disconnect: the bridge is told to stop', kinds() === 'ntrip_disconnect', kinds());
sent.length = 0;
setLink('disconnected');
setLink('connected');
check('after Disconnect: a link drop and return ask for nothing', sent.length === 0, kinds());

// A disconnect with nothing through the bridge (a serial base station, a direct caster) leaves the bridge alone.
sent.length = 0;
await rtcmInjector.disconnect();
check('nothing through the bridge: Disconnect sends it nothing', sent.length === 0, kinds());

// The widget reads the state through the public getter.
check('getState() is the state', rtcmInjector.getState().status === 'disconnected');

// One listener, however it's reached: connecting again without a disconnect, or after a failed attempt, doesn't
// add another (each would inject every RTCM chunk again).
const listeners = () => (mavlinkConnection as any).textListeners.size as number;
const base = listeners();
await rtcmInjector.connectViaBridge(config);
await rtcmInjector.connectViaBridge(config);
check('connecting twice: one listener', listeners() === base + 1, `${listeners() - base}`);
await rtcmInjector.disconnect();
check('Disconnect: none left', listeners() === base, `${listeners() - base}`);
linkUp = false;
await rtcmInjector.connectViaBridge(config).catch(() => {});
linkUp = true;
check('a failed attempt (no link): none left', listeners() === base, `${listeners() - base}`);

// The link comes back without the bridge's text channel (switched to USB serial): it says so instead of waiting in
// "connecting", and stops following the bridge.
await rtcmInjector.connectViaBridge(config);
setLink('disconnected');
textChannel = false;
setLink('connected');
st = rtcmInjector.getState();
check(
  'back on a link without the bridge: an error, not "connecting"',
  st.status === 'error' && /USB serial/.test(st.error ?? ''),
  `${st.status}: ${st.error}`
);
check('…and no bridge listener left', listeners() === base, `${listeners() - base}`);
textChannel = true;

console.log(failures.length ? `\n${failures.length} RTCM bridge check(s) FAILED` : '\nAll RTCM bridge checks PASSED');
process.exit(failures.length ? 1 : 0);
