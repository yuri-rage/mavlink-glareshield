// NTRIP in the desktop app, page side (src/mavlink/rtcmInjector.ts): HTTP mode goes to the desktop's own caster
// client (no bridge, whatever the link), its RTCM is injected, GGA goes back through it, the stream ending ends the
// connection with the reason, and Disconnect closes it. Against a fake of the desktop API (src/desktop/api.ts).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const opened: any[] = [];
const gga: string[] = [];
const closed: string[] = [];
const listeners = { data: new Map<string, (d: Uint8Array) => void>(), closed: new Map<string, (r: string) => void>() };
let refuse: string | null = null;
let answer: (() => void) | null = null;
let hold = false;
let early: Uint8Array | null = null;
const lastId = () => opened[opened.length - 1].id as string;
(globalThis as any).window ??= globalThis;
(globalThis as any).addEventListener ??= () => {};
Object.assign((globalThis as any).window, {
  glareshieldDesktop: {
    version: '0.3.0',
    platform: 'linux',
    ntrip: {
      // As the desktop does: the caster's first RTCM can reach the page before the open is answered.
      open: async (id: string, request: any) => {
        opened.push({ id, ...request });
        if (refuse) throw new Error(`Error invoking remote method 'ntrip:open': Error: ${refuse}`);
        if (early) listeners.data.get(id)?.(early);
        if (hold) await new Promise<void>((r) => (answer = r));
      },
      sendGga: (_id: string, s: string) => gga.push(s),
      close: async (id: string) => void closed.push(id),
      onData: (id: string, l: any) => (listeners.data.set(id, l), () => listeners.data.delete(id)),
      onClosed: (id: string, l: any) => (listeners.closed.set(id, l), () => listeners.closed.delete(id)),
    },
  },
});

const { rtcmInjector } = await import('../src/mavlink/rtcmInjector.ts');
const { useTelemetryStore } = await import('../src/store/telemetryStore.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const st = () => rtcmInjector.getState();

// A position, so the GGA loop has something to send.
useTelemetryStore.setState((s: any) => ({ position: { ...s.position, lat: 35.1, lon: -106.6, alt: 1600 } }));
const injected: Uint8Array[] = [];
(rtcmInjector as any).processRawStream = (d: Uint8Array) => injected.push(d);

const config = {
  host: ' caster.example ',
  port: 2102,
  mountpoint: '/MP',
  username: 'u',
  password: 'p',
  sendGga: true,
  protocol: 'http',
} as any;
await rtcmInjector.connectNtrip(config);
check(
  'HTTP mode: the desktop connects to the caster itself',
  opened.length === 1 &&
    opened[0].host === 'caster.example' &&
    opened[0].port === 2102 &&
    opened[0].mountpoint === 'MP' &&
    opened[0].username === 'u',
  JSON.stringify(opened[0])
);
check('…streaming once it accepted', st().status === 'streaming' && st().source === 'ntrip', st().status);
check('…GGA sent right away', gga.length === 1 && /^\$GPGGA,/.test(gga[0]), gga[0]);
listeners.data.get(lastId())?.(Uint8Array.of(0xd3, 0, 1));
check('RTCM from the desktop is injected', injected.length === 1 && injected[0][0] === 0xd3);

const firstId = lastId();
listeners.closed.get(firstId)?.('The caster closed the stream');
await tick();
await tick();
check(
  'the caster ends it: an error that says so',
  st().status === 'error' && st().error === 'The caster closed the stream',
  `${st().status}: ${st().error}`
);
check(
  '…the GGA loop stopped, listeners gone',
  (rtcmInjector as any).ggaIntervalTimer === null && listeners.data.size === 0
);

await rtcmInjector.connectNtrip(config);
await rtcmInjector.disconnect();
check(
  'Disconnect closes the desktop stream',
  closed.includes(lastId()) && st().status === 'disconnected',
  closed.join()
);
check('…and stops listening', listeners.data.size === 0 && listeners.closed.size === 0);

refuse = 'Caster rejected: HTTP/1.1 401 Unauthorized (check the username and password)';
await rtcmInjector.connectNtrip(config).catch(() => {});
check(
  "a refusal: the reason, without Electron's wrapper",
  st().status === 'error' && st().error === refuse,
  String(st().error)
);
refuse = null;

// Disconnected while the caster was still answering: the stream that arrives late is closed, not kept.
hold = true;
const pending = rtcmInjector.connectNtrip(config);
await tick();
await rtcmInjector.disconnect();
answer!();
await pending;
await tick();
check(
  'disconnected mid-answer: the late stream is closed',
  closed.includes(lastId()) && st().status === 'disconnected',
  `${closed.join()} ${st().status}`
);
hold = false;

// The WebSocket protocol (a caster behind a WebSocket proxy) still goes there, not to the desktop's client.
// RTCM that arrives before the open is answered (it came with the caster's "200 OK"): injected, not missed.
injected.length = 0;
early = Uint8Array.of(0xd3, 0, 2);
await rtcmInjector.connectNtrip(config);
early = null;
check(
  'RTCM before the open is answered: injected',
  injected.length === 1 && injected[0][2] === 2,
  `${injected.length}`
);
check('…each stream its own ID', new Set(opened.map((o) => o.id)).size === opened.length);
await rtcmInjector.disconnect();

const before = opened.length;
(globalThis as any).WebSocket = class {
  static OPEN = 1;
  constructor() {}
  close() {}
};
await rtcmInjector.connectNtrip({ ...config, protocol: 'websocket' }).catch(() => {});
check('WebSocket protocol: not the desktop client', opened.length === before);
await rtcmInjector.disconnect();

console.log(failures.length ? `\n${failures.length} desktop RTCM check(s) FAILED` : '\nAll desktop RTCM checks PASSED');
process.exit(failures.length ? 1 : 0);
