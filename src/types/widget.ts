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
  | 'sparkline';

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
  colorScheme?: 'default' | 'green' | 'amber' | 'blue' | 'red';
  minWidth?: number;
  minHeight?: number;
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
