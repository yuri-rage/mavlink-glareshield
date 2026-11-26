// Telemetry log replay: a recorded .tlog played as the link, so the real dashboard, map and widgets show the flight.
// Read-only: the connection drops every send while replaying (connection.ts), and the managers that would ask the
// vehicle for something (parameters, mission, logs, MAVFTP, stream rates, version, gimbal, terrain) don't.
//
// Starting closes the live link (as Disconnect); stopping returns to disconnected, with everything the replay showed
// cleared. Connect brings the live link back.

import { resetMessageCache } from '../lib/messageCache';
import { initialReplayState, useReplayStore } from '../store/replayStore';
import { resetVehicleState, useTelemetryStore } from '../store/telemetryStore';
import { mavlinkConnection } from './connection';
import { buildReplayTimeline } from './tlogReplay';
import { ReplayTransport } from './transport/replayTransport';

let current: ReplayTransport | null = null;

function clearShown() {
  resetVehicleState();
  resetMessageCache();
}

/**
 * Replay `bytes` (a .tlog) as the link. Throws when it holds no vehicle frames. The live link, if any, is closed
 * first.
 */
export function startReplay(bytes: Uint8Array, name: string): void {
  const timeline = buildReplayTimeline(bytes);
  if (timeline.frames.length === 0) {
    throw new Error(
      timeline.gcsFrames > 0
        ? 'This log holds only what the ground station sent: nothing from a vehicle to replay.'
        : 'No MAVLink frames found: is this a telemetry log (.tlog)?'
    );
  }
  const transport = new ReplayTransport('mavlink-replay', timeline, {
    onRestart: () => {
      // Seeking backwards: the stores start over, then the log plays again up to the new position.
      mavlinkConnection.restartReplayStream();
      clearShown();
    },
    onState: (s) => {
      if (current === transport) useReplayStore.setState(s);
    },
  });
  // (Starting closes the previous link: a replay already running ends first, through the listener below.)
  mavlinkConnection.startReplay(transport);
  current = transport;
  clearShown();
  useReplayStore.setState({
    ...initialReplayState,
    active: true,
    name,
    durationMs: timeline.durationMs,
    startEpochMs: timeline.startEpochMs,
    gapsCompressed: timeline.gapsCompressed,
  });
  transport.play();
}

export async function startReplayFromBlob(blob: Blob, name: string): Promise<void> {
  startReplay(new Uint8Array(await blob.arrayBuffer()), name);
}

/** End the replay: disconnected, with what it showed cleared. */
export function stopReplay(): void {
  mavlinkConnection.stopReplay();
}

/** The replay's transport (tests). */
export const getReplayTransport = () => current;

export const replayControls = {
  play: () => current?.play(),
  pause: () => current?.pause(),
  setSpeed: (speed: number) => current?.setSpeed(speed),
  seek: (ms: number) => current?.seek(ms),
};

/**
 * Starting a replay closes the live link: ask first when a vehicle is connected (naming the consequence, more
 * plainly when it is armed). True to go ahead.
 */
export function confirmLeavingLiveLink(): boolean {
  if (mavlinkConnection.isReplaying() || mavlinkConnection.getStatus() !== 'connected') return true;
  const hb = useTelemetryStore.getState().heartbeat;
  if (hb.lastHeartbeatTime === 0) return true;
  return window.confirm(
    hb.isArmed
      ? `Vehicle ${hb.systemId} is ARMED. Replaying a log disconnects from it: no telemetry, alerts or commands from here until you Connect again. Replay anyway?`
      : `Replaying a log disconnects from vehicle ${hb.systemId} until you Connect again. Replay?`
  );
}

// However the replay ends (Stop, or Disconnect in the navbar), the stores are cleared and the bar goes.
mavlinkConnection.onReplayChange((replaying) => {
  if (replaying) return;
  current = null;
  useReplayStore.setState({ ...initialReplayState });
  clearShown();
});
