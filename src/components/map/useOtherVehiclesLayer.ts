// The other vehicles on the link (vehicleRoster), on the map: a violet arrow along each one's heading, labelled with
// its system ID and mode, faded once its position is old. Click for a summary and a button to switch to it (the
// switch is confirmed when something is at stake). Drawn from a store subscription, without re-rendering the map.

import { useEffect, useRef } from 'react';

import L from 'leaflet';

import { escapeHtml } from '../../mavlink/adsb';
import { requestVehicleSwitch, useVehicleRosterStore, type RosterVehicle } from '../../mavlink/vehicleRoster';
import { useUnitsStore } from '../../store/unitsStore';
import { vehicleSummary } from '../navbar/VehiclePicker';

const PANE = 'otherVehiclesPane';
/** A position older than this is shown faded. */
const STALE_MS = 5000;

function icon(v: RosterVehicle, stale: boolean): L.DivIcon {
  const colour = v.armed ? '#c4b5fd' : '#a78bfa';
  const arrow = `<svg width="24" height="24" viewBox="-12 -12 24 24" style="transform:rotate(${v.heading ?? 0}deg)">
    <path d="M0,-10 L7,8 L0,4 L-7,8 Z" fill="${colour}" stroke="#09090b" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return L.divIcon({
    className: '',
    html: `<div style="opacity:${stale ? 0.45 : 0.9};display:flex;flex-direction:column;align-items:center;width:96px;margin-left:-36px;cursor:pointer">
      ${arrow}
      <div style="margin-top:1px;padding:0 3px;border-radius:3px;background:rgba(9,9,11,0.8);color:${colour};font:700 10px/13px ui-monospace,monospace;white-space:nowrap">SYS ${v.sysId} ${escapeHtml(v.modeName)}</div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function popupHtml(v: RosterVehicle, imperial: boolean): string {
  const now = Date.now();
  const posAge = v.posTime ? Math.round((now - v.posTime) / 1000) : null;
  return `<b>Vehicle ${v.sysId}</b>
    <div style="font-size:11px;margin-top:2px">${escapeHtml(vehicleSummary(v, now, imperial))}</div>
    ${posAge !== null && posAge > 2 ? `<div style="font-size:11px;color:#71717a">position ${posAge} s old</div>` : ''}
    <button type="button" data-switch="${v.sysId}" style="margin-top:6px;padding:2px 8px;border-radius:6px;border:1px solid #8b5cf6;background:#2e1065;color:#ede9fe;font-size:11px;font-weight:700;cursor:pointer">Switch to vehicle ${v.sysId}</button>`;
}

/** The units chosen now (read when drawn, not captured when the marker was made). */
const isImperial = () => ['mph', 'kts'].includes(useUnitsStore.getState().system);

export function useOtherVehiclesLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  const markers = useRef(new Map<number, { marker: L.Marker; key: string }>());

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '596';
    const draw = () => {
      const { vehicles, activeSystemId } = useVehicleRosterStore.getState();
      const imperial = isImperial();
      const now = Date.now();
      const seen = new Set<number>();
      for (const v of Object.values(vehicles)) {
        if (v.sysId === activeSystemId || v.lat === undefined || v.lon === undefined || (v.lat === 0 && v.lon === 0))
          continue;
        seen.add(v.sysId);
        const stale = !v.posTime || now - v.posTime > STALE_MS;
        // The icon is rebuilt only when its label or look changes (mode, armed, staleness); the heading turns the
        // arrow in place (it jitters by a degree even on the ground).
        const key = `${v.modeName}|${v.armed}|${stale}`;
        const had = markers.current.get(v.sysId);
        if (had) {
          had.marker.setLatLng([v.lat, v.lon]);
          if (had.key !== key) {
            had.marker.setIcon(icon(v, stale));
            had.key = key;
          } else {
            const svg = had.marker.getElement()?.querySelector('svg');
            if (svg) svg.style.transform = `rotate(${v.heading ?? 0}deg)`;
          }
          if (had.marker.isPopupOpen()) had.marker.setPopupContent(popupHtml(v, imperial));
        } else {
          const marker = L.marker([v.lat, v.lon], {
            icon: icon(v, stale),
            pane: PANE,
            keyboard: false,
            title: `Vehicle ${v.sysId}`,
          })
            .bindPopup(() => popupHtml(useVehicleRosterStore.getState().vehicles[v.sysId] ?? v, isImperial()), {
              pane: 'popupPane',
            })
            .addTo(map);
          markers.current.set(v.sysId, { marker, key });
        }
      }
      for (const [id, m] of markers.current) {
        if (!seen.has(id)) {
          m.marker.remove();
          markers.current.delete(id);
        }
      }
    };
    // The popup's switch button: one handler on the popup pane (the open popup's content is refreshed as the vehicle
    // reports, which replaces the button).
    const popupPane = map.getPane('popupPane');
    const onPopupClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement | null)?.closest<HTMLElement>('button[data-switch]');
      if (!btn) return;
      map.closePopup();
      requestVehicleSwitch(Number(btn.dataset.switch));
    };
    popupPane?.addEventListener('click', onPopupClick);
    draw();
    const unsub = useVehicleRosterStore.subscribe(draw);
    // Staleness shows even when nothing new arrives.
    const timer = setInterval(draw, 2000);
    const all = markers.current;
    return () => {
      unsub();
      clearInterval(timer);
      popupPane?.removeEventListener('click', onPopupClick);
      for (const m of all.values()) m.marker.remove();
      all.clear();
    };
  }, [mapRef, ready]);
}
