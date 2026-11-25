import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { MjpegFrameExtractor, reconnectDelayMs } from '../../lib/mjpeg';
import { WhepSession } from '../../lib/whep';

export type CameraState = 'connecting' | 'live' | 'reconnecting' | 'error';

export interface CameraStatus {
  state: CameraState;
  /** 'fetch': frames are read directly (stalls are detected). 'img': browser-managed stream (CORS not allowed). */
  method: 'fetch' | 'img' | 'video' | 'snapshot' | 'whep';
  detail?: string;
}

export interface CameraFeedProps {
  url: string;
  type: 'mjpeg' | 'snapshot' | 'video' | 'whep';
  /** WHEP: a bearer token for the endpoint, if it needs one. */
  token?: string;
  fit: 'cover' | 'contain';
  opacity: number;
  snapshotIntervalMs: number;
  /** Changing this forces a fresh connection (manual reconnect, link restored, tab visible again). */
  reconnectKey: number;
  onStatus: (status: CameraStatus) => void;
}

/** No new frame for this long means the stream has stalled. */
export const STALL_TIMEOUT_MS = 4000;
/** <video>: no playback progress for this long while not paused means it has stalled. */
const VIDEO_STALL_MS = 6000;
/** <img> fallback: how often to check that the camera is still reachable. */
const PROBE_INTERVAL_MS = 10000;

const withCacheBuster = (url: string, n: number) => `${url}${url.includes('?') ? '&' : '?'}_r=${n}`;

/** URLs whose server refused a CORS fetch: use <img> for them for the rest of the session. */
const corsBlocked = new Set<string>();

/** WHEP: a disconnected peer connection that hasn't recovered after this long is reconnected. */
const WHEP_DISCONNECT_GRACE_MS = 4000;

export const CameraFeed: React.FC<CameraFeedProps> = ({ url, type, token, fit, opacity, snapshotIntervalMs, reconnectKey, onStatus }) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [imgSrc, setImgSrc] = useState('');
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  const className = clsx('w-full h-full', fit === 'contain' ? 'object-contain' : 'object-cover');

  // ---------------------------------------------------------------------------------------------------------
  // MJPEG: fetch + frame extraction with stall detection; <img> fallback when CORS is not allowed.
  // ---------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (type !== 'mjpeg' || !url) return;
    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let probeTimer: ReturnType<typeof setInterval> | null = null;
    let controller: AbortController | null = null;
    let lastObjectUrl: string | null = null;
    const report = (s: CameraStatus) => !cancelled && statusRef.current(s);

    const scheduleRetry = (run: () => void, reason: string, method: CameraStatus['method']) => {
      if (cancelled) return;
      const delay = reconnectDelayMs(attempt++);
      report({ state: 'reconnecting', method, detail: `${reason}; retrying in ${Math.round(delay / 1000)} s` });
      retryTimer = setTimeout(run, delay);
    };

    const runImgFallback = () => {
      // The browser owns the stream here, so a stall is invisible. Reconnect on load errors, and whenever the
      // camera stops answering and then comes back (network drop, camera or go2rtc restart).
      let n = 0;
      let reachable = true;
      const connect = () => {
        if (cancelled) return;
        setImgSrc(withCacheBuster(url, ++n));
        report({ state: 'connecting', method: 'img' });
      };
      const img = imgRef.current;
      const onLoad = () => {
        attempt = 0;
        report({ state: 'live', method: 'img', detail: 'stall detection needs CORS on the camera' });
      };
      const onError = () => scheduleRetry(connect, 'stream failed', 'img');
      img?.addEventListener('load', onLoad);
      img?.addEventListener('error', onError);
      probeTimer = setInterval(async () => {
        const probe = new AbortController();
        const timeout = setTimeout(() => probe.abort(), 4000);
        try {
          await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: probe.signal });
          if (!reachable) connect(); // it was gone and is back: the old stream is dead
          reachable = true;
        } catch {
          if (reachable) report({ state: 'reconnecting', method: 'img', detail: 'camera not reachable' });
          reachable = false;
        } finally {
          clearTimeout(timeout);
          probe.abort(); // we only needed the headers; release the camera's connection
        }
      }, PROBE_INTERVAL_MS);
      connect();
      return () => {
        img?.removeEventListener('load', onLoad);
        img?.removeEventListener('error', onError);
      };
    };

    let cleanupImg: (() => void) | undefined;

    const runFetch = async () => {
      if (cancelled) return;
      controller?.abort();
      controller = new AbortController();
      const ctrl = controller;
      let gotFrame = false;
      let lastFrameAt = Date.now();
      report({ state: attempt === 0 ? 'connecting' : 'reconnecting', method: 'fetch' });
      const watchdog = setInterval(() => {
        if (Date.now() - lastFrameAt > STALL_TIMEOUT_MS) ctrl.abort();
      }, 1000);
      try {
        const res = await fetch(url, { mode: 'cors', cache: 'no-store', signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        const reader = res.body.getReader();
        const extractor = new MjpegFrameExtractor();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const frame of extractor.push(value)) {
            const objectUrl = URL.createObjectURL(new Blob([frame as BlobPart], { type: 'image/jpeg' }));
            const previous = lastObjectUrl;
            lastObjectUrl = objectUrl;
            // Straight to the element: a React render per frame is unnecessary work at 10-30 fps.
            if (imgRef.current) imgRef.current.src = objectUrl;
            if (previous) setTimeout(() => URL.revokeObjectURL(previous), 100);
            lastFrameAt = Date.now();
            if (!gotFrame) {
              gotFrame = true;
              attempt = 0;
              report({ state: 'live', method: 'fetch' });
            }
          }
        }
        clearInterval(watchdog);
        scheduleRetry(runFetch, 'stream ended', 'fetch');
      } catch (err) {
        clearInterval(watchdog);
        if (cancelled) return;
        const stalled = ctrl.signal.aborted;
        // A first-attempt TypeError is usually CORS (it is also what an unreachable host gives): try <img>.
        if (!stalled && !gotFrame && attempt === 0 && err instanceof TypeError) {
          corsBlocked.add(url);
          cleanupImg = runImgFallback();
          return;
        }
        scheduleRetry(runFetch, stalled ? `no frame for ${STALL_TIMEOUT_MS / 1000} s` : 'stream failed', 'fetch');
      }
    };

    if (corsBlocked.has(url)) cleanupImg = runImgFallback();
    else void runFetch();

    return () => {
      cancelled = true;
      controller?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      if (probeTimer) clearInterval(probeTimer);
      cleanupImg?.();
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
      if (imgRef.current && lastObjectUrl && imgRef.current.src === lastObjectUrl) imgRef.current.removeAttribute('src');
      setImgSrc('');
    };
  }, [type, url, reconnectKey]);

  // ---------------------------------------------------------------------------------------------------------
  // Snapshot: poll; report errors after a few failures in a row (polling itself is the retry).
  // ---------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (type !== 'snapshot' || !url) return;
    let n = 0;
    let failures = 0;
    const img = imgRef.current;
    const onLoad = () => {
      failures = 0;
      statusRef.current({ state: 'live', method: 'snapshot' });
    };
    const onError = () => {
      failures++;
      statusRef.current(
        failures >= 3
          ? { state: 'error', method: 'snapshot', detail: `${failures} snapshots failed` }
          : { state: 'reconnecting', method: 'snapshot' }
      );
    };
    img?.addEventListener('load', onLoad);
    img?.addEventListener('error', onError);
    statusRef.current({ state: 'connecting', method: 'snapshot' });
    const tick = () => setImgSrc(withCacheBuster(url, ++n));
    tick();
    const timer = setInterval(tick, Math.max(snapshotIntervalMs, 50));
    return () => {
      clearInterval(timer);
      img?.removeEventListener('load', onLoad);
      img?.removeEventListener('error', onError);
      setImgSrc('');
    };
  }, [type, url, snapshotIntervalMs, reconnectKey]);

  // ---------------------------------------------------------------------------------------------------------
  // <video>: reload on error, end, or when playback stops advancing.
  // ---------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (type !== 'video' || !url) return;
    const video = videoRef.current;
    if (!video) return;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTime = -1;
    let lastProgressAt = Date.now();
    const load = () => {
      lastProgressAt = Date.now();
      video.src = url;
      video.load();
      void video.play().catch(() => {});
    };
    const retry = (reason: string) => {
      if (retryTimer) return;
      const delay = reconnectDelayMs(attempt++);
      statusRef.current({ state: 'reconnecting', method: 'video', detail: `${reason}; retrying in ${Math.round(delay / 1000)} s` });
      retryTimer = setTimeout(() => {
        retryTimer = null;
        load();
      }, delay);
    };
    const onPlaying = () => {
      attempt = 0;
      statusRef.current({ state: 'live', method: 'video' });
    };
    const onError = () => retry('video error');
    const onEnded = () => retry('stream ended');
    const watchdog = setInterval(() => {
      if (video.paused && video.readyState >= 2) return;
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > VIDEO_STALL_MS) {
        retry('playback stalled');
      }
    }, 1000);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('ended', onEnded);
    statusRef.current({ state: 'connecting', method: 'video' });
    load();
    return () => {
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('ended', onEnded);
      video.removeAttribute('src');
      video.load();
    };
  }, [type, url, reconnectKey]);

  // ---------------------------------------------------------------------------------------------------------
  // WHEP (WebRTC): connect, play the stream; reconnect when the connection fails, stays disconnected, or playback
  // stops advancing. The session is ended on the server (DELETE) when leaving or reconnecting.
  // ---------------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (type !== 'whep' || !url) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let attempt = 0;
    let session: WhepSession | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTime = -1;
    let lastProgressAt = Date.now();
    let live = false;
    const report = (s: CameraStatus) => !cancelled && statusRef.current(s);

    const retry = (reason: string) => {
      if (cancelled || retryTimer) return;
      live = false;
      const delay = reconnectDelayMs(attempt++);
      report({ state: 'reconnecting', method: 'whep', detail: `${reason}; retrying in ${Math.round(delay / 1000)} s` });
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, delay);
    };
    const connect = async () => {
      if (cancelled) return;
      const old = session;
      session = new WhepSession(url, { fetch: window.fetch.bind(window), createPeerConnection: (c) => new RTCPeerConnection(c) }, { token: token || undefined });
      void old?.stop();
      const mine = session;
      report({ state: attempt === 0 ? 'connecting' : 'reconnecting', method: 'whep' });
      try {
        const stream = await mine.start((state) => {
          if (cancelled || mine !== session) return;
          // Closed by the far end (the server ended the session: its source stopped), or failed: connect again.
          if (state === 'failed' || state === 'closed') retry(state === 'closed' ? 'session ended' : 'connection failed');
          else if (state === 'disconnected') {
            disconnectTimer ??= setTimeout(() => {
              disconnectTimer = null;
              if (mine === session && mine.pc?.connectionState !== 'connected') retry('connection lost');
            }, WHEP_DISCONNECT_GRACE_MS);
          } else if (state === 'connected' && disconnectTimer) {
            clearTimeout(disconnectTimer);
            disconnectTimer = null;
          }
        });
        if (cancelled || mine !== session) return;
        lastProgressAt = Date.now();
        // The server ending the track (its source gone) ends the stream: connect again.
        for (const track of stream.getTracks()) track.addEventListener('ended', () => mine === session && retry('stream ended'));
        video.srcObject = stream;
        void video.play().catch(() => {});
      } catch (e) {
        if (cancelled || mine !== session) return;
        retry(e instanceof Error ? e.message : 'connection failed');
      }
    };
    const onPlaying = () => {
      attempt = 0;
      live = true;
      report({ state: 'live', method: 'whep' });
    };
    // Frames stopped arriving (the camera or the server stalled, the network dropped without ICE noticing yet). Counted
    // from the connection's statistics: a <video> playing a MediaStream keeps its clock running with no frames.
    const watchdog = setInterval(async () => {
      if (!live || !session) return;
      const frames = await session.framesReceived();
      if (cancelled || frames === null) return;
      if (frames !== lastTime) {
        lastTime = frames;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > VIDEO_STALL_MS) {
        retry('no frames');
      }
    }, 1000);
    video.addEventListener('playing', onPlaying);
    // Leaving the page doesn't unmount this: end the server's session then too, rather than leave it to time out.
    const onPageHide = () => void session?.stop();
    window.addEventListener('pagehide', onPageHide);
    void connect();
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      cancelled = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      if (disconnectTimer) clearTimeout(disconnectTimer);
      video.removeEventListener('playing', onPlaying);
      void session?.stop();
      video.srcObject = null;
    };
  }, [type, url, token, reconnectKey]);

  return type === 'video' || type === 'whep' ? (
    <video ref={videoRef} autoPlay playsInline muted className={className} style={{ opacity }} />
  ) : (
    // eslint-disable-next-line jsx-a11y/alt-text
    <img ref={imgRef} src={imgSrc || undefined} alt="HUD Video Feed" className={className} style={{ opacity }} />
  );
};
