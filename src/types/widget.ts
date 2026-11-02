export type WidgetDisplayType =
  | 'stat-card'
  | 'gauge-radial'
  | 'gauge-linear'
  | 'indicator-led'
  | 'toggle-switch'
  | 'action-button'
  | 'slider-control'
  | 'text-display';

export interface WidgetDataBinding {
  messageName: string; // e.g. "ATTITUDE", "BATTERY_STATUS", "VFR_HUD"
  fieldName: string; // e.g. "roll", "voltage_battery", "groundspeed"
  unit?: string; // e.g. "V", "m/s", "°", "%"
  multiplier?: number; // scale multiplier e.g. 57.2958 for rad to deg
  decimals?: number; // number of decimal places
  min?: number;
  max?: number;
}

export interface WidgetAction {
  label: string;
  commandId: number; // MAV_CMD
  params: [number, number, number, number, number, number, number];
  confirmation?: boolean;
}

export interface CustomWidgetDefinition {
  id: string;
  name: string;
  description?: string;
  category: 'telemetry' | 'control' | 'avionics' | 'custom';
  displayType: WidgetDisplayType;
  binding?: WidgetDataBinding;
  action?: WidgetAction;
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
