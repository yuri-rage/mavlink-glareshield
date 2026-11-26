// Starts telemetry logging: one recorder, fed by the connection (frames received and sent, link status) and the
// on/off setting. Imported once at startup.

import { createOpfsTlogStorage } from '../lib/tlogStorage';
import { useTlogStore } from '../store/tlogStore';
import { mavlinkConnection } from './connection';
import { TlogRecorder } from './tlogRecorder';

export const tlogRecorder = new TlogRecorder({ storage: createOpfsTlogStorage() });

/** Ask the browser not to evict the logs under storage pressure (best effort; some browsers ask the user). */
function requestPersistence() {
  try {
    void (navigator.storage as any)?.persist?.();
  } catch {
    // Not supported.
  }
}

// A replay is not logged again: its frames come from a log already.
mavlinkConnection.onPacket((p) => {
  if (!mavlinkConnection.isReplaying()) tlogRecorder.onReceived(p);
});
mavlinkConnection.onSend((data) => tlogRecorder.onSent(data));
mavlinkConnection.onStatus((status) => {
  if (!mavlinkConnection.isReplaying()) tlogRecorder.onStatus(status, mavlinkConnection.isManualDisconnect);
});
useTlogStore.subscribe((s, prev) => {
  // A lower cap deletes old logs now, not at the next log.
  if (s.capMb !== prev.capMb) tlogRecorder.pruneNow();
  if (s.enabled === prev.enabled) return;
  tlogRecorder.setEnabled(s.enabled);
  if (s.enabled) requestPersistence();
});
if (useTlogStore.getState().enabled) requestPersistence();
window.addEventListener('pagehide', () => tlogRecorder.onPageHide());
void tlogRecorder.refreshList();
