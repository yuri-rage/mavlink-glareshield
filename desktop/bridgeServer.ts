// The desktop app as a bridge (Settings → Link → Bridge for other devices): phones and tablets connect to it over
// wss://, as to bridge/bridge.py, and share this computer's link to the vehicle. Off unless turned on.
//
// As the Python bridge: a self-signed certificate (desktop/bridgeCert.ts) each device accepts once through the pairing
// QR's /pair page, which checks the pairing token and sends the device on to the hosted app with the link; the token
// on every WebSocket (closed with 4001 / 4003 without it, which the app explains); the same Origin rules; MAVLink
// relayed both ways (every client hears the vehicle, the vehicle hears every client); and NTRIP for a client over the
// text channel (ntrip_connect / ntrip_gga / ntrip_disconnect), to caster ports 2101-2105 only, as the Python bridge.

import crypto from 'node:crypto';
import https from 'node:https';

import { WebSocketServer, type WebSocket } from 'ws';

import { NtripStreams } from './ntripStreams';

/** Where a pairing link sends a device: the hosted app (src/lib/pairing.ts WEB_APP_URL). */
export const WEB_APP_URL = 'https://glareshield.yurirage.com/';
export const DEFAULT_BRIDGE_PORT = 56781;
/** WebSocket close codes the app reads (src/lib/pairing.ts, bridge.py CLOSE_TOKEN_*). */
export const CLOSE_TOKEN_MISSING = 4001;
export const CLOSE_TOKEN_WRONG = 4003;
/** A client this far behind (bytes waiting) misses packets rather than holding memory (as bridge.py's queue). */
const MAX_BUFFERED = 4 * 1024 * 1024;

/** bridge.py DEFAULT_ALLOWED_ORIGINS; a missing Origin (a client that isn't a browser) too. */
const ALLOWED_ORIGINS = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/,
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/,
  /^https:\/\/glareshield\.yurirage\.com(:\d+)?$/,
  /^app:\/\/glareshield$/,
  /^tauri:\/\/.*$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
];

export function originAllowed(origin: string | undefined): boolean {
  return origin === undefined || ALLOWED_ORIGINS.some((p) => p.test(origin));
}

/** True: the token matches. False: wrong. Null: none given. */
export function tokenOk(url: string | undefined, token: string): boolean | null {
  let given: string | null = null;
  try {
    given = new URL(url ?? '/', 'https://x').searchParams.get('token');
  } catch {
    return false;
  }
  if (given === null) return null;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const newToken = () => crypto.randomBytes(16).toString('base64url');

/** The app, told in the hash (never sent to its server) which bridge to connect to (bridge.py app_link). */
export function appLink(host: string, token: string): string {
  return `${WEB_APP_URL}#link=${encodeURIComponent(`wss://${host}/?token=${encodeURIComponent(token)}`)}`;
}

/** A Host header fit to put in a link: host or [v6], and a port; nothing else. */
const plainHost = (h: string | undefined) =>
  h && /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:]+\](:\d{1,5})?$/.test(h) ? h : null;

export interface BridgeHooks {
  /** A client's MAVLink, for the vehicle. */
  toVehicle(data: Uint8Array): void;
  /** Clients came or went. */
  onClients(count: number): void;
  log?(line: string): void;
}

export class BridgeServer {
  private server: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  constructor(private hooks: BridgeHooks) {}

  get clientCount(): number {
    return this.clients.size;
  }

  get listening(): boolean {
    return this.server?.listening ?? false;
  }

  /** Listen on `port` with this certificate and token; rejects with why not (the port in use). */
  async start(port: number, token: string, tls: { key: string; cert: string }): Promise<void> {
    await this.stop();
    const log = this.hooks.log ?? (() => {});
    const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      // A browser tab opening the bridge (no WebSocket): /pair, or the certificate page.
      const url = new URL(req.url ?? '/', 'https://x');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (url.pathname === '/pair') {
        if (!tokenOk(req.url, token)) {
          log('[bridge] /pair with a wrong or missing token');
          res.writeHead(403).end('Wrong or missing pairing token. Scan the QR code in Glareshield again.\n');
          return;
        }
        const host = plainHost(req.headers.host) ?? `localhost:${port}`;
        res.writeHead(302, { Location: appLink(host, token) }).end('Paired. Opening Glareshield...\n');
        return;
      }
      res.writeHead(200).end('Glareshield bridge: this browser now trusts its certificate. You can close this tab.\n');
    });
    const wss = new WebSocketServer({
      server,
      maxPayload: 1024 * 1024,
      verifyClient: ({ origin }: { origin?: string }) => {
        if (originAllowed(origin)) return true;
        log(`[bridge] Refused a WebSocket from Origin ${origin}`);
        return false;
      },
    });
    wss.on('connection', (ws, req) => this.accept(ws, req.url, token));
    // The server's errors (the port in use) are re-emitted here: unheard, they'd end the app. start() reports them.
    wss.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) =>
        reject(
          new Error(
            e.code === 'EADDRINUSE'
              ? `Port ${port} is in use by another program (the Docker bridge, another Glareshield)`
              : `Port ${port}: ${e.message}`
          )
        )
      );
      server.listen(port, '0.0.0.0', () => resolve());
    }).catch((e) => {
      wss.close();
      server.close();
      throw e;
    });
    this.server = server;
    this.wss = wss;
  }

  async stop(): Promise<void> {
    for (const c of this.clients) c.terminate();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    this.wss?.close();
    this.wss = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
    this.hooks.onClients(0);
  }

  /** The vehicle's MAVLink, to every client. */
  broadcast(data: Uint8Array): void {
    for (const c of this.clients) if (c.readyState === c.OPEN && c.bufferedAmount < MAX_BUFFERED) c.send(data);
  }

  private accept(ws: WebSocket, url: string | undefined, token: string) {
    // The token before anything else: nothing is sent to or relayed from a client without it.
    const ok = tokenOk(url, token);
    if (!ok) {
      this.hooks.log?.(`[bridge] Closed a WebSocket: ${ok === null ? 'no' : 'wrong'} pairing token`);
      ws.close(
        ok === null ? CLOSE_TOKEN_MISSING : CLOSE_TOKEN_WRONG,
        ok === null ? 'pairing token required' : 'wrong pairing token'
      );
      return;
    }
    this.clients.add(ws);
    this.hooks.onClients(this.clients.size);
    const json = (m: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
    // This client's NTRIP through the bridge (one stream at a time, as bridge.py).
    const ntrip = new NtripStreams((channel, _id, value) => {
      if (channel === 'ntrip:data')
        json({ type: 'ntrip_data', data: Buffer.from(value as Uint8Array).toString('base64') });
      else json({ type: 'ntrip_status', status: 'disconnected' });
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        this.hooks.toVehicle(new Uint8Array(buf));
      } else {
        void this.textCommand(String(data), ntrip, json);
      }
    });
    ws.on('close', () => {
      this.clients.delete(ws);
      void ntrip.closeAll();
      this.hooks.onClients(this.clients.size);
    });
    ws.on('error', () => {});
  }

  /** A JSON command from a client's page (bridge.py handle_text_command); anything malformed is ignored. */
  private async textCommand(text: string, ntrip: NtripStreams, json: (m: object) => void) {
    let cmd: any;
    try {
      cmd = JSON.parse(text);
    } catch {
      return;
    }
    if (!cmd || typeof cmd !== 'object') return;
    if (cmd.type === 'ntrip_connect') {
      const wasActive = ntrip.size > 0;
      await ntrip.closeAll();
      if (wasActive) json({ type: 'ntrip_status', status: 'disconnected' });
      const port = Number(cmd.port ?? 2101);
      // As bridge.py: a paired device may reach casters, not any port of any host through this computer.
      if (![2101, 2102, 2103, 2104, 2105].includes(port)) {
        json({ type: 'ntrip_error', message: 'Invalid NTRIP host, port or mountpoint' });
        return;
      }
      try {
        await ntrip.open('n', { ...cmd, port });
        json({ type: 'ntrip_status', status: 'streaming' });
      } catch (e: any) {
        json({ type: 'ntrip_error', message: String(e?.message ?? e) });
      }
    } else if (cmd.type === 'ntrip_disconnect') {
      const wasActive = ntrip.size > 0;
      await ntrip.closeAll();
      if (wasActive) json({ type: 'ntrip_status', status: 'disconnected' });
    } else if (cmd.type === 'ntrip_gga') {
      ntrip.sendGga('n', cmd.gga);
    }
  }
}
