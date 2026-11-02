import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { PlacedWidget } from '../../types/widget';
import { GlareshieldWidget } from '../glareshield/GlareshieldWidget';
import { PfdWidget } from '../pfd/PfdWidget';
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

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];

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
      case 'built-in-pfd':
        return <PfdWidget />;
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
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {profile.tabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const isBeingRenamed = editingTabId === tab.id;

            return (
              <div key={tab.id} className="relative flex items-center group">
                {isBeingRenamed ? (
                  <div className="flex items-center gap-1 bg-zinc-900 px-2 py-1 rounded-lg border border-sky-500">
                    <Input
                      type="text"
                      value={editTabTitle}
                      onChange={(e) => setEditTabTitle(e.target.value)}
                      className="h-6 w-24 text-xs font-semibold px-1 py-0"
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
                        onClick={() => removeTab(tab.id)}
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
              className="h-8 px-2 text-xs text-zinc-400 hover:text-zinc-100 gap-1 border-dashed"
            >
              <Plus className="h-3 w-3" />
              <span>New Tab</span>
            </Button>
          )}

          {isEditing && isAddingTab && (
            <form onSubmit={handleCreateTab} className="flex items-center gap-1">
              <Input
                type="text"
                placeholder="Tab Name..."
                value={newTabTitle}
                onChange={(e) => setNewTabTitle(e.target.value)}
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

        {/* Far Right: Edit Mode Button */}
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <Button
            variant={isEditing ? 'warning' : 'outline'}
            size="sm"
            onClick={toggleEditing}
            className="gap-1.5 h-8 px-3 text-xs font-semibold"
            title={isEditing ? 'Finish editing dashboard' : 'Edit dashboard layout & widgets'}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="hidden xs:inline">{isEditing ? 'Finish Edit' : 'Edit Mode'}</span>
          </Button>
        </div>
      </div>

      {/* Grid of Widgets */}
      {activeTab && activeTab.widgets.length > 0 ? (
        <div className="grid grid-cols-12 gap-3 sm:gap-4">
          {activeTab.widgets.map((widget, idx) => {
            const colSpan = widget.colSpan || 6;

            return (
              <div
                key={widget.instanceId}
                className={`${getColSpanClass(colSpan)} relative group transition-all`}
              >
                {/* Edit Overlay Toolbar when in Edit Mode */}
                {isEditing && (
                  <div className="mb-1.5 flex items-center justify-between bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-xs text-zinc-300 shadow-md">
                    <span className="font-mono text-[10px] text-sky-400 uppercase font-bold">
                      Widget #{idx + 1}
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
                        className="p-1 hover:text-white disabled:opacity-30"
                        title="Move Earlier"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveWidget(widget.instanceId, 'down')}
                        disabled={idx === activeTab.widgets.length - 1}
                        className="p-1 hover:text-white disabled:opacity-30"
                        title="Move Later"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>

                      <div className="h-3 w-px bg-zinc-700 mx-0.5" />

                      {/* Remove button */}
                      <button
                        onClick={() => removeWidgetFromActiveTab(widget.instanceId)}
                        className="p-1 text-red-400 hover:text-red-300"
                        title="Delete widget"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Render the actual widget */}
                <div className={isEditing ? 'ring-1 ring-dashed ring-zinc-700 rounded-xl' : ''}>
                  {renderWidgetContent(widget)}
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
