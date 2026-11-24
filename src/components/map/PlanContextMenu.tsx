// Right-click (long-press on touch) menu while planning, on the active layer: on a mission pin (which also selects
// it, opening it in the panel), insert a waypoint before it or delete it; on a rally flag, delete it; on the map,
// place a waypoint or rally point there. On the fence layer: on a shape, switch it between inclusion and exclusion
// or delete it; on a vertex, delete it; on the return point, remove it; on the map, place the return point or a
// square there. Closes on Escape, an outside click, and any change to either draft, so it
// can't act on a renumbered item.

import React, { useEffect, useRef } from 'react';
import { MapPinPlus, Plus, Repeat, Square, Trash2 } from 'lucide-react';
import {
  insertWaypointAfter,
  insertWaypointBefore,
  isRoutePoint,
  jumpsTargeting,
  removeItems,
  type MissionDraft,
} from '../../mavlink/missionDraft';
import { missionCommandInfo } from '../../mavlink/missionCommands';
import { useMissionPlanStore, type PlanLayer } from '../../store/missionPlanStore';
import { addRallyPoint, removeRallyPoint, type RallyDraft } from '../../mavlink/rallyDraft';
import { drawablePosition } from './useDraftLayer';
import { addShape, removeShape, removeVertex, setInclusion, setReturnPoint, squareAt } from '../../mavlink/fenceDraft';
import { commitFence } from './fenceCommit';

export type PlanMenuTarget =
  | { kind: 'item'; layer: PlanLayer; index: number; x: number; y: number }
  | { kind: 'map'; layer: PlanLayer; lat: number; lon: number; x: number; y: number }
  | { kind: 'fence-shape'; shape: number; x: number; y: number }
  | { kind: 'fence-vertex'; shape: number; vertex: number; x: number; y: number }
  | { kind: 'fence-return'; x: number; y: number };

/** Side of the square the fence menu places, in metres. */
const FENCE_SQUARE_M = 100;

/** Apply a rally edit that also picks the point to select. */
function commitRally(make: (d: RallyDraft) => { draft: RallyDraft; index: number | null }) {
  const st = useMissionPlanStore.getState();
  try {
    const r = make(st.rally.history.present);
    st.rallyEdit(() => r.draft, r.index);
  } catch (err) {
    console.warn('[planning] rally edit refused:', err);
  }
}

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
  const rally = useMissionPlanStore((s) => s.rally.history.present);
  const fence = useMissionPlanStore((s) => s.fence.history.present);
  const ref = useRef<HTMLDivElement | null>(null);
  // An item menu whose item is gone (or is home) has nothing to show: close it rather than leave an invisible menu
  // that still swallows the next click.
  const fenceShape = target.kind === 'fence-shape' || target.kind === 'fence-vertex' ? fence.shapes[target.shape] : undefined;
  const missing =
    (target.kind === 'item' &&
      (target.layer === 'rally' ? !rally.points[target.index] : target.index < 1 || !draft.items[target.index])) ||
    ((target.kind === 'fence-shape' || target.kind === 'fence-vertex') && !fenceShape) ||
    (target.kind === 'fence-vertex' && (fenceShape?.kind !== 'polygon' || !fenceShape.vertices[target.vertex])) ||
    (target.kind === 'fence-return' && !fence.returnPoint);
  useEffect(() => {
    if (missing) onClose();
  }, [missing, onClose]);

  // Any change to the draft (undo, an edit elsewhere) closes the menu: its item number may no longer be right.
  const opened = useRef({ draft, rally, fence });
  useEffect(() => {
    if (draft !== opened.current.draft || rally !== opened.current.rally || fence !== opened.current.fence) onClose();
  }, [draft, rally, fence, onClose]);

  // A click outside closes the menu and goes no further: with the Place tool on, the click that dismisses the menu
  // must not also drop a waypoint. The one exception is the click that ends the long-press that opened the menu
  // (touch): its press began before the menu existed, so it is swallowed and the menu stays. Any click whose press
  // starts after the menu opened closes it, however quickly.
  useEffect(() => {
    if (missing) return;
    let pressedSinceOpen = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = () => {
      pressedSinceOpen = true;
    };
    const onClick = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();
      if (pressedSinceOpen) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
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
  const shapeName = (i: number) => {
    const sh = fence.shapes[i];
    return `F${i + 1} ${sh.inclusion ? 'inclusion' : 'exclusion'} ${sh.kind}`;
  };
  const DELETE = `${ITEM} text-red-300 hover:bg-red-950/60`;
  if (missing) return null;
  if (target.kind === 'fence-shape') {
    const i = target.shape;
    const sh = fence.shapes[i];
    body = (
      <>
        <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-bold text-red-300">{shapeName(i)}</div>
        <button type="button" className={ITEM} onClick={run(() => commitFence((d) => ({ draft: setInclusion(d, i, !sh.inclusion), index: i })))}>
          <Repeat className="h-3.5 w-3.5 text-red-400" />
          Make {sh.inclusion ? 'exclusion' : 'inclusion'}
        </button>
        <button
          type="button"
          className={DELETE}
          onClick={run(() => commitFence((d) => ({ draft: removeShape(d, i), index: null })))}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete {sh.kind}
        </button>
      </>
    );
  } else if (target.kind === 'fence-vertex') {
    const { shape: i, vertex: k } = target;
    const count = fenceShape?.kind === 'polygon' ? fenceShape.vertices.length : 0;
    body = (
      <>
        <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-bold text-red-300">
          {shapeName(i)}, vertex {k + 1}
        </div>
        <button
          type="button"
          className={`${DELETE} disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={count <= 3}
          title={count <= 3 ? 'A polygon needs at least 3 vertices: delete the polygon instead' : undefined}
          onClick={run(() => commitFence((d) => ({ draft: removeVertex(d, i, k), index: i })))}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete vertex
        </button>
        <button type="button" className={DELETE} onClick={run(() => commitFence((d) => ({ draft: removeShape(d, i), index: null })))}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete polygon
        </button>
      </>
    );
  } else if (target.kind === 'fence-return') {
    body = (
      <button type="button" className={DELETE} onClick={run(() => commitFence((d) => ({ draft: setReturnPoint(d, null), index: null })))}>
        <Trash2 className="h-3.5 w-3.5" />
        Remove return point
      </button>
    );
  } else if (target.kind === 'map' && target.layer === 'fence') {
    const at = { lat: target.lat, lon: target.lon };
    body = (
      <>
        <button type="button" className={ITEM} onClick={run(() => commitFence((d) => ({ draft: setReturnPoint(d, at), index: null })))}>
          <MapPinPlus className="h-3.5 w-3.5 text-red-400" />
          {fence.returnPoint ? 'Move return point here' : 'Place return point here'}
        </button>
        {[true, false].map((inclusion) => (
          <button
            key={String(inclusion)}
            type="button"
            className={ITEM}
            onClick={run(() => commitFence((d) => addShape(d, squareAt(at, FENCE_SQUARE_M, inclusion))))}
          >
            <Square className="h-3.5 w-3.5 text-red-400" />
            {inclusion ? 'Inclusion' : 'Exclusion'} square here
            <span className="ml-auto pl-2 text-[10px] text-zinc-500">{FENCE_SQUARE_M} m</span>
          </button>
        ))}
      </>
    );
  } else if (target.kind === 'map' && target.layer === 'rally') {
    const sel = useMissionPlanStore.getState().rally.selected;
    body = (
      <button
        type="button"
        className={ITEM}
        onClick={run(() => commitRally((d) => addRallyPoint(d, sel, target.lat, target.lon)))}
      >
        <MapPinPlus className="h-3.5 w-3.5 text-fuchsia-400" />
        Place rally point here
        <span className="ml-auto pl-2 text-[10px] text-zinc-500">after {sel !== null ? `R${sel + 1}` : 'last'}</span>
      </button>
    );
  } else if (target.kind === 'item' && target.layer === 'rally') {
    const i = target.index;
    body = (
      <>
        <div className="px-2 pb-1 pt-0.5 font-mono text-[10px] font-bold text-fuchsia-300">R{i + 1} rally point</div>
        <button
          type="button"
          className={`${ITEM} text-red-300 hover:bg-red-950/60`}
          onClick={run(() =>
            commitRally((d) => {
              const next = removeRallyPoint(d, i);
              return { draft: next, index: next.points.length > 0 ? Math.min(i, next.points.length - 1) : null };
            })
          )}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </>
    );
  } else if (target.kind === 'map') {
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
    if (!it) return null;
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
