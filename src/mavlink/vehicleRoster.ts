// The vehicles heard on the link, and which one the app commands (the active vehicle).
//
// Every autopilot heard is listed with what's needed to show it on the map and in the vehicle picker: type, mode,
// armed, position, heading, battery, when last heard. Only the active vehicle's packets reach the telemetry store and
// the managers (mission, parameters, logs); the others are only listed.
//
// Which vehicle is active:
// - The first autopilot heard on a connection.
// - The user's choice (switchToVehicle): everything learned about the old vehicle is dropped (onActiveVehicleChange)
//   and fetched again from the new one, as on a fresh connection.
// - A dropped link that reconnects by itself keeps all of this (onLinkDown); a deliberate Disconnect starts over.
// - When the active vehicle falls silent and another is heard: taken over at once if only one vehicle has been heard
//   at a time on this connection and the silent one was last heard disarmed (a vehicle rebooted with another system
//   ID, a radio swapped to another aircraft). If it was armed (it may be flying through a radio fade), or once two
//   have been heard together, the switch is only offered (takeoverOffer). Silently commanding another aircraft
//   because the one being flown lost its link is the thing to avoid.

import { create } from 'zustand';

import { mavlinkConnection } from './connection';
import { getVehicleModeName, isVehicleAutopilotHeartbeat, MAVLINK_MSG_ID } from './messages';
import type { MavlinkPacket } from './parser';

export interface RosterVehicle {
  sysId: number;
  compId: number;
  type: number;
  autopilot: number;
  modeName: string;
  armed: boolean;
  /** Last heartbeat, ms (Date.now). */
  lastHeard: number;
  lat?: number;
  lon?: number;
  /** Height above home, m. */
  relAlt?: number;
  /** Heading, degrees. */
  heading?: number;
  /** When the position was last heard, ms. */
  posTime?: number;
  /** Battery remaining, %. */
  battery?: number;
}

/** A vehicle is silent after this long without a heartbeat. */
export const SILENT_MS = 10_000;
/** Listed vehicles not heard for this long are dropped from the list. */
export const FORGET_MS = 120_000;

export interface RosterDecisionState {
  activeSystemId: number | null;
  /** The active vehicle's last heartbeat, ms (0: none). */
  activeLastHeard: number;
  /** Two vehicles have been heard together on this connection. */
  multiSeen: boolean;
  /** The active vehicle was armed when last heard. */
  activeArmed: boolean;
}

export type RosterDecision =
  /** Nothing to do (the active vehicle, or another while the active one is heard: `multi` notes they were together). */
  | { kind: 'none'; multi: boolean }
  /** Make it active: the first vehicle, or a takeover after the only vehicle heard went silent while disarmed. */
  | { kind: 'activate'; first: boolean }
  /** The active one is silent and another is heard, after two were heard together or with the silent one armed. */
  | { kind: 'offer' };

/** What an autopilot heartbeat from `sysId` means for the active vehicle (pure; see the module comment). */
export function decideHeartbeat(st: RosterDecisionState, sysId: number, now: number): RosterDecision {
  if (st.activeSystemId === null) return { kind: 'activate', first: true };
  if (sysId === st.activeSystemId) return { kind: 'none', multi: false };
  const activeHeard = st.activeLastHeard > 0 && now - st.activeLastHeard < SILENT_MS;
  if (activeHeard) return { kind: 'none', multi: true };
  return st.multiSeen || st.activeArmed ? { kind: 'offer' } : { kind: 'activate', first: false };
}

interface RosterState {
  vehicles: Record<number, RosterVehicle>;
  activeSystemId: number | null;
  multiSeen: boolean;
  /** Another vehicle heard while the active one is silent (after two were heard together): offered, not taken. */
  takeoverOffer: number | null;
  /**
   * The user chose to keep waiting for the active vehicle: no takeover is offered (of any vehicle on the link) until
   * it is heard again.
   */
  keepWaiting: boolean;
  /** A switch the user asked for that needs confirming (armed, or something under way): the dialog shows it. */
  pendingSwitch: number | null;
  /** Work under way that a switch would stop, by label (registered by widgets: e.g. a parameter batch write). */
  busy: string[];
}

export const useVehicleRosterStore = create<RosterState>(() => ({
  vehicles: {},
  activeSystemId: null,
  multiSeen: false,
  takeoverOffer: null,
  keepWaiting: false,
  pendingSwitch: null,
  busy: [],
}));

/** Turn down the takeover offer (keep waiting for the active vehicle). */
export function dismissTakeoverOffer(): void {
  useVehicleRosterStore.setState({ takeoverOffer: null, keepWaiting: true });
}

type SwitchListener = (to: number, from: number | null) => void;
const switchListeners = new Set<SwitchListener>();

/**
 * Called when the active vehicle changes to another (not on the first vehicle of a connection): drop everything
 * learned about the old one and start over with the new one. Listeners run before the new vehicle's packet that
 * caused the change (if any) is processed.
 */
export function onActiveVehicleChange(listener: SwitchListener): () => void {
  switchListeners.add(listener);
  return () => switchListeners.delete(listener);
}

export function getActiveSystemId(): number | null {
  return useVehicleRosterStore.getState().activeSystemId;
}

/** Make `sysId` the active vehicle now (the confirmation, if any, has been given). */
export function switchToVehicle(sysId: number): void {
  const st = useVehicleRosterStore.getState();
  const from = st.activeSystemId;
  useVehicleRosterStore.setState({
    activeSystemId: sysId,
    takeoverOffer: null,
    keepWaiting: false,
    pendingSwitch: null,
  });
  if (from === sysId) return;
  for (const l of [...switchListeners]) {
    try {
      l(sysId, from);
    } catch (e) {
      console.error('[VehicleRoster] switch listener failed', e);
    }
  }
}

/** Ask to switch: the dialog confirms it (it names what's at stake, or switches at once when nothing is). */
export function requestVehicleSwitch(sysId: number): void {
  if (sysId === getActiveSystemId()) return;
  useVehicleRosterStore.setState({ pendingSwitch: sysId });
}

/** Register (on) or clear (off) work a switch would stop, so the confirmation can name it. */
export function markBusy(label: string, on: boolean): void {
  useVehicleRosterStore.setState((s) => {
    const has = s.busy.includes(label);
    if (on === has) return s;
    return { busy: on ? [...s.busy, label] : s.busy.filter((b) => b !== label) };
  });
}

// The list is kept in a plain map and published at most twice a second (positions arrive at several Hz per vehicle);
// heartbeats that change something visible (a new vehicle, mode, armed) publish at once.
const live = new Map<number, RosterVehicle>();
let lastPublish = 0;
const PUBLISH_MS = 500;

function publish(now: number) {
  lastPublish = now;
  for (const [id, v] of live)
    if (now - v.lastHeard > FORGET_MS && id !== useVehicleRosterStore.getState().activeSystemId) live.delete(id);
  const vehicles: Record<number, RosterVehicle> = {};
  for (const [id, v] of live) vehicles[id] = { ...v };
  useVehicleRosterStore.setState({ vehicles });
}

/**
 * Note a packet (any system) and return the active vehicle's system ID afterwards (null: none yet). Called by the
 * telemetry store for every packet it handles, before it processes it; `data` is the decoded payload.
 */
export function observePacket(packet: MavlinkPacket, data: any, now = Date.now()): number | null {
  const id = packet.messageId;
  if (id === MAVLINK_MSG_ID.HEARTBEAT) {
    if (!data || !isVehicleAutopilotHeartbeat(data.type, data.autopilot, packet.componentId))
      return getActiveSystemId();
    const st = useVehicleRosterStore.getState();
    const prev = live.get(packet.systemId);
    const armed = (data.base_mode & 0x80) !== 0;
    const modeName = getVehicleModeName(data.type, data.custom_mode);
    const changed = !prev || prev.armed !== armed || prev.modeName !== modeName || prev.type !== data.type;
    const activeLive = st.activeSystemId !== null ? live.get(st.activeSystemId) : undefined;
    const activeLastHeard = activeLive?.lastHeard ?? 0;
    const decision = decideHeartbeat(
      {
        activeSystemId: st.activeSystemId,
        activeLastHeard,
        multiSeen: st.multiSeen,
        activeArmed: activeLive?.armed ?? false,
      },
      packet.systemId,
      now
    );
    live.set(packet.systemId, {
      ...(prev ?? {}),
      sysId: packet.systemId,
      compId: packet.componentId,
      type: data.type,
      autopilot: data.autopilot,
      modeName,
      armed,
      lastHeard: now,
    });
    if (changed || now - lastPublish >= PUBLISH_MS) publish(now);
    if (decision.kind === 'none') {
      if (decision.multi && !st.multiSeen) useVehicleRosterStore.setState({ multiSeen: true });
      // The active vehicle is back: an offer to leave it no longer stands.
      if (packet.systemId === st.activeSystemId && (st.takeoverOffer !== null || st.keepWaiting)) {
        useVehicleRosterStore.setState({ takeoverOffer: null, keepWaiting: false });
      }
    } else if (decision.kind === 'activate') {
      if (decision.first) useVehicleRosterStore.setState({ activeSystemId: packet.systemId });
      else switchToVehicle(packet.systemId);
    } else if (st.takeoverOffer === null && !st.keepWaiting) {
      useVehicleRosterStore.setState({ takeoverOffer: packet.systemId });
    }
    return getActiveSystemId();
  }
  const v = live.get(packet.systemId);
  if (v && data) {
    if (id === MAVLINK_MSG_ID.GLOBAL_POSITION_INT) {
      // Decoded already (parser.ts): degrees, meters, heading in degrees (rawHdg 65535: unknown).
      v.lat = data.lat;
      v.lon = data.lon;
      v.relAlt = data.relative_alt;
      v.heading = data.rawHdg === 65535 ? undefined : data.hdg;
      v.posTime = now;
      if (now - lastPublish >= PUBLISH_MS) publish(now);
    } else if (id === MAVLINK_MSG_ID.SYS_STATUS && packet.componentId === v.compId) {
      v.battery = data.battery_remaining >= 0 ? data.battery_remaining : undefined;
    }
  }
  return getActiveSystemId();
}

/** Forget everything (a new connection starts over: its first vehicle becomes active). */
export function resetRoster(): void {
  live.clear();
  lastPublish = 0;
  useVehicleRosterStore.setState({
    vehicles: {},
    activeSystemId: null,
    multiSeen: false,
    takeoverOffer: null,
    keepWaiting: false,
    pendingSwitch: null,
    busy: [],
  });
}

/**
 * The link went down. A deliberate Disconnect (or a replay starting or ending) starts over: the next connection's first
 * vehicle is active. A dropped link that reconnects by itself keeps the roster: which vehicle is active, whether it was
 * armed, when it was last heard, and whether two were heard together. Otherwise the first autopilot heard after a
 * short bridge drop became active, armed or not: with two vehicles on the link, the controls could move to the other
 * one silently. Kept, the usual rules apply after the reconnect: the active vehicle is back, or after its silence
 * another is only offered (if it was armed, or two were heard together).
 */
export function onLinkDown(manual: boolean): void {
  if (manual) resetRoster();
}

mavlinkConnection.onStatus((status) => {
  if (status === 'disconnected') onLinkDown(mavlinkConnection.isManualDisconnect);
});

// Another link (bridge, serial port, UDP target): start over, as after a Disconnect. A dropped link keeps the roster
// to reconnect to the same vehicles; changing the link while it waits must not carry the old vehicle (armed, say) over
// to whatever the new link reaches.
mavlinkConnection.onLinkChange(() => resetRoster());
