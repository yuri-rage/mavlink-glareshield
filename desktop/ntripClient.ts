// NTRIP from the desktop app: the main process reaches the caster itself, over TCP, as the bridge does (bridge.py
// start_ntrip_stream), so RTK corrections need no bridge. The page gets the RTCM stream over IPC (desktop/main.ts) and
// sends the vehicle's position back (GGA) for casters that want it (VRS).
//
// The request is NTRIP v1 style (HTTP/1.0, so no chunked body); the caster answers "ICY 200 OK" or an HTTP 200 and
// then streams RTCM. A header that never ends or never comes, or a refusal (401, a mountpoint it doesn't have), ends
// the attempt with the caster's own words.

import net from 'node:net';

export interface NtripRequest {
  host: string;
  port: number;
  mountpoint: string;
  username?: string;
  password?: string;
}

/** A caster's response header, and how long to wait for the connection and that header (as bridge.py). */
export const NTRIP_MAX_HEADER = 8192;
export const NTRIP_TIMEOUT_MS = 10_000;

/** One NMEA GGA sentence, printable ASCII (as bridge.py's NMEA_GGA_RE): nothing else goes to the caster. */
const GGA_RE = /^\$G[A-Z]{4},[ -~]{1,120}$/;

/** The request, checked: a host name or address, a port, and a mountpoint of the usual characters. */
export function checkNtripRequest(r: Partial<NtripRequest> | null | undefined): NtripRequest | string {
  const host = String(r?.host ?? '').trim();
  const port = Number(r?.port ?? 2101);
  const mountpoint = String(r?.mountpoint ?? '')
    .trim()
    .replace(/^\//, '');
  if (!host || !mountpoint) return 'Missing host or mountpoint';
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return `Not a caster host name: ${host}`;
  if (!(Number.isInteger(port) && port > 0 && port < 65536)) return `Not a port: ${r?.port}`;
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(mountpoint)) return `Not a mountpoint name: ${mountpoint}`;
  return {
    host,
    port,
    mountpoint,
    username: String(r?.username ?? '').trim(),
    password: String(r?.password ?? '').trim(),
  };
}

export function requestText(r: NtripRequest): string {
  const auth =
    r.username || r.password
      ? `Authorization: Basic ${Buffer.from(`${r.username ?? ''}:${r.password ?? ''}`).toString('base64')}\r\n`
      : '';
  return (
    `GET /${r.mountpoint} HTTP/1.0\r\nHost: ${r.host}:${r.port}\r\n` +
    `User-Agent: NTRIP MavlinkGlareshield/1.0\r\n${auth}\r\n`
  );
}

export type HeaderResult =
  { kind: 'incomplete' } | { kind: 'ok'; body: Buffer } | { kind: 'rejected'; header: string } | { kind: 'too-long' };

/**
 * The caster's answer so far: still coming, accepted (with any RTCM after it), refused, or too long to be a header.
 * "ICY 200 OK" (NTRIP v1) may end at its own line; an HTTP answer ends at the blank line.
 */
export function parseCasterHeader(buf: Buffer): HeaderResult {
  const blank = buf.indexOf('\r\n\r\n');
  const icy = buf.indexOf('ICY 200 OK\r\n');
  let end = -1;
  if (blank !== -1) end = blank + 4;
  else if (icy !== -1) end = icy + 12;
  if (end === -1) return buf.length > NTRIP_MAX_HEADER ? { kind: 'too-long' } : { kind: 'incomplete' };
  const header = buf.subarray(0, end).toString('latin1');
  const status = header.split('\r\n')[0];
  if (!/^(ICY|HTTP\/1\.[01]) 200\b/.test(status)) return { kind: 'rejected', header: header.trim() };
  return { kind: 'ok', body: buf.subarray(end) };
}

/**
 * Why the caster said no, in a line: its status line, with what it usually means. A caster without the mountpoint
 * answers with its whole list of mountpoints (the sourcetable), which isn't repeated.
 */
export function refusal(header: string, mountpoint: string): string {
  const status = header.split('\r\n')[0].trim();
  if (/^SOURCETABLE 200/.test(status))
    return `Caster rejected: no mountpoint "${mountpoint}" (it answered with its list of mountpoints)`;
  if (/^HTTP\/1\.[01] 401\b/.test(status)) return `Caster rejected: ${status} (check the username and password)`;
  return `Caster rejected: ${status}`;
}

export interface NtripSession {
  /** The vehicle's position for the caster: one GGA sentence (anything else is dropped). */
  sendGga(sentence: string): void;
  /** Resolves once the socket is gone. */
  close(): Promise<void>;
}

export interface NtripHandlers {
  onData(data: Uint8Array): void;
  /** The stream ended on its own (the caster closed it, a network error): why. Not called after close(). */
  onClosed(reason: string): void;
}

/** Connect and log in; resolves once the caster accepts (its RTCM then flows to onData), rejects with why not. */
export function connectNtrip(
  r: NtripRequest,
  handlers: NtripHandlers,
  timeoutMs = NTRIP_TIMEOUT_MS
): Promise<NtripSession> {
  return new Promise<NtripSession>((resolve, reject) => {
    const sock = net.createConnection({ host: r.host, port: r.port });
    sock.setNoDelay(true);
    let accepted = false;
    let closedByUs = false;
    let head = Buffer.alloc(0);
    const closed = new Promise<void>((res) => sock.once('close', () => res()));
    // Both the connection and the header must come in time.
    const timer = setTimeout(() => {
      sock.destroy(new Error(`No answer from ${r.host}:${r.port} in ${Math.ceil(timeoutMs / 1000)} s`));
    }, timeoutMs);

    const session: NtripSession = {
      sendGga(sentence) {
        const s = String(sentence).trim();
        if (accepted && !sock.destroyed && GGA_RE.test(s)) sock.write(`${s}\r\n`, 'ascii');
      },
      close() {
        closedByUs = true;
        clearTimeout(timer);
        sock.destroy();
        return closed;
      },
    };

    sock.once('connect', () => sock.write(requestText(r), 'latin1'));
    sock.on('data', (chunk: Buffer) => {
      if (accepted) {
        handlers.onData(new Uint8Array(chunk));
        return;
      }
      head = Buffer.concat([head, chunk]);
      const h = parseCasterHeader(head);
      if (h.kind === 'incomplete') return;
      clearTimeout(timer);
      if (h.kind === 'too-long') {
        sock.destroy(new Error(`Caster response header over ${NTRIP_MAX_HEADER} bytes`));
      } else if (h.kind === 'rejected') {
        sock.destroy(new Error(refusal(h.header, r.mountpoint)));
      } else {
        accepted = true;
        head = Buffer.alloc(0);
        resolve(session);
        if (h.body.length) handlers.onData(new Uint8Array(h.body));
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      if (!accepted)
        reject(
          new Error(
            e.message.startsWith('No answer') || e.message.startsWith('Caster')
              ? e.message
              : `Caster ${r.host}:${r.port}: ${e.message}`
          )
        );
      else if (!closedByUs) handlers.onClosed(`Caster connection lost: ${e.message}`);
    });
    sock.on('close', (hadError) => {
      clearTimeout(timer);
      if (!accepted && !hadError) reject(new Error('Caster closed the connection before answering'));
      else if (accepted && !hadError && !closedByUs) handlers.onClosed('The caster closed the stream');
    });
  });
}
