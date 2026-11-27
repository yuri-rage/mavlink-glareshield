// Changing the value a tile shows (src/lib/tileRebind.ts): the right-click menu on a tile, and the dialog that picks
// the value (the custom widget editor's value picker, BindingEditor), with the tile's title. Mounted once (App).

import React, { useEffect, useRef, useState } from 'react';

import { Pencil, Repeat } from 'lucide-react';

import { closeRebind, closeTileMenu, openRebind, rebindTile, tileValue, useRebindStore } from '../../lib/tileRebind';
import { useDashboardStore } from '../../store/dashboardStore';
import type { WidgetDataBinding } from '../../types/widget';
import { Button } from '../ui/button';
import { MenuItem } from '../ui/HeaderMenu';
import { Input } from '../ui/input';
import { Modal } from '../ui/modal';
import { messageDefaults, useBindingCatalog } from './bindingCatalog';
import { BindingEditor } from './BindingEditor';

/**
 * A different message or field is a different value: what described the old one (its units, scaling, range,
 * thresholds, label) is cleared rather than carried over (a speed in %, with a battery's alarms), for the person to
 * set for the new one. The color stays.
 */
export function forNewValue(prev: WidgetDataBinding, next: WidgetDataBinding): WidgetDataBinding {
  if (prev.messageName === next.messageName && prev.fieldName === next.fieldName) return next;
  return {
    messageName: next.messageName,
    fieldName: next.fieldName,
    decimals: 1,
    ...(next.color ? { color: next.color } : {}),
  };
}

export const RebindDialog: React.FC = () => {
  const editing = useRebindStore((s) => s.editing);
  const openEditor = useRebindStore((s) => s.openEditor);
  const def = useDashboardStore((s) => s.profile.customWidgets.find((w) => w.id === editing?.widgetId));
  const tabsUsing = useDashboardStore(
    (s) => s.profile.tabs.filter((t) => t.widgets.some((w) => w.widgetId === editing?.widgetId)).length
  );
  const saveCustomWidget = useDashboardStore((s) => s.saveCustomWidget);
  const current = editing ? tileValue(def, editing.panelIndex) : null;
  const [binding, setBinding] = useState<WidgetDataBinding | null>(null);
  const [title, setTitle] = useState('');
  const { catalog, observed } = useBindingCatalog(editing !== null);

  // Each opening starts from the tile as it is.
  useEffect(() => {
    setBinding(current ? { ...current.binding } : null);
    setTitle(current?.title ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.widgetId, editing?.panelIndex]);

  if (!editing || !def || !current || !binding) return null;
  const type = current.displayType;
  const save = () => {
    saveCustomWidget(rebindTile(def, editing.panelIndex, binding, title));
    closeRebind();
  };

  return (
    <Modal
      isOpen
      onClose={closeRebind}
      title="Change value"
      description={`${def.name}${editing.panelIndex !== null ? `: ${current.title || `panel ${editing.panelIndex + 1}`}` : ''}`}
    >
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-zinc-300">
            {editing.panelIndex !== null ? 'Tile title' : 'Widget name'}
          </span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-xs" />
        </label>
        <BindingEditor
          value={binding}
          onChange={(next) => setBinding((prev) => (prev ? forNewValue(prev, next) : next))}
          catalog={catalog}
          observed={observed}
          showRange={type === 'gauge-radial' || type === 'gauge-linear'}
          showThresholds={type !== 'compass-rose'}
          showLabel={type === 'sparkline'}
          showColor={type === 'sparkline'}
          onMessagePicked={(msg) => setBinding((b) => (b ? { ...b, ...messageDefaults(msg) } : b))}
        />
        <p className="text-[11px] leading-snug text-zinc-500">
          Changes the widget &quot;{def.name}&quot; wherever it&apos;s placed
          {tabsUsing > 1 ? ` (on ${tabsUsing} tabs)` : ''}.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-800 pt-3">
          {openEditor ? (
            <button
              type="button"
              onClick={() => {
                closeRebind();
                openEditor(def.id);
              }}
              className="text-[11px] text-sky-300 hover:text-sky-200 hover:underline"
            >
              Open the full widget editor…
            </button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={closeRebind}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={save} className="bg-sky-500 text-white hover:bg-sky-600">
              Save
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
};

/** The right-click menu on a tile: change its value, or open the widget in the full editor. */
export const TileContextMenu: React.FC = () => {
  const menu = useRebindStore((s) => s.menu);
  const openEditor = useRebindStore((s) => s.openEditor);
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Kept on screen at the pointer; closed by Escape, a click elsewhere, scrolling or resizing.
  useEffect(() => {
    if (!menu) return setPos(null);
    const el = ref.current;
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 80;
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - w - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - h - 8)),
    });
    const close = (e: Event) => {
      if (e instanceof PointerEvent && ref.current?.contains(e.target as Node)) return;
      closeTileMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeTileMenu();
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      role="menu"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
      className="fixed z-[1200] w-52 rounded-lg border border-zinc-700 bg-zinc-900/95 p-1 font-sans shadow-xl backdrop-blur-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem
        icon={<Repeat className="h-3.5 w-3.5 text-sky-400" />}
        label="Change value…"
        onClick={() => openRebind(menu.tile)}
      />
      {openEditor && (
        <MenuItem
          icon={<Pencil className="h-3.5 w-3.5" />}
          label="Edit widget…"
          onClick={() => {
            closeTileMenu();
            openEditor(menu.tile.widgetId);
          }}
        />
      )}
    </div>
  );
};
