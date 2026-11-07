// Built-in widget components by ID, for the dashboard grid and for composite widget panels.

import React, { Suspense, lazy } from 'react';
import { GlareshieldWidget, AllFlightModesWidget, SetSpeedWidget } from '../glareshield/GlareshieldWidget';
import { HudWidget } from '../hud/HudWidget';
import { BatteryWidget } from './BatteryWidget';
import { GpsWidget } from './GpsWidget';
import { VfrHudWidget } from './VfrHudWidget';
import { StatusTextConsoleWidget } from './StatusTextConsoleWidget';
import { MiniStatusTextWidget } from './MiniStatusTextWidget';
import { WaypointControlWidget } from './WaypointControlWidget';

// Loaded on first use: each pulls in code the rest of the app doesn't need at startup (Leaflet and mission
// parsing, the charts, parameter metadata, RTCM handling).
const MapWidget = lazy(() => import('../map/MapWidget').then((m) => ({ default: m.MapWidget })));
const TelemetryChartsWidget = lazy(() => import('./TelemetryChartsWidget').then((m) => ({ default: m.TelemetryChartsWidget })));
const ParametersWidget = lazy(() => import('./ParametersWidget').then((m) => ({ default: m.ParametersWidget })));
const NtripWidget = lazy(() => import('./NtripWidget').then((m) => ({ default: m.NtripWidget })));

/** Placeholder while a lazily loaded widget arrives. */
const WidgetLoading: React.FC = () => (
  <div className="h-full min-h-[120px] rounded-xl border border-zinc-800 bg-zinc-950/80 flex items-center justify-center text-[11px] font-mono text-zinc-500">
    Loading…
  </div>
);

const lazyWidget = (el: React.ReactElement) => <Suspense fallback={<WidgetLoading />}>{el}</Suspense>;

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
      return lazyWidget(<MapWidget colSpan={colSpan} />);
    case 'built-in-battery-card':
      return <BatteryWidget />;
    case 'built-in-gps-card':
      return <GpsWidget />;
    case 'built-in-vfr-hud':
      return <VfrHudWidget />;
    case 'built-in-statustext':
      return <StatusTextConsoleWidget />;
    case 'built-in-statustext-mini':
      return <MiniStatusTextWidget />;
    case 'built-in-parameters':
      return lazyWidget(<ParametersWidget />);
    case 'built-in-charts':
      return lazyWidget(<TelemetryChartsWidget />);
    case 'built-in-ntrip':
      return lazyWidget(<NtripWidget />);
    case 'built-in-waypoints':
      return <WaypointControlWidget />;
    default:
      return null;
  }
}
