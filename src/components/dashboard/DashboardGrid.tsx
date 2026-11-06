import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { CustomWidgetDefinition, PlacedWidget } from '../../types/widget';
import { renderBuiltinWidget } from '../widgets/builtinRegistry';
import { CustomWidgetRenderer } from '../widgets/CustomWidgetRenderer';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Trash2,
  ArrowLeft,
  ArrowRight,
  Plus,
  X,
  Layers,
  Edit2,
  Check,
  Pencil,
  GripVertical,
  Sliders,
  Lock,
  ChevronRight,
} from 'lucide-react';

interface DashboardGridProps {
  onEditCustomWidget?: (widget: CustomWidgetDefinition) => void;
}

export const DashboardGrid: React.FC<DashboardGridProps> = ({ onEditCustomWidget }) => {
  const {
    profile,
    activeTabId,
    isEditing,
    toggleEditing,
    setActiveTab,
    addTab,
    removeTab,
    renameTab,
    reorderTabs,
    removeWidgetFromActiveTab,
    updateWidgetColSpan,
    updateWidgetRowSpan,
    moveWidget,
    reorderWidgetsInActiveTab,
  } = useDashboardStore();

  const [newTabTitle, setNewTabTitle] = useState('');
  const [isAddingTab, setIsAddingTab] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editTabTitle, setEditTabTitle] = useState('');
  const [confirmDeleteWidgetId, setConfirmDeleteWidgetId] = useState<string | null>(null);
  const [confirmDeleteTabId, setConfirmDeleteTabId] = useState<string | null>(null);

  // Drag-and-drop state for widgets
  const [draggedWidgetIdx, setDraggedWidgetIdx] = useState<number | null>(null);
  const [dropTargetWidgetIdx, setDropTargetWidgetIdx] = useState<number | null>(null);

  // Drag-and-drop state for tabs
  const [draggedTabIdx, setDraggedTabIdx] = useState<number | null>(null);
  const [dropTargetTabIdx, setDropTargetTabIdx] = useState<number | null>(null);

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];

  const getWidgetTitle = (widgetId: string): string => {
    const BUILTIN_TITLES: Record<string, string> = {
      'built-in-glareshield': 'Flight Controls (Arming & Quick Modes)',
      'built-in-arm-modes': 'Flight Controls (Arming & Quick Modes)',
      'built-in-all-modes': 'All Flight Modes',
      'built-in-set-speed': 'Set Speed',
      'built-in-hud': 'Heads-Up Display (HUD)',
      'built-in-pfd': 'Heads-Up Display (HUD)',
      'built-in-map': 'Tactical Map',
      'built-in-battery-card': 'Battery',
      'built-in-gps-card': 'GNSS / GPS',
      'built-in-vfr-hud': 'VFR Telemetry',
      'built-in-statustext': 'Messages',
      'built-in-parameters': 'Parameters',
      'built-in-charts': 'Telemetry Graphs',
      'built-in-ntrip': 'NTRIP RTK Base Stream',
      'built-in-waypoints': 'Waypoint Control',
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

    const builtin = renderBuiltinWidget(widgetId, placed.colSpan ?? 6);
    if (builtin) return builtin;

    const customDef = profile.customWidgets.find((w) => w.id === widgetId);
    if (customDef) return <CustomWidgetRenderer definition={customDef} />;
    return (
      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl text-center text-zinc-500 font-mono text-xs">
        Unknown widget ID: {widgetId}
      </div>
    );
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
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2 gap-2 relative">
        {/* Scrollable Tabs with Mobile Scroll Hint */}
        <div className="relative flex-1 min-w-0 flex items-center">
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto min-w-0 flex-1 py-1 pr-6 scrollbar-thin">
          {profile.tabs.map((tab, tabIdx) => {
            const isActive = tab.id === activeTab?.id;
            const isBeingRenamed = editingTabId === tab.id;
            const isConfirmingDelete = confirmDeleteTabId === tab.id;
            const isTabDropTarget = dropTargetTabIdx === tabIdx && draggedTabIdx !== null && draggedTabIdx !== tabIdx;

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
              <div
                key={tab.id}
                draggable={isEditing && !isBeingRenamed}
                onDragStart={(e) => {
                  if (!isEditing) return;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', `tab:${tabIdx}`);
                  setDraggedTabIdx(tabIdx);
                }}
                onDragOver={(e) => {
                  if (!isEditing || draggedTabIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropTargetTabIdx !== tabIdx) {
                    setDropTargetTabIdx(tabIdx);
                  }
                }}
                onDrop={(e) => {
                  if (!isEditing || draggedTabIdx === null) return;
                  e.preventDefault();
                  if (draggedTabIdx !== tabIdx) {
                    reorderTabs(draggedTabIdx, tabIdx);
                  }
                  setDraggedTabIdx(null);
                  setDropTargetTabIdx(null);
                }}
                onDragEnd={() => {
                  setDraggedTabIdx(null);
                  setDropTargetTabIdx(null);
                }}
                className={`relative flex items-center group shrink-0 rounded-lg transition-all ${
                  isTabDropTarget ? 'ring-2 ring-sky-400 bg-sky-950/30' : ''
                } ${draggedTabIdx === tabIdx ? 'opacity-50' : ''}`}
              >
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
                    } ${isEditing ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    title={isEditing ? 'Drag to reorder tab' : tab.title}
                  >
                    {isEditing && <GripVertical className="h-3 w-3 text-zinc-500 -ml-1" />}
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
          {/* Right scroll fade & chevron hint on narrow mobile viewports */}
          <div
            className="sm:hidden pointer-events-none absolute right-0 top-0 bottom-0 w-7 bg-gradient-to-l from-zinc-950 via-zinc-950/80 to-transparent flex items-center justify-end pr-0.5 text-zinc-500"
            aria-hidden="true"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
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
            const rowSpan = widget.rowSpan || 2;
            const heightPresetClass =
              rowSpan === 1
                ? 'max-h-[260px] overflow-y-auto'
                : rowSpan === 3
                ? 'min-h-[540px]'
                : '';
            const isConfirmingDeleteWidget = confirmDeleteWidgetId === widget.instanceId;
            const customDef = profile.customWidgets.find((w) => w.id === widget.widgetId);
            const isDropTarget =
              dropTargetWidgetIdx === idx && draggedWidgetIdx !== null && draggedWidgetIdx !== idx;
            const isBeingDragged = draggedWidgetIdx === idx;

            return (
              <div
                key={widget.instanceId}
                draggable={isEditing}
                onDragStart={(e) => {
                  if (!isEditing) return;
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', widget.instanceId);
                  setDraggedWidgetIdx(idx);
                }}
                onDragOver={(e) => {
                  if (!isEditing || draggedWidgetIdx === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropTargetWidgetIdx !== idx) {
                    setDropTargetWidgetIdx(idx);
                  }
                }}
                onDrop={(e) => {
                  if (!isEditing || draggedWidgetIdx === null) return;
                  e.preventDefault();
                  if (draggedWidgetIdx !== idx) {
                    reorderWidgetsInActiveTab(draggedWidgetIdx, idx);
                  }
                  setDraggedWidgetIdx(null);
                  setDropTargetWidgetIdx(null);
                }}
                onDragEnd={() => {
                  setDraggedWidgetIdx(null);
                  setDropTargetWidgetIdx(null);
                }}
                className={`${getColSpanClass(colSpan)} relative group transition-all flex flex-col h-full ${
                  isBeingDragged ? 'opacity-40 scale-[0.99]' : ''
                } ${isDropTarget ? 'ring-2 ring-sky-400 rounded-xl bg-sky-950/20' : ''}`}
              >
                {/* Edit Overlay Toolbar when in Edit Mode */}
                {isEditing && (
                  <div className="mb-1.5 flex items-center justify-between gap-1 bg-zinc-900 border border-zinc-700/80 rounded-lg px-2 py-1 text-xs text-zinc-300 shadow-md">
                    <div
                      className="flex items-center gap-1.5 min-w-0 cursor-grab active:cursor-grabbing"
                      title="Drag card to reorder in grid — flight controls locked while editing"
                    >
                      <GripVertical className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                      <span
                        className="font-sans text-[11px] text-sky-400 font-bold truncate max-w-[110px] sm:max-w-[170px]"
                        title={getWidgetTitle(widget.widgetId)}
                      >
                        {getWidgetTitle(widget.widgetId)}
                      </span>
                      <span
                        className="hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/90 border border-zinc-700 text-[9px] font-mono text-zinc-400 shrink-0"
                        title="Widget controls are locked in Edit Mode so you can safely drag to reorder"
                      >
                        <Lock className="h-2.5 w-2.5 text-amber-400" />
                        Drag · Controls Locked
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                      {/* Width toggles: 1/4, 1/3, 1/2, 2/3, Full */}
                      {[
                        { span: 3, label: '1/4', title: '1/4 Width (3 cols)' },
                        { span: 4, label: '1/3', title: '1/3 Width (4 cols)' },
                        { span: 6, label: '1/2', title: 'Half Width (6 cols)' },
                        { span: 8, label: '2/3', title: '2/3 Width (8 cols)' },
                        { span: 12, label: 'Full', title: 'Full Width (12 cols)' },
                      ].map((opt) => (
                        <button
                          key={opt.span}
                          onClick={() => updateWidgetColSpan(widget.instanceId, opt.span)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold transition-colors ${
                            colSpan === opt.span ? 'bg-sky-500 text-white font-bold' : 'hover:bg-zinc-800 text-zinc-400'
                          }`}
                          title={opt.title}
                        >
                          {opt.label}
                        </button>
                      ))}

                      <div className="h-3 w-px bg-zinc-700 mx-0.5" />

                      {/* Height presets: Compact, Normal, Tall */}
                      {[
                        { rows: 1, label: 'H:S', title: 'Compact Height' },
                        { rows: 2, label: 'H:M', title: 'Normal Height' },
                        { rows: 3, label: 'H:L', title: 'Tall Height' },
                      ].map((hOpt) => (
                        <button
                          key={hOpt.rows}
                          onClick={() => updateWidgetRowSpan(widget.instanceId, hOpt.rows)}
                          className={`px-1 py-0.5 rounded text-[9px] font-mono font-semibold transition-colors ${
                            rowSpan === hOpt.rows
                              ? 'bg-emerald-600 text-white font-bold'
                              : 'hover:bg-zinc-800 text-zinc-400'
                          }`}
                          title={hOpt.title}
                        >
                          {hOpt.label}
                        </button>
                      ))}

                      <div className="h-3 w-px bg-zinc-700 mx-0.5" />

                      {/* Edit Custom Widget button */}
                      {customDef && onEditCustomWidget && (
                        <>
                          <button
                            onClick={() => onEditCustomWidget(customDef)}
                            className="p-1 text-amber-400 hover:text-amber-300 flex items-center"
                            title="Edit custom widget definition"
                          >
                            <Sliders className="h-3 w-3" />
                          </button>
                          <div className="h-3 w-px bg-zinc-700 mx-0.5" />
                        </>
                      )}

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
                          title="Remove widget from view"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Render the actual widget with non-obscuring edit-lock protection */}
                <div
                  className={`h-full flex flex-col relative ${heightPresetClass} ${
                    isEditing ? 'ring-1 ring-dashed ring-zinc-700 rounded-xl' : ''
                  }`}
                >
                  <ErrorBoundary fallbackTitle={getWidgetTitle(widget.widgetId)}>
                    {renderWidgetContent(widget)}
                  </ErrorBoundary>
                  {isEditing && (
                    <div
                      className="absolute inset-0 rounded-xl z-20 cursor-grab active:cursor-grabbing flex items-center justify-center pointer-events-auto select-none"
                      title="Drag to reorder widget — flight controls locked while editing"
                    >
                      {isDropTarget && (
                        <span className="text-[11px] font-mono font-bold text-sky-200 bg-sky-950/95 px-3 py-1.5 rounded-lg border border-sky-400 shadow-lg flex items-center gap-1.5">
                          <GripVertical className="h-3.5 w-3.5 text-sky-400" />
                          Drop Here to Swap
                        </span>
                      )}
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
