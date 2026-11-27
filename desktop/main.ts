// Glareshield desktop (Electron): the web app in a window, plus what a browser can't do (src/desktop/api.ts).
//
// - The built app (dist/) is served from app://glareshield/, a standard, secure scheme, so the service worker (offline
//   map tiles) and the rest of the app behave as on the web. The web deploy's Content-Security-Policy (dist/_headers)
//   is applied to it here too.
// - UDP (listen, reply to whoever last sent, as Mission Planner does) and TCP client links, for the page over IPC.
// - USB serial is the page's own Web Serial; Electron has no device picker, so the page is asked to show one.
// - Updates from GitHub Releases (AppImage, NSIS installer), when packaged.

import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { app, BrowserWindow, net as electronNet, ipcMain, protocol, session, shell } from 'electron';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

const SCHEME = 'app';
const HOST = 'glareshield';
const ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(__dirname, '..', '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      allowServiceWorkers: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

/** The headers dist/_headers gives every path (/*): the CSP and the rest of the web deploy's. */
function siteHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const lines = fs.readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n');
    for (let i = lines.indexOf('/*') + 1; i > 0 && i < lines.length && lines[i].startsWith('  '); i++) {
      const at = lines[i].indexOf(':');
      if (at > 0) out[lines[i].slice(0, at).trim()] = lines[i].slice(at + 1).trim();
    }
  } catch {
    /* no headers file: serve without */
  }
  return out;
}

function serveApp() {
  const headers = siteHeaders();
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.normalize(path.join(DIST, rel));
    // Nothing outside dist/; an unknown path is the app (as the web host's SPA fallback).
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      rel = 'index.html';
      file = path.join(DIST, rel);
    }
    const res = await electronNet.fetch(`file://${file}`);
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    if (rel.endsWith('.webmanifest')) h.set('Content-Type', 'application/manifest+json');
    return new Response(res.body, { status: res.status, headers: h });
  });
}

// ---- Links -------------------------------------------------------------------------------------------------------

interface Link {
  send(data: Uint8Array): void;
  close(): void;
}
const links = new Map<string, Link>();
let nextLinkId = 1;

function openLink(win: BrowserWindow, config: any): Promise<string> {
  const id = `link-${nextLinkId++}`;
  const emitData = (data: Uint8Array) => {
    if (!win.isDestroyed()) win.webContents.send('link:data', id, data);
  };
  const emitClosed = (reason: string) => {
    if (!links.has(id)) return;
    links.delete(id);
    if (!win.isDestroyed()) win.webContents.send('link:closed', id, reason);
  };

  if (config?.kind === 'udp') {
    const port = Number(config.port);
    if (!(port > 0 && port < 65536)) return Promise.reject(new Error(`Not a UDP port: ${config.port}`));
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      // Whoever last sent to us (the vehicle, or a radio's bridge) is where our packets go.
      let peer: { address: string; port: number } | null = null;
      sock.on('message', (msg, rinfo) => {
        peer = { address: rinfo.address, port: rinfo.port };
        emitData(new Uint8Array(msg));
      });
      sock.once('error', (e) => reject(new Error(`UDP port ${port}: ${e.message}`)));
      sock.bind(port, '0.0.0.0', () => {
        sock.removeAllListeners('error');
        sock.on('error', (e) => {
          emitClosed(`UDP error: ${e.message}`);
          sock.close();
        });
        links.set(id, {
          send: (data) => {
            if (peer) sock.send(data, peer.port, peer.address);
          },
          close: () => sock.close(),
        });
        resolve(id);
      });
    });
  }

  if (config?.kind === 'tcp') {
    const port = Number(config.port);
    const host = String(config.host || '');
    if (!host || !(port > 0 && port < 65536)) return Promise.reject(new Error(`Not a TCP address: ${host}:${port}`));
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port });
      sock.setNoDelay(true);
      sock.setTimeout(10_000);
      let open = false;
      sock.once('connect', () => {
        open = true;
        sock.setTimeout(0);
        links.set(id, {
          send: (data) => {
            if (!sock.destroyed) sock.write(data);
          },
          close: () => sock.destroy(),
        });
        resolve(id);
      });
      sock.once('timeout', () => sock.destroy(new Error('no answer in 10 s')));
      sock.on('data', (d: Buffer) => emitData(new Uint8Array(d)));
      sock.on('error', (e) => {
        if (!open) reject(new Error(`TCP ${host}:${port}: ${e.message}`));
        else emitClosed(`TCP error: ${e.message}`);
      });
      sock.on('close', () => emitClosed('The vehicle closed the TCP connection'));
    });
  }

  return Promise.reject(new Error('Unknown link kind'));
}

function setupLinks(win: BrowserWindow) {
  ipcMain.handle('link:open', (e, config) => {
    if (e.sender !== win.webContents) throw new Error('Not this window');
    return openLink(win, config);
  });
  ipcMain.on('link:send', (_e, id: string, data: Uint8Array) => links.get(id)?.send(data));
  ipcMain.handle('link:close', (_e, id: string) => {
    const l = links.get(id);
    links.delete(id);
    l?.close();
  });
}

// ---- Serial (the page's Web Serial; the picker is the page's) ----------------------------------------------------

function setupSerial(win: BrowserWindow) {
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission, origin) => permission === 'serial' && origin.startsWith(ORIGIN));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial' && details.origin.startsWith(ORIGIN));
  ses.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    const ports = portList.map((p) => ({
      portId: p.portId,
      label: [p.displayName || p.portName, p.portName && p.displayName ? `(${p.portName})` : '']
        .filter(Boolean)
        .join(' '),
    }));
    ipcMain.once('serial:choose', (_e, portId: string | null) => callback(portId ?? ''));
    win.webContents.send('serial:choose-port', ports);
  });
}

// ---- Updates -----------------------------------------------------------------------------------------------------

function setupUpdates(win: BrowserWindow) {
  const send = (state: unknown) => {
    if (!win.isDestroyed()) win.webContents.send('update:state', state);
  };
  let updater: AppUpdater | null = null;
  // Only a packaged build updates itself (and only the AppImage and the installer: electron-updater's targets).
  if (app.isPackaged) {
    // Loaded lazily: it reads the packaged app's update config.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updater = (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
    updater.autoDownload = true;
    updater.on('checking-for-update', () => send({ kind: 'checking' }));
    updater.on('update-available', (i: UpdateInfo) => send({ kind: 'available', version: i.version }));
    updater.on('update-not-available', () => send({ kind: 'none' }));
    updater.on('download-progress', (p: ProgressInfo) => send({ kind: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (i: UpdateInfo) => send({ kind: 'ready', version: i.version }));
    updater.on('error', (e: Error) => send({ kind: 'error', message: e?.message ?? String(e) }));
    setTimeout(() => updater?.checkForUpdates().catch(() => {}), 5000);
  }
  ipcMain.on('update:check', () => {
    if (updater) updater.checkForUpdates().catch(() => {});
    else send({ kind: 'none' });
  });
  // Restarting mid-flight is the person's choice: the page asks first.
  ipcMain.on('update:install', () => updater?.quitAndInstall());
}

// ---- Window ------------------------------------------------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#09090b',
    title: 'Glareshield',
    icon: path.join(DIST, 'logo-512.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--glareshield-version=${app.getVersion()}`],
    },
  });
  // Links out (docs, GitHub) open in the browser; the window stays on the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  setupLinks(win);
  setupSerial(win);
  setupUpdates(win);
  void win.loadURL(`${ORIGIN}/`);
  win.on('closed', () => {
    for (const l of links.values()) l.close();
    links.clear();
  });
  return win;
}

// One window: a second launch focuses the first (two would fight over the UDP port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let main: BrowserWindow | null = null;
  app.on('second-instance', () => {
    if (main) {
      if (main.isMinimized()) main.restore();
      main.focus();
    }
  });
  void app.whenReady().then(() => {
    serveApp();
    // The camera, microphone and the like stay off, as on the web (Permissions-Policy); geolocation and serial ask.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
      cb(['geolocation', 'serial', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
    );
    main = createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
