import net from 'node:net';

// NTRIP from the desktop app (desktop/ntripClient.ts) against a local fake caster: the request it sends, an ICY and
// an HTTP acceptance with RTCM right behind the header, refusals and silences with the caster's own words, GGA going
// back (and nothing else), and the stream ending on either side.
export {};

const { checkNtripRequest, connectNtrip, parseCasterHeader, requestText } = await import('../desktop/ntripClient.ts');
const { NtripStreams } = await import('../desktop/ntripStreams.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A caster that answers each connection with `respond`, recording what it was sent. */
async function caster(respond: (sock: net.Socket, request: string) => void) {
  const got: string[] = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    let req = '';
    let answered = false;
    sock.on('data', (d) => {
      req += d.toString('latin1');
      got.push(d.toString('latin1'));
      if (!answered && req.includes('\r\n\r\n')) {
        answered = true;
        respond(sock, req);
      }
    });
    sock.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    got,
    sockets,
    close: () => new Promise<void>((r) => (sockets.forEach((s) => s.destroy()), server.close(() => r()))),
  };
}
const req = (port: number, extra = {}) => ({ host: '127.0.0.1', port, mountpoint: 'MP', ...extra });
const RTCM = Buffer.from([0xd3, 0x00, 0x13, 0x3e, 0xd7]);

// The request, as bridge.py sends it.
const text = requestText({ host: 'caster.example', port: 2101, mountpoint: 'MP', username: 'u', password: 'p' });
check(
  'request: GET /mountpoint HTTP/1.0, host, agent, basic auth',
  text ===
    'GET /MP HTTP/1.0\r\nHost: caster.example:2101\r\nUser-Agent: NTRIP MavlinkGlareshield/1.0\r\nAuthorization: Basic dTpw\r\n\r\n',
  JSON.stringify(text)
);
check(
  'request: no auth header without a login',
  !requestText({ host: 'h', port: 1, mountpoint: 'M' }).includes('Authorization')
);

// Checked before anything is opened.
check(
  'check: missing mountpoint',
  checkNtripRequest({ host: 'h', port: 2101, mountpoint: '' }) === 'Missing host or mountpoint'
);
check(
  'check: a host with a path or scheme',
  typeof checkNtripRequest({ host: 'http://x/y', port: 2101, mountpoint: 'M' }) === 'string'
);
check(
  'check: a request-line injection in the mountpoint',
  typeof checkNtripRequest({ host: 'h', port: 2101, mountpoint: 'M HTTP/1.0\r\nX: y' }) === 'string'
);
check('check: a port out of range', typeof checkNtripRequest({ host: 'h', port: 70000, mountpoint: 'M' }) === 'string');
const ok = checkNtripRequest({ host: ' rtk2go.com ', port: 2102, mountpoint: '/MP_1' });
check(
  'check: trimmed, any port, leading slash dropped',
  typeof ok === 'object' && ok.host === 'rtk2go.com' && ok.port === 2102 && ok.mountpoint === 'MP_1',
  JSON.stringify(ok)
);

// Header parsing.
check(
  'header: ICY ends at its own line',
  parseCasterHeader(Buffer.concat([Buffer.from('ICY 200 OK\r\n'), RTCM])).kind === 'ok'
);
check('header: still coming', parseCasterHeader(Buffer.from('HTTP/1.1 200 OK\r\nServer: x\r\n')).kind === 'incomplete');
const refused = parseCasterHeader(Buffer.from('HTTP/1.1 401 Unauthorized\r\n\r\n'));
check(
  'header: a refusal keeps its words',
  refused.kind === 'rejected' && refused.header === 'HTTP/1.1 401 Unauthorized'
);
check(
  'header: "200 OK" elsewhere is not acceptance',
  parseCasterHeader(Buffer.from('HTTP/1.1 404 Not Found\r\nX-Note: 200 OK\r\n\r\n')).kind === 'rejected'
);
check('header: too long', parseCasterHeader(Buffer.alloc(9000, 0x41)).kind === 'too-long');

// ICY, with RTCM in the same packet as the header.
{
  const c = await caster((sock) => sock.write(Buffer.concat([Buffer.from('ICY 200 OK\r\n'), RTCM])));
  const data: Buffer[] = [];
  let closedWhy: string | null = null;
  const s = await connectNtrip(req(c.port, { username: 'u', password: 'p' }), {
    onData: (d) => data.push(Buffer.from(d)),
    onClosed: (why) => (closedWhy = why),
  });
  await sleep(50);
  check('ICY: accepted, the RTCM behind the header delivered', Buffer.concat(data).equals(RTCM));
  check('…logged in', c.got.join('').includes('Authorization: Basic dTpw'));
  c.sockets[0].write(RTCM);
  await sleep(50);
  check('…and what follows', Buffer.concat(data).length === RTCM.length * 2);
  s.sendGga('$GPGGA,123519.00,4807.0380,N,01131.0000,E,1,08,0.9,545.4,M,46.9,M,,*47');
  s.sendGga('not a sentence\r\nGET /other HTTP/1.0');
  await sleep(50);
  const sent = c.got.slice(1).join('');
  check(
    'GGA: forwarded as one line',
    sent === '$GPGGA,123519.00,4807.0380,N,01131.0000,E,1,08,0.9,545.4,M,46.9,M,,*47\r\n',
    JSON.stringify(sent)
  );
  c.sockets[0].end();
  await sleep(50);
  check('the caster ends the stream: said so', closedWhy === 'The caster closed the stream', String(closedWhy));
  await c.close();
}

// HTTP/1.1 200 (NTRIP v2 casters answering a 1.0 request), then our own close: no "closed" report.
{
  const c = await caster((sock) => sock.write('HTTP/1.1 200 OK\r\nContent-Type: gnss/data\r\n\r\n'));
  let closedWhy: string | null = null;
  const s = await connectNtrip(req(c.port), { onData: () => {}, onClosed: (w) => (closedWhy = w) });
  check('HTTP 200: accepted', Boolean(s));
  await s.close();
  await sleep(50);
  check('closed by us: not reported as the caster ending it', closedWhy === null);
  await c.close();
}

const fails = async (respond: (sock: net.Socket) => void, timeoutMs?: number, extra = {}) => {
  const c = await caster(respond);
  try {
    await connectNtrip(req(c.port, extra), { onData: () => {}, onClosed: () => {} }, timeoutMs);
    return 'connected';
  } catch (e: any) {
    return e.message as string;
  } finally {
    await c.close();
  }
};
let why = await fails((sock) => sock.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic\r\n\r\n'));
check(
  '401: refused, its status line and what it means',
  why === 'Caster rejected: HTTP/1.1 401 Unauthorized (check the username and password)',
  why
);
why = await fails((sock) => sock.end('SOURCETABLE 200 OK\r\nSTR;OTHER;...\r\nENDSOURCETABLE\r\n\r\n'));
check(
  'an unknown mountpoint (the sourcetable): refused, the list not repeated',
  why === 'Caster rejected: no mountpoint "MP" (it answered with its list of mountpoints)',
  why
);
why = await fails((sock) => sock.end('HTTP/1.1 404 Not Found\r\nServer: x\r\n\r\n'));
check('another refusal: the status line', why === 'Caster rejected: HTTP/1.1 404 Not Found', why);
why = await fails(() => {}, 300);
check('no answer: timed out', /^No answer from 127\.0\.0\.1:\d+ in 1 s$/.test(why), why);
why = await fails((sock) => sock.write(Buffer.alloc(9000, 0x41)));
check('an endless header: refused', why === 'Caster response header over 8192 bytes', why);
why = await fails((sock) => sock.end());
check('closed before answering', why === 'Caster closed the connection before answering', why);
// Nothing listening.
const free = await caster(() => {});
const deadPort = free.port;
await free.close();
why = await connectNtrip(req(deadPort), { onData: () => {}, onClosed: () => {} }).then(
  () => 'connected',
  (e) => e.message
);
check(
  'connection refused: the address and why',
  why.startsWith(`Caster 127.0.0.1:${deadPort}: connect ECONNREFUSED`),
  why
);

// ---- The main process's streams (desktop/ntripStreams.ts): what reaches the page, by the page's ID ----------------
{
  const sent: [string, string, any][] = [];
  const streams = new NtripStreams((channel, id, value) => sent.push([channel, id, value]));
  const data = (id: string) =>
    Buffer.concat(sent.filter(([c, i]) => c === 'ntrip:data' && i === id).map(([, , v]) => Buffer.from(v)));

  // The caster's first RTCM in the same packet as its acceptance (as real casters send it): passed on, not dropped.
  const c = await caster((sock) => sock.write(Buffer.concat([Buffer.from('ICY 200 OK\r\n\r\n'), RTCM])));
  await streams.open('s1', req(c.port));
  await sleep(50);
  check(
    'streams: the RTCM in the acceptance packet reaches the page',
    data('s1').equals(RTCM),
    data('s1').toString('hex')
  );
  c.sockets[0].write(RTCM);
  await sleep(50);
  check('…and what follows', data('s1').length === RTCM.length * 2);
  let why = await streams.open('s1', req(c.port)).then(
    () => 'opened',
    (e) => e.message
  );
  check('streams: an ID in use is refused', why === 'Stream s1 is already open', why);
  why = await streams.open('../x', req(c.port)).then(
    () => 'opened',
    (e) => e.message
  );
  check('streams: a malformed ID is refused', why === 'Not a stream ID', why);
  why = await streams.open('s2', { host: 'h', port: 2101, mountpoint: '' }).then(
    () => 'opened',
    (e) => e.message
  );
  check(
    'streams: a bad request is refused, nothing kept',
    why === 'Missing host or mountpoint' && streams.size === 1,
    why
  );
  c.sockets[0].end();
  await sleep(50);
  check(
    'streams: the caster ending it is reported by ID, then forgotten',
    sent.some(([ch, i, v]) => ch === 'ntrip:closed' && i === 's1' && v === 'The caster closed the stream') &&
      streams.size === 0
  );
  await c.close();

  // Closed by the page while the caster is still answering: closed once it connects, nothing sent for it.
  const slow = await caster((sock) =>
    setTimeout(() => sock.write(Buffer.concat([Buffer.from('ICY 200 OK\r\n'), RTCM])), 150)
  );
  const opening = streams.open('s3', req(slow.port)).then(
    () => 'opened',
    (e) => e.message
  );
  await sleep(20);
  await streams.close('s3');
  why = await opening;
  await sleep(50);
  check(
    'streams: closed while connecting: the open fails, the socket goes',
    why === 'Closed before the caster answered' && slow.sockets[0].destroyed,
    why
  );
  check('…and none of its data reaches the page', data('s3').length === 0);
  // A reload (every stream) while connecting: the same.
  const opening2 = streams.open('s4', req(slow.port)).then(
    () => 'opened',
    (e) => e.message
  );
  await sleep(20);
  await streams.closeAll();
  why = await opening2;
  check(
    'streams: a reload while connecting closes it too',
    why === 'Closed before the caster answered' && streams.size === 0,
    why
  );
  await slow.close();
}

console.log(
  failures.length ? `\n${failures.length} desktop NTRIP check(s) FAILED` : '\nAll desktop NTRIP checks PASSED'
);
process.exit(failures.length ? 1 : 0);
