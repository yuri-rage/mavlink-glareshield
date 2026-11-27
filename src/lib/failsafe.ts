// Whether the HUD shows its failsafe banner.

/** How long a failsafe STATUSTEXT keeps the banner up. */
export const FAILSAFE_TEXT_WINDOW_MS = 30_000;

/** The message log is newest first, as appendStatusMessage keeps it (src/store/telemetryStore.ts). */
export function isFailsafeActive(
  heartbeat: { systemStatus?: number; modeName?: string },
  statusMessages: { text: string; severity?: number; timestamp?: number }[],
  now = Date.now()
): boolean {
  // 1. MAVLink System Status explicitly flags critical / emergency failsafe states
  // 5 = MAV_STATE_CRITICAL, 6 = MAV_STATE_EMERGENCY, 8 = MAV_STATE_FLIGHT_TERMINATION
  if (heartbeat.systemStatus === 5 || heartbeat.systemStatus === 6 || heartbeat.systemStatus === 8) {
    return true;
  }

  // 2. Flight mode specifically named FAILSAFE
  if (heartbeat.modeName && heartbeat.modeName.toUpperCase().includes('FAILSAFE')) {
    return true;
  }

  // 3. A recent STATUSTEXT from the autopilot reporting a failsafe. The log is newest first (appendStatusMessage
  // prepends), so the newest failsafe line decides (a later "cleared" outranks the event), and the first line older
  // than the window ends the search.
  for (let i = 0; i < statusMessages.length; i++) {
    const msg = statusMessages[i];
    if (msg.timestamp && now - msg.timestamp > FAILSAFE_TEXT_WINDOW_MS) break;
    const txt = (msg.text || '').trim().toLowerCase();
    if (txt.includes('failsafe')) {
      if (
        txt.includes('cleared') ||
        txt.includes('disabled') ||
        txt.includes('recovered') ||
        txt.includes('restored') ||
        txt.includes('cancelled') ||
        txt.includes('passed')
      ) {
        return false;
      }
      return true;
    }
  }

  return false;
}
