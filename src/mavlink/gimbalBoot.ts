// Gimbal state in: reads MNT1_TYPE / MNT2_TYPE when a vehicle is heard; once a gimbal is enabled, asks for its
// attitude and manager status, and once for its capabilities (GIMBAL_MANAGER_INFORMATION); decodes them into the
// gimbal store. Imported once at startup.

import { mavlinkConnection } from './connection';
import { decodePayload } from './parser';
import { MAVLINK_MSG_ID } from './messages';
import { messageRateManager } from './rateManager';
import { paramManager } from './paramManager';
import { GIMBAL_FLAGS } from './gimbal';
import { useGimbalStore } from '../store/gimbalStore';
import { useTelemetryStore } from '../store/telemetryStore';

const fromVehicle = (sysId: number) => sysId === useTelemetryStore.getState().heartbeat.systemId;

mavlinkConnection.onPacket((p) => {
  if (p.messageId !== MAVLINK_MSG_ID.GIMBAL_DEVICE_ATTITUDE_STATUS && p.messageId !== MAVLINK_MSG_ID.GIMBAL_MANAGER_INFORMATION && p.messageId !== MAVLINK_MSG_ID.GIMBAL_MANAGER_STATUS) return;
  if (!fromVehicle(p.systemId)) return;
  const d = decodePayload(p.messageId, p.payload);
  const g = useGimbalStore.getState();
  // The first gimbal (lowest device id) is the one controlled; a second one's reports are ignored.
  const own = (id: number) => !g.info || id === g.info.deviceId;
  if (p.messageId === MAVLINK_MSG_ID.GIMBAL_MANAGER_INFORMATION) {
    if (g.info && d.gimbal_device_id > g.info.deviceId) return;
    g.set({ info: { deviceId: d.gimbal_device_id, capFlags: d.cap_flags, pitchMin: d.pitch_min, pitchMax: d.pitch_max, yawMin: d.yaw_min, yawMax: d.yaw_max } });
  } else if (p.messageId === MAVLINK_MSG_ID.GIMBAL_MANAGER_STATUS) {
    if (own(d.gimbal_device_id)) g.set({ yawLock: (d.flags & GIMBAL_FLAGS.YAW_LOCK) !== 0 });
  } else if (own(d.gimbal_device_id || p.componentId)) {
    if (!Number.isFinite(d.pitch) || !Number.isFinite(d.yaw)) return;
    g.set({ attitude: { pitch: d.pitch, yaw: d.yaw, earthFrame: (d.flags & GIMBAL_FLAGS.YAW_IN_EARTH_FRAME) !== 0, at: Date.now() } });
  }
});

// Mount types: read once per vehicle and connection. Only while linked: the telemetry store keeps the last
// vehicle's parameters after a disconnect, which would otherwise bring the gimbal back and use up the read.
let askedFor = 0;
useTelemetryStore.subscribe((s) => {
  if (mavlinkConnection.getStatus() !== 'connected' || s.heartbeat.lastHeartbeatTime <= 0 || s.heartbeat.modeName === 'DISCONNECTED') return;
  const sys = s.heartbeat.systemId;
  const types = [s.parameters['MNT1_TYPE']?.value, s.parameters['MNT2_TYPE']?.value];
  const g = useGimbalStore.getState();
  if (types[0] !== g.mountTypes[0] || types[1] !== g.mountTypes[1]) g.set({ mountTypes: types });
  if (sys > 0 && sys !== askedFor) {
    askedFor = sys;
    paramManager.requestParam(sys, s.heartbeat.componentId || 1, 'MNT1_TYPE');
    paramManager.requestParam(sys, s.heartbeat.componentId || 1, 'MNT2_TYPE');
  }
});

// Once a gimbal is enabled: its attitude and status at a rate, its capabilities once (asked again until they come,
// up to INFO_TRIES times per connection: older firmware may never answer).
const INFO_TRIES = 5;
let infoAsked = 0;
let streaming = false;
setInterval(() => {
  const g = useGimbalStore.getState();
  const enabled = g.mountTypes.some((t) => t !== undefined && t > 0);
  if (enabled !== streaming) {
    streaming = enabled;
    if (enabled) {
      messageRateManager.registerRequirement('gimbal', MAVLINK_MSG_ID.GIMBAL_DEVICE_ATTITUDE_STATUS);
      messageRateManager.registerRequirement('gimbal', MAVLINK_MSG_ID.GIMBAL_MANAGER_STATUS);
    } else {
      messageRateManager.unregisterRequirement('gimbal');
    }
  }
  const hb = useTelemetryStore.getState().heartbeat;
  if (enabled && !g.info && infoAsked < INFO_TRIES && hb.systemId > 0 && mavlinkConnection.getStatus() === 'connected') {
    infoAsked++;
    mavlinkConnection.send(mavlinkConnection.getEncoder().createRequestMessage(hb.systemId, hb.componentId || 1, MAVLINK_MSG_ID.GIMBAL_MANAGER_INFORMATION));
  }
}, 3000);

// A new link or vehicle: forget the old gimbal.
mavlinkConnection.onStatus((status) => {
  if (status !== 'connected') {
    useGimbalStore.getState().reset();
    askedFor = 0;
    infoAsked = 0;
  }
});
