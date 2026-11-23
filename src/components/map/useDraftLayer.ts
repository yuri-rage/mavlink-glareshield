// Draws the mission draft on the map while planning and handles editing it there:
// - numbered amber pins and the route, above the vehicle's mission; clicking a pin selects it;
// - the selected pin (never home) can be dragged; the route follows live and the move is committed on release,
//   as one undo step. Only the selected pin drags, so a finger panning the map from a pin can't move it;
// - a "+" handle in the middle of each leg inserts a waypoint there (shown when the leg is long enough to tap);
// - with the Add tool, a map click adds a waypoint after the selected item; with Select, it clears the selection.
// Every edit goes through the draft model (missionDraft.ts), so home and DO_JUMP targets are kept.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { cmdHasLocation } from '../../mavlink/messages';
import { insertWaypointAfter, insertWaypointBefore, setItemPosition, type MissionDraft } from '../../mavlink/missionDraft';
import { useMissionPlanStore } from '../../store/missionPlanStore';

const DRAFT_LINES_PANE = 'draftLinesPane';
const DRAFT_MARKERS_PANE = 'draftMarkersPane';
/** Legs shorter than this on screen get no "+" handle: it would sit on top of the pins. */
const MIN_HANDLE_LEG_PX = 56;

function pinIcon(label: string, selected: boolean, isHome: boolean): L.DivIcon {
  const fill = selected ? '#0ea5e9' : isHome ? '#b45309' : '#f59e0b';
  const text = selected ? '#075985' : '#92400e';
  const scale = selected ? 1.2 : 1;
  const w = Math.round(26 * scale);
  const h = Math.round(36 * scale);
  return L.divIcon({
    className: `wp-marker${selected && !isHome ? ' gs-draft-draggable' : ''}`,
    html: `
      <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.85)); width: ${w}px; height: ${h}px;">
        <svg width="${w}" height="${h}" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="${fill}" stroke="#ffffff" stroke-width="${selected ? 2 : 1.5}" stroke-linejoin="round"/>
          <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
          <text x="13" y="15" font-size="${label.length > 2 ? '8.5' : '10.5'}" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="${text}">${label}</text>
        </svg>
      </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h - 1],
  });
}

const handleIcon = L.divIcon({
  className: 'gs-draft-handle',
  html: `<div style="width:20px;height:20px;border-radius:9999px;background:rgba(9,9,11,0.85);border:1.5px solid #f59e0b;color:#fcd34d;font:700 14px/17px ui-monospace,monospace;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.7)">+</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

/** True for a position worth drawing: a location command with a real position. */
export function drawablePosition(command: number, lat: number, lon: number): boolean {
  return cmdHasLocation(command) && (lat !== 0 || lon !== 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** Apply an edit that also picks the item to select; a refused edit leaves the draft alone. */
function commit(make: (d: MissionDraft) => { draft: MissionDraft; index: number }) {
  const st = useMissionPlanStore.getState();
  try {
    const r = make(st.history.present);
    st.edit(() => r.draft, r.index);
  } catch (err) {
    console.warn('[planning] edit refused:', err);
  }
}

/** `ready` must become true once the map exists. */
export function useDraftLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  const active = useMissionPlanStore((s) => s.active);
  const draft = useMissionPlanStore((s) => s.history.present);
  const selected = useMissionPlanStore((s) => s.selected);
  const layersRef = useRef<L.Layer[]>([]);
  const handlesRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getPane(DRAFT_LINES_PANE)) {
      map.createPane(DRAFT_LINES_PANE).style.zIndex = '590';
      map.createPane(DRAFT_MARKERS_PANE).style.zIndex = '650';
    }
  }, [mapRef, ready]);

  // Pins, route and leg handles.
  useEffect(() => {
    const clearHandles = () => {
      handlesRef.current.forEach((h) => h.remove());
      handlesRef.current = [];
    };
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];
    clearHandles();
    const map = mapRef.current;
    if (!map || !ready || !active) return;

    /** Drawable items in mission order: the route's vertices. */
    const route = draft.items
      .map((it, index) => ({ index, lat: it.x, lon: it.y, command: it.command }))
      .filter((r) => drawablePosition(r.command, r.lat, r.lon));
    const latLngs = route.map((r) => [r.lat, r.lon] as [number, number]);

    const line =
      route.length > 1
        ? L.polyline(latLngs, { pane: DRAFT_LINES_PANE, color: '#f59e0b', weight: 3, opacity: 0.95, interactive: false }).addTo(map)
        : null;
    if (line) layersRef.current.push(line);

    const drawHandles = () => {
      clearHandles();
      for (let k = 1; k < route.length; k++) {
        const a = route[k - 1];
        const b = route[k];
        if (a.index === 0) continue; // never insert before the first item from the home leg
        const pa = map.latLngToContainerPoint([a.lat, a.lon]);
        const pb = map.latLngToContainerPoint([b.lat, b.lon]);
        if (pa.distanceTo(pb) < MIN_HANDLE_LEG_PX) continue;
        const mid = map.containerPointToLatLng(pa.add(pb).divideBy(2));
        const h = L.marker(mid, { icon: handleIcon, pane: DRAFT_MARKERS_PANE, zIndexOffset: 50, keyboard: false, title: `Insert a waypoint before #${b.index}` })
          .on('click', () => commit((d) => insertWaypointBefore(d, b.index, mid.lat, mid.lng)))
          .addTo(map);
        handlesRef.current.push(h);
      }
    };

    route.forEach((r, k) => {
      const isHome = r.index === 0;
      const isSel = selected === r.index;
      const draggable = isSel && !isHome;
      const marker = L.marker([r.lat, r.lon], {
        icon: pinIcon(isHome ? 'H' : String(r.index), isSel, isHome),
        pane: DRAFT_MARKERS_PANE,
        zIndexOffset: isSel ? 1000 : isHome ? 200 : 100,
        keyboard: false,
        draggable,
        autoPan: draggable,
        title: draggable ? `#${r.index}: drag to move` : isHome ? 'Home' : `#${r.index}`,
      }).on('click', () => {
        if (!isHome) useMissionPlanStore.getState().select(r.index);
      });
      if (draggable) {
        marker.on('dragstart', clearHandles);
        marker.on('drag', () => {
          const p = marker.getLatLng();
          latLngs[k] = [p.lat, p.lng];
          line?.setLatLngs(latLngs);
        });
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          commit((d) => ({ draft: setItemPosition(d, r.index, p.lat, p.lng), index: r.index }));
        });
      }
      marker.addTo(map);
      layersRef.current.push(marker);
    });

    drawHandles();
    map.on('zoomend', drawHandles);
    return () => {
      map.off('zoomend', drawHandles);
    };
  }, [mapRef, ready, active, draft, selected]);

  // Map clicks while planning: add with the Add tool, otherwise clear the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const st = useMissionPlanStore.getState();
      if (st.tool === 'add') commit((d) => insertWaypointAfter(d, st.selected, e.latlng.lat, e.latlng.lng));
      else st.select(null);
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [mapRef, ready, active]);

  useEffect(
    () => () => {
      layersRef.current.forEach((l) => l.remove());
      layersRef.current = [];
      handlesRef.current.forEach((h) => h.remove());
      handlesRef.current = [];
    },
    []
  );
}
