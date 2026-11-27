// Rebinding a tile: picking the value a custom widget's tile shows (in a composite, one panel; or a single-value
// widget) without opening the full widget editor. From a right-click on the tile (TileContextMenu), or a click on it
// in Edit Mode (through the panes' edit overlays). The change is to the widget's definition, so it shows wherever
// the widget is placed.

import { create } from 'zustand';

import type { CustomWidgetDefinition, WidgetDataBinding, WidgetPanelDefinition } from '../types/widget';

/** A tile: the widget, and the panel in a composite (null for a single-value widget itself). */
export interface TileRef {
  widgetId: string;
  panelIndex: number | null;
}

/** Panel types that show one value from a binding, which a rebind can change. */
const ONE_VALUE_TYPES = new Set([
  'stat-card',
  'gauge-radial',
  'gauge-linear',
  'indicator-led',
  'sparkline',
  'compass-rose',
]);

/** Whether a panel (or a single widget) shows exactly one value: a binding, and no further values. */
export function isRebindable(
  p: Pick<WidgetPanelDefinition, 'displayType' | 'binding' | 'bindings'> | undefined
): boolean {
  return !!p && ONE_VALUE_TYPES.has(p.displayType) && !!p.binding && !(p.bindings && p.bindings.length > 0);
}

/** The tile's binding and title, or null when it isn't rebindable. */
export function tileValue(
  def: CustomWidgetDefinition | undefined,
  panelIndex: number | null
): { binding: WidgetDataBinding; title: string; displayType: string } | null {
  if (!def) return null;
  if (panelIndex === null) {
    if (def.displayType === 'composite' || !isRebindable(def as WidgetPanelDefinition)) return null;
    return { binding: def.binding!, title: def.name, displayType: def.displayType };
  }
  const p = def.panels?.[panelIndex];
  if (!isRebindable(p)) return null;
  return { binding: p!.binding!, title: p!.title ?? '', displayType: p!.displayType };
}

/** The widget with the tile showing `binding` (and titled `title`); the rest as it was. */
export function rebindTile(
  def: CustomWidgetDefinition,
  panelIndex: number | null,
  binding: WidgetDataBinding,
  title: string
): CustomWidgetDefinition {
  if (panelIndex === null) return { ...def, binding, name: title.trim() || def.name };
  const panels = (def.panels ?? []).map((p, i) =>
    i === panelIndex ? { ...p, binding, title: title.trim() || undefined } : p
  );
  return { ...def, panels };
}

/** The tile at a point on the screen (under an edit overlay too), from its data-rebind-* attributes. */
export function tileAt(x: number, y: number): TileRef | null {
  if (typeof document === 'undefined' || !document.elementsFromPoint) return null;
  for (const el of document.elementsFromPoint(x, y)) {
    const tile = (el as HTMLElement).closest?.('[data-rebind-widget]') as HTMLElement | null;
    if (tile) {
      const idx = tile.dataset.rebindPanel;
      return { widgetId: tile.dataset.rebindWidget!, panelIndex: idx === undefined || idx === '' ? null : Number(idx) };
    }
  }
  return null;
}

interface RebindState {
  /** The tile whose value is being changed (the dialog is open). */
  editing: TileRef | null;
  /** The right-click menu: where, and for which tile. */
  menu: { x: number; y: number; tile: TileRef } | null;
  /** Opens the full widget editor (registered by the app). */
  openEditor: ((widgetId: string) => void) | null;
}
export const useRebindStore = create<RebindState>(() => ({ editing: null, menu: null, openEditor: null }));

export const openRebind = (tile: TileRef) => useRebindStore.setState({ editing: tile, menu: null });
export const closeRebind = () => useRebindStore.setState({ editing: null });
export const openTileMenu = (x: number, y: number, tile: TileRef) => useRebindStore.setState({ menu: { x, y, tile } });
export const closeTileMenu = () => useRebindStore.setState({ menu: null });

/**
 * For an Edit Mode overlay (which covers the widget so it can be dragged): a click on a value tile under it opens the
 * dialog, a right-click the menu, and the pointer shows over one.
 */
export const tileEditHandlers = {
  onClick: (e: { clientX: number; clientY: number }) => {
    const t = tileAt(e.clientX, e.clientY);
    if (t) openRebind(t);
  },
  onContextMenu: (e: { clientX: number; clientY: number; preventDefault: () => void }) => {
    const t = tileAt(e.clientX, e.clientY);
    if (!t) return;
    e.preventDefault();
    openTileMenu(e.clientX, e.clientY, t);
  },
  onMouseMove: (e: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    (e.currentTarget as HTMLElement).style.cursor = tileAt(e.clientX, e.clientY) ? 'pointer' : '';
  },
};
