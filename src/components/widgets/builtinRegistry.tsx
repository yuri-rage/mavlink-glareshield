// Built-in widget components by ID, for the dashboard grid and for composite widget panels.

import React, { lazy, Suspense } from 'react';

import { AllFlightModesWidget } from '../glareshield/AllFlightModesWidget';
import { ArmingModesWidget } from '../glareshield/ArmingModesWidget';
import { SetSpeedWidget } from '../glareshield/SetSpeedWidget';
import { HudWidget } from '../hud/HudWidget';
import { BatteryWidget } from './BatteryWidget';
import { GpsWidget } from './GpsWidget';
import { LinkWidget } from './LinkWidget';
import { MiniStatusTextWidget } from './MiniStatusTextWidget';
import { StatusTextConsoleWidget } from './StatusTextConsoleWidget';
import { VfrHudWidget } from './VfrHudWidget';
import { WaypointControlWidget } from './WaypointControlWidget';

// Loaded on first use: each pulls in code the rest of the app doesn't need at startup (Leaflet and mission
// parsing, the charts, PID tuning, onboard logs, parameter metadata, RTCM handling, the camera).
const MapWidget = lazy(() => import('../map/MapWidget').then((m) => ({ default: m.MapWidget })));
const TelemetryChartsWidget = lazy(() =>
  import('./TelemetryChartsWidget').then((m) => ({ default: m.TelemetryChartsWidget }))
);
const ParametersWidget = lazy(() => import('./ParametersWidget').then((m) => ({ default: m.ParametersWidget })));
const LogsWidget = lazy(() => import('./LogsWidget').then((m) => ({ default: m.LogsWidget })));
const InspectorWidget = lazy(() => import('./InspectorWidget').then((m) => ({ default: m.InspectorWidget })));
const PidTuningWidget = lazy(() => import('./PidTuningWidget').then((m) => ({ default: m.PidTuningWidget })));
const NtripWidget = lazy(() => import('./NtripWidget').then((m) => ({ default: m.NtripWidget })));
const CameraWidget = lazy(() => import('./CameraWidget').then((m) => ({ default: m.CameraWidget })));

/** Placeholder while a lazily loaded widget arrives. */
const WidgetLoading: React.FC = () => (
  <div className="flex h-full min-h-[120px] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/80 font-mono text-[11px] text-zinc-500">
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
      return <ArmingModesWidget />;
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
    case 'built-in-link':
      return <LinkWidget />;
    case 'built-in-parameters':
      return lazyWidget(<ParametersWidget />);
    case 'built-in-charts':
      return lazyWidget(<TelemetryChartsWidget />);
    case 'built-in-logs':
      return lazyWidget(<LogsWidget />);
    case 'built-in-inspector':
      return lazyWidget(<InspectorWidget />);
    case 'built-in-pid-tuning':
      return lazyWidget(<PidTuningWidget />);
    case 'built-in-ntrip':
      return lazyWidget(<NtripWidget />);
    case 'built-in-waypoints':
      return <WaypointControlWidget />;
    case 'built-in-camera':
      return lazyWidget(<CameraWidget />);
    default:
      return null;
  }
}
