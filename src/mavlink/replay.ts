// Telemetry log replay: a recorded .tlog played as the link, so the real dashboard, map and widgets show the flight.
// Read-only: the connection drops every send while replaying (connection.ts), and the managers that would ask the
// vehicle for something (parameters, mission, logs, MAVFTP, stream rates, version, gimbal, terrain) don't.
//
// Starting closes the live link (as Disconnect); stopping returns to disconnected, with everything the replay showed
// cleared. Connect brings the live link back.
//
// What a live link would have asked for and the log only holds in passing is put back: home (a HOME_POSITION anywhere
// in the log is also played just after the vehicle's first heartbeat, so it's known from the start), and a mission,
// fence or rally points downloaded over MAVFTP (rebuilt from the file transfer, shown from the moment it completed;
// a download streamed as MISSION_ITEM_INT reaches the store as it plays).

import { resetMessageCache } from '../lib/messageCache';
import { useConnectionStore } from '../store/connectionStore';
import { initialReplayState, useReplayStore } from '../store/replayStore';
import {
  applyHomeFromMissionItem0,
  resetVehicleState,
  restoreSavedNav,
  useTelemetryStore,
} from '../store/telemetryStore';
import { mavlinkConnection } from './connection';
import { MAVLINK_MSG_ID } from './messages';
import { missionManager } from './missionManager';
import { setReplayClock } from './replayClock';
import { scanReplayMissionFiles, type ReplayMissionFile } from './replayMissionFiles';
import { buildReplayTimeline, frameHeader, type ReplayTimeline } from './tlogReplay';
import { ReplayTransport } from './transport/replayTransport';

let current: ReplayTransport | null = null;

function clearShown() {
  resetVehicleState();
  resetMessageCache();
}

/**
 * Home from the log's first HOME_POSITION, also played right after the vehicle's first heartbeat (before it, the
 * vehicle isn't active yet and the packet would be ignored). A live link asks for home on connect; a log recorded
 * mid-session holds it only where something asked. Changes `timeline` in place; later HOME_POSITIONs play as recorded.
 */
export function hoistHomePosition(timeline: ReplayTimeline): boolean {
  const homeAt = timeline.frames.findIndex((f) => frameHeader(f)?.messageId === MAVLINK_MSG_ID.HOME_POSITION);
  if (homeAt < 0) return false;
  const sys = frameHeader(timeline.frames[homeAt])!.systemId;
  const hbAt = timeline.frames.findIndex((f) => {
    const h = frameHeader(f);
    return h?.messageId === MAVLINK_MSG_ID.HEARTBEAT && h.systemId === sys;
  });
  if (hbAt < 0 || homeAt <= hbAt + 1) return false;
  timeline.frames.splice(hbAt + 1, 0, timeline.frames[homeAt]);
  timeline.timesMs.splice(hbAt + 1, 0, timeline.timesMs[hbAt]);
  return true;
}

/** A mission file rebuilt from the log, into the store as a download would put it. */
export function applyReplayMissionFile(file: ReplayMissionFile): void {
  if (file.kind === 'mission') {
    const wps = missionManager.unpackMissionDat(file.data);
    if (!wps) return;
    useTelemetryStore.setState({ missionWaypoints: wps });
    applyHomeFromMissionItem0(wps);
  } else if (file.kind === 'fence') {
    const fps = missionManager.unpackFenceDat(file.data);
    if (fps) useTelemetryStore.setState({ fencePoints: fps });
  } else {
    const rps = missionManager.unpackRallyDat(file.data);
    if (rps)
      useTelemetryStore.setState({
        rallyPoints: rps,
        ...(rps.length > 0 ? { rallySupport: 'supported' as const } : {}),
      });
  }
}

/**
 * Replay `bytes` (a .tlog) as the link. Throws when it holds no vehicle frames. The live link, if any, is closed
 * first.
 */
export function startReplay(bytes: Uint8Array, name: string): void {
  const timeline = buildReplayTimeline(bytes);
  // Scanned before home is hoisted: the scan counts the timeline's frames in log order.
  const files = scanReplayMissionFiles(bytes, timeline);
  /** Files applied so far (in order of their time); back to 0 when a seek starts the stores over. */
  let applied = 0;
  const applyUpTo = (ms: number) => {
    while (applied < files.length && files[applied].atMs <= ms) applyReplayMissionFile(files[applied++]);
  };
  if (timeline.frames.length === 0) {
    throw new Error(
      timeline.gcsFrames > 0
        ? 'This log holds only what the ground station sent: nothing from a vehicle to replay.'
        : 'No MAVLink frames found: is this a telemetry log (.tlog)?'
    );
  }
  hoistHomePosition(timeline);
  // A live vehicle this replay leaves (Stop offers to reconnect); a replay replacing a replay leaves the first one's.
  const hb = useTelemetryStore.getState().heartbeat;
  const leftVehicle = mavlinkConnection.isReplaying()
    ? useReplayStore.getState().leftVehicle
    : mavlinkConnection.getStatus() === 'connected' && hb.lastHeartbeatTime > 0
      ? hb.systemId
      : null;
  const transport = new ReplayTransport('mavlink-replay', timeline, {
    onRestart: () => {
      // Seeking backwards: the stores start over, then the log plays again up to the new position.
      mavlinkConnection.restartReplayStream();
      clearShown();
      applied = 0;
    },
    onState: (s) => {
      if (current !== transport) return;
      useReplayStore.setState(s);
      applyUpTo(s.positionMs);
    },
  });
  // (Starting closes the previous link: a replay already running ends first, through the listener below.)
  mavlinkConnection.startReplay(transport);
  current = transport;
  setReplayClock({
    now: () => timeline.startEpochMs + transport.player.clockMs,
    speed: () => (transport.player.playing ? transport.player.speed : 1),
  });
  clearShown();
  useReplayStore.setState({
    ...initialReplayState,
    active: true,
    name,
    durationMs: timeline.durationMs,
    startEpochMs: timeline.startEpochMs,
    gapsCompressed: timeline.gapsCompressed,
    leftVehicle,
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

/** End the replay and connect again with the link settings (back to the vehicle the replay left). */
export function stopReplayAndReconnect(): void {
  mavlinkConnection.stopReplay();
  useConnectionStore.getState().connect();
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
 * What leaving the live link means for the vehicle's ground-station failsafe: our heartbeat stops with it. From the
 * downloaded parameters when they're known (FS_GCS_ENABLE, FS_GCS_TIMEOUT), else said as a possibility.
 */
export function gcsFailsafeNote(params: Record<string, { value: number } | undefined>): string {
  const enable = params['FS_GCS_ENABLE']?.value;
  const timeout = params['FS_GCS_TIMEOUT']?.value;
  if (enable === undefined)
    return 'If its ground-station failsafe (FS_GCS_ENABLE) is on, it will take its failsafe action (often RTL) when our heartbeat stops.';
  if (enable === 0) return 'Its ground-station failsafe is off (FS_GCS_ENABLE = 0).';
  return `Its ground-station failsafe is ON (FS_GCS_ENABLE = ${enable}): it will take its failsafe action (often RTL) ${
    timeout ? `about ${timeout} s ` : ''
  }after our heartbeat stops.`;
}

/**
 * Starting a replay closes the live link: ask first when a vehicle is connected, naming the consequences (no
 * telemetry, alerts or commands; the ground-station failsafe), more plainly when it is armed. True to go ahead.
 */
export function confirmLeavingLiveLink(): boolean {
  if (mavlinkConnection.isReplaying() || mavlinkConnection.getStatus() !== 'connected') return true;
  const st = useTelemetryStore.getState();
  const hb = st.heartbeat;
  if (hb.lastHeartbeatTime === 0) return true;
  const failsafe = gcsFailsafeNote(st.parameters);
  return window.confirm(
    hb.isArmed
      ? `Vehicle ${hb.systemId} is ARMED. Replaying a log disconnects from it: no telemetry, alerts or commands from here until you Connect again. ${failsafe} Replay anyway?`
      : `Replaying a log disconnects from vehicle ${hb.systemId} until you Connect again. ${failsafe} Replay?`
  );
}

// However the replay ends (Stop, or Disconnect in the navbar), the stores are cleared and the bar goes.
mavlinkConnection.onReplayChange((replaying) => {
  if (replaying) return;
  current = null;
  setReplayClock(null);
  useReplayStore.setState({ ...initialReplayState });
  clearShown();
  // What was saved before the replay (mission, fence, rally points, home), as when the app starts.
  restoreSavedNav();
});
