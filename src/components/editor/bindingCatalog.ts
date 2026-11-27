// The value picker's catalog (BindingEditor): the curated messages and fields, plus every field the vehicle has
// actually sent. Shared by the custom widget editor and the tile rebind dialog (TileRebind).

import { useEffect, useMemo, useState } from 'react';

import { getObservedCatalog } from '../../lib/messageCache';
import type { WidgetDataBinding } from '../../types/widget';

export const COMMON_FIELDS: Record<string, string[]> = {
  // Not a MAVLink message: the link to the vehicle, measured here (% of its packets received over the last 5 s), with
  // a telemetry radio's signal when one reports it.
  LINK: ['quality', 'loss', 'received', 'lost', 'rssi', 'remrssi'],
  SYS_STATUS: ['voltage_battery', 'current_battery', 'battery_remaining', 'load', 'drop_rate_comm', 'errors_comm'],
  ATTITUDE: ['rollDeg', 'pitchDeg', 'yawDeg', 'roll', 'pitch', 'yaw', 'rollSpeed', 'pitchSpeed', 'yawSpeed'],
  VFR_HUD: ['groundspeed', 'airspeed', 'climb', 'throttle', 'alt', 'heading'],
  GLOBAL_POSITION_INT: ['relative_alt', 'alt', 'vx', 'vy', 'vz', 'hdg', 'lat', 'lon'],
  GPS_RAW_INT: ['satellites_visible', 'eph', 'epv', 'vel', 'cog', 'fixType'],
  BATTERY_STATUS: ['current_battery', 'current_consumed', 'battery_remaining', 'voltage'],
  SCALED_IMU: ['nz', 'xacc', 'yacc', 'zacc'],
  SCALED_PRESSURE: ['press_abs', 'press_diff', 'temperature'],
  POWER_STATUS: ['Vcc', 'Vservo', 'flags'],
  RC_CHANNELS: [
    'rssi',
    'chancount',
    'chan1_raw',
    'chan2_raw',
    'chan3_raw',
    'chan4_raw',
    'chan5_raw',
    'chan6_raw',
    'chan7_raw',
    'chan8_raw',
    'chan9_raw',
    'chan10_raw',
    'chan11_raw',
    'chan12_raw',
    'chan13_raw',
    'chan14_raw',
    'chan15_raw',
    'chan16_raw',
  ],
  'RC_CHANNELS (scaled)': [
    'chan1_scaled',
    'chan2_scaled',
    'chan3_scaled',
    'chan4_scaled',
    'chan5_scaled',
    'chan6_scaled',
    'chan7_scaled',
    'chan8_scaled',
    'chan9_scaled',
    'chan10_scaled',
    'chan11_scaled',
    'chan12_scaled',
    'chan13_scaled',
    'chan14_scaled',
    'chan15_scaled',
    'chan16_scaled',
  ],
  SERVO_OUTPUT_RAW: [
    'servo1_raw',
    'servo2_raw',
    'servo3_raw',
    'servo4_raw',
    'servo5_raw',
    'servo6_raw',
    'servo7_raw',
    'servo8_raw',
    'servo9_raw',
    'servo10_raw',
    'servo11_raw',
    'servo12_raw',
    'servo13_raw',
    'servo14_raw',
    'servo15_raw',
    'servo16_raw',
  ],
  'SERVO_OUTPUT_RAW (scaled)': [
    'servo1_scaled',
    'servo2_scaled',
    'servo3_scaled',
    'servo4_scaled',
    'servo5_scaled',
    'servo6_scaled',
    'servo7_scaled',
    'servo8_scaled',
    'servo9_scaled',
    'servo10_scaled',
    'servo11_scaled',
    'servo12_scaled',
    'servo13_scaled',
    'servo14_scaled',
    'servo15_scaled',
    'servo16_scaled',
  ],
  NAV_CONTROLLER_OUTPUT: [
    'wp_dist',
    'nav_bearing',
    'target_bearing',
    'alt_error',
    'aspd_error',
    'xtrack_error',
    'nav_roll',
    'nav_pitch',
  ],
  WIND: ['direction', 'speed', 'speed_z'],
  // PID_TUNING per controller axis (sent while GCS_PID_MASK selects it); other axes appear once received.
  PID_TUNING_ROLL: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_PITCH: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_YAW: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_ACCZ: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_STEER: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  VIBRATION: ['vibration_x', 'vibration_y', 'vibration_z', 'clipping_0', 'clipping_1', 'clipping_2'],
  RELAY_STATUS: ['on', 'present'],
  EKF_STATUS_REPORT: [
    'flags',
    'velocity_variance',
    'pos_horiz_variance',
    'pos_vert_variance',
    'compass_variance',
    'terrain_alt_variance',
    'airspeed_variance',
  ],
  RANGEFINDER: ['distance', 'voltage'],
  DISTANCE_SENSOR: ['current_distance', 'min_distance', 'max_distance', 'signal_quality'],
  RPM: ['rpm1', 'rpm2'],
  // Landed state (0 unknown, 1 on ground, 2 in air, 3 taking off, 4 landing) and VTOL state (3 hover, 4 forward).
  EXTENDED_SYS_STATE: ['landed_state', 'vtol_state'],
  ESC_TELEMETRY_5_TO_8: [
    'rpm5',
    'rpm6',
    'rpm7',
    'rpm8',
    'temp5',
    'temp6',
    'temp7',
    'temp8',
    'curr5',
    'curr6',
    'curr7',
    'curr8',
    'volt5',
    'volt6',
    'volt7',
    'volt8',
  ],
  ESC_TELEMETRY_9_TO_12: [
    'rpm9',
    'rpm10',
    'rpm11',
    'rpm12',
    'temp9',
    'temp10',
    'temp11',
    'temp12',
    'curr9',
    'curr10',
    'curr11',
    'curr12',
  ],
  // Gimbal attitude in degrees (from the quaternion); yaw is vehicle-relative unless flags has the earth-frame bit.
  GIMBAL_DEVICE_ATTITUDE_STATUS: ['roll', 'pitch', 'yaw', 'angular_velocity_z', 'flags', 'failure_flags'],
  MOUNT_STATUS: ['pitch', 'roll', 'yaw', 'mount_mode'],
  CAMERA_FEEDBACK: ['img_idx', 'completed_captures', 'lat', 'lng', 'alt_rel', 'yaw'],
  EFI_STATUS: [
    'rpm',
    'health',
    'engine_load',
    'throttle_position',
    'fuel_flow',
    'fuel_consumed',
    'cylinder_head_temperature',
    'exhaust_gas_temperature',
    'ignition_voltage',
    'fuel_pressure',
  ],
  GENERATOR_STATUS: [
    'generator_speed',
    'bus_voltage',
    'battery_current',
    'load_current',
    'power_generated',
    'runtime',
    'time_until_maintenance',
    'generator_temperature',
    'rectifier_temperature',
  ],
  ESC_TELEMETRY_1_TO_4: [
    'rpm1',
    'rpm2',
    'rpm3',
    'rpm4',
    'temp1',
    'temp2',
    'temp3',
    'temp4',
    'curr1',
    'curr2',
    'curr3',
    'curr4',
    'volt1',
    'volt2',
    'volt3',
    'volt4',
  ],
  HEARTBEAT: ['customMode', 'isArmed', 'systemStatus'],
};

/** Defaults a message brings when it's picked (scaled RC and servo outputs, their raw microseconds). */
export function messageDefaults(msg: string): Partial<WidgetDataBinding> {
  if (msg === 'RC_CHANNELS (scaled)' || msg === 'SERVO_OUTPUT_RAW (scaled)')
    return { min: -1, max: 1, unit: '', decimals: 2 };
  if (msg === 'RC_CHANNELS' || msg === 'SERVO_OUTPUT_RAW') return { min: 1000, max: 2000, unit: 'µs', decimals: 0 };
  return {};
}

/** The catalog and the messages the vehicle has sent (marked live), refreshed every 3 s while `active`. */
export function useBindingCatalog(active: boolean): { catalog: Record<string, string[]>; observed: Set<string> } {
  const [observedCatalog, setObservedCatalog] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!active) return;
    setObservedCatalog(getObservedCatalog());
    const timer = setInterval(() => setObservedCatalog(getObservedCatalog()), 3000);
    return () => clearInterval(timer);
  }, [active]);
  const catalog = useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const [m, fields] of Object.entries(COMMON_FIELDS)) merged[m] = [...fields];
    for (const [m, fields] of Object.entries(observedCatalog)) {
      merged[m] = [...new Set([...(merged[m] ?? []), ...fields])];
    }
    return merged;
  }, [observedCatalog]);
  const observed = useMemo(() => new Set(Object.keys(observedCatalog)), [observedCatalog]);
  return { catalog, observed };
}
