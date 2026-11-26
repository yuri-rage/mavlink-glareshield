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

import { forgetLinkSequence, getLastSeen, resetMessageCache } from '../lib/messageCache';
import { askConfirm } from '../store/confirmStore';
import { useConnectionStore } from '../store/connectionStore';
import { initialReplayState, useReplayStore } from '../store/replayStore';
import {
  applyHomeFromMissionItem0,
  resetVehicleState,
  restoreSavedNav,
  useTelemetryStore,
} from '../store/telemetryStore';
import { mavlinkConnection } from './connection';
import { getVehicleCategory, isVehicleAutopilotHeartbeat, MAVLINK_MSG_ID } from './messages';
import { missionManager } from './missionManager';
import { setReplayClock } from './replayClock';
import { scanReplayMissionFiles, type ReplayMissionFile } from './replayMissionFiles';
import { buildReplayTimeline, epochAt, frameHeader, type ReplayTimeline } from './tlogReplay';
import { ReplayTransport } from './transport/replayTransport';
import { resetRoster, useVehicleRosterStore } from './vehicleRoster';

let current: ReplayTransport | null = null;

function clearShown() {
  resetVehicleState();
  resetMessageCache();
}

/**
 * Home from the log, also played right after the first autopilot heartbeat (before it, the vehicle isn't active yet
 * and the packet would be ignored): the HOME_POSITION of that vehicle, the one that becomes active (not a gimbal's or
 * a companion computer's heartbeat, nor another vehicle's home in a log of several). A live link asks for home on
 * connect; a log recorded mid-session holds it only where something asked. Changes `timeline` in place; later
 * HOME_POSITIONs play as recorded.
 */
export function hoistHomePosition(timeline: ReplayTimeline): boolean {
  const hbAt = timeline.frames.findIndex((f) => {
    const h = frameHeader(f);
    if (h?.messageId !== MAVLINK_MSG_ID.HEARTBEAT) return false;
    // HEARTBEAT payload: custom_mode (4 bytes), type, autopilot, ...
    const p = f[0] === 0xfd ? 10 : 6;
    return isVehicleAutopilotHeartbeat(f[p + 4] ?? 0, f[p + 5] ?? 0, h.componentId);
  });
  if (hbAt < 0) return false;
  const sys = frameHeader(timeline.frames[hbAt])!.systemId;
  const homeAt = timeline.frames.findIndex((f) => {
    const h = frameHeader(f);
    return h?.messageId === MAVLINK_MSG_ID.HOME_POSITION && h.systemId === sys;
  });
  if (homeAt < 0 || homeAt <= hbAt + 1) return false;
  timeline.frames.splice(hbAt + 1, 0, timeline.frames[homeAt]);
  timeline.timesMs.splice(hbAt + 1, 0, timeline.timesMs[hbAt]);
  timeline.epochMs.splice(hbAt + 1, 0, timeline.epochMs[hbAt]);
  return true;
}

/** A mission file rebuilt from the log, into the store as a download would put it. */
export function applyReplayMissionFile(file: ReplayMissionFile): void {
  if (file.kind === 'mission') {
    const unpacked = missionManager.unpackMissionDat(file.data);
    if (!unpacked) return;
    // The current waypoint as the log has it by now (a MISSION_CURRENT played before the file was applied, e.g.
    // during a seek), not the file's flags.
    const cur = useTelemetryStore.getState().currentWaypointSeq;
    const wps =
      getLastSeen('MISSION_CURRENT') !== undefined ? unpacked.map((w) => ({ ...w, current: w.seq === cur })) : unpacked;
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
  const leftVehicle = mavlinkConnection.isReplaying()
    ? useReplayStore.getState().leftVehicle
    : (liveVehicle()?.sysId ?? null);
  const transport = new ReplayTransport('mavlink-replay', timeline, {
    activeSystem: () => useVehicleRosterStore.getState().activeSystemId,
    onRestart: () => {
      // Seeking backwards: the stores start over, then the log plays again up to the new position.
      mavlinkConnection.restartReplayStream();
      // The vehicles heard so far too (later ones, which is active, armed, heard together): the log decides again.
      resetRoster();
      clearShown();
      applied = 0;
    },
    onState: (s) => {
      if (current !== transport) return;
      // Playing again after a pause: the log's own numbering takes over from the repeated heartbeat's.
      if (s.playing && !useReplayStore.getState().playing) forgetLinkSequence();
      useReplayStore.setState(s);
      applyUpTo(s.positionMs);
    },
  });
  // (Starting closes the previous link: a replay already running ends first, through the listener below.)
  mavlinkConnection.startReplay(transport);
  current = transport;
  setReplayClock({
    now: () => epochAt(timeline, transport.player.clockMs),
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

/** The log's wall-clock time at playback position `ms` (0 when no replay). */
export const replayEpochAt = (ms: number): number => (current ? epochAt(current.player.timeline, ms) : 0);

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
 * downloaded parameters when they're known, else said as a possibility. Plane names them differently: FS_GCS_ENABL,
 * with its short and long failsafes after FS_SHORT_TIMEOUT / FS_LONG_TIMEOUT; Copter, Rover and Sub use FS_GCS_ENABLE
 * and FS_GCS_TIMEOUT.
 */
export function gcsFailsafeNote(params: Record<string, { value: number } | undefined>, vehicleType?: number): string {
  const plane = vehicleType !== undefined ? getVehicleCategory(vehicleType) === 'plane' : 'FS_GCS_ENABL' in params;
  const enableName = plane ? 'FS_GCS_ENABL' : 'FS_GCS_ENABLE';
  const enable = params[enableName]?.value;
  const after = plane
    ? [params['FS_SHORT_TIMEOUT']?.value, params['FS_LONG_TIMEOUT']?.value]
    : [params['FS_GCS_TIMEOUT']?.value];
  if (enable === undefined)
    return `If its ground-station failsafe (${enableName}) is on, it will take its failsafe action (often RTL) when our heartbeat stops.`;
  if (enable === 0) return `Its ground-station failsafe is off (${enableName} = 0).`;
  const when =
    plane && after[0] && after[1]
      ? `about ${after[0]} s (short failsafe) and ${after[1]} s (long) `
      : (plane ? after[1] : after[0])
        ? `about ${plane ? after[1] : after[0]} s `
        : '';
  return `Its ground-station failsafe is ON (${enableName} = ${enable}): it will take its failsafe action (often RTL) ${when}after our heartbeat stops.`;
}

/**
 * Starting a replay closes the live link: ask first when a vehicle is connected, or a dropped link to one is
 * reconnecting, naming the consequences (no telemetry, alerts or commands; the ground-station failsafe), more plainly
 * when it is armed. In the app's own dialog: window.confirm() would block the page, and with it the heartbeat, while
 * the warning is read. Resolves true to go ahead.
 */
/**
 * The live vehicle a replay would leave: the one connected, or (a dropped link reconnecting by itself) the one the
 * roster keeps for it. The store's heartbeat is cleared on any drop, so the roster is what still knows the vehicle
 * then. Null when there's none (never connected, or a deliberate Disconnect).
 */
export function liveVehicle(): { sysId: number; armed: boolean; type: number; reconnecting: boolean } | null {
  if (mavlinkConnection.isReplaying()) return null;
  const hb = useTelemetryStore.getState().heartbeat;
  if (mavlinkConnection.getStatus() === 'connected' && hb.lastHeartbeatTime > 0)
    return { sysId: hb.systemId, armed: hb.isArmed, type: hb.type, reconnecting: false };
  if (mavlinkConnection.isManualDisconnect) return null;
  const roster = useVehicleRosterStore.getState();
  const v = roster.activeSystemId !== null ? roster.vehicles[roster.activeSystemId] : undefined;
  return v ? { sysId: v.sysId, armed: v.armed, type: v.type, reconnecting: true } : null;
}

export function confirmLeavingLiveLink(): Promise<boolean> {
  const v = liveVehicle();
  if (!v) return Promise.resolve(true);
  const failsafe = gcsFailsafeNote(useTelemetryStore.getState().parameters, v.type);
  const link = v.reconnecting ? ' (its link is reconnecting now; that stops too)' : '';
  return askConfirm({
    title: v.armed ? `Vehicle ${v.sysId} is ARMED` : 'Leave the live vehicle?',
    message: [
      `Replaying a log disconnects from vehicle ${v.sysId}${link}: no telemetry, alerts or commands from here until you connect again.`,
      failsafe,
    ],
    confirmLabel: v.armed ? 'Replay anyway' : 'Replay',
    danger: v.armed,
  });
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
