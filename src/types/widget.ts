export type WidgetDisplayType =
  | 'stat-card'
  | 'gauge-radial'
  | 'gauge-linear'
  | 'indicator-led'
  | 'toggle-switch'
  | 'action-button'
  | 'slider-control'
  | 'text-display'
  | 'multi-bar'
  | 'param-control'
  | 'compass-rose'
  // Rendered as the time-series chart; the id is kept so saved profiles keep working.
  | 'sparkline'
  | 'value-list'
  // Several of the types above in one card: see `panels`.
  | 'composite';

/** Display types a single panel can use (everything except composite). */
export type PanelDisplayType = Exclude<WidgetDisplayType, 'composite'>;

export type MultiBarGroupType =
  | 'rc-8'
  | 'rc-8-scaled'
  | 'servo-8'
  | 'servo-8-scaled'
  | 'esc-rpm'
  | 'esc-temp'
  | 'esc-current'
  | 'vibration-xyz'
  | 'ekf-variances'
  | 'battery-cells';

/** Converts a bound SI value into the user's display units (Link & Display Settings). */
export type WidgetUnitKind = 'none' | 'speed' | 'altitude' | 'distance';

export interface WidgetDataBinding {
  messageName: string; // e.g. "ATTITUDE", "BATTERY_STATUS", "VFR_HUD"
  fieldName: string; // e.g. "roll", "voltage_battery", "groundspeed"
  unit?: string; // e.g. "V", "m/s", "°", "%"
  multiplier?: number; // scale multiplier e.g. 57.2958 for rad to deg
  decimals?: number; // number of decimal places
  min?: number;
  max?: number;
  warnThreshold?: number;
  critThreshold?: number;
  thresholdInvert?: boolean; // true if lower values trigger warning/critical (e.g., voltage, battery_remaining)
  offset?: number; // added after the multiplier: displayed = raw * multiplier + offset
  /** When set, the value (in m/s or m after multiplier/offset) is shown in the user's chosen units. */
  unitKind?: WidgetUnitKind;
  label?: string; // series / row label for multi-value widgets
  color?: string; // series color (CSS color) for charts
}

export interface WidgetGaugeConfig {
  /**
   * 'marker' (default): one gauge, with the first extra value drawn as a marker on its scale.
   * 'multiple': one gauge per value, each with its own range, thresholds, multiplier and offset.
   */
  layout?: 'marker' | 'multiple';
  /** Dial sweep in degrees, centred on 12 o'clock. */
  sweep?: 180 | 240 | 270;
  style?: 'arc' | 'needle' | 'both';
  /** Approximate number of labelled major ticks (rounded to "nice" values). */
  majorTicks?: number;
  /** Minor ticks between each pair of major ticks. */
  minorTicks?: number;
  /** Draw green / amber / red bands from the binding's thresholds. */
  showZones?: boolean;
}

export interface WidgetChartConfig {
  windowSec?: number; // visible time window
  yScale?: 'auto' | 'fixed' | 'zero'; // fixed uses the primary binding's min/max
  showGrid?: boolean;
  fill?: boolean; // shade under the first series
}

export interface WidgetAction {
  label: string;
  commandId: number; // MAV_CMD
  params: [number, number, number, number, number, number, number];
  confirmation?: boolean;
}

export interface WidgetParamControl {
  paramId: string; // e.g. "WPNAV_SPEED", "RTL_ALT", "PILOT_SPEED_UP"
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { label: string; value: number }[];
  confirmation?: boolean;
}

export interface WidgetMultiBarConfig {
  group: MultiBarGroupType;
}

export interface CustomWidgetDefinition {
  id: string;
  name: string;
  description?: string;
  category: 'telemetry' | 'control' | 'avionics' | 'custom';
  displayType: WidgetDisplayType;
  binding?: WidgetDataBinding;
  action?: WidgetAction;
  paramControl?: WidgetParamControl;
  multiBarConfig?: WidgetMultiBarConfig;
  /**
   * Further values after `binding`. Charts plot them all, the value list shows them all, and the radial gauge,
   * linear gauge and compass rose use the first one as a secondary marker (e.g. a target) — or, with
   * gauge.layout 'multiple', the gauges draw one gauge per value.
   */
  bindings?: WidgetDataBinding[];
  gauge?: WidgetGaugeConfig;
  chart?: WidgetChartConfig;
  /**
   * Toggle switch: the vehicle field that reports the real state, so the switch shows what the vehicle is doing
   * rather than what was last sent.
   */
  feedback?: WidgetDataBinding;
  /** LED and toggle feedback: on when the value is greater than this (default 0). */
  stateThreshold?: number;
  /** Seconds without the bound message before the value is shown as stale (default 3). */
  staleAfterSec?: number;
  colorScheme?: 'default' | 'green' | 'amber' | 'blue' | 'red';
  minWidth?: number;
  minHeight?: number;
  /** Composite widgets: the panels in the card, laid out left to right on a 12-column grid. */
  panels?: WidgetPanelDefinition[];
}

/**
 * One panel of a composite widget: a display type with its own settings, exactly as a single widget would have
 * them. Card-level `colorScheme`, `staleAfterSec` and `name` apply where a panel sets none.
 */
export interface WidgetPanelDefinition {
  displayType: PanelDisplayType;
  /** Small heading above the panel. Controls also use it to name the command they send. */
  title?: string;
  /** Width in twelfths of the card (default 12, a full row). Narrow cards stack every panel full width. */
  span?: number;
  description?: string;
  binding?: WidgetDataBinding;
  bindings?: WidgetDataBinding[];
  action?: WidgetAction;
  paramControl?: WidgetParamControl;
  multiBarConfig?: WidgetMultiBarConfig;
  gauge?: WidgetGaugeConfig;
  chart?: WidgetChartConfig;
  feedback?: WidgetDataBinding;
  stateThreshold?: number;
  staleAfterSec?: number;
  colorScheme?: CustomWidgetDefinition['colorScheme'];
}

export interface PlacedWidget {
  instanceId: string;
  widgetId: string; // References built-in or custom widget definition
  customConfig?: Partial<CustomWidgetDefinition>;
  colSpan?: number; // 1-12
  rowSpan?: number;
}

export interface DashboardTab {
  id: string;
  title: string;
  icon?: string;
  widgets: PlacedWidget[];
}

export interface DashboardProfile {
  version: string;
  name: string;
  updatedAt: string;
  tabs: DashboardTab[];
  customWidgets: CustomWidgetDefinition[];
}
