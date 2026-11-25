// WHEP (WebRTC-HTTP Egress Protocol, RFC 9725) playback: a low-latency camera stream from MediaMTX, go2rtc, a
// companion computer or anything else that serves WHEP.
//
// The exchange: POST an SDP offer (receive-only video, and audio for servers that expect it) to the endpoint;
// the 201 response carries the SDP answer and a Location naming the session; DELETE that Location when done. ICE
// candidates are gathered before the offer is sent (briefly bounded), so servers that don't take trickled
// candidates (PATCH) still connect. A bearer token, when given, goes in Authorization.
//
// Everything browser-specific (fetch, RTCPeerConnection) is passed in, so the flow can be tested without one.

export interface WhepDeps {
  fetch: typeof fetch;
  createPeerConnection: (config: RTCConfiguration) => RTCPeerConnection;
}

export interface WhepOptions {
  /** Bearer token for the endpoint (MediaMTX with authentication, a proxy). */
  token?: string;
  /** ICE servers; none by default (a camera on the same network needs none). */
  iceServers?: RTCIceServer[];
  /** How long to wait for ICE gathering before sending the offer anyway, ms. */
  gatherTimeoutMs?: number;
  /** How long the POST may take, ms (POST_TIMEOUT_MS). */
  postTimeoutMs?: number;
  /** After the answer, how long for the video track, ms (TRACK_TIMEOUT_MS). */
  trackTimeoutMs?: number;
}

export class WhepError extends Error {
  constructor(
    message: string,
    /** HTTP status, when the server answered. */
    public status?: number
  ) {
    super(message);
  }
}

/** How long the POST may take before the endpoint counts as unreachable (a wrong or blackholed address), ms. */
const POST_TIMEOUT_MS = 10_000;
/** After the answer, how long for the video track to arrive, ms. */
const TRACK_TIMEOUT_MS = 5_000;

/** Wait until ICE gathering is complete, `ms` has passed, or `signal` aborts (what's gathered goes in the offer). */
function gathered(pc: RTCPeerConnection, ms: number, signal: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === 'complete' || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
    signal.addEventListener('abort', done);
  });
}

/** Why the answer has no video: the server rejected it (port 0) or made it inactive; null when it accepted video. */
export function answerVideoProblem(sdp: string): string | null {
  const sections = sdp.split(/\r?\n(?=m=)/);
  const video = sections.find((sec) => sec.startsWith('m=video'));
  if (!video) return 'the answer has no video';
  if (/^m=video 0 /.test(video)) return 'the server refused the video (unsupported codec? browsers play H.264, VP8, VP9, AV1; not H.265)';
  if (/\r?\na=inactive/.test(video)) return 'the server sends no video on this stream';
  return null;
}

/** One WHEP session: start() connects and resolves with the incoming stream; stop() ends it (and tells the server). */
export class WhepSession {
  pc: RTCPeerConnection | null = null;
  /** The session's resource (the Location the server gave), for DELETE. */
  resource: string | null = null;
  private stopped = false;
  /** Aborted by stop(): wakes the ICE wait and cancels the POST. */
  private abort = new AbortController();

  constructor(private url: string, private deps: WhepDeps, private opts: WhepOptions = {}) {}

  private authHeaders(): Record<string, string> {
    return this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : {};
  }

  /** DELETE a session resource (best effort; keepalive, so also as the page goes). */
  private release(resource: string): Promise<unknown> {
    return this.deps.fetch(resource, { method: 'DELETE', headers: this.authHeaders(), keepalive: true }).catch(() => undefined);
  }

  /**
   * Connect: resolves with a stream holding the video track once it arrives (frames follow when ICE connects).
   * `onState` hears the peer connection's state changes. On any failure the connection is closed and a session
   * the server already made is deleted before this rejects.
   */
  async start(onState?: (state: RTCPeerConnectionState) => void): Promise<MediaStream> {
    try {
      return await this.connect(onState);
    } catch (e) {
      await this.stop();
      throw e instanceof WhepError ? e : new WhepError(e instanceof Error ? e.message : 'connection failed');
    }
  }

  private async connect(onState?: (state: RTCPeerConnectionState) => void): Promise<MediaStream> {
    const pc = this.deps.createPeerConnection({ iceServers: this.opts.iceServers ?? [] });
    this.pc = pc;
    // The incoming tracks, gathered into one stream (a server may send them without stream ids); done on video.
    const collected = new MediaStream();
    const videoArrived = new Promise<MediaStream>((resolve) => {
      pc.addEventListener('track', (e: RTCTrackEvent) => {
        const given = e.streams[0];
        if (given && given.getVideoTracks().length > 0) return resolve(given);
        collected.addTrack(e.track);
        if (e.track.kind === 'video') resolve(collected);
      });
    });
    pc.addEventListener('connectionstatechange', () => onState?.(pc.connectionState));
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, this.opts.gatherTimeoutMs ?? 2000, this.abort.signal);
    if (this.stopped) throw new WhepError('stopped');

    // The POST: cancelled by stop(), or after POST_TIMEOUT_MS.
    const post = new AbortController();
    const onStop = () => post.abort();
    this.abort.signal.addEventListener('abort', onStop);
    const postTimeout = this.opts.postTimeoutMs ?? POST_TIMEOUT_MS;
    const timer = setTimeout(() => post.abort(), postTimeout);
    let res: Response;
    try {
      res = await this.deps.fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', ...this.authHeaders() },
        body: pc.localDescription?.sdp ?? '',
        signal: post.signal,
      });
    } catch {
      if (this.stopped) throw new WhepError('stopped');
      throw new WhepError(
        post.signal.aborted
          ? `no answer from the WHEP endpoint in ${Math.round(postTimeout / 1000)} s (address right? reachable?)`
          : 'could not reach the WHEP endpoint (is it running, and does it allow this page? CORS)'
      );
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', onStop);
    }
    // A session made by the server is released whatever happens next (an answer after stop() included).
    const location = res.headers.get('Location');
    const resource = location ? new URL(location, this.url).toString() : null;
    if (this.stopped) {
      if (resource) await this.release(resource);
      throw new WhepError('stopped');
    }
    this.resource = resource;
    if (res.status !== 201 && res.status !== 200) {
      // The server's own reason, when it gives one (MediaMTX: {"error": "..."}; others: a short text).
      let reason = '';
      try {
        const body = (await res.text()).trim();
        try {
          reason = String(JSON.parse(body)?.error ?? '');
        } catch {
          reason = body.length <= 160 && !body.startsWith('<') ? body : '';
        }
      } catch {
        // No body.
      }
      const why = res.status === 401 || res.status === 403 ? 'not authorised (token?)' : res.status === 404 ? 'no such stream' : `HTTP ${res.status}`;
      const codecHint = /codec/i.test(reason) ? ' (browsers play H.264, VP8, VP9, AV1; not H.265)' : '';
      throw new WhepError(`the WHEP endpoint refused: ${why}${reason && !why.includes(reason) ? `: ${reason}` : ''}${codecHint}`, res.status);
    }
    const answer = await res.text();
    if (!answer.trim().startsWith('v=')) throw new WhepError('the WHEP endpoint answered without an SDP');
    const noVideo = answerVideoProblem(answer);
    if (noVideo) throw new WhepError(`no video: ${noVideo}`);
    if (this.stopped) throw new WhepError('stopped');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    // The video track should follow at once; if it doesn't, say so rather than wait for ever.
    let trackTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        videoArrived,
        new Promise<never>((_, reject) => {
          trackTimer = setTimeout(() => reject(new WhepError('no video track arrived (unsupported codec, e.g. H.265?)')), this.opts.trackTimeoutMs ?? TRACK_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(trackTimer);
    }
  }
  /**
   * Video frames received so far (decoded, else received, else packets), from the connection's statistics: the way to
   * tell a stalled WebRTC stream, since a <video> playing a MediaStream keeps its clock running with no frames. Null
   * when there's no connection or no video statistics yet.
   */
  async framesReceived(): Promise<number | null> {
    const pc = this.pc;
    if (!pc) return null;
    try {
      let n: number | null = null;
      (await pc.getStats()).forEach((r: { type?: string; kind?: string; mediaType?: string; framesDecoded?: number; framesReceived?: number; packetsReceived?: number }) => {
        if (r.type === 'inbound-rtp' && (r.kind ?? r.mediaType) === 'video') n = r.framesDecoded ?? r.framesReceived ?? r.packetsReceived ?? n;
      });
      return n;
    } catch {
      return null;
    }
  }

  /** End the session: close the connection and DELETE the resource (best effort; the server times it out anyway). */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    this.pc?.close();
    this.pc = null;
    const resource = this.resource;
    this.resource = null;
    if (resource) await this.release(resource);
  }
}
