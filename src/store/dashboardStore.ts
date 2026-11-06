import { sanitizeWidgetDefinition } from '../lib/widgetValidation';
import { create } from 'zustand';
import {
  DashboardProfile,
  DashboardTab,
  PlacedWidget,
  CustomWidgetDefinition,
  WidgetDisplayType,
  MultiBarGroupType,
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
        { instanceId: 'w-waypoints-map', widgetId: 'built-in-waypoints', colSpan: 12 },
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
          parsed.tabs = parsed.tabs.map((t: DashboardTab) => ({
            ...t,
            title: OLD_TO_NEW_TITLES[t.title] || t.title,
          }));
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
        return { ...tab, widgets: [...tab.widgets, newWidget] };
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
        return { ...tab, widgets: tab.widgets.filter((w) => w.instanceId !== instanceId) };
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
      const updatedTabs = state.profile.tabs.map((t) => ({
        ...t,
        widgets: t.widgets.filter((w) => w.widgetId !== widgetId),
      }));
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
        saveProfileToStorage(parsed);
        set({
          profile: parsed,
          activeTabId: parsed.tabs[0]?.id || 'tab-flight',
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
    });
  },
}));
