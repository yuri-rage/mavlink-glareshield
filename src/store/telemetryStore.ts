import { create } from 'zustand';
import { MAVLINK_MSG_ID, getVehicleModeName, extractFirmwareVersion, isVehicleAutopilotHeartbeat, getMavCmdName, MAV_CMD } from '../mavlink/messages';
import { decodePayload, MavlinkPacket } from '../mavlink/parser';
import { mavlinkConnection } from '../mavlink/connection';
import { messageRateManager } from '../mavlink/rateManager';

export interface VehicleHeartbeat {
  type: number;
  autopilot: number;
  baseMode: number;
  customMode: number;
  modeName: string;
  isArmed: boolean;
  systemStatus: number;
  lastHeartbeatTime: number;
  systemId: number;
  componentId: number;
}

export interface VehicleAttitude {
  roll: number; // rad
  pitch: number; // rad
  yaw: number; // rad
  rollDeg: number;
  pitchDeg: number;
  yawDeg: number;
  rollSpeed: number;
  pitchSpeed: number;
  yawSpeed: number;
}

export interface VehicleIMU {
  xacc: number;
  yacc: number;
  zacc: number;
  nz: number; // Normal load factor in G
}

export interface VehiclePosition {
  timeBootMs: number;
  lat: number;
  lon: number;
  alt: number; // m MSL
  relativeAlt: number; // m AGL
  vx: number;
  vy: number;
  vz: number;
  hdg: number;
}

export interface VehicleGPS {
  fixType: number; // 0=No, 2=2D, 3=3D, 4=DGPS, 5=RTK Float, 6=RTK Fixed
  fixLabel: string;
  satellites: number;
  hdop: number;
  vdop: number;
  groundspeed: number;
  cog: number;
}

export interface VehicleBattery {
  voltage: number;
  current: number;
  remaining: number; // %
  consumedMah: number;
  cellVoltages: number[];
}

export interface VehicleVFR {
  airspeed: number;
  groundspeed: number;
  heading: number;
  throttle: number;
  alt: number;
  climb: number;
}

export interface StatusMessage {
  id: string;
  time: string;
  severity: number;
  severityLabel: string;
  text: string;
}

export interface MissionWaypoint {
  seq: number;
  command: number;
  lat: number;
  lon: number;
  alt: number;
  current: boolean;
  frame?: number;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
}

export interface FencePoint {
  seq: number;
  command: number;
  lat: number;
  lon: number;
  alt?: number;
  param1?: number;
  vertexCount?: number;
  radius?: number;
  inclusion?: boolean;
}

export interface RallyPoint {
  seq: number;
  lat: number;
  lon: number;
  alt: number;
}

export interface TelemetryHistoryPoint {
  time: number;
  altitude: number;
  groundspeed: number;
  batteryCurrent: number;
  climb: number;
}

export interface CommandAckInfo {
  command: number;
  result: number;
  resultText: string;
  time: number;
}

interface TelemetryState {
  heartbeat: VehicleHeartbeat;
  attitude: VehicleAttitude;
  imu: VehicleIMU;
  position: VehiclePosition;
  gps: VehicleGPS;
  battery: VehicleBattery;
  vfr: VehicleVFR;
  statusMessages: StatusMessage[];
  firmwareVersion: string | null;
  firmwareRaw?: string;
  parameters: Record<string, { value: number; type: number; index: number; defaultValue?: number }>;
  missionWaypoints: MissionWaypoint[];
  currentWaypointSeq: number;
  fencePoints: FencePoint[];
  rallyPoints: RallyPoint[];
  flightTrace: [number, number][];
  history: TelemetryHistoryPoint[];
  lastCommandAck?: CommandAckInfo;

  // Actions
  processPacket: (packet: MavlinkPacket) => void;
  clearMessages: () => void;
  addTracePoint: (lat: number, lon: number) => void;
  clearTrace: () => void;
}

const COMMAND_ACK_RESULTS: Record<number, string> = {
  0: 'ACCEPTED',
  1: 'TEMPORARILY_REJECTED',
  2: 'DENIED',
  3: 'UNSUPPORTED',
  4: 'FAILED',
  5: 'IN_PROGRESS',
  6: 'CANCELLED',
  7: 'COMMAND_LONG_ONLY',
  8: 'COMMAND_INT_ONLY',
  9: 'COMMAND_UNSUPPORTED_MAV_FRAME',
};

const HANDLED_MESSAGE_IDS = new Set<number>([
  MAVLINK_MSG_ID.HEARTBEAT,
  MAVLINK_MSG_ID.ATTITUDE,
  MAVLINK_MSG_ID.RAW_IMU,
  MAVLINK_MSG_ID.SCALED_IMU,
  MAVLINK_MSG_ID.HIGHRES_IMU,
  MAVLINK_MSG_ID.GLOBAL_POSITION_INT,
  MAVLINK_MSG_ID.GPS_RAW_INT,
  MAVLINK_MSG_ID.SYS_STATUS,
  MAVLINK_MSG_ID.BATTERY_STATUS,
  MAVLINK_MSG_ID.VFR_HUD,
  MAVLINK_MSG_ID.AUTOPILOT_VERSION,
  MAVLINK_MSG_ID.STATUSTEXT,
  MAVLINK_MSG_ID.PARAM_VALUE,
  MAVLINK_MSG_ID.MISSION_ITEM,
  MAVLINK_MSG_ID.MISSION_ITEM_INT,
  MAVLINK_MSG_ID.MISSION_CURRENT,
  MAVLINK_MSG_ID.COMMAND_ACK,
]);

const SEVERITY_LABELS: Record<number, string> = {
  0: 'EMERGENCY',
  1: 'ALERT',
  2: 'CRITICAL',
  3: 'ERROR',
  4: 'WARNING',
  5: 'NOTICE',
  6: 'INFO',
  7: 'DEBUG',
};

const GPS_FIX_LABELS: Record<number, string> = {
  0: 'No GPS',
  1: 'No Fix',
  2: '2D Fix',
  3: '3D Fix',
  4: 'DGPS Fix',
  5: 'RTK Float',
  6: 'RTK Fixed',
};

function resolveModeName(type: number, customMode: number): string {
  return getVehicleModeName(type, customMode);
}

const STORAGE_KEY_NAV = 'mavlink_glareshield_nav_cache';

interface NavCache {
  missionWaypoints?: MissionWaypoint[];
  fencePoints?: FencePoint[];
  rallyPoints?: RallyPoint[];
}

function loadInitialNavCache(): NavCache {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY_NAV);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    console.warn('Failed to load nav cache:', e);
  }
  return {};
}

function saveNavCache(cache: NavCache) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_NAV, JSON.stringify(cache));
    }
  } catch (e) {
    console.warn('Failed to save nav cache:', e);
  }
}

const initialNav = loadInitialNavCache();

export const useTelemetryStore = create<TelemetryState>((set) => ({
  heartbeat: {
    type: 0,
    autopilot: 0,
    baseMode: 0,
    customMode: 0,
    modeName: 'DISCONNECTED',
    isArmed: false,
    systemStatus: 0,
    lastHeartbeatTime: 0,
    systemId: 1,
    componentId: 1,
  },
  attitude: {
    roll: 0,
    pitch: 0,
    yaw: 0,
    rollDeg: 0,
    pitchDeg: 0,
    yawDeg: 0,
    rollSpeed: 0,
    pitchSpeed: 0,
    yawSpeed: 0,
  },
  imu: {
    xacc: 0,
    yacc: 0,
    zacc: -1000,
    nz: 1.0,
  },
  position: {
    timeBootMs: 0,
    lat: 0,
    lon: 0,
    alt: 0,
    relativeAlt: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hdg: 0,
  },
  gps: {
    fixType: 0,
    fixLabel: 'No GPS',
    satellites: 0,
    hdop: 99.9,
    vdop: 99.9,
    groundspeed: 0,
    cog: 0,
  },
  battery: {
    voltage: 0,
    current: 0,
    remaining: 0,
    consumedMah: 0,
    cellVoltages: [],
  },
  vfr: {
    airspeed: 0,
    groundspeed: 0,
    heading: 0,
    throttle: 0,
    alt: 0,
    climb: 0,
  },
  statusMessages: [],
  firmwareVersion: null,
  firmwareRaw: undefined,
  parameters: {},
  missionWaypoints: initialNav.missionWaypoints ?? [],
  currentWaypointSeq: 0,
  fencePoints: initialNav.fencePoints ?? [],
  rallyPoints: initialNav.rallyPoints ?? [],
  flightTrace: [],
  history: [],

  clearMessages: () => set({ statusMessages: [] }),

  addTracePoint: (lat: number, lon: number) => {
    if (lat === 0 && lon === 0) return;
    set((state) => {
      const trace = state.flightTrace;
      if (trace.length > 0) {
        const last = trace[trace.length - 1];
        const dLat = Math.abs(last[0] - lat);
        const dLon = Math.abs(last[1] - lon);
        if (dLat < 0.00001 && dLon < 0.00001) {
          return state;
        }
      }
      const updated =
        trace.length >= 5000
          ? [...trace.slice(trace.length - 4999), [lat, lon] as [number, number]]
          : [...trace, [lat, lon] as [number, number]];
      return { flightTrace: updated };
    });
  },

  clearTrace: () => set({ flightTrace: [] }),

  processPacket: (packet: MavlinkPacket) => {
    // Early filter: skip unhandled packets to avoid unnecessary subscriber notifications
    if (!HANDLED_MESSAGE_IDS.has(packet.messageId)) {
      return;
    }

    const data = decodePayload(packet.messageId, packet.payload);

    set((state) => {
      const now = Date.now();

      // Autopilot lock-on and multi-system filtering
      if (packet.messageId === MAVLINK_MSG_ID.HEARTBEAT) {
        // Only accept heartbeats from true vehicle autopilots (reject GCS, tracker, gimbal, companion)
        if (!isVehicleAutopilotHeartbeat(data.type, data.autopilot, packet.componentId)) {
          return state;
        }

        // If locked to a vehicle and it was heard from recently (< 10s), reject other vehicles
        if (state.heartbeat.lastHeartbeatTime > 0 && state.heartbeat.systemId !== packet.systemId) {
          if (now - state.heartbeat.lastHeartbeatTime < 10000) {
            return state;
          }
        }

        const isArmed = (data.base_mode & 0x80) !== 0;
        const modeName = resolveModeName(data.type, data.custom_mode);
        messageRateManager.setTarget(packet.systemId, packet.componentId);
        return {
          heartbeat: {
            type: data.type,
            autopilot: data.autopilot,
            baseMode: data.base_mode,
            customMode: data.custom_mode,
            modeName,
            isArmed,
            systemStatus: data.system_status,
            lastHeartbeatTime: now,
            systemId: packet.systemId,
            componentId: packet.componentId,
          },
        };
      }

      // For all other messages, if we are locked to a vehicle, reject packets from other systems
      if (state.heartbeat.lastHeartbeatTime > 0 && packet.systemId !== state.heartbeat.systemId) {
        return state;
      }

      switch (packet.messageId) {

        case MAVLINK_MSG_ID.ATTITUDE: {
          const rollDeg = (data.roll * 180) / Math.PI;
          const pitchDeg = (data.pitch * 180) / Math.PI;
          let yawDeg = (data.yaw * 180) / Math.PI;
          if (yawDeg < 0) yawDeg += 360;

          return {
            attitude: {
              roll: data.roll,
              pitch: data.pitch,
              yaw: data.yaw,
              rollDeg,
              pitchDeg,
              yawDeg,
              rollSpeed: data.rollspeed,
              pitchSpeed: data.pitchspeed,
              yawSpeed: data.yawspeed,
            },
          };
        }

        case MAVLINK_MSG_ID.RAW_IMU:
        case MAVLINK_MSG_ID.SCALED_IMU:
        case MAVLINK_MSG_ID.HIGHRES_IMU: {
          return {
            imu: {
              xacc: data.xacc,
              yacc: data.yacc,
              zacc: data.zacc,
              nz: data.nz,
            },
          };
        }

        case MAVLINK_MSG_ID.GLOBAL_POSITION_INT: {
          let updatedTrace = state.flightTrace;
          if (data.lat !== 0 || data.lon !== 0) {
            const trace = state.flightTrace;
            let shouldAdd = true;
            if (trace.length > 0) {
              const last = trace[trace.length - 1];
              const dLat = Math.abs(last[0] - data.lat);
              const dLon = Math.abs(last[1] - data.lon);
              // ~1.5 meters movement threshold
              if (dLat < 0.000015 && dLon < 0.000015) {
                shouldAdd = false;
              }
            }
            if (shouldAdd) {
              updatedTrace =
                trace.length >= 5000
                  ? [...trace.slice(trace.length - 4999), [data.lat, data.lon] as [number, number]]
                  : [...trace, [data.lat, data.lon] as [number, number]];
            }
          }

          return {
            position: {
              timeBootMs: data.time_boot_ms ?? 0,
              lat: data.lat,
              lon: data.lon,
              alt: data.alt,
              relativeAlt: data.relative_alt,
              vx: data.vx,
              vy: data.vy,
              vz: data.vz,
              hdg: data.rawHdg === 65535 ? 65535 : data.hdg,
            },
            ...(updatedTrace !== state.flightTrace ? { flightTrace: updatedTrace } : {}),
          };
        }

        case MAVLINK_MSG_ID.GPS_RAW_INT: {
          return {
            gps: {
              fixType: data.fix_type,
              fixLabel: GPS_FIX_LABELS[data.fix_type] ?? `Fix ${data.fix_type}`,
              satellites: data.satellites_visible,
              hdop: data.eph,
              vdop: data.epv,
              groundspeed: data.vel,
              cog: data.cog,
            },
          };
        }

        case MAVLINK_MSG_ID.SYS_STATUS: {
          return {
            battery: {
              ...state.battery,
              voltage: data.voltage_battery > 0 ? data.voltage_battery : state.battery.voltage,
              current: data.current_battery !== undefined ? data.current_battery : state.battery.current,
              remaining: data.battery_remaining >= 0 ? data.battery_remaining : state.battery.remaining,
            },
          };
        }

        case MAVLINK_MSG_ID.BATTERY_STATUS: {
          const sumCellVoltage = data.voltages && data.voltages.length > 0
            ? data.voltages.reduce((a: number, b: number) => a + b, 0)
            : 0;
          return {
            battery: {
              ...state.battery,
              voltage: state.battery.voltage > 0 ? state.battery.voltage : (sumCellVoltage > 0 ? sumCellVoltage : state.battery.voltage),
              current: data.current_battery !== undefined ? data.current_battery : state.battery.current,
              consumedMah: data.current_consumed !== undefined ? data.current_consumed : state.battery.consumedMah,
              remaining: data.battery_remaining >= 0 ? data.battery_remaining : state.battery.remaining,
              cellVoltages: data.voltages && data.voltages.length > 0 ? data.voltages : state.battery.cellVoltages,
            },
          };
        }

        case MAVLINK_MSG_ID.VFR_HUD: {
          // Append history sample at ~1Hz
          const lastPoint = state.history[state.history.length - 1];
          let updatedHistory = state.history;
          if (!lastPoint || now - lastPoint.time >= 1000) {
            const newPoint: TelemetryHistoryPoint = {
              time: now,
              altitude: Number(data.alt.toFixed(1)),
              groundspeed: Number(data.groundspeed.toFixed(1)),
              batteryCurrent: Number(state.battery.current.toFixed(1)),
              climb: Number(data.climb.toFixed(1)),
            };
            // Keep last 60 samples
            updatedHistory = [...state.history.slice(-59), newPoint];
          }

          return {
            vfr: {
              airspeed: data.airspeed,
              groundspeed: data.groundspeed,
              heading: data.heading,
              throttle: data.throttle,
              alt: data.alt,
              climb: data.climb,
            },
            history: updatedHistory,
          };
        }

        case MAVLINK_MSG_ID.AUTOPILOT_VERSION: {
          return {
            firmwareVersion: data.versionStr || state.firmwareVersion,
            firmwareRaw: data.versionStr ? `v${data.versionStr}` : state.firmwareRaw,
          };
        }

        case MAVLINK_MSG_ID.STATUSTEXT: {
          const msg: StatusMessage = {
            id: `${now}-${Math.random()}`,
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            severity: data.severity,
            severityLabel: SEVERITY_LABELS[data.severity] ?? `SEV_${data.severity}`,
            text: data.text,
          };
          const version = extractFirmwareVersion(data.text);
          return {
            statusMessages: [msg, ...state.statusMessages.slice(0, 99)],
            ...(version ? { firmwareVersion: version, firmwareRaw: data.text } : {}),
          };
        }

        case MAVLINK_MSG_ID.PARAM_VALUE: {
          const prev = state.parameters[data.param_id];
          return {
            parameters: {
              ...state.parameters,
              [data.param_id]: {
                value: data.param_value,
                type: data.param_type,
                index: data.param_index,
                defaultValue: prev?.defaultValue,
              },
            },
          };
        }

        case MAVLINK_MSG_ID.MISSION_ITEM:
        case MAVLINK_MSG_ID.MISSION_ITEM_INT: {
          const missionType = data.mission_type ?? 0;

          if (missionType === 1) {
            // Geofence item (MAV_MISSION_TYPE_FENCE)
            const isCircle = data.command === 5004 || data.command === 5005 || (data.command === 5003 && data.param1 > 0);
            const isInclusion = data.command === 5001 || data.command === 5005 || (data.command === 5003 && data.param1 > 0);
            const fp: FencePoint = {
              seq: data.seq,
              command: data.command,
              lat: data.x,
              lon: data.y,
              alt: data.z,
              param1: data.param1,
              radius: isCircle ? data.param1 : undefined,
              vertexCount: !isCircle ? Math.round(data.param1) : undefined,
              inclusion: isInclusion,
            };
            const existingIdx = state.fencePoints.findIndex((f) => f.seq === data.seq);
            const updated = [...state.fencePoints];
            if (existingIdx >= 0) updated[existingIdx] = fp;
            else updated.push(fp);
            updated.sort((a, b) => a.seq - b.seq);
            return { fencePoints: updated };
          }

          if (missionType === 2) {
            // Rally point (MAV_MISSION_TYPE_RALLY)
            const rp: RallyPoint = {
              seq: data.seq,
              lat: data.x,
              lon: data.y,
              alt: data.z,
            };
            const existingIdx = state.rallyPoints.findIndex((r) => r.seq === data.seq);
            const updated = [...state.rallyPoints];
            if (existingIdx >= 0) updated[existingIdx] = rp;
            else updated.push(rp);
            updated.sort((a, b) => a.seq - b.seq);
            return { rallyPoints: updated };
          }

          // Only missionType === 0 (MAV_MISSION_TYPE_MISSION) updates mission waypoints
          const existingIdx = state.missionWaypoints.findIndex((w) => w.seq === data.seq);
          const isCurrent = data.current === 1;
          const wp: MissionWaypoint = {
            seq: data.seq,
            command: data.command,
            lat: data.x,
            lon: data.y,
            alt: data.z,
            current: isCurrent,
            frame: data.frame,
            param1: data.param1,
            param2: data.param2,
            param3: data.param3,
            param4: data.param4,
          };
          const updatedWps = [...state.missionWaypoints];
          if (existingIdx >= 0) {
            updatedWps[existingIdx] = wp;
          } else {
            updatedWps.push(wp);
            updatedWps.sort((a, b) => a.seq - b.seq);
          }
          return {
            missionWaypoints: updatedWps,
            ...(isCurrent ? { currentWaypointSeq: data.seq } : {}),
          };
        }

        case MAVLINK_MSG_ID.MISSION_CURRENT: {
          return {
            currentWaypointSeq: data.seq,
            missionWaypoints: state.missionWaypoints.map((w) => ({
              ...w,
              current: w.seq === data.seq,
            })),
          };
        }

        case MAVLINK_MSG_ID.COMMAND_ACK: {
          const pending = pendingCommands.get(data.command);
          if (pending) {
            clearTimeout(pending.timer);
            pendingCommands.delete(data.command);
          }
          const cmdName = getMavCmdName(data.command);
          const resultText = COMMAND_ACK_RESULTS[data.result] ?? `CODE_${data.result}`;
          const isError = data.result !== 0 && data.result !== 5; // not ACCEPTED or IN_PROGRESS
          const ackMsg: StatusMessage | null = isError ? {
            id: `${now}-${Math.random()}`,
            time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
            severity: data.result === 1 ? 4 : 3, // WARNING or ERROR
            severityLabel: data.result === 1 ? 'WARNING' : 'ERROR',
            text: `CMD ${cmdName}: ${resultText}${data.result_param2 ? ` (${data.result_param2})` : ''}`,
          } : null;

          return {
            lastCommandAck: {
              command: data.command,
              result: data.result,
              resultText,
              time: now,
            },
            ...(ackMsg ? { statusMessages: [ackMsg, ...state.statusMessages.slice(0, 99)] } : {}),
          };
        }

        default:
          return state;
      }
    });
  },
}));

// Wire up global packet listener
mavlinkConnection.onPacket((packet) => {
  useTelemetryStore.getState().processPacket(packet);
});

// Reset vehicle heartbeat state when disconnected
mavlinkConnection.onStatus((status) => {
  if (status === 'disconnected') {
    useTelemetryStore.setState((state) => ({
      heartbeat: {
        ...state.heartbeat,
        type: 0,
        autopilot: 0,
        modeName: 'DISCONNECTED',
        isArmed: false,
        lastHeartbeatTime: 0,
      },
    }));
  }
});

// Automatic command timeout tracking (5s timeout for commands missing COMMAND_ACK)
interface PendingCommand {
  commandId: number;
  cmdName: string;
  sentAt: number;
  timer: any;
}
const pendingCommands = new Map<number, PendingCommand>();

mavlinkConnection.onSend((data) => {
  if (data.length >= 40 && data[0] === 0xFD) {
    const msgId = data[7] | (data[8] << 8) | (data[9] << 16);
    if (msgId === MAVLINK_MSG_ID.COMMAND_LONG || msgId === MAVLINK_MSG_ID.COMMAND_INT) {
      const cmdId = data[38] | (data[39] << 8);
      const cmdName = getMavCmdName(cmdId);
      const existing = pendingCommands.get(cmdId);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        pendingCommands.delete(cmdId);
        const now = Date.now();
        const isHousekeeping =
          cmdId === MAV_CMD.SET_MESSAGE_INTERVAL ||
          cmdId === MAV_CMD.REQUEST_MESSAGE ||
          cmdId === MAV_CMD.REQUEST_AUTOPILOT_CAPABILITIES;
        const timeoutMsg: StatusMessage = {
          id: `${now}-${Math.random()}`,
          time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
          severity: isHousekeeping ? 6 : 4, // INFO for background housekeeping, WARNING for user commands
          severityLabel: isHousekeeping ? 'INFO' : 'WARNING',
          text: `CMD ${cmdName}: NO ACK (TIMEOUT)`,
        };
        useTelemetryStore.setState((s) => ({
          lastCommandAck: {
            command: cmdId,
            result: -1,
            resultText: 'TIMEOUT',
            time: now,
          },
          statusMessages: [timeoutMsg, ...s.statusMessages.slice(0, 99)],
        }));
      }, 5000);

      pendingCommands.set(cmdId, {
        commandId: cmdId,
        cmdName,
        sentAt: Date.now(),
        timer,
      });
    }
  }
});

// Auto-persist waypoints, fences, and rally points across page reloads
let lastWps: MissionWaypoint[] | null = null;
let lastFp: FencePoint[] | null = null;
let lastRp: RallyPoint[] | null = null;

useTelemetryStore.subscribe((state) => {
  if (state.missionWaypoints === lastWps && state.fencePoints === lastFp && state.rallyPoints === lastRp) {
    return;
  }
  lastWps = state.missionWaypoints;
  lastFp = state.fencePoints;
  lastRp = state.rallyPoints;

  const currentNav = {
    missionWaypoints: state.missionWaypoints,
    fencePoints: state.fencePoints,
    rallyPoints: state.rallyPoints,
  };
  saveNavCache(currentNav);
});
