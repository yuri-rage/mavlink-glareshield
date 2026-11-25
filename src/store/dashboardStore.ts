import { sanitizeWidgetDefinition } from '../lib/widgetValidation';
import { create } from 'zustand';
import { appendPane, buildPreset, movePane, panesInOrder, placedOrUnchanged, removeFromLayout, replacePane, sanitizeCockpit, setSplitSizes, splitPane, type CockpitPresetId, type CockpitVariant, type DropZone } from '../lib/cockpitLayout';
import {
  CockpitLayout,
  DashboardProfile,
  DashboardTab,
  PlacedWidget,
  CustomWidgetDefinition,
} from '../types/widget';

const DEFAULT_PROFILE: DashboardProfile = {
  version: '1.0.0',
  name: 'Default ArduPilot Layout',
  updatedAt: new Date().toISOString(),
  tabs: [
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
      ],
    },
    {
      id: 'tab-map',
      title: 'Moving Map',
      widgets: [
        { instanceId: 'w-glareshield-map', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-map-large', widgetId: 'built-in-map', colSpan: 12 },
      ],
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

const STORAGE_KEY = 'mavlink_glareshield_profile_v1';

/**
 * A tab made consistent: its mode one of the two, and its Cockpit layout (if any) referring only to its own widgets,
 * each once (lib/cockpitLayout.ts). Applied to every tab that's loaded, imported, or loses a widget.
 */
export function reconcileTab(tab: DashboardTab): DashboardTab {
  const widgets = Array.isArray(tab.widgets) ? tab.widgets : [];
  const mode = tab.mode === 'cockpit' ? 'cockpit' : undefined;
  const ids = widgets.map((w) => w.instanceId);
  const cockpit = tab.cockpit ? sanitizeCockpit(tab.cockpit, ids) ?? undefined : undefined;
  const cockpitWide = tab.cockpitWide ? sanitizeCockpit(tab.cockpitWide, ids) ?? undefined : undefined;
  const { mode: _m, cockpit: _c, cockpitWide: _w, ...rest } = tab;
  return { ...rest, widgets, ...(mode ? { mode } : {}), ...(cockpit ? { cockpit } : {}), ...(cockpitWide ? { cockpitWide } : {}) };
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
const LAYOUT_KEY = { standard: 'cockpit', wide: 'cockpitWide' } as const;

/** A tab's layout of a variant (the wide one may be missing). */
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
  if ('instanceId' in what) return tab.widgets.some((w) => w.instanceId === what.instanceId) && !shown.includes(what.instanceId);
  return true;
}

/** The tab with the widget for `what` (added when it's a new one), and its instance ID. */
function sourceInstance(tab: DashboardTab, what: PaneSource): { tab: DashboardTab; instanceId: string } {
  if ('instanceId' in what) return { tab, instanceId: what.instanceId };
  const instanceId = newInstanceId();
  return { tab: { ...tab, widgets: [...tab.widgets, { instanceId, widgetId: what.widgetId, colSpan: 6 }] }, instanceId };
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

interface DashboardState {
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
  splitInCockpit: (tabId: string, targetInstanceId: string, side: Exclude<DropZone, 'center'>, what: PaneSource) => void;
  /** Show another widget in a pane (the one it showed stays on the tab, hidden). */
  replaceInCockpit: (tabId: string, targetInstanceId: string, what: PaneSource) => void;
  /** Move a pane beside, above or below another, or (centre) swap the two. */
  moveInCockpit: (tabId: string, srcInstanceId: string, targetInstanceId: string, zone: DropZone) => void;
  /** Which of a tab's Cockpit layouts the editor works on (the wide one only if the tab has it). */
  editVariant: CockpitVariant;
  setEditVariant: (v: CockpitVariant) => void;
  /** Give a tab a wide layout (a copy of its standard one) and edit it. */
  addWideLayout: (tabId: string) => void;
  /** Drop a tab's wide layout (the standard one is used everywhere again). */
  removeWideLayout: (tabId: string) => void;
  /** Change the layout being edited (`create`: make an empty one if the tab has none). */
  updateLayout: (tabId: string, fn: (layout: CockpitLayout, tab: DashboardTab) => CockpitLayout, create?: boolean) => void;
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

export const useDashboardStore = create<DashboardState>((set, get) => ({
  profile: loadInitialProfile(),
  activeTabId: 'tab-flight',
  isEditing: false,

  setActiveTab: (tabId: string) => set({ activeTabId: tabId }),
  toggleEditing: () => set((state) => ({ isEditing: !state.isEditing })),
  setEditing: (editing: boolean) => set({ isEditing: editing }),

  addTab: (title: string) => {
    const id = `tab-${Date.now()}`;
    set((state) => {
      const newTabs: DashboardTab[] = [
        ...state.profile.tabs,
        { id, title: title.trim() || 'New View', widgets: [] },
      ];
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
      if (
        fromIndex < 0 ||
        fromIndex >= tabs.length ||
        toIndex < 0 ||
        toIndex >= tabs.length ||
        fromIndex === toIndex
      ) {
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
    const { activeTabId } = get();
    const instanceId = `w-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    set((state) => {
      const newTabs = state.profile.tabs.map((tab) => {
        if (tab.id !== activeTabId) return tab;
        const newWidget: PlacedWidget = { instanceId, widgetId, colSpan };
        // A Cockpit tab shows it as a new pane; the quick-actions bar, if the tab has none pinned, as the header.
        // (In the layout being edited; the other one lists it as not shown.)
        const v = state.editVariant === 'wide' && tab.cockpitWide ? 'wide' : 'standard';
        const withWidget = { ...tab, widgets: [...tab.widgets, newWidget] };
        return reconcileTab(tab.mode !== 'cockpit' ? withWidget : withLayout(withWidget, v, placeWidget(layoutOf(tab, v), instanceId, widgetId)));
      });
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      saveProfileToStorage(newProfile);
      return { profile: newProfile };
    });
  },

  removeWidgetFromActiveTab: (instanceId: string) => {
    const { activeTabId } = get();
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
    const { activeTabId } = get();
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
    const { activeTabId } = get();
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
    const { activeTabId } = get();
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
    const { activeTabId } = get();
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
      return { ...withLayout({ ...tab, widgets }, v === 'wide' && tab.cockpitWide ? 'wide' : 'standard', layout), mode: 'cockpit' };
    });
  },

  setCockpitSizes: (tabId, path, sizes) => {
    get().updateLayout(tabId, (layout) => setSplitSizes(layout, path, sizes));
  },

  placeInCockpit: (tabId, instanceId) => {
    get().updateLayout(tabId, (layout, tab) => placeWidget(layout, instanceId, tab.widgets.find((w) => w.instanceId === instanceId)?.widgetId ?? ''), true);
  },

  unplaceFromCockpit: (tabId, instanceId) => {
    get().updateLayout(tabId, (layout, tab) => removeFromLayout(layout, instanceId, tab.widgets.map((w) => w.instanceId)));
  },

  splitInCockpit: (tabId, target, side, what) => {
    const v = get().editVariant;
    get().updateTab(tabId, (t) => {
      const variant = v === 'wide' && t.cockpitWide ? 'wide' : 'standard';
      const layout = layoutOf(t, variant);
      if (!canPlace(layout, t, target, what)) return t;
      const { tab, instanceId } = sourceInstance(t, what);
      const next = sanitizeCockpit(splitPane(layout!, target, side, instanceId), tab.widgets.map((w) => w.instanceId));
      // Past the depth or pane limits: nothing changes (no pane lost, no new widget left unplaced).
      const placed = placedOrUnchanged(layout!, next, [instanceId]);
      return placed === layout ? t : withLayout(tab, variant, placed);
    });
  },

  replaceInCockpit: (tabId, target, what) => {
    const v = get().editVariant;
    get().updateTab(tabId, (t) => {
      const variant = v === 'wide' && t.cockpitWide ? 'wide' : 'standard';
      const layout = layoutOf(t, variant);
      if (!canPlace(layout, t, target, what)) return t;
      const { tab, instanceId } = sourceInstance(t, what);
      return withLayout(tab, variant, replacePane(layout!, target, instanceId));
    });
  },

  moveInCockpit: (tabId, src, target, zone) => {
    get().updateLayout(tabId, (layout, tab) => movePane(layout, src, target, zone, tab.widgets.map((w) => w.instanceId)));
  },

  editVariant: 'standard',
  setEditVariant: (editVariant) => set({ editVariant }),

  addWideLayout: (tabId) => {
    get().updateTab(tabId, (tab) => (tab.cockpitWide ? tab : { ...tab, cockpitWide: tab.cockpit ?? { header: null, root: null } }));
    set({ editVariant: 'wide' });
  },

  removeWideLayout: (tabId) => {
    get().updateTab(tabId, (tab) => {
      const { cockpitWide: _w, ...rest } = tab;
      return rest;
    });
    set({ editVariant: 'standard' });
  },

  updateLayout: (tabId, fn, create = false) => {
    const v = get().editVariant;
    get().updateTab(tabId, (tab) => {
      const variant = v === 'wide' && tab.cockpitWide ? 'wide' : 'standard';
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
