// Where telemetry logs live: files in the browser's private file storage (OPFS, folder "tlogs"), written through a
// worker (tlogWriter.worker.ts), and a small index of what the app knows about each one (vehicle, times, kept) in
// localStorage. Files the index doesn't know (e.g. after "restore defaults" cleared it) are still listed, from their
// names and sizes. A memory store stands in where OPFS isn't available to the app (tests).

import type { TlogMeta } from '../mavlink/tlog';
import type { TlogWorkerReply, TlogWorkerRequest } from './tlogWriter.worker';

const DIR = 'tlogs';
const INDEX_KEY = 'mavlink_glareshield_tlog_index';

/** The one log being written, and the files on disk. */
export interface TlogStorage {
  /** Open `name` for writing (appending, or from empty); the size it starts at. */
  open(name: string, append: boolean): Promise<number>;
  /** Append; the file's size after. Throws (with `quota` true) when storage is full. */
  write(data: Uint8Array): Promise<number>;
  close(): Promise<void>;
  /** Files on disk: name and size. */
  files(): Promise<{ name: string; size: number; lastModified: number }[]>;
  remove(name: string): Promise<void>;
  /** The file, to download. */
  file(name: string): Promise<Blob>;
}

export class TlogStorageError extends Error {
  constructor(message: string, public quota: boolean) {
    super(message);
  }
}

/** OPFS through the writer worker; null when this browser can't (no OPFS or workers). */
export function createOpfsTlogStorage(): TlogStorage | null {
  if (typeof Worker === 'undefined' || typeof navigator === 'undefined' || !(navigator.storage as any)?.getDirectory) return null;
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, (r: TlogWorkerReply) => void>();
  const call = (msg: Omit<TlogWorkerRequest, 'id'> & { op: TlogWorkerRequest['op'] }, transfer: Transferable[] = []) => {
    if (!worker) {
      worker = new Worker(new URL('./tlogWriter.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<TlogWorkerReply>) => {
        pending.get(e.data.id)?.(e.data);
        pending.delete(e.data.id);
      };
    }
    const id = nextId++;
    return new Promise<number>((resolve, reject) => {
      pending.set(id, (r) => (r.ok ? resolve(r.size) : reject(new TlogStorageError(r.error, r.quota))));
      worker!.postMessage({ ...msg, id } as TlogWorkerRequest, transfer);
    });
  };
  const folder = async () => (await (navigator.storage as any).getDirectory()).getDirectoryHandle(DIR, { create: true });
  return {
    open: (name, append) => call({ op: 'open', dir: DIR, name, append } as any),
    write: (data) => {
      const copy = data.slice().buffer;
      return call({ op: 'write', data: copy } as any, [copy]);
    },
    close: async () => {
      await call({ op: 'close' } as any);
    },
    files: async () => {
      const out: { name: string; size: number; lastModified: number }[] = [];
      for await (const [name, h] of (await folder()).entries()) {
        if (h.kind !== 'file' || !name.endsWith('.tlog')) continue;
        const f = await h.getFile();
        out.push({ name, size: f.size, lastModified: f.lastModified });
      }
      return out;
    },
    remove: async (name) => {
      await (await folder()).removeEntry(name);
    },
    file: async (name) => (await (await folder()).getFileHandle(name)).getFile(),
  };
}

/** In memory: for tests, and the shape the recorder expects. */
export function createMemoryTlogStorage(opts: { quotaBytes?: number } = {}): TlogStorage & { data: Map<string, Uint8Array> } {
  const data = new Map<string, Uint8Array>();
  let current: string | null = null;
  const used = () => [...data.values()].reduce((t, d) => t + d.length, 0);
  return {
    data,
    open: async (name, append) => {
      current = name;
      if (!append || !data.has(name)) data.set(name, new Uint8Array(0));
      return data.get(name)!.length;
    },
    write: async (bytes) => {
      if (!current) throw new TlogStorageError('no log open', false);
      if (opts.quotaBytes !== undefined && used() + bytes.length > opts.quotaBytes) throw new TlogStorageError('storage full', true);
      const old = data.get(current)!;
      const next = new Uint8Array(old.length + bytes.length);
      next.set(old);
      next.set(bytes, old.length);
      data.set(current, next);
      return next.length;
    },
    close: async () => {
      current = null;
    },
    files: async () => [...data.entries()].map(([name, d]) => ({ name, size: d.length, lastModified: 0 })),
    remove: async (name) => {
      if (name === current) throw new TlogStorageError('in use', false);
      data.delete(name);
    },
    file: async (name) => new Blob([data.get(name) as BlobPart]),
  };
}

/** The index of logs (what the files don't say). */
export function loadTlogIndex(): Record<string, TlogMeta> {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function saveTlogIndex(index: Record<string, TlogMeta>) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage blocked or full: the files are still listed from the folder.
  }
}

/** Meta for a file the index doesn't know: from its name (start time, vehicle), closed and not kept. */
export function metaFromFile(f: { name: string; size: number; lastModified: number }): TlogMeta {
  const m = /^(\d{4})-(\d\d)-(\d\d)_(\d\d)-(\d\d)-(\d\d)_sys(\d+)\.tlog$/.exec(f.name);
  const start = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : f.lastModified;
  return { name: f.name, sysId: m ? +m[7] : 0, vehicleType: -1, startMs: start, lastWriteMs: f.lastModified || start, bytes: f.size, closed: true, kept: false };
}
