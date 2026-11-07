/**
 * Transport checks: the byte-stream transports adapted from ArduConfigurator (WebSocket, Web Serial, WebUSB CDC)
 * and MavlinkConnection running over each of them.
 *
 * Browsers' serial and USB APIs cannot run headlessly, so they are faked at the same seams the transports use
 * (a WebSocket-like object, a SerialPort-like object with streams, a USBDevice-like object). What that exercises
 * is the code that decides behaviour: status transitions, text vs binary routing, reconnect, device re-discovery
 * after a replug, CDC interface selection, and that MAVLink framing still reaches the parser.
 *
 * Run: npx tsx tests/transport.test.ts
 */
export {};
const memoryStorage = new Map<string, string>();
// Node < 21 has no global navigator; the transports feature-detect on it.
(globalThis as any).navigator ??= {};
(globalThis as any).localStorage ??= {
  getItem: (k: string) => memoryStorage.get(k) ?? null,
  setItem: (k: string, v: string) => void memoryStorage.set(k, String(v)),
  removeItem: (k: string) => void memoryStorage.delete(k),
};

// ------------------------------------------------------------------------------------------------
// Fakes
// ------------------------------------------------------------------------------------------------
type Listener = (event: any) => void;
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static autoOpen = true;
  binaryType = 'blob';
  readyState = 0;
  sent: any[] = [];
  private listeners: Record<string, Set<Listener>> = {};
  constructor(public url: string) {
    if (!/^wss?:\/\//.test(url)) throw new SyntaxError(`Invalid WebSocket URL ${url}`);
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.autoOpen) setTimeout(() => this.serverOpen(), 0);
  }
  addEventListener(type: string, l: Listener) {
    (this.listeners[type] ??= new Set()).add(l);
  }
  removeEventListener(type: string, l: Listener) {
    this.listeners[type]?.delete(l);
  }
  private emit(type: string, event: any) {
    for (const l of [...(this.listeners[type] ?? [])]) l(event);
  }
  send(data: any) {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit('close', { code, reason }), 0);
  }
  serverOpen() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.emit('open', {});
  }
  serverMessage(data: any) {
    this.emit('message', { data });
  }
  serverError() {
    this.emit('error', {});
  }
  serverClose(code = 1006, reason = '') {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}
(globalThis as any).WebSocket = FakeWebSocket;

/** A SerialPort-like object with real Web Streams, so the transport's reader/writer code runs unmodified. */
function fakeSerialPort(info = { usbVendorId: 0x1209, usbProductId: 0x5741 }) {
  let push: ((chunk: Uint8Array) => void) | undefined;
  let fail: ((err: Error) => void) | undefined;
  const written: Uint8Array[] = [];
  const port: any = {
    opened: false,
    openCount: 0,
    baudRate: 0,
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    written,
    getInfo: () => info,
    async open({ baudRate }: { baudRate: number }) {
      if (port.lost) throw new Error("Failed to execute 'open' on 'SerialPort': The device has been lost.");
      if (port.opened) throw new Error('The port is already open.');
      port.opened = true;
      port.openCount++;
      port.baudRate = baudRate;
      port.readable = new ReadableStream<Uint8Array>({
        start(controller) {
          push = (c) => controller.enqueue(c);
          fail = (e) => controller.error(e);
        },
      });
      port.writable = new WritableStream<Uint8Array>({ write: (c) => void written.push(c) });
    },
    async close() {
      port.opened = false;
      port.readable = null;
      port.writable = null;
    },
    push: (chunk: Uint8Array) => push?.(chunk),
    unplug() {
      port.lost = true;
      fail?.(new DOMException('The device has been lost.', 'NetworkError'));
    },
  };
  return port;
}

function installSerial(ports: any[], pick: () => any) {
  const serial = { requestPort: async () => pick(), getPorts: async () => ports.filter((p) => !p.lost) };
  Object.defineProperty(globalThis.navigator, 'serial', { value: serial, configurable: true });
  return serial;
}

/** ArduPilot's dual-CDC descriptor (AP_HAL_ChibiOS usbcfg_dualcdc.c), as in ArduConfigurator's tests. */
function ardupilotDualCdcConfiguration() {
  const comm = (interfaceNumber: number, ep: number) => ({
    interfaceNumber,
    alternate: {
      alternateSetting: 0,
      interfaceClass: 0x02,
      interfaceSubclass: 0x02,
      interfaceProtocol: 0x01,
      endpoints: [{ endpointNumber: ep, direction: 'in', type: 'interrupt', packetSize: 16 }],
    },
  });
  const data = (interfaceNumber: number, ep: number) => ({
    interfaceNumber,
    alternate: {
      alternateSetting: 0,
      interfaceClass: 0x0a,
      interfaceSubclass: 0,
      interfaceProtocol: 0,
      endpoints: [
        { endpointNumber: ep, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: ep, direction: 'in', type: 'bulk', packetSize: 64 },
      ],
    },
  });
  return { configurationValue: 1, interfaces: [comm(0, 1), data(1, 2), comm(2, 3), data(3, 4)] };
}

function fakeUsbDevice(serialNumber = 'ABC123') {
  const inbound: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  const device: any = {
    vendorId: 0x1209,
    productId: 0x5740,
    serialNumber,
    opened: false,
    configuration: ardupilotDualCdcConfiguration(),
    calls: [] as string[],
    written: [] as Uint8Array[],
    async open() {
      device.calls.push('open');
      device.opened = true;
    },
    async close() {
      device.calls.push('close');
      device.opened = false;
    },
    async selectConfiguration() {},
    async claimInterface(n: number) {
      device.calls.push(`claim:${n}`);
    },
    async releaseInterface(n: number) {
      device.calls.push(`release:${n}`);
    },
    async controlTransferOut() {
      return { bytesWritten: 0, status: 'ok' };
    },
    async transferIn(ep: number) {
      device.calls.push(`in:${ep}`);
      while (!inbound.length) {
        await new Promise<void>((r) => (wake = r));
        if (!device.opened) return { status: 'ok' };
      }
      const next = inbound.shift()!;
      return { status: 'ok', data: new DataView(next.buffer, next.byteOffset, next.byteLength) };
    },
    async transferOut(ep: number, data: Uint8Array) {
      device.calls.push(`out:${ep}`);
      device.written.push(new Uint8Array(data));
      return { bytesWritten: data.byteLength, status: 'ok' };
    },
    push(chunk: Uint8Array) {
      inbound.push(chunk);
      wake?.();
    },
    wakeIdle() {
      wake?.();
    },
  };
  return device;
}

// ------------------------------------------------------------------------------------------------
// Harness
// ------------------------------------------------------------------------------------------------
const {
  WebSocketTransport,
  WebSerialTransport,
  WebUsbSerialTransport,
  findCdcSerialPorts,
  selectCdcSerialPort,
  alignReadSize,
  hasTextChannel,
  requestSerialDevice,
  resetSerialSelection,
  getSerialApi,
} = await import('../src/mavlink/transport/index.ts');
const { MavlinkConnection } = await import('../src/mavlink/connection.ts');
const { MavlinkEncoder } = await import('../src/mavlink/encoder.ts');
const { MAVLINK_MSG_ID } = await import('../src/mavlink/messages.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const last = <T>(list: T[]): T => list[list.length - 1];
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await tick(5);
  return cond();
}
const vehicle = new MavlinkEncoder();
vehicle.setSourceId(1);
const vehicleHeartbeat = () => vehicle.createHeartbeat();
const msgIdOf = (bytes: Uint8Array) => (bytes[0] === 0xfd ? bytes[7] | (bytes[8] << 8) | (bytes[9] << 16) : bytes[5]);

// ------------------------------------------------------------------------------------------------
// A. WebSocketTransport
// ------------------------------------------------------------------------------------------------
{
  const t = new WebSocketTransport('t', { url: 'ws://bridge:56781' });
  const statuses: string[] = [];
  const frames: Uint8Array[] = [];
  const texts: string[] = [];
  t.onStatus((s) => statuses.push(s.kind));
  t.onFrame((f) => frames.push(f));
  t.onText((m) => texts.push(m));
  await t.connect();
  const ws = last(FakeWebSocket.instances)!;
  ws.serverMessage(new Uint8Array([1, 2, 3]).buffer);
  ws.serverMessage('{"type":"ntrip_status"}');
  check('WebSocketTransport: connect walks idle → connecting → connected', statuses.join(',') === 'idle,connecting,connected', statuses.join(','));
  check('WebSocketTransport: binary messages arrive as frames, in order and synchronously', frames.length === 1 && frames[0].join() === '1,2,3');
  check('WebSocketTransport: text messages go to the text channel, never into the MAVLink byte stream', texts.length === 1 && frames.length === 1);
  check('WebSocketTransport: binaryType is set to arraybuffer', ws.binaryType === 'arraybuffer');
  check('WebSocketTransport: sendText sends a text frame while open', t.sendText('hi') && last(ws.sent) === 'hi');
  await t.send(new Uint8Array([9]));
  check('WebSocketTransport: send writes the bytes', last(ws.sent) instanceof Uint8Array);
  await t.disconnect();
  check('WebSocketTransport: sendText is false after disconnect and does not throw', t.sendText('x') === false);
  let sendRejected = false;
  await t.send(new Uint8Array([1])).catch(() => (sendRejected = true));
  check('WebSocketTransport: send rejects when not connected', sendRejected);
}
{
  const t = new WebSocketTransport('bad', { url: 'not a url' });
  let rejected = false;
  await t.connect().catch(() => (rejected = true));
  check('WebSocketTransport: a socket constructor that throws ends in error, not stuck connecting', rejected && t.getStatus().kind === 'error');
}
{
  FakeWebSocket.autoOpen = false;
  const t = new WebSocketTransport('abort', { url: 'ws://slow:1' });
  const p = t.connect();
  let rejected = false;
  p.catch(() => (rejected = true));
  await t.disconnect();
  await tick();
  last(FakeWebSocket.instances)!.serverOpen();
  check('WebSocketTransport: disconnect during connect rejects the attempt and a late open is ignored', rejected && t.getStatus().kind === 'disconnected');
  FakeWebSocket.autoOpen = true;
}
{
  const t = new WebSocketTransport('runtime', { url: 'ws://bridge:1' });
  await t.connect();
  const ws = last(FakeWebSocket.instances)!;
  const seen: string[] = [];
  t.onStatus((s) => seen.push(s.kind));
  ws.serverError();
  ws.serverClose(1006);
  check('WebSocketTransport: a runtime error followed by close reports error then disconnected', seen.join(',') === 'connected,error,disconnected', seen.join(','));
}
check('hasTextChannel: true for WebSocket, false for serial', hasTextChannel(new WebSocketTransport('x', { url: 'ws://a' })) && !hasTextChannel(new WebSerialTransport('y', { baudRate: 1 })));

// ------------------------------------------------------------------------------------------------
// B. MavlinkConnection over WebSocket (behaviour preserved from the pre-transport implementation)
// ------------------------------------------------------------------------------------------------
{
  const conn = new MavlinkConnection('ws://bridge:56781');
  const statuses: string[] = [];
  const packets: any[] = [];
  const texts: string[] = [];
  conn.onStatus((s) => statuses.push(s));
  conn.onPacket((p) => packets.push(p));
  conn.onText((m) => texts.push(m));
  const before = FakeWebSocket.instances.length;
  conn.connect();
  conn.connect(); // second call while connecting must not open another socket
  await waitFor(() => conn.getStatus() === 'connected');
  const ws = last(FakeWebSocket.instances)!;
  check('MavlinkConnection/ws: connects', conn.getStatus() === 'connected', statuses.join(','));
  check('MavlinkConnection/ws: a second connect() while connecting opens no extra socket', FakeWebSocket.instances.length === before + 1);
  // Nothing may be on the other end of a bridge yet; requests wait for a vehicle heartbeat (telemetryStore).
  check('MavlinkConnection/ws: sends no commands before a vehicle is heard', !ws.sent.some((d) => d instanceof Uint8Array && msgIdOf(d) === MAVLINK_MSG_ID.COMMAND_LONG));
  const hb = vehicleHeartbeat();
  ws.serverMessage(hb.slice(0, 5).buffer);
  ws.serverMessage(hb.slice(5).buffer);
  check('MavlinkConnection/ws: a heartbeat split across two messages is parsed once', packets.length === 1 && packets[0].messageId === 0, `${packets.length}`);
  check('MavlinkConnection/ws: byte and packet counters advance', conn.stats.bytesReceived === hb.length && conn.stats.packetsReceived === 1);
  ws.serverMessage('{"type":"ntrip_ok"}');
  check('MavlinkConnection/ws: bridge text messages reach onText', texts.length === 1);
  check('MavlinkConnection/ws: sendText works on a WebSocket link', conn.sendText('{"type":"ping"}') && last(ws.sent) === '{"type":"ping"}');
  const sentBefore = ws.sent.length;
  check('MavlinkConnection/ws: send() returns true and writes synchronously', conn.send(new Uint8Array([0xfd])) && ws.sent.length === sentBefore + 1);

  // Link drops: disconnected, then an automatic reconnect ~2 s later (unchanged behaviour).
  ws.serverClose(1006);
  check('MavlinkConnection/ws: a dropped socket reports disconnected', conn.getStatus() === 'disconnected');
  check('MavlinkConnection/ws: not a manual disconnect', conn.isManualDisconnect === false);
  check('MavlinkConnection/ws: send() returns false while disconnected', conn.send(new Uint8Array([1])) === false);
  const count = FakeWebSocket.instances.length;
  await waitFor(() => conn.getStatus() === 'connected', 3000);
  check('MavlinkConnection/ws: reconnects on its own after a drop', FakeWebSocket.instances.length === count + 1 && conn.getStatus() === 'connected');

  conn.disconnect();
  check('MavlinkConnection/ws: manual disconnect', conn.getStatus() === 'disconnected' && conn.isManualDisconnect);
  const after = FakeWebSocket.instances.length;
  await tick(2300);
  check('MavlinkConnection/ws: no reconnect after a manual disconnect', FakeWebSocket.instances.length === after);
}
{
  FakeWebSocket.autoOpen = false;
  const conn = new MavlinkConnection('ws://down:1');
  const seen: Array<[string, string | undefined]> = [];
  conn.onStatus((s, e) => seen.push([s, e]));
  conn.connect();
  await waitFor(() => last(FakeWebSocket.instances)?.url === 'ws://down:1');
  last(FakeWebSocket.instances)!.serverError();
  const kinds = seen.map((s) => s[0]).join(',');
  check('MavlinkConnection/ws: a failed open reports error with the same message as before, then disconnected', kinds === 'disconnected,connecting,error,disconnected' && seen[2][1] === 'WebSocket error occurred', kinds);
  conn.pauseReconnect();
  conn.disconnect();
  FakeWebSocket.autoOpen = true;
}
{
  const conn = new MavlinkConnection('ws://a:1');
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  conn.setUrl('ws://b:2');
  await waitFor(() => conn.getStatus() === 'connected' && last(FakeWebSocket.instances)!.url === 'ws://b:2');
  check('MavlinkConnection/ws: setUrl on a live link reconnects to the new URL', last(FakeWebSocket.instances)!.url === 'ws://b:2' && conn.getStatus() === 'connected');
  conn.disconnect();
}

{
  // Silent-link watchdog: an open socket that delivers nothing is reopened, with growing patience.
  const { LINK_SILENCE_TIMEOUT_MS } = await import('../src/mavlink/connection.ts');
  const conn = new MavlinkConnection('ws://silent:1');
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  const t0 = Date.now();
  conn.checkLinkSilence(t0 + LINK_SILENCE_TIMEOUT_MS - 1000);
  check('watchdog: a quiet link inside the timeout is left alone', conn.getStatus() === 'connected');
  const sockets = FakeWebSocket.instances.length;
  conn.checkLinkSilence(t0 + LINK_SILENCE_TIMEOUT_MS + 1500);
  check('watchdog: a link silent past the timeout is closed and not marked manual', conn.getStatus() === 'disconnected' && !conn.isManualDisconnect);
  await waitFor(() => conn.getStatus() === 'connected', 3000);
  check('watchdog: ...and reopened automatically', FakeWebSocket.instances.length === sockets + 1 && conn.getStatus() === 'connected');
  const t1 = Date.now();
  conn.checkLinkSilence(t1 + LINK_SILENCE_TIMEOUT_MS + 1500);
  check('watchdog: after a silent reopen it waits longer (backoff) before trying again', conn.getStatus() === 'connected');
  last(FakeWebSocket.instances).serverMessage(vehicleHeartbeat().buffer);
  conn.checkLinkSilence(Date.now() + LINK_SILENCE_TIMEOUT_MS - 1000);
  check('watchdog: data resets the timer', conn.getStatus() === 'connected');

  // Network back / page visible again
  last(FakeWebSocket.instances).serverMessage(vehicleHeartbeat().buffer);
  conn.checkLinkNow(Date.now() + 1000);
  check('checkLinkNow: a link that is still delivering is left alone', conn.getStatus() === 'connected');
  const before = FakeWebSocket.instances.length;
  conn.checkLinkNow(Date.now() + 4000);
  check('checkLinkNow: an open but silent link is reopened at once', conn.getStatus() === 'disconnected');
  const waitingSockets = FakeWebSocket.instances.length;
  conn.checkLinkNow();
  await waitFor(() => conn.getStatus() === 'connected', 1000);
  check('checkLinkNow: a link waiting to retry reconnects immediately instead of after the retry delay', conn.getStatus() === 'connected' && FakeWebSocket.instances.length === waitingSockets + 1 && waitingSockets === before);
  conn.disconnect();
  conn.checkLinkNow();
  check('checkLinkNow: never reopens a link the user disconnected', conn.getStatus() === 'disconnected');
}

// ------------------------------------------------------------------------------------------------
// C. Serial over Web Serial
// ------------------------------------------------------------------------------------------------
{
  check('getSerialApi: null without Web Serial or WebUSB', getSerialApi() === null);
  const port1 = fakeSerialPort();
  const ports = [port1];
  installSerial(ports, () => port1);
  check('getSerialApi: web-serial when navigator.serial exists', getSerialApi() === 'web-serial');
  check('requestSerialDevice: picks a port', await requestSerialDevice());

  const conn = new MavlinkConnection();
  const packets: any[] = [];
  conn.onPacket((p) => packets.push(p));
  conn.setLink({ kind: 'serial', baudRate: 57600 });
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  check('MavlinkConnection/serial: connects and opens the port at the chosen baud', conn.getStatus() === 'connected' && port1.baudRate === 57600);
  check('MavlinkConnection/serial: sendText is false (no text side channel on serial)', conn.sendText('{}') === false);
  port1.push(vehicleHeartbeat());
  await waitFor(() => packets.length === 1);
  check('MavlinkConnection/serial: bytes from the port are parsed as MAVLink', packets.length === 1 && packets[0].messageId === 0);
  conn.send(conn.getEncoder().createRequestMessage(1, 1, MAVLINK_MSG_ID.AUTOPILOT_VERSION));
  await waitFor(() => port1.written.length > 0);
  check('MavlinkConnection/serial: outbound MAVLink is written to the port', port1.written.some((c: Uint8Array) => msgIdOf(c) === MAVLINK_MSG_ID.COMMAND_LONG));

  // Unplug, replug as a new SerialPort object: the link reconnects to it without the picker.
  port1.unplug();
  await waitFor(() => conn.getStatus() === 'disconnected');
  check('MavlinkConnection/serial: unplugging ends the link', conn.getStatus() === 'disconnected' && !conn.isManualDisconnect);
  const port2 = fakeSerialPort();
  ports.push(port2);
  await waitFor(() => conn.getStatus() === 'connected', 5000);
  check('MavlinkConnection/serial: a replugged device (new port object, same USB ids) is reconnected automatically', conn.getStatus() === 'connected' && port2.opened);
  port2.push(vehicleHeartbeat());
  await waitFor(() => packets.length === 2);
  check('MavlinkConnection/serial: telemetry flows again after the replug', packets.length === 2);

  conn.disconnect();
  await waitFor(() => !port2.opened);
  check('MavlinkConnection/serial: manual disconnect closes the port', !port2.opened);
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  check('MavlinkConnection/serial: reconnecting after a manual disconnect reopens the same port', port2.opened && port2.openCount === 2);
  conn.disconnect();
  await waitFor(() => !port2.opened);

  // A page reload: no in-memory selection, the remembered USB ids find the granted port.
  resetSerialSelection();
  const reloaded = new MavlinkConnection();
  reloaded.setLink({ kind: 'serial', baudRate: 115200 });
  reloaded.connect();
  await waitFor(() => reloaded.getStatus() === 'connected');
  check('MavlinkConnection/serial: after a reload the remembered device is reopened without a picker', reloaded.getStatus() === 'connected' && port2.baudRate === 115200);
  reloaded.disconnect();
  await waitFor(() => !port2.opened);
}
{
  const port = fakeSerialPort();
  let opens = 0;
  const realOpen = port.open;
  port.open = async (o: any) => {
    opens++;
    if (opens === 1) {
      port.opened = true; // left open by a previous attempt
      throw new Error("Failed to execute 'open' on 'SerialPort': Failed to open serial port.");
    }
    return realOpen(o);
  };
  const t = new WebSerialTransport('stale', { baudRate: 115200, port: () => port });
  await t.connect();
  check('WebSerialTransport: a stale handle whose first open() fails is closed and reopened (upstream fix)', opens === 2 && t.getStatus().kind === 'connected');
  await t.disconnect();
}

{
  // Switching links while a serial attempt is still resolving its device must end on the new link.
  const port = fakeSerialPort();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  Object.defineProperty(globalThis.navigator, 'serial', {
    value: { requestPort: async () => port, getPorts: async () => (await gate, [port]) },
    configurable: true,
  });
  resetSerialSelection();
  const conn = new MavlinkConnection();
  conn.setLink({ kind: 'serial', baudRate: 57600 });
  conn.connect();
  await tick(10);
  conn.setLink({ kind: 'websocket', url: 'ws://switched:1' });
  release();
  await waitFor(() => conn.getStatus() === 'connected');
  check('MavlinkConnection: changing the link while a serial attempt is resolving connects the new link, not the old one', conn.getStatus() === 'connected' && last(FakeWebSocket.instances).url === 'ws://switched:1' && !port.opened);
  conn.disconnect();
}

// ------------------------------------------------------------------------------------------------
// D. Serial over WebUSB (Android)
// ------------------------------------------------------------------------------------------------
{
  const ports = findCdcSerialPorts(ardupilotDualCdcConfiguration() as any);
  check('webUsbCdc: finds both CDC data interfaces on an ArduPilot dual-CDC board, MAVLink first', ports.length === 2 && ports[0].interfaceNumber === 1 && ports[0].controlInterfaceNumber === 0 && ports[1].interfaceNumber === 3);
  check('webUsbCdc: an out-of-range port index falls back to the first port', selectCdcSerialPort(ports, 5) === ports[0]);
  check('webUsbCdc: reads are rounded up to whole packets', alignReadSize(100, 64) === 128 && alignReadSize(64, 64) === 64);

  Object.defineProperty(globalThis.navigator, 'serial', { value: undefined, configurable: true });
  const device = fakeUsbDevice();
  const granted = [device];
  let filters: any[] = [];
  Object.defineProperty(globalThis.navigator, 'usb', {
    value: {
      requestDevice: async (o: any) => ((filters = o.filters), device),
      getDevices: async () => granted,
    },
    configurable: true,
  });
  resetSerialSelection();
  check('getSerialApi: web-usb-serial when only WebUSB exists (Android)', getSerialApi() === 'web-usb-serial');
  check('requestSerialDevice: WebUSB picker is filtered to ArduPilot / CDC devices', (await requestSerialDevice()) && filters.some((f) => f.vendorId === 0x1209) && filters.some((f) => f.classCode === 0x02));

  const conn = new MavlinkConnection();
  const packets: any[] = [];
  conn.onPacket((p) => packets.push(p));
  conn.setLink({ kind: 'serial', baudRate: 57600 });
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  check('MavlinkConnection/usb: connects over WebUSB, claiming comm + MAVLink data interfaces', conn.getStatus() === 'connected' && device.calls.includes('claim:0') && device.calls.includes('claim:1') && !device.calls.includes('claim:3'));
  device.push(vehicleHeartbeat());
  await waitFor(() => packets.length === 1);
  check('MavlinkConnection/usb: bytes from the bulk IN endpoint are parsed as MAVLink', packets.length === 1);
  await waitFor(() => device.written.length > 0);
  check('MavlinkConnection/usb: outbound MAVLink goes to the bulk OUT endpoint', device.calls.includes('out:2'));
  conn.disconnect();
  device.wakeIdle();
  await waitFor(() => device.calls.includes('close'));
  check('MavlinkConnection/usb: disconnect releases both interfaces and closes the device', device.calls.includes('release:1') && device.calls.includes('release:0') && device.calls.includes('close'));
  Object.defineProperty(globalThis.navigator, 'usb', { value: undefined, configurable: true });
}
{
  const device = fakeUsbDevice();
  device.claimInterface = async (n: number) => {
    device.calls.push(`claim:${n}`);
    if (n === 1) throw new Error('Unable to claim interface: busy');
  };
  const t = new WebUsbSerialTransport('usb', { device });
  await t.connect();
  check('WebUsbSerialTransport: falls back to the second CDC interface when the first is taken (upstream behaviour)', t.getStatus().kind === 'connected' && device.calls.includes('claim:3'));
  await Promise.race([t.disconnect(), tick(1500)]);
  device.wakeIdle();
}

console.log(failures.length ? `\n${failures.length} transport check(s) FAILED` : '\nAll transport checks PASSED');
process.exit(failures.length ? 1 : 0);
