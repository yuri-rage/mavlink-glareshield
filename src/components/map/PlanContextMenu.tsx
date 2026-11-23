// Right-click (long-press on touch) menu while planning: on a draft pin (which also selects it, opening it in the
// panel), insert a waypoint before it or delete it; on the map, place a waypoint there. Closes on Escape, an outside
// click, and any change to the draft, so it can't act on a renumbered item.

import React, { useEffect, useRef } from 'react';
import { MapPinPlus, Plus, Trash2 } from 'lucide-react';
import {
  insertWaypointAfter,
  insertWaypointBefore,
  isRoutePoint,
  jumpsTargeting,
  removeItems,
  type MissionDraft,
} from '../../mavlink/missionDraft';
import { missionCommandInfo } from '../../mavlink/missionCommands';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { drawablePosition } from './useDraftLayer';

export type PlanMenuTarget =
  | { kind: 'item'; index: number; x: number; y: number }
  | { kind: 'map'; lat: number; lon: number; x: number; y: number };

interface PlanContextMenuProps {
  target: PlanMenuTarget;
  /** The map area's size, to keep the menu inside it. */
  area: { width: number; height: number };
  onClose: () => void;
}

/** The start of the leg leading to `index`: the nearest earlier route point, unless that is home. */
function previousRoutePoint(d: MissionDraft, index: number): { lat: number; lon: number } | null {
  for (let i = index - 1; i >= 0; i--) {
    const it = d.items[i];
    if ((i === 0 || isRoutePoint(it.command)) && drawablePosition(it.command, it.x, it.y)) {
      return i === 0 ? null : { lat: it.x, lon: it.y };
    }
  }
  return null;
}

/** Apply an edit that also picks the item to select; a refused edit leaves the draft alone. */
function commit(make: (d: MissionDraft) => { draft: MissionDraft; index: number | null }) {
  const st = useMissionPlanStore.getState();
  try {
    const r = make(st.history.present);
    st.edit(() => r.draft, r.index);
  } catch (err) {
    console.warn('[planning] edit refused:', err);
  }
}

const ITEM = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-zinc-200 hover:bg-zinc-800';

export const PlanContextMenu: React.FC<PlanContextMenuProps> = ({ target, area, onClose }) => {
  const draft = useMissionPlanStore((s) => s.history.present);
  const ref = useRef<HTMLDivElement | null>(null);
  // An item menu whose item is gone (or is home) has nothing to show: close it rather than leave an invisible menu
  // that still swallows the next click.
  const missing = target.kind === 'item' && (target.index < 1 || !draft.items[target.index]);
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  // Any change to the draft (undo, an edit elsewhere) closes the menu: its item number may no longer be right.
  const opened = useRef(draft);
  useEffect(() => {
    if (draft !== opened.current) onClose();
  }, [draft, onClose]);

  // A click outside closes the menu and goes no further: with the Place tool on, the click that dismisses the menu
  // must not also drop a waypoint. Clicks just after opening are the end of the long-press that opened it (touch):
  // swallowed, but the menu stays.
  useEffect(() => {
    if (missing) return;
    const openedAt = performance.now();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      if (performance.now() - openedAt > 500) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
    };
  }, [onClose, missing]);

  // Open toward the side with room, so the menu stays inside the map.
  const style: React.CSSProperties = {
    left: target.x,
    top: target.y,
    transform: `translate(${target.x > area.width - 216 ? '-100%' : '0'}, ${target.y > area.height - 150 ? '-100%' : '0'})`,
  };

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };

  let body: React.ReactNode;
  if (target.kind === 'map') {
    const selected = useMissionPlanStore.getState().selected;
    body = (
      <button
        type="button"
        className={ITEM}
        onClick={run(() => commit((d) => insertWaypointAfter(d, selected, target.lat, target.lon)))}
      >
        <MapPinPlus className="h-3.5 w-3.5 text-amber-400" />
        Place waypoint here
        <span className="ml-auto pl-2 text-[10px] text-zinc-500">after {selected !== null && selected >= 1 ? `#${selected}` : 'last'}</span>
      </button>
    );
  } else {
    const i = target.index;
    const it = draft.items[i];
    if (missing || !it) return null;
    const prev = previousRoutePoint(draft, i);
    // Only a route point ends a leg to insert on.
    const here = isRoutePoint(it.command) && drawablePosition(it.command, it.x, it.y) ? { lat: it.x, lon: it.y } : null;
    const jumps = jumpsTargeting(draft, i);
    body = (
      <>
        <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-bold text-amber-300">
          #{i} {missionCommandInfo(it.command).name}
        </div>
        {prev && here && (
          <button
            type="button"
            className={ITEM}
            onClick={run(() => commit((d) => insertWaypointBefore(d, i, (prev.lat + here.lat) / 2, (prev.lon + here.lon) / 2)))}
          >
            <Plus className="h-3.5 w-3.5 text-amber-400" />
            Insert waypoint before
          </button>
        )}
        <button
          type="button"
          className={`${ITEM} text-red-300 hover:bg-red-950/60`}
          onClick={run(() =>
            commit((d) => {
              const next = removeItems(d, [i]);
              return { draft: next, index: i < next.items.length ? i : next.items.length > 1 ? next.items.length - 1 : null };
            })
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        {jumps.length > 0 && (
          <div className="px-2 pb-1 text-[10px] leading-snug text-amber-300">
            Jump {jumps.map((j) => `#${j}`).join(', ')} targets this item; deleting moves it to the next item.
          </div>
        )}
      </>
    );
  }

  return (
    <div
      ref={ref}
      role="menu"
      style={style}
      className="absolute z-[470] w-52 rounded-lg border border-zinc-700 bg-zinc-900/95 p-1 shadow-xl backdrop-blur-sm"
      onContextMenu={(e) => e.preventDefault()}
    >
      {body}
    </div>
  );
};
