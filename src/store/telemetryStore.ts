import { create } from 'zustand';
import { MAVLINK_MSG_ID, getVehicleModeName, extractFirmwareVersion } from '../mavlink/messages';
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

  // Actions
  processPacket: (packet: MavlinkPacket) => void;
  clearMessages: () => void;
  addTracePoint: (lat: number, lon: number) => void;
  clearTrace: () => void;
}

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
    type: 2,
    autopilot: 3,
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
    const data = decodePayload(packet.messageId, packet.payload);

    set((state) => {
      const now = Date.now();

      switch (packet.messageId) {
        case MAVLINK_MSG_ID.HEARTBEAT: {
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
          return {
            position: {
              lat: data.lat,
              lon: data.lon,
              alt: data.alt,
              relativeAlt: data.relative_alt,
              vx: data.vx,
              vy: data.vy,
              vz: data.vz,
              hdg: data.hdg,
            },
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

        default:
          return {};
      }
    });
  },
}));

// Wire up global packet listener
mavlinkConnection.onPacket((packet) => {
  useTelemetryStore.getState().processPacket(packet);
});

// Auto-persist waypoints, fences, and rally points across page reloads
let lastNavSavedJson = '';
useTelemetryStore.subscribe((state) => {
  const currentNav = {
    missionWaypoints: state.missionWaypoints,
    fencePoints: state.fencePoints,
    rallyPoints: state.rallyPoints,
  };
  const json = JSON.stringify(currentNav);
  if (json !== lastNavSavedJson) {
    lastNavSavedJson = json;
    saveNavCache(currentNav);
  }
});
