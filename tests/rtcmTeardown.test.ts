// A correction stream that ends on its own (src/mavlink/rtcmInjector.ts): a caster closing its HTTP stream or its
// WebSocket, or a USB base station going away, ends the connection: the status says so (not "streaming" forever)
// and the GGA loop stops. A stream that ends after Disconnect, or after a newer connection, changes nothing.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { rtcmInjector } = await import('../src/mavlink/rtcmInjector.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const st = () => rtcmInjector.getState();
const gga = () => (rtcmInjector as any).ggaIntervalTimer;

/** A stream reader whose reads the test settles: end(), fail(err). */
function fakeReader() {
  let pending: { resolve: (v: any) => void; reject: (e: any) => void } | null = null;
  return {
    read: () => new Promise((resolve, reject) => (pending = { resolve, reject })),
    releaseLock: () => {},
    cancel: async () => pending?.resolve({ done: true, value: undefined }),
    end: () => pending?.resolve({ done: true, value: undefined }),
    fail: (e: any) => pending?.reject(e),
  };
}

const config = { host: 'caster.example', port: 2101, mountpoint: 'MP', username: '', password: '', sendGga: true };

// --- HTTP stream (a direct fetch: no dev proxy, no bridge link) ---
let reader = fakeReader();
(globalThis as any).fetch = async () => ({ ok: true, headers: new Headers(), body: { getReader: () => reader } });

await rtcmInjector.connectNtrip({ ...config, protocol: 'http' } as any);
check('HTTP: connected, GGA loop running', st().status === 'connected' && gga() !== null, st().status);
reader.end();
await tick();
await tick();
check(
  'HTTP: the caster ends the stream: an error that says so',
  st().status === 'error',
  `${st().status}: ${st().error}`
);
check('…and the GGA loop stopped', gga() === null);

reader = fakeReader();
await rtcmInjector.connectNtrip({ ...config, protocol: 'http' } as any);
reader.fail(new TypeError('network error'));
await tick();
await tick();
check('HTTP: the stream fails: error, GGA stopped', st().status === 'error' && gga() === null, `${st().error}`);

// A stream from an older connection ending late leaves the newer one alone.
const old = (reader = fakeReader());
await rtcmInjector.connectNtrip({ ...config, protocol: 'http' } as any);
reader = fakeReader();
await rtcmInjector.connectNtrip({ ...config, protocol: 'http' } as any);
old.end();
await tick();
await tick();
check('HTTP: an older stream ending leaves the new one connected', st().status === 'connected' && gga() !== null);
await rtcmInjector.disconnect();
reader.end();
await tick();
await tick();
check('HTTP: ending after Disconnect: still plain "disconnected"', st().status === 'disconnected' && !st().error);

// --- WebSocket caster ---
class FakeWebSocket {
  static OPEN = 1;
  static last: FakeWebSocket;
  readyState = 0;
  binaryType = '';
  onopen: any;
  onclose: any;
  onerror: any;
  onmessage: any;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  send() {}
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close() {
    this.readyState = 3;
    setTimeout(() => this.onclose?.(), 0);
  }
}
(globalThis as any).WebSocket = FakeWebSocket;

await rtcmInjector.connectNtrip({ ...config, protocol: 'websocket' } as any);
FakeWebSocket.last.open();
check('WebSocket: connected, GGA loop running', st().status === 'connected' && gga() !== null);
FakeWebSocket.last.close();
await tick();
await tick();
check('WebSocket: the caster closes: disconnected', st().status === 'disconnected', st().status);
check('…and the GGA loop stopped', gga() === null);

await rtcmInjector.connectNtrip({ ...config, protocol: 'websocket' } as any);
FakeWebSocket.last.open();
FakeWebSocket.last.onerror?.(new Event('error'));
FakeWebSocket.last.close();
await tick();
await tick();
check(
  'WebSocket: an error then close: the error stays shown',
  st().status === 'error' && gga() === null,
  `${st().status}`
);

// --- USB base station (Web Serial) ---
let serialReader = fakeReader();
const port: any = {
  readable: { getReader: () => serialReader },
  open: async () => {},
  close: async () => {},
};
Object.defineProperty(globalThis.navigator, 'serial', { value: { requestPort: async () => port }, configurable: true });

await rtcmInjector.connectSerial();
check('serial: connected', st().status === 'connected');
port.readable = null; // unplugged: no readable after a fatal error
serialReader.fail(new Error('The device has been lost.'));
await tick();
await tick();
check('serial: unplugged: an error, not "connected"', st().status === 'error', `${st().status}: ${st().error}`);

port.readable = { getReader: () => serialReader };
serialReader = fakeReader();
await rtcmInjector.connectSerial();
const first = serialReader;
serialReader = fakeReader(); // a non-fatal error: the port gets a new readable, the loop reads on
first.fail(new Error('Framing error'));
await tick();
await tick();
check('serial: a non-fatal read error: still connected', st().status === 'connected', st().status);
await rtcmInjector.disconnect();
await tick();
check('serial: Disconnect: plain "disconnected"', st().status === 'disconnected' && !st().error, `${st().error}`);

console.log(
  failures.length ? `\n${failures.length} RTCM teardown check(s) FAILED` : '\nAll RTCM teardown checks PASSED'
);
process.exit(failures.length ? 1 : 0);
