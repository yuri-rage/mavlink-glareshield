// Glareshield desktop (Electron): the web app in a window, plus what a browser can't do (src/desktop/api.ts).
//
// - The built app (dist/) is served from app://glareshield/, a standard, secure scheme, so the service worker (offline
//   map tiles) and the rest of the app behave as on the web. The web deploy's Content-Security-Policy (dist/_headers)
//   is applied to it here too.
// - UDP (listen; reply to the vehicles heard on it, as Mission Planner does), TCP client and serial (by path) links,
//   for the page over IPC.
// - The page's own Web Serial is left only to the RTK widget's base station (with the page's own port list).
// - Updates from GitHub Releases (AppImage, NSIS installer), when packaged.

import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, net as electronNet, ipcMain, protocol, session, shell } from 'electron';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

import { hasVehicleHeartbeat, UDP_VEHICLE_TIMEOUT_MS } from './udpVehicles';

const SCHEME = 'app';
const HOST = 'glareshield';
const ORIGIN = `${SCHEME}://${HOST}`;
const DIST = path.join(__dirname, '..', '..', 'dist');

/** Whether a URL is this app's page (exactly app://glareshield; not a lookalike such as app://glareshield.evil). */
function isAppUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === `${SCHEME}:` && url.host === HOST;
  } catch {
    return false;
  }
}

/** Permissions the page may use (as on the web, Permissions-Policy: camera and microphone stay off). */
const ALLOWED_PERMISSIONS = new Set(['geolocation', 'serial', 'clipboard-sanitized-write', 'fullscreen']);

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
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    let file = path.resolve(DIST, rel);
    // Nothing outside dist/ (not even a sibling such as dist-extra/); an unknown path is the app (as the web host's
    // SPA fallback).
    const inside = path.relative(DIST, file);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      rel = 'index.html';
      file = path.join(DIST, rel);
    }
    // A proper file URL (Windows drive letters and backslashes, # or % in a path).
    const res = await electronNet.fetch(pathToFileURL(file).href);
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
      // Not shared (no reuseAddr): another program on the port (Mission Planner) is a clear "in use", rather than the
      // two splitting the traffic.
      const sock = dgram.createSocket({ type: 'udp4' });
      // Where our packets go: every endpoint a vehicle's heartbeat came from lately (several vehicles on one port);
      // until one is heard, whoever last sent. Another program's packets on the port don't redirect them.
      const vehicles = new Map<string, { address: string; port: number; at: number }>();
      let lastSender: { address: string; port: number } | null = null;
      sock.on('message', (msg, rinfo) => {
        const ep = { address: rinfo.address, port: rinfo.port };
        if (hasVehicleHeartbeat(msg)) vehicles.set(`${ep.address}:${ep.port}`, { ...ep, at: Date.now() });
        lastSender = ep;
        emitData(new Uint8Array(msg));
      });
      const targets = () => {
        const now = Date.now();
        const live = [...vehicles.values()].filter((v) => now - v.at < UDP_VEHICLE_TIMEOUT_MS);
        return live.length ? live : lastSender ? [lastSender] : [];
      };
      sock.once('error', (e: NodeJS.ErrnoException) =>
        reject(
          new Error(
            e.code === 'EADDRINUSE'
              ? `UDP port ${port} is in use by another program (Mission Planner, MAVProxy, another Glareshield).`
              : `UDP port ${port}: ${e.message}`
          )
        )
      );
      sock.bind(port, '0.0.0.0', () => {
        sock.removeAllListeners('error');
        sock.on('error', (e) => {
          emitClosed(`UDP error: ${e.message}`);
          sock.close();
        });
        links.set(id, {
          send: (data) => {
            // A failed send (network unreachable for a moment) is dropped, not the end of the link.
            for (const t of targets()) sock.send(data, t.port, t.address, () => {});
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

  if (config?.kind === 'serial') {
    const portPath = String(config.path || '');
    const baudRate = Number(config.baudRate) || 57600;
    if (!portPath) return Promise.reject(new Error('No serial port chosen'));
    return openSerial(portPath, baudRate).then(({ port }) => {
      let open = true;
      // One write at a time, in order (the binding's writes are promises).
      let writing: Promise<unknown> = Promise.resolve();
      const fail = (e: unknown) => {
        if (!open) return;
        open = false;
        void port.close().catch(() => {});
        emitClosed(`Serial ${portPath}: ${e instanceof Error ? e.message : String(e)}`);
      };
      void (async () => {
        const buf = Buffer.alloc(4096);
        while (open) {
          try {
            const { bytesRead } = await port.read(buf, 0, buf.length);
            if (bytesRead > 0) emitData(new Uint8Array(buf.subarray(0, bytesRead)));
          } catch (e) {
            // Closed by us (canceled read), or the device went away (unplugged).
            if (open) fail(e);
            return;
          }
        }
      })();
      links.set(id, {
        send: (data) => {
          if (open) writing = writing.then(() => port.write(Buffer.from(data))).catch(fail);
        },
        close: () => {
          open = false;
          void port.close().catch(() => {});
        },
      });
      return id;
    });
  }

  return Promise.reject(new Error('Unknown link kind'));
}

/** Close every link (the page reloaded, crashed or closed: none of its links are wanted any more). */
function closeAllLinks() {
  for (const l of links.values()) l.close();
  links.clear();
}

function setupLinks(win: BrowserWindow) {
  const fromWin = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => e.sender === win.webContents;
  ipcMain.handle('link:open', (e, config) => {
    if (!fromWin(e)) throw new Error('Not this window');
    return openLink(win, config);
  });
  ipcMain.on('link:send', (e, id: unknown, data: unknown) => {
    if (!fromWin(e) || typeof id !== 'string' || !(data instanceof Uint8Array)) return;
    links.get(id)?.send(data);
  });
  ipcMain.handle('link:close', (e, id: unknown) => {
    if (!fromWin(e) || typeof id !== 'string') return;
    const l = links.get(id);
    links.delete(id);
    l?.close();
  });
}

// ---- Serial (opened here by path, as UDP and TCP; the page's Web Serial only for the RTK widget) -----------------
//
// The link's serial port is opened in this process with @serialport/bindings-cpp (prebuilt for Linux and Windows),
// by its path (/dev/ttyACM0, COM5): after a replug or a restart it is found again by name, as in other ground
// stations. Settings › Link lists the ports in a dropdown. The page's own Web Serial (navigator.serial) is still used
// by the RTK widget's base station; Electron has no picker for it, so the page shows the list.

interface SerialListing {
  /** The port's path: /dev/ttyACM0, COM5. */
  path: string;
  label: string;
}

type Bindings = typeof import('@serialport/bindings-cpp');
let bindingsModule: Bindings | null = null;
function bindings(): Bindings {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    bindingsModule ??= require('@serialport/bindings-cpp') as Bindings;
  } catch (e) {
    // The native module itself didn't load (a missing system library): not a port problem.
    throw new Error(`Serial ports are unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return bindingsModule;
}

async function listSerialPorts(): Promise<SerialListing[]> {
  const ports = await bindings().autoDetect().list();
  const rank = (p: string) => (/ttyS\d/.test(p) ? 1 : 0); // built-in UARTs after USB devices
  return ports
    .map((p) => {
      const name = process.platform === 'win32' ? p.path : path.basename(p.path);
      // Linux: the /dev/serial/by-id name (usb-ArduPilot_Pixhawk6X_..._if00); elsewhere the manufacturer.
      const byId = p.pnpId
        ?.replace(/^usb-/, '')
        .replace(/-if\d+(-port\d+)?$/, '')
        .replace(/_/g, ' ');
      const what = process.platform === 'linux' ? byId : p.manufacturer;
      return { path: p.path, label: what ? `${name}: ${what}` : name };
    })
    .sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path, undefined, { numeric: true }));
}

/** Open a serial port; a refusal says what usually causes it. */
async function openSerial(portPath: string, baudRate: number) {
  const b = bindings();
  try {
    const port = await b.autoDetect().open({ path: portPath, baudRate });
    return { port };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission denied|EACCES/i.test(msg) && process.platform === 'linux') {
      throw new Error(
        `${portPath}: permission denied. Add your user to the dialout (or uucp) group, then log in again.`
      );
    }
    if (/access denied|busy|EBUSY|resource busy/i.test(msg)) {
      throw new Error(
        `${portPath} is in use by another program (Mission Planner, another app). Close it and connect again.`
      );
    }
    if (/no such file|ENOENT|file not found|cannot find the file/i.test(msg)) {
      throw new Error(`${portPath} isn't there: plug the radio or flight controller in, or refresh the port list.`);
    }
    throw new Error(`${portPath}: ${msg}`);
  }
}

/** The page's answer to the open Web Serial prompt (the RTK widget's), if one is waiting. */
let pendingSerialChoice: ((portId: string) => void) | null = null;

/** No answer is coming (a newer prompt, the page reloaded or crashed): the request gets "no port". */
function cancelSerialChoice() {
  pendingSerialChoice?.('');
  pendingSerialChoice = null;
}

function setupSerial(win: BrowserWindow) {
  ipcMain.handle('serial:list', (e) => {
    if (e.sender !== win.webContents) throw new Error('Not this window');
    return listSerialPorts();
  });
  // The RTK widget's Web Serial, with the page's own list as the picker.
  ipcMain.on('serial:choose', (e, portId: unknown) => {
    if (e.sender !== win.webContents) return;
    const answer = pendingSerialChoice;
    pendingSerialChoice = null;
    answer?.(typeof portId === 'string' ? portId : '');
  });
  win.webContents.session.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    cancelSerialChoice();
    pendingSerialChoice = callback;
    const ports = portList.map((p) => ({
      portId: p.portId,
      label: [p.displayName || p.portName, p.portName && p.displayName ? `(${p.portName})` : '']
        .filter(Boolean)
        .join(' '),
    }));
    win.webContents.send('serial:choose-port', ports);
  });
}

// ---- Updates -----------------------------------------------------------------------------------------------------

function setupUpdates(win: BrowserWindow) {
  // The latest state, kept for a page that loads (or reloads) after it was sent: a downloaded update stays offered.
  let last: unknown = { kind: app.isPackaged ? 'idle' : 'unavailable' };
  const send = (state: unknown) => {
    last = state;
    if (!win.isDestroyed()) win.webContents.send('update:state', state);
  };
  ipcMain.handle('update:get', (e) => (e.sender === win.webContents ? last : null));
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
  ipcMain.on('update:check', (e) => {
    if (e.sender !== win.webContents) return;
    // Already downloaded: nothing to check.
    if ((last as { kind?: string }).kind === 'ready') return send(last);
    if (updater) updater.checkForUpdates().catch(() => {});
    else send({ kind: 'unavailable' });
  });
  // Restarting mid-flight is the person's choice: the page offers it only while disarmed.
  ipcMain.on('update:install', (e) => {
    if (e.sender === win.webContents) updater?.quitAndInstall();
  });
}

// ---- Linux: the AppImage's launcher entry and icon -----------------------------------------------------------------

/**
 * A bare AppImage installs nothing, and on Wayland a window's icon comes only from an installed .desktop entry
 * matching the app's ID (glareshield): without one the window and taskbar show a generic icon, and no launcher lists
 * the app. So the AppImage installs its own entry and icon in the user's data folder, pointing at wherever the
 * AppImage is now; rewritten only when that changes (it was moved, or a new version brought a new icon).
 */
function integrateAppImage() {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== 'linux' || !appImage) return;
  try {
    const home = process.env.HOME ?? '';
    const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    const iconDir = path.join(data, 'icons', 'hicolor', '512x512', 'apps');
    const iconFile = path.join(iconDir, 'glareshield.png');
    const icon = fs.readFileSync(path.join(DIST, 'logo-512.png'));
    if (!fs.existsSync(iconFile) || !fs.readFileSync(iconFile).equals(icon)) {
      fs.mkdirSync(iconDir, { recursive: true });
      fs.writeFileSync(iconFile, icon);
    }
    // A path needing Exec's two layers of escaping (quotes, backticks, $, backslashes) or with a line break is left
    // alone: rare, and a wrong entry is worse than none. % is doubled (a field code otherwise).
    if (/["`$\\\r\n]/.test(appImage)) return;
    const quoted = `"${appImage.replace(/%/g, '%%')}"`;
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Glareshield',
      'Comment=ArduPilot ground control',
      `Exec=${quoted} %U`,
      `TryExec=${appImage}`,
      'Icon=glareshield',
      'StartupWMClass=glareshield',
      'Terminal=false',
      'Categories=Science;',
      '',
    ].join('\n');
    const appsDir = path.join(data, 'applications');
    const entryFile = path.join(appsDir, 'glareshield.desktop');
    if (!fs.existsSync(entryFile) || fs.readFileSync(entryFile, 'utf8') !== entry) {
      fs.mkdirSync(appsDir, { recursive: true });
      fs.writeFileSync(entryFile, entry);
    }
  } catch (e) {
    console.warn('[desktop] Could not install the launcher entry:', e);
  }
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
  // The window is "Glareshield", not the page's title (written for a browser tab).
  win.on('page-title-updated', (e) => e.preventDefault());
  // Links out (docs, GitHub) open in the browser; the window stays on the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  setupLinks(win);
  setupSerial(win);
  setupUpdates(win);
  // The page reloading (Restore defaults, Ctrl+R), crashing or closing: its links and any open prompt go with it
  // (the ports are freed, and no frames go to link IDs nobody holds).
  win.webContents.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
    if (details?.isMainFrame !== false && !details?.isSameDocument) {
      closeAllLinks();
      cancelSerialChoice();
    }
  });
  win.webContents.on('render-process-gone', () => {
    closeAllLinks();
    cancelSerialChoice();
  });
  void win.loadURL(`${ORIGIN}/`);
  win.on('closed', () => {
    closeAllLinks();
    cancelSerialChoice();
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
  // Windows ties the running window (taskbar button, its icon, pinning) to the installed Start-menu shortcut by this
  // ID, which the installer gives the shortcut (electron-builder.yml appId); without it the two don't match.
  if (process.platform === 'win32') app.setAppUserModelId('com.yurirage.glareshield');
  void app.whenReady().then(() => {
    integrateAppImage();
    serveApp();
    // One policy for permission requests and checks: the app's own page gets the permissions it uses, nothing else
    // (camera and microphone stay off, as on the web). Serial devices: the RTK widget's Web Serial.
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, cb) =>
      cb(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(wc.getURL()))
    );
    ses.setPermissionCheckHandler((_wc, permission, origin) => ALLOWED_PERMISSIONS.has(permission) && isAppUrl(origin));
    ses.setDevicePermissionHandler((details) => details.deviceType === 'serial' && isAppUrl(details.origin));
    main = createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
