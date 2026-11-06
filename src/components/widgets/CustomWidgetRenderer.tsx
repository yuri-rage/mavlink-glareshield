import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CustomWidgetDefinition, MultiBarGroupType, WidgetDataBinding } from '../../types/widget';
import { useTelemetryStore, sendTrackedCommand, type CommandAckInfo } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID, getMavCmdName } from '../../mavlink/messages';
import {
  evaluateAlert,
  getAllBindings,
  readBinding,
  scalePwmToUnitRange,
  toDisplayUnits,
  type BindingReading,
  type UnitSystem,
} from '../../lib/widgetValues';
import { baseMessageName } from '../../lib/messageCache';
import { valueSampler } from '../../lib/valueSampler';
import { clamp, niceTicks, stepDecimals, niceStep, thresholdZones } from '../../lib/gaugeGeometry';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RadialGauge } from './custom/RadialGauge';
import { LinearGauge } from './custom/LinearGauge';
import { GaugeGrid, type GridGauge } from './custom/GaugeGrid';
import { TimeSeriesChart, type ChartSeries } from './custom/TimeSeriesChart';
import { ACCENT_HEX, SERIES_HEX, ZONE_HEX, useChromeColors, type ColorScheme } from './custom/palette';
import {
  Play,
  Zap,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Compass,
  Sliders,
  BarChart3,
  TrendingUp,
  RefreshCw,
  Check,
  List,
  Gauge,
} from 'lucide-react';

// The binding helpers moved to lib/widgetValues; re-exported for existing imports.
export { extractBoundValueFromState, scalePwmToUnitRange } from '../../lib/widgetValues';

valueSampler.setStateGetter(() => useTelemetryStore.getState());

interface CustomWidgetRendererProps {
  definition: CustomWidgetDefinition;
}

const TELEMETRY_TYPES = new Set([
  'stat-card',
  'gauge-radial',
  'gauge-linear',
  'indicator-led',
  'text-display',
  'compass-rose',
  'sparkline',
  'value-list',
]);

/** Display types that use bindings after the first. */
const MULTI_VALUE_TYPES = new Set(['sparkline', 'value-list', 'gauge-radial', 'gauge-linear', 'compass-rose']);

/** Re-read bound values at this rate (and on unit / definition changes). */
const READ_INTERVAL_MS = 125;

type AckView = { status: 'pending' | 'accepted' | 'progress' | 'rejected'; text: string; time: number };

export function describeAck(info: CommandAckInfo): AckView {
  if (info.result === 0) return { status: 'accepted', text: 'Accepted', time: info.time };
  if (info.result === 5) return { status: 'progress', text: 'In progress', time: info.time };
  if (info.result === -1) return { status: 'rejected', text: 'No response (timeout)', time: info.time };
  if (info.result === -2) return { status: 'rejected', text: 'Not sent (link down)', time: info.time };
  const text = info.resultText.replace(/_/g, ' ').toLowerCase();
  return { status: 'rejected', text: text.charAt(0).toUpperCase() + text.slice(1), time: info.time };
}

const AckChip: React.FC<{ ack: AckView | null }> = ({ ack }) => {
  if (!ack) return null;
  const tone =
    ack.status === 'accepted'
      ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40'
      : ack.status === 'rejected'
        ? 'text-red-400 bg-red-950/40 border-red-800/40'
        : 'text-amber-400 bg-amber-950/40 border-amber-800/40';
  return (
    <p className={`text-[10px] font-mono text-center px-1.5 py-0.5 rounded border ${tone} ${ack.status === 'pending' ? 'animate-pulse' : ''}`}>
      {ack.text} · {new Date(ack.time).toLocaleTimeString()}
    </p>
  );
};

/** Seriesless binding readings re-evaluated on a fixed clock, so staleness is noticed even when nothing arrives. */
function useBindingReadings(bindings: WidgetDataBinding[], system: UnitSystem, staleAfterSec?: number): BindingReading[] {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (bindings.length === 0) return;
    const timer = setInterval(() => setTick((t) => (t + 1) % 1_000_000), READ_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [bindings.length]);
  const state = useTelemetryStore.getState();
  const now = Date.now();
  return bindings.map((b) => readBinding(b, state, system, staleAfterSec, now));
}

/** Binding with min/max/thresholds converted from base units to display units. */
function displayBinding(binding: WidgetDataBinding | undefined, system: UnitSystem): WidgetDataBinding | undefined {
  if (!binding) return undefined;
  const conv = (v: number | undefined) => (v === undefined ? undefined : toDisplayUnits(v, binding, system));
  return {
    ...binding,
    min: conv(binding.min),
    max: conv(binding.max),
    warnThreshold: conv(binding.warnThreshold),
    critThreshold: conv(binding.critThreshold),
  };
}

function seriesLabel(binding: WidgetDataBinding): string {
  return binding.label?.trim() || binding.fieldName;
}

interface MultiBarItem {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  displayValue?: string;
  warnAbove?: number;
  critAbove?: number;
}

function extractMultiBarItems(group: MultiBarGroupType, state: any): MultiBarItem[] {
  switch (group) {
    case 'rc-8': {
      const ch = state.rc?.channels ?? [];
      const chancount = state.rc?.chancount ?? 8;
      const count = Math.max(0, Math.min(8, chancount));
      return Array.from({ length: count }, (_, i) => {
        const val = ch[i];
        const isUnused = val === 65535 || val === undefined;
        return {
          label: `CH${i + 1}`,
          value: isUnused ? 0 : val,
          min: 1000,
          max: 2000,
          unit: 'µs',
          displayValue: isUnused ? '--' : `${val} µs`,
        };
      });
    }
    case 'rc-8-scaled': {
      const ch = state.rc?.channels ?? [];
      const chancount = state.rc?.chancount ?? 8;
      const count = Math.max(0, Math.min(8, chancount));
      return Array.from({ length: count }, (_, i) => {
        const val = ch[i];
        const isUnused = val === 65535 || val === undefined || val === 0;
        const chNum = i + 1;
        const minP = state.parameters?.[`RC${chNum}_MIN`]?.value ?? 1000;
        const maxP = state.parameters?.[`RC${chNum}_MAX`]?.value ?? 2000;
        const trimP = state.parameters?.[`RC${chNum}_TRIM`]?.value ?? 1500;
        const scaled = isUnused ? 0 : scalePwmToUnitRange(val, minP, maxP, trimP);
        return {
          label: `CH${chNum}`,
          value: Number(scaled.toFixed(2)),
          min: -1,
          max: 1,
          unit: '',
          displayValue: isUnused ? '--' : scaled.toFixed(2),
        };
      });
    }
    case 'servo-8': {
      const sv = state.servo?.servos ?? [];
      return Array.from({ length: 8 }, (_, i) => {
        const val = sv[i];
        const isUnused = val === 0 || val === 65535 || val === undefined;
        return {
          label: `S${i + 1}`,
          value: isUnused ? 0 : val,
          min: 1000,
          max: 2000,
          unit: 'µs',
          displayValue: isUnused ? '--' : `${val} µs`,
        };
      });
    }
    case 'servo-8-scaled': {
      const sv = state.servo?.servos ?? [];
      return Array.from({ length: 8 }, (_, i) => {
        const val = sv[i];
        const isUnused = val === 0 || val === 65535 || val === undefined;
        const svNum = i + 1;
        const minP = state.parameters?.[`SERVO${svNum}_MIN`]?.value ?? state.parameters?.[`RC${svNum}_MIN`]?.value ?? 1000;
        const maxP = state.parameters?.[`SERVO${svNum}_MAX`]?.value ?? state.parameters?.[`RC${svNum}_MAX`]?.value ?? 2000;
        const trimP = state.parameters?.[`SERVO${svNum}_TRIM`]?.value ?? state.parameters?.[`RC${svNum}_TRIM`]?.value ?? 1500;
        const scaled = isUnused ? 0 : scalePwmToUnitRange(val, minP, maxP, trimP);
        return {
          label: `S${svNum}`,
          value: Number(scaled.toFixed(2)),
          min: -1,
          max: 1,
          unit: '',
          displayValue: isUnused ? '--' : scaled.toFixed(2),
        };
      });
    }
    case 'esc-rpm': {
      const rpm = state.esc?.rpm ?? [0, 0, 0, 0];
      return Array.from({ length: 4 }, (_, i) => ({
        label: `ESC${i + 1}`,
        value: rpm[i] ?? 0,
        min: 0,
        max: 12000,
        unit: 'RPM',
      }));
    }
    case 'esc-temp': {
      const temp = state.esc?.temperature ?? [0, 0, 0, 0];
      return Array.from({ length: 4 }, (_, i) => ({
        label: `ESC${i + 1}`,
        value: temp[i] ?? 0,
        min: 0,
        max: 110,
        unit: '°C',
        warnAbove: 70,
        critAbove: 90,
      }));
    }
    case 'esc-current': {
      const curr = state.esc?.current ?? [0, 0, 0, 0];
      return Array.from({ length: 4 }, (_, i) => ({
        label: `ESC${i + 1}`,
        value: Number((curr[i] ?? 0).toFixed(1)),
        min: 0,
        max: 60,
        unit: 'A',
        warnAbove: 40,
        critAbove: 50,
      }));
    }
    case 'vibration-xyz': {
      const v = state.vibration ?? { vibrationX: 0, vibrationY: 0, vibrationZ: 0 };
      return [
        { label: 'Vibe X', value: Number((v.vibrationX ?? 0).toFixed(1)), min: 0, max: 60, unit: 'm/s²', warnAbove: 30, critAbove: 60 },
        { label: 'Vibe Y', value: Number((v.vibrationY ?? 0).toFixed(1)), min: 0, max: 60, unit: 'm/s²', warnAbove: 30, critAbove: 60 },
        { label: 'Vibe Z', value: Number((v.vibrationZ ?? 0).toFixed(1)), min: 0, max: 60, unit: 'm/s²', warnAbove: 30, critAbove: 60 },
      ];
    }
    case 'ekf-variances': {
      const e = state.ekf ?? {};
      return [
        { label: 'Vel', value: Number((e.velocityVariance ?? 0).toFixed(2)), min: 0, max: 1.0, unit: '', warnAbove: 0.5, critAbove: 0.8 },
        { label: 'Pos H', value: Number((e.posHorizVariance ?? 0).toFixed(2)), min: 0, max: 1.0, unit: '', warnAbove: 0.5, critAbove: 0.8 },
        { label: 'Pos V', value: Number((e.posVertVariance ?? 0).toFixed(2)), min: 0, max: 1.0, unit: '', warnAbove: 0.5, critAbove: 0.8 },
        { label: 'Mag', value: Number((e.compassVariance ?? 0).toFixed(2)), min: 0, max: 1.0, unit: '', warnAbove: 0.5, critAbove: 0.8 },
      ];
    }
    case 'battery-cells': {
      const cells: number[] = state.battery?.cellVoltages ?? [];
      if (cells.length === 0) {
        return [
          { label: 'Pack V', value: Number((state.battery?.voltage ?? 0).toFixed(2)), min: 10, max: 25.2, unit: 'V' },
        ];
      }
      return cells.map((cv, i) => ({
        label: `C${i + 1}`,
        value: Number(cv.toFixed(2)),
        min: 3.0,
        max: 4.25,
        unit: 'V',
      }));
    }
    default:
      return [];
  }
}

const MULTI_BAR_MSG_ID: Record<MultiBarGroupType, number> = {
  'rc-8': MAVLINK_MSG_ID.RC_CHANNELS,
  'rc-8-scaled': MAVLINK_MSG_ID.RC_CHANNELS,
  'servo-8': MAVLINK_MSG_ID.SERVO_OUTPUT_RAW,
  'servo-8-scaled': MAVLINK_MSG_ID.SERVO_OUTPUT_RAW,
  'esc-rpm': MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4,
  'esc-temp': MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4,
  'esc-current': MAVLINK_MSG_ID.ESC_TELEMETRY_1_TO_4,
  'vibration-xyz': MAVLINK_MSG_ID.VIBRATION,
  'ekf-variances': MAVLINK_MSG_ID.EKF_STATUS_REPORT,
  'battery-cells': MAVLINK_MSG_ID.BATTERY_STATUS,
};

export const CustomWidgetRenderer: React.FC<CustomWidgetRendererProps> = ({ definition }) => {
  const system = useUnitsStore((s) => s.system) as UnitSystem;
  const chrome = useChromeColors();
  const isTelemetry = TELEMETRY_TYPES.has(definition.displayType);
  const bindings = useMemo(() => {
    if (!isTelemetry) return [];
    const all = getAllBindings(definition);
    return MULTI_VALUE_TYPES.has(definition.displayType) ? all : all.slice(0, 1);
  }, [definition, isTelemetry]);
  const readings = useBindingReadings(bindings, system, definition.staleAfterSec);
  const feedbackBindings = useMemo(
    () => (definition.displayType === 'toggle-switch' && definition.feedback?.messageName ? [definition.feedback] : []),
    [definition.displayType, definition.feedback]
  );
  const [feedbackReading] = useBindingReadings(feedbackBindings, system, definition.staleAfterSec);
  const primary = readings[0];

  const multiBarGroup: MultiBarGroupType = definition.multiBarConfig?.group ?? 'rc-8';
  const multiBarItems = useTelemetryStore((s) =>
    definition.displayType === 'multi-bar' ? extractMultiBarItems(multiBarGroup, s) : []
  );
  const paramId = definition.paramControl?.paramId?.trim().toUpperCase() || 'WPNAV_SPEED';
  const paramEntry = useTelemetryStore((s) =>
    definition.displayType === 'param-control' ? s.parameters[paramId] : undefined
  );
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId || 1);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId || 1);

  const [toggleState, setToggleState] = useState(false);
  const [ack, setAck] = useState<AckView | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [sliderVal, setSliderVal] = useState<number>(definition.binding?.min ?? 0);
  const [isConfirmingSlider, setIsConfirmingSlider] = useState(false);
  const [isConfirmingToggle, setIsConfirmingToggle] = useState(false);
  const [pendingToggleVal, setPendingToggleVal] = useState(false);

  // Parameter control state
  const [paramInputVal, setParamInputVal] = useState<string>('');
  const [isConfirmingParam, setIsConfirmingParam] = useState(false);
  const [isConfirmingOutOfBounds, setIsConfirmingOutOfBounds] = useState(false);
  const [paramStatusMsg, setParamStatusMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
  const pendingParamWriteRef = useRef<{ value: number; time: number } | null>(null);

  // Auto-request parameter from vehicle on mount if not loaded
  useEffect(() => {
    if (definition.displayType === 'param-control' && paramEntry === undefined) {
      handleRequestParam();
    }
  }, [definition.displayType, paramId, paramEntry]);

  // Sync parameter input when vehicle parameter arrives
  useEffect(() => {
    if (paramEntry !== undefined && paramInputVal === '') {
      setParamInputVal(String(Number(paramEntry.value.toFixed(4))));
    }
  }, [paramEntry, paramInputVal]);

  // Detect vehicle parameter echo confirmation
  useEffect(() => {
    if (pendingParamWriteRef.current && paramEntry !== undefined) {
      const diff = Math.abs(paramEntry.value - pendingParamWriteRef.current.value);
      if (diff < 0.0001) {
        setParamStatusMsg({
          type: 'success',
          text: `✓ Confirmed on vehicle: ${paramId} = ${Number(paramEntry.value.toFixed(4))} at ${new Date().toLocaleTimeString()}`,
        });
        pendingParamWriteRef.current = null;
      }
    }
  }, [paramEntry, paramId]);

  // Timeout watcher for parameter write
  useEffect(() => {
    if (!paramStatusMsg || paramStatusMsg.type !== 'info') return;
    const timer = setTimeout(() => {
      if (pendingParamWriteRef.current) {
        setParamStatusMsg({
          type: 'error',
          text: `No confirmation echo received for ${paramId}. Autopilot may have rejected value or timed out.`,
        });
        pendingParamWriteRef.current = null;
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [paramStatusMsg, paramId]);

  // Ask the vehicle to stream every message this widget reads.
  const requiredMessages = useMemo(() => {
    if (definition.displayType === 'multi-bar') {
      const id = MULTI_BAR_MSG_ID[multiBarGroup];
      return id !== undefined ? [id] : [];
    }
    const ids = new Set<number>();
    for (const b of [...bindings, ...feedbackBindings]) {
      const id = (MAVLINK_MSG_ID as Record<string, number>)[baseMessageName(b.messageName)];
      if (id !== undefined) ids.add(id);
    }
    return [...ids];
  }, [definition.displayType, multiBarGroup, bindings, feedbackBindings]);

  useEffect(() => {
    if (requiredMessages.length === 0) return;
    const key = `custom-${definition.id}`;
    requiredMessages.forEach((id) => messageRateManager.registerRequirement(key, id));
    return () => messageRateManager.unregisterRequirement(key);
  }, [definition.id, requiredMessages]);

  // Time-series: one shared sampler ring per bound series.
  const chartSeries = useMemo<ChartSeries[]>(() => {
    if (definition.displayType !== 'sparkline') return [];
    return bindings.map((b, i) => {
      const { key, ring } = valueSampler.seriesFor(b, definition.staleAfterSec);
      return {
        key,
        ring,
        label: seriesLabel(b),
        color: b.color || (i === 0 ? ACCENT_HEX[(definition.colorScheme ?? 'default') as ColorScheme] : SERIES_HEX[i % SERIES_HEX.length]),
        unit: readings[i]?.unit ?? b.unit ?? '',
        decimals: b.decimals ?? 1,
        toDisplay: (base: number) => toDisplayUnits(base, b, system),
      };
    });
    // readings[i].unit only changes with the unit system, which is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.displayType, bindings, system, definition.colorScheme, definition.staleAfterSec]);

  useEffect(() => {
    if (definition.displayType !== 'sparkline') return;
    // Sample while mounted; the history itself is kept for when the widget comes back.
    const handles = bindings.map((b) => valueSampler.acquire(b, definition.staleAfterSec));
    return () => handles.forEach((h) => h.release());
  }, [definition.displayType, bindings, definition.staleAfterSec]);

  /** Send a command and show the vehicle's COMMAND_ACK (or timeout) under the control. */
  const sendCommand = (packet: Uint8Array, label: string) => {
    const sentAt = Date.now();
    setAck({ status: 'pending', text: 'Sent, awaiting acknowledgement', time: sentAt });
    void sendTrackedCommand(packet, { label }).then((info) => setAck(describeAck(info)));
  };

  const executeAction = () => {
    if (!definition.action) return;
    const encoder = mavlinkConnection.getEncoder();
    const cmd = encoder.createCommandLong(sysId, compId, definition.action.commandId, definition.action.params);
    sendCommand(cmd, definition.action.label || definition.name);
  };

  const handleTriggerAction = () => {
    if (!definition.action) return;
    if (definition.action.confirmation && !isConfirming) {
      setIsConfirming(true);
      return;
    }
    setIsConfirming(false);
    executeAction();
  };

  const stateThreshold = definition.stateThreshold ?? 0;
  /** Vehicle-reported switch state when a feedback field is configured, otherwise what was last sent. */
  const feedbackOn =
    feedbackReading && feedbackReading.base !== null && !feedbackReading.stale
      ? feedbackReading.base > stateThreshold
      : null;
  const switchOn = feedbackOn ?? toggleState;

  const executeToggleAction = (next: boolean) => {
    setToggleState(next);
    if (definition.action) {
      const params = [...definition.action.params] as [number, number, number, number, number, number, number];
      const cmdId = definition.action.commandId;
      if (cmdId === 181) {
        // MAV_CMD_DO_SET_RELAY: param1 = relay instance, param2 = 1 (on) or 0 (off)
        params[1] = next ? 1 : 0;
      } else if (cmdId === 183) {
        // MAV_CMD_DO_SET_SERVO: param1 = servo instance, param2 = PWM (use params[1] for ON, params[2] or 1100 for OFF)
        const onPwm = params[1] > 0 ? params[1] : 1900;
        const offPwm = params[2] > 0 ? params[2] : 1100;
        params[1] = next ? onPwm : offPwm;
      } else {
        params[0] = next ? 1 : 0;
      }
      const encoder = mavlinkConnection.getEncoder();
      const cmd = encoder.createCommandLong(sysId, compId, cmdId, params);
      sendCommand(cmd, `${definition.action.label || definition.name}: ${next ? 'ON' : 'OFF'}`);
    }
  };

  const handleToggleClick = () => {
    const next = !switchOn;
    if (definition.action?.confirmation) {
      setPendingToggleVal(next);
      setIsConfirmingToggle(true);
      return;
    }
    executeToggleAction(next);
  };

  const executeSliderAction = (val: number) => {
    if (definition.action) {
      const params = [...definition.action.params] as [number, number, number, number, number, number, number];
      const cmdId = definition.action.commandId;
      if (cmdId === 183 || cmdId === 181 || cmdId === 178) {
        // DO_SET_SERVO, DO_SET_RELAY, DO_CHANGE_SPEED put the variable value in param2 (index 1)
        params[1] = val;
      } else {
        params[0] = val;
      }
      const encoder = mavlinkConnection.getEncoder();
      const cmd = encoder.createCommandLong(sysId, compId, cmdId, params);
      sendCommand(cmd, `${definition.action.label || definition.name}: ${val}`);
    }
    setIsConfirmingSlider(false);
  };

  const handleRequestParam = () => {
    const encoder = mavlinkConnection.getEncoder();
    mavlinkConnection.send(encoder.createParamRequestRead(sysId, compId, -1, paramId));
  };

  const isValueOutOfBounds = (num: number) => {
    const minVal = definition.paramControl?.min;
    const maxVal = definition.paramControl?.max;
    return (minVal !== undefined && num < minVal) || (maxVal !== undefined && num > maxVal);
  };

  const handleInitiateParamSet = () => {
    const num = parseFloat(paramInputVal);
    if (isNaN(num)) return;

    if (definition.paramControl?.confirmation) {
      setIsConfirmingParam(true);
      setIsConfirmingOutOfBounds(false);
    } else if (isValueOutOfBounds(num)) {
      // Out-of-bounds parameter writes require explicit confirmation even if normal confirmation is off
      setIsConfirmingOutOfBounds(true);
      setIsConfirmingParam(false);
    } else {
      executeParamSet(num);
    }
  };

  const executeParamSet = (val: number) => {
    // 1. Refuse to write until parameter's real type is known
    if (paramEntry === undefined || paramEntry.type === undefined) {
      handleRequestParam();
      setParamStatusMsg({
        type: 'error',
        text: `Cannot write: parameter type for ${paramId} is unknown. Requesting from autopilot...`,
      });
      setIsConfirmingParam(false);
      setIsConfirmingOutOfBounds(false);
      return;
    }

    // 2. Send PARAM_SET with known real type (without hard clamping)
    const encoder = mavlinkConnection.getEncoder();
    const pType = paramEntry.type;
    mavlinkConnection.send(encoder.createParamSet(sysId, compId, paramId, val, pType));
    pendingParamWriteRef.current = { value: val, time: Date.now() };
    setParamStatusMsg({
      type: 'info',
      text: `PARAM_SET sent for ${paramId} = ${val}... awaiting vehicle confirmation echo`,
    });
    setIsConfirmingParam(false);
    setIsConfirmingOutOfBounds(false);
  };

  // Display-unit view of the primary binding (min / max / thresholds are configured in base units).
  const pb = displayBinding(definition.binding, system);
  const unit = primary?.unit ?? definition.binding?.unit ?? '';
  const min = pb?.min ?? 0;
  const max = pb?.max ?? 100;
  const numVal = primary?.value ?? null;
  const boundText = primary?.text ?? '--';
  const pct = numVal !== null && max > min ? clamp(((numVal - min) / (max - min)) * 100, 0, 100) : 0;
  const isMultiGauge =
    (definition.displayType === 'gauge-radial' || definition.displayType === 'gauge-linear') &&
    definition.gauge?.layout === 'multiple';
  const secondary =
    !isMultiGauge && bindings.length > 1 && readings[1]
      ? { value: readings[1].value, text: `${readings[1].text} ${readings[1].unit}`.trim(), label: seriesLabel(bindings[1]) }
      : null;

  // Multi-gauge: one gauge per value, each on its own scale (falling back to the first value's range).
  const gaugeLevels = isMultiGauge ? bindings.map((b, i) => evaluateAlert(readings[i]?.base ?? null, b)) : [];
  const alertState = isMultiGauge
    ? gaugeLevels.includes('crit')
      ? 'crit'
      : gaugeLevels.includes('warn')
        ? 'warn'
        : 'normal'
    : evaluateAlert(primary?.base ?? null, definition.binding);
  const staleReadings = readings.filter((r) => r.stale);
  const isStaleAll = readings.length > 0 && staleReadings.length === readings.length;
  const staleMessages = [...new Set(bindings.filter((_, i) => readings[i]?.stale).map((b) => b.messageName))];
  const staleAgeSec = staleReadings.length ? Math.round(Math.max(...staleReadings.map((r) => r.ageMs ?? 0)) / 1000) : 0;

  const effectiveScheme: ColorScheme =
    alertState === 'crit' ? 'red' : alertState === 'warn' ? 'amber' : ((definition.colorScheme || 'default') as ColorScheme);
  const accentHex = ACCENT_HEX[effectiveScheme];
  const gaugeItems: GridGauge[] = isMultiGauge
    ? bindings.map((b, i) => {
        const r = readings[i];
        const scaled = displayBinding(
          { ...b, min: b.min ?? definition.binding?.min, max: b.max ?? definition.binding?.max },
          system
        );
        const level = gaugeLevels[i];
        return {
          key: `${b.messageName}.${b.fieldName}.${i}`,
          label: seriesLabel(b),
          value: r?.value ?? null,
          text: r?.text ?? '--',
          unit: r?.unit ?? '',
          min: scaled?.min ?? 0,
          max: scaled?.max ?? 100,
          zoneBinding: scaled,
          accent:
            level === 'crit'
              ? ACCENT_HEX.red
              : level === 'warn'
                ? ACCENT_HEX.amber
                : b.color || ACCENT_HEX[(definition.colorScheme || 'default') as ColorScheme],
          dimmed: Boolean(r?.stale),
        };
      })
    : [];

  const schemeColors = {
    default: {
      icon: 'text-sky-400',
      stroke: 'stroke-sky-500',
      bg: 'bg-sky-500',
      button: 'bg-sky-600 hover:bg-sky-700',
      accent: 'accent-sky-500',
      toggleActive: 'border-sky-500 bg-sky-950/60 text-sky-400',
      ledActive: 'bg-emerald-400 border-emerald-300 shadow-emerald-500/50',
      valueText: 'text-zinc-100',
    },
    blue: {
      icon: 'text-sky-400',
      stroke: 'stroke-sky-500',
      bg: 'bg-sky-500',
      button: 'bg-sky-600 hover:bg-sky-700',
      accent: 'accent-sky-500',
      toggleActive: 'border-sky-500 bg-sky-950/60 text-sky-400',
      ledActive: 'bg-sky-400 border-sky-300 shadow-sky-500/50',
      valueText: 'text-sky-100',
    },
    green: {
      icon: 'text-emerald-400',
      stroke: 'stroke-emerald-500',
      bg: 'bg-emerald-500',
      button: 'bg-emerald-600 hover:bg-emerald-700',
      accent: 'accent-emerald-500',
      toggleActive: 'border-emerald-500 bg-emerald-950/60 text-emerald-400',
      ledActive: 'bg-emerald-400 border-emerald-300 shadow-emerald-500/50',
      valueText: 'text-emerald-100',
    },
    amber: {
      icon: 'text-amber-400',
      stroke: 'stroke-amber-500',
      bg: 'bg-amber-500',
      button: 'bg-amber-600 hover:bg-amber-700',
      accent: 'accent-amber-500',
      toggleActive: 'border-amber-500 bg-amber-950/60 text-amber-400',
      ledActive: 'bg-amber-400 border-amber-300 shadow-amber-500/50',
      valueText: 'text-amber-300',
    },
    red: {
      icon: 'text-red-400',
      stroke: 'stroke-red-500',
      bg: 'bg-red-500',
      button: 'bg-red-600 hover:bg-red-700',
      accent: 'accent-red-500',
      toggleActive: 'border-red-500 bg-red-950/60 text-red-400',
      ledActive: 'bg-red-400 border-red-300 shadow-red-500/50',
      valueText: 'text-red-300',
    },
  }[effectiveScheme];

  const HeaderIcon =
    definition.displayType === 'compass-rose'
      ? Compass
      : definition.displayType === 'param-control'
        ? Sliders
        : definition.displayType === 'multi-bar'
          ? BarChart3
          : definition.displayType === 'sparkline'
            ? TrendingUp
            : definition.displayType === 'value-list'
              ? List
              : definition.displayType === 'gauge-radial'
                ? Gauge
                : Zap;

  const fills = definition.displayType === 'gauge-radial' || definition.displayType === 'sparkline';

  return (
    <Card
      className={`h-full flex flex-col bg-zinc-950/90 shadow-md transition-colors ${
        alertState === 'crit'
          ? 'border-red-500/80 ring-1 ring-red-500/30'
          : alertState === 'warn'
            ? 'border-amber-500/70'
            : 'border-zinc-800'
      }`}
    >
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 truncate">
            <HeaderIcon className={`h-3.5 w-3.5 shrink-0 ${schemeColors.icon}`} />
            <span className="truncate">{definition.name}</span>
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {staleReadings.length > 0 && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 font-mono uppercase"
                title={`No ${staleMessages.join(', ')} received for ${staleAgeSec}s`}
              >
                Stale {staleAgeSec}s
              </Badge>
            )}
            {alertState !== 'normal' && !isStaleAll && (
              <Badge
                variant={alertState === 'crit' ? 'destructive' : 'warning'}
                className="text-[9px] px-1.5 py-0 font-mono uppercase animate-pulse"
              >
                {alertState === 'crit' ? 'CRIT' : 'WARN'}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] font-sans font-semibold capitalize">
              {definition.category}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className={`p-3 sm:p-4 space-y-3 flex-1 flex flex-col min-h-0 ${fills ? '' : 'justify-center'}`}>
        {/* STAT CARD */}
        {definition.displayType === 'stat-card' && (
          <div className={`text-center py-2 transition-opacity ${isStaleAll ? 'opacity-40' : ''}`}>
            <div className={`text-3xl font-mono font-bold ${schemeColors.valueText}`}>
              {boundText} <span className="text-sm font-normal text-zinc-400">{unit}</span>
            </div>
            {definition.description && <p className="text-[11px] text-zinc-500 mt-1">{definition.description}</p>}
          </div>
        )}

        {/* RADIAL GAUGE */}
        {definition.displayType === 'gauge-radial' && (
          // The dial is absolutely positioned so it fits the card instead of sizing it: the card's height comes
          // from its row (neighbouring widgets, or the row-height setting), with a modest minimum.
          <div className={`relative flex-1 ${isMultiGauge && gaugeItems.length > 4 ? 'min-h-[240px]' : 'min-h-[190px]'}`}>
            {isMultiGauge ? (
              <GaugeGrid gauges={gaugeItems} config={definition.gauge} />
            ) : (
            <RadialGauge
              value={numVal}
              text={boundText}
              unit={unit}
              min={min}
              max={max}
              zoneBinding={pb}
              config={definition.gauge}
              accent={accentHex}
              secondary={secondary}
              dimmed={isStaleAll}
            />
            )}
          </div>
        )}

        {/* LINEAR GAUGE */}
        {definition.displayType === 'gauge-linear' &&
          (isMultiGauge ? (
            <div className="space-y-2.5">
              {gaugeItems.map((g) => (
                <LinearGauge
                  key={g.key}
                  label={g.label}
                  value={g.value}
                  text={g.text}
                  unit={g.unit}
                  min={g.min}
                  max={g.max}
                  zoneBinding={g.zoneBinding}
                  config={definition.gauge}
                  accent={g.accent}
                  dimmed={g.dimmed}
                  compact
                />
              ))}
            </div>
          ) : (
            <LinearGauge
              value={numVal}
              text={boundText}
              unit={unit}
              min={min}
              max={max}
              zoneBinding={pb}
              config={definition.gauge}
              accent={accentHex}
              valueClass={schemeColors.valueText}
              secondary={secondary}
              dimmed={isStaleAll}
            />
          ))}

        {/* VALUE LIST */}
        {definition.displayType === 'value-list' && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 font-mono text-xs">
            {bindings.map((b, i) => {
              const r = readings[i];
              const level = evaluateAlert(r?.base ?? null, b);
              return (
                <React.Fragment key={`${b.messageName}.${b.fieldName}.${i}`}>
                  <span className={`text-zinc-400 truncate ${r?.stale ? 'opacity-40' : ''}`} title={`${b.messageName}.${b.fieldName}`}>
                    {seriesLabel(b)}
                  </span>
                  <span
                    className={`text-right font-bold ${r?.stale ? 'opacity-40' : ''} ${
                      level === 'crit' ? 'text-red-400' : level === 'warn' ? 'text-amber-300' : 'text-zinc-100'
                    }`}
                  >
                    {r?.text ?? '--'} <span className="text-[10px] font-normal text-zinc-500">{r?.unit}</span>
                  </span>
                </React.Fragment>
              );
            })}
            {bindings.length === 0 && <span className="text-zinc-500 col-span-2">No values configured.</span>}
          </div>
        )}

        {/* MULTI-CHANNEL BAR / PWM VISUALIZER */}
        {definition.displayType === 'multi-bar' && (
          <div className="space-y-1.5 py-0.5">
            {multiBarItems.map((item) => {
              const isUnused = item.displayValue === '--';
              const barPct =
                isUnused || (item.value === 0 && item.min >= 0)
                  ? 0
                  : item.max > item.min
                    ? Math.max(0, Math.min(100, ((item.value - item.min) / (item.max - item.min)) * 100))
                    : 0;
              const isCrit = !isUnused && item.critAbove !== undefined && item.value >= item.critAbove;
              const isWarn = !isUnused && !isCrit && item.warnAbove !== undefined && item.value >= item.warnAbove;
              const barColor = isCrit
                ? 'bg-red-500'
                : isWarn
                  ? 'bg-amber-500'
                  : schemeColors.bg;

              return (
                <div key={item.label} className="space-y-0.5">
                  <div className="flex justify-between items-center text-[10px] font-mono">
                    <span className="text-zinc-400 font-semibold">{item.label}</span>
                    <span className={isCrit ? 'text-red-400 font-bold' : isWarn ? 'text-amber-300 font-bold' : 'text-zinc-200'}>
                      {item.displayValue ?? `${item.value} ${item.unit}`.trim()}
                    </span>
                  </div>
                  <div className="w-full bg-zinc-900 h-2 rounded overflow-hidden border border-zinc-800/80 relative">
                    {item.min < 0 && (
                      <div className="absolute top-0 bottom-0 left-1/2 w-0.5 bg-zinc-600/80 z-10 -translate-x-1/2" />
                    )}
                    <div
                      className={`h-full ${barColor} transition-all duration-150`}
                      style={{ width: `${barPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* COMPASS / WIND / HEADING VECTOR ROSE */}
        {definition.displayType === 'compass-rose' && (
          <div className={`flex items-center justify-around gap-3 py-1 transition-opacity ${isStaleAll ? 'opacity-40' : ''}`}>
            <div className="relative w-24 h-24 shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                <circle cx="50" cy="50" r="44" stroke={chrome.track} fill={chrome.panel} strokeWidth="2" />
                {Array.from({ length: 36 }, (_, i) => {
                  const a = (i * 10 * Math.PI) / 180;
                  const r1 = i % 9 === 0 ? 36 : i % 3 === 0 ? 39 : 41;
                  return (
                    <line
                      key={i}
                      x1={50 + r1 * Math.sin(a)}
                      y1={50 - r1 * Math.cos(a)}
                      x2={50 + 43 * Math.sin(a)}
                      y2={50 - 43 * Math.cos(a)}
                      stroke={i % 9 === 0 ? chrome.tick : chrome.tickMinor}
                      strokeWidth={i % 9 === 0 ? 1.4 : 0.7}
                    />
                  );
                })}
                <text x="50" y="22" textAnchor="middle" className="fill-sky-400 text-[9px] font-bold font-mono">N</text>
                <text x="80" y="53" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">E</text>
                <text x="50" y="84" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">S</text>
                <text x="20" y="53" textAnchor="middle" fill={chrome.label} className="text-[8px] font-mono">W</text>
                {secondary?.value !== null && secondary?.value !== undefined && (
                  <g transform={`rotate(${secondary.value} 50 50)`}>
                    <polygon points="50,6 46,14 54,14" fill="#d946ef" />
                  </g>
                )}
                <g transform={`rotate(${numVal ?? 0} 50 50)`}>
                  <polygon points="50,18 45,54 50,48 55,54" style={{ fill: accentHex }} />
                  <polygon points="50,82 46,54 50,48 54,54" fill={chrome.tickMinor} />
                </g>
                <circle cx="50" cy="50" r="3.5" fill={chrome.pivot} />
              </svg>
            </div>
            <div className="text-right font-mono min-w-0">
              <div className={`text-2xl font-bold ${schemeColors.valueText}`}>
                {boundText}
                <span className="text-xs font-normal text-zinc-400 ml-0.5">{unit || '°'}</span>
              </div>
              {secondary && (
                <div className="text-[10px] mt-0.5 truncate" style={{ color: '#d946ef' }}>
                  ▲ {secondary.label} {secondary.text}
                </div>
              )}
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-0.5">
                {definition.binding?.messageName || 'VECTOR'} · {definition.binding?.fieldName || 'deg'}
              </div>
              {definition.description && <div className="text-[10px] text-zinc-400 mt-1">{definition.description}</div>}
            </div>
          </div>
        )}

        {/* TIME-SERIES CHART (displayType 'sparkline') */}
        {definition.displayType === 'sparkline' && (
          <div className="flex-1 min-h-[170px] flex flex-col">
            <TimeSeriesChart
              series={chartSeries}
              config={{ yScale: 'auto', ...definition.chart }}
              fixedMin={min}
              fixedMax={max}
              dimmed={isStaleAll}
            />
          </div>
        )}

        {/* PARAMETER SETTER / SELECTOR CONTROL */}
        {definition.displayType === 'param-control' && (
          <div className="space-y-2.5 py-1">
            <div className="flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-zinc-400 block text-[10px]">PARAMETER ID</span>
                <span className="font-bold text-sky-400">{paramId}</span>
              </div>
              <div className="text-right flex items-center gap-1.5">
                <div>
                  <span className="text-zinc-400 block text-[10px]">LIVE VALUE</span>
                  <span className="font-bold text-zinc-100">
                    {paramEntry !== undefined ? Number(paramEntry.value.toFixed(4)) : 'Not loaded'}{' '}
                    <span className="text-[10px] text-zinc-400">{definition.paramControl?.unit ?? ''}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleRequestParam}
                  title="Read parameter from autopilot"
                  className="p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {definition.paramControl?.options && definition.paramControl.options.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={paramInputVal}
                  onChange={(e) => {
                    setParamInputVal(e.target.value);
                    if (isConfirmingParam) setIsConfirmingParam(false);
                    if (isConfirmingOutOfBounds) setIsConfirmingOutOfBounds(false);
                  }}
                  className="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs font-mono text-zinc-100"
                >
                  {definition.paramControl.options.map((opt) => (
                    <option key={opt.value} value={String(opt.value)}>
                      {opt.label} ({opt.value})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className={`h-8 text-xs font-bold gap-1 ${schemeColors.button} text-white`}
                  onClick={handleInitiateParamSet}
                >
                  <Check className="h-3.5 w-3.5" />
                  Set
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={definition.paramControl?.step ?? 'any'}
                  min={definition.paramControl?.min}
                  max={definition.paramControl?.max}
                  value={paramInputVal}
                  placeholder={paramEntry !== undefined ? String(paramEntry.value) : 'Enter value'}
                  onChange={(e) => {
                    setParamInputVal(e.target.value);
                    if (isConfirmingParam) setIsConfirmingParam(false);
                    if (isConfirmingOutOfBounds) setIsConfirmingOutOfBounds(false);
                  }}
                  className="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-mono text-zinc-100"
                />
                <Button
                  size="sm"
                  className={`h-8 text-xs font-bold gap-1 ${schemeColors.button} text-white`}
                  onClick={handleInitiateParamSet}
                >
                  <Check className="h-3.5 w-3.5" />
                  Apply
                </Button>
              </div>
            )}

            {isConfirmingParam && (
              <div className="space-y-1 pt-0.5">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-7 gap-1"
                    onClick={() => {
                      const num = parseFloat(paramInputVal);
                      if (isNaN(num)) return;
                      if (isValueOutOfBounds(num)) {
                        // Transition to second confirmation for out-of-bounds write
                        setIsConfirmingParam(false);
                        setIsConfirmingOutOfBounds(true);
                      } else {
                        executeParamSet(num);
                      }
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Write {paramId} = {paramInputVal}?
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-zinc-400 h-7"
                    onClick={() => setIsConfirmingParam(false)}
                  >
                    Cancel
                  </Button>
                </div>
                {paramEntry === undefined && (
                  <span className="text-red-400 block text-[10px] text-center font-mono">
                    * Parameter type not yet loaded from autopilot. Will fetch type first.
                  </span>
                )}
              </div>
            )}

            {isConfirmingOutOfBounds && (
              <div className="space-y-1.5 p-2 rounded-lg bg-amber-950/40 border border-amber-600/80">
                <div className="flex items-start gap-1.5 text-amber-200 text-[11px] font-mono leading-tight">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Out of Bounds:</strong> Value <span className="text-white font-bold">{paramInputVal}</span> is outside recommended limits ({definition.paramControl?.min ?? '–∞'} to {definition.paramControl?.max ?? '+∞'}). Confirm force write?
                  </span>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-7 gap-1"
                    onClick={() => {
                      const num = parseFloat(paramInputVal);
                      if (!isNaN(num)) executeParamSet(num);
                    }}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Force Write {paramId} = {paramInputVal}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-zinc-400 h-7"
                    onClick={() => setIsConfirmingOutOfBounds(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {paramStatusMsg && (
              <p
                className={`text-[10px] font-mono text-center px-1.5 py-0.5 rounded ${
                  paramStatusMsg.type === 'success'
                    ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
                    : paramStatusMsg.type === 'error'
                    ? 'text-red-400 bg-red-950/40 border border-red-800/40'
                    : 'text-amber-400 bg-amber-950/40 border border-amber-800/40 animate-pulse'
                }`}
              >
                {paramStatusMsg.text}
              </p>
            )}
          </div>
        )}

        {/* SLIDER CONTROL */}
        {definition.displayType === 'slider-control' && (() => {
          const sMin = definition.binding?.min ?? 0;
          const sMax = definition.binding?.max ?? 100;
          const sUnit = definition.binding?.unit ?? '';
          return (
            <div className="space-y-3 py-1">
              <div className="flex justify-between items-baseline font-mono">
                <span className="text-xs text-zinc-400">Control Target</span>
                <span className="text-lg font-bold text-zinc-100">
                  {sliderVal} <span className="text-xs text-zinc-400">{sUnit}</span>
                </span>
              </div>
              <input
                type="range"
                min={sMin}
                max={sMax}
                step={(sMax - sMin) / 100 || 1}
                value={sliderVal}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setSliderVal(val);
                  if (definition.action?.confirmation) {
                    setIsConfirmingSlider(true);
                  }
                }}
                onPointerUp={() => {
                  if (!definition.action?.confirmation) {
                    executeSliderAction(sliderVal);
                  }
                }}
                className={`w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer ${schemeColors.accent}`}
              />
              <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                <span>{sMin} {sUnit}</span>
                <span>{sMax} {sUnit}</span>
              </div>
              {definition.action?.confirmation && isConfirmingSlider && (
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-7 gap-1"
                    onClick={() => executeSliderAction(sliderVal)}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Apply: {sliderVal} {sUnit}
                      {definition.action ? ` — ${getMavCmdName(definition.action.commandId)}` : ''}
                    </span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-zinc-400 h-7"
                    onClick={() => setIsConfirmingSlider(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              <AckChip ack={ack} />
            </div>
          );
        })()}

        {/* LED INDICATOR */}
        {definition.displayType === 'indicator-led' && (() => {
          const on = primary?.base !== null && primary?.base !== undefined && primary.base > stateThreshold && !primary.stale;
          return (
            <div className="flex items-center gap-3 py-2">
              <div
                className={`h-5 w-5 rounded-full border shadow-lg ${
                  on ? `${schemeColors.ledActive} animate-pulse` : 'bg-zinc-800 border-zinc-700'
                }`}
              />
              <div>
                <span className="text-sm font-bold text-zinc-200">
                  {primary?.stale ? 'NO DATA' : on ? 'ACTIVE / HIGH' : 'INACTIVE / LOW'}
                </span>
                <span className="text-[10px] text-zinc-500 block font-mono">
                  Value: {boundText} {unit} · on above {stateThreshold}
                </span>
              </div>
            </div>
          );
        })()}

        {/* ACTION BUTTON */}
        {definition.displayType === 'action-button' && (
          <div className="space-y-2 py-1">
            {isConfirming ? (
              <div className="space-y-1.5">
                <Button
                  variant="destructive"
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 text-xs"
                  onClick={handleTriggerAction}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    Confirm: {definition.action?.label || 'Execute'}
                    {definition.action ? ` — ${getMavCmdName(definition.action.commandId)}` : ''}?
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-zinc-400 h-7"
                  onClick={() => setIsConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="default"
                className={`w-full ${schemeColors.button} text-white font-bold gap-2`}
                onClick={handleTriggerAction}
              >
                <Play className="h-4 w-4" />
                {definition.action?.label || 'Execute Action'}
              </Button>
            )}
            <AckChip ack={ack} />
          </div>
        )}

        {/* TOGGLE SWITCH */}
        {definition.displayType === 'toggle-switch' && (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-zinc-200 block">
                  {feedbackOn !== null ? 'Vehicle State' : 'Switch State'}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono">
                  {switchOn ? 'ENGAGED' : 'DISENGAGED'}
                  {feedbackOn !== null
                    ? ` · ${definition.feedback?.fieldName} ${feedbackReading?.text}`
                    : feedbackBindings.length > 0
                      ? ' · no feedback yet (last sent)'
                      : ' · last sent'}
                </span>
              </div>
              <button
                onClick={handleToggleClick}
                className={`p-1 rounded-lg border transition-all ${
                  switchOn ? schemeColors.toggleActive : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                }`}
                aria-pressed={switchOn}
                aria-label={`${definition.name}: ${switchOn ? 'on' : 'off'}`}
              >
                {switchOn ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
              </button>
            </div>
            {isConfirmingToggle && (
              <div className="p-2 bg-amber-950/40 border border-amber-600/40 rounded space-y-1.5 text-xs">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    Confirm toggle to {pendingToggleVal ? 'ENGAGED' : 'DISENGAGED'}
                    {definition.action ? ` — ${getMavCmdName(definition.action.commandId)}` : ''}?
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-7"
                    onClick={() => {
                      executeToggleAction(pendingToggleVal);
                      setIsConfirmingToggle(false);
                    }}
                  >
                    Confirm Toggle
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-zinc-400 h-7"
                    onClick={() => setIsConfirmingToggle(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <AckChip ack={ack} />
          </div>
        )}

        {/* TEXT DISPLAY */}
        {definition.displayType === 'text-display' && (
          <div className={`bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 font-mono text-xs text-zinc-300 transition-opacity ${isStaleAll ? 'opacity-40' : ''}`}>
            {definition.description || 'Raw output'}: <b className={schemeColors.icon}>{boundText}</b> {unit}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
