// The page's caster streams in the main process (desktop/main.ts): one per ID, which the page chooses and listens on
// before asking for it, so nothing the caster sends is missed. The caster often sends its first RTCM in the same
// packet as its "200 OK", and that is passed on while the connection is still being answered (before open resolves):
// the ID is registered before connecting, not after. A stream closed (by the page, or every stream by a reload) while
// its caster is still answering is closed as soon as it connects.

import { checkNtripRequest, connectNtrip, type NtripSession } from './ntripClient';

type Emit = (channel: 'ntrip:data' | 'ntrip:closed', id: string, value: Uint8Array | string) => void;

interface Entry {
  /** Null while the caster is answering. */
  session: NtripSession | null;
}

export class NtripStreams {
  private streams = new Map<string, Entry>();

  constructor(
    private emit: Emit,
    private connect: typeof connectNtrip = connectNtrip
  ) {}

  /** Connects for the page's stream `id`; resolves once the caster accepts, rejects with why not. */
  async open(id: unknown, request: unknown): Promise<void> {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error('Not a stream ID');
    if (this.streams.has(id)) throw new Error(`Stream ${id} is already open`);
    const r = checkNtripRequest(request as never);
    if (typeof r === 'string') throw new Error(r);
    const entry: Entry = { session: null };
    this.streams.set(id, entry);
    const current = () => this.streams.get(id) === entry;
    let session: NtripSession;
    try {
      session = await this.connect(r, {
        onData: (data) => {
          if (current()) this.emit('ntrip:data', id, data);
        },
        onClosed: (reason) => {
          if (!current()) return;
          this.streams.delete(id);
          this.emit('ntrip:closed', id, reason);
        },
      });
    } catch (e) {
      if (current()) this.streams.delete(id);
      throw e;
    }
    if (!current()) {
      // Closed while the caster was answering (by the page, or a reload).
      await session.close();
      throw new Error('Closed before the caster answered');
    }
    entry.session = session;
  }

  sendGga(id: unknown, sentence: unknown): void {
    if (typeof id !== 'string' || typeof sentence !== 'string') return;
    this.streams.get(id)?.session?.sendGga(sentence);
  }

  /** Resolves once the socket is gone (or at once, for a stream still connecting: it closes when it connects). */
  async close(id: unknown): Promise<void> {
    if (typeof id !== 'string') return;
    const entry = this.streams.get(id);
    this.streams.delete(id);
    await entry?.session?.close();
  }

  /** Every stream (the page reloaded, crashed or closed). */
  closeAll(): Promise<void> {
    const all = [...this.streams.values()];
    this.streams.clear();
    return Promise.all(all.map((e) => e.session?.close())).then(() => {});
  }

  get size(): number {
    return this.streams.size;
  }
}
