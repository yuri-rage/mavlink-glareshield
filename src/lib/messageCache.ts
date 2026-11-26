// Latest decoded copy of every telemetry message, for custom widget bindings.
//
// The telemetry store keeps curated slices of a fixed set of messages. Custom widgets can bind to any field the
// decoder produces, so this module records the last decoded payload of each message from the vehicle (plus the
// time it arrived, which drives stale-value detection) and lists the numeric fields it has seen, which the widget
// creator offers as bindable fields.

import { mavlinkConnection } from '../mavlink/connection';
import { LinkQualityMeter, type LinkSnapshot } from '../mavlink/linkQuality';
import { MAVLINK_MSG_ID } from '../mavlink/messages';
import { decodePacket, type MavlinkPacket } from '../mavlink/parser';
import { pidAxisMessageName } from '../mavlink/pidTuning';
import { getActiveSystemId, onActiveVehicleChange } from '../mavlink/vehicleRoster';
import { pidTuningRecorder } from './pidTuningRecorder';

const MAV_TYPE_GCS = 6;
const MAV_AUTOPILOT_INVALID = 8;

/** Messages that are protocol traffic, not telemetry: never cached or offered as bindable. */
const SKIPPED = new Set<number>(
  [
    'PARAM_VALUE',
    // Log listing and download traffic: bulk data, nothing to bind to.
    'LOG_ENTRY',
    'LOG_DATA',
    'STATUSTEXT',
    'COMMAND_ACK',
    'COMMAND_INT',
    'COMMAND_LONG',
    'MISSION_ITEM',
    'MISSION_ITEM_INT',
    'MISSION_REQUEST',
    'MISSION_REQUEST_INT',
    'MISSION_COUNT',
    'MISSION_ACK',
    'MISSION_SET_CURRENT',
    'FILE_TRANSFER_PROTOCOL',
    'GPS_RTCM_DATA',
    'AUTOPILOT_VERSION',
  ]
    .map((name) => (MAVLINK_MSG_ID as Record<string, number>)[name])
    .filter((id): id is number => typeof id === 'number')
);

/** Messages accepted from any system, not only the vehicle (a SiK radio reports RADIO_STATUS as its own system). */
const ANY_SOURCE = new Set<number>([MAVLINK_MSG_ID.RADIO_STATUS].filter((id) => typeof id === 'number'));

const NAME_BY_ID = new Map<number, string>(
  Object.entries(MAVLINK_MSG_ID as Record<string, number>).map(([name, id]) => [id, name])
);

export interface CachedMessage {
  fields: Record<string, number>;
  time: number;
  systemId: number;
}

const latest = new Map<string, CachedMessage>();
const lastSeen = new Map<string, number>();
let vehicleSystemId: number | undefined;
let vehicleType: number | undefined;
/** Link quality: the active vehicle's autopilot's sequence numbers (linkQuality.ts). */
const linkMeter = new LinkQualityMeter();
/** Link quality once a second for the last two minutes (the Link widget's chart): kept here, so a widget mounted later
 *  (another tab, a new pane) has the history. */
const LINK_HISTORY_S = 120;
const linkHistory: { t: number; quality: number | null }[] = [];
const linkSampler = setInterval(() => {
  if (!lastSeen.has('LINK')) return;
  const now = Date.now();
  linkHistory.push({ t: now, quality: linkMeter.snapshot(now).quality });
  if (linkHistory.length > LINK_HISTORY_S) linkHistory.splice(0, linkHistory.length - LINK_HISTORY_S);
}, 1000);
// In Node (the tests) the timer mustn't keep the process alive; browsers have no unref.
(linkSampler as unknown as { unref?: () => void }).unref?.();

/** Link quality once a second, oldest first (up to two minutes). */
export function getLinkHistory(): readonly { t: number; quality: number | null }[] {
  return linkHistory;
}

/** Flatten a decoded payload to numeric fields; arrays become `name[0]`, `name[1]`, ... */
function numericFields(decoded: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value ? 1 : 0;
    } else if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (typeof item === 'number' && Number.isFinite(item)) out[`${key}[${i}]`] = item;
      });
    }
  }
  return out;
}

export function recordPacket(packet: MavlinkPacket, now = Date.now()): void {
  if (packet.messageId === MAVLINK_MSG_ID.HEARTBEAT) {
    const autopilot = packet.payload[5];
    const type = packet.payload[4];
    // The active vehicle's heartbeat (vehicleRoster): another vehicle on the link isn't the one shown.
    const active = getActiveSystemId();
    if (
      autopilot !== MAV_AUTOPILOT_INVALID &&
      type !== MAV_TYPE_GCS &&
      packet.componentId === 1 &&
      (active === null || packet.systemId === active)
    ) {
      if (vehicleType !== undefined && vehicleType !== type) {
        pidTuningRecorder.clear();
      }
      vehicleSystemId = packet.systemId;
      vehicleType = type;
    }
  }
  // Link quality counts every packet from the vehicle's autopilot (protocol traffic too: one sequence for all).
  const linkFrom = vehicleSystemId ?? getActiveSystemId() ?? undefined;
  if (linkFrom !== undefined && packet.systemId === linkFrom && packet.componentId === 1) {
    linkMeter.record(packet.sequence, now);
    lastSeen.set('LINK', now);
  }
  if (SKIPPED.has(packet.messageId)) return;
  const name = NAME_BY_ID.get(packet.messageId);
  if (!name) return;
  // The vehicle's packets only: its ID from its heartbeat, or (just after a switch, before its first heartbeat) the
  // commanded vehicle's, so the old vehicle's packets don't slip in meanwhile.
  const expected = vehicleSystemId ?? getActiveSystemId() ?? undefined;
  if (expected !== undefined && packet.systemId !== expected && !ANY_SOURCE.has(packet.messageId)) {
    return;
  }
  // Only the autopilot's own heartbeat (not a gimbal's or companion's on the same system) describes the vehicle.
  if (
    packet.messageId === MAVLINK_MSG_ID.HEARTBEAT &&
    (packet.systemId !== vehicleSystemId || packet.componentId !== 1)
  ) {
    return;
  }

  const seenBefore = lastSeen.get(name);
  lastSeen.set(name, now);
  let decoded: Record<string, unknown>;
  try {
    decoded = decodePacket(packet) ?? {};
  } catch {
    return;
  }
  if ('rawPayload' in decoded) return; // no decoder for this message
  const fields = numericFields(decoded);
  if (packet.messageId === MAVLINK_MSG_ID.PID_TUNING) {
    // One controller axis per message: kept per axis (PID_TUNING_ROLL, PID_TUNING_STEER, …) so a binding never
    // mixes axes, and recorded in full for the PID tuning chart.
    lastSeen.delete(name);
    const axisName = pidAxisMessageName(fields.axis);
    const { axis: _axis, ...axisFields } = fields;
    lastSeen.set(axisName, now);
    latest.set(axisName, { fields: axisFields, time: now, systemId: packet.systemId });
    pidTuningRecorder.record(fields, now);
    return;
  }
  if (packet.messageId === MAVLINK_MSG_ID.BATTERY_STATUS && typeof fields.id === 'number' && fields.id !== 0) {
    // Each battery monitor reports with its id: BATTERY_STATUS is the first (id 0, BATT_), the others are kept as
    // BATTERY_STATUS_2, _3 ... (id 1 is BATT2_), so a binding never flips between packs. BATTERY_STATUS keeps the
    // time the first battery last reported (not this one's), or its bindings would look fresh while it is silent.
    if (seenBefore === undefined) lastSeen.delete(name);
    else lastSeen.set(name, seenBefore);
    const packName = `BATTERY_STATUS_${fields.id + 1}`;
    lastSeen.set(packName, now);
    latest.set(packName, { fields, time: now, systemId: packet.systemId });
    return;
  }
  latest.set(name, { fields, time: now, systemId: packet.systemId });
}

/** Strip the "(scaled)" display suffix used by the RC / servo pseudo-messages. */
export function baseMessageName(messageName: string): string {
  return messageName
    .replace(/\s*\(scaled\)\s*$/i, '')
    .trim()
    .toUpperCase();
}

function getCachedMessage(messageName: string): CachedMessage | undefined {
  return latest.get(baseMessageName(messageName));
}

export function getCachedField(messageName: string, fieldName: string): number | undefined {
  if (baseMessageName(messageName) === 'LINK') {
    const v = getLinkStats()[fieldName as keyof LinkStats];
    return typeof v === 'number' ? v : undefined;
  }
  return getCachedMessage(messageName)?.fields[fieldName];
}

export interface LinkStats extends LinkSnapshot {
  /** The radio's signal at this end and the vehicle's (RADIO_STATUS, device units, often 0-254); null without one. */
  rssi: number | null;
  remrssi: number | null;
}

/**
 * The link to the active vehicle: % of its packets received (and lost) over the last few seconds, plus a telemetry
 * radio's signal when one reports it. Bindable as the pseudo-message LINK (quality, loss, received, lost, rssi,
 * remrssi).
 */
export function getLinkStats(now = Date.now()): LinkStats {
  const radio = latest.get('RADIO_STATUS')?.fields;
  const sig = (v: number | undefined) => (v === undefined || v === 255 ? null : v);
  return { ...linkMeter.snapshot(now), rssi: sig(radio?.rssi), remrssi: sig(radio?.remrssi) };
}

/** When the message last arrived from the vehicle (ms epoch), or undefined if never. */
export function getLastSeen(messageName: string): number | undefined {
  return lastSeen.get(baseMessageName(messageName));
}

/** Every message received so far with its numeric fields, sorted, for the widget creator's field picker. */
export function getObservedCatalog(): Record<string, string[]> {
  const catalog: Record<string, string[]> = {};
  for (const [name, entry] of latest) {
    catalog[name] = Object.keys(entry.fields).sort();
  }
  if (lastSeen.has('LINK')) catalog.LINK = ['loss', 'lost', 'quality', 'received', 'remrssi', 'rssi'];
  return catalog;
}

/**
 * Everything received dropped. `keepLinkHistory`: the two-minute link-quality history stays (a dropped link coming
 * back: its dropout is what the chart is for).
 */
export function resetMessageCache(opts: { keepLinkHistory?: boolean } = {}): void {
  latest.clear();
  lastSeen.clear();
  vehicleSystemId = undefined;
  vehicleType = undefined;
  linkMeter.reset();
  if (!opts.keepLinkHistory) linkHistory.length = 0;
}

mavlinkConnection.onPacket((packet) => recordPacket(packet));
// Another vehicle now active: its values start over (vehicleSystemId follows its next heartbeat).
onActiveVehicleChange(() => resetMessageCache());

// A new connection starts with an empty cache: the previous connection's values (possibly another vehicle's) would
// otherwise stay bound until each message arrived again. While a link is down the last values stay, shown as stale
// by their age. A dropped link that reconnects by itself keeps the link-quality history (the dropout stays on the
// chart); after a deliberate Disconnect it starts over.
let lastStatus: string | null = null;
let droppedManually = true;
mavlinkConnection.onStatus((status) => {
  if (status === 'disconnected') droppedManually = mavlinkConnection.isManualDisconnect;
  if (status === 'connected' && lastStatus !== null && lastStatus !== 'connected')
    resetMessageCache({ keepLinkHistory: !droppedManually });
  lastStatus = status;
});
