// WHEP session flow with a fake peer connection, MediaStream and fetch: offer posted, answer applied, video only,
// and every way out closing the connection and deleting a session the server made.
import { WhepSession, WhepError, answerVideoProblem } from '../src/lib/whep.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeTrack {
  constructor(public kind: string) {}
}
class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) { this.tracks = [...tracks]; }
  addTrack(t: FakeTrack) { this.tracks.push(t); }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video'); }
}
(globalThis as any).MediaStream = FakeStream;

/** What the fake server sends after the answer: tracks, with or without stream ids. */
type TrackPlan = { kind: string; withStream: boolean }[];
class FakePC {
  transceivers: { kind: string; direction: string }[] = [];
  listeners: Record<string, ((e: any) => void)[]> = {};
  iceGatheringState: RTCIceGatheringState = 'new';
  connectionState: RTCPeerConnectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  closed = false;
  constructor(public config: RTCConfiguration, private gatherAfterMs = 5, private plan: TrackPlan = [{ kind: 'video', withStream: true }]) {}
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
    let delay = 1;
    for (const t of this.plan) {
      const track = new FakeTrack(t.kind);
      setTimeout(() => this.emit('track', { track, streams: t.withStream ? [new FakeStream([track, ...(t.kind === 'video' ? [] : [])])] : [] }), delay++);
    }
  }
  close() { this.closed = true; }
}

const calls: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
type Reply = { status: number; body?: string; location?: string } | 'network' | 'hang';
const fakeFetch = (reply: (url: string, init: any) => Reply, delayMs = 0) =>
  (async (url: string, init: any) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body });
    const r = reply(String(url), init);
    if (r === 'network') throw new TypeError('Failed to fetch');
    if (r === 'hang' || delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = r === 'hang' ? undefined : setTimeout(resolve, delayMs);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
      });
    }
    const rr = r as { status: number; body?: string; location?: string };
    return { status: rr.status, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? (rr.location ?? null) : null) }, text: async () => rr.body ?? '' } as unknown as Response;
  }) as typeof fetch;

let pc: FakePC | null = null;
const deps = (reply: (url: string, init: any) => Reply, o: { gatherAfterMs?: number; plan?: TrackPlan; delayMs?: number } = {}) => ({
  fetch: fakeFetch(reply, o.delayMs),
  createPeerConnection: (c: RTCConfiguration) => (pc = new FakePC(c, o.gatherAfterMs ?? 5, o.plan)) as unknown as RTCPeerConnection,
});
const ANSWER = 'v=0\r\no=answer\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=recvonly';
const ok = (location = '/front/whep/abc123') => (_u: string, i: any): Reply => (i.method === 'POST' ? { status: 201, body: ANSWER, location } : { status: 200 });

// The happy path.
calls.length = 0;
let s = new WhepSession('http://cam:8889/front/whep', deps(ok()), { token: 'sekrit' });
const stream = (await s.start()) as unknown as FakeStream;
check('receive-only video and audio offered', JSON.stringify(pc!.transceivers) === JSON.stringify([{ kind: 'video', direction: 'recvonly' }, { kind: 'audio', direction: 'recvonly' }]));
check('offer POSTed as application/sdp, after ICE gathering (candidates in it)', calls[0].method === 'POST' && calls[0].headers['Content-Type'] === 'application/sdp' && /a=candidate/.test(calls[0].body ?? ''), JSON.stringify(calls[0]));
check('bearer token sent', calls[0].headers.Authorization === 'Bearer sekrit');
check('answer applied; resolves with the video', pc!.remote?.type === 'answer' && stream.getVideoTracks().length === 1);
check('relative Location resolved against the endpoint', s.resource === 'http://cam:8889/front/whep/abc123', String(s.resource));
await s.stop();
check('stop: connection closed, resource DELETEd with the token', pc!.closed && calls[1]?.method === 'DELETE' && calls[1].url === 'http://cam:8889/front/whep/abc123' && calls[1].headers.Authorization === 'Bearer sekrit', JSON.stringify(calls[1]));

// Errors in words that say what to fix, and nothing left open.
const fail = async (reply: (u: string, i: any) => Reply, o: Parameters<typeof deps>[1] = {}, opts = {}) => {
  calls.length = 0;
  try {
    await new WhepSession('http://cam/whep', deps(reply, o), opts).start();
    return 'no error';
  } catch (e) {
    return e instanceof WhepError ? e.message : String(e);
  }
};
check('404: no such stream; connection closed at once', /no such stream/.test(await fail(() => ({ status: 404 }))) && pc!.closed);
check('the server\'s reason, with the codec hint (MediaMTX on an H.265 stream)', /HTTP 400: codecs not supported by client \(browsers play H\.264.*not H\.265\)/.test(await fail(() => ({ status: 400, body: '{"status":"error","error":"codecs not supported by client"}' }))));
check('401: not authorised (token?)', /not authorised/.test(await fail(() => ({ status: 401 }))));
check('network error: unreachable or CORS', /CORS/.test(await fail(() => 'network')));
check('an answer that isn\'t SDP is refused', /without an SDP/.test(await fail(() => ({ status: 201, body: '<html>' }))));
check('a POST that never answers times out (a wrong address)', /no answer from the WHEP endpoint/.test(await fail(() => 'hang', {}, { postTimeoutMs: 100 })) && pc!.closed);

// Video refused (H.265, say): a clear error, the connection closed, the server's session deleted.
const refused = await fail((_u, i) => (i.method === 'POST' ? { status: 201, body: 'v=0\r\nm=video 0 UDP/TLS/RTP/SAVPF 0\r\nm=audio 9 UDP 111', location: '/s/1' } : { status: 200 }));
check('video refused by the server: says so (codec), closes, DELETEs', /refused the video/.test(refused) && pc!.closed && calls.some((c) => c.method === 'DELETE' && c.url === 'http://cam/s/1'), refused);
check('answerVideoProblem: inactive video', /no video/.test(answerVideoProblem('v=0\r\nm=video 9 X 96\r\na=inactive') ?? ''));
check('answerVideoProblem: accepted video', answerVideoProblem(ANSWER) === null);
check('no video track arriving: times out with the codec hint', /no video track arrived/.test(await fail(ok(), { plan: [{ kind: 'audio', withStream: false }] }, { trackTimeoutMs: 100 })) && pc!.closed);

// Tracks without stream ids, audio first: one stream with the video, not an audio-only one.
calls.length = 0;
s = new WhepSession('http://cam/whep', deps(ok(), { plan: [{ kind: 'audio', withStream: false }, { kind: 'video', withStream: false }] }));
const mixed = (await s.start()) as unknown as FakeStream;
check('audio first, no stream ids: resolves with the video in it', mixed.getVideoTracks().length === 1, JSON.stringify(mixed.getTracks().map((t) => t.kind)));
await s.stop();

// stop() while the POST is in flight: the answer arriving later is DELETEd, nothing left on the server.
calls.length = 0;
s = new WhepSession('http://cam/whep', deps(ok('/late/9'), { delayMs: 80 }));
const pending = s.start().catch((e) => (e as Error).message);
await sleep(40);
await s.stop();
const why = await pending;
await sleep(150);
check('stopped mid-POST: cancelled, connection closed', /stopped/.test(String(why)) && pc!.closed, String(why));

// A server that answers after stop() anyway (its fetch didn't honour the cancel): that late session is DELETEd.
calls.length = 0;
const stubborn = {
  fetch: (async (url: string, init: any) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {} });
    if (init.method === 'POST') await sleep(80); // ignores the abort signal
    return { status: init.method === 'POST' ? 201 : 200, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? '/late/9' : null) }, text: async () => ANSWER } as unknown as Response;
  }) as typeof fetch,
  createPeerConnection: (c: RTCConfiguration) => (pc = new FakePC(c)) as unknown as RTCPeerConnection,
};
s = new WhepSession('http://cam/whep', stubborn);
const late = s.start().catch((e) => (e as Error).message);
await sleep(30);
await s.stop();
await late;
check('a session answered after stop() is DELETEd', calls.some((c) => c.method === 'DELETE' && c.url === 'http://cam/late/9'), JSON.stringify(calls.map((c) => `${c.method} ${c.url}`)));

// stop() while waiting for the video track: rejects at once, not after the track timeout.
calls.length = 0;
s = new WhepSession('http://cam/whep', deps(ok(), { plan: [] }), { trackTimeoutMs: 5000 });
const waiting = s.start().catch((e) => (e as Error).message);
await sleep(60);
const tStop = Date.now();
await s.stop();
const reason = await waiting;
check('stop while awaiting the track: rejects at once', /stopped/.test(String(reason)) && Date.now() - tStop < 500, `${reason} after ${Date.now() - tStop} ms`);

// Gathering that never completes doesn't hang: the offer goes after the timeout.
calls.length = 0;
const t0 = Date.now();
s = new WhepSession('http://cam/whep', deps(ok(), { gatherAfterMs: -1 }), { gatherTimeoutMs: 100 });
await s.start();
check('ICE gathering never completing: offer sent after the timeout', calls[0]?.method === 'POST' && Date.now() - t0 >= 90 && Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
await s.stop();

console.log(failures.length ? `\n${failures.length} WHEP check(s) FAILED` : '\nAll WHEP checks PASSED');
process.exit(failures.length ? 1 : 0);
