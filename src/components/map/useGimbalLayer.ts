// Where the camera looks, on the map: a dashed line from the vehicle along the gimbal's heading to where its centre
// ray meets the ground (taken as home's height), ending in a ring there (or an open end when it looks at the
// horizon). The place it was told to point at from here is a crosshair until stopped.
//
// Updated outside React (store subscriptions moving Leaflet layers): subscribing to the vehicle's attitude in render
// would re-render the whole map at the attitude rate. With no gimbal attitude, nothing is drawn or recomputed.

import { useEffect } from 'react';
import L from 'leaflet';
import { useGimbalStore } from '../../store/gimbalStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { aimPoint, gimbalHeading } from '../../mavlink/gimbal';

const PANE = 'gimbalPane';
const STALE_MS = 3000;
const ROI_ICON = () =>
  L.divIcon({
    className: '',
    html: `<svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="8" fill="none" stroke="#f59e0b" stroke-width="2"/><path d="M0,-12V-4M0,4V12M-12,0H-4M4,0H12" stroke="#f59e0b" stroke-width="2"/></svg>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

export function useGimbalLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getPane(PANE)) map.createPane(PANE).style.zIndex = '575';
    let line: L.Polyline | null = null;
    let ring: L.CircleMarker | null = null;
    let roiMarker: L.Marker | null = null;

    const drawAim = () => {
      const { attitude } = useGimbalStore.getState();
      const { position, attitude: vehicle } = useTelemetryStore.getState();
      const hasPos = Number.isFinite(position.lat) && !(position.lat === 0 && position.lon === 0);
      if (!attitude || !hasPos || Date.now() - attitude.at >= STALE_MS) {
        line?.remove();
        ring?.remove();
        line = ring = null;
        return;
      }
      const heading = gimbalHeading(attitude.yaw, attitude.earthFrame, vehicle.yawDeg);
      const aim = aimPoint({ lat: position.lat, lon: position.lon, heightM: position.relativeAlt, pitchDeg: attitude.pitch, headingDeg: heading, maxM: 1000 });
      const pts: L.LatLngExpression[] = [[position.lat, position.lon], [aim.lat, aim.lon]];
      if (!line) line = L.polyline(pts, { pane: PANE, color: '#38bdf8', weight: 2, opacity: 0.85, interactive: false }).addTo(map);
      else line.setLatLngs(pts);
      line.setStyle({ dashArray: aim.ground ? '6 4' : '2 6' });
      if (aim.ground) {
        if (!ring) ring = L.circleMarker([aim.lat, aim.lon], { pane: PANE, radius: 6, color: '#38bdf8', weight: 2, fillOpacity: 0.15, interactive: false }).addTo(map);
        else ring.setLatLng([aim.lat, aim.lon]);
      } else {
        ring?.remove();
        ring = null;
      }
    };
    const drawRoi = () => {
      const { roi } = useGimbalStore.getState();
      if (!roi) {
        roiMarker?.remove();
        roiMarker = null;
      } else if (!roiMarker) {
        roiMarker = L.marker([roi.lat, roi.lon], { pane: PANE, interactive: false, keyboard: false, icon: ROI_ICON() }).addTo(map);
      } else {
        roiMarker.setLatLng([roi.lat, roi.lon]);
      }
    };

    drawAim();
    drawRoi();
    const unGimbal = useGimbalStore.subscribe((s, p) => {
      if (s.attitude !== p.attitude) drawAim();
      if (s.roi !== p.roi) drawRoi();
    });
    // The vehicle moving or turning moves the line, but only while there is a gimbal attitude to draw.
    const unVehicle = useTelemetryStore.subscribe((s, p) => {
      if (!useGimbalStore.getState().attitude) return;
      if (s.position !== p.position || s.attitude.yawDeg !== p.attitude.yawDeg) drawAim();
    });
    // An attitude that stops coming goes stale with nothing new arriving: clear the line then.
    const stale = setInterval(drawAim, 1000);
    return () => {
      unGimbal();
      unVehicle();
      clearInterval(stale);
      line?.remove();
      ring?.remove();
      roiMarker?.remove();
    };
  }, [mapRef, ready]);
}
