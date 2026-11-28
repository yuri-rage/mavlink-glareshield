// The page's view of the desktop app (src/desktop/api.ts): a small, fixed API over IPC, nothing more of Electron or
// Node. Runs sandboxed, so only `electron` (contextBridge, ipcRenderer) is available here.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type Listener<A extends unknown[]> = (...args: A) => void;

/** Subscribe to one channel, filtered to one link ID; returns the unsubscribe. */
function onFor<T>(channel: string, id: string, listener: (value: T) => void) {
  const handler = (_e: IpcRendererEvent, linkId: string, value: T) => {
    if (linkId === id) listener(value);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

function on<A extends unknown[]>(channel: string, listener: Listener<A>) {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...(args as A));
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const args = Object.fromEntries(
  process.argv.filter((a) => a.startsWith('--glareshield-')).map((a) => a.slice(2).split('=') as [string, string])
);

contextBridge.exposeInMainWorld('glareshieldDesktop', {
  version: args['glareshield-version'] ?? '',
  window: {
    frameless: args['glareshield-frameless'] === '1',
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximized: (listener: Listener<[boolean]>) => on('window:maximized', listener),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setFrameless: (on: boolean) => ipcRenderer.invoke('settings:set-frameless', on),
    relaunch: () => ipcRenderer.send('app:relaunch'),
  },
  platform: process.platform,
  link: {
    open: (config: unknown) => ipcRenderer.invoke('link:open', config),
    send: (id: string, data: Uint8Array) => ipcRenderer.send('link:send', id, data),
    close: (id: string) => ipcRenderer.invoke('link:close', id),
    onData: (id: string, listener: (data: Uint8Array) => void) => onFor('link:data', id, listener),
    onClosed: (id: string, listener: (reason: string) => void) => onFor('link:closed', id, listener),
  },
  ntrip: {
    open: (id: string, request: unknown) => ipcRenderer.invoke('ntrip:open', id, request),
    sendGga: (id: string, sentence: string) => ipcRenderer.send('ntrip:gga', id, sentence),
    close: (id: string) => ipcRenderer.invoke('ntrip:close', id),
    onData: (id: string, listener: (data: Uint8Array) => void) => onFor('ntrip:data', id, listener),
    onClosed: (id: string, listener: (reason: string) => void) => onFor('ntrip:closed', id, listener),
  },
  serial: {
    list: () => ipcRenderer.invoke('serial:list'),
    onChoosePort: (listener: Listener<[unknown]>) => on('serial:choose-port', listener),
    choosePort: (portId: string | null) => ipcRenderer.send('serial:choose', portId),
  },
  update: {
    getState: () => ipcRenderer.invoke('update:get'),
    onState: (listener: Listener<[unknown]>) => on('update:state', listener),
    check: () => ipcRenderer.send('update:check'),
    install: () => ipcRenderer.send('update:install'),
  },
});
