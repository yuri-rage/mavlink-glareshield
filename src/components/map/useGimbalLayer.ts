// Where the camera looks, on the map: a dashed line from the vehicle along the gimbal's heading to where its centre
// ray meets the ground (taken as home's height), ending in a ring there (or an open end when it looks at the
// horizon). The place it was told to point at from here is a crosshair until stopped.

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useGimbalStore } from '../../store/gimbalStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { aimPoint, gimbalHeading } from '../../mavlink/gimbal';

const PANE = 'gimbalPane';
const STALE_MS = 3000;

export function useGimbalLayer(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  const layers = useRef<L.Layer[]>([]);
  const attitude = useGimbalStore((s) => s.attitude);
  const roi = useGimbalStore((s) => s.roi);
  const position = useTelemetryStore((s) => s.position);
  const vehicleYawDeg = useTelemetryStore((s) => s.attitude.yawDeg);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || map.getPane(PANE)) return;
    map.createPane(PANE).style.zIndex = '575';
  }, [mapRef, ready]);

  useEffect(() => {
    layers.current.forEach((l) => l.remove());
    layers.current = [];
    const map = mapRef.current;
    if (!map || !ready) return;
    const add = (l: L.Layer) => {
      l.addTo(map);
      layers.current.push(l);
    };
    const hasPos = Number.isFinite(position.lat) && !(position.lat === 0 && position.lon === 0);
    if (attitude && hasPos && Date.now() - attitude.at < STALE_MS) {
      const heading = gimbalHeading(attitude.yaw, attitude.earthFrame, vehicleYawDeg);
      const aim = aimPoint({ lat: position.lat, lon: position.lon, heightM: position.relativeAlt, pitchDeg: attitude.pitch, headingDeg: heading, maxM: 1000 });
      add(L.polyline([[position.lat, position.lon], [aim.lat, aim.lon]], { pane: PANE, color: '#38bdf8', weight: 2, opacity: 0.85, dashArray: aim.ground ? '6 4' : '2 6', interactive: false }));
      if (aim.ground) add(L.circleMarker([aim.lat, aim.lon], { pane: PANE, radius: 6, color: '#38bdf8', weight: 2, fillOpacity: 0.15, interactive: false }));
    }
    if (roi) {
      add(
        L.marker([roi.lat, roi.lon], {
          pane: PANE,
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: '',
            html: `<svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="8" fill="none" stroke="#f59e0b" stroke-width="2"/><path d="M0,-12V-4M0,4V12M-12,0H-4M4,0H12" stroke="#f59e0b" stroke-width="2"/></svg>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        })
      );
    }
  }, [mapRef, ready, attitude, roi, position, vehicleYawDeg]);

  useEffect(
    () => () => {
      layers.current.forEach((l) => l.remove());
      layers.current = [];
    },
    []
  );
}
