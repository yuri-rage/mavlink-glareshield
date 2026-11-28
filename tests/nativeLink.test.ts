// The desktop app's UDP and TCP links, page side (src/mavlink/transport/nativeLinkTransport.ts and the link
// settings in src/store/connectionStore.ts), against a fake of the desktop API (src/desktop/api.ts).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { NativeLinkTransport } = await import('../src/mavlink/transport/nativeLinkTransport.ts');
const { buildLinkConfig, parseTcpTarget } = await import('../src/store/connectionStore.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

/** A fake desktop link API: what was opened, sent and closed, and hooks to play data and a close into it. */
function fakeApi(opts: { fail?: string; delayMs?: number } = {}) {
  const data = new Map<string, Set<(d: Uint8Array) => void>>();
  const closed = new Map<string, Set<(r: string) => void>>();
  const log = { opened: [] as any[], sent: [] as [string, number[]][], closedIds: [] as string[] };
  let n = 0;
  const api = {
    open: async (config: any) => {
      log.opened.push(config);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new Error(opts.fail);
      return `link-${++n}`;
    },
    send: (id: string, d: Uint8Array) => log.sent.push([id, [...d]]),
    close: async (id: string) => {
      log.closedIds.push(id);
    },
    onData: (id: string, l: (d: Uint8Array) => void) => {
      (data.get(id) ?? data.set(id, new Set()).get(id)!).add(l);
      return () => data.get(id)?.delete(l);
    },
    onClosed: (id: string, l: (r: string) => void) => {
      (closed.get(id) ?? closed.set(id, new Set()).get(id)!).add(l);
      return () => closed.get(id)?.delete(l);
    },
  };
  return {
    api,
    log,
    play: (id: string, bytes: number[]) => data.get(id)?.forEach((l) => l(new Uint8Array(bytes))),
    end: (id: string, reason: string) => closed.get(id)?.forEach((l) => l(reason)),
    listeners: (id: string) => (data.get(id)?.size ?? 0) + (closed.get(id)?.size ?? 0),
  };
}

// Open, bytes both ways, close.
{
  const f = fakeApi();
  const t = new NativeLinkTransport(f.api, { kind: 'udp', port: 14550 });
  const statuses: string[] = [];
  const frames: number[][] = [];
  t.onStatus((s) => statuses.push(s.kind));
  t.onFrame((d) => frames.push([...d]));
  await t.connect();
  check('UDP: opens with its port', f.log.opened[0]?.kind === 'udp' && f.log.opened[0]?.port === 14550);
  check('connecting, then connected', statuses.join(',') === 'connecting,connected', statuses.join(','));
  f.play('link-1', [0xfd, 1, 2]);
  check("the vehicle's bytes reach the parser", JSON.stringify(frames) === '[[253,1,2]]');
  await t.send(new Uint8Array([7, 8]));
  check("the app's bytes go to the link", JSON.stringify(f.log.sent) === '[["link-1",[7,8]]]');
  await t.disconnect();
  check(
    'disconnect closes the link and stops listening',
    f.log.closedIds[0] === 'link-1' && f.listeners('link-1') === 0
  );
  await t.send(new Uint8Array([9]));
  check('nothing is sent once disconnected', f.log.sent.length === 1);
}

// The link ends on its own (TCP closed by the vehicle).
{
  const f = fakeApi();
  const t = new NativeLinkTransport(f.api, { kind: 'tcp', host: '127.0.0.1', port: 5760 });
  let last: any = null;
  t.onStatus((s) => (last = s));
  await t.connect();
  f.end('link-1', 'The vehicle closed the TCP connection');
  check(
    'a link that ends says why (disconnected, with the reason)',
    last?.kind === 'disconnected' && /closed/.test(last?.reason ?? '')
  );
  check('…and stops listening', f.listeners('link-1') === 0);
}

// Opening fails (port in use): an error status with the message, and the promise rejects.
{
  // As Electron reports a main-process error: its IPC prefix is dropped from what the person sees.
  const f = fakeApi({ fail: "Error invoking remote method 'link:open': Error: UDP port 14550: bind EADDRINUSE" });
  const t = new NativeLinkTransport(f.api, { kind: 'udp', port: 14550 });
  let last: any = null;
  t.onStatus((s) => (last = s));
  const err = await t.connect().then(
    () => null,
    (e: Error) => e.message
  );
  check(
    'a failed open: error status and rejection, without the IPC prefix',
    last?.kind === 'error' && last.message === 'UDP port 14550: bind EADDRINUSE' && /EADDRINUSE/.test(err ?? ''),
    last?.message
  );
}

// Disconnected while still opening: what opened is closed at once, and the transport stays disconnected.
{
  const f = fakeApi({ delayMs: 20 });
  const t = new NativeLinkTransport(f.api, { kind: 'udp', port: 14550 });
  const opening = t.connect();
  await t.disconnect();
  await opening;
  check(
    'disconnect during open: the late link is closed',
    f.log.closedIds.includes('link-1') && t.getStatus().kind === 'disconnected',
    `${t.getStatus().kind}, closed ${f.log.closedIds}`
  );
}

// The settings' link configs.
check('TCP target host:port', JSON.stringify(parseTcpTarget('10.0.0.2:5762')) === '{"host":"10.0.0.2","port":5762}');
check(
  'TCP target without a port: 5760',
  JSON.stringify(parseTcpTarget('sitl.local')) === '{"host":"sitl.local","port":5760}'
);
check('TCP target empty: the default', JSON.stringify(parseTcpTarget('')) === '{"host":"127.0.0.1","port":5760}');
check(
  'link configs by kind',
  JSON.stringify(buildLinkConfig('udp', 'ws://x', 57600, { udpPort: 14551, tcpTarget: 'h:1' })) ===
    '{"kind":"udp","port":14551}' &&
    JSON.stringify(buildLinkConfig('tcp', 'ws://x', 57600, { udpPort: 14551, tcpTarget: 'h:1' })) ===
      '{"kind":"tcp","host":"h","port":1}' &&
    JSON.stringify(buildLinkConfig('websocket', 'ws://x', 57600)) === '{"kind":"websocket","url":"ws://x"}'
);

// A UDP listener waiting for a vehicle isn't reopened by the silent-link watchdog (it would only flash errors), while
// a TCP link that goes quiet still is.
{
  const { MavlinkConnection, LINK_SILENCE_TIMEOUT_MS } = await import('../src/mavlink/connection.ts');
  const f = fakeApi();
  (globalThis as any).window ??= globalThis;
  (globalThis as any).window.glareshieldDesktop = { link: f.api };
  const udp = new MavlinkConnection('ws://x:1', { reconnectDelayMs: 20 });
  udp.setLink({ kind: 'udp', port: 14550 });
  udp.connect();
  for (let n = 0; n < 50 && udp.getStatus() !== 'connected'; n++) await new Promise((r) => setTimeout(r, 10));
  udp.checkLinkSilence(Date.now() + LINK_SILENCE_TIMEOUT_MS * 3);
  check('UDP: a silent listener is left open', udp.getStatus() === 'connected' && f.log.closedIds.length === 0);
  // The network coming back, or the page shown again: a quiet UDP listener isn't torn down and rebound either.
  udp.checkLinkNow(Date.now() + 10_000);
  check(
    'UDP: checkLinkNow leaves a quiet listener open',
    udp.getStatus() === 'connected' && f.log.closedIds.length === 0
  );
  udp.disconnect();
  const tcp = new MavlinkConnection('ws://x:1', { reconnectDelayMs: 20 });
  tcp.setLink({ kind: 'tcp', host: '127.0.0.1', port: 5760 });
  tcp.connect();
  for (let n = 0; n < 50 && tcp.getStatus() !== 'connected'; n++) await new Promise((r) => setTimeout(r, 10));
  tcp.checkLinkNow(Date.now() + 10_000);
  check('TCP: checkLinkNow still reopens a quiet link', tcp.getStatus() !== 'connected');
  for (let n = 0; n < 50 && tcp.getStatus() !== 'connected'; n++) await new Promise((r) => setTimeout(r, 10));
  tcp.checkLinkSilence(Date.now() + LINK_SILENCE_TIMEOUT_MS * 3);
  check('TCP: a silent link is still reopened', tcp.getStatus() !== 'connected');
  tcp.disconnect();
}

console.log(failures.length ? `\n${failures.length} native-link check(s) FAILED` : '\nAll native-link checks PASSED');
process.exit(failures.length ? 1 : 0);
