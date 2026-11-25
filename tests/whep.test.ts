// WHEP session flow with a fake peer connection and fetch: offer posted, answer applied, resource deleted.
import { WhepSession, WhepError } from '../src/lib/whep.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

class FakePC {
  transceivers: { kind: string; direction: string }[] = [];
  listeners: Record<string, ((e: any) => void)[]> = {};
  iceGatheringState: RTCIceGatheringState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  closed = false;
  constructor(public config: RTCConfiguration, private gatherAfterMs = 5) {}
  addEventListener(t: string, f: (e: any) => void) { (this.listeners[t] ??= []).push(f); }
  removeEventListener(t: string, f: (e: any) => void) { this.listeners[t] = (this.listeners[t] ?? []).filter((x) => x !== f); }
  emit(t: string, e: any = {}) { for (const f of this.listeners[t] ?? []) f(e); }
  addTransceiver(kind: string, init: { direction: string }) { this.transceivers.push({ kind, direction: init.direction }); }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=offer' }; }
  async setLocalDescription(d: any) {
    this.localDescription = d;
    this.iceGatheringState = 'gathering';
    if (this.gatherAfterMs >= 0) setTimeout(() => { this.iceGatheringState = 'complete'; this.localDescription = { ...d, sdp: d.sdp + '\r\na=candidate:1' }; this.emit('icegatheringstatechange'); }, this.gatherAfterMs);
  }
  async setRemoteDescription(d: any) {
    this.remote = d;
    setTimeout(() => this.emit('track', { streams: ['STREAM'], track: {} }), 1);
  }
  close() { this.closed = true; }
}

const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
const fakeFetch = (reply: (url: string, init: any) => { status: number; body?: string; location?: string } | 'network') =>
  (async (url: string, init: any) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body });
    const r = reply(String(url), init);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { status: r.status, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? (r.location ?? null) : null) }, text: async () => r.body ?? '' } as unknown as Response;
  }) as typeof fetch;

let pc: FakePC | null = null;
const deps = (reply: Parameters<typeof fakeFetch>[0], gatherAfterMs = 5) => ({
  fetch: fakeFetch(reply),
  createPeerConnection: (c: RTCConfiguration) => (pc = new FakePC(c, gatherAfterMs)) as unknown as RTCPeerConnection,
});

// The happy path.
calls.length = 0;
let s = new WhepSession('http://cam:8889/front/whep', deps((_u, i) => (i.method === 'POST' ? { status: 201, body: 'v=0\r\no=answer', location: '/front/whep/abc123' } : { status: 200 })), { token: 'sekrit' });
const stream = await s.start();
check('receive-only video and audio offered', JSON.stringify(pc!.transceivers) === JSON.stringify([{ kind: 'video', direction: 'recvonly' }, { kind: 'audio', direction: 'recvonly' }]));
check('offer POSTed as application/sdp, after ICE gathering (candidates in it)', calls[0].method === 'POST' && calls[0].headers['Content-Type'] === 'application/sdp' && /a=candidate/.test(calls[0].body ?? ''), JSON.stringify(calls[0]));
check('bearer token sent', calls[0].headers.Authorization === 'Bearer sekrit');
check('answer applied; the stream resolved', pc!.remote?.type === 'answer' && pc!.remote.sdp.includes('o=answer') && stream === ('STREAM' as unknown as MediaStream));
check('relative Location resolved against the endpoint', s.resource === 'http://cam:8889/front/whep/abc123', String(s.resource));
await s.stop();
check('stop: connection closed, resource DELETEd with the token', pc!.closed && calls[1]?.method === 'DELETE' && calls[1].url === 'http://cam:8889/front/whep/abc123' && calls[1].headers.Authorization === 'Bearer sekrit', JSON.stringify(calls[1]));

// Errors, in words that say what to fix.
const fail = async (reply: Parameters<typeof fakeFetch>[0]) => {
  try {
    await new WhepSession('http://cam/whep', deps(reply)).start();
    return 'no error';
  } catch (e) {
    return e instanceof WhepError ? e.message : String(e);
  }
};
check('404: no such stream', /no such stream/.test(await fail(() => ({ status: 404 }))));
check('401: not authorised (token?)', /not authorised/.test(await fail(() => ({ status: 401 }))));
check('network error: unreachable or CORS', /CORS/.test(await fail(() => 'network')));
check('an answer that isn\'t SDP is refused', /without an SDP/.test(await fail(() => ({ status: 201, body: '<html>' }))));

// Gathering that never completes doesn't hang: the offer goes after the timeout.
calls.length = 0;
const t0 = Date.now();
s = new WhepSession('http://cam/whep', deps(() => ({ status: 201, body: 'v=0' }), -1), { gatherTimeoutMs: 100 });
await s.start();
check('ICE gathering never completing: offer sent after the timeout', calls[0]?.method === 'POST' && Date.now() - t0 >= 90 && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);

console.log(failures.length ? `\n${failures.length} WHEP check(s) FAILED` : '\nAll WHEP checks PASSED');
process.exit(failures.length ? 1 : 0);
