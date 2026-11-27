// UDP and TCP links, opened by the desktop app's main process (desktop/main.ts) for the page: a browser can't open
// either. Bytes come and go over its IPC bridge (src/desktop/api.ts); this is the Transport face of that.

import type { DesktopLinkApi, NativeLinkConfig } from '../../desktop/api';
import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types';

export class NativeLinkTransport implements Transport {
  readonly id: string;
  readonly kind: 'udp' | 'tcp';

  private status: TransportStatus = { kind: 'idle' };
  private readonly frameListeners = new Set<FrameListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private linkId: string | null = null;
  private unsubs: Unsubscribe[] = [];

  constructor(
    private readonly api: DesktopLinkApi,
    private readonly config: NativeLinkConfig
  ) {
    this.kind = config.kind;
    this.id = config.kind === 'udp' ? `udp:${config.port}` : `tcp:${config.host}:${config.port}`;
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    if (this.status.kind === 'connected' || this.status.kind === 'connecting') return;
    this.updateStatus({ kind: 'connecting' });
    let id: string;
    try {
      id = await this.api.open(this.config);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.updateStatus({ kind: 'error', message });
      throw new Error(message);
    }
    // Disconnected while opening: close what just opened.
    if (this.getStatus().kind !== 'connecting') {
      void this.api.close(id);
      return;
    }
    this.linkId = id;
    this.unsubs = [
      this.api.onData(id, (data) => {
        for (const l of [...this.frameListeners]) l(data);
      }),
      this.api.onClosed(id, (reason) => {
        this.detach();
        this.updateStatus({ kind: 'disconnected', reason });
      }),
    ];
    this.updateStatus({ kind: 'connected' });
  }

  async disconnect(): Promise<void> {
    const id = this.linkId;
    this.detach();
    this.updateStatus({ kind: 'disconnected' });
    if (id) await this.api.close(id);
  }

  async send(frame: Uint8Array): Promise<void> {
    if (this.linkId && this.status.kind === 'connected') this.api.send(this.linkId, frame);
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private detach() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.linkId = null;
  }

  private updateStatus(status: TransportStatus) {
    this.status = status;
    for (const l of [...this.statusListeners]) l(status);
  }
}
