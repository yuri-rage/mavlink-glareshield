// A Cockpit tab: the pinned header (the quick-actions bar, at its own height) above panes that fill the rest of the
// window, laid out by the tab's tree (lib/cockpitLayout.ts) with react-resizable-panels. Dividers move only in Edit
// mode (a stray drag in flight must not rearrange the instruments); in flight they're thin inert seams. Each pane is
// a size container (@container), so widgets lay out by the pane's width, and tells its widget to fill it (PaneContext).

import React, { Fragment, useEffect, useState } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { EyeOff, GripVertical, Lock, Trash2 } from 'lucide-react';
import type { CockpitNode, DashboardTab, PlacedWidget } from '../../types/widget';
import { isPane, minLayoutSize, panesInOrder, widgetMinSize, type DropZone, type Size } from '../../lib/cockpitLayout';
import { BUILTIN_PANELS } from '../../lib/builtinWidgets';
import { useDashboardStore } from '../../store/dashboardStore';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { HeaderSlotContext, PaneContext } from './paneContext';

interface Props {
  tab: DashboardTab;
  isEditing: boolean;
  renderWidget: (placed: PlacedWidget) => React.ReactNode;
  titleOf: (widgetId: string) => string;
  /** The header's element, measured by the dashboard (how much room the panes have). */
  headerRef?: React.Ref<HTMLDivElement>;
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

/** Which part of a pane a pointer is over: an edge (within a quarter of the way in) or the centre. */
function zoneAt(rect: DOMRect, x: number, y: number): DropZone {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
  if (edge > 0.25) return 'center';
  if (edge === fx) return 'left';
  if (edge === 1 - fx) return 'right';
  return edge === fy ? 'top' : 'bottom';
}

const ZONE_CLASS: Record<DropZone, string> = {
  left: 'inset-y-0 left-0 w-1/2',
  right: 'inset-y-0 right-0 w-1/2',
  top: 'inset-x-0 top-0 h-1/2',
  bottom: 'inset-x-0 bottom-0 h-1/2',
  center: 'inset-3',
};
const ZONE_TEXT: Record<DropZone, string> = { left: 'Put it on the left', right: 'Put it on the right', top: 'Put it above', bottom: 'Put it below', center: 'Swap places' };

interface OverlayProps {
  tab: DashboardTab;
  placed: PlacedWidget;
  title: string;
  titleOf: (widgetId: string) => string;
  min: Size;
  dragging: string | null;
  setDragging: (id: string | null) => void;
}

/**
 * A pane in Edit mode: its widget locked (as in Flow tabs), with a bar to arrange it: drag it onto another pane (an
 * edge puts it there, the centre swaps them), add a widget beside or below it, change what it shows, swap it with
 * another, hide it (it stays on the tab) or delete it from the tab. The menus do everything the drag does, for the
 * keyboard.
 */
export const PaneEditOverlay: React.FC<OverlayProps> = ({ tab, placed, title, titleOf, min, dragging, setDragging }) => {
  const id = placed.instanceId;
  const customWidgets = useDashboardStore((s) => s.profile.customWidgets);
  const { unplaceFromCockpit, splitInCockpit, replaceInCockpit, moveInCockpit, removeWidgetFromActiveTab } = useDashboardStore.getState();
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
  // Option values: "w:<widgetId>" a new widget of that type, "i:<instanceId>" a hidden one of this tab's.
  const sourceOptions = (
    <>
      {hidden.length > 0 && (
        <optgroup label="Hidden on this tab">
          {hidden.map((w) => (
            <option key={w.instanceId} value={`i:${w.instanceId}`}>
              {titleOf(w.widgetId)}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="New widget">
        {catalog.map((c) => (
          <option key={c.id} value={`w:${c.id}`}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </>
  );
  const source = (v: string) => (v.startsWith('i:') ? { instanceId: v.slice(2) } : { widgetId: v.slice(2) });
  const selectClass = 'h-6 max-w-[6.5rem] rounded border border-zinc-700 bg-zinc-950 px-1 text-[10px] font-semibold text-zinc-300';

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col rounded-xl bg-zinc-950/55 ring-1 ring-dashed ring-sky-500/50 select-none"
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
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-zinc-700/70 bg-zinc-900/95 px-1.5 py-1 text-[11px]">
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(PANE_DRAG_TYPE, id);
            setDragging(id);
          }}
          onDragEnd={() => setDragging(null)}
          className="flex min-w-0 cursor-grab items-center gap-1 font-bold text-sky-300 active:cursor-grabbing"
          title="Drag onto another pane: an edge puts it there, the centre swaps them"
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <Lock className="h-3 w-3 shrink-0 text-amber-400" />
          <span className="truncate">{title}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1">
          <select
            value=""
            className={selectClass}
            aria-label={`Add a widget beside or below ${title}`}
            title="Add a widget beside or below this one"
            onChange={(e) => {
              const [side, v] = [e.target.value.slice(0, e.target.value.indexOf('|')), e.target.value.slice(e.target.value.indexOf('|') + 1)];
              if (v) splitInCockpit(tab.id, id, side as 'right' | 'bottom', source(v));
            }}
          >
            <option value="">Add…</option>
            {(['right', 'bottom'] as const).map((side) => (
              <optgroup key={side} label={side === 'right' ? 'To its right:' : 'Below it:'}>
                {hidden.map((w) => (
                  <option key={w.instanceId} value={`${side}|i:${w.instanceId}`}>
                    {titleOf(w.widgetId)} (hidden)
                  </option>
                ))}
                {catalog.map((c) => (
                  <option key={c.id} value={`${side}|w:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            value=""
            className={selectClass}
            aria-label={`Change what ${title} shows`}
            title="Show another widget here (this one stays on the tab, hidden)"
            onChange={(e) => e.target.value && replaceInCockpit(tab.id, id, source(e.target.value))}
          >
            <option value="">Change…</option>
            {sourceOptions}
          </select>
          {others.length > 0 && (
            <select
              value=""
              className={selectClass}
              aria-label={`Swap ${title} with another pane`}
              title="Swap places with another pane"
              onChange={(e) => e.target.value && moveInCockpit(tab.id, id, e.target.value, 'center')}
            >
              <option value="">Swap…</option>
              {others.map((o) => (
                <option key={o} value={o}>
                  {nameOf(o)}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => unplaceFromCockpit(tab.id, id)}
            className="rounded p-1 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            title="Hide: take it out of the layout (it stays on the tab)"
            aria-label={`Hide ${title}`}
          >
            <EyeOff className="h-3 w-3" />
          </button>
          {confirmDelete ? (
            <span className="flex items-center gap-1 rounded border border-red-500/40 bg-red-950/90 px-1 text-[10px] text-red-200">
              Delete?
              <button type="button" onClick={() => removeWidgetFromActiveTab(id)} className="rounded bg-red-600 px-1 font-bold text-white">
                Yes
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="rounded bg-zinc-800 px-1">
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1 text-red-400 hover:bg-zinc-800 hover:text-red-300"
              title="Delete it from the tab"
              aria-label={`Delete ${title}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
      <div className="relative flex flex-1 items-center justify-center text-[10px] text-zinc-400">
        {dragging && dragging !== id ? 'Drop on an edge to put it there, in the middle to swap' : `Drag the dividers to resize · min ${min.w}×${min.h}`}
        {zone && dragging !== id && (
          <div className={`pointer-events-none absolute ${ZONE_CLASS[zone]} flex items-center justify-center rounded-lg border-2 border-sky-400 bg-sky-500/25`}>
            <span className="rounded bg-sky-950/95 px-2 py-0.5 text-[11px] font-bold text-sky-200">{ZONE_TEXT[zone]}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const CockpitView: React.FC<Props> = ({ tab, isEditing, renderWidget, titleOf, headerRef }) => {
  const unplace = useDashboardStore((s) => s.unplaceFromCockpit);
  /** The pane being dragged (Edit mode), by instance ID. */
  const [dragging, setDragging] = useState<string | null>(null);
  const byId = new Map(tab.widgets.map((w) => [w.instanceId, w]));
  const minFor = (id: string) => widgetMinSize(byId.get(id)?.widgetId ?? '');
  const layout = tab.cockpit!;
  const header = layout.header ? byId.get(layout.header) : undefined;

  const pane = (id: string) => {
    const placed = byId.get(id);
    if (!placed) return null;
    return (
      // The frame holds the edit lock (it mustn't scroll away with a tall widget, uncovering live controls); the
      // widget scrolls inside it.
      <div className="relative h-full w-full overflow-hidden rounded-xl">
        <div className="@container h-full w-full overflow-auto">
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
          />
        )}
      </div>
    );
  };

  const renderNode = (n: CockpitNode, path: number[]): React.ReactNode =>
    isPane(n) ? (
      pane(n.pane)
    ) : (
      <SplitView key={shapeKey(n)} tab={tab} node={n} path={path} isEditing={isEditing} minFor={minFor} renderChild={renderNode} />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {header && (
        <div ref={headerRef} className="relative z-30 shrink-0">
          <HeaderSlotContext.Provider value={true}>
            <ErrorBoundary fallbackTitle={titleOf(header.widgetId)}>{renderWidget(header)}</ErrorBoundary>
          </HeaderSlotContext.Provider>
          {isEditing && (
            <div className="absolute inset-0 z-20 flex items-start justify-between gap-2 rounded-xl bg-zinc-950/55 p-1.5 ring-1 ring-dashed ring-sky-500/50 select-none">
              <span className="flex items-center gap-1.5 rounded bg-zinc-900/95 px-2 py-0.5 text-[11px] font-bold text-sky-300">
                <Lock className="h-3 w-3 text-amber-400" />
                {titleOf(header.widgetId)} · pinned above the panes
              </span>
              <button
                type="button"
                onClick={() => unplace(tab.id, header.instanceId)}
                className="flex items-center gap-1 rounded bg-zinc-900/95 px-1.5 py-0.5 text-[11px] text-zinc-300 hover:text-white"
                title="Take this widget out of the layout (it stays on the tab)"
              >
                <EyeOff className="h-3 w-3" />
                Hide
              </button>
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
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
