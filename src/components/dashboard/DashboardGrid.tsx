import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Edit2,
  Eye,
  EyeOff,
  GripVertical,
  Layers,
  LayoutPanelTop,
  Lock,
  Pencil,
  Plus,
  Sliders,
  Trash2,
  X,
} from 'lucide-react';

import {
  chooseFit,
  COMPACT_PREVIEWS,
  layoutFits,
  minLayoutSize,
  panesInOrder,
  variantFor,
  widgetMinSize,
  type CockpitVariant,
} from '../../lib/cockpitLayout';
import { editTarget, layoutOf, otherLayouts, useDashboardStore } from '../../store/dashboardStore';
import { CONTENT_WIDTH_CLASS, useLayoutStore } from '../../store/layoutStore';
import { CockpitLayout, CustomWidgetDefinition, DashboardTab, PlacedWidget } from '../../types/widget';
import { Button } from '../ui/button';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Input } from '../ui/input';
import { renderBuiltinWidget } from '../widgets/builtinRegistry';
import { CustomWidgetRenderer } from '../widgets/CustomWidgetRenderer';
import { CockpitView, PaneEditOverlay } from './CockpitView';

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
    unplaceFromCockpit,
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
  // Which of the tab's layouts: the wide one on a wide window (if the tab has one); in Edit mode, the one being
  // edited (so what's arranged is what's seen). Entering Edit mode edits the one on screen.
  const [windowSize, setWindowSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const editVariant = useDashboardStore((st) => st.editVariant);
  const compactPreview = useDashboardStore((st) => st.compactPreview);
  // The layout for the window's shape (standard, or wide on an ultrawide)...
  const base = variantFor(Boolean(activeTab?.cockpitWide), windowSize.w, windowSize.h);
  // ...and what fits (lib/cockpitLayout chooseFit): that one, the compact one, or the stacked list. Measured after
  // each render (below), and kept per tab; before a tab is measured (just switched to), predicted from the room last
  // measured, so its first render is already the right layout: a wrong guess, corrected before paint, would still
  // mount the map, HUD and every widget twice.
  const [fit, setFit] = useState<{ tabId: string; value: CockpitVariant | 'stacked' } | null>(null);
  /** The room for panes last measured (before a pinned header) and the header's height. */
  const roomRef = useRef<{ w: number; h: number; header: number } | null>(null);
  const needOf = (tab: DashboardTab, layout: CockpitLayout | undefined) => {
    const byId = new Map(tab.widgets.map((w) => [w.instanceId, w.widgetId]));
    return minLayoutSize(layout?.root ?? null, (id) => {
      const widgetId = byId.get(id) ?? '';
      return widgetMinSize(
        widgetId,
        profile.customWidgets.find((c) => c.id === widgetId)
      );
    });
  };
  const predictFit = (tab: DashboardTab | undefined, editing: CockpitVariant | null): CockpitVariant | 'stacked' => {
    const b = variantFor(Boolean(tab?.cockpitWide), windowSize.w, windowSize.h);
    const r = roomRef.current;
    if (!tab || tab.mode !== 'cockpit' || !r) return editing ?? b;
    const fits = (l: CockpitLayout | undefined) =>
      layoutFits(needOf(tab, l), { w: r.w, h: r.h - (l?.header ? r.header : 0) });
    if (editing) return fits(layoutOf(tab, editing)) ? editing : 'stacked';
    return chooseFit(b, fits(layoutOf(tab, b) ?? tab.cockpit), tab.cockpitCompact ? fits(tab.cockpitCompact) : null);
  };
  const currentFit =
    fit && fit.tabId === activeTab?.id
      ? fit.value
      : predictFit(activeTab, isEditing && activeTab ? editTarget(activeTab, editVariant) : null);
  const shownVariant: CockpitVariant = currentFit === 'compact' && activeTab?.cockpitCompact ? 'compact' : base;
  // The layout to edit is chosen in the same click that enters Edit mode or changes tab while editing (not after
  // paint: for a frame the other layout would be shown, tearing down and rebuilding the map, HUD and every widget):
  // the one that tab shows, compact included.
  const variantShownFor = (tabId: string): CockpitVariant => {
    const tab = profile.tabs.find((t) => t.id === tabId);
    const p = predictFit(tab, null);
    return p === 'compact' && tab?.cockpitCompact
      ? 'compact'
      : variantFor(Boolean(tab?.cockpitWide), windowSize.w, windowSize.h);
  };
  const variant: CockpitVariant = isEditing && activeTab ? editTarget(activeTab, editVariant) : shownVariant;
  const cockpit = isCockpit ? (layoutOf(activeTab, variant) ?? { header: null, root: null }) : undefined;
  // Editing the compact layout on a window larger than the chosen laptop: shown in a frame that size, so what's
  // arranged is what a laptop shows.
  const preview =
    isEditing && isCockpit && variant === 'compact'
      ? (COMPACT_PREVIEWS.find((p) => p.id === compactPreview) ?? null)
      : null;
  const previewActive = !!preview && (windowSize.w > preview.w || windowSize.h > preview.h);
  const [previewBox, setPreviewBox] = useState<{ w: number; h: number } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  /**
   * The pinned header's resting height: the least seen for this layout. Its Takeoff checklist opening grows it for a
   * while (the panes give way); that mustn't count, or the tab would stack, unmounting the checklist mid-sequence.
   */
  const headerHeightRef = useRef<number | null>(null);
  const layoutKey = `${activeTab?.id}|${variant}|${cockpit?.header ?? ''}`;
  const lastLayoutKeyRef = useRef(layoutKey);
  const stacked = isCockpit && currentFit === 'stacked';
  /** A stacked widget being dragged (Edit mode). */
  const [stackDragging, setStackDragging] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!isCockpit || !cockpit) {
      setFit(null);
      return;
    }
    const tabId = activeTab.id;
    const setFitFor = (value: CockpitVariant | 'stacked') =>
      setFit((f) => (f && f.tabId === tabId && f.value === value ? f : { tabId, value }));
    // Another tab or header: its own resting height (reset here, before measuring, not after).
    if (lastLayoutKeyRef.current !== layoutKey) {
      lastLayoutKeyRef.current = layoutKey;
      headerHeightRef.current = null;
    }
    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      if (headerRef.current) {
        const h = headerRef.current.offsetHeight + 6;
        headerHeightRef.current = headerHeightRef.current === null ? h : Math.min(headerHeightRef.current, h);
      }
      const rect = el.getBoundingClientRect();
      const top = rect.top + window.scrollY;
      // Before the header is first measured, a guess a little over the pinned bar's height (one row when the content is
      // wide enough, two otherwise): measuring can only lower it (the least is kept), so the choice can't flip back
      // and forth. (Too generous a guess kept a layout that just fits, e.g. a compact one on a laptop, stacked.)
      const header = cockpit.header ? (headerHeightRef.current ?? (rect.width >= 700 ? 64 : 116)) : 0;
      // While editing, the editor's own bars (toolbar, not-shown list) don't count: the panes may be squeezed a little
      // for a while (their widgets are locked), but they stay panes, so they can be arranged on the screen they're for.
      const chrome = isEditing
        ? [...document.querySelectorAll('[data-edit-chrome]')].reduce(
            (sum, e) => sum + e.getBoundingClientRect().height + 8,
            0
          )
        : 0;
      // Less the container's bottom padding (12 px). A layout without a pinned header has its height too.
      // Kept for predicting another tab's fit (before it's measured): the room without the editor's bars.
      roomRef.current = {
        w: rect.width,
        h: window.innerHeight - top - 12 + chrome,
        header: headerHeightRef.current ?? header,
      };
      const roomFor = (layout: CockpitLayout | undefined) => ({
        w: rect.width,
        h: window.innerHeight - top - 12 + chrome - (layout?.header ? header : 0),
      });
      if (isEditing) {
        const editing = layoutOf(activeTab, variant);
        if (previewActive && preview) {
          // The frame: the room a window of the preview's size would give (the editor's bars aside).
          // The page's side gutter, from where the frame's container starts its content (not from the frame itself,
          // which once applied is narrower: measuring it would shrink it).
          const parent = el.parentElement;
          const gutter = parent
            ? parent.getBoundingClientRect().left + parseFloat(getComputedStyle(parent).paddingLeft || '0')
            : 12;
          const box = {
            w: Math.min(window.innerWidth - 2 * gutter, preview.w - 2 * gutter),
            h: Math.min(window.innerHeight - top - 12 + chrome, preview.h - (top - chrome) - 12),
          };
          setPreviewBox((b) => (b && b.w === box.w && b.h === box.h ? b : box));
          const room = { w: box.w, h: box.h - (editing?.header ? header : 0) };
          setFitFor(layoutFits(needOf(activeTab, editing), room) ? variant : 'stacked');
        } else {
          setPreviewBox(null);
          setFitFor(layoutFits(needOf(activeTab, editing), roomFor(editing)) ? variant : 'stacked');
        }
        return;
      }
      setPreviewBox(null);
      const baseLayout = layoutOf(activeTab, base) ?? activeTab.cockpit;
      const compact = activeTab.cockpitCompact;
      setFitFor(
        chooseFit(
          base,
          layoutFits(needOf(activeTab, baseLayout), roomFor(baseLayout)),
          compact ? layoutFits(needOf(activeTab, compact), roomFor(compact)) : null
        )
      );
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
  }, [
    isCockpit,
    cockpit,
    activeTab,
    isEditing,
    layoutKey,
    profile.customWidgets,
    base,
    variant,
    previewActive,
    preview,
  ]);
  const fill = isCockpit && !stacked;
  useEffect(() => {
    useLayoutStore.setState({ cockpitFill: fill });
    return () => useLayoutStore.setState({ cockpitFill: false });
  }, [fill]);
  const placedIds = new Set(panesInOrder(cockpit));
  // The tab's other layouts (standard, wide, compact) that exist: deleting a widget they show removes it there too.
  const others = isCockpit ? otherLayouts(activeTab, variant) : [];
  const shownElsewhere = (id: string) => others.filter((v) => panesInOrder(layoutOf(activeTab, v)).includes(id));
  const otherPlaced = new Set(
    activeTab ? activeTab.widgets.map((w) => w.instanceId).filter((id) => shownElsewhere(id).length) : []
  );
  const otherName = (id: string) => shownElsewhere(id).join(' and ');
  const [confirmDeleteHidden, setConfirmDeleteHidden] = useState<string | null>(null);
  // A pending "Remove from both layouts?" doesn't outlive what it was about.
  useEffect(() => setConfirmDeleteHidden(null), [activeTab?.id, variant, isEditing]);
  const emptyCockpit = isCockpit && !cockpit?.root && !cockpit?.header;
  const unplaced = isCockpit ? activeTab.widgets.filter((w) => !placedIds.has(w.instanceId)) : [];

  const getWidgetTitle = (widgetId: string): string => {
    const BUILTIN_TITLES: Record<string, string> = {
      'built-in-glareshield': 'Arm & Modes',
      'built-in-arm-modes': 'Arm & Modes',
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
      'built-in-link': 'Link',
      'built-in-parameters': 'Parameters',
      'built-in-charts': 'Telemetry Graphs',
      'built-in-pid-tuning': 'PID Tuning',
      'built-in-logs': 'Logs',
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
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-center font-mono text-xs text-zinc-500">
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
            `flex w-full flex-1 flex-col gap-2 p-2 sm:p-3 ${fill ? 'min-h-0' : ''}`
          : `flex flex-1 flex-col p-3 sm:p-5 ${CONTENT_WIDTH_CLASS[contentWidth]} mx-auto w-full space-y-4`
      }
    >
      {/* Tab Navigation Bar */}
      <div className="relative flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
        {/* Scrollable Tabs with Mobile Scroll Hint */}
        <div className="relative flex min-w-0 flex-1 items-center">
          <div className="scrollbar-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 pr-6 sm:gap-2">
            {profile.tabs.map((tab, tabIdx) => {
              const isActive = tab.id === activeTab?.id;
              const isBeingRenamed = editingTabId === tab.id;
              const isConfirmingDelete = confirmDeleteTabId === tab.id;
              const isTabDropTarget = dropTargetTabIdx === tabIdx && draggedTabIdx !== null && draggedTabIdx !== tabIdx;

              if (isConfirmingDelete) {
                return (
                  <div
                    key={tab.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-950/80 px-2.5 py-1 text-xs text-red-200 shadow-sm"
                  >
                    <span className="text-[11px] font-semibold">Delete &quot;{tab.title}&quot;?</span>
                    <button
                      onClick={() => {
                        removeTab(tab.id);
                        setConfirmDeleteTabId(null);
                        // Deleting the open tab moves to another: edit the layout shown for that one. (Deleting another
                        // tab leaves the open one, and the layout being edited, as they are.)
                        const st = useDashboardStore.getState();
                        if (isActive && st.isEditing) st.setEditVariant(variantShownFor(st.activeTabId));
                      }}
                      className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-500"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteTabId(null)}
                      className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700"
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
                  className={`group relative flex shrink-0 items-center rounded-lg transition-all ${
                    isTabDropTarget ? 'bg-sky-950/30 ring-2 ring-sky-400' : ''
                  } ${draggedTabIdx === tabIdx ? 'opacity-50' : ''}`}
                >
                  {isBeingRenamed ? (
                    <div className="flex items-center gap-1 rounded-lg border border-sky-500 bg-zinc-900 px-2 py-1">
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
                        className="h-6 w-28 px-1 py-0 text-xs font-semibold"
                        autoFocus
                      />
                      <button onClick={() => handleSaveRename(tab.id)} className="text-emerald-400 hover:text-white">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (isEditing) useDashboardStore.getState().setEditVariant(variantShownFor(tab.id));
                        setActiveTab(tab.id);
                      }}
                      className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all sm:px-4 sm:text-sm ${
                        isActive
                          ? 'border border-zinc-700 bg-zinc-800 text-sky-400 shadow-sm'
                          : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
                      } ${isEditing ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      title={isEditing ? 'Drag to reorder tab' : tab.title}
                    >
                      {isEditing && <GripVertical className="-ml-1 h-3 w-3 text-zinc-500" />}
                      <span>{tab.title}</span>
                      <span className="font-mono text-[10px] text-zinc-500">({tab.widgets.length})</span>
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
                className="h-8 shrink-0 gap-1 border-dashed px-2 text-xs text-zinc-400 hover:text-zinc-100"
              >
                <Plus className="h-3 w-3" />
                <span>New Tab</span>
              </Button>
            )}

            {isEditing && isAddingTab && (
              <form onSubmit={handleCreateTab} className="flex shrink-0 items-center gap-1">
                <Input
                  type="text"
                  placeholder="Tab Name..."
                  value={newTabTitle}
                  onChange={(e) => setNewTabTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setIsAddingTab(false);
                  }}
                  className="h-7 w-28 px-2 py-0 text-xs font-semibold"
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
            className="pointer-events-none absolute bottom-0 right-0 top-0 flex w-7 items-center justify-end bg-gradient-to-l from-zinc-950 via-zinc-950/80 to-transparent pr-0.5 text-zinc-500 sm:hidden"
            aria-hidden="true"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>

        {/* Far Right: Edit Mode Button (hidden while editing since EditToolbar has Finish Edit) */}
        {!isEditing && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab) useDashboardStore.getState().setEditVariant(shownVariant);
                toggleEditing();
              }}
              className="h-8 gap-1.5 px-3 text-xs font-semibold"
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
        <div
          data-edit-chrome
          className="flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-400"
        >
          <span className="font-semibold text-zinc-300">Not shown in this layout:</span>
          {unplaced.map((w) => (
            <span
              key={w.instanceId}
              className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5"
            >
              {getWidgetTitle(w.widgetId)}
              {otherPlaced.has(w.instanceId) && (
                <span
                  className="rounded bg-sky-950 px-1 text-[9px] font-bold text-sky-300"
                  title={`Shown in the ${otherName(w.instanceId)} layout`}
                >
                  in {otherName(w.instanceId)}
                </span>
              )}
              <button
                type="button"
                onClick={() => placeInCockpit(activeTab.id, w.instanceId)}
                className="flex items-center gap-0.5 text-sky-300 hover:text-sky-200"
                title="Show it as a new pane"
              >
                <Eye className="h-3 w-3" />
                Show
              </button>
              {confirmDeleteHidden === w.instanceId ? (
                <span className="flex items-center gap-1 text-red-200">
                  Remove from both layouts?
                  <button
                    type="button"
                    onClick={() => removeWidgetFromActiveTab(w.instanceId)}
                    className="rounded bg-red-600 px-1 font-bold text-white"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteHidden(null)}
                    className="rounded bg-zinc-800 px-1"
                  >
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  // Shown in the other layout: ask first (it would go from there too). Otherwise at once.
                  onClick={() =>
                    otherPlaced.has(w.instanceId)
                      ? setConfirmDeleteHidden(w.instanceId)
                      : removeWidgetFromActiveTab(w.instanceId)
                  }
                  className="text-zinc-500 hover:text-red-400"
                  title={
                    otherPlaced.has(w.instanceId)
                      ? `Remove it from the tab (and the ${otherName(w.instanceId)} layout)`
                      : 'Remove it from the tab'
                  }
                  aria-label={`Remove ${getWidgetTitle(w.widgetId)} from the tab`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {emptyCockpit ? (
        <div
          ref={contentRef}
          className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-800 p-6 text-center"
        >
          <div>
            <LayoutPanelTop className="mx-auto mb-2 h-8 w-8 text-zinc-600" />
            <p className="text-sm font-bold text-zinc-300">This Cockpit tab shows no panes</p>
            <p className="mt-1 text-xs text-zinc-500">
              In Edit mode, pick a preset, Show a widget listed above, or Add Widget.
            </p>
          </div>
        </div>
      ) : isCockpit && fill ? (
        <div
          ref={contentRef}
          className={`flex min-h-0 flex-col ${previewActive && previewBox ? 'mx-auto flex-none outline-dashed outline-1 outline-offset-4 outline-sky-500/60' : 'flex-1'}`}
          style={previewActive && previewBox ? { width: previewBox.w, height: previewBox.h } : undefined}
        >
          <CockpitView
            tab={{ ...activeTab, cockpit }}
            isEditing={isEditing}
            renderWidget={renderWidgetContent}
            titleOf={getWidgetTitle}
            headerRef={headerRef}
            onEditCustomWidget={onEditCustomWidget}
          />
        </div>
      ) : isCockpit ? (
        // Too small for the panes: the same widgets, stacked in reading order.
        <div ref={contentRef} className="flex flex-col gap-3">
          {isEditing && (
            // Editor chrome: not counted against the room (counted, it kept the tab stacked once it was).
            <p
              data-edit-chrome
              className="flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] text-zinc-400"
            >
              <LayoutPanelTop className="h-3.5 w-3.5 shrink-0 text-sky-400" />
              Shown stacked: the panes don&apos;t fit {preview ? `a ${preview.label}'s window` : 'this window'} (with
              the edit bar). Hide, change or delete some below to make them fit, or arrange them on a larger screen;
              dragging and swapping arrange the panes as they&apos;ll be shown.
            </p>
          )}
          {panesInOrder(cockpit).map((id) => {
            const w = activeTab.widgets.find((x) => x.instanceId === id);
            if (!w) return null;
            const isHeader = id === cockpit?.header;
            return (
              // In Edit mode each gets the same bar as a pane (the pinned bar: Hide), so a layout too big for the
              // window can be made to fit here.
              <div key={id} className={`relative @container ${isEditing ? 'min-h-[7rem]' : ''}`}>
                <ErrorBoundary fallbackTitle={getWidgetTitle(w.widgetId)}>{renderWidgetContent(w)}</ErrorBoundary>
                {isEditing &&
                  (isHeader ? (
                    <div className="ring-dashed absolute inset-0 z-20 flex select-none items-start justify-between gap-2 rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-sky-500/50">
                      <span className="rounded bg-zinc-900/95 px-2 py-0.5 text-[11px] font-bold text-sky-300">
                        {getWidgetTitle(w.widgetId)} · pinned above the panes
                      </span>
                      <button
                        type="button"
                        onClick={() => unplaceFromCockpit(activeTab.id, id)}
                        className="flex items-center gap-1 rounded bg-zinc-900/95 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:text-white"
                      >
                        <EyeOff className="h-3 w-3" />
                        Hide
                      </button>
                    </div>
                  ) : (
                    <PaneEditOverlay
                      tab={{ ...activeTab, cockpit }}
                      placed={w}
                      title={getWidgetTitle(w.widgetId)}
                      titleOf={getWidgetTitle}
                      min={widgetMinSize(
                        w.widgetId,
                        profile.customWidgets.find((c) => c.id === w.widgetId)
                      )}
                      dragging={stackDragging}
                      setDragging={setStackDragging}
                      onEditCustomWidget={onEditCustomWidget}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      ) : activeTab && activeTab.widgets.length > 0 ? (
        <div className="grid grid-cols-12 items-stretch gap-3 sm:gap-4">
          {activeTab.widgets.map((widget, idx) => {
            const colSpan = widget.colSpan || 6;
            const rowSpan = widget.rowSpan || 2;
            const heightPresetClass =
              rowSpan === 1 ? 'max-h-[260px] overflow-y-auto' : rowSpan === 3 ? 'min-h-[540px]' : '';
            const isConfirmingDeleteWidget = confirmDeleteWidgetId === widget.instanceId;
            const customDef = profile.customWidgets.find((w) => w.id === widget.widgetId);
            const isDropTarget = dropTargetWidgetIdx === idx && draggedWidgetIdx !== null && draggedWidgetIdx !== idx;
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
                className={`${getColSpanClass(colSpan)} group relative flex h-full flex-col transition-all @container ${
                  isBeingDragged ? 'scale-[0.99] opacity-40' : ''
                } ${isDropTarget ? 'rounded-xl bg-sky-950/20 ring-2 ring-sky-400' : ''}`}
              >
                {/* Edit Overlay Toolbar when in Edit Mode */}
                {isEditing && (
                  <div className="mb-1.5 flex items-center justify-between gap-1 rounded-lg border border-zinc-700/80 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 shadow-md">
                    <div
                      className="flex min-w-0 cursor-grab items-center gap-1.5 active:cursor-grabbing"
                      title="Drag card to reorder in grid — its controls are locked while editing"
                    >
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      <span
                        className="truncate font-sans text-[11px] font-bold text-sky-400"
                        title={getWidgetTitle(widget.widgetId)}
                      >
                        {getWidgetTitle(widget.widgetId)}
                      </span>
                      <span
                        className="hidden shrink-0 items-center gap-1 rounded border border-zinc-700 bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 2xl:inline-flex"
                        title="Widget controls are locked in Edit Mode so you can safely drag to reorder"
                      >
                        <Lock className="h-2.5 w-2.5 text-amber-400" />
                        Drag · Controls Locked
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1">
                      {/* Width and height as compact pickers, so the title keeps its room. */}
                      <select
                        value={colSpan}
                        onChange={(e) => updateWidgetColSpan(widget.instanceId, Number(e.target.value))}
                        className="h-6 cursor-pointer rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-sky-300"
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
                        className="h-6 cursor-pointer rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-emerald-300"
                        title="Widget height"
                        aria-label="Widget height"
                      >
                        {HEIGHT_OPTIONS.map((opt) => (
                          <option key={opt.rows} value={opt.rows}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      <div className="mx-0.5 h-3 w-px bg-zinc-700" />

                      {/* Edit Custom Widget button */}
                      {customDef && onEditCustomWidget && (
                        <>
                          <button
                            onClick={() => onEditCustomWidget(customDef)}
                            className="flex items-center p-1 text-amber-400 hover:text-amber-300"
                            title="Edit custom widget definition"
                          >
                            <Sliders className="h-3 w-3" />
                          </button>
                          <div className="mx-0.5 h-3 w-px bg-zinc-700" />
                        </>
                      )}

                      {/* Move buttons */}
                      <button
                        onClick={() => moveWidget(widget.instanceId, 'up')}
                        disabled={idx === 0}
                        className="flex items-center p-1 hover:text-white disabled:opacity-30"
                        title="Move Earlier (Up / Left)"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveWidget(widget.instanceId, 'down')}
                        disabled={idx === activeTab.widgets.length - 1}
                        className="flex items-center p-1 hover:text-white disabled:opacity-30"
                        title="Move Later (Down / Right)"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>

                      <div className="mx-0.5 h-3 w-px bg-zinc-700" />

                      {/* Remove button with confirmation */}
                      {isConfirmingDeleteWidget ? (
                        <div className="flex items-center gap-1 rounded border border-red-500/40 bg-red-950/90 px-1.5 py-0.5 text-[10px] text-red-200">
                          <span>Delete?</span>
                          <button
                            onClick={() => {
                              removeWidgetFromActiveTab(widget.instanceId);
                              setConfirmDeleteWidgetId(null);
                            }}
                            className="rounded bg-red-600 px-1 text-[9px] font-bold text-white hover:bg-red-500"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDeleteWidgetId(null)}
                            className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-300 hover:bg-zinc-700"
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
                  className={`relative flex h-full flex-col ${heightPresetClass} ${
                    isEditing ? 'ring-dashed rounded-xl ring-1 ring-zinc-700' : ''
                  }`}
                >
                  <ErrorBoundary fallbackTitle={getWidgetTitle(widget.widgetId)}>
                    {renderWidgetContent(widget)}
                  </ErrorBoundary>
                  {isEditing && (
                    <div
                      className="pointer-events-auto absolute inset-0 z-20 flex cursor-grab select-none items-center justify-center rounded-xl active:cursor-grabbing"
                      title="Drag to reorder widget — its controls are locked while editing"
                    >
                      {isDropTarget && (
                        <span className="flex items-center gap-1.5 rounded-lg border border-sky-400 bg-sky-950/95 px-3 py-1.5 font-mono text-[11px] font-bold text-sky-200 shadow-lg">
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
        <div className="rounded-2xl border-2 border-dashed border-zinc-800 p-6 py-16 text-center">
          <Layers className="mx-auto mb-3 h-10 w-10 text-zinc-600" />
          <h3 className="text-sm font-bold text-zinc-300">This tab has no widgets</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            Click &quot;Edit Mode&quot; in the header, then click &quot;Add Widget&quot; to place telemetry cards,
            flight instruments, or custom controls here.
          </p>
        </div>
      )}
    </div>
  );
};
