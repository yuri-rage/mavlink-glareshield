// Draws the mission draft on the map while planning: its route and numbered amber pins, the selected one
// highlighted. Clicking a pin selects the item. Drawn in its own panes, above the vehicle's mission.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { cmdHasLocation } from '../../mavlink/messages';
import { useMissionPlanStore } from '../../store/missionPlanStore';

const DRAFT_LINES_PANE = 'draftLinesPane';
const DRAFT_MARKERS_PANE = 'draftMarkersPane';

function pinIcon(label: string, selected: boolean, isHome: boolean): L.DivIcon {
  const fill = selected ? '#0ea5e9' : isHome ? '#b45309' : '#f59e0b';
  const text = selected ? '#075985' : '#92400e';
  const scale = selected ? 1.2 : 1;
  const w = Math.round(26 * scale);
  const h = Math.round(36 * scale);
  return L.divIcon({
    className: 'wp-marker',
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

/** True for a position worth drawing: a location command with a real position. */
export function drawablePosition(command: number, lat: number, lon: number): boolean {
  return cmdHasLocation(command) && (lat !== 0 || lon !== 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/** `ready` must become true once the map exists. */
export function useDraftLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  const active = useMissionPlanStore((s) => s.active);
  const draft = useMissionPlanStore((s) => s.history.present);
  const selected = useMissionPlanStore((s) => s.selected);
  const layersRef = useRef<L.Layer[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getPane(DRAFT_LINES_PANE)) {
      map.createPane(DRAFT_LINES_PANE).style.zIndex = '590';
      map.createPane(DRAFT_MARKERS_PANE).style.zIndex = '650';
    }
  }, [mapRef, ready]);

  useEffect(() => {
    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];
    const map = mapRef.current;
    if (!map || !ready || !active) return;

    const route: [number, number][] = [];
    draft.items.forEach((it, i) => {
      if (!drawablePosition(it.command, it.x, it.y)) return;
      route.push([it.x, it.y]);
      const isHome = i === 0;
      const marker = L.marker([it.x, it.y], {
        icon: pinIcon(isHome ? 'H' : String(i), selected === i, isHome),
        pane: DRAFT_MARKERS_PANE,
        zIndexOffset: selected === i ? 1000 : isHome ? 200 : 100,
        keyboard: false,
      })
        .on('click', () => useMissionPlanStore.getState().select(i))
        .addTo(map);
      layersRef.current.push(marker);
    });

    if (route.length > 1) {
      const line = L.polyline(route, {
        pane: DRAFT_LINES_PANE,
        color: '#f59e0b',
        weight: 3,
        opacity: 0.95,
        interactive: false,
      }).addTo(map);
      layersRef.current.push(line);
    }
  }, [mapRef, ready, active, draft, selected]);

  useEffect(
    () => () => {
      layersRef.current.forEach((l) => l.remove());
      layersRef.current = [];
    },
    []
  );
}
