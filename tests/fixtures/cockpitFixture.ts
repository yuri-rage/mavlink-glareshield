// The tests' Cockpit fixture: a profile made for the cockpit tests, independent of the app's default (which may
// change). It is the app's default as it was when the tests were written: an HD cockpit tab (pinned bar, HUD and map
// over three cards) with a wide layout, a single-pane map tab, a Flow tab and a two-pane Cockpit tab.
import type { DashboardProfile } from '../../src/types/widget';

export const COCKPIT_FIXTURE: DashboardProfile = {
  version: '1.0.0',
  name: 'Cockpit test fixture',
  updatedAt: '2026-11-25T00:00:00.000Z',
  tabs: [
    // The flying tabs are Cockpit tabs: they fill the window with no scrolling (stacked on phones and small windows).
    // HUD has the HD cockpit layout, and the Ultrawide one for screens wider than 2.2:1 (Mini Messages is only in that).
    {
      id: 'tab-flight',
      title: 'HUD',
      widgets: [
        { instanceId: 'w-glareshield', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-hud', widgetId: 'built-in-hud', colSpan: 6 },
        { instanceId: 'w-map-flight', widgetId: 'built-in-map', colSpan: 6 },
        { instanceId: 'w-vfr', widgetId: 'built-in-vfr-hud', colSpan: 4 },
        { instanceId: 'w-battery', widgetId: 'built-in-battery-card', colSpan: 4 },
        { instanceId: 'w-gps', widgetId: 'built-in-gps-card', colSpan: 4 },
        { instanceId: 'w-messages-mini', widgetId: 'built-in-statustext-mini', colSpan: 12 },
      ],
      mode: 'cockpit',
      cockpit: {
        header: 'w-glareshield',
        root: {
          split: 'column',
          children: [
            { split: 'row', children: [{ pane: 'w-hud' }, { pane: 'w-map-flight' }], sizes: [45, 55] },
            {
              split: 'row',
              children: [{ pane: 'w-vfr' }, { pane: 'w-battery' }, { pane: 'w-gps' }],
              sizes: [33.34, 33.33, 33.33],
            },
          ],
          sizes: [64, 36],
        },
      },
      cockpitWide: {
        header: 'w-glareshield',
        root: {
          split: 'row',
          children: [
            { pane: 'w-hud' },
            { pane: 'w-map-flight' },
            {
              split: 'column',
              children: [{ pane: 'w-vfr' }, { pane: 'w-battery' }, { pane: 'w-gps' }, { pane: 'w-messages-mini' }],
              sizes: [25, 25, 25, 25],
            },
          ],
          sizes: [30, 46, 24],
        },
      },
    },
    {
      id: 'tab-map',
      title: 'Moving Map',
      widgets: [
        { instanceId: 'w-glareshield-map', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-map-large', widgetId: 'built-in-map', colSpan: 12 },
      ],
      mode: 'cockpit',
      cockpit: { header: 'w-glareshield-map', root: { pane: 'w-map-large' } },
    },
    {
      id: 'tab-telemetry',
      title: 'Telemetry',
      widgets: [
        { instanceId: 'w-charts', widgetId: 'built-in-charts', colSpan: 12 },
        { instanceId: 'w-vfr-2', widgetId: 'built-in-vfr-hud', colSpan: 6 },
        { instanceId: 'w-battery-2', widgetId: 'built-in-battery-card', colSpan: 6 },
      ],
    },
    {
      id: 'tab-console',
      title: 'Configuration',
      widgets: [
        { instanceId: 'w-console', widgetId: 'built-in-statustext', colSpan: 6 },
        { instanceId: 'w-params', widgetId: 'built-in-parameters', colSpan: 6 },
      ],
      // Messages and the parameter list side by side, each the full height of the window.
      mode: 'cockpit',
      cockpit: {
        header: null,
        root: { split: 'row', children: [{ pane: 'w-console' }, { pane: 'w-params' }], sizes: [40, 60] },
      },
    },
  ],
  customWidgets: [
    {
      id: 'custom-batt-voltage',
      name: 'Custom Bus Voltage',
      description: 'Quick voltmeter for main propulsion rail with low-voltage alerts',
      category: 'telemetry',
      displayType: 'gauge-linear',
      binding: {
        messageName: 'SYS_STATUS',
        fieldName: 'voltage_battery',
        unit: 'V',
        min: 12,
        max: 17,
        decimals: 2,
        warnThreshold: 14.4,
        critThreshold: 13.8,
        thresholdInvert: true,
      },
      colorScheme: 'green',
    },
    {
      id: 'custom-rc-bars',
      name: 'RC Input Channels 1–8',
      description: 'Live PWM pulse width bars for radio channels 1–8',
      category: 'telemetry',
      displayType: 'multi-bar',
      multiBarConfig: {
        group: 'rc-8',
      },
      colorScheme: 'blue',
    },
    {
      id: 'custom-wind-rose',
      name: 'Wind Direction & Vector',
      description: 'Real-time wind direction compass rose',
      category: 'avionics',
      displayType: 'compass-rose',
      binding: {
        messageName: 'WIND',
        fieldName: 'direction',
        unit: '°',
        min: 0,
        max: 360,
        decimals: 0,
      },
      colorScheme: 'default',
    },
    {
      id: 'custom-wp-speed-param',
      name: 'Cruise / WP Speed Setter',
      description: 'Adjust ArduPilot WPNAV_SPEED parameter in flight',
      category: 'control',
      displayType: 'param-control',
      paramControl: {
        paramId: 'WPNAV_SPEED',
        unit: 'cm/s',
        min: 100,
        max: 2000,
        step: 50,
        confirmation: true,
      },
      colorScheme: 'blue',
    },
    {
      id: 'custom-rtl-btn',
      name: 'Quick RTL Trigger',
      description: 'One-click Return to Launch button',
      category: 'control',
      displayType: 'action-button',
      action: {
        label: 'Trigger Return to Launch',
        commandId: 20, // MAV_CMD_NAV_RETURN_TO_LAUNCH
        params: [0, 0, 0, 0, 0, 0, 0],
        confirmation: true,
      },
      colorScheme: 'amber',
    },
  ],
};
