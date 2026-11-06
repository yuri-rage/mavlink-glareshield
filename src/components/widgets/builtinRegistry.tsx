// Built-in widget components by ID, for the dashboard grid and for composite widget panels.

import React from 'react';
import { GlareshieldWidget, AllFlightModesWidget, SetSpeedWidget } from '../glareshield/GlareshieldWidget';
import { HudWidget } from '../hud/HudWidget';
import { MapWidget } from '../map/MapWidget';
import { BatteryWidget } from './BatteryWidget';
import { GpsWidget } from './GpsWidget';
import { VfrHudWidget } from './VfrHudWidget';
import { StatusTextConsoleWidget } from './StatusTextConsoleWidget';
import { ParametersWidget } from './ParametersWidget';
import { TelemetryChartsWidget } from './TelemetryChartsWidget';
import { NtripWidget } from './NtripWidget';
import { WaypointControlWidget } from './WaypointControlWidget';

/**
 * The built-in widget for `widgetId`, or null when it is not one. `colSpan` is the width in twelfths of the
 * dashboard; the map lays itself out differently at full width.
 */
export function renderBuiltinWidget(widgetId: string, colSpan: number): React.ReactElement | null {
  switch (widgetId) {
    case 'built-in-glareshield':
    case 'built-in-arm-modes':
      return <GlareshieldWidget />;
    case 'built-in-all-modes':
      return <AllFlightModesWidget />;
    case 'built-in-set-speed':
      return <SetSpeedWidget />;
    case 'built-in-hud':
    case 'built-in-pfd':
      return <HudWidget />;
    case 'built-in-map':
      return <MapWidget colSpan={colSpan} />;
    case 'built-in-battery-card':
      return <BatteryWidget />;
    case 'built-in-gps-card':
      return <GpsWidget />;
    case 'built-in-vfr-hud':
      return <VfrHudWidget />;
    case 'built-in-statustext':
      return <StatusTextConsoleWidget />;
    case 'built-in-parameters':
      return <ParametersWidget />;
    case 'built-in-charts':
      return <TelemetryChartsWidget />;
    case 'built-in-ntrip':
      return <NtripWidget />;
    case 'built-in-waypoints':
      return <WaypointControlWidget />;
    default:
      return null;
  }
}
