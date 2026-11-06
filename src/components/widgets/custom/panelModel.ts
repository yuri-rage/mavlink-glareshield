// What a custom widget panel shows and needs, as pure functions of its definition and readings.
//
// A panel is the drawn part of a widget: one display type with its bindings and control settings. A card is made of
// panels plus a header, border and badges. The card reads every panel's bindings on one clock (useBindingReadings)
// and hands each panel its share, so the functions here are what both levels agree on.

import type { CommandAckInfo } from '../../../store/telemetryStore';
import type { CustomWidgetDefinition, MultiBarGroupType, WidgetDataBinding, WidgetDisplayType } from '../../../types/widget';
import {
  evaluateAlert,
  getAllBindings,
  scalePwmToUnitRange,
  toDisplayUnits,
  type AlertState,
  type BindingReading,
  type UnitSystem,
} from '../../../lib/widgetValues';
import { baseMessageName } from '../../../lib/messageCache';
import { MAX_PANELS } from '../../../lib/widgetValidation';
import { MAVLINK_MSG_ID } from '../../../mavlink/messages';
import type { ColorScheme } from './palette';

export const TELEMETRY_TYPES: ReadonlySet<WidgetDisplayType> = new Set<WidgetDisplayType>([
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
export const MULTI_VALUE_TYPES: ReadonlySet<WidgetDisplayType> = new Set<WidgetDisplayType>([
  'sparkline',
  'value-list',
  'gauge-radial',
  'gauge-linear',
  'compass-rose',
]);


/**
 * The panels a card draws, each as a stand-alone definition: a composite card's panels with the card's name, colour
 * scheme and stale timeout filled in where a panel sets none, or the card itself for every other type.
 */
export function cardPanels(def: CustomWidgetDefinition): CustomWidgetDefinition[] {
  if (def.displayType !== 'composite') return [def];
  return (def.panels ?? []).slice(0, MAX_PANELS).map((p, i) => {
    const { title, span: _span, ...settings } = p;
    return {
      ...settings,
      id: `${def.id}#${i}`,
      name: title?.trim() || def.name,
      category: def.category,
      colorScheme: p.colorScheme ?? def.colorScheme,
      staleAfterSec: p.staleAfterSec ?? def.staleAfterSec,
    };
  });
}

/** A composite panel's width in twelfths of the card (default: a full row). */
export function panelSpan(def: CustomWidgetDefinition, index: number): number {
  const span = def.displayType === 'composite' ? def.panels?.[index]?.span : undefined;
  return span !== undefined && Number.isFinite(span) ? Math.max(1, Math.min(12, Math.round(span))) : 12;
}

/** The values a panel displays, in order (the first is the primary value). */
export function panelBindings(def: CustomWidgetDefinition): WidgetDataBinding[] {
  if (!TELEMETRY_TYPES.has(def.displayType)) return [];
  const all = getAllBindings(def);
  return MULTI_VALUE_TYPES.has(def.displayType) ? all : all.slice(0, 1);
}

/** The field a toggle switch reads its real state from, if it has one. */
export function feedbackBinding(def: CustomWidgetDefinition): WidgetDataBinding | undefined {
  return def.displayType === 'toggle-switch' && def.feedback?.messageName ? def.feedback : undefined;
}

export function isMultiGauge(def: CustomWidgetDefinition): boolean {
  return (def.displayType === 'gauge-radial' || def.displayType === 'gauge-linear') && def.gauge?.layout === 'multiple';
}

export function seriesLabel(binding: WidgetDataBinding): string {
  return binding.label?.trim() || binding.fieldName;
}

/** Binding with min/max/thresholds converted from base units to display units. */
export function displayBinding(binding: WidgetDataBinding | undefined, system: UnitSystem): WidgetDataBinding | undefined {
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

export function worstAlert(levels: AlertState[]): AlertState {
  return levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'normal';
}

/** Alert level of each value of a multiple-gauge panel. */
export function gaugeLevels(bindings: WidgetDataBinding[], readings: BindingReading[]): AlertState[] {
  return bindings.map((b, i) => evaluateAlert(readings[i]?.base ?? null, b));
}

/** A panel's alert: the worst gauge of a multiple-gauge panel, otherwise its primary value against its thresholds. */
export function panelAlert(def: CustomWidgetDefinition, bindings: WidgetDataBinding[], readings: BindingReading[]): AlertState {
  if (isMultiGauge(def)) return worstAlert(gaugeLevels(bindings, readings));
  return evaluateAlert(readings[0]?.base ?? null, def.binding);
}

export interface StaleSummary {
  /** Readings whose message has stopped arriving. */
  count: number;
  /** Every displayed reading is stale (the panel dims). */
  all: boolean;
  /** Messages that have stopped. */
  messages: string[];
  /** Oldest stale reading, in seconds. */
  ageSec: number;
}

export function staleSummary(bindings: WidgetDataBinding[], readings: BindingReading[]): StaleSummary {
  const stale = readings.filter((r) => r.stale);
  return {
    count: stale.length,
    all: readings.length > 0 && stale.length === readings.length,
    messages: [...new Set(bindings.filter((_, i) => readings[i]?.stale).map((b) => b.messageName))],
    ageSec: stale.length ? Math.round(Math.max(...stale.map((r) => r.ageMs ?? 0)) / 1000) : 0,
  };
}

/** The colour scheme a panel draws in: red or amber while alerting, otherwise its own. */
export function effectiveScheme(alert: AlertState, scheme: ColorScheme | undefined): ColorScheme {
  return alert === 'crit' ? 'red' : alert === 'warn' ? 'amber' : scheme || 'default';
}

// ---------------------------------------------------------------------------------------------------------------
// Multi-bar groups
// ---------------------------------------------------------------------------------------------------------------

export interface MultiBarItem {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  displayValue?: string;
  warnAbove?: number;
  critAbove?: number;
}

export function extractMultiBarItems(group: MultiBarGroupType, state: any): MultiBarItem[] {
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
        return [{ label: 'Pack V', value: Number((state.battery?.voltage ?? 0).toFixed(2)), min: 10, max: 25.2, unit: 'V' }];
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

export function multiBarGroup(def: CustomWidgetDefinition): MultiBarGroupType {
  return def.multiBarConfig?.group ?? 'rc-8';
}

/** MAVLink message IDs a card needs the vehicle to stream (every panel's, for a composite card). */
export function requiredMessageIds(def: CustomWidgetDefinition): number[] {
  if (def.displayType === 'composite') return [...new Set(cardPanels(def).flatMap(requiredMessageIds))];
  if (def.displayType === 'multi-bar') {
    const id = MULTI_BAR_MSG_ID[multiBarGroup(def)];
    return id !== undefined ? [id] : [];
  }
  const fb = feedbackBinding(def);
  const ids = new Set<number>();
  for (const b of [...panelBindings(def), ...(fb ? [fb] : [])]) {
    const id = (MAVLINK_MSG_ID as Record<string, number>)[baseMessageName(b.messageName)];
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------

export type AckView = { status: 'pending' | 'accepted' | 'progress' | 'rejected'; text: string; time: number };

export function describeAck(info: CommandAckInfo): AckView {
  if (info.result === 0) return { status: 'accepted', text: 'Accepted', time: info.time };
  if (info.result === 5) return { status: 'progress', text: 'In progress', time: info.time };
  if (info.result === -1) return { status: 'rejected', text: 'No response (timeout)', time: info.time };
  if (info.result === -2) return { status: 'rejected', text: 'Not sent (link down)', time: info.time };
  const text = info.resultText.replace(/_/g, ' ').toLowerCase();
  return { status: 'rejected', text: text.charAt(0).toUpperCase() + text.slice(1), time: info.time };
}

type Params7 = [number, number, number, number, number, number, number];

/**
 * Parameters a toggle sends: DO_SET_RELAY puts on/off in param2, DO_SET_SERVO puts the ON PWM (param2, default 1900)
 * or OFF PWM (param3, default 1100) in param2, and any other command gets 1/0 in param1.
 */
export function toggleParams(commandId: number, params: readonly number[], on: boolean): Params7 {
  const out = [...params] as Params7;
  if (commandId === 181) {
    out[1] = on ? 1 : 0;
  } else if (commandId === 183) {
    const onPwm = params[1] > 0 ? params[1] : 1900;
    const offPwm = params[2] > 0 ? params[2] : 1100;
    out[1] = on ? onPwm : offPwm;
  } else {
    out[0] = on ? 1 : 0;
  }
  return out;
}

/** Parameters a slider sends: DO_CHANGE_SPEED, DO_SET_RELAY and DO_SET_SERVO take the value in param2, others in param1. */
export function sliderParams(commandId: number, params: readonly number[], value: number): Params7 {
  const out = [...params] as Params7;
  if (commandId === 183 || commandId === 181 || commandId === 178) out[1] = value;
  else out[0] = value;
  return out;
}
