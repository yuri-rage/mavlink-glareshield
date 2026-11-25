// Draws the fence draft on the map while planning and handles editing it there, on the fence layer:
// - inclusion polygons and circles in solid red, exclusion ones dashed with a darker fill; the selected shape in yellow;
//   clicking a shape selects it, right-clicking opens its menu;
// - the selected polygon shows a handle per vertex (drag to move, right-click for its menu), a "+" on each edge to
//   insert a vertex, and a centre handle that moves the whole polygon; a circle shows a centre handle and a radius
//   handle; each drag redraws live and is committed on release, as one undo step;
// - the return point is a marker (dragged when selected);
// - with the Place tool, a click draws what the panel chose: polygon vertices (finished with the first vertex, Enter
//   or the panel), a circle, or the return point.
// On another layer the fence is drawn dimmed and doesn't take clicks.

import { useEffect, useRef } from 'react';

import L from 'leaflet';

import {
  addShape,
  DEFAULT_CIRCLE_RADIUS,
  distanceM,
  insertVertex,
  moveShape,
  moveVertex,
  offsetPoint,
  polygonCenter,
  setRadius,
  setReturnPoint,
  type FenceShape,
  type LatLon,
} from '../../mavlink/fenceDraft';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { commitFence, finishFencePolygon } from './fenceCommit';
import type { PlanMenuTarget } from './PlanContextMenu';

const SHAPES_PANE = 'fenceDraftShapesPane';
const HANDLES_PANE = 'fenceDraftHandlesPane';
const RED = '#ef4444';
// Yellow, not blue: the vehicle's own inclusion zones are drawn blue.
const SELECTED = '#facc15';

const squareIcon = (selected: boolean) =>
  L.divIcon({
    className: 'gs-draft-draggable',
    html: `<div style="width:12px;height:12px;background:${selected ? SELECTED : '#fff'};border:2px solid ${RED};box-shadow:0 1px 3px rgba(0,0,0,0.7)"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
const plusIcon = L.divIcon({
  className: 'gs-draft-handle',
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:rgba(9,9,11,0.85);border:1.5px solid ${RED};color:#fca5a5;font:700 13px/15px ui-monospace,monospace;text-align:center">+</div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});
const centreIcon = L.divIcon({
  className: 'gs-draft-draggable',
  html: `<div title="Drag to move the shape" style="width:22px;height:22px;border-radius:9999px;background:rgba(9,9,11,0.85);border:2px solid ${SELECTED};color:${SELECTED};font:700 14px/18px ui-monospace,monospace;text-align:center">✥</div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});
const radiusIcon = L.divIcon({
  className: 'gs-draft-draggable',
  html: `<div title="Drag to change the radius" style="width:14px;height:14px;border-radius:9999px;background:${SELECTED};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.7)"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});
const returnIcon = (selected: boolean, dim: boolean) =>
  L.divIcon({
    className: selected ? 'gs-draft-draggable' : '',
    html: `<div style="opacity:${dim ? 0.45 : 1};width:24px;height:24px;border-radius:9999px;background:${selected ? SELECTED : RED};border:2px solid #fff;color:#fff;font:800 11px/20px ui-monospace,monospace;text-align:center;box-shadow:0 2px 5px rgba(0,0,0,0.8)">RP</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
const drawIcon = (first: boolean) =>
  L.divIcon({
    className: first ? 'gs-draft-handle' : '',
    html: `<div style="width:${first ? 14 : 10}px;height:${first ? 14 : 10}px;border-radius:9999px;background:${first ? '#fff' : RED};border:2px solid ${RED}"></div>`,
    iconSize: [first ? 14 : 10, first ? 14 : 10],
    iconAnchor: [first ? 7 : 5, first ? 7 : 5],
  });

const ll = (p: LatLon): [number, number] => [p.lat, p.lon];
const style = (shape: FenceShape, selected: boolean, editing: boolean): L.PathOptions => ({
  color: selected ? SELECTED : RED,
  weight: selected ? 3.5 : shape.inclusion ? 3 : 2.5,
  opacity: editing ? 0.95 : 0.45,
  dashArray: shape.inclusion ? undefined : '6 5',
  fillColor: RED,
  fillOpacity: (shape.inclusion ? 0.06 : 0.22) * (editing ? 1 : 0.5),
});

/** `ready` must become true once the map exists; `onMenu` opens the planning right-click menu. */
export function useFenceDraftLayer(
  mapRef: React.MutableRefObject<L.Map | null>,
  ready: boolean,
  onMenu?: (target: PlanMenuTarget) => void
) {
  const onMenuRef = useRef(onMenu);
  onMenuRef.current = onMenu;
  const active = useMissionPlanStore((s) => s.active);
  const layer = useMissionPlanStore((s) => s.layer);
  const tool = useMissionPlanStore((s) => s.tool);
  const draft = useMissionPlanStore((s) => s.fence.history.present);
  const selected = useMissionPlanStore((s) => s.fence.selected);
  const drawing = useMissionPlanStore((s) => s.fenceDrawing);
  const layersRef = useRef<L.Layer[]>([]);
  const drawRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getPane(SHAPES_PANE)) return;
    const shapes = map.createPane(SHAPES_PANE);
    shapes.style.zIndex = '585';
    // A dark halo around every line, so red reads on red soil, rock and roofs as well as on green: a filter on the
    // pane follows every drag (vertex, centre, radius) with no extra paths.
    shapes.style.filter = 'drop-shadow(0 0 1px rgba(0,0,0,0.95)) drop-shadow(0 0 2px rgba(0,0,0,0.6))';
    map.createPane(HANDLES_PANE).style.zIndex = '660';
  }, [mapRef, ready]);

  // Shapes, handles and the return point.
  useEffect(() => {
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const editing = layer === 'fence';
    // While placing, clicks go to the map (drawing over a shape), not to the shapes.
    const pickable = editing && tool === 'select';
    const add = (l: L.Layer) => {
      l.addTo(map);
      layersRef.current.push(l);
      return l;
    };
    const menu = (e: L.LeafletMouseEvent, target: (x: number, y: number) => PlanMenuTarget) => {
      L.DomEvent.preventDefault(e.originalEvent);
      if (useMissionPlanStore.getState().uploading) return;
      onMenuRef.current?.(target(e.containerPoint.x, e.containerPoint.y));
    };

    draft.shapes.forEach((shape, i) => {
      const isSel = editing && selected === i;
      const opts = {
        ...style(shape, isSel, editing),
        pane: SHAPES_PANE,
        interactive: pickable,
        bubblingMouseEvents: false,
      };
      const path =
        shape.kind === 'polygon'
          ? L.polygon(shape.vertices.map(ll), opts)
          : L.circle(ll(shape.center), { ...opts, radius: shape.radius });
      path
        .on('click', () => useMissionPlanStore.getState().fenceSelect(i))
        .on('contextmenu', (e: L.LeafletMouseEvent) => {
          useMissionPlanStore.getState().fenceSelect(i);
          menu(e, (x, y) => ({ kind: 'fence-shape', shape: i, x, y }));
        });
      add(path);
      if (!isSel || tool !== 'select') return;

      if (shape.kind === 'polygon') {
        const poly = path as L.Polygon;
        const vertices = shape.vertices;
        // Edge "+" handles: insert a vertex at the edge's midpoint.
        vertices.forEach((v, k) => {
          const n = vertices[(k + 1) % vertices.length];
          const mid = { lat: (v.lat + n.lat) / 2, lon: (v.lon + n.lon) / 2 };
          add(
            L.marker(ll(mid), { icon: plusIcon, pane: HANDLES_PANE, keyboard: false, title: 'Insert a vertex' }).on(
              'click',
              () => commitFence((d) => ({ draft: insertVertex(d, i, k, mid).draft, index: i }))
            )
          );
        });
        // Vertex handles: drag to move, right-click for the vertex menu.
        vertices.forEach((v, k) => {
          const m = L.marker(ll(v), {
            icon: squareIcon(false),
            pane: HANDLES_PANE,
            draggable: true,
            autoPan: true,
            keyboard: false,
            title: `Vertex ${k + 1}: drag to move`,
          });
          m.on('drag', () => {
            const p = m.getLatLng();
            poly.setLatLngs(vertices.map((x, j) => (j === k ? ([p.lat, p.lng] as L.LatLngTuple) : ll(x))));
          });
          m.on('dragend', () => {
            const p = m.getLatLng();
            if (p.lat === v.lat && p.lng === v.lon) return;
            commitFence((d) => ({ draft: moveVertex(d, i, k, { lat: p.lat, lon: p.lng }), index: i }));
          });
          m.on('contextmenu', (e: L.LeafletMouseEvent) =>
            menu(e, (x, y) => ({ kind: 'fence-vertex', shape: i, vertex: k, x, y }))
          );
          add(m);
        });
      }

      // Centre handle: drag to move the whole shape.
      const centre = shape.kind === 'polygon' ? polygonCenter(shape.vertices) : shape.center;
      const c = L.marker(ll(centre), {
        icon: centreIcon,
        pane: HANDLES_PANE,
        draggable: true,
        autoPan: true,
        keyboard: false,
        zIndexOffset: 500,
      });
      c.on('drag', () => {
        const p = c.getLatLng();
        const moved = moveShape(draft, i, { lat: p.lat, lon: p.lng }).shapes[i];
        if (moved.kind === 'polygon') (path as L.Polygon).setLatLngs(moved.vertices.map(ll));
        else (path as L.Circle).setLatLng(ll(moved.center));
      });
      c.on('dragend', () => {
        const p = c.getLatLng();
        if (p.lat === centre.lat && p.lng === centre.lon) return;
        commitFence((d) => ({ draft: moveShape(d, i, { lat: p.lat, lon: p.lng }), index: i }));
      });
      add(c);

      // Radius handle (circles): drag to set the radius.
      if (shape.kind === 'circle') {
        const r = L.marker(ll(offsetPoint(shape.center, shape.radius, 90)), {
          icon: radiusIcon,
          pane: HANDLES_PANE,
          draggable: true,
          autoPan: true,
          keyboard: false,
        });
        const radiusAt = () => {
          const p = r.getLatLng();
          return Math.max(1, distanceM(shape.center, { lat: p.lat, lon: p.lng }));
        };
        r.on('drag', () => (path as L.Circle).setRadius(radiusAt()));
        r.on('dragend', () => {
          const radius = Math.round(radiusAt() * 10) / 10;
          if (radius !== shape.radius) commitFence((d) => ({ draft: setRadius(d, i, radius), index: i }));
        });
        add(r);
      }
    });

    if (draft.returnPoint) {
      const rp = draft.returnPoint;
      const m = L.marker(ll(rp), {
        icon: returnIcon(false, !editing),
        pane: HANDLES_PANE,
        draggable: pickable,
        autoPan: pickable,
        interactive: pickable,
        keyboard: false,
        title: 'Fence return point: where a breach sends the vehicle',
      });
      m.on('dragend', () => {
        const p = m.getLatLng();
        if (p.lat === rp.lat && p.lng === rp.lon) return;
        commitFence((d) => ({ draft: setReturnPoint(d, { lat: p.lat, lon: p.lng }), index: null }));
      });
      m.on('contextmenu', (e: L.LeafletMouseEvent) => menu(e, (x, y) => ({ kind: 'fence-return', x, y })));
      add(m);
    }
  }, [mapRef, ready, active, layer, tool, draft, selected]);

  // The polygon being drawn: its vertices and edges so far; the first vertex finishes it once it has 3.
  useEffect(() => {
    drawRef.current.forEach((l) => l.remove());
    drawRef.current = [];
    const map = mapRef.current;
    if (!map || !ready || !active || layer !== 'fence' || !drawing || drawing.length === 0) return;
    const line = L.polyline(drawing.map(ll), {
      pane: SHAPES_PANE,
      color: RED,
      weight: 2,
      dashArray: '4 4',
      interactive: false,
    }).addTo(map);
    drawRef.current.push(line);
    drawing.forEach((v, k) => {
      const m = L.marker(ll(v), {
        icon: drawIcon(k === 0),
        pane: HANDLES_PANE,
        keyboard: false,
        interactive: k === 0,
        bubblingMouseEvents: false,
        title: k === 0 ? 'Click to finish the polygon' : '',
      } as L.MarkerOptions);
      if (k === 0) m.on('click', () => finishFencePolygon());
      m.addTo(map);
      drawRef.current.push(m);
    });
  }, [mapRef, ready, active, layer, drawing]);

  // Map clicks on the fence layer: Place draws, Select clears the selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !active) return;
    const onClick = (e: L.LeafletMouseEvent) => {
      const st = useMissionPlanStore.getState();
      if (st.layer !== 'fence') return;
      if (st.tool !== 'add') {
        st.fenceSelect(null);
        return;
      }
      const at = { lat: e.latlng.lat, lon: e.latlng.lng };
      switch (st.fenceDrawKind) {
        case 'polygon-inclusion':
        case 'polygon-exclusion':
          st.setFenceDrawing([...(st.fenceDrawing ?? []), at]);
          break;
        case 'circle-inclusion':
        case 'circle-exclusion':
          commitFence((d) =>
            addShape(d, {
              kind: 'circle',
              inclusion: st.fenceDrawKind === 'circle-inclusion',
              center: at,
              radius: DEFAULT_CIRCLE_RADIUS,
            })
          );
          break;
        case 'return-point':
          commitFence((d) => ({ draft: setReturnPoint(d, at), index: null }));
          break;
      }
    };
    map.on('click', onClick);
    return () => {
      map.off('click', onClick);
    };
  }, [mapRef, ready, active]);

  useEffect(
    () => () => {
      [...layersRef.current, ...drawRef.current].forEach((l) => l.remove());
      layersRef.current = [];
      drawRef.current = [];
    },
    []
  );
}
