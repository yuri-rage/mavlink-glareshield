// Appends to one telemetry log in the browser's private file storage (OPFS). A synchronous access handle (only
// available in a worker) is exclusive and writes in place, so each batch is on disk when the reply is sent: a
// reload or a crash loses at most the batch being collected. A second tab can't open the same file (the handle is
// exclusive), so it can't interleave writes into it.

export type TlogWorkerRequest =
  | { op: 'open'; id: number; dir: string; name: string; append: boolean }
  | { op: 'write'; id: number; data: ArrayBuffer }
  | { op: 'close'; id: number };

export type TlogWorkerReply =
  { id: number; ok: true; size: number } | { id: number; ok: false; error: string; quota: boolean };

let handle: any = null;
let position = 0;

async function open(dir: string, name: string, append: boolean): Promise<number> {
  close();
  const root = await (navigator.storage as any).getDirectory();
  const folder = await root.getDirectoryHandle(dir, { create: true });
  const file = await folder.getFileHandle(name, { create: true });
  handle = await file.createSyncAccessHandle();
  position = append ? handle.getSize() : 0;
  if (!append) handle.truncate(0);
  return position;
}

function close() {
  if (!handle) return;
  try {
    handle.flush();
    handle.close();
  } catch {
    // Already closed.
  }
  handle = null;
}

self.onmessage = async (e: MessageEvent<TlogWorkerRequest>) => {
  const msg = e.data;
  const reply = (r: TlogWorkerReply) => (self as any).postMessage(r);
  try {
    if (msg.op === 'open') {
      reply({ id: msg.id, ok: true, size: await open(msg.dir, msg.name, msg.append) });
    } else if (msg.op === 'write') {
      if (!handle) throw new Error('no log open');
      const data = new Uint8Array(msg.data);
      const n = handle.write(data, { at: position });
      position += n;
      handle.flush();
      if (n !== data.length) throw Object.assign(new Error('storage full'), { name: 'QuotaExceededError' });
      reply({ id: msg.id, ok: true, size: position });
    } else if (msg.op === 'close') {
      close();
      reply({ id: msg.id, ok: true, size: position });
    }
  } catch (err: any) {
    reply({ id: msg.id, ok: false, error: err?.message || String(err), quota: err?.name === 'QuotaExceededError' });
  }
};
