import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { PlacedWidget } from '../../types/widget';
import { GlareshieldWidget } from '../glareshield/GlareshieldWidget';
import { HudWidget } from '../hud/HudWidget';
import { MapWidget } from '../map/MapWidget';
import { BatteryWidget } from '../widgets/BatteryWidget';
import { GpsWidget } from '../widgets/GpsWidget';
import { VfrHudWidget } from '../widgets/VfrHudWidget';
import { StatusTextConsoleWidget } from '../widgets/StatusTextConsoleWidget';
import { ParametersWidget } from '../widgets/ParametersWidget';
import { TelemetryChartsWidget } from '../widgets/TelemetryChartsWidget';
import { CustomWidgetRenderer } from '../widgets/CustomWidgetRenderer';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Trash2,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Minimize2,
  Plus,
  X,
  Layers,
  Edit2,
  Check,
  Pencil,
} from 'lucide-react';

export const DashboardGrid: React.FC = () => {
  const {
    profile,
    activeTabId,
    isEditing,
    toggleEditing,
    setActiveTab,
    addTab,
    removeTab,
    renameTab,
    removeWidgetFromActiveTab,
    updateWidgetColSpan,
    moveWidget,
  } = useDashboardStore();

  const [newTabTitle, setNewTabTitle] = useState('');
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editTabTitle, setEditTabTitle] = useState('');
  const [confirmDeleteWidgetId, setConfirmDeleteWidgetId] = useState<string | null>(null);
  const [confirmDeleteTabId, setConfirmDeleteTabId] = useState<string | null>(null);

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];

  const getWidgetTitle = (widgetId: string): string => {
    const BUILTIN_TITLES: Record<string, string> = {
      'built-in-glareshield': 'Flight Controls',
      'built-in-hud': 'HUD / PFD',
      'built-in-pfd': 'HUD / PFD',
      'built-in-map': 'Tactical Map',
      'built-in-battery-card': 'Battery',
      'built-in-gps-card': 'GPS / GNSS',
      'built-in-vfr-hud': 'VFR Data',
      'built-in-statustext': 'Console',
      'built-in-parameters': 'Parameters',
      'built-in-charts': 'Telemetry Graphs',
    };
    if (BUILTIN_TITLES[widgetId]) return BUILTIN_TITLES[widgetId];
    const custom = profile.customWidgets.find((w) => w.id === widgetId);
    return custom ? custom.name : widgetId;
  };

  const handleCreateTab = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTabTitle.trim()) {
      addTab(newTabTitle.trim());
      setNewTabTitle('');
      setIsAddingTab(false);
    }
  };

  const handleSaveRename = (tabId: string) => {
    if (editTabTitle.trim()) {
      renameTab(tabId, editTabTitle.trim());
    }
    setEditingTabId(null);
  };

  const renderWidgetContent = (placed: PlacedWidget) => {
    const { widgetId } = placed;

    // Check built-in widgets
    switch (widgetId) {
      case 'built-in-glareshield':
        return <GlareshieldWidget />;
      case 'built-in-hud':
      case 'built-in-pfd':
        return <HudWidget />;
      case 'built-in-map':
        return <MapWidget />;
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
      default: {
        // Look up custom widget definition
        const customDef = profile.customWidgets.find((w) => w.id === widgetId);
        if (customDef) {
          return <CustomWidgetRenderer definition={customDef} />;
        }
        return (
          <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-zinc-500 font-mono text-xs">
            Unknown widget ID: {widgetId}
          </div>
        );
      }
    }
  };

  // Map 12-column span to responsive Tailwind grid classes
  const getColSpanClass = (span: number = 6) => {
    switch (span) {
      case 12:
        return 'col-span-12';
      case 8:
        return 'col-span-12 lg:col-span-8';
      case 6:
        return 'col-span-12 md:col-span-6';
      case 4:
        return 'col-span-12 md:col-span-6 lg:col-span-4';
      case 3:
        return 'col-span-12 sm:col-span-6 lg:col-span-3';
      default:
        return 'col-span-12 md:col-span-6';
    }
  };

  return (
    <div className="flex-1 flex flex-col p-3 sm:p-5 max-w-7xl mx-auto w-full space-y-4">
      {/* Tab Navigation Bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 gap-2">
        {/* Scrollable Tabs */}
        <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto min-w-0 flex-1 py-1">
          {profile.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const isBeingRenamed = editingTabId === tab.id;
            const isConfirmingDelete = confirmDeleteTabId === tab.id;

            if (isConfirmingDelete) {
              return (
                <div
                  key={tab.id}
                  className="flex items-center gap-1.5 bg-red-950/80 border border-red-500/50 rounded-lg px-2.5 py-1 text-xs text-red-200 shrink-0 shadow-sm"
                >
                  <span className="font-semibold text-[11px]">Delete &quot;{tab.title}&quot;?</span>
                  <button
                    onClick={() => {
                      removeTab(tab.id);
                      setConfirmDeleteTabId(null);
                    }}
                    className="px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-[10px]"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDeleteTabId(null)}
                    className="px-1.5 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[10px]"
                  >
                    Cancel
                  </button>
                </div>
              );
            }

            return (
              <div key={tab.id} className="relative flex items-center group shrink-0">
                {isBeingRenamed ? (
                  <div className="flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded-lg border border-sky-500">
                    <Input
                      type="text"
                      value={editTabTitle}
                      onChange={(e) => setEditTabTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSaveRename(tab.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingTabId(null);
                        }
                      }}
                      onBlur={() => handleSaveRename(tab.id)}
                      className="h-6 w-28 text-xs font-semibold px-1 py-0"
                      autoFocus
                    />
                    <button onClick={() => handleSaveRename(tab.id)} className="text-emerald-400 hover:text-white">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 ${
                      isActive
                        ? 'bg-zinc-800 text-sky-400 shadow-sm border border-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                    }`}
                  >
                    <span>{tab.title}</span>
                    <span className="text-[10px] text-zinc-500 font-mono">({tab.widgets.length})</span>
                  </button>
                )}

                {/* Tab Edit Controls */}
                {isEditing && (
                  <div className="ml-0.5 flex items-center opacity-70 hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditingTabId(tab.id);
                        setEditTabTitle(tab.title);
                      }}
                      className="p-1 text-zinc-400 hover:text-white"
                      title="Rename tab"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    {profile.tabs.length > 1 && (
                      <button
                        onClick={() => setConfirmDeleteTabId(tab.id)}
                        className="p-1 text-zinc-400 hover:text-red-400"
                        title="Delete tab"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Tab Button */}
          {isEditing && !isAddingTab && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddingTab(true)}
              className="h-8 px-2 text-xs text-zinc-400 hover:text-zinc-100 gap-1 border-dashed shrink-0"
            >
              <Plus className="h-3 w-3" />
              <span>New Tab</span>
            </Button>
          )}

          {isEditing && isAddingTab && (
            <form onSubmit={handleCreateTab} className="flex items-center gap-1 shrink-0">
              <Input
                type="text"
                placeholder="Tab Name..."
                value={newTabTitle}
                onChange={(e) => setNewTabTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setIsAddingTab(false);
                }}
                className="h-7 w-28 text-xs font-semibold px-2 py-0"
                autoFocus
              />
              <Button type="submit" size="sm" variant="default" className="h-7 px-2 text-xs">
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-zinc-500"
                onClick={() => setIsAddingTab(false)}
              >
                Cancel
              </Button>
            </form>
          )}
        </div>

        {/* Far Right: Edit Mode Button (hidden while editing since EditToolbar has Finish Edit) */}
        {!isEditing && (
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleEditing}
              className="gap-1.5 h-8 px-3 text-xs font-semibold"
              title="Edit dashboard layout & widgets"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit Mode</span>
            </Button>
          </div>
        )}
      </div>

      {/* Grid of Widgets */}
      {activeTab && activeTab.widgets.length > 0 ? (
        <div className="grid grid-cols-12 gap-3 sm:gap-4 items-stretch">
          {activeTab.widgets.map((widget, idx) => {
            const colSpan = widget.colSpan || 6;
            const isConfirmingDeleteWidget = confirmDeleteWidgetId === widget.instanceId;

            return (
              <div
                key={widget.instanceId}
                className={`${getColSpanClass(colSpan)} relative group transition-all flex flex-col h-full`}
              >
                {/* Edit Overlay Toolbar when in Edit Mode */}
                {isEditing && (
                  <div className="mb-1.5 flex items-center justify-between bg-zinc-900 border border-zinc-700/80 rounded-lg px-2.5 py-1 text-xs text-zinc-300 shadow-md">
                    <span className="font-mono text-[10px] text-sky-400 font-bold truncate max-w-[140px] sm:max-w-[200px]" title={getWidgetTitle(widget.widgetId)}>
                      {getWidgetTitle(widget.widgetId)}
                    </span>

                    <div className="flex items-center gap-1.5">
                      {/* Width toggles */}
                      <button
                        onClick={() => updateWidgetColSpan(widget.instanceId, 4)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          colSpan === 4 ? 'bg-sky-500 text-white font-bold' : 'hover:bg-zinc-800'
                        }`}
                        title="1/3 Width"
                      >
                        1/3
                      </button>
                      <button
                        onClick={() => updateWidgetColSpan(widget.instanceId, 6)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          colSpan === 6 ? 'bg-sky-500 text-white font-bold' : 'hover:bg-zinc-800'
                        }`}
                        title="Half Width"
                      >
                        1/2
                      </button>
                      <button
                        onClick={() => updateWidgetColSpan(widget.instanceId, 12)}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          colSpan === 12 ? 'bg-sky-500 text-white font-bold' : 'hover:bg-zinc-800'
                        }`}
                        title="Full Width"
                      >
                        Full
                      </button>

                      <div className="h-3 w-px bg-zinc-700 mx-0.5" />

                      {/* Move buttons */}
                      <button
                        onClick={() => moveWidget(widget.instanceId, 'up')}
                        disabled={idx === 0}
                        className="p-1 hover:text-white disabled:opacity-30 flex items-center"
                        title="Move Earlier (Up / Left)"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveWidget(widget.instanceId, 'down')}
                        disabled={idx === activeTab.widgets.length - 1}
                        className="p-1 hover:text-white disabled:opacity-30 flex items-center"
                        title="Move Later (Down / Right)"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>

                      <div className="h-3 w-px bg-zinc-700 mx-0.5" />

                      {/* Remove button with confirmation */}
                      {isConfirmingDeleteWidget ? (
                        <div className="flex items-center gap-1 bg-red-950/90 border border-red-500/40 rounded px-1.5 py-0.5 text-[10px] text-red-200">
                          <span>Delete?</span>
                          <button
                            onClick={() => {
                              removeWidgetFromActiveTab(widget.instanceId);
                              setConfirmDeleteWidgetId(null);
                            }}
                            className="px-1 bg-red-600 hover:bg-red-500 text-white rounded font-bold text-[9px]"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteWidgetId(null)}
                            className="px-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-[9px]"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteWidgetId(widget.instanceId)}
                          className="p-1 text-red-400 hover:text-red-300"
                          title="Delete widget"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Render the actual widget with edit-lock protection */}
                <div className={`h-full flex flex-col relative ${isEditing ? 'ring-1 ring-dashed ring-zinc-700 rounded-xl' : ''}`}>
                  {renderWidgetContent(widget)}
                  {isEditing && (
                    <div
                      className="absolute inset-0 bg-zinc-950/40 backdrop-blur-[0.5px] rounded-xl z-20 cursor-not-allowed flex items-center justify-center pointer-events-auto select-none"
                      title="Widget controls locked during layout editing"
                    >
                      <span className="text-[11px] font-mono font-medium text-zinc-300 bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-700 shadow">
                        Controls Locked
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-16 border-2 border-dashed border-zinc-800 rounded-2xl p-6">
          <Layers className="h-10 w-10 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-zinc-300">This tab has no widgets</h3>
          <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
            Click &quot;Edit Mode&quot; in the header, then click &quot;Add Widget&quot; to place telemetry cards, flight instruments, or custom controls here.
          </p>
        </div>
      )}
    </div>
  );
};
