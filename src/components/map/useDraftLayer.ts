// Draws the mission draft on the map while planning and handles editing it there:
// - numbered amber pins and the route, above the vehicle's mission; clicking a pin selects it;
// - the selected pin (never home) can be dragged; the route follows live and the move is committed on release,
//   as one undo step. Only the selected pin drags, so a finger panning the map from a pin can't move it;
// - around each waypoint, its radius as a thin dashed circle: yellow for the item's own radius, white for the
//   vehicle's default (waypointRadius.ts says which the vehicle flies);
// - a "+" handle in the middle of each leg inserts a waypoint there (shown when the leg is long enough to tap);
// - with the Place tool, a map click adds a waypoint after the selected item; with Select, it clears the selection.
// Every edit goes through the draft model (missionDraft.ts), so home and DO_JUMP targets are kept.

import { useEffect, useRef } from 'react';

import L from 'leaflet';

import { cmdHasLocation, getVehicleCategory } from '../../mavlink/messages';
import {
  insertWaypointAfter,
  insertWaypointBefore,
  setItemPosition,
  type MissionDraft,
} from '../../mavlink/missionDraft';
import {
  fliesSplines,
  joinLegs,
  legMidpoint,
  missionPathLegs,
  routeIndices,
  type PathItem,
} from '../../mavlink/missionPath';
import { addRallyPoint, moveRallyPoint, type RallyDraft } from '../../mavlink/rallyDraft';
import { planningVehicle, RADIUS_PARAMS, useLastVehicleStore } from '../../store/lastVehicleStore';
import { useMissionPlanStore, type PlanLayer } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { radiusCircle } from './radiusCircle';

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

/** A rally point flag: magenta (the vehicle's rally colour), "R1"…; the selected one blue and larger. */
function rallyIcon(label: string, selected: boolean, dim: boolean): L.DivIcon {
  const fill = selected ? '#0ea5e9' : '#d946ef';
  const scale = selected ? 1.2 : 1;
  const w = Math.round(28 * scale);
  const h = Math.round(34 * scale);
  return L.divIcon({
    className: `rally-marker${selected ? ' gs-draft-draggable' : ''}`,
    html: `
      <div style="opacity:${dim ? 0.45 : 1}; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.85)); width: ${w}px; height: ${h}px;">
        <svg width="${w}" height="${h}" viewBox="0 0 28 34" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="5" y1="2" x2="5" y2="33" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M 6 3 L 26 3 L 21 10 L 26 17 L 6 17 Z" fill="${fill}" stroke="#ffffff" stroke-width="${selected ? 2 : 1.4}" stroke-linejoin="round"/>
          <text x="15.5" y="13.6" font-size="${label.length > 2 ? '7.5' : '9'}" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="#ffffff">${label}</text>
        </svg>
      </div>`,
    iconSize: [w, h],
    iconAnchor: [Math.round(5 * scale), h - 1],
  });
}

/** Apply a rally edit that also picks the point to select; a refused edit leaves the draft alone. */
function commitRally(make: (d: RallyDraft) => { draft: RallyDraft; index: number }) {
  const st = useMissionPlanStore.getState();
  try {
    const r = make(st.rally.history.present);
    st.rallyEdit(() => r.draft, r.index);
  } catch (err) {
    console.warn('[planning] rally edit refused:', err);
  }
}

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

/**
 * `ready` must become true once the map exists. `onItemMenu` is called on right-click / long-press of a draft pin
 * (not home) on the active layer, with the layer, the item and where to open the menu in the map container.
 *
 * Both layers are drawn; only the active one (the panel's Mission | Rally switch) takes clicks, drags and the Place
 * tool. The other is dimmed and not clickable, so a click can never edit the layer you aren't looking at.
 */
export function useDraftLayer(
  mapRef: React.MutableRefObject<L.Map | null>,
  ready: boolean,
  onItemMenu?: (layer: PlanLayer, index: number, x: number, y: number) => void
) {
  const onItemMenuRef = useRef(onItemMenu);
  onItemMenuRef.current = onItemMenu;
  const active = useMissionPlanStore((s) => s.active);
  // Spline legs are drawn as the curve only for a vehicle that flies them (Copter); others skip spline waypoints.
  const splines = useTelemetryStore((s) => fliesSplines(getVehicleCategory(s.heartbeat.type)));
  // The vehicle the radii are drawn for: the connected one, else the last one connected (remembered in this
  // browser), so planning offline shows the same circles. Redrawn when either changes.
  const liveRadius = useTelemetryStore(
    (s) =>
      `${s.heartbeat.type}:${s.heartbeat.modeName === 'DISCONNECTED'}:${RADIUS_PARAMS.map((n) => s.parameters[n]?.value ?? '').join(',')}`
  );
  const lastVehicle = useLastVehicleStore();
  const layer = useMissionPlanStore((s) => s.layer);
  const draft = useMissionPlanStore((s) => s.history.present);
  const selected = useMissionPlanStore((s) => s.selected);
  const rally = useMissionPlanStore((s) => s.rally.history.present);
  const rallySelected = useMissionPlanStore((s) => s.rally.selected);
  const layersRef = useRef<L.Layer[]>([]);
  const handlesRef = useRef<L.Marker[]>([]);
  const rallyLayersRef = useRef<L.Layer[]>([]);

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
    const editing = layer === 'mission';

    /** Items with a position, in mission order: each gets a pin. */
    const points = draft.items
      .map((it, index) => ({ index, lat: it.x, lon: it.y, command: it.command }))
      .filter((r) => drawablePosition(r.command, r.lat, r.lon));
    /** The route as the vehicle flies it (missionPath): home first, then each navigation item with a position, an
     *  ROI or landing-start point getting a pin but no leg; spline legs curved when the vehicle flies splines. */
    const pathItems: PathItem[] = draft.items.map((it) => ({
      command: it.command,
      lat: it.x,
      lon: it.y,
      alt: it.z,
      frame: it.frame,
      param1: it.param1,
    }));
    const route = routeIndices(pathItems, splines);
    const legs = missionPathLegs(pathItems, route, splines);

    const line =
      legs.length > 0
        ? L.polyline(joinLegs(legs), {
            pane: DRAFT_LINES_PANE,
            color: '#f59e0b',
            weight: 3,
            opacity: editing ? 0.95 : 0.4,
            interactive: false,
          }).addTo(map)
        : null;
    if (line) layersRef.current.push(line);

    // Waypoint radii: thin dashed circles, under the pins; each follows its pin while dragged.
    const vehicle = planningVehicle();
    const circles = new Map<number, L.Circle>();
    draft.items.forEach((it, index) => {
      if (index === 0 || !drawablePosition(it.command, it.x, it.y)) return;
      const c = radiusCircle(it, it.x, it.y, vehicle, { pane: DRAFT_LINES_PANE, opacity: editing ? 0.9 : 0.35 });
      if (!c) return;
      c.addTo(map);
      circles.set(index, c);
      layersRef.current.push(c);
    });

    const drawHandles = () => {
      clearHandles();
      if (!editing) return;
      for (const leg of legs) {
        if (leg.from === 0) continue; // never insert before the first item from the home leg
        const a = pathItems[leg.from];
        const b = pathItems[leg.to];
        const pa = map.latLngToContainerPoint([a.lat, a.lon]);
        const pb = map.latLngToContainerPoint([b.lat, b.lon]);
        if (pa.distanceTo(pb) < MIN_HANDLE_LEG_PX) continue;
        // Halfway along the leg as drawn: on the curve for a spline leg.
        const [midLat, midLon] = legMidpoint(leg);
        const h = L.marker([midLat, midLon], {
          icon: handleIcon,
          pane: DRAFT_MARKERS_PANE,
          zIndexOffset: 50,
          keyboard: false,
          title: `Insert a waypoint before #${leg.to}`,
        })
          .on('click', () => commit((d) => insertWaypointBefore(d, leg.to, midLat, midLon)))
          .addTo(map);
        handlesRef.current.push(h);
      }
    };

    points.forEach((r) => {
      const isHome = r.index === 0;
      const isSel = editing && selected === r.index;
      const draggable = isSel && !isHome;
      const marker = L.marker([r.lat, r.lon], {
        icon: pinIcon(isHome ? 'H' : String(r.index), isSel, isHome),
        pane: DRAFT_MARKERS_PANE,
        zIndexOffset: isSel ? 1000 : isHome ? 200 : 100,
        keyboard: false,
        draggable,
        autoPan: draggable,
        opacity: editing ? 1 : 0.45,
        interactive: editing,
        title: draggable ? `#${r.index}: drag to move` : isHome ? 'Home' : `#${r.index}`,
      })
        .on('click', () => {
          if (!isHome) useMissionPlanStore.getState().select(r.index);
        })
        .on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(e.originalEvent);
          if (useMissionPlanStore.getState().uploading) return;
          // Home isn't selectable, but its menu adds a waypoint measured from it.
          if (!isHome) useMissionPlanStore.getState().select(r.index);
          onItemMenuRef.current?.('mission', r.index, e.containerPoint.x, e.containerPoint.y);
        });
      if (draggable) {
        marker.on('dragstart', clearHandles);
        marker.on('drag', () => {
          // Redraw the whole path: moving one waypoint reshapes the spline legs around it too.
          const p = marker.getLatLng();
          const moved = pathItems.slice();
          moved[r.index] = { ...moved[r.index], lat: p.lat, lon: p.lng };
          line?.setLatLngs(joinLegs(missionPathLegs(moved, route, splines)));
          circles.get(r.index)?.setLatLng(p);
        });
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          // Pressed and released without moving: nothing to record.
          if (p.lat === r.lat && p.lng === r.lon) {
            drawHandles();
            return;
          }
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
  }, [mapRef, ready, active, draft, selected, layer, splines, liveRadius, lastVehicle]);

  // Rally flags: the selected one (on the rally layer) can be dragged; clicking selects; right-click opens the menu.
  useEffect(() => {
    rallyLayersRef.current.forEach((l) => l.remove());
    rallyLayersRef.current = [];
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const editing = layer === 'rally';
    rally.points.forEach((p, i) => {
      if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) || (p.lat === 0 && p.lon === 0)) return;
      const isSel = editing && rallySelected === i;
      const marker = L.marker([p.lat, p.lon], {
        icon: rallyIcon(`R${i + 1}`, isSel, !editing),
        pane: DRAFT_MARKERS_PANE,
        zIndexOffset: isSel ? 1100 : editing ? 300 : 50,
        keyboard: false,
        draggable: isSel,
        autoPan: isSel,
        interactive: editing,
        title: isSel ? `R${i + 1}: drag to move` : `Rally point R${i + 1}`,
      })
        .on('click', () => useMissionPlanStore.getState().rallySelect(i))
        .on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.preventDefault(e.originalEvent);
          if (useMissionPlanStore.getState().uploading) return;
          useMissionPlanStore.getState().rallySelect(i);
          onItemMenuRef.current?.('rally', i, e.containerPoint.x, e.containerPoint.y);
        });
      if (isSel) {
        marker.on('dragend', () => {
          const q = marker.getLatLng();
          if (q.lat === p.lat && q.lng === p.lon) return; // pressed and released without moving
          commitRally((d) => ({ draft: moveRallyPoint(d, i, q.lat, q.lng), index: i }));
        });
      }
      marker.addTo(map);
      rallyLayersRef.current.push(marker);
    });
  }, [mapRef, ready, active, rally, rallySelected, layer]);

  // Map clicks while planning, on the active layer: add with the Place tool, otherwise clear the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const st = useMissionPlanStore.getState();
      // The fence layer handles its own clicks (useFenceDraftLayer); never let one add a waypoint.
      if (st.layer === 'fence') return;
      if (st.layer === 'rally') {
        if (st.tool === 'add') commitRally((d) => addRallyPoint(d, st.rally.selected, e.latlng.lat, e.latlng.lng));
        else st.rallySelect(null);
        return;
      }
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
      rallyLayersRef.current.forEach((l) => l.remove());
      rallyLayersRef.current = [];
    },
    []
  );
}
