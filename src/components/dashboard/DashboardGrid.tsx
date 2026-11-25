import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONTENT_WIDTH_CLASS, useLayoutStore } from '../../store/layoutStore';
import { layoutFits, minLayoutSize, panesInOrder, widgetMinSize } from '../../lib/cockpitLayout';
import { CockpitView } from './CockpitView';
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
  Eye,
  LayoutPanelTop,
} from 'lucide-react';

interface DashboardGridProps {
  onEditCustomWidget?: (widget: CustomWidgetDefinition) => void;
}

const WIDTH_OPTIONS = [
  { span: 3, label: '¼ width' },
  { span: 4, label: '⅓ width' },
  { span: 6, label: '½ width' },
  { span: 8, label: '⅔ width' },
  { span: 9, label: '¾ width' },
  { span: 12, label: 'Full width' },
];

const HEIGHT_OPTIONS = [
  { rows: 1, label: 'Compact' },
  { rows: 2, label: 'Normal' },
  { rows: 3, label: 'Tall' },
];

export const DashboardGrid: React.FC<DashboardGridProps> = ({ onEditCustomWidget }) => {
  // How wide the tab may grow (Settings > Display).
  const contentWidth = useLayoutStore((st) => st.contentWidth);
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
    placeInCockpit,
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

  // ----------------------------------------------------------------------------------------------
  // Cockpit tabs: panes filling the window, when the window holds the layout's minimums; stacked (like a Flow tab)
  // when it doesn't (a phone, a small window). The room is measured from where the content starts, which is the same
  // either way (same padding), so it doesn't depend on the choice: no feedback, no flicker, and no margin needed
  // (a margin would keep a window with just enough room stacked after leaving Edit mode).
  // ----------------------------------------------------------------------------------------------
  const isCockpit = activeTab?.mode === 'cockpit';
  const cockpit = isCockpit ? (activeTab.cockpit ?? { header: null, root: null }) : undefined;
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  /**
   * The pinned header's resting height: the least seen for this layout. Its Takeoff checklist opening grows it for a
   * while (the panes give way); that mustn't count, or the tab would stack, unmounting the checklist mid-sequence.
   */
  const headerHeightRef = useRef<number | null>(null);
  const layoutKey = `${activeTab?.id}|${cockpit?.header ?? ''}`;
  useEffect(() => {
    headerHeightRef.current = null;
  }, [layoutKey]);
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    if (!isCockpit || !cockpit) {
      setStacked(false);
      return;
    }
    const byId = new Map(activeTab.widgets.map((w) => [w.instanceId, w.widgetId]));
    const need = minLayoutSize(cockpit.root, (id) => widgetMinSize(byId.get(id) ?? ''));
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      if (headerRef.current) {
        const h = headerRef.current.offsetHeight + 6;
        headerHeightRef.current = headerHeightRef.current === null ? h : Math.min(headerHeightRef.current, h);
      }
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // Before the header is first measured, a generous guess: measuring can only lower it (the least is kept), so
      // the choice can't flip back and forth.
      const header = cockpit.header ? (headerHeightRef.current ?? 110) : 0;
      // Less the container's bottom padding (12 px).
      const room = { w: rect.width, h: window.innerHeight - top - 12 - header };
      setStacked(!layoutFits(need, room));
    };
    measure();
    window.addEventListener('resize', measure);
    // What's above the content changes its room: while stacked the page grows (watch the page); as panes the page is
    // the window's height and the content area itself shrinks (watch it): banners, the edit toolbar, the not-shown
    // list.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [isCockpit, cockpit, activeTab, isEditing]);
  const fill = isCockpit && !stacked;
  useEffect(() => {
    useLayoutStore.setState({ cockpitFill: fill });
    return () => useLayoutStore.setState({ cockpitFill: false });
  }, [fill]);
  const placedIds = new Set(panesInOrder(cockpit));
  const emptyCockpit = isCockpit && !cockpit?.root && !cockpit?.header;
  const unplaced = isCockpit ? activeTab.widgets.filter((w) => !placedIds.has(w.instanceId)) : [];

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
      'built-in-statustext-mini': 'Mini Messages',
      'built-in-parameters': 'Parameters',
      'built-in-charts': 'Telemetry Graphs',
      'built-in-pid-tuning': 'PID Tuning',
      'built-in-logs': 'Onboard Logs',
      'built-in-inspector': 'MAVLink Inspector',
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
      case 9:
        return 'col-span-12 lg:col-span-9';
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
    <div
      className={
        isCockpit
          ? // A Cockpit tab: the whole window's width; as panes, exactly the height left below the navbar (App). The
            // same padding stacked or not, so its content starts at the same place and the room it measures is the
            // same either way.
            `flex-1 flex flex-col p-2 sm:p-3 w-full gap-2 ${fill ? 'min-h-0' : ''}`
          : `flex-1 flex flex-col p-3 sm:p-5 ${CONTENT_WIDTH_CLASS[contentWidth]} mx-auto w-full space-y-4`
      }
    >
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

      {/* Edit mode, Cockpit tab: the tab's widgets the layout doesn't show. */}
      {isEditing && isCockpit && unplaced.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-400">
          <span className="font-semibold text-zinc-300">Not shown in this layout:</span>
          {unplaced.map((w) => (
            <span key={w.instanceId} className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5">
              {getWidgetTitle(w.widgetId)}
              <button
                type="button"
                onClick={() => placeInCockpit(activeTab.id, w.instanceId)}
                className="flex items-center gap-0.5 text-sky-300 hover:text-sky-200"
                title="Show it as a new pane"
              >
                <Eye className="h-3 w-3" />
                Show
              </button>
              <button
                type="button"
                onClick={() => removeWidgetFromActiveTab(w.instanceId)}
                className="text-zinc-500 hover:text-red-400"
                title="Remove it from the tab"
                aria-label={`Remove ${getWidgetTitle(w.widgetId)} from the tab`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {emptyCockpit ? (
        <div ref={contentRef} className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-800 p-6 text-center">
          <div>
            <LayoutPanelTop className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
            <p className="text-sm font-bold text-zinc-300">This Cockpit tab shows no panes</p>
            <p className="mt-1 text-xs text-zinc-500">In Edit mode, pick a preset, Show a widget listed above, or Add Widget.</p>
          </div>
        </div>
      ) : isCockpit && fill ? (
        <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
          <CockpitView
            tab={{ ...activeTab, cockpit }}
            isEditing={isEditing}
            renderWidget={renderWidgetContent}
            titleOf={getWidgetTitle}
            headerRef={headerRef}
          />
        </div>
      ) : isCockpit ? (
        // Too small for the panes: the same widgets, stacked in reading order.
        <div ref={contentRef} className="flex flex-col gap-3">
          {isEditing && (
            <p className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-400">
              <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              This Cockpit tab is shown stacked: the window is smaller than its panes need. Arrange it on a larger screen.
            </p>
          )}
          {panesInOrder(cockpit).map((id) => {
            const w = activeTab.widgets.find((x) => x.instanceId === id);
            if (!w) return null;
            return (
              <div key={id} className="@container relative">
                <ErrorBoundary fallbackTitle={getWidgetTitle(w.widgetId)}>{renderWidgetContent(w)}</ErrorBoundary>
                {isEditing && <div className="absolute inset-0 z-20 rounded-xl ring-1 ring-dashed ring-zinc-700" title="Locked while editing" />}
              </div>
            );
          })}
        </div>
      ) : activeTab && activeTab.widgets.length > 0 ? (
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
                className={`${getColSpanClass(colSpan)} @container relative group transition-all flex flex-col h-full ${
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
                        className="font-sans text-[11px] text-sky-400 font-bold truncate"
                        title={getWidgetTitle(widget.widgetId)}
                      >
                        {getWidgetTitle(widget.widgetId)}
                      </span>
                      <span
                        className="hidden 2xl:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800/90 border border-zinc-700 text-[9px] font-mono text-zinc-400 shrink-0"
                        title="Widget controls are locked in Edit Mode so you can safely drag to reorder"
                      >
                        <Lock className="h-2.5 w-2.5 text-amber-400" />
                        Drag · Controls Locked
                      </span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 justify-end">
                      {/* Width and height as compact pickers, so the title keeps its room. */}
                      <select
                        value={colSpan}
                        onChange={(e) => updateWidgetColSpan(widget.instanceId, Number(e.target.value))}
                        className="h-6 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-sky-300 cursor-pointer"
                        title="Widget width"
                        aria-label="Widget width"
                      >
                        {WIDTH_OPTIONS.map((opt) => (
                          <option key={opt.span} value={opt.span}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={rowSpan}
                        onChange={(e) => updateWidgetRowSpan(widget.instanceId, Number(e.target.value))}
                        className="h-6 rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-emerald-300 cursor-pointer"
                        title="Widget height"
                        aria-label="Widget height"
                      >
                        {HEIGHT_OPTIONS.map((opt) => (
                          <option key={opt.rows} value={opt.rows}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

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
