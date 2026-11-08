// Latest decoded copy of every telemetry message, for custom widget bindings.
//
// The telemetry store keeps curated slices of a fixed set of messages. Custom widgets can bind to any field the
// decoder produces, so this module records the last decoded payload of each message from the vehicle (plus the
// time it arrived, which drives stale-value detection) and lists the numeric fields it has seen, which the widget
// creator offers as bindable fields.

import { mavlinkConnection } from '../mavlink/connection';
import { decodePacket, type MavlinkPacket } from '../mavlink/parser';
import { MAVLINK_MSG_ID } from '../mavlink/messages';
import { pidAxisMessageName } from '../mavlink/pidTuning';
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
    if (autopilot !== MAV_AUTOPILOT_INVALID && type !== MAV_TYPE_GCS && packet.componentId === 1) {
      if (vehicleType !== undefined && vehicleType !== type) {
        pidTuningRecorder.clear();
      }
      vehicleSystemId = packet.systemId;
      vehicleType = type;
    }
  }
  if (SKIPPED.has(packet.messageId)) return;
  const name = NAME_BY_ID.get(packet.messageId);
  if (!name) return;
  if (
    vehicleSystemId !== undefined &&
    packet.systemId !== vehicleSystemId &&
    !ANY_SOURCE.has(packet.messageId)
  ) {
    return;
  }
  // Only the autopilot's own heartbeat (not a gimbal's or companion's on the same system) describes the vehicle.
  if (
    packet.messageId === MAVLINK_MSG_ID.HEARTBEAT &&
    (packet.systemId !== vehicleSystemId || packet.componentId !== 1)
  ) {
    return;
  }

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
  latest.set(name, { fields, time: now, systemId: packet.systemId });
}

/** Strip the "(scaled)" display suffix used by the RC / servo pseudo-messages. */
export function baseMessageName(messageName: string): string {
  return messageName.replace(/\s*\(scaled\)\s*$/i, '').trim().toUpperCase();
}

function getCachedMessage(messageName: string): CachedMessage | undefined {
  return latest.get(baseMessageName(messageName));
}

export function getCachedField(messageName: string, fieldName: string): number | undefined {
  return getCachedMessage(messageName)?.fields[fieldName];
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
  return catalog;
}

export function resetMessageCache(): void {
  latest.clear();
  lastSeen.clear();
  vehicleSystemId = undefined;
  vehicleType = undefined;
}

mavlinkConnection.onPacket((packet) => recordPacket(packet));
