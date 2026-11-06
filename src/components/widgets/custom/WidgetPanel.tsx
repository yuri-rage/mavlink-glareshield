// Picks the panel component for a display type.

import React from 'react';
import type { PanelDisplayType, WidgetDisplayType } from '../../../types/widget';
import { BarChart3, Box, Compass, Gauge, LayoutGrid, List, Sliders, TrendingUp, Zap, type LucideIcon } from 'lucide-react';
import {
  ChartPanel,
  CompassPanel,
  LedPanel,
  LinearGaugePanel,
  MultiBarPanel,
  RadialGaugePanel,
  StatPanel,
  TextPanel,
  ValueListPanel,
} from './TelemetryPanels';
import { ActionButtonPanel, ParamPanel, SliderPanel, TogglePanel } from './ControlPanels';
import { BuiltinPanel } from './BuiltinPanel';
import type { PanelProps } from './panelKit';

const PANELS: Record<PanelDisplayType, React.FC<PanelProps>> = {
  'stat-card': StatPanel,
  'text-display': TextPanel,
  'value-list': ValueListPanel,
  'gauge-radial': RadialGaugePanel,
  'gauge-linear': LinearGaugePanel,
  sparkline: ChartPanel,
  'compass-rose': CompassPanel,
  'multi-bar': MultiBarPanel,
  'indicator-led': LedPanel,
  'action-button': ActionButtonPanel,
  'toggle-switch': TogglePanel,
  'slider-control': SliderPanel,
  'param-control': ParamPanel,
  builtin: BuiltinPanel,
};

/** Header icon for a display type. */
export function panelIcon(type: WidgetDisplayType): LucideIcon {
  switch (type) {
    case 'compass-rose':
      return Compass;
    case 'param-control':
      return Sliders;
    case 'multi-bar':
      return BarChart3;
    case 'sparkline':
      return TrendingUp;
    case 'value-list':
      return List;
    case 'gauge-radial':
      return Gauge;
    case 'composite':
      return LayoutGrid;
    case 'builtin':
      return Box;
    default:
      return Zap;
  }
}

/** Display types that grow to fill the space they are given (the rest are centred). */
export function panelFills(type: WidgetDisplayType): boolean {
  return type === 'gauge-radial' || type === 'sparkline' || type === 'builtin';
}

export const WidgetPanel: React.FC<PanelProps> = (props) => {
  const Panel = PANELS[props.def.displayType as PanelDisplayType] ?? StatPanel;
  // Keyed by type so a panel's own state (confirmations, slider position) never carries over to another type.
  return <Panel key={props.def.displayType} {...props} />;
};
