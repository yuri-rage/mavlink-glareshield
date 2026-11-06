// Validation for custom widget definitions that arrive from outside (an imported widget file or profile).
// Imported JSON is untrusted: unknown types fall back to safe defaults, malformed values are dropped, and every
// command or parameter write is forced to ask for confirmation.

import type {
  CustomWidgetDefinition,
  MultiBarGroupType,
  WidgetChartConfig,
  WidgetDataBinding,
  WidgetDisplayType,
  WidgetGaugeConfig,
} from '../types/widget';

export const VALID_DISPLAY_TYPES = new Set<WidgetDisplayType>([
  'stat-card',
  'gauge-radial',
  'gauge-linear',
  'indicator-led',
  'toggle-switch',
  'action-button',
  'slider-control',
  'text-display',
  'multi-bar',
  'param-control',
  'compass-rose',
  'sparkline',
  'value-list',
]);

export const VALID_MULTI_BAR_GROUPS = new Set<MultiBarGroupType>([
  'rc-8',
  'rc-8-scaled',
  'servo-8',
  'servo-8-scaled',
  'esc-rpm',
  'esc-temp',
  'esc-current',
  'vibration-xyz',
  'ekf-variances',
  'battery-cells',
]);

const MAX_EXTRA_BINDINGS = 16;
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const text = (v: unknown, max = 64): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);

function sanitizeBinding(raw: unknown): WidgetDataBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  const messageName = text(b.messageName);
  const fieldName = text(b.fieldName);
  if (!messageName || !fieldName) return undefined;
  const out: WidgetDataBinding = { messageName, fieldName };
  const unit = text(b.unit, 16);
  if (unit !== undefined) out.unit = unit;
  for (const key of ['multiplier', 'offset', 'min', 'max', 'warnThreshold', 'critThreshold'] as const) {
    const v = finite(b[key]);
    if (v !== undefined) out[key] = v;
  }
  const decimals = finite(b.decimals);
  if (decimals !== undefined) out.decimals = Math.max(0, Math.min(6, Math.round(decimals)));
  if (b.thresholdInvert === true) out.thresholdInvert = true;
  if (b.unitKind === 'speed' || b.unitKind === 'altitude' || b.unitKind === 'distance') out.unitKind = b.unitKind;
  const label = text(b.label, 32);
  if (label) out.label = label;
  // Colours reach canvas and inline styles: accept hex only.
  if (typeof b.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(b.color)) out.color = b.color;
  return out;
}

function sanitizeGauge(raw: unknown): WidgetGaugeConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  const out: WidgetGaugeConfig = {};
  if (g.sweep === 180 || g.sweep === 240 || g.sweep === 270) out.sweep = g.sweep;
  if (g.style === 'arc' || g.style === 'needle' || g.style === 'both') out.style = g.style;
  if (g.layout === 'marker' || g.layout === 'multiple') out.layout = g.layout;
  const major = finite(g.majorTicks);
  if (major !== undefined) out.majorTicks = Math.max(2, Math.min(12, Math.round(major)));
  const minor = finite(g.minorTicks);
  if (minor !== undefined) out.minorTicks = Math.max(0, Math.min(9, Math.round(minor)));
  if (typeof g.showZones === 'boolean') out.showZones = g.showZones;
  return out;
}

function sanitizeChart(raw: unknown): WidgetChartConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const out: WidgetChartConfig = {};
  const windowSec = finite(c.windowSec);
  if (windowSec !== undefined) out.windowSec = Math.max(5, Math.min(600, windowSec));
  if (c.yScale === 'auto' || c.yScale === 'fixed' || c.yScale === 'zero') out.yScale = c.yScale;
  if (typeof c.showGrid === 'boolean') out.showGrid = c.showGrid;
  if (typeof c.fill === 'boolean') out.fill = c.fill;
  return out;
}

/** Normalise an untrusted widget definition in place-safe fashion (returns a cleaned copy). */
export function sanitizeWidgetDefinition(raw: CustomWidgetDefinition): CustomWidgetDefinition {
  const w: CustomWidgetDefinition = { ...raw };
  if (!VALID_DISPLAY_TYPES.has(w.displayType)) w.displayType = 'stat-card';
  if (w.displayType === 'multi-bar' && (!w.multiBarConfig || !VALID_MULTI_BAR_GROUPS.has(w.multiBarConfig.group))) {
    w.multiBarConfig = { group: 'rc-8' };
  }
  if (raw.binding !== undefined) w.binding = sanitizeBinding(raw.binding);
  if (raw.bindings !== undefined) {
    w.bindings = Array.isArray(raw.bindings)
      ? raw.bindings
          .slice(0, MAX_EXTRA_BINDINGS)
          .map(sanitizeBinding)
          .filter((b): b is WidgetDataBinding => Boolean(b))
      : undefined;
  }
  if (raw.feedback !== undefined) w.feedback = sanitizeBinding(raw.feedback);
  if (raw.gauge !== undefined) w.gauge = sanitizeGauge(raw.gauge);
  if (raw.chart !== undefined) w.chart = sanitizeChart(raw.chart);
  if (raw.stateThreshold !== undefined) w.stateThreshold = finite(raw.stateThreshold);
  if (raw.staleAfterSec !== undefined) {
    const s = finite(raw.staleAfterSec);
    w.staleAfterSec = s === undefined ? undefined : Math.max(0.5, Math.min(600, s));
  }
  if (w.action) w.action = { ...w.action, confirmation: true };
  if (w.paramControl) w.paramControl = { ...w.paramControl, confirmation: true };
  return w;
}
