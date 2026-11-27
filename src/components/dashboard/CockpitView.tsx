// A Cockpit tab: the pinned header (the quick-actions bar, at its own height) above panes that fill the rest of the
// window, laid out by the tab's tree (lib/cockpitLayout.ts) with react-resizable-panels. Dividers move only in Edit
// mode (a stray drag in flight must not rearrange the instruments); in flight they're thin inert seams. Each pane is
// a size container (@container), so widgets lay out by the pane's width, and tells its widget to fill it (PaneContext).

import React, { Fragment, useEffect, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';

import {
  ArrowLeftRight,
  ChevronLeft,
  EyeOff,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  Sliders,
  Trash2,
} from 'lucide-react';

import { BUILTIN_PANELS } from '../../lib/builtinWidgets';
import {
  isPane,
  minLayoutSize,
  panesInOrder,
  QUICK_ACTIONS,
  widgetMinSize,
  type DropZone,
  type Size,
} from '../../lib/cockpitLayout';
import { editTarget, layoutOf, otherLayouts, useDashboardStore, type DashboardState } from '../../store/dashboardStore';
import type { CockpitNode, CustomWidgetDefinition, DashboardTab, PlacedWidget } from '../../types/widget';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { HeaderMenu, MenuItem, MenuSection } from '../ui/HeaderMenu';
import { HeaderSlotContext, PaneContext } from './paneContext';

interface Props {
  tab: DashboardTab;
  isEditing: boolean;
  renderWidget: (placed: PlacedWidget) => React.ReactNode;
  titleOf: (widgetId: string) => string;
  /** The header's element, measured by the dashboard (how much room the panes have). */
  headerRef?: React.Ref<HTMLDivElement>;
  /** Open the custom widget editor (Edit mode, a pane showing a custom widget). */
  onEditCustomWidget?: (def: CustomWidgetDefinition) => void;
}

/** A structural key: a split remounts when its shape changes (other children), not when only its sizes do. */
function shapeKey(n: CockpitNode): string {
  return isPane(n) ? n.pane : `${n.split}(${n.children.map(shapeKey).join(',')})`;
}

interface SplitProps {
  tab: DashboardTab;
  node: Extract<CockpitNode, { split: unknown }>;
  path: number[];
  isEditing: boolean;
  minFor: (id: string) => Size;
  renderChild: (child: CockpitNode, path: number[]) => React.ReactNode;
}

/**
 * One split. Its panels' sizes come from the store: a divider drag saves them (the proportions asked for, not
 * those squeezed to fit a small window, which the library restores when the window grows back), and sizes that
 * change otherwise (a preset over the same shape, an import) are applied to the mounted group, rather than
 * remounting it (which would rebuild the map and HUD inside).
 */
const SplitView: React.FC<SplitProps> = ({ tab, node, path, isEditing, minFor, renderChild }) => {
  const setCockpitSizes = useDashboardStore((s) => s.setCockpitSizes);
  const groupRef = useGroupRef();
  const horizontal = node.split === 'row';
  const gid = `ck-${tab.id}-${path.join('.') || 'root'}`;
  const sizesKey = node.sizes.join(',');
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const current = g.getLayout();
    const wanted: Record<string, number> = {};
    node.sizes.forEach((s, i) => (wanted[`${gid}-${i}`] = s));
    if (Object.keys(wanted).some((k) => Math.abs((current[k] ?? 0) - wanted[k]) > 0.5)) g.setLayout(wanted);
    // Only when the stored sizes change (not on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizesKey]);
  return (
    <Group
      id={gid}
      groupRef={groupRef}
      orientation={horizontal ? 'horizontal' : 'vertical'}
      disabled={!isEditing}
      className="h-full w-full"
      onLayoutChanged={(sizes, meta) => {
        if (!meta.isUserInteraction) return;
        const asked = meta.requestedLayout ?? sizes;
        setCockpitSizes(
          tab.id,
          path,
          node.children.map((_, i) => asked[`${gid}-${i}`] ?? node.sizes[i])
        );
      }}
    >
      {node.children.map((child, i) => {
        const min = minLayoutSize(child, minFor);
        return (
          <Fragment key={shapeKey(child)}>
            {i > 0 && (
              <Separator
                disabled={!isEditing}
                className={
                  isEditing
                    ? `${horizontal ? 'w-1.5' : 'h-1.5'} rounded-full bg-zinc-700 transition-colors hover:bg-sky-500 data-[separator=active]:bg-sky-400`
                    : `${horizontal ? 'w-1.5' : 'h-1.5'} bg-transparent`
                }
              />
            )}
            <Panel id={`${gid}-${i}`} defaultSize={`${node.sizes[i]}`} minSize={horizontal ? min.w : min.h}>
              {renderChild(child, [...path, i])}
            </Panel>
          </Fragment>
        );
      })}
    </Group>
  );
};

/** The data type a dragged pane carries (its instance ID). */
const PANE_DRAG_TYPE = 'application/x-glareshield-pane';

/** Which part of a pane a pointer is over: an edge (within a quarter of the way in) or the center. */
function zoneAt(rect: DOMRect, x: number, y: number): DropZone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (edge > 0.25) return 'center';
  if (edge === fx) return 'left';
  if (edge === 1 - fx) return 'right';
  return edge === fy ? 'top' : 'bottom';
}

type Side = Exclude<DropZone, 'center'>;

/** The whole layout's edges: a pane there spans its full width (top, bottom) or height (left, right). */
const EDGES: [Side, string][] = [
  ['top', 'Along the whole top:'],
  ['bottom', 'Along the whole bottom:'],
  ['left', 'Down the whole left:'],
  ['right', 'Down the whole right:'],
];
const EDGE_TEXT: Record<Side, string> = {
  top: 'Across the whole top',
  bottom: 'Across the whole bottom',
  left: 'Down the whole left side',
  right: 'Down the whole right side',
};
/** How far (px) the pointer moves from the drag's start before the edge strips appear. */
const ARM_DISTANCE_PX = 40;
const EDGE_STRIP: Record<Side, string> = {
  top: 'inset-x-0 top-0 h-4',
  bottom: 'inset-x-0 bottom-0 h-4',
  left: 'inset-y-0 left-0 w-4',
  right: 'inset-y-0 right-0 w-4',
};
const EDGE_PREVIEW: Record<Side, string> = {
  top: 'inset-x-0 top-0 h-1/4',
  bottom: 'inset-x-0 bottom-0 h-1/4',
  left: 'inset-y-0 left-0 w-1/4',
  right: 'inset-y-0 right-0 w-1/4',
};

/**
 * While a pane is dragged, a strip along each outer edge of the layout: dropped there, the pane goes across the
 * whole top or bottom (or down a whole side), not just beside one pane. The band it would take is previewed.
 */
const EdgeTargets: React.FC<{ tabId: string; dragging: string; onDone: () => void }> = ({
  tabId,
  dragging,
  onDone,
}) => {
  const moveToEdge = useDashboardStore((s) => s.moveToEdgeInCockpit);
  const [over, setOver] = useState<Side | null>(null);
  // The strips appear only once the pointer has moved away from where the drag began: a top-row pane's grip is at the
  // top edge, and letting go there (to call the drag off) mustn't pull the pane across the whole top.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    let origin: { x: number; y: number } | null = null;
    const onOver = (e: DragEvent) => {
      if (!origin) origin = { x: e.clientX, y: e.clientY };
      else if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > ARM_DISTANCE_PX) {
        setArmed(true);
        document.removeEventListener('dragover', onOver, true);
      }
    };
    document.addEventListener('dragover', onOver, true);
    return () => document.removeEventListener('dragover', onOver, true);
  }, []);
  if (!armed) return null;
  return (
    <>
      {over && (
        <div
          className={`pointer-events-none absolute z-40 ${EDGE_PREVIEW[over]} flex items-center justify-center rounded-lg border-2 border-emerald-400 bg-emerald-500/20`}
        >
          <span className="rounded bg-emerald-950/95 px-2 py-0.5 text-[11px] font-bold text-emerald-200">
            {EDGE_TEXT[over]}
          </span>
        </div>
      )}
      {(['top', 'bottom', 'left', 'right'] as Side[]).map((side) => (
        <div
          key={side}
          className={`absolute z-40 ${EDGE_STRIP[side]} rounded bg-emerald-500/30`}
          title={EDGE_TEXT[side]}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PANE_DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (over !== side) setOver(side);
          }}
          // Strips overlap at the corners: leaving one clears only its own highlight.
          onDragLeave={() => setOver((cur) => (cur === side ? null : cur))}
          onDrop={(e) => {
            e.preventDefault();
            const src = e.dataTransfer.getData(PANE_DRAG_TYPE) || dragging;
            if (src) moveToEdge(tabId, src, side);
            setOver(null);
            onDone();
          }}
        />
      ))}
    </>
  );
};

const ZONE_CLASS: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
  center: 'inset-3',
};
const ZONE_TEXT: Record<DropZone, string> = {
  left: 'Put it on the left',
  right: 'Put it on the right',
  top: 'Put it above',
  bottom: 'Put it below',
  center: 'Swap places',
};

interface OverlayProps {
  tab: DashboardTab;
  placed: PlacedWidget;
  title: string;
  titleOf: (widgetId: string) => string;
  min: Size;
  dragging: string | null;
  setDragging: (id: string | null) => void;
  /** Open the custom widget editor, for a custom widget. */
  onEditCustomWidget?: (def: CustomWidgetDefinition) => void;
  /** In the stacked grid (the layout didn't fit): there are no dividers to resize with. */
  stacked?: boolean;
}

/**
 * A pane in Edit mode: its widget locked (as in Flow tabs), with a bar to arrange it. Drag the pane (by its body or
 * grip) onto another: an edge puts it there, the center swaps them; the highlight shows where. From the keyboard, Add…
 * puts a widget on any side of this one, Replace… swaps it with another pane or shows another widget here (the old
 * one stays on the tab, hidden); Hide takes it out of the layout, Delete off the tab. In a narrow pane the bar keeps
 * to one row (the title folds to its grip).
 */
/** How many of the tab's other layouts (than the one being edited) show a widget. */
function shownInOthers(s: DashboardState, tabId: string, instanceId: string): number {
  const full = s.profile.tabs.find((t) => t.id === tabId);
  if (!full) return 0;
  return otherLayouts(full, editTarget(full, s.editVariant)).filter((v) =>
    panesInOrder(layoutOf(full, v)).includes(instanceId)
  ).length;
}
/** "both layouts" (this and one other), "all 3 layouts". */
const layoutsText = (others: number) => (others === 1 ? 'both layouts' : `all ${others + 1} layouts`);

type PickItem = { value: string; name: string };
const SIDES: [Side, string][] = [
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Above'],
  ['bottom', 'Below'],
];

/**
 * A pane's menu in Edit mode: Add beside (where, then which widget), Replace (swap with another pane, or show another
 * widget here), and the pane's own actions. Mounted when the menu opens, so it starts at the top level each time.
 */
const PaneMenuBody: React.FC<{
  close: () => void;
  hidden: PickItem[];
  catalog: PickItem[];
  others: PickItem[];
  onAdd: (where: 'pane' | 'edge', side: Side, value: string) => void;
  onSwap: (instanceId: string) => void;
  onShowInstead: (value: string) => void;
  onEditCustom?: () => void;
  onPin?: () => void;
  onHide: () => void;
  onDelete: () => void;
}> = (p) => {
  const [view, setView] = useState<'main' | 'add' | 'replace'>('main');
  const [where, setWhere] = useState<{ at: 'pane' | 'edge'; side: Side }>({ at: 'pane', side: 'right' });
  const done = (f: () => void) => () => {
    f();
    p.close();
  };
  const back = (label: string) => (
    <button
      type="button"
      onClick={() => setView('main')}
      className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  );
  const widgets = (pick: (value: string) => void) => (
    <>
      {p.hidden.length > 0 && <MenuSection label="Hidden on this tab" />}
      {p.hidden.map((w) => (
        <MenuItem key={w.value} label={w.name} onClick={done(() => pick(w.value))} />
      ))}
      <MenuSection label="New" />
      {p.catalog.map((w) => (
        <MenuItem key={w.value} label={w.name} onClick={done(() => pick(w.value))} />
      ))}
    </>
  );
  const chip = (active: boolean) =>
    `rounded px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-sky-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`;

  if (view === 'add')
    return (
      <>
        {back('Add beside')}
        <div className="space-y-1 px-2 pb-1">
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-full text-[10px] text-zinc-500">This pane</span>
            {SIDES.map(([side, label]) => (
              <button
                key={side}
                type="button"
                className={chip(where.at === 'pane' && where.side === side)}
                onClick={() => setWhere({ at: 'pane', side })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="w-full text-[10px] text-zinc-500">Whole tab</span>
            {SIDES.map(([side, label]) => (
              <button
                key={side}
                type="button"
                className={chip(where.at === 'edge' && where.side === side)}
                onClick={() => setWhere({ at: 'edge', side })}
                title={EDGES.find(([s]) => s === side)?.[1].replace(/:$/, '')}
              >
                {label === 'Above' ? 'Top' : label === 'Below' ? 'Bottom' : label}
              </button>
            ))}
          </div>
        </div>
        {widgets((v) => p.onAdd(where.at, where.side, v))}
      </>
    );
  if (view === 'replace')
    return (
      <>
        {back('Replace')}
        {p.others.length > 0 && <MenuSection label="Swap places with" first />}
        {p.others.map((o) => (
          <MenuItem key={o.value} label={o.name} onClick={done(() => p.onSwap(o.value))} />
        ))}
        <MenuSection label="Show here instead" first={p.others.length === 0} />
        <div className="px-2.5 pb-1 text-[10px] text-zinc-500">This one stays on the tab, hidden.</div>
        {widgets(p.onShowInstead)}
      </>
    );
  return (
    <>
      <MenuItem icon={<Plus className="h-3.5 w-3.5" />} label="Add beside…" detail="›" onClick={() => setView('add')} />
      <MenuItem
        icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
        label="Replace…"
        detail="›"
        onClick={() => setView('replace')}
      />
      {p.onEditCustom && (
        <MenuItem
          icon={<Sliders className="h-3.5 w-3.5 text-amber-400" />}
          label="Edit custom widget"
          onClick={done(p.onEditCustom)}
        />
      )}
      {p.onPin && (
        <MenuItem icon={<Pin className="h-3.5 w-3.5" />} label="Pin above the panes" onClick={done(p.onPin)} />
      )}
      <div className="my-1 border-t border-zinc-800" />
      <MenuItem icon={<EyeOff className="h-3.5 w-3.5" />} label="Hide (stays on the tab)" onClick={done(p.onHide)} />
      <MenuItem danger icon={<Trash2 className="h-3.5 w-3.5" />} label="Delete…" onClick={done(p.onDelete)} />
    </>
  );
};

export const PaneEditOverlay: React.FC<OverlayProps> = ({
  tab,
  placed,
  title,
  titleOf,
  min,
  dragging,
  setDragging,
  onEditCustomWidget,
  stacked = false,
}) => {
  const id = placed.instanceId;
  const customWidgets = useDashboardStore((s) => s.profile.customWidgets);
  const customDef = customWidgets.find((w) => w.id === placed.widgetId);
  // Shown in the tab's other layouts too (standard / wide / compact)? Deleting it removes it there as well: the
  // prompt says so.
  const inOther = useDashboardStore((s) => shownInOthers(s, tab.id, placed.instanceId));
  const {
    unplaceFromCockpit,
    splitInCockpit,
    addAtEdgeInCockpit,
    replaceInCockpit,
    moveInCockpit,
    removeWidgetFromActiveTab,
    pinInCockpit,
  } = useDashboardStore.getState();
  // The quick-actions bar as a pane can be pinned above the panes again (when nothing else is).
  const canPin = QUICK_ACTIONS.has(placed.widgetId) && !tab.cockpit?.header;
  const [zone, setZone] = useState<DropZone | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const shown = new Set(panesInOrder(tab.cockpit));
  const hidden = tab.widgets.filter((w) => !shown.has(w.instanceId));
  const others = panesInOrder({ header: null, root: tab.cockpit?.root ?? null }).filter((p) => p !== id);
  const catalog = [
    ...Object.keys(BUILTIN_PANELS).map((w) => ({ id: w, name: titleOf(w) })),
    ...customWidgets.map((w) => ({ id: w.id, name: w.name })),
  ];
  const nameOf = (instanceId: string) => titleOf(tab.widgets.find((w) => w.instanceId === instanceId)?.widgetId ?? '');
  // Sources: "w:<widgetId>" a new widget of that type, "i:<instanceId>" a hidden one of this tab's.
  const source = (v: string) => (v.startsWith('i:') ? { instanceId: v.slice(2) } : { widgetId: v.slice(2) });
  const startDrag = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(PANE_DRAG_TYPE, id);
    setDragging(id);
  };
  // No drag under way (it ended, or Escape canceled it): no highlight left behind.
  useEffect(() => {
    if (!dragging) setZone(null);
  }, [dragging]);
  const dropping = zone && dragging && dragging !== id;

  return (
    <div
      className="ring-dashed absolute inset-0 z-20 flex select-none flex-col rounded-xl bg-zinc-950/55 ring-1 ring-sky-500/50 @container"
      onDragOver={(e) => {
        // A pane being dragged (its own data type: known before any re-render; not some other drag, e.g. a file).
        if (!e.dataTransfer.types.includes(PANE_DRAG_TYPE) || dragging === id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const z = zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
        if (z !== zone) setZone(z);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setZone(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        // From the drop itself (which pane, which part): the highlight's state may not have caught up yet.
        const src = e.dataTransfer.getData(PANE_DRAG_TYPE) || dragging;
        const at = zoneAt(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);
        if (src && src !== id && tab.widgets.some((w) => w.instanceId === src)) moveInCockpit(tab.id, src, id, at);
        setZone(null);
        setDragging(null);
      }}
    >
      <div className="flex items-center justify-between gap-1 border-b border-zinc-700/70 bg-zinc-900/95 px-1 py-0.5 text-[11px]">
        <span
          draggable
          onDragStart={startDrag}
          onDragEnd={() => setDragging(null)}
          className="flex min-w-0 cursor-grab items-center gap-1 font-bold text-sky-300 active:cursor-grabbing"
          title={`${title}: drag onto another pane (an edge puts it there, the center swaps them)`}
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <Lock className="hidden h-3 w-3 shrink-0 text-amber-400 @xs:block" />
          <span className="hidden truncate @xs:inline">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {confirmDelete ? null : (
            <HeaderMenu
              iconOnly
              icon={<MoreHorizontal className="h-3.5 w-3.5" />}
              label={`Arrange ${title}`}
              title="Add beside, replace, hide or delete"
              widthClass="w-64"
            >
              {(close) => (
                <PaneMenuBody
                  close={close}
                  hidden={hidden.map((w) => ({ value: `i:${w.instanceId}`, name: titleOf(w.widgetId) }))}
                  catalog={catalog.map((c) => ({ value: `w:${c.id}`, name: c.name }))}
                  others={others.map((o) => ({ value: o, name: nameOf(o) }))}
                  onAdd={(where, side, v) =>
                    where === 'edge'
                      ? addAtEdgeInCockpit(tab.id, side, source(v))
                      : splitInCockpit(tab.id, id, side, source(v))
                  }
                  onSwap={(other) => moveInCockpit(tab.id, id, other, 'center')}
                  onShowInstead={(v) => replaceInCockpit(tab.id, id, source(v))}
                  onEditCustom={customDef && onEditCustomWidget ? () => onEditCustomWidget(customDef) : undefined}
                  onPin={canPin ? () => pinInCockpit(tab.id, id) : undefined}
                  onHide={() => unplaceFromCockpit(tab.id, id)}
                  onDelete={() => setConfirmDelete(true)}
                />
              )}
            </HeaderMenu>
          )}
          {confirmDelete ? (
            <span className="flex items-center gap-0.5 rounded border border-red-500/40 bg-red-950/90 px-0.5 text-[10px] text-red-200">
              <button
                type="button"
                onClick={() => removeWidgetFromActiveTab(id)}
                className="rounded bg-red-600 px-1 font-bold text-white"
                title={
                  inOther
                    ? `Delete ${title} from the tab: it leaves ${layoutsText(inOther)}`
                    : `Delete ${title} from the tab`
                }
              >
                {inOther ? `Delete (${layoutsText(inOther)})` : 'Delete'}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded bg-zinc-800 px-1">
                No
              </button>
            </span>
          ) : null}
        </span>
      </div>
      {/* The body drags the pane too (the bar's controls stay clickable). */}
      <div
        draggable
        onDragStart={startDrag}
        onDragEnd={() => setDragging(null)}
        className="flex flex-1 cursor-grab items-center justify-center px-2 text-center text-[10px] text-zinc-400 active:cursor-grabbing"
      >
        {dragging && dragging !== id
          ? 'Drop on an edge to put it there, in the middle to swap'
          : `Drag to move${stacked ? '' : ' · dividers resize'} · min ${min.w}×${min.h}`}
      </div>
      {/* Where it would go, over the whole pane (what's highlighted is what the drop hits). */}
      {dropping && (
        <div
          className={`pointer-events-none absolute z-30 ${ZONE_CLASS[zone!]} flex items-center justify-center rounded-lg border-2 border-sky-400 bg-sky-500/25`}
        >
          <span className="rounded bg-sky-950/95 px-2 py-0.5 text-[11px] font-bold text-sky-200">
            {ZONE_TEXT[zone!]}
          </span>
        </div>
      )}
    </div>
  );
};

export const CockpitView: React.FC<Props> = ({
  tab,
  isEditing,
  renderWidget,
  titleOf,
  headerRef,
  onEditCustomWidget,
}) => {
  const unplace = useDashboardStore((s) => s.unplaceFromCockpit);
  const unpin = useDashboardStore((s) => s.unpinInCockpit);
  /** The pane being dragged (Edit mode), by instance ID. */
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = new Map(tab.widgets.map((w) => [w.instanceId, w]));
  const customWidgets = useDashboardStore((s) => s.profile.customWidgets);
  // A custom widget's minimum comes from its definition (a composite's panels), others' from their type.
  const minFor = (id: string) => {
    const widgetId = byId.get(id)?.widgetId ?? '';
    return widgetMinSize(
      widgetId,
      customWidgets.find((c) => c.id === widgetId)
    );
  };
  const layout = tab.cockpit!;
  const header = layout.header ? byId.get(layout.header) : undefined;
  // Deleting the pinned bar, as a pane's Delete: confirmed first, and the prompt says when it leaves both layouts.
  const removeWidget = useDashboardStore((s) => s.removeWidgetFromActiveTab);
  const [confirmHeaderDelete, setConfirmHeaderDelete] = useState(false);
  useEffect(() => setConfirmHeaderDelete(false), [header?.instanceId, isEditing]);
  const headerInOther = useDashboardStore((s) => (header ? shownInOthers(s, tab.id, header.instanceId) : 0));

  const pane = (id: string) => {
    const placed = byId.get(id);
    if (!placed) return null;
    return (
      // The frame holds the edit lock (it mustn't scroll away with a tall widget, uncovering live controls); the
      // widget scrolls inside it.
      // Keyed by widget: a pane showing another widget (Change) starts afresh (error state, open prompts).
      <div key={id} className="relative h-full w-full overflow-hidden rounded-xl">
        <div className="h-full w-full overflow-auto @container">
          <PaneContext.Provider value={true}>
            <ErrorBoundary fallbackTitle={titleOf(placed.widgetId)}>{renderWidget(placed)}</ErrorBoundary>
          </PaneContext.Provider>
        </div>
        {isEditing && (
          <PaneEditOverlay
            tab={tab}
            placed={placed}
            title={titleOf(placed.widgetId)}
            titleOf={titleOf}
            min={minFor(id)}
            dragging={dragging}
            setDragging={setDragging}
            onEditCustomWidget={onEditCustomWidget}
          />
        )}
      </div>
    );
  };

  const renderNode = (n: CockpitNode, path: number[]): React.ReactNode =>
    isPane(n) ? (
      pane(n.pane)
    ) : (
      <SplitView
        key={shapeKey(n)}
        tab={tab}
        node={n}
        path={path}
        isEditing={isEditing}
        minFor={minFor}
        renderChild={renderNode}
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {header && (
        <div ref={headerRef} className="relative z-30 shrink-0">
          <HeaderSlotContext.Provider value={true}>
            <ErrorBoundary fallbackTitle={titleOf(header.widgetId)}>{renderWidget(header)}</ErrorBoundary>
          </HeaderSlotContext.Provider>
          {isEditing && (
            <div className="ring-dashed absolute inset-0 z-20 flex select-none items-start justify-between gap-2 rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-sky-500/50">
              <span className="flex items-center gap-1.5 rounded bg-zinc-900/95 px-2 py-0.5 text-[11px] font-bold text-sky-300">
                <Lock className="h-3 w-3 text-amber-400" />
                {titleOf(header.widgetId)} · pinned above the panes
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => unpin(tab.id)}
                  className="flex items-center gap-1 rounded bg-zinc-900/95 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:text-white"
                  title="Make it a pane (across the bottom), to move and resize like the others"
                >
                  <PinOff className="h-3 w-3" />
                  Unpin
                </button>
                <button
                  type="button"
                  onClick={() => unplace(tab.id, header.instanceId)}
                  className="flex items-center gap-1 rounded bg-zinc-900/95 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:text-white"
                  title="Take this widget out of the layout (it stays on the tab)"
                >
                  <EyeOff className="h-3 w-3" />
                  Hide
                </button>
                {confirmHeaderDelete ? (
                  <span className="flex items-center gap-1 rounded border border-red-500/40 bg-red-950/90 px-1 py-0.5 text-[11px] text-red-200">
                    <button
                      type="button"
                      onClick={() => removeWidget(header.instanceId)}
                      className="rounded bg-red-600 px-1.5 font-bold text-white"
                      title={
                        headerInOther
                          ? `Delete ${titleOf(header.widgetId)} from the tab: it leaves ${layoutsText(headerInOther)}`
                          : `Delete ${titleOf(header.widgetId)} from the tab`
                      }
                    >
                      {headerInOther ? `Delete (${layoutsText(headerInOther)})` : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmHeaderDelete(false)}
                      className="rounded bg-zinc-800 px-1.5"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmHeaderDelete(true)}
                    className="flex items-center gap-1 rounded bg-zinc-900/95 px-1.5 py-0.5 text-[11px] text-red-400 hover:text-red-300"
                    title="Delete it from the tab"
                    aria-label={`Delete ${titleOf(header.widgetId)}`}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </button>
                )}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {dragging && isEditing && layout.root && !isPane(layout.root) && (
          <EdgeTargets tabId={tab.id} dragging={dragging} onDone={() => setDragging(null)} />
        )}
        {layout.root ? (
          renderNode(layout.root, [])
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border-2 border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500">
            No panes below the pinned bar. In Edit mode, pick a preset, Show a widget listed above, or Add Widget.
          </div>
        )}
      </div>
    </div>
  );
};
