// Validation for custom widget definitions that arrive from outside (an imported widget file or profile).
// Imported JSON is untrusted: unknown types fall back to safe defaults, malformed values are dropped, and every
// command or parameter write is forced to ask for confirmation.

import { builtinPanelId } from './builtinWidgets';
import type {
  CustomWidgetDefinition,
  MultiBarGroupType,
  PanelDisplayType,
  WidgetAction,
  WidgetPanelDefinition,
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
  'param-set',
  'compass-rose',
  'sparkline',
  'value-list',
  'composite',
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
/** Entries a Parameter set may list (each can be a wildcard). */
export const MAX_PARAM_SET_ENTRIES = 64;
/** A parameter name (16 characters in MAVLink) or a wildcard pattern, optionally with a leading - to exclude. */
const PARAM_SET_ENTRY = /^-?[A-Z0-9_*?]{1,32}$/;

/** Cleans a Parameter set's entries: upper-cased, trimmed, only name / wildcard characters, at most 64. */
export function sanitizeParamSetEntries(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const e of raw) {
    if (typeof e !== 'string') continue;
    const v = e.trim().toUpperCase();
    if (PARAM_SET_ENTRY.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_PARAM_SET_ENTRIES) break;
  }
  return out;
}
/** Panels a composite widget may hold. */
export const MAX_PANELS = 8;
/** Bound values across all panels of a composite widget (each is read 8 times a second). */
export const MAX_COMPOSITE_BINDINGS = 32;

const COLOR_SCHEMES = new Set(['default', 'green', 'amber', 'blue', 'red']);

/** Drop undefined / empty keys so saved JSON stays tidy. Every set value, including min and max, is kept. */
export function cleanBinding(b: WidgetDataBinding): WidgetDataBinding {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === '') continue;
    out[k] = v;
  }
  return out as unknown as WidgetDataBinding;
}
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
  const bit = finite(b.bit);
  if (bit !== undefined) out.bit = Math.max(0, Math.min(31, Math.round(bit)));
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

/** A command with a numeric ID and exactly seven finite parameters (missing ones are 0). */
function sanitizeAction(raw: unknown): WidgetAction | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Record<string, unknown>;
  const commandId = finite(a.commandId);
  if (commandId === undefined) return undefined;
  const src = Array.isArray(a.params) ? a.params : [];
  const params = Array.from({ length: 7 }, (_, i) => finite(src[i]) ?? 0) as WidgetAction['params'];
  return { label: text(a.label) ?? '', commandId: Math.round(commandId), params, confirmation: a.confirmation === true };
}

function sanitizePanel(raw: unknown, opts: SanitizeOptions): WidgetPanelDefinition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.displayType === 'builtin') {
    // Only built-in widgets the app knows; anything else is dropped rather than guessed at.
    const widgetId = builtinPanelId(r.widgetId);
    if (!widgetId) return undefined;
    const out: WidgetPanelDefinition = { displayType: 'builtin', widgetId };
    const title = text(r.title, 40);
    if (title) out.title = title;
    const span = finite(r.span);
    if (span !== undefined) out.span = Math.max(1, Math.min(12, Math.round(span)));
    return out;
  }
  // A panel is cleaned exactly as a widget would be; composites can't nest.
  const type = r.displayType === 'composite' ? 'stat-card' : (r.displayType as WidgetDisplayType);
  const clean = sanitizeWidgetDefinition({ ...(r as object), id: 'panel', name: 'panel', category: 'custom', displayType: type } as CustomWidgetDefinition, opts);
  const out: WidgetPanelDefinition = { displayType: clean.displayType as PanelDisplayType };
  const title = text(r.title, 40);
  if (title) out.title = title;
  const span = finite(r.span);
  if (span !== undefined) out.span = Math.max(1, Math.min(12, Math.round(span)));
  const description = text(r.description, 200);
  if (description) out.description = description;
  if (typeof r.colorScheme === 'string' && COLOR_SCHEMES.has(r.colorScheme)) out.colorScheme = r.colorScheme as WidgetPanelDefinition['colorScheme'];
  for (const key of ['binding', 'bindings', 'action', 'paramControl', 'paramSet', 'multiBarConfig', 'gauge', 'chart', 'feedback', 'stateThreshold', 'staleAfterSec'] as const) {
    if (clean[key] !== undefined) (out as unknown as Record<string, unknown>)[key] = clean[key];
  }
  return out;
}

/** Trim extra bindings, last panels first, until the composite reads at most MAX_COMPOSITE_BINDINGS values. */
function capCompositeBindings(panels: WidgetPanelDefinition[]): WidgetPanelDefinition[] {
  const count = (p: WidgetPanelDefinition) => (p.binding ? 1 : 0) + (p.bindings?.length ?? 0) + (p.feedback ? 1 : 0);
  let total = panels.reduce((n, p) => n + count(p), 0);
  for (let i = panels.length - 1; i >= 0 && total > MAX_COMPOSITE_BINDINGS; i--) {
    const extra = panels[i].bindings;
    if (!extra?.length) continue;
    const keep = Math.max(0, extra.length - (total - MAX_COMPOSITE_BINDINGS));
    total -= extra.length - keep;
    panels[i] = { ...panels[i], bindings: extra.slice(0, keep) };
  }
  return panels;
}

export interface SanitizeOptions {
  /**
   * Turn confirmation on for every command and parameter write (default). Imports from files or links always
   * do; widgets loaded back from this browser's own storage keep the confirmation setting their owner chose.
   */
  forceConfirmation?: boolean;
}

/** Normalise an untrusted widget definition in place-safe fashion (returns a cleaned copy). */
export function sanitizeWidgetDefinition(raw: CustomWidgetDefinition, opts: SanitizeOptions = {}): CustomWidgetDefinition {
  const force = opts.forceConfirmation !== false;
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
  if (w.displayType === 'composite') {
    const panels = Array.isArray(raw.panels) ? raw.panels.slice(0, MAX_PANELS) : [];
    w.panels = capCompositeBindings(panels.map((p) => sanitizePanel(p, opts)).filter((p): p is WidgetPanelDefinition => Boolean(p)));
  } else if ('panels' in w) {
    delete w.panels;
  }
  if (raw.action !== undefined) w.action = sanitizeAction(raw.action);
  if (w.action && force) w.action = { ...w.action, confirmation: true };
  if (w.paramControl) {
    w.paramControl =
      typeof w.paramControl === 'object' && typeof w.paramControl.paramId === 'string'
        ? { ...w.paramControl, confirmation: force ? true : w.paramControl.confirmation !== false }
        : undefined;
  }
  if (raw.paramSet !== undefined) {
    const rawSet = raw.paramSet as { params?: unknown; confirmation?: unknown } | null;
    w.paramSet =
      rawSet && typeof rawSet === 'object'
        ? { params: sanitizeParamSetEntries(rawSet.params), confirmation: force ? true : rawSet.confirmation !== false }
        : undefined;
  }
  return w;
}
