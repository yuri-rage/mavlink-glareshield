// ADS-B traffic on the map: an aircraft symbol pointing along its heading, coloured by threat (sky, amber caution,
// red alert, magenta for an emergency squawk), labelled with callsign and height relative to the vehicle, faded when
// its report is getting old. Click for details. Markers are updated in place (reports arrive several times a second).

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useTrafficStore } from '../../store/trafficStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useAdsbSettingsStore } from '../../store/adsbSettingsStore';
import {
  TRAFFIC_STALE_MS,
  emergencySquawk,
  icaoHex,
  ownForThreat,
  escapeHtml,
  rankTraffic,
  relAltText,
  type Threat,
  type TrafficAircraft,
} from '../../mavlink/adsb';

const PANE = 'trafficPane';
const COLOURS = { none: '#38bdf8', caution: '#f59e0b', alert: '#ef4444', emergency: '#e879f9' };

function icon(a: TrafficAircraft, t: Threat | null, stale: boolean, label: string): L.DivIcon {
  const colour = emergencySquawk(a.squawk) ? COLOURS.emergency : COLOURS[t?.level ?? 'none'];
  const rot = a.headingDeg ?? 0;
  const plane = `<svg width="26" height="26" viewBox="-13 -13 26 26" style="transform:rotate(${rot}deg)">
    <path d="M0,-11 L2,-3 L10,2 L10,4 L2,2 L1.5,8 L4,10 L4,11.5 L0,10.5 L-4,11.5 L-4,10 L-1.5,8 L-2,2 L-10,4 L-10,2 L-2,-3 Z"
      fill="${colour}" stroke="#09090b" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  return L.divIcon({
    className: '',
    html: `<div style="opacity:${stale ? 0.4 : 1};display:flex;flex-direction:column;align-items:center;width:90px;margin-left:-32px">
      ${plane}
      <div style="margin-top:1px;padding:0 3px;border-radius:3px;background:rgba(9,9,11,0.8);color:${colour};font:700 10px/13px ui-monospace,monospace;white-space:nowrap">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

type Fmt = (v: number) => { full: string };

function popupHtml(a: TrafficAircraft, t: Threat | null, fmtAlt: Fmt, fmtDist: Fmt, fmtSpeed: Fmt, fmtClimb: Fmt) {
  const em = emergencySquawk(a.squawk);
  const rows = [
    ['ICAO', icaoHex(a.icao)],
    a.squawk !== null ? ['Squawk', `${a.squawk}${em ? ` (${em})` : ''}`] : null,
    a.altMslM !== null ? ['Altitude', `${fmtAlt(a.altMslM).full} MSL (${a.altGeometric ? 'GNSS' : 'barometric'})`] : null,
    a.speedMs !== null ? ['Speed', fmtSpeed(a.speedMs).full] : null,
    a.headingDeg !== null ? ['Track', `${Math.round(a.headingDeg)}°`] : null,
    a.climbMs !== null ? ['Vertical', fmtClimb(a.climbMs).full] : null,
    t ? ['Distance', `${fmtDist(t.distanceM).full}, bearing ${Math.round(t.bearingDeg)}°${t.closing ? ', closing' : ''}`] : null,
    t?.cpaS != null && t.cpaS < 300 ? ['Closest', `${fmtDist(t.cpaM!).full} in ${Math.round(t.cpaS)} s`] : null,
    ['Last heard', `${Math.max(0, Math.round((Date.now() - a.heardAtMs) / 1000))} s ago${a.simulated ? ' (simulated)' : ''}`],
  ].filter(Boolean) as [string, string][];
  return `<b>${escapeHtml(a.callsign ?? icaoHex(a.icao))}</b><table style="margin-top:3px;font-size:11px">${rows
    .map(([k, v]) => `<tr><td style="color:#71717a;padding-right:8px">${k}</td><td>${escapeHtml(v)}</td></tr>`)
    .join('')}</table>`;
}

export function useTrafficLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  const markers = useRef(new Map<number, L.Marker>());
  const aircraft = useTrafficStore((s) => s.aircraft);
  const position = useTelemetryStore((s) => s.position);
  const { formatAltitude, formatDistance, formatSpeed, formatClimb } = useUnitsStore();
  const showOnMap = useAdsbSettingsStore((s) => s.showOnMap);
  const thresholds = useAdsbSettingsStore((s) => s.thresholds);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getPane(PANE)) return;
    map.createPane(PANE).style.zIndex = '595';
  }, [mapRef, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const now = Date.now();
    // Turned off in the View menu: no symbols (warnings are separate, in Settings).
    const ranked = showOnMap ? rankTraffic(Object.values(aircraft), ownForThreat(position), thresholds) : [];
    const seen = new Set<number>();
    for (const { a, t } of ranked) {
      seen.add(a.icao);
      const label = `${a.callsign ?? icaoHex(a.icao)} ${relAltText(t?.relAltM ?? null, a.climbMs, formatAltitude)}`;
      const ic = icon(a, t, now - a.heardAtMs > TRAFFIC_STALE_MS, label);
      let m = markers.current.get(a.icao);
      if (!m) {
        m = L.marker([a.lat, a.lon], { icon: ic, pane: PANE, keyboard: false, zIndexOffset: t?.level === 'alert' ? 1000 : 0 }).bindPopup('', { autoPan: false });
        m.addTo(map);
        markers.current.set(a.icao, m);
      } else {
        m.setLatLng([a.lat, a.lon]);
        m.setIcon(ic);
        m.setZIndexOffset(t?.level === 'alert' ? 1000 : 0);
      }
      m.setPopupContent(popupHtml(a, t, formatAltitude, formatDistance, formatSpeed, formatClimb));
    }
    for (const [icao, m] of markers.current) {
      if (!seen.has(icao)) {
        m.remove();
        markers.current.delete(icao);
      }
    }
  }, [mapRef, ready, aircraft, position, formatAltitude, formatDistance, formatSpeed, formatClimb, showOnMap, thresholds]);

  useEffect(
    () => () => {
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
    },
    []
  );
}
