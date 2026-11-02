import { create } from 'zustand';
import { DashboardProfile, DashboardTab, PlacedWidget, CustomWidgetDefinition } from '../types/widget';

const DEFAULT_PROFILE: DashboardProfile = {
  version: '1.0.0',
  name: 'Default ArduPilot Layout',
  updatedAt: new Date().toISOString(),
  tabs: [
    {
      id: 'tab-flight',
      title: 'Flight Deck',
      widgets: [
        { instanceId: 'w-glareshield', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-pfd', widgetId: 'built-in-pfd', colSpan: 6 },
        { instanceId: 'w-map-flight', widgetId: 'built-in-map', colSpan: 6 },
        { instanceId: 'w-vfr', widgetId: 'built-in-vfr-hud', colSpan: 4 },
        { instanceId: 'w-battery', widgetId: 'built-in-battery-card', colSpan: 4 },
        { instanceId: 'w-gps', widgetId: 'built-in-gps-card', colSpan: 4 },
      ],
    },
    {
      id: 'tab-map',
      title: 'Tactical Map',
      widgets: [
        { instanceId: 'w-glareshield-map', widgetId: 'built-in-glareshield', colSpan: 12 },
        { instanceId: 'w-map-large', widgetId: 'built-in-map', colSpan: 12 },
      ],
    },
    {
      id: 'tab-telemetry',
      title: 'Instruments & Graphs',
      widgets: [
        { instanceId: 'w-charts', widgetId: 'built-in-charts', colSpan: 12 },
        { instanceId: 'w-vfr-2', widgetId: 'built-in-vfr-hud', colSpan: 6 },
        { instanceId: 'w-battery-2', widgetId: 'built-in-battery-card', colSpan: 6 },
      ],
    },
    {
      id: 'tab-console',
      title: 'Messages & Params',
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
      description: 'Quick voltmeter for main propulsion rail',
      category: 'telemetry',
      displayType: 'gauge-linear',
      binding: {
        messageName: 'SYS_STATUS',
        fieldName: 'voltage_battery',
        unit: 'V',
        min: 10,
        max: 18,
        decimals: 2,
      },
      colorScheme: 'green',
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
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load profile from localStorage:', e);
  }
  return DEFAULT_PROFILE;
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

  // Widgets in Active Tab
  addWidgetToActiveTab: (widgetId: string, colSpan?: number) => void;
  removeWidgetFromActiveTab: (instanceId: string) => void;
  updateWidgetColSpan: (instanceId: string, colSpan: number) => void;
  moveWidget: (instanceId: string, direction: 'up' | 'down') => void;

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
      return { profile: newProfile, activeTabId: id };
    });
  },

  removeTab: (tabId: string) => {
    set((state) => {
      if (state.profile.tabs.length <= 1) return {};
      const newTabs = state.profile.tabs.filter((t) => t.id !== tabId);
      const newActive = state.activeTabId === tabId ? newTabs[0].id : state.activeTabId;
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
      return { profile: newProfile, activeTabId: newActive };
    });
  },

  renameTab: (tabId: string, newTitle: string) => {
    set((state) => {
      const newTabs = state.profile.tabs.map((t) => (t.id === tabId ? { ...t, title: newTitle } : t));
      const newProfile = { ...state.profile, tabs: newTabs, updatedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
      return { profile: newProfile };
    });
  },

  deleteCustomWidget: (widgetId: string) => {
    set((state) => {
      const updatedCustom = state.profile.customWidgets.filter((w) => w.id !== widgetId);
      const newProfile = {
        ...state.profile,
        customWidgets: updatedCustom,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newProfile));
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
        localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PROFILE));
    set({
      profile: DEFAULT_PROFILE,
      activeTabId: 'tab-flight',
      isEditing: false,
    });
  },
}));
