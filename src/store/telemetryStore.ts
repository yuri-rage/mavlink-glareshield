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
  yaw?: number;
  hasYaw?: boolean;
  lastUpdate?: number;
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

export interface VehicleSysStatus {
  load: number; // %
  dropRateComm: number;
  errorsComm: number;
  sensorsPresent: number;
  sensorsEnabled: number;
  sensorsHealth: number;
}

export interface VehicleRC {
  chancount: number;
  rssi: number;
  channels: number[]; // up to 18 channels (PWM us)
}

export interface VehicleServo {
  port: number;
  ports: Record<number, number[]>;
  servos: number[]; // up to 32 servo outputs (PWM us)
}

export interface VehicleNavController {
  navRoll: number;
  navPitch: number;
  navBearing: number;
  targetBearing: number;
  wpDist: number;
  altError: number;
  aspdError: number;
  xtrackError: number;
}

export interface VehicleWind {
  direction: number; // deg
  speed: number; // m/s
  speedZ: number; // m/s
}

export interface VehicleVibration {
  vibrationX: number;
  vibrationY: number;
  vibrationZ: number;
  clipping0: number;
  clipping1: number;
  clipping2: number;
}

export interface VehicleEKF {
  flags: number;
  velocityVariance: number;
  posHorizVariance: number;
  posVertVariance: number;
  compassVariance: number;
  terrainAltVariance: number;
  airspeedVariance: number;
}

export interface VehicleRangefinder {
  distance: number; // m
  voltage: number; // V
  minDistance: number; // m
  maxDistance: number; // m
  signalQuality: number;
}

export interface VehicleRPM {
  rpm1: number;
  rpm2: number;
}

export interface VehicleESC {
  voltage: number[]; // V (4 ESCs)
  current: number[]; // A (4 ESCs)
  totalCurrent: number[]; // mAh (4 ESCs)
  rpm: number[]; // RPM (4 ESCs)
  temperature: number[]; // degC (4 ESCs)
}

export interface VehiclePower {
  vcc: number; // V
  vservo: number; // V
  flags: number;
}

export interface VehiclePressure {
  pressAbs: number; // hPa
  pressDiff: number; // hPa
  temperature: number; // degC
}

export interface StatusMessage {
  id: string;
  time: string;
  timestamp?: number;
  severity: number;
  severityLabel: string;
  text: string;
  count?: number;
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

export interface CommandAckInfo {
  command: number;
  result: number;
  resultText: string;
  reason?: string;
  time: number;
}

export interface CommandFeedbackInfo {
  id: number;
  command: number;
  cmdName: string;
  label: string;
  targetKey?: string;
  status: 'pending' | 'accepted' | 'denied' | 'timeout' | 'failed';
  result?: number;
  resultText?: string;
  reason?: string;
  time: number;
}

export interface HomePositionInfo {
  lat: number;
  lon: number;
  alt: number;
  distanceM: number | null;
  bearingDeg: number | null;
  source: 'home_msg' | 'wp0' | 'arm_pos' | 'none';
}

export interface RadioStatusInfo {
  rssi: number;
  remrssi: number;
  txbuf: number;
  noise: number;
  remnoise: number;
  rxerrors: number;
  fixed: number;
}

export interface BaseStationPosition {
  lat: number;
  lon: number;
  alt?: number;
}

interface TelemetryState {
  heartbeat: VehicleHeartbeat;
  attitude: VehicleAttitude;
  imu: VehicleIMU;
  position: VehiclePosition;
  gps: VehicleGPS;
  gps2: VehicleGPS | null;
  battery: VehicleBattery;
  vfr: VehicleVFR;
  sysStatus: VehicleSysStatus;
  rc: VehicleRC;
  servo: VehicleServo;
  navController: VehicleNavController;
  wind: VehicleWind;
  vibration: VehicleVibration;
  ekf: VehicleEKF;
  rangefinder: VehicleRangefinder;
  rpm: VehicleRPM;
  esc: VehicleESC;
  power: VehiclePower;
  pressure: VehiclePressure;
  radioStatus: RadioStatusInfo;
  homePosition: HomePositionInfo;
  statusMessages: StatusMessage[];
  firmwareVersion: string | null;
  firmwareRaw?: string;
  parameters: Record<string, { value: number; type: number; index: number; defaultValue?: number }>;
  missionWaypoints: MissionWaypoint[];
  currentWaypointSeq: number;
  lastReachedWaypointSeq: number;
  /** When the last MISSION_ITEM_REACHED arrived (ms epoch), so reaching the same waypoint again is still an event. */
  lastReachedAt: number;
  /** True once the autopilot has sent any MISSION_ITEM_REACHED (it reports arrivals itself). */
  missionItemReachedSeen: boolean;
  /** The last waypoint change requested from this GCS (Next / Go / Restart), so it is not mistaken for an arrival. */
  manualWaypointJump: { seq: number; time: number } | null;
  fencePoints: FencePoint[];
  rallyPoints: RallyPoint[];
  flightTrace: [number, number][];
  lastCommandAck?: CommandAckInfo;
  commandFeedback?: CommandFeedbackInfo;
  baseStationPosition: BaseStationPosition | null;
  hasConnectedInSession: boolean;
  armedStartedAt: number | null;
  accumulatedArmedMs: number;

  // Actions
  processPacket: (packet: MavlinkPacket) => void;
  clearMessages: () => void;
  clearCommandFeedback: () => void;
  addTracePoint: (lat: number, lon: number) => void;
  clearTrace: () => void;
  setBaseStationPosition: (pos: BaseStationPosition | null) => void;
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

/** Spacing between recorded trace points: fine enough to show path-tracking deviations of a few tens of cm. */
export const TRACE_MIN_SPACING_M = 0.25;
/** Points kept in the trace (about 1.4 h at 5 Hz while moving). */
export const TRACE_MAX_POINTS = 25000;

/** Approximate ground distance in metres between two nearby lat/lon points (equirectangular). */
function nearDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const x = (lon2 - lon1) * rad * Math.cos(((lat1 + lat2) / 2) * rad);
  const y = (lat2 - lat1) * rad;
  return Math.hypot(x, y) * 6371000;
}

/** The trace with a new point appended when it is at least TRACE_MIN_SPACING_M from the last one. */
export function appendTracePoint(trace: [number, number][], lat: number, lon: number): [number, number][] {
  if (lat === 0 && lon === 0) return trace;
  if (trace.length > 0) {
    const last = trace[trace.length - 1];
    if (nearDistanceM(last[0], last[1], lat, lon) < TRACE_MIN_SPACING_M) return trace;
  }
  return trace.length >= TRACE_MAX_POINTS
    ? [...trace.slice(trace.length - TRACE_MAX_POINTS + 1), [lat, lon]]
    : [...trace, [lat, lon]];
}

/** Heartbeat gap after which the vehicle counts as re-acquired (rates and home are requested again). */
export const VEHICLE_REACQUIRE_GAP_MS = 5000;
export function isVehicleReacquired(lastHeartbeatTime: number, now: number): boolean {
  return lastHeartbeatTime > 0 && now - lastHeartbeatTime > VEHICLE_REACQUIRE_GAP_MS;
}

const HANDLED_MESSAGE_IDS = new Set<number>([
  MAVLINK_MSG_ID.HEARTBEAT,
  MAVLINK_MSG_ID.ATTITUDE,
  MAVLINK_MSG_ID.RAW_IMU,
  MAVLINK_MSG_ID.SCALED_IMU,
  MAVLINK_MSG_ID.HIGHRES_IMU,
  MAVLINK_MSG_ID.SCALED_PRESSURE,
  MAVLINK_MSG_ID.GLOBAL_POSITION_INT,
  MAVLINK_MSG_ID.GPS_RAW_INT,
  MAVLINK_MSG_ID.GPS2_RAW,
  MAVLINK_MSG_ID.SYS_STATUS,
  MAVLINK_MSG_ID.POWER_STATUS,
  MAVLINK_MSG_ID.BATTERY_STATUS,
  MAVLINK_MSG_ID.VFR_HUD,
  MAVLINK_MSG_ID.RC_CHANNELS,
  MAVLINK_MSG_ID.RC_CHANNELS_RAW,
  MAVLINK_MSG_ID.SERVO_OUTPUT_RAW,
  MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT,
  MAVLINK_MSG_ID.WIND,
  MAVLINK_MSG_ID.RANGEFINDER,
  MAVLINK_MSG_ID.DISTANCE_SENSOR,
  MAVLINK_MSG_ID.EKF_STATUS_REPORT,
  MAVLINK_MSG_ID.RPM,
  MAVLINK_MSG_ID.VIBRATION,
  MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4,
  MAVLINK_MSG_ID.AUTOPILOT_VERSION,
  MAVLINK_MSG_ID.STATUSTEXT,
  MAVLINK_MSG_ID.PARAM_VALUE,
  MAVLINK_MSG_ID.MISSION_ITEM,
  MAVLINK_MSG_ID.MISSION_ITEM_INT,
  MAVLINK_MSG_ID.MISSION_CURRENT,
  // Without this the REACHED case below never ran: arrivals were only inferred from MISSION_CURRENT.
  MAVLINK_MSG_ID.MISSION_ITEM_REACHED,
  MAVLINK_MSG_ID.COMMAND_ACK,
  MAVLINK_MSG_ID.RADIO_STATUS,
  MAVLINK_MSG_ID.HOME_POSITION,
]);

export function computeDistanceAndBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): { distanceM: number; bearingDeg: number } {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceM = R * c;

  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const bearingDeg = (toDeg(Math.atan2(y, x)) + 360) % 360;

  return { distanceM, bearingDeg };
}

export interface PreArmReadiness {
  isReady: boolean;
  prearmBitPresent: boolean;
  prearmBitHealthy: boolean;
  failedSubsystems: string[];
  activePreArmErrors: string[];
}

const SENSOR_SUBSYSTEM_CHECKS: { mask: number; label: string }[] = [
  { mask: 0x01, label: '3D Gyro' },
  { mask: 0x02, label: '3D Accel' },
  { mask: 0x04, label: '3D Mag' },
  { mask: 0x08, label: 'Baro' },
  { mask: 0x20, label: 'GPS' },
  { mask: 0x10000, label: 'RC Input' },
  { mask: 0x200000, label: 'AHRS' },
  { mask: 0x400000, label: 'Terrain' },
  { mask: 0x1000000, label: 'Logging' },
  { mask: 0x2000000, label: 'Battery' },
];

export function evaluatePreArmReadiness(
  sysStatus: VehicleSysStatus,
  statusMessages: StatusMessage[],
  isArmed: boolean
): PreArmReadiness {
  const PREARM_BIT = 0x10000000; // MAV_SYS_STATUS_PREARM_CHECK (268435456)
  const prearmBitPresent =
    (sysStatus.sensorsPresent & PREARM_BIT) !== 0 ||
    (sysStatus.sensorsEnabled & PREARM_BIT) !== 0;
  const prearmBitHealthy = (sysStatus.sensorsHealth & PREARM_BIT) !== 0;

  const failedSubsystems: string[] = [];
  for (const sub of SENSOR_SUBSYSTEM_CHECKS) {
    const enabled = (sysStatus.sensorsEnabled & sub.mask) !== 0;
    const healthy = (sysStatus.sensorsHealth & sub.mask) !== 0;
    if (enabled && !healthy) {
      failedSubsystems.push(sub.label);
    }
  }

  const seenErrors = new Set<string>();
  const activePreArmErrors: string[] = [];
  const now = Date.now();
  for (const msg of statusMessages) {
    // Age out PreArm messages older than 30 seconds
    if (msg.timestamp && now - msg.timestamp > 30000) continue;
    const txt = msg.text.trim();
    if (/^(PreArm:|Arm:)/i.test(txt)) {
      // Ignore positive / clearance checks
      if (/PreArm:\s*(Passed|All checks passing|OK|Healthy|Good)/i.test(txt)) {
        continue;
      }
      if (!seenErrors.has(txt)) {
        seenErrors.add(txt);
        activePreArmErrors.push(txt);
      }
      if (activePreArmErrors.length >= 6) break;
    }
  }

  const isReady = isArmed
    ? true
    : prearmBitPresent
      ? prearmBitHealthy && failedSubsystems.length === 0
      : failedSubsystems.length === 0 && activePreArmErrors.length === 0;

  return {
    isReady,
    prearmBitPresent,
    prearmBitHealthy,
    failedSubsystems,
    activePreArmErrors,
  };
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

export function appendStatusMessage(
  existing: StatusMessage[],
  msg: { severity: number; severityLabel: string; text: string },
  now: number
): StatusMessage[] {
  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const first = existing[0];
  if (first && first.text === msg.text && first.severity === msg.severity) {
    const updated: StatusMessage = {
      ...first,
      time,
      timestamp: now,
      count: (first.count ?? 1) + 1,
    };
    return [updated, ...existing.slice(1)];
  }
  const newMsg: StatusMessage = {
    id: `${now}-${Math.random()}`,
    time,
    timestamp: now,
    severity: msg.severity,
    severityLabel: msg.severityLabel,
    text: msg.text,
    count: 1,
  };
  return [newMsg, ...existing.slice(0, 99)];
}

let lastVersionPollTime = 0;
let versionPollAttempts = 0;

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
    hasYaw: false,
  },
  gps2: null,
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
  sysStatus: {
    load: 0,
    dropRateComm: 0,
    errorsComm: 0,
    sensorsPresent: 0,
    sensorsEnabled: 0,
    sensorsHealth: 0,
  },
  rc: {
    chancount: 8,
    rssi: 0,
    channels: [1500, 1500, 1000, 1500, 1500, 1500, 1500, 1500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  servo: {
    port: 0,
    ports: {
      0: [1100, 1100, 1100, 1100, 1500, 1500, 1500, 1500, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    servos: [1100, 1100, 1100, 1100, 1500, 1500, 1500, 1500, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  navController: {
    navRoll: 0,
    navPitch: 0,
    navBearing: 0,
    targetBearing: 0,
    wpDist: 0,
    altError: 0,
    aspdError: 0,
    xtrackError: 0,
  },
  wind: {
    direction: 0,
    speed: 0,
    speedZ: 0,
  },
  vibration: {
    vibrationX: 0,
    vibrationY: 0,
    vibrationZ: 0,
    clipping0: 0,
    clipping1: 0,
    clipping2: 0,
  },
  ekf: {
    flags: 0,
    velocityVariance: 0,
    posHorizVariance: 0,
    posVertVariance: 0,
    compassVariance: 0,
    terrainAltVariance: 0,
    airspeedVariance: 0,
  },
  rangefinder: {
    distance: 0,
    voltage: 0,
    minDistance: 0,
    maxDistance: 0,
    signalQuality: 0,
  },
  rpm: {
    rpm1: 0,
    rpm2: 0,
  },
  esc: {
    voltage: [0, 0, 0, 0],
    current: [0, 0, 0, 0],
    totalCurrent: [0, 0, 0, 0],
    rpm: [0, 0, 0, 0],
    temperature: [0, 0, 0, 0],
  },
  power: {
    vcc: 5.0,
    vservo: 5.0,
    flags: 0,
  },
  pressure: {
    pressAbs: 1013.25,
    pressDiff: 0,
    temperature: 25.0,
  },
  radioStatus: {
    rssi: 0,
    remrssi: 0,
    txbuf: 100,
    noise: 0,
    remnoise: 0,
    rxerrors: 0,
    fixed: 0,
  },
  homePosition: (() => {
    const wp0 = initialNav.missionWaypoints?.find(
      (w) => w.seq === 0 && (w.lat !== 0 || w.lon !== 0)
    );
    if (wp0) {
      return {
        lat: wp0.lat,
        lon: wp0.lon,
        alt: wp0.alt,
        distanceM: null,
        bearingDeg: null,
        source: 'wp0' as const,
      };
    }
    return {
      lat: 0,
      lon: 0,
      alt: 0,
      distanceM: null,
      bearingDeg: null,
      source: 'none' as const,
    };
  })(),
  statusMessages: [],
  firmwareVersion: null,
  firmwareRaw: undefined,
  parameters: {},
  missionWaypoints: initialNav.missionWaypoints ?? [],
  currentWaypointSeq: 0,
  lastReachedWaypointSeq: 0,
  lastReachedAt: 0,
  missionItemReachedSeen: false,
  manualWaypointJump: null,
  fencePoints: initialNav.fencePoints ?? [],
  rallyPoints: initialNav.rallyPoints ?? [],
  flightTrace: [],
  baseStationPosition: null,
  hasConnectedInSession: false,
  armedStartedAt: null,
  accumulatedArmedMs: 0,

  clearMessages: () => set({ statusMessages: [] }),
  clearCommandFeedback: () => set({ commandFeedback: undefined }),
  setBaseStationPosition: (pos: BaseStationPosition | null) => set({ baseStationPosition: pos }),

  addTracePoint: (lat: number, lon: number) => {
    set((state) => {
      const updated = appendTracePoint(state.flightTrace, lat, lon);
      return updated === state.flightTrace ? state : { flightTrace: updated };
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

        // The vehicle is back after a silence (reboot, radio dropout) while our link stayed up. A rebooted
        // autopilot has forgotten the stream rates we asked for, so ask again, and re-request home.
        if (isVehicleReacquired(state.heartbeat.lastHeartbeatTime, now) && state.heartbeat.systemId === packet.systemId) {
          messageRateManager.resetCache();
          const encoder = mavlinkConnection.getEncoder();
          mavlinkConnection.send(encoder.createRequestMessage(packet.systemId, packet.componentId, MAVLINK_MSG_ID.HOME_POSITION));
        }

        // Poll for firmware version / version banner if not yet resolved
        if (!state.firmwareVersion) { if (versionPollAttempts < 5) {
          if (now - lastVersionPollTime >= 2500) {
            lastVersionPollTime = now;
            versionPollAttempts++;
            const encoder = mavlinkConnection.getEncoder();
            mavlinkConnection.send(encoder.createRequestBanner(packet.systemId, packet.componentId));
            mavlinkConnection.send(
              encoder.createRequestMessage(packet.systemId, packet.componentId, MAVLINK_MSG_ID.AUTOPILOT_VERSION)
            );
            if (versionPollAttempts === 1) {
              mavlinkConnection.send(
                encoder.createRequestMessage(packet.systemId, packet.componentId, MAVLINK_MSG_ID.HOME_POSITION)
              );
            }
            if (versionPollAttempts === 3) {
              mavlinkConnection.send(encoder.createParamRequestList(packet.systemId, packet.componentId));
            }
          }
        } } else {
          versionPollAttempts = 0;
        }

        // Track armed flight time and arm-position fallback for Home
        let armedStartedAt = state.armedStartedAt;
        let accumulatedArmedMs = state.accumulatedArmedMs;
        if (isArmed && !state.heartbeat.isArmed) {
          armedStartedAt = now;
        } else if (!isArmed && state.heartbeat.isArmed && state.armedStartedAt !== null) {
          accumulatedArmedMs += Math.max(0, now - state.armedStartedAt);
          armedStartedAt = null;
        }

        let updatedHome = state.homePosition;
        if (
          isArmed &&
          !state.heartbeat.isArmed &&
          state.homePosition.source === 'none' &&
          (state.position.lat !== 0 || state.position.lon !== 0)
        ) {
          updatedHome = {
            lat: state.position.lat,
            lon: state.position.lon,
            alt: state.position.alt,
            distanceM: 0,
            bearingDeg: 0,
            source: 'arm_pos',
          };
        }

        return {
          hasConnectedInSession: true,
          armedStartedAt,
          accumulatedArmedMs,
          ...(updatedHome !== state.homePosition ? { homePosition: updatedHome } : {}),
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
          const updatedTrace = appendTracePoint(state.flightTrace, data.lat, data.lon);

          let updatedHome = state.homePosition;
          if (
            state.homePosition.source !== 'none' &&
            (data.lat !== 0 || data.lon !== 0) &&
            (state.homePosition.lat !== 0 || state.homePosition.lon !== 0)
          ) {
            const { distanceM, bearingDeg } = computeDistanceAndBearing(
              data.lat,
              data.lon,
              state.homePosition.lat,
              state.homePosition.lon
            );
            updatedHome = {
              ...state.homePosition,
              distanceM,
              bearingDeg,
            };
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
            ...(updatedHome !== state.homePosition ? { homePosition: updatedHome } : {}),
          };
        }

        case MAVLINK_MSG_ID.GPS_RAW_INT: {
          const rawYaw = data.raw_yaw ?? 0;
          const hasYaw = Boolean(state.gps.hasYaw || rawYaw > 0);
          const yaw = rawYaw === 65535 ? undefined : (hasYaw ? data.yaw : undefined);
          return {
            gps: {
              fixType: data.fix_type,
              fixLabel: GPS_FIX_LABELS[data.fix_type] ?? `Fix ${data.fix_type}`,
              satellites: data.satellites_visible,
              hdop: data.eph,
              vdop: data.epv,
              groundspeed: data.vel,
              cog: data.cog,
              yaw,
              hasYaw,
              lastUpdate: Date.now(),
            },
          };
        }

        case MAVLINK_MSG_ID.GPS2_RAW: {
          const rawYaw = data.raw_yaw ?? 0;
          const hasYaw = Boolean(state.gps2?.hasYaw || rawYaw > 0);
          const yaw = rawYaw === 65535 ? undefined : (hasYaw ? data.yaw : undefined);
          return {
            gps2: {
              fixType: data.fix_type,
              fixLabel: GPS_FIX_LABELS[data.fix_type] ?? `Fix ${data.fix_type}`,
              satellites: data.satellites_visible,
              hdop: data.eph,
              vdop: data.epv,
              groundspeed: data.vel,
              cog: data.cog,
              yaw,
              hasYaw,
              lastUpdate: Date.now(),
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
            sysStatus: {
              load: data.load ?? state.sysStatus.load,
              dropRateComm: data.drop_rate_comm ?? state.sysStatus.dropRateComm,
              errorsComm: data.errors_comm ?? state.sysStatus.errorsComm,
              sensorsPresent: data.onboard_control_sensors_present ?? state.sysStatus.sensorsPresent,
              sensorsEnabled: data.onboard_control_sensors_enabled ?? state.sysStatus.sensorsEnabled,
              sensorsHealth: data.onboard_control_sensors_health ?? state.sysStatus.sensorsHealth,
            },
          };
        }

        case MAVLINK_MSG_ID.SCALED_PRESSURE: {
          return {
            pressure: {
              pressAbs: data.press_abs,
              pressDiff: data.press_diff,
              temperature: data.temperature,
            },
          };
        }

        case MAVLINK_MSG_ID.RC_CHANNELS: {
          return {
            rc: {
              chancount: data.chancount !== undefined ? data.chancount : 18,
              rssi: data.rssi,
              channels: data.channels,
            },
          };
        }

        case MAVLINK_MSG_ID.RC_CHANNELS_RAW: {
          const merged = [...state.rc.channels];
          for (let i = 0; i < 8; i++) {
            merged[i] = data.channels[i];
          }
          return {
            rc: {
              chancount: Math.max(state.rc.chancount, 8),
              rssi: data.rssi,
              channels: merged,
            },
          };
        }

        case MAVLINK_MSG_ID.SERVO_OUTPUT_RAW: {
          const port = data.port ?? 0;
          const ports = {
            ...(state.servo.ports ?? {}),
            [port]: data.servos,
          };
          const baseIndex = port * 16;
          const merged = [...(state.servo.servos ?? [])];
          for (let i = 0; i < data.servos.length; i++) {
            merged[baseIndex + i] = data.servos[i];
          }
          return {
            servo: {
              port,
              ports,
              servos: merged,
            },
          };
        }

        case MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT: {
          return {
            navController: {
              navRoll: data.nav_roll,
              navPitch: data.nav_pitch,
              navBearing: data.nav_bearing,
              targetBearing: data.target_bearing,
              wpDist: data.wp_dist,
              altError: data.alt_error,
              aspdError: data.aspd_error,
              xtrackError: data.xtrack_error,
            },
          };
        }

        case MAVLINK_MSG_ID.POWER_STATUS: {
          return {
            power: {
              vcc: data.Vcc,
              vservo: data.Vservo,
              flags: data.flags,
            },
          };
        }

        case MAVLINK_MSG_ID.WIND: {
          return {
            wind: {
              direction: ((data.direction % 360) + 360) % 360,
              speed: data.speed,
              speedZ: data.speed_z,
            },
          };
        }

        case MAVLINK_MSG_ID.RANGEFINDER: {
          return {
            rangefinder: {
              ...state.rangefinder,
              distance: data.distance,
              voltage: data.voltage,
            },
          };
        }

        case MAVLINK_MSG_ID.DISTANCE_SENSOR: {
          // Only downward-facing readings (orientation 25 = MAV_SENSOR_ROTATION_PITCH_270) belong in rangefinder
          if (data.orientation !== 25) {
            return state;
          }
          return {
            rangefinder: {
              ...state.rangefinder,
              distance: data.current_distance,
              minDistance: data.min_distance,
              maxDistance: data.max_distance,
              signalQuality: data.signal_quality,
            },
          };
        }

        case MAVLINK_MSG_ID.EKF_STATUS_REPORT: {
          return {
            ekf: {
              flags: data.flags,
              velocityVariance: data.velocity_variance,
              posHorizVariance: data.pos_horiz_variance,
              posVertVariance: data.pos_vert_variance,
              compassVariance: data.compass_variance,
              terrainAltVariance: data.terrain_alt_variance,
              airspeedVariance: data.airspeed_variance,
            },
          };
        }

        case MAVLINK_MSG_ID.RPM: {
          return {
            rpm: {
              rpm1: data.rpm1,
              rpm2: data.rpm2,
            },
          };
        }

        case MAVLINK_MSG_ID.VIBRATION: {
          return {
            vibration: {
              vibrationX: data.vibration_x,
              vibrationY: data.vibration_y,
              vibrationZ: data.vibration_z,
              clipping0: data.clipping_0,
              clipping1: data.clipping_1,
              clipping2: data.clipping_2,
            },
          };
        }

        case MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4: {
          return {
            esc: {
              voltage: data.voltage,
              current: data.current,
              totalCurrent: data.totalcurrent,
              rpm: data.rpm,
              temperature: data.temperature,
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

          return {
            vfr: {
              airspeed: data.airspeed,
              groundspeed: data.groundspeed,
              heading: data.heading,
              throttle: data.throttle,
              alt: data.alt,
              climb: data.climb,
            },
          };
        }

        case MAVLINK_MSG_ID.AUTOPILOT_VERSION: {
          return {
            firmwareVersion: data.versionStr || state.firmwareVersion,
            firmwareRaw: data.versionStr ? `v${data.versionStr}` : state.firmwareRaw,
          };
        }

        case MAVLINK_MSG_ID.STATUSTEXT: {
          const version = extractFirmwareVersion(data.text);
          const trimmedText = (data.text ?? '').trim();
          const isExplanatory =
            Boolean(trimmedText) &&
            !version &&
            (data.severity <= 4 ||
              /^(PreArm:|Arm:|Takeoff|Mode|Guided|RTL|Land|Auto|Fence|Mission|Command|Disarm|Failed|Unable|Requires)/i.test(
                trimmedText
              ));

          if (isExplanatory) {
            lastRecentExplanatoryStatus = { text: trimmedText, time: now };
          }

          let updatedLastAck = state.lastCommandAck;
          let updatedFeedback = state.commandFeedback;

          if (
            isExplanatory &&
            state.lastCommandAck &&
            state.lastCommandAck.result !== 0 &&
            state.lastCommandAck.result !== 5 &&
            now - state.lastCommandAck.time <= 1200 &&
            !state.lastCommandAck.reason
          ) {
            updatedLastAck = {
              ...state.lastCommandAck,
              reason: trimmedText,
            };
          }

          if (
            isExplanatory &&
            state.commandFeedback &&
            (state.commandFeedback.status === 'denied' || state.commandFeedback.status === 'pending') &&
            now - state.commandFeedback.time <= 1200 &&
            !state.commandFeedback.reason
          ) {
            updatedFeedback = {
              ...state.commandFeedback,
              reason: trimmedText,
            };
          }

          return {
            statusMessages: appendStatusMessage(
              state.statusMessages,
              {
                severity: data.severity,
                severityLabel: SEVERITY_LABELS[data.severity] ?? `SEV_${data.severity}`,
                text: data.text,
              },
              now
            ),
            ...(version ? { firmwareVersion: version, firmwareRaw: data.text } : {}),
            ...(updatedLastAck !== state.lastCommandAck ? { lastCommandAck: updatedLastAck } : {}),
            ...(updatedFeedback !== state.commandFeedback ? { commandFeedback: updatedFeedback } : {}),
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

          let updatedHome = state.homePosition;
          if (
            data.seq === 0 &&
            (data.x !== 0 || data.y !== 0) &&
            state.homePosition.source !== 'home_msg'
          ) {
            const hasPos = state.position.lat !== 0 || state.position.lon !== 0;
            const distBrg = hasPos
              ? computeDistanceAndBearing(state.position.lat, state.position.lon, data.x, data.y)
              : null;
            updatedHome = {
              lat: data.x,
              lon: data.y,
              alt: data.z,
              distanceM: distBrg ? distBrg.distanceM : null,
              bearingDeg: distBrg ? distBrg.bearingDeg : null,
              source: 'wp0',
            };
          }

          return {
            missionWaypoints: updatedWps,
            ...(isCurrent ? { currentWaypointSeq: data.seq } : {}),
            ...(updatedHome !== state.homePosition ? { homePosition: updatedHome } : {}),
          };
        }

        case MAVLINK_MSG_ID.MISSION_CURRENT: {
          const feedback = state.commandFeedback;
          const isMatchingNavFeedback =
            feedback &&
            feedback.targetKey === `action:wp:${data.seq}` &&
            (feedback.status === 'pending' || feedback.status === 'denied' || feedback.status === 'failed');

          // Vehicles repeat MISSION_CURRENT several times a second. Rebuild the mission only when the active item
          // actually changes: a new array re-renders the map and rewrites the whole mission to localStorage.
          const currentChanged = state.missionWaypoints.some((w) => w.current !== (w.seq === data.seq));
          return {
            currentWaypointSeq: data.seq,
            ...(currentChanged
              ? { missionWaypoints: state.missionWaypoints.map((w) => ({ ...w, current: w.seq === data.seq })) }
              : {}),
            ...(isMatchingNavFeedback
              ? {
                  commandFeedback: {
                    ...feedback,
                    status: 'accepted',
                    result: 0,
                    resultText: 'ACCEPTED',
                    reason: undefined,
                  },
                }
              : {}),
          };
        }

        case MAVLINK_MSG_ID.MISSION_ITEM_REACHED: {
          return {
            lastReachedWaypointSeq: data.seq,
            lastReachedAt: now,
            missionItemReachedSeen: true,
          };
        }

        case MAVLINK_MSG_ID.RADIO_STATUS: {
          return {
            radioStatus: {
              rssi: data.rssi ?? 0,
              remrssi: data.remrssi ?? 0,
              txbuf: data.txbuf ?? 100,
              noise: data.noise ?? 0,
              remnoise: data.remnoise ?? 0,
              rxerrors: data.rxerrors ?? 0,
              fixed: data.fixed ?? 0,
            },
          };
        }

        case MAVLINK_MSG_ID.HOME_POSITION: {
          if (data.latitude === 0 && data.longitude === 0) {
            return state;
          }
          const hasPos = state.position.lat !== 0 || state.position.lon !== 0;
          const distBrg = hasPos
            ? computeDistanceAndBearing(
                state.position.lat,
                state.position.lon,
                data.latitude,
                data.longitude
              )
            : null;
          return {
            homePosition: {
              lat: data.latitude,
              lon: data.longitude,
              alt: data.altitude ?? 0,
              distanceM: distBrg ? distBrg.distanceM : null,
              bearingDeg: distBrg ? distBrg.bearingDeg : null,
              source: 'home_msg',
            },
          };
        }

        case MAVLINK_MSG_ID.COMMAND_ACK: {
          let matchedPending: PendingCommand | undefined;
          const pendingList = pendingCommands.get(data.command);
          if (pendingList && pendingList.length > 0) {
            matchedPending = pendingList.shift()!;
            clearTimeout(matchedPending.timer);
            if (pendingList.length === 0) {
              pendingCommands.delete(data.command);
            }
          }
          const cmdName = getMavCmdName(data.command);
          const resultText = COMMAND_ACK_RESULTS[data.result] ?? `CODE_${data.result}`;
          const isError = data.result !== 0 && data.result !== 5; // not ACCEPTED or IN_PROGRESS
          const isHousekeeping =
            data.command === MAV_CMD.SET_MESSAGE_INTERVAL ||
            data.command === MAV_CMD.REQUEST_MESSAGE ||
            data.command === MAV_CMD.REQUEST_AUTOPILOT_CAPABILITIES ||
            data.command === MAV_CMD.DO_SEND_BANNER;

          let reason: string | undefined;
          if (
            isError &&
            lastRecentExplanatoryStatus &&
            now - lastRecentExplanatoryStatus.time <= 600
          ) {
            reason = lastRecentExplanatoryStatus.text;
          }

          const ackInfo: CommandAckInfo = {
            command: data.command,
            result: data.result,
            resultText,
            reason,
            time: now,
          };

          if (matchedPending?.resolve) {
            matchedPending.resolve(ackInfo);
          }

          const isUserTracked = Boolean(matchedPending?.label);
          const ackMsg = isError && (!isHousekeeping || isUserTracked)
            ? {
                severity: data.result === 1 ? 4 : 3, // WARNING or ERROR
                severityLabel: data.result === 1 ? 'WARNING' : 'ERROR',
                text: `CMD ${cmdName}: ${resultText}${data.result_param2 ? ` (${data.result_param2})` : ''}${reason ? ` — ${reason}` : ''}`,
              }
            : null;

          const shouldUpdateFeedback = !isHousekeeping || Boolean(matchedPending?.label);
          const updatedFeedback: CommandFeedbackInfo | undefined = shouldUpdateFeedback
            ? {
                id: matchedPending?.id ?? nextPendingId++,
                command: data.command,
                cmdName,
                label: matchedPending?.label ?? cmdName,
                targetKey: matchedPending?.targetKey,
                status: isError ? 'denied' : 'accepted',
                result: data.result,
                resultText,
                reason,
                time: now,
              }
            : state.commandFeedback;

          return {
            lastCommandAck: ackInfo,
            ...(shouldUpdateFeedback ? { commandFeedback: updatedFeedback } : {}),
            ...(ackMsg ? { statusMessages: appendStatusMessage(state.statusMessages, ackMsg, now) } : {}),
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

// Automatic command timeout tracking (5s timeout for commands missing COMMAND_ACK)
interface PendingCommand {
  id: number;
  commandId: number;
  cmdName: string;
  label?: string;
  targetKey?: string;
  sentAt: number;
  timer: any;
  resolve?: (ack: CommandAckInfo) => void;
}
let nextPendingId = 1;
const pendingCommands = new Map<number, PendingCommand[]>();
let lastRecentExplanatoryStatus: { text: string; time: number } | null = null;
let pendingSendMeta: {
  label?: string;
  targetKey?: string;
  resolve?: (ack: CommandAckInfo) => void;
} | null = null;

// Reset vehicle heartbeat state when disconnected
mavlinkConnection.onStatus((status) => {
  if (status === 'disconnected') {
    lastVersionPollTime = 0;
    versionPollAttempts = 0;
    const now = Date.now();

    // Settle all in-flight pending commands immediately with NOT_SENT
    for (const [cmdId, list] of pendingCommands.entries()) {
      for (const item of list) {
        clearTimeout(item.timer);
        if (item.resolve) {
          item.resolve({
            command: cmdId,
            result: -2,
            resultText: 'NOT_SENT',
            time: now,
          });
        }
      }
    }
    pendingCommands.clear();

    const isManual = mavlinkConnection.isManualDisconnect;

    useTelemetryStore.setState((state) => ({
      firmwareVersion: null,
      firmwareRaw: undefined,
      armedStartedAt: null,
      ...(isManual ? { hasConnectedInSession: false } : {}),
      commandFeedback:
        state.commandFeedback?.status === 'pending'
          ? {
              ...state.commandFeedback,
              status: 'failed',
              result: -2,
              resultText: 'NOT_SENT',
              reason: 'Connection disconnected',
              time: now,
            }
          : state.commandFeedback,
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

/** How recently a vehicle heartbeat must have arrived for a background request's timeout to be worth logging. */
const HOUSEKEEPING_VEHICLE_WINDOW_MS = 6000;

export function sendTrackedCommand(
  packet: Uint8Array,
  meta?: { label?: string; targetKey?: string }
): Promise<CommandAckInfo> {
  return new Promise<CommandAckInfo>((resolve) => {
    let cmdId = 0;
    if (packet.length >= 12 && packet[0] === 0xFD) {
      const payloadLen = packet[1];
      const msgId = packet[7] | (packet[8] << 8) | (packet[9] << 16);
      if (msgId === MAVLINK_MSG_ID.COMMAND_LONG || msgId === MAVLINK_MSG_ID.COMMAND_INT) {
        const b0 = payloadLen > 28 && packet.length > 38 ? packet[38] : 0;
        const b1 = payloadLen > 29 && packet.length > 39 ? packet[39] : 0;
        cmdId = b0 | (b1 << 8);
      }
    }
    const cmdName = getMavCmdName(cmdId);

    pendingSendMeta = {
      label: meta?.label,
      targetKey: meta?.targetKey,
      resolve,
    };
    let sent = false;
    try {
      sent = mavlinkConnection.send(packet);
    } catch {
      sent = false;
    } finally {
      if (!sent) {
        pendingSendMeta = null;
      }
    }

    if (!sent) {
      const now = Date.now();
      const notSentAck: CommandAckInfo = {
        command: cmdId,
        result: -2,
        resultText: 'NOT_SENT',
        time: now,
      };
      if (meta?.label || cmdId !== 0) {
        useTelemetryStore.setState({
          commandFeedback: {
            id: nextPendingId++,
            command: cmdId,
            cmdName,
            label: meta?.label ?? cmdName,
            targetKey: meta?.targetKey,
            status: 'failed',
            result: -2,
            resultText: 'NOT_SENT',
            reason: 'Link disconnected (packet not sent)',
            time: now,
          },
        });
      }
      resolve(notSentAck);
    }
  });
}

mavlinkConnection.onSend((data) => {
  if (data.length >= 12 && data[0] === 0xFD) {
    const payloadLen = data[1];
    const msgId = data[7] | (data[8] << 8) | (data[9] << 16);
    if (msgId === MAVLINK_MSG_ID.COMMAND_LONG || msgId === MAVLINK_MSG_ID.COMMAND_INT) {
      // Command ID is at payload offset 28..29 (bytes 38..39 in packet); zero-pad safe if trimmed
      const b0 = payloadLen > 28 && data.length > 38 ? data[38] : 0;
      const b1 = payloadLen > 29 && data.length > 39 ? data[39] : 0;
      const cmdId = b0 | (b1 << 8);
      const cmdName = getMavCmdName(cmdId);
      const entryId = nextPendingId++;
      const meta = pendingSendMeta;
      pendingSendMeta = null;

      const isHousekeeping =
        cmdId === MAV_CMD.SET_MESSAGE_INTERVAL ||
        cmdId === MAV_CMD.REQUEST_MESSAGE ||
        cmdId === MAV_CMD.REQUEST_AUTOPILOT_CAPABILITIES ||
        cmdId === MAV_CMD.DO_SEND_BANNER;

      const sentNow = Date.now();
      if (!isHousekeeping || meta?.label) {
        useTelemetryStore.setState({
          commandFeedback: {
            id: entryId,
            command: cmdId,
            cmdName,
            label: meta?.label ?? cmdName,
            targetKey: meta?.targetKey,
            status: 'pending',
            time: sentNow,
          },
        });
      }

      const timer = setTimeout(() => {
        const list = pendingCommands.get(cmdId);
        let timedOutEntry: PendingCommand | undefined;
        if (list) {
          const idx = list.findIndex((item) => item.id === entryId);
          if (idx >= 0) {
            timedOutEntry = list[idx];
            list.splice(idx, 1);
          }
          if (list.length === 0) pendingCommands.delete(cmdId);
        }
        const now = Date.now();
        // A background request into a link with no vehicle on it (bridge up, autopilot off or out of range) is
        // expected to go unanswered; logging each one buries the console. Losing the vehicle is reported by the
        // heartbeat watchdog, not here, and commands the person sent are always reported.
        const hb = useTelemetryStore.getState().heartbeat;
        const vehicleHeard = hb.lastHeartbeatTime > 0 && now - hb.lastHeartbeatTime < HOUSEKEEPING_VEHICLE_WINDOW_MS;
        const logTimeout = !isHousekeeping || Boolean(timedOutEntry?.label) || vehicleHeard;
        const timeoutMsg = {
          severity: isHousekeeping ? 6 : 4, // INFO for background housekeeping, WARNING for user commands
          severityLabel: isHousekeeping ? 'INFO' : 'WARNING',
          text: `CMD ${cmdName}: NO ACK (TIMEOUT)`,
        };
        const timeoutAck: CommandAckInfo = {
          command: cmdId,
          result: -1,
          resultText: 'TIMEOUT',
          time: now,
        };
        if (timedOutEntry?.resolve) {
          timedOutEntry.resolve(timeoutAck);
        }
        useTelemetryStore.setState((s) => ({
          lastCommandAck: timeoutAck,
          ...(!isHousekeeping || timedOutEntry?.label
            ? {
                commandFeedback: {
                  id: entryId,
                  command: cmdId,
                  cmdName,
                  label: timedOutEntry?.label ?? cmdName,
                  targetKey: timedOutEntry?.targetKey,
                  status: 'timeout',
                  result: -1,
                  resultText: 'TIMEOUT',
                  reason: 'No COMMAND_ACK received from vehicle within 5s',
                  time: now,
                },
              }
            : {}),
          ...(logTimeout ? { statusMessages: appendStatusMessage(s.statusMessages, timeoutMsg, now) } : {}),
        }));
      }, 5000);

      const list = pendingCommands.get(cmdId) ?? [];
      list.push({
        id: entryId,
        commandId: cmdId,
        cmdName,
        label: meta?.label,
        targetKey: meta?.targetKey,
        sentAt: sentNow,
        timer,
        resolve: meta?.resolve,
      });
      pendingCommands.set(cmdId, list);
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

/**
 * Commands the autopilot to navigate immediately to a specified waypoint sequence.
 * Sends MAVLink MISSION_SET_CURRENT (Msg 41) and tracked MAV_CMD_DO_SET_MISSION_CURRENT (324).
 */
/**
 * Make `seq` the active mission item. `onAck` receives the vehicle's answer to the accompanying
 * DO_SET_MISSION_CURRENT (or a NOT_SENT result when the link is down).
 */
export async function setMissionCurrentWaypoint(seq: number, onAck?: (ack: CommandAckInfo) => void): Promise<boolean> {
  const hb = useTelemetryStore.getState().heartbeat;
  const sysId = hb.systemId > 0 ? hb.systemId : 1;
  const compId = hb.componentId > 0 ? hb.componentId : 1;

  const encoder = mavlinkConnection.getEncoder();
  const pkt = encoder.createMissionSetCurrent(sysId, compId, seq);
  const sent = mavlinkConnection.send(pkt);

  // Optimistically set current waypoint in store for responsive UI feedback
  useTelemetryStore.setState((s) => ({
    manualWaypointJump: { seq, time: Date.now() },
    currentWaypointSeq: seq,
    missionWaypoints: s.missionWaypoints.map((w) => ({
      ...w,
      current: w.seq === seq,
    })),
  }));

  // Also send tracked MAV_CMD_DO_SET_MISSION_CURRENT (224) for command confirmation toast
  if (sent) {
    const cmdPkt = encoder.createCommandLong(sysId, compId, MAV_CMD.DO_SET_MISSION_CURRENT, [
      seq,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    sendTrackedCommand(cmdPkt, {
      label: `Nav to WP ${seq}`,
      targetKey: `action:wp:${seq}`,
    })
      .then((ack) => onAck?.(ack))
      .catch(() => {});
  } else {
    onAck?.({ command: MAV_CMD.DO_SET_MISSION_CURRENT, result: -2, resultText: 'NOT_SENT', time: Date.now() });
  }

  return sent;
}
