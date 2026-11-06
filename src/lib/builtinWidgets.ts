// The built-in widgets a composite widget can hold as panels, with what a panel needs to know about each.
// The components themselves are mapped in components/widgets/builtinRegistry.tsx.

export interface BuiltinPanelInfo {
  name: string;
  /** Minimum panel height, for widgets that fill whatever height they are given (they would collapse otherwise). */
  minHeightPx?: number;
  /** Vehicle controls inside the widget, listed in the import preview. They keep their own confirmations. */
  controls?: string;
  /** Too big to be useful in less than a full-width row of a tall card. */
  large?: boolean;
}

export const BUILTIN_PANELS: Record<string, BuiltinPanelInfo> = {
  'built-in-gps-card': { name: 'GNSS / GPS' },
  'built-in-battery-card': { name: 'Battery & Power' },
  'built-in-vfr-hud': { name: 'VFR Flight Metrics' },
  'built-in-glareshield': { name: 'Flight Controls (Arming & Quick Modes)', controls: 'arm / disarm and flight mode changes' },
  'built-in-all-modes': { name: 'All Flight Modes', controls: 'flight mode changes' },
  'built-in-set-speed': { name: 'Set Speed Controller', controls: 'speed changes' },
  'built-in-waypoints': { name: 'Waypoint Navigation', controls: 'waypoint changes and mission restart' },
  'built-in-hud': { name: 'Heads-Up Display (HUD)', minHeightPx: 300 },
  'built-in-charts': { name: 'Telemetry Charts', minHeightPx: 300 },
  'built-in-statustext': { name: 'STATUSTEXT Console', minHeightPx: 280 },
  'built-in-map': { name: 'Navigation Map', controls: 'mission waypoint changes and restart', large: true },
  'built-in-parameters': { name: 'Parameter Manager', minHeightPx: 480, controls: 'parameter writes', large: true },
  'built-in-ntrip': { name: 'RTK / NTRIP Injector', controls: 'RTCM correction injection', large: true },
};

/** Older IDs that still name a built-in widget. */
const ALIASES: Record<string, string> = {
  'built-in-pfd': 'built-in-hud',
  'built-in-arm-modes': 'built-in-glareshield',
};

/** The canonical built-in widget ID, or undefined when `id` is not a built-in that a panel may hold. */
export function builtinPanelId(id: unknown): string | undefined {
  if (typeof id !== 'string') return undefined;
  const canonical = ALIASES[id] ?? id;
  return canonical in BUILTIN_PANELS ? canonical : undefined;
}
