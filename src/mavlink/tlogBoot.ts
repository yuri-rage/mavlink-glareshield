// Starts telemetry logging: one recorder, fed by the connection (frames received and sent, link status) and the
// on/off setting. Imported once at startup.

import { mavlinkConnection } from './connection';
import { TlogRecorder } from './tlogRecorder';
import { createOpfsTlogStorage } from '../lib/tlogStorage';
import { useTlogStore } from '../store/tlogStore';

export const tlogRecorder = new TlogRecorder({ storage: createOpfsTlogStorage() });

/** Ask the browser not to evict the logs under storage pressure (best effort; some browsers ask the user). */
function requestPersistence() {
  try {
    void (navigator.storage as any)?.persist?.();
  } catch {
    // Not supported.
  }
}

mavlinkConnection.onPacket((p) => tlogRecorder.onReceived(p));
mavlinkConnection.onSend((data) => tlogRecorder.onSent(data));
mavlinkConnection.onStatus((status) => tlogRecorder.onStatus(status, mavlinkConnection.isManualDisconnect));
useTlogStore.subscribe((s, prev) => {
  if (s.enabled === prev.enabled) return;
  tlogRecorder.setEnabled(s.enabled);
  if (s.enabled) requestPersistence();
});
if (useTlogStore.getState().enabled) requestPersistence();
window.addEventListener('pagehide', () => tlogRecorder.onPageHide());
void tlogRecorder.refreshList();
