import { mavlinkConnection } from './connection';
import { MAVLINK_MSG_ID } from './messages';

export type BandwidthProfile = 'low' | 'standard' | 'high';

/**
 * Messages the autopilot sends as events or replies, never at an interval. Asking for a rate gets a refusal
 * (ArduPilot: "No ap_message for mavlink id (253)"), so a widget that reads one registers without a request.
 */
const EVENT_ONLY_MESSAGES = new Set<number>([
  MAVLINK_MSG_ID.STATUSTEXT,
  MAVLINK_MSG_ID.COMMAND_ACK,
  MAVLINK_MSG_ID.MISSION_ACK,
  MAVLINK_MSG_ID.FILE_TRANSFER_PROTOCOL,
  // One per photo taken.
  MAVLINK_MSG_ID.CAMERA_FEEDBACK,
]);

export interface RateLimits {
  multiplier: number;
  maxHz: number;
  minIntervalUs: number;
}

export const BANDWIDTH_PROFILES: Record<BandwidthProfile, RateLimits> = {
  low: {
    multiplier: 0.5,
    maxHz: 4,
    minIntervalUs: 250000, // 4Hz max
  },
  standard: {
    multiplier: 1.0,
    maxHz: 10,
    minIntervalUs: 100000, // 10Hz max
  },
  high: {
    multiplier: 2.0,
    maxHz: 25,
    minIntervalUs: 40000, // 25Hz max
  },
};

export class MessageRateManager {
  private activeSubscriptions = new Map<number, Set<string>>(); // messageId -> Set of widgetIds
  private currentRequestedIntervals = new Map<number, number>(); // messageId -> intervalUs
  private profile: BandwidthProfile = 'standard';
  private targetSystem = 1;
  private targetComponent = 1;
  /** No stream requests go out until a vehicle has sent a heartbeat on this link: nothing would answer them. */
  private vehicleHeard = false;
  private updateDebounceTimer: any = null;

  // Default base frequencies (Hz) for known message types
  private defaultBaseHz: Record<number, number> = {
    [MAVLINK_MSG_ID.ATTITUDE]: 10,
    // 5 Hz (x0.5 / x2 for the low / high profiles) so the map trace shows small path-tracking deviations.
    [MAVLINK_MSG_ID.GLOBAL_POSITION_INT]: 5,
    [MAVLINK_MSG_ID.GPS_RAW_INT]: 2,
    [MAVLINK_MSG_ID.GPS2_RAW]: 2,
    [MAVLINK_MSG_ID.VFR_HUD]: 4,
    [MAVLINK_MSG_ID.SYS_STATUS]: 1,
    [MAVLINK_MSG_ID.BATTERY_STATUS]: 1,
    [MAVLINK_MSG_ID.NAV_CONTROLLER_OUTPUT]: 3,
    [MAVLINK_MSG_ID.RC_CHANNELS]: 5,
    [MAVLINK_MSG_ID.RC_CHANNELS_RAW]: 5,
    [MAVLINK_MSG_ID.SERVO_OUTPUT_RAW]: 5,
    [MAVLINK_MSG_ID.SCALED_PRESSURE]: 2,
    [MAVLINK_MSG_ID.POWER_STATUS]: 1,
    [MAVLINK_MSG_ID.DISTANCE_SENSOR]: 4,
    [MAVLINK_MSG_ID.WIND]: 2,
    [MAVLINK_MSG_ID.RANGEFINDER]: 4,
    [MAVLINK_MSG_ID.EKF_STATUS_REPORT]: 2,
    [MAVLINK_MSG_ID.RPM]: 4,
    [MAVLINK_MSG_ID.VIBRATION]: 2,
    [MAVLINK_MSG_ID.RELAY_STATUS]: 1,
    [MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4]: 4,
    [MAVLINK_MSG_ID.ESC_TELEMETRY_5_TO_8]: 4,
    [MAVLINK_MSG_ID.ESC_TELEMETRY_9_TO_12]: 4,
    [MAVLINK_MSG_ID.EXTENDED_SYS_STATE]: 1,
    [MAVLINK_MSG_ID.MOUNT_STATUS]: 2,
    [MAVLINK_MSG_ID.GIMBAL_DEVICE_ATTITUDE_STATUS]: 2,
    [MAVLINK_MSG_ID.EFI_STATUS]: 1,
    [MAVLINK_MSG_ID.GENERATOR_STATUS]: 1,
    // Tuning: fast enough to see a step response (x0.5 / x2 for the low / high profiles). Only sent while
    // GCS_PID_MASK selects an axis, and then once per selected axis.
    [MAVLINK_MSG_ID.PID_TUNING]: 10,
  };

  public setProfile(profile: BandwidthProfile) {
    const validProfile = BANDWIDTH_PROFILES[profile] ? profile : 'standard';
    if (this.profile !== validProfile) {
      this.profile = validProfile;
      this.recalculateAndApply();
    }
  }

  public getProfile(): BandwidthProfile {
    return this.profile;
  }

  /** A vehicle heartbeat arrived: aim requests at it, and send them now if this is the first one on the link. */
  public setTarget(systemId: number, componentId: number) {
    const first = !this.vehicleHeard;
    this.vehicleHeard = true;
    if (first || this.targetSystem !== systemId || this.targetComponent !== componentId) {
      this.targetSystem = systemId;
      this.targetComponent = componentId;
      this.resetCache();
    }
  }

  /** A new link (or a dropped one): wait for a vehicle again before requesting streams. */
  public resetForLink() {
    this.vehicleHeard = false;
    this.currentRequestedIntervals.clear();
  }

  public resetCache() {
    this.currentRequestedIntervals.clear();
    this.scheduleApply();
  }

  /**
   * Register a widget's need for a specific MAVLink message
   */
  public registerRequirement(widgetId: string, messageId: number) {
    if (!this.activeSubscriptions.has(messageId)) {
      this.activeSubscriptions.set(messageId, new Set());
    }
    this.activeSubscriptions.get(messageId)!.add(widgetId);
    this.scheduleApply();
  }

  /**
   * Unregister a widget's requirement
   */
  public unregisterRequirement(widgetId: string, messageId?: number) {
    if (messageId !== undefined) {
      const subs = this.activeSubscriptions.get(messageId);
      if (subs) {
        subs.delete(widgetId);
        if (subs.size === 0) {
          this.activeSubscriptions.delete(messageId);
        }
      }
    } else {
      // Unregister across all messages
      for (const [msgId, subs] of this.activeSubscriptions.entries()) {
        subs.delete(widgetId);
        if (subs.size === 0) {
          this.activeSubscriptions.delete(msgId);
        }
      }
    }
    this.scheduleApply();
  }

  private scheduleApply() {
    if (this.updateDebounceTimer) {
      clearTimeout(this.updateDebounceTimer);
    }
    this.updateDebounceTimer = setTimeout(() => {
      this.recalculateAndApply();
    }, 300);
  }

  public recalculateAndApply() {
    if (mavlinkConnection.getStatus() !== 'connected' || !this.vehicleHeard) return;

    const limits = BANDWIDTH_PROFILES[this.profile];
    const encoder = mavlinkConnection.getEncoder();

    // Messages that currently have at least one active subscriber
    const activeMsgIds = new Set(this.activeSubscriptions.keys());

    // Request or update required messages
    for (const msgId of activeMsgIds) {
      if (EVENT_ONLY_MESSAGES.has(msgId)) continue;
      const baseHz = this.defaultBaseHz[msgId] ?? 2;
      const targetHz = Math.min(baseHz * limits.multiplier, limits.maxHz);
      const intervalUs = Math.max(Math.round(1000000 / targetHz), limits.minIntervalUs);

      const prevInterval = this.currentRequestedIntervals.get(msgId);
      if (prevInterval !== intervalUs) {
        const cmd = encoder.createSetMessageInterval(
          this.targetSystem,
          this.targetComponent,
          msgId,
          intervalUs
        );
        mavlinkConnection.send(cmd);
        this.currentRequestedIntervals.set(msgId, intervalUs);
      }
    }

    // Avoid sending interval = -1 which switches off message streams across shared links
    // (e.g. disrupting Mission Planner or other companion tools on the same MAVLink channel).
    for (const [prevMsgId] of this.currentRequestedIntervals.entries()) {
      if (!activeMsgIds.has(prevMsgId)) {
        this.currentRequestedIntervals.delete(prevMsgId);
      }
    }
  }
}

export const messageRateManager = new MessageRateManager();
