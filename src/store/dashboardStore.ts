import { create } from 'zustand';

import {
  addAtEdge,
  appendPane,
  buildPreset,
  movePane,
  movePaneToEdge,
  panesInOrder,
  pinAsHeader,
  placedOrUnchanged,
  QUICK_ACTIONS,
  removeFromLayout,
  replacePane,
  sanitizeCockpit,
  setSplitSizes,
  splitPane,
  unpinHeader,
  type CockpitPresetId,
  type CockpitVariant,
  type CompactPreviewId,
  type DropZone,
} from '../lib/cockpitLayout';
import { sanitizeWidgetDefinition } from '../lib/widgetValidation';
import { CockpitLayout, CustomWidgetDefinition, DashboardProfile, DashboardTab, PlacedWidget } from '../types/widget';

/**
 * The default dashboard, "Ground Station": three Cockpit tabs and a Flow tab. Familiar to Mission Planner users (HUD
 * top left, the map filling the right), built on what Glareshield adds: values that warn, health bars, charts, curated
 * parameter lists, and layouts for ultrawide screens, laptops and phones.
 * - Flight: Arm & Modes pinned on top; the HUD over Vitals (battery, voltage, current; HDOP, a logging light, a throttle
 *   gauge; vibration and EKF bars) on the left; the map with Track Error and messages on the right. A wide layout for
 *   ultrawides, a compact one (HUD, Vitals and the map side by side) for laptops.
 * - Map: the map, full window, to fly from and to plan.
 * - Tuning: PID tuning over curated parameter lists (patterns, so each vehicle shows its own), a map and Track Error
 *   over the full parameter list; on ultrawides each a full-height column, on laptops PID tuning beside the parameter
 *   list.
 * - Mobile (Flow): Arm & Modes, HUD, map, Vitals and messages in a phone's order.
 * Saved profiles are kept: this is what a first start, or Reset to Default Layout, gives.
 */
const DEFAULT_PROFILE: DashboardProfile = {
  version: '1.0.0',
  name: 'Ground Station',
  updatedAt: new Date().toISOString(),

  customWidgets: [
    {
      id: 'custom-vitals',
      name: 'Vitals',
      description:
        'What needs attention at a glance: battery, power, GNSS quality, logging and throttle, with vibration and EKF health. Values turn amber or red past their limits.',
      category: 'telemetry',
      displayType: 'composite',
      colorScheme: 'default',
      panels: [
        {
          displayType: 'stat-card',
          title: 'Battery',
          span: 4,
          colorScheme: 'green',
          binding: {
            messageName: 'SYS_STATUS',
            fieldName: 'battery_remaining',
            unit: '%',
            decimals: 0,
            min: 0,
            max: 100,
            warnThreshold: 30,
            critThreshold: 15,
            thresholdInvert: true,
          },
        },
        {
          displayType: 'stat-card',
          title: 'Voltage',
          span: 4,
          colorScheme: 'amber',
          binding: {
            messageName: 'SYS_STATUS',
            fieldName: 'voltage_battery',
            unit: 'V',
            decimals: 2,
          },
        },
        {
          displayType: 'stat-card',
          title: 'Current',
          span: 4,
          colorScheme: 'amber',
          binding: {
            messageName: 'SYS_STATUS',
            fieldName: 'current_battery',
            unit: 'A',
            decimals: 1,
          },
        },
        {
          displayType: 'stat-card',
          title: 'GNSS HDOP',
          span: 4,
          colorScheme: 'blue',
          binding: {
            messageName: 'GPS_RAW_INT',
            fieldName: 'eph',
            unit: '',
            decimals: 2,
            warnThreshold: 1.4,
            critThreshold: 2.0,
          },
        },
        // The onboard logger's health (SYS_STATUS sensor health bit 24, MAV_SYS_STATUS_LOGGING): ArduPilot clears it
        // when logging fails (no, full or failing SD card). A flight without a log is a common field mistake.
        {
          displayType: 'indicator-led',
          title: 'Logging',
          span: 4,
          colorScheme: 'green',
          binding: { messageName: 'SYS_STATUS', fieldName: 'onboard_control_sensors_health', bit: 24 },
          stateThreshold: 0,
          stateLabels: { on: 'OK', off: 'FAILED' },
          offAlert: 'crit',
        },
        {
          displayType: 'gauge-radial',
          title: 'Throttle',
          span: 4,
          colorScheme: 'amber',
          binding: {
            messageName: 'VFR_HUD',
            fieldName: 'throttle',
            unit: '%',
            decimals: 0,
            min: 0,
            max: 100,
          },
          gauge: {
            sweep: 240,
            style: 'arc',
            majorTicks: 5,
            minorTicks: 4,
          },
        },
        {
          displayType: 'multi-bar',
          title: 'Vibration',
          span: 6,
          multiBarConfig: {
            group: 'vibration-xyz',
          },
        },
        {
          displayType: 'multi-bar',
          title: 'EKF variances',
          span: 6,
          multiBarConfig: {
            group: 'ekf-variances',
          },
        },
      ],
    },
    {
      id: 'custom-track-error',
      name: 'Track Error',
      description:
        'How far off its path the vehicle is in Auto and Guided: cross-track error (all vehicles) and altitude error (aircraft). Flat at zero otherwise.',
      category: 'telemetry',
      displayType: 'sparkline',
      colorScheme: 'blue',
      binding: {
        messageName: 'NAV_CONTROLLER_OUTPUT',
        fieldName: 'xtrack_error',
        unit: 'm',
        decimals: 1,
        unitKind: 'distance',
        label: 'Cross-track',
        color: '#38bdf8',
      },
      bindings: [
        {
          messageName: 'NAV_CONTROLLER_OUTPUT',
          fieldName: 'alt_error',
          unit: 'm',
          decimals: 1,
          unitKind: 'altitude',
          label: 'Altitude',
          color: '#f59e0b',
        },
      ],
    },
    {
      id: 'custom-attitude-tuning',
      name: 'Attitude Tuning',
      description:
        "The rate and angle controllers' gains: Copter and Rover ATC_*, Plane RLL_ / PTCH_ / YAW_RATE_*. Only the vehicle's own are listed.",
      category: 'control',
      displayType: 'param-set',
      colorScheme: 'blue',
      paramSet: {
        params: [
          'ATC_RAT_RLL_*',
          'ATC_RAT_PIT_*',
          'ATC_RAT_YAW_*',
          'ATC_ANG_*',
          'ATC_ACCEL_*',
          'RLL_RATE_*',
          'PTCH_RATE_*',
          'YAW_RATE_*',
          '-*_SMAX',
          '-*_PDMX',
          '-*_NTF',
          '-*_NEF',
          '-*_FLT?',
          '-*_D_FF',
        ],
        confirmation: true,
      },
    },
    {
      id: 'custom-navigation',
      name: 'Navigation',
      description:
        'How it flies between waypoints: Copter WPNAV_*, LOIT_* and position controller gains; Plane NAVL1_*, TECS speed and height limits, WP_* and airspeeds.',
      category: 'control',
      displayType: 'param-set',
      colorScheme: 'green',
      paramSet: {
        params: [
          'WPNAV_*',
          'LOIT_SPEED*',
          'LOIT_ACC_MAX*',
          'PSC_POSXY_P*',
          'PSC_VELXY_*',
          'PSC_POSZ_P*',
          'PSC_VELZ_P*',
          'NAVL1_*',
          'WP_*',
          'TECS_CLMB_MAX*',
          'TECS_SINK_*',
          'TECS_TIME_CONST*',
          'TECS_SPDWEIGHT*',
          'TECS_PITCH_M*',
          'AIRSPEED_CRUISE*',
          'AIRSPEED_MIN*',
          'AIRSPEED_MAX*',
          '-*_SMAX',
          '-*_PDMX',
          '-*_NTF',
          '-*_NEF',
          '-*_FLT?',
          '-*_D_FF',
        ],
        confirmation: true,
      },
    },
    {
      id: 'custom-failsafes',
      name: 'Failsafes & RTL',
      description: 'What it does when something goes wrong: battery, radio and GCS failsafes, and the return home.',
      category: 'control',
      displayType: 'param-set',
      colorScheme: 'red',
      paramSet: {
        params: ['FS_*', 'BATT_FS_*', 'BATT_LOW_*', 'BATT_CRT_*', 'THR_FS*', 'RTL_*', 'FENCE_ENABLE*', 'FENCE_ACTION*'],
        confirmation: true,
      },
    },
    // Samples for the custom widget list (Add Widget): on no tab, ready to place or copy.
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
      multiBarConfig: { group: 'rc-8' },
      colorScheme: 'blue',
    },
    {
      id: 'custom-wind-rose',
      name: 'Wind Direction & Vector',
      description: 'Real-time wind direction compass rose',
      category: 'avionics',
      displayType: 'compass-rose',
      binding: { messageName: 'WIND', fieldName: 'direction', unit: '°', min: 0, max: 360, decimals: 0 },
      colorScheme: 'default',
    },
    {
      id: 'custom-wp-speed-param',
      name: 'Cruise / WP Speed Setter',
      description: 'Adjust ArduPilot WPNAV_SPEED parameter in flight',
      category: 'control',
      displayType: 'param-control',
      paramControl: { paramId: 'WPNAV_SPEED', unit: 'cm/s', min: 100, max: 2000, step: 50, confirmation: true },
      colorScheme: 'blue',
    },
    {
      id: 'custom-rtl-btn',
      name: 'Quick RTL Trigger',
      description: 'One-click Return to Launch button',
      category: 'control',
      displayType: 'action-button',
      action: { label: 'Trigger Return to Launch', commandId: 20, params: [0, 0, 0, 0, 0, 0, 0], confirmation: true },
      colorScheme: 'amber',
    },
  ],
  tabs: [
    {
      id: 'tab-flight',
      title: 'Flight',
      widgets: [
        {
          instanceId: 'w-actions',
          widgetId: 'built-in-glareshield',
          colSpan: 12,
        },
        {
          instanceId: 'w-hud',
          widgetId: 'built-in-hud',
          colSpan: 4,
        },
        {
          instanceId: 'w-map',
          widgetId: 'built-in-map',
          colSpan: 8,
        },
        {
          instanceId: 'w-vitals',
          widgetId: 'custom-vitals',
          colSpan: 4,
        },
        {
          instanceId: 'w-messages',
          widgetId: 'built-in-statustext-mini',
          colSpan: 4,
        },
        {
          instanceId: 'w-track',
          widgetId: 'custom-track-error',
          colSpan: 6,
        },
      ],
      mode: 'cockpit',
      cockpit: {
        header: 'w-actions',
        root: {
          split: 'row',
          sizes: [34, 66],
          children: [
            {
              split: 'column',
              sizes: [35, 65],
              children: [
                {
                  pane: 'w-hud',
                },
                {
                  pane: 'w-vitals',
                },
              ],
            },
            {
              split: 'column',
              sizes: [73, 27],
              children: [
                {
                  pane: 'w-map',
                },
                {
                  split: 'row',
                  sizes: [50, 50],
                  children: [
                    {
                      pane: 'w-track',
                    },
                    {
                      pane: 'w-messages',
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      cockpitWide: {
        header: 'w-actions',
        root: {
          split: 'row',
          sizes: [27, 49, 24],
          children: [
            {
              split: 'column',
              sizes: [50, 50],
              children: [
                {
                  pane: 'w-hud',
                },
                {
                  pane: 'w-vitals',
                },
              ],
            },
            {
              pane: 'w-map',
            },
            {
              split: 'column',
              sizes: [50, 50],
              children: [
                {
                  pane: 'w-track',
                },
                {
                  pane: 'w-messages',
                },
              ],
            },
          ],
        },
      },
      cockpitCompact: {
        header: 'w-actions',
        root: {
          split: 'row',
          sizes: [30, 36, 34],
          children: [
            {
              pane: 'w-hud',
            },
            {
              pane: 'w-vitals',
            },
            {
              split: 'column',
              sizes: [74, 26],
              children: [
                {
                  pane: 'w-map',
                },
                {
                  pane: 'w-messages',
                },
              ],
            },
          ],
        },
      },
    },
    {
      id: 'tab-map',
      title: 'Map',
      widgets: [
        {
          instanceId: 'w-plan-map',
          widgetId: 'built-in-map',
          colSpan: 12,
        },
      ],
      mode: 'cockpit',
      cockpit: {
        header: null,
        root: {
          pane: 'w-plan-map',
        },
      },
    },
    {
      id: 'tab-tuning',
      title: 'Tuning',
      widgets: [
        {
          instanceId: 'w-pid',
          widgetId: 'built-in-pid-tuning',
          colSpan: 12,
        },
        {
          instanceId: 'w-tune-map',
          widgetId: 'built-in-map',
          colSpan: 4,
        },
        {
          instanceId: 'w-tune-track',
          widgetId: 'custom-track-error',
          colSpan: 4,
        },
        {
          instanceId: 'w-attitude',
          widgetId: 'custom-attitude-tuning',
          colSpan: 4,
        },
        {
          instanceId: 'w-navigation',
          widgetId: 'custom-navigation',
          colSpan: 4,
        },
        {
          instanceId: 'w-failsafes',
          widgetId: 'custom-failsafes',
          colSpan: 4,
        },
        {
          instanceId: 'w-params',
          widgetId: 'built-in-parameters',
          colSpan: 12,
        },
      ],
      mode: 'cockpit',
      cockpit: {
        header: null,
        root: {
          split: 'row',
          sizes: [68, 32],
          children: [
            {
              split: 'column',
              sizes: [50, 50],
              children: [
                {
                  pane: 'w-pid',
                },
                {
                  split: 'row',
                  sizes: [34, 33, 33],
                  children: [
                    {
                      pane: 'w-attitude',
                    },
                    {
                      pane: 'w-navigation',
                    },
                    {
                      pane: 'w-failsafes',
                    },
                  ],
                },
              ],
            },
            {
              split: 'column',
              sizes: [36, 28, 36],
              children: [
                {
                  pane: 'w-tune-map',
                },
                {
                  pane: 'w-tune-track',
                },
                {
                  pane: 'w-params',
                },
              ],
            },
          ],
        },
      },
      // Ultrawide: PID tuning a tall column (both charts at full size), each curated list a full-height column, then
      // the map and Track Error over the full parameter list.
      cockpitWide: {
        header: null,
        root: {
          split: 'row',
          sizes: [30, 15, 15, 15, 25],
          children: [
            { pane: 'w-pid' },
            { pane: 'w-attitude' },
            { pane: 'w-navigation' },
            { pane: 'w-failsafes' },
            {
              split: 'column',
              sizes: [38, 24, 38],
              children: [{ pane: 'w-tune-map' }, { pane: 'w-tune-track' }, { pane: 'w-params' }],
            },
          ],
        },
      },
      cockpitCompact: {
        header: null,
        root: {
          split: 'row',
          sizes: [60, 40],
          children: [
            {
              pane: 'w-pid',
            },
            {
              pane: 'w-params',
            },
          ],
        },
      },
    },
    // A Flow tab for phones (and a scrolling dashboard elsewhere): the cards in the order a phone in the field wants
    // them, full width on a phone; on wider screens the HUD and map side by side.
    {
      id: 'tab-mobile',
      title: 'Mobile',
      widgets: [
        { instanceId: 'w-m-actions', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-m-hud', widgetId: 'built-in-hud', colSpan: 6 },
        { instanceId: 'w-m-map', widgetId: 'built-in-map', colSpan: 6 },
        { instanceId: 'w-m-vitals', widgetId: 'custom-vitals', colSpan: 12 },
        { instanceId: 'w-m-messages', widgetId: 'built-in-statustext-mini', colSpan: 12 },
      ],
    },
  ],
};

const STORAGE_KEY = 'mavlink_glareshield_profile_v1';

/**
 * A tab made consistent: its mode one of the two, and its Cockpit layout (if any) referring only to its own widgets,
 * each once (lib/cockpitLayout.ts). Applied to every tab that's loaded, imported, or loses a widget.
 */
export function reconcileTab(tab: DashboardTab): DashboardTab {
  const widgets = Array.isArray(tab.widgets) ? tab.widgets : [];
  const mode = tab.mode === 'cockpit' ? 'cockpit' : undefined;
  const ids = widgets.map((w) => w.instanceId);
  const cockpit = tab.cockpit ? (sanitizeCockpit(tab.cockpit, ids) ?? undefined) : undefined;
  const cockpitWide = tab.cockpitWide ? (sanitizeCockpit(tab.cockpitWide, ids) ?? undefined) : undefined;
  const cockpitCompact = tab.cockpitCompact ? (sanitizeCockpit(tab.cockpitCompact, ids) ?? undefined) : undefined;
  const { mode: _m, cockpit: _c, cockpitWide: _w, cockpitCompact: _k, ...rest } = tab;
  return {
    ...rest,
    widgets,
    ...(mode ? { mode } : {}),
    ...(cockpit ? { cockpit } : {}),
    ...(cockpitWide ? { cockpitWide } : {}),
    ...(cockpitCompact ? { cockpitCompact } : {}),
  };
}

/** A widget placed in a Cockpit layout: the quick-actions bar pinned as the header when none is, else a new pane. */
function placeWidget(layout: CockpitLayout | undefined, instanceId: string, widgetId: string): CockpitLayout {
  const current = layout ?? { header: null, root: null };
  const quickActions = widgetId === 'built-in-glareshield' || widgetId === 'built-in-arm-modes';
  return quickActions && !current.header ? { ...current, header: instanceId } : appendPane(current, instanceId);
}

/** What a pane is to show: a new widget of a type, or a widget already on the tab (hidden from the layout). */
export type PaneSource = { widgetId: string } | { instanceId: string };

/** The field holding a tab's layout of a variant. */
const LAYOUT_KEY = { standard: 'cockpit', wide: 'cockpitWide', compact: 'cockpitCompact' } as const;

/** Every layout variant, in the order the editor lists them. */
export const COCKPIT_VARIANTS: CockpitVariant[] = ['standard', 'wide', 'compact'];

/** The layout the editor works on: the one asked for if the tab has it, else the standard one. */
export function editTarget(tab: DashboardTab, v: CockpitVariant): CockpitVariant {
  return v !== 'standard' && layoutOf(tab, v) ? v : 'standard';
}

/** The tab's other layouts (than `v`) that exist: where deleting a widget also takes it from. */
export function otherLayouts(tab: DashboardTab, v: CockpitVariant): CockpitVariant[] {
  return COCKPIT_VARIANTS.filter((x) => x !== v && layoutOf(tab, x));
}

/** A tab's layout of a variant (the wide and compact ones may be missing). */
export function layoutOf(tab: DashboardTab, variant: CockpitVariant): CockpitLayout | undefined {
  return tab[LAYOUT_KEY[variant]];
}

/** The tab with its layout of a variant replaced. */
function withLayout(tab: DashboardTab, variant: CockpitVariant, layout: CockpitLayout): DashboardTab {
  return { ...tab, [LAYOUT_KEY[variant]]: layout };
}

/**
 * Whether `what` can go beside or in place of the pane `target`: the tab has a layout showing that pane, and a widget
 * from the tab is one of its own and not already shown (shown twice, one copy would be dropped, losing a pane).
 */
function canPlace(layout: CockpitLayout | undefined, tab: DashboardTab, target: string, what: PaneSource): boolean {
  if (!layout?.root) return false;
  const shown = panesInOrder(layout);
  if (!panesInOrder({ header: null, root: layout.root }).includes(target)) return false;
  if ('instanceId' in what)
    return tab.widgets.some((w) => w.instanceId === what.instanceId) && !shown.includes(what.instanceId);
  return true;
}

/** The tab with the widget for `what` (added when it's a new one), and its instance ID. */
function sourceInstance(tab: DashboardTab, what: PaneSource): { tab: DashboardTab; instanceId: string } {
  if ('instanceId' in what) return { tab, instanceId: what.instanceId };
  const instanceId = newInstanceId();
  return {
    tab: { ...tab, widgets: [...tab.widgets, { instanceId, widgetId: what.widgetId, colSpan: 6 }] },
    instanceId,
  };
}

const newInstanceId = () => `w-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

function loadInitialProfile(): DashboardProfile {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && Array.isArray(parsed.tabs)) {
          const OLD_TO_NEW_TITLES: Record<string, string> = {
            'Flight Deck': 'HUD',
            'Tactical Map': 'Moving Map',
            'Instruments & Graphs': 'Telemetry',
            'Messages & Params': 'Configuration',
          };
          parsed.tabs = parsed.tabs.map((t: DashboardTab) =>
            reconcileTab({
              ...t,
              title: OLD_TO_NEW_TITLES[t.title] || t.title,
            })
          );
        }
        // Saved widgets get the same structural cleaning as imports (older saved formats, or storage edited by
        // hand), but keep the confirmation settings their owner chose.
        if (parsed && Array.isArray(parsed.customWidgets)) {
          parsed.customWidgets = parsed.customWidgets
            .filter((w: unknown) => w && typeof w === 'object' && typeof (w as CustomWidgetDefinition).id === 'string')
            .map((w: CustomWidgetDefinition) => sanitizeWidgetDefinition(w, { forceConfirmation: false }));
        }
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load profile from localStorage:', e);
  }
  return DEFAULT_PROFILE;
}

function saveProfileToStorage(profile: DashboardProfile) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }
  } catch (e) {
    console.warn('Failed to save profile to localStorage:', e);
  }
}

export interface DashboardState {
  profile: DashboardProfile;
  activeTabId: string;
  isEditing: boolean;

  setActiveTab: (tabId: string) => void;
  toggleEditing: () => void;
  setEditing: (editing: boolean) => void;

  // Tabs
  addTab: (title: string) => void;
  removeTab: (tabId: string) => void;
  renameTab: (tabId: string, newTitle: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Widgets in Active Tab
  addWidgetToActiveTab: (widgetId: string, colSpan?: number) => void;
  removeWidgetFromActiveTab: (instanceId: string) => void;
  updateWidgetColSpan: (instanceId: string, colSpan: number) => void;
  updateWidgetRowSpan: (instanceId: string, rowSpan: number) => void;
  moveWidget: (instanceId: string, direction: 'up' | 'down') => void;
  reorderWidgetsInActiveTab: (fromIndex: number, toIndex: number) => void;

  // Cockpit tabs
  /** Switch a tab between Flow and Cockpit (a tab without a Cockpit layout gets one from its widgets). */
  setTabMode: (tabId: string, mode: 'flow' | 'cockpit') => void;
  /** Lay a tab out as a preset (switching it to Cockpit); its own widgets are reused, missing ones added. */
  applyCockpitPreset: (tabId: string, preset: CockpitPresetId) => void;
  /** New sizes for the split at `path` (after a divider drag). */
  setCockpitSizes: (tabId: string, path: number[], sizes: number[]) => void;
  /** Show a tab widget the layout doesn't place, as a new pane. */
  placeInCockpit: (tabId: string, instanceId: string) => void;
  /** Take a widget out of the layout (it stays on the tab, unplaced). */
  unplaceFromCockpit: (tabId: string, instanceId: string) => void;
  /** Put a widget beside, above or below a pane: a new one of a type, or one of the tab's hidden widgets. */
  splitInCockpit: (
    tabId: string,
    targetInstanceId: string,
    side: Exclude<DropZone, 'center'>,
    what: PaneSource
  ) => void;
  /** Put a widget along a whole edge of the layout (a full-width row, a full-height column). */
  addAtEdgeInCockpit: (tabId: string, side: Exclude<DropZone, 'center'>, what: PaneSource) => void;
  /** The pinned bar becomes a pane (across the bottom), to move and resize like the others. */
  unpinInCockpit: (tabId: string) => void;
  /** The quick-actions bar, as a pane, pinned above the panes again. */
  pinInCockpit: (tabId: string, instanceId: string) => void;
  /** Move a pane to a whole edge of the layout. */
  moveToEdgeInCockpit: (tabId: string, srcInstanceId: string, side: Exclude<DropZone, 'center'>) => void;
  /** Show another widget in a pane (the one it showed stays on the tab, hidden). */
  replaceInCockpit: (tabId: string, targetInstanceId: string, what: PaneSource) => void;
  /** Move a pane beside, above or below another, or (centre) swap the two. */
  moveInCockpit: (tabId: string, srcInstanceId: string, targetInstanceId: string, zone: DropZone) => void;
  /** Which of a tab's Cockpit layouts the editor works on (the wide one only if the tab has it). */
  editVariant: CockpitVariant;
  setEditVariant: (v: CockpitVariant) => void;
  /** While editing a compact layout: the laptop window it's previewed in (not saved). */
  compactPreview: CompactPreviewId;
  setCompactPreview: (id: CompactPreviewId) => void;
  /** Give a tab a wide or compact layout (a copy of its standard one) and edit it. */
  addLayout: (tabId: string, variant: 'wide' | 'compact') => void;
  /** Drop a tab's wide or compact layout. */
  removeLayout: (tabId: string, variant: 'wide' | 'compact') => void;
  /** addLayout(tabId, 'wide'). */
  addWideLayout: (tabId: string) => void;
  /** removeLayout(tabId, 'wide'). */
  removeWideLayout: (tabId: string) => void;
  /** Change the layout being edited (`create`: make an empty one if the tab has none). */
  updateLayout: (
    tabId: string,
    fn: (layout: CockpitLayout, tab: DashboardTab) => CockpitLayout,
    create?: boolean
  ) => void;
  /** Change one tab (made consistent and saved). */
  updateTab: (tabId: string, fn: (tab: DashboardTab) => DashboardTab) => void;

  // Custom Widgets
  saveCustomWidget: (def: CustomWidgetDefinition) => void;
  deleteCustomWidget: (widgetId: string) => void;

  // Import / Export / Reset
  exportProfileJson: () => string;
  importProfileJson: (jsonStr: string) => boolean;
  resetToDefaults: () => void;
}

/**
 * The tab the dashboard shows: the active one, or the first if the active id names no tab (the dashboard falls back
 * the same way). The "active tab" actions act on this one, so they never silently miss the tab on screen.
 */
export function shownTabId(state: Pick<DashboardState, 'profile' | 'activeTabId'>): string {
  const tabs = state.profile.tabs;
  return tabs.some((t) => t.id === state.activeTabId) ? state.activeTabId : (tabs[0]?.id ?? state.activeTabId);
}

const initialProfile = loadInitialProfile();

export const useDashboardStore = create<DashboardState>((set, get) => ({
  profile: initialProfile,
  // The default HUD tab when the saved profile has it, else its first tab (an imported or edited profile may not).
  activeTabId: shownTabId({ profile: initialProfile, activeTabId: 'tab-flight' }),
  isEditing: false,

  setActiveTab: (tabId: string) => set({ activeTabId: tabId }),
  toggleEditing: () => set((state) => ({ isEditing: !state.isEditing })),
  setEditing: (editing: boolean) => set({ isEditing: editing }),

  addTab: (title: string) => {
    const id = `tab-${Date.now()}`;
    set((state) => {
      const newTabs: DashboardTab[] = [...state.profile.tabs, { id, title: title.trim() || 'New View', widgets: [] }];
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile, activeTabId: id };
    });
  },

  removeTab: (tabId: string) => {
    set((state) => {
      if (state.profile.tabs.length <= 1) return {};
      const newTabs = state.profile.tabs.filter((t) => t.id !== tabId);
      const newActive = state.activeTabId === tabId ? newTabs[0].id : state.activeTabId;
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile, activeTabId: newActive };
    });
  },

  renameTab: (tabId: string, newTitle: string) => {
    set((state) => {
      const newTabs = state.profile.tabs.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t));
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  reorderTabs: (fromIndex: number, toIndex: number) => {
    set((state) => {
      const tabs = [...state.profile.tabs];
      if (fromIndex < 0 || fromIndex >= tabs.length || toIndex < 0 || toIndex >= tabs.length || fromIndex === toIndex) {
        return {};
      }
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      const newProfile = { ...state.profile, tabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  addWidgetToActiveTab: (widgetId: string, colSpan = 6) => {
    const activeTabId = shownTabId(get());
    const instanceId = `w-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const newWidget: PlacedWidget = { instanceId, widgetId, colSpan };
        // A Cockpit tab shows it as a new pane; the quick-actions bar, if the tab has none pinned, as the header.
        // (In the layout being edited; the other one lists it as not shown.)
        const v = editTarget(tab, state.editVariant);
        const withWidget = { ...tab, widgets: [...tab.widgets, newWidget] };
        return reconcileTab(
          tab.mode !== 'cockpit'
            ? withWidget
            : withLayout(withWidget, v, placeWidget(layoutOf(tab, v), instanceId, widgetId))
        );
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  removeWidgetFromActiveTab: (instanceId: string) => {
    const activeTabId = shownTabId(get());
    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        // Its pane goes too (its neighbours take the room).
        return reconcileTab({ ...tab, widgets: tab.widgets.filter((w) => w.instanceId !== instanceId) });
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  updateWidgetColSpan: (instanceId: string, colSpan: number) => {
    const activeTabId = shownTabId(get());
    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        return {
          ...tab,
          widgets: tab.widgets.map((w) => (w.instanceId === instanceId ? { ...w, colSpan } : w)),
        };
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  updateWidgetRowSpan: (instanceId: string, rowSpan: number) => {
    const activeTabId = shownTabId(get());
    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        return {
          ...tab,
          widgets: tab.widgets.map((w) => (w.instanceId === instanceId ? { ...w, rowSpan } : w)),
        };
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  moveWidget: (instanceId: string, direction: 'up' | 'down') => {
    const activeTabId = shownTabId(get());
    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const index = tab.widgets.findIndex((w) => w.instanceId === instanceId);
        if (index === -1) return tab;

        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= tab.widgets.length) return tab;

        const newWidgets = [...tab.widgets];
        const [moved] = newWidgets.splice(index, 1);
        newWidgets.splice(targetIndex, 0, moved);

        return { ...tab, widgets: newWidgets };
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  reorderWidgetsInActiveTab: (fromIndex: number, toIndex: number) => {
    const activeTabId = shownTabId(get());
    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        if (
          fromIndex < 0 ||
          fromIndex >= tab.widgets.length ||
          toIndex < 0 ||
          toIndex >= tab.widgets.length ||
          fromIndex === toIndex
        ) {
          return tab;
        }
        const newWidgets = [...tab.widgets];
        const [moved] = newWidgets.splice(fromIndex, 1);
        newWidgets.splice(toIndex, 0, moved);
        return { ...tab, widgets: newWidgets };
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  setTabMode: (tabId, mode) => {
    get().updateTab(tabId, (tab) => {
      if (mode === 'flow') return { ...tab, mode: undefined };
      if (tab.cockpit && tab.cockpit.root) return { ...tab, mode: 'cockpit' };
      // No layout yet: one from the tab's own widgets.
      const { widgets, layout } = buildPreset('from-tab', tab.widgets, newInstanceId);
      return { ...tab, widgets, cockpit: layout, mode: 'cockpit' };
    });
  },

  applyCockpitPreset: (tabId, preset) => {
    const v = get().editVariant;
    get().updateTab(tabId, (tab) => {
      const { widgets, layout } = buildPreset(preset, tab.widgets, newInstanceId);
      return {
        ...withLayout({ ...tab, widgets }, editTarget(tab, v), layout),
        mode: 'cockpit',
      };
    });
  },

  setCockpitSizes: (tabId, path, sizes) => {
    get().updateLayout(tabId, (layout) => setSplitSizes(layout, path, sizes));
  },

  placeInCockpit: (tabId, instanceId) => {
    get().updateLayout(
      tabId,
      (layout, tab) =>
        placeWidget(layout, instanceId, tab.widgets.find((w) => w.instanceId === instanceId)?.widgetId ?? ''),
      true
    );
  },

  unplaceFromCockpit: (tabId, instanceId) => {
    get().updateLayout(tabId, (layout, tab) =>
      removeFromLayout(
        layout,
        instanceId,
        tab.widgets.map((w) => w.instanceId)
      )
    );
  },

  splitInCockpit: (tabId, target, side, what) => {
    const v = get().editVariant;
    get().updateTab(tabId, (t) => {
      const variant = editTarget(t, v);
      const layout = layoutOf(t, variant);
      if (!canPlace(layout, t, target, what)) return t;
      const { tab, instanceId } = sourceInstance(t, what);
      const next = sanitizeCockpit(
        splitPane(layout!, target, side, instanceId),
        tab.widgets.map((w) => w.instanceId)
      );
      // Past the depth or pane limits: nothing changes (no pane lost, no new widget left unplaced).
      const placed = placedOrUnchanged(layout!, next, [instanceId]);
      return placed === layout ? t : withLayout(tab, variant, placed);
    });
  },

  addAtEdgeInCockpit: (tabId, side, what) => {
    const v = get().editVariant;
    get().updateTab(tabId, (t) => {
      const variant = editTarget(t, v);
      const layout = layoutOf(t, variant) ?? { header: null, root: null };
      // A widget from the tab: its own, and not already shown.
      if (
        'instanceId' in what &&
        (!t.widgets.some((w) => w.instanceId === what.instanceId) || panesInOrder(layout).includes(what.instanceId))
      )
        return t;
      const { tab, instanceId } = sourceInstance(t, what);
      const placed = placedOrUnchanged(
        layout,
        sanitizeCockpit(
          addAtEdge(layout, instanceId, side),
          tab.widgets.map((w) => w.instanceId)
        ),
        [instanceId]
      );
      return placed === layout ? t : withLayout(tab, variant, placed);
    });
  },

  unpinInCockpit: (tabId) => {
    get().updateLayout(tabId, (layout, tab) =>
      unpinHeader(
        layout,
        tab.widgets.map((w) => w.instanceId)
      )
    );
  },

  pinInCockpit: (tabId, instanceId) => {
    get().updateLayout(tabId, (layout, tab) => {
      const w = tab.widgets.find((x) => x.instanceId === instanceId);
      if (!w || !QUICK_ACTIONS.has(w.widgetId)) return layout;
      return pinAsHeader(
        layout,
        instanceId,
        tab.widgets.map((x) => x.instanceId)
      );
    });
  },

  moveToEdgeInCockpit: (tabId, src, side) => {
    get().updateLayout(tabId, (layout, tab) =>
      movePaneToEdge(
        layout,
        src,
        side,
        tab.widgets.map((w) => w.instanceId)
      )
    );
  },

  replaceInCockpit: (tabId, target, what) => {
    const v = get().editVariant;
    get().updateTab(tabId, (t) => {
      const variant = editTarget(t, v);
      const layout = layoutOf(t, variant);
      if (!canPlace(layout, t, target, what)) return t;
      const { tab, instanceId } = sourceInstance(t, what);
      return withLayout(tab, variant, replacePane(layout!, target, instanceId));
    });
  },

  moveInCockpit: (tabId, src, target, zone) => {
    get().updateLayout(tabId, (layout, tab) =>
      movePane(
        layout,
        src,
        target,
        zone,
        tab.widgets.map((w) => w.instanceId)
      )
    );
  },

  editVariant: 'standard',
  setEditVariant: (editVariant) => set({ editVariant }),

  compactPreview: '1366',
  setCompactPreview: (compactPreview) => set({ compactPreview }),

  addLayout: (tabId, variant) => {
    get().updateTab(tabId, (tab) =>
      layoutOf(tab, variant) ? tab : withLayout(tab, variant, tab.cockpit ?? { header: null, root: null })
    );
    set({ editVariant: variant });
  },

  removeLayout: (tabId, variant) => {
    get().updateTab(tabId, (tab) => {
      const next = { ...tab };
      delete next[LAYOUT_KEY[variant]];
      return next;
    });
    set({ editVariant: 'standard' });
  },

  addWideLayout: (tabId) => get().addLayout(tabId, 'wide'),
  removeWideLayout: (tabId) => get().removeLayout(tabId, 'wide'),

  updateLayout: (tabId, fn, create = false) => {
    const v = get().editVariant;
    get().updateTab(tabId, (tab) => {
      const variant = editTarget(tab, v);
      const layout = layoutOf(tab, variant) ?? (create ? { header: null, root: null } : undefined);
      return layout ? withLayout(tab, variant, fn(layout, tab)) : tab;
    });
  },

  updateTab: (tabId, fn) => {
    set((state) => {
      const tabs = state.profile.tabs.map((t) => (t.id === tabId ? reconcileTab(fn(t)) : t));
      const newProfile = { ...state.profile, tabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  saveCustomWidget: (def: CustomWidgetDefinition) => {
    set((state) => {
      const existing = state.profile.customWidgets.findIndex((w) => w.id === def.id);
      let updatedCustom = [...state.profile.customWidgets];
      if (existing >= 0) {
        updatedCustom[existing] = def;
      } else {
        updatedCustom.push(def);
      }
      const newProfile = {
        ...state.profile,
        customWidgets: updatedCustom,
        updatedAt: new Date().toISOString(),
      };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  deleteCustomWidget: (widgetId: string) => {
    set((state) => {
      const updatedCustom = state.profile.customWidgets.filter((w) => w.id !== widgetId);
      // Its instances leave every tab, and their panes every Cockpit layout.
      const updatedTabs = state.profile.tabs.map((t) =>
        reconcileTab({
          ...t,
          widgets: t.widgets.filter((w) => w.widgetId !== widgetId),
        })
      );
      const newProfile = {
        ...state.profile,
        tabs: updatedTabs,
        customWidgets: updatedCustom,
        updatedAt: new Date().toISOString(),
      };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  exportProfileJson: () => {
    return JSON.stringify(get().profile, null, 2);
  },

  importProfileJson: (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr) as DashboardProfile;
      if (parsed && Array.isArray(parsed.tabs)) {
        // Enforce confirmation and validate any imported custom widget actions and param controls for safety
        if (Array.isArray(parsed.customWidgets)) {
          parsed.customWidgets = parsed.customWidgets.map((w) => sanitizeWidgetDefinition(w));
        }
        // Cockpit layouts: only the tab's own widgets, each once, bounded (as when loading).
        parsed.tabs = parsed.tabs.map((t) => reconcileTab(t));
        saveProfileToStorage(parsed);
        set({
          profile: parsed,
          activeTabId: parsed.tabs[0]?.id || 'tab-flight',
          editVariant: 'standard',
        });
        return true;
      }
    } catch (e) {
      console.error('Invalid profile JSON import:', e);
    }
    return false;
  },

  resetToDefaults: () => {
    saveProfileToStorage(DEFAULT_PROFILE);
    set({
      profile: DEFAULT_PROFILE,
      activeTabId: 'tab-flight',
      isEditing: false,
      editVariant: 'standard',
    });
  },
}));
