// A Cockpit tab: the pinned header (the quick-actions bar, at its own height) above panes that fill the rest of the
// window, laid out by the tab's tree (lib/cockpitLayout.ts) with react-resizable-panels. Dividers move only in Edit
// mode (a stray drag in flight must not rearrange the instruments); in flight they're thin inert seams. Each pane is
// a size container (@container), so widgets lay out by the pane's width, and tells its widget to fill it (PaneContext).

import React, { Fragment, useEffect } from 'react';
import { Group, Panel, Separator, useGroupRef } from 'react-resizable-panels';
import { EyeOff, Lock } from 'lucide-react';
import type { CockpitNode, DashboardTab, PlacedWidget } from '../../types/widget';
import { isPane, minLayoutSize, widgetMinSize, type Size } from '../../lib/cockpitLayout';
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

export const CockpitView: React.FC<Props> = ({ tab, isEditing, renderWidget, titleOf, headerRef }) => {
  const unplace = useDashboardStore((s) => s.unplaceFromCockpit);
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
          // Edit mode: the widget's controls are locked (as in Flow tabs), its name and size shown, and it can be
          // taken out of the layout (it stays on the tab, listed as not shown).
          <div className="absolute inset-0 z-20 flex flex-col rounded-xl bg-zinc-950/55 ring-1 ring-dashed ring-sky-500/50 select-none">
            <div className="flex items-center justify-between gap-2 border-b border-zinc-700/70 bg-zinc-900/95 px-2 py-1 text-[11px]">
              <span className="flex min-w-0 items-center gap-1.5 font-bold text-sky-300">
                <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                <span className="truncate">{titleOf(placed.widgetId)}</span>
              </span>
              <button
                type="button"
                onClick={() => unplace(tab.id, id)}
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 hover:text-white"
                title="Take this widget out of the layout (it stays on the tab)"
              >
                <EyeOff className="h-3 w-3" />
                Hide
              </button>
            </div>
            <div className="flex flex-1 items-center justify-center text-[10px] text-zinc-400">
              Drag the dividers to resize · min {minFor(id).w}×{minFor(id).h}
            </div>
          </div>
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
