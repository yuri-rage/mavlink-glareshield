import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';

// The desktop app as a bridge (desktop/bridgeServer.ts, desktop/bridgeCert.ts), against real wss:// clients: the
// pairing token (4001 / 4003 without it), Origins, /pair and the certificate page, MAVLink relayed both ways, NTRIP
// over the text channel (caster ports only), and its certificate kept, renewed and private.
export {};

const { BridgeServer, tokenOk, appLink, originAllowed, newToken } = await import('../desktop/bridgeServer.ts');
const { certNames, ensureCert, makeCert, stillGood } = await import('../desktop/bridgeCert.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const freePort = () =>
  new Promise<number>((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });

// ---- Pieces ----
check('token: right', tokenOk('/?token=abc', 'abc') === true);
check(
  'token: wrong (and a different length)',
  tokenOk('/?token=abd', 'abc') === false && tokenOk('/?token=ab', 'abc') === false
);
check('token: missing', tokenOk('/', 'abc') === null);
check('a new token: 22 URL-safe characters', /^[A-Za-z0-9_-]{22}$/.test(newToken()));
check(
  'origins: the hosted app, the desktop, LAN pages and none; not elsewhere',
  originAllowed('https://glareshield.yurirage.com') &&
    originAllowed('app://glareshield') &&
    originAllowed('http://192.168.1.20:3000') &&
    originAllowed(undefined) &&
    !originAllowed('https://evil.example') &&
    !originAllowed('app://glareshield.evil')
);
check(
  'app link: the hosted app, the wss link in the hash',
  appLink('192.168.1.5:56781', 'T_k') ===
    'https://glareshield.yurirage.com/#link=wss%3A%2F%2F192.168.1.5%3A56781%2F%3Ftoken%3DT_k'
);

// ---- Certificate ----
const names = certNames('my-pc', ['192.168.1.5']);
check(
  'cert names: localhost, loopback, the hostname (and .local), LAN addresses',
  names.join() === 'localhost,127.0.0.1,my-pc,my-pc.local,192.168.1.5'
);
check('cert names: an odd hostname is left out', !certNames('bad/name', []).some((n) => n.includes('/')));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glareshield-bridge-'));
const c1 = await ensureCert(dir, names);
const x509 = new crypto.X509Certificate(c1.cert);
check(
  'cert: names every address and name',
  ['IP Address:192.168.1.5', 'DNS:my-pc.local', 'IP Address:127.0.0.1'].every((n) => x509.subjectAltName?.includes(n)),
  x509.subjectAltName
);
check(
  'cert: SHA-256, RSA, about a year',
  x509.publicKey.asymmetricKeyType === 'rsa' &&
    /sha256/i.test(String((x509 as any).signatureAlgorithm ?? 'sha256')) &&
    Math.round((Date.parse(x509.validTo) - Date.now()) / 86400000) >= 364
);
check('cert: its key matches it', x509.checkPrivateKey(crypto.createPrivateKey(c1.key)));
check(
  'cert: kept private (0600)',
  process.platform === 'win32' || (fs.statSync(path.join(dir, 'bridge-cert.json')).mode & 0o777) === 0o600
);
const c2 = await ensureCert(dir, names);
check('cert: reused while it serves (devices keep trusting it)', c2.cert === c1.cert);
const c3 = await ensureCert(dir, [...names, '10.0.0.7']);
check(
  'cert: a new address: renewed, naming the old ones too',
  c3.cert !== c1.cert && c3.names.includes('10.0.0.7') && c3.names.includes('192.168.1.5')
);
check(
  'cert: renewed before it expires',
  !stillGood({ ...c1, notAfter: Date.now() + 86400000 }, names) && stillGood(c1, names)
);
fs.rmSync(dir, { recursive: true, force: true });

// ---- The server ----
const TOKEN = 'Tok_en-1234567890abcd';
const tls = await makeCert(['localhost', '127.0.0.1']);
const toVehicle: Uint8Array[] = [];
let clientCounts: number[] = [];
const bridge = new BridgeServer({ toVehicle: (d) => toVehicle.push(d), onClients: (n) => clientCounts.push(n) });
const port = await freePort();
await bridge.start(port, TOKEN, tls);
check('listening', bridge.listening);

const open = (q: string, origin: string | undefined = 'https://glareshield.yurirage.com') =>
  new Promise<{ ws: WebSocket; code?: number; status?: number; texts: any[]; bins: Buffer[] }>((resolve) => {
    const ws = new WebSocket(`wss://127.0.0.1:${port}/${q}`, {
      rejectUnauthorized: false,
      ...(origin ? { origin } : {}),
    });
    const r: any = { ws, texts: [], bins: [] };
    ws.on('message', (d, bin) => (bin ? r.bins.push(Buffer.from(d as Buffer)) : r.texts.push(JSON.parse(String(d)))));
    ws.on('open', () => resolve(r));
    ws.on('close', (code) => ((r.code = code), resolve(r)));
    ws.on('unexpected-response', (_req, res) => ((r.status = res.statusCode), resolve(r)));
    ws.on('error', () => {});
  });

let r = await open('');
await sleep(100);
check('no token: closed with 4001', r.code === 4001, String(r.code));
r = await open('?token=nope');
await sleep(100);
check('wrong token: closed with 4003', r.code === 4003, String(r.code));
r = await open(`?token=${TOKEN}`, 'https://evil.example');
check('another site: refused before the WebSocket', r.status === 401 || r.status === 403, String(r.status));

const a = await open(`?token=${TOKEN}`);
const b = await open(`?token=${TOKEN}`, undefined);
await sleep(100);
check(
  'paired devices connect (a browser, and a client without an Origin)',
  a.ws.readyState === WebSocket.OPEN && b.ws.readyState === WebSocket.OPEN && bridge.clientCount === 2
);
bridge.broadcast(Uint8Array.of(0xfd, 1, 2, 3));
await sleep(100);
check('the vehicle reaches every device', a.bins.length === 1 && b.bins.length === 1 && a.bins[0][0] === 0xfd);
a.ws.send(Buffer.from([0xfd, 9, 9]));
await sleep(100);
check("a device's MAVLink reaches the vehicle", toVehicle.length === 1 && toVehicle[0][1] === 9);
a.ws.send('{"type":"nonsense"');
a.ws.send(JSON.stringify({ type: 'ntrip_connect', host: '127.0.0.1', port: 8080, mountpoint: 'M' }));
await sleep(150);
check(
  'NTRIP: only caster ports (2101-2105), as the Python bridge',
  a.texts.some((m) => m.type === 'ntrip_error' && /Invalid NTRIP/.test(m.message)) && a.ws.readyState === WebSocket.OPEN
);

// A fake caster on 2101 when it's free here: the stream through the bridge, as bridge.py sends it.
const caster = net.createServer((s) =>
  s.once('data', () => s.write(Buffer.concat([Buffer.from('ICY 200 OK\r\n'), Buffer.from([0xd3, 0, 0])])))
);
const casterUp = await new Promise<boolean>((res) => {
  caster.once('error', () => res(false));
  caster.listen(2101, '127.0.0.1', () => res(true));
});
if (casterUp) {
  a.texts.length = 0;
  a.ws.send(JSON.stringify({ type: 'ntrip_connect', host: '127.0.0.1', port: 2101, mountpoint: 'M' }));
  await sleep(200);
  check(
    'NTRIP through the bridge: streaming, RTCM as base64',
    a.texts.some((m) => m.type === 'ntrip_status' && m.status === 'streaming') &&
      a.texts.some((m) => m.type === 'ntrip_data' && m.data === Buffer.from([0xd3, 0, 0]).toString('base64')),
    JSON.stringify(a.texts)
  );
  a.ws.send(JSON.stringify({ type: 'ntrip_disconnect' }));
  await sleep(100);
  check(
    'NTRIP disconnect: said so',
    a.texts.some((m) => m.type === 'ntrip_status' && m.status === 'disconnected')
  );
  caster.close();
} else {
  console.log('SKIP  NTRIP through the bridge (port 2101 is taken here)');
}

// Pages for a browser tab.
const get = (p: string, host = `127.0.0.1:${port}`) =>
  new Promise<{ status: number; location?: string; body: string }>((resolve) => {
    https
      .get({ host: '127.0.0.1', port, path: p, rejectUnauthorized: false, headers: { Host: host } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body }));
      })
      .on('error', () => resolve({ status: 0, body: '' }));
  });
let g = await get('/');
check('the certificate page', g.status === 200 && /trusts its certificate/.test(g.body));
g = await get('/pair?token=nope');
check('/pair with a wrong token: refused', g.status === 403);
g = await get(`/pair?token=${TOKEN}`, '192.168.1.5:56781');
check(
  '/pair: on to the hosted app with the link to this bridge',
  g.status === 302 && g.location === appLink('192.168.1.5:56781', TOKEN),
  g.location
);
g = await get(`/pair?token=${TOKEN}`, 'evil.example/phish?x=');
check(
  '/pair: an odd Host header is not put in the link',
  g.status === 302 &&
    !String(g.location).includes('evil') &&
    String(g.location).includes(encodeURIComponent(`localhost:${port}`)),
  String(g.location)
);

// Another program on the port; stopping.
const second = new BridgeServer({ toVehicle: () => {}, onClients: () => {} });
const why = await second.start(port, TOKEN, tls).then(
  () => 'started',
  (e) => e.message
);
check('port in use: said so', /^Port \d+ is in use by another program/.test(why), why);
clientCounts = [];
await bridge.stop();
await sleep(100);
check(
  'stopped: devices dropped, not listening',
  !bridge.listening && a.ws.readyState === WebSocket.CLOSED && clientCounts[clientCounts.length - 1] === 0
);

console.log(
  failures.length ? `\n${failures.length} desktop bridge check(s) FAILED` : '\nAll desktop bridge checks PASSED'
);
process.exit(failures.length ? 1 : 0);
