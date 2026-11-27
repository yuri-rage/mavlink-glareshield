// Pairing with a bridge that needs a token: the #link= a pairing QR opens the app with, the link another device
// scans, and the connection's answer to the bridge's 4001 / 4003 close (say why, and stop retrying the same link).
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

type Listener = (event: any) => void;
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  binaryType = 'blob';
  readyState = 0;
  private listeners: Record<string, Set<Listener>> = {};
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open', {});
    }, 0);
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
  send() {}
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.emit('close', { code, reason }), 0);
  }
  serverClose(code: number, reason: string) {
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
}
(globalThis as any).WebSocket = FakeWebSocket;

const { linkFromHash, pairingUrl, acceptPairingLink, pairingCloseMessage, tokenOf, maskToken, pairingAppUrl } =
  await import('../src/lib/pairing.ts');
const { MavlinkConnection } = await import('../src/mavlink/connection.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => boolean, ms = 2000) => {
  for (let t = 0; t < ms && !cond(); t += 10) await sleep(10);
  return cond();
};

// The link in the hash (as bridge.py writes it: the whole ws URL percent-encoded).
const wss = 'wss://192.168.1.50:56781/?token=nzZwtJNtd2u8lZSFFGoDRQ';
const hash = `#link=${encodeURIComponent(wss)}`;
check('#link: the bridge link', linkFromHash(hash) === wss, String(linkFromHash(hash)));
check('#link: only ws:// or wss://', linkFromHash(`#link=${encodeURIComponent('javascript:alert(1)')}`) === null);
check('#link: junk is ignored', linkFromHash('#link=%%%') === null && linkFromHash('#other=1') === null);
check(
  'a link shown on screen hides its token',
  maskToken(wss) === 'wss://192.168.1.50:56781/?token=••••••' &&
    maskToken('ws://h:1/?a=1&token=abc&b=2') === 'ws://h:1/?a=1&token=••••••&b=2' &&
    maskToken('ws://h:1/') === 'ws://h:1/'
);
check('token of a link', tokenOf(wss) === 'nzZwtJNtd2u8lZSFFGoDRQ' && tokenOf('wss://h:1/') === null);

// The link another device scans: like the bridge's own QR code.
check(
  'pair another device, wss://: the bridge /pair page (its certificate step)',
  pairingUrl(wss, 'https://glareshield.yurirage.com/') ===
    'https://192.168.1.50:56781/pair?token=nzZwtJNtd2u8lZSFFGoDRQ'
);
check(
  'pair another device, ws://: straight to the app with the link',
  pairingUrl('ws://10.0.0.5:56781/?token=abc', 'https://glareshield.yurirage.com/?x=1#y') ===
    `https://glareshield.yurirage.com/#link=${encodeURIComponent('ws://10.0.0.5:56781/?token=abc')}`
);
check(
  'pair another device from the desktop app (app://): the link opens the hosted app',
  pairingUrl('ws://10.0.0.5:56781/?token=abc', pairingAppUrl('app://glareshield/')) ===
    `https://glareshield.yurirage.com/#link=${encodeURIComponent('ws://10.0.0.5:56781/?token=abc')}` &&
    pairingAppUrl('http://localhost:3000/') === 'http://localhost:3000/'
);
check('pair another device: none without a token', pairingUrl('wss://h:1/', 'https://a/') === null);
{
  const { qrPath } = await import('../src/components/ui/QrCode.tsx');
  const { size, d } = qrPath(pairingUrl(wss, 'https://glareshield.yurirage.com/')!);
  // Version 4 (33 modules) plus a 2-module border holds this link at ECC M; the three finder patterns are dark.
  const squares = d.match(/h1v1h-1z/g)?.length ?? 0;
  check(
    'pair another device: a QR code of the link',
    size === 37 && squares > 300 && d.startsWith('M2 2h1'),
    `${size}, ${squares}`
  );
}

// Opening the app from a pairing link.
const run = async (h: string, answer: boolean, currentUrl: string | null = 'ws://localhost:56781') => {
  const log = { cleared: false, asked: [] as string[], used: null as string | null };
  const result = await acceptPairingLink({
    hash: h,
    clearHash: () => (log.cleared = true),
    ask: async (req) => {
      log.asked.push(req.message.join(' '));
      return answer;
    },
    currentUrl,
    use: (u) => (log.used = u),
  });
  return { result, ...log };
};
let r = await run('', true);
check('no #link: nothing asked or changed', !r.cleared && r.asked.length === 0 && r.used === null);
r = await run(hash, false);
check('declined: address cleared, link not used', r.cleared && r.asked.length === 1 && r.used === null);
check(
  'the question names the bridge and the link it replaces',
  /192\.168\.1\.50:56781.*localhost:56781/.test(r.asked[0])
);
r = await run(hash, true);
check('accepted: address cleared, link used', r.cleared && r.used === wss && r.result === wss);
r = await run(hash, true, wss);
check('the link in use already: nothing asked', r.cleared && r.asked.length === 0 && r.used === null);
r = await run(`#link=${encodeURIComponent('http://evil/')}`, true);
check('not a WebSocket link: address cleared, nothing asked', r.cleared && r.asked.length === 0);

// The bridge refuses the token: the connection says why and stops retrying the same link.
check(
  '4001 / 4003 explained, others not',
  !!pairingCloseMessage(4001) && !!pairingCloseMessage(4003) && !pairingCloseMessage(1006)
);
{
  const conn = new MavlinkConnection('wss://192.168.1.50:56781/', { reconnectDelayMs: 30 });
  const errors: string[] = [];
  conn.onStatus((s, e) => s === 'error' && e && errors.push(e));
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  const first = FakeWebSocket.instances.length;
  FakeWebSocket.instances[first - 1].serverClose(4001, 'pairing token required');
  await sleep(200);
  check(
    '4001: the error says to pair',
    errors.some((e) => /pairing token/.test(e) && /QR code/.test(e)),
    errors.join(' | ')
  );
  check(
    '4001: no retry of the same link',
    FakeWebSocket.instances.length === first,
    `${FakeWebSocket.instances.length - first} retries`
  );
  conn.connect();
  await waitFor(() => conn.getStatus() === 'connected');
  check('Connect again: it tries', FakeWebSocket.instances.length === first + 1);
  FakeWebSocket.instances[first].serverClose(1006, '');
  await waitFor(() => FakeWebSocket.instances.length > first + 1, 500);
  check('an ordinary drop still reconnects', FakeWebSocket.instances.length > first + 1);
  conn.disconnect();
}

console.log(failures.length ? `\n${failures.length} pairing check(s) FAILED` : '\nAll pairing checks PASSED');
process.exit(failures.length ? 1 : 0);
