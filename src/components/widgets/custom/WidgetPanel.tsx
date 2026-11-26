// Picks the panel component for a display type.

import React from 'react';

import {
  BarChart3,
  Box,
  Compass,
  Gauge,
  LayoutGrid,
  List,
  ListChecks,
  Sliders,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { useReplaying } from '../../../store/replayStore';
import type { PanelDisplayType, WidgetDisplayType } from '../../../types/widget';
import { BuiltinPanel } from './BuiltinPanel';
import { ActionButtonPanel, ParamPanel, SliderPanel, TogglePanel } from './ControlPanels';
import type { PanelProps } from './panelKit';
import { ParamSetPanel } from './ParamSetPanel';
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
  'param-set': ParamSetPanel,
  builtin: BuiltinPanel,
};

/** Header icon for a display type. */
export function panelIcon(type: WidgetDisplayType): LucideIcon {
  switch (type) {
    case 'compass-rose':
      return Compass;
    case 'param-control':
      return Sliders;
    case 'param-set':
      return ListChecks;
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

/**
 * Display types that grow to fill the space they are given (the rest are centered). A toggle fills so its slider
 * sits at the bottom of the cell and lines up with its neighbors'.
 */
export function panelFills(type: WidgetDisplayType): boolean {
  return (
    type === 'gauge-radial' ||
    type === 'sparkline' ||
    type === 'builtin' ||
    type === 'toggle-switch' ||
    type === 'param-set'
  );
}

/** Panels that send to the vehicle (commands, parameter writes): disabled while a log replays. */
const CONTROL_TYPES: ReadonlySet<string> = new Set([
  'action-button',
  'toggle-switch',
  'slider-control',
  'param-control',
]);
// (A parameter set handles a replay itself, as no link, so its read-only details button keeps working.)

export const WidgetPanel: React.FC<PanelProps> = (props) => {
  const replaying = useReplaying();
  const Panel = PANELS[props.def.displayType as PanelDisplayType] ?? StatPanel;
  // Keyed by type so a panel's own state (confirmations, slider position) never carries over to another type.
  const panel = <Panel key={props.def.displayType} {...props} />;
  if (!replaying || !CONTROL_TYPES.has(props.def.displayType)) return panel;
  // A disabled fieldset disables every button and input inside it; display: contents keeps the layout as it is (and
  // shows no tooltip of its own, so the reason is a caption).
  return (
    <fieldset disabled className="contents">
      {panel}
      {/* A toggle's slider already says so. */}
      {props.def.displayType !== 'toggle-switch' && (
        <p className="text-center text-[10px] font-semibold text-violet-300">Replay: read-only</p>
      )}
    </fieldset>
  );
};
