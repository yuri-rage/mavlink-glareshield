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

/** Wait until ICE gathering is complete, or `ms` has passed (what's gathered by then goes in the offer). */
function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** One WHEP session: start() connects and resolves with the incoming stream; stop() ends it (and tells the server). */
export class WhepSession {
  pc: RTCPeerConnection | null = null;
  /** The session's resource (the Location the server gave), for DELETE. */
  resource: string | null = null;
  private stopped = false;

  constructor(private url: string, private deps: WhepDeps, private opts: WhepOptions = {}) {}

  /**
   * Connect: resolves with the media stream once the server has answered (frames follow when ICE connects).
   * `onState` hears the peer connection's state changes (connected, disconnected, failed).
   */
  async start(onState?: (state: RTCPeerConnectionState) => void): Promise<MediaStream> {
    const pc = this.deps.createPeerConnection({ iceServers: this.opts.iceServers ?? [] });
    this.pc = pc;
    const stream = new Promise<MediaStream>((resolve) => {
      pc.addEventListener('track', (e: RTCTrackEvent) => resolve(e.streams[0] ?? new MediaStream([e.track])));
    });
    pc.addEventListener('connectionstatechange', () => onState?.(pc.connectionState));
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, this.opts.gatherTimeoutMs ?? 2000);
    if (this.stopped) throw new WhepError('stopped');

    const headers: Record<string, string> = { 'Content-Type': 'application/sdp' };
    if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
    let res: Response;
    try {
      res = await this.deps.fetch(this.url, { method: 'POST', headers, body: pc.localDescription?.sdp ?? '' });
    } catch {
      // A network error before any answer: unreachable, or the server doesn't allow this page (CORS).
      throw new WhepError('could not reach the WHEP endpoint (is it running, and does it allow this page? CORS)');
    }
    if (res.status !== 201 && res.status !== 200) {
      const why = res.status === 401 || res.status === 403 ? 'not authorised (token?)' : res.status === 404 ? 'no such stream' : `HTTP ${res.status}`;
      throw new WhepError(`the WHEP endpoint refused: ${why}`, res.status);
    }
    const location = res.headers.get('Location');
    this.resource = location ? new URL(location, this.url).toString() : null;
    const answer = await res.text();
    if (!answer.trim().startsWith('v=')) throw new WhepError('the WHEP endpoint answered without an SDP');
    if (this.stopped) throw new WhepError('stopped');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    return stream;
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
    this.pc?.close();
    this.pc = null;
    const resource = this.resource;
    this.resource = null;
    if (resource) {
      const headers: Record<string, string> = {};
      if (this.opts.token) headers.Authorization = `Bearer ${this.opts.token}`;
      // keepalive: still sent when this runs as the page goes away.
      await this.deps.fetch(resource, { method: 'DELETE', headers, keepalive: true }).catch(() => undefined);
    }
  }
}
