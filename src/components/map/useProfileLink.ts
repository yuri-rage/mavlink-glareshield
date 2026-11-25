// The mission profile and the map, linked while planning: the point pointed at on the profile strip is marked on
// the map (with its height above the terrain), and pointing at the route on the map marks the nearest profile point
// on the strip. Both go through the terrain store's `hover`; the marker follows it by subscription, so pointing at
// the profile doesn't re-render the map.

import { useEffect } from 'react';

import L from 'leaflet';

import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTerrainStore } from '../../store/terrainStore';
import { useUnitsStore } from '../../store/unitsStore';

/** How close (px) the pointer must be to the route on the map to pick a profile point. */
const PICK_PX = 14;

export function useProfileLink(mapRef: React.MutableRefObject<L.Map | null>, ready: boolean) {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let marker: L.CircleMarker | null = null;

    const show = () => {
      const { profile, hover, showProfile } = useMissionTerrainStore.getState();
      const p = showProfile && profile && hover !== null ? profile.points[hover] : null;
      if (!p) {
        marker?.remove();
        marker = null;
        return;
      }
      const agl = p.alt !== null && p.terrain !== null ? p.alt - p.terrain : null;
      const low = agl !== null && p.checked && agl < useTerrainStore.getState().clearanceM;
      const label =
        agl !== null ? `${useUnitsStore.getState().formatAltitude(agl).full} above terrain` : 'terrain unknown';
      if (!marker) {
        marker = L.circleMarker([p.lat, p.lon], {
          radius: 6,
          weight: 2,
          color: '#09090b',
          fillColor: '#38bdf8',
          fillOpacity: 1,
          interactive: false,
          pane: 'markerPane',
        })
          .bindTooltip(label, {
            permanent: true,
            direction: 'top',
            offset: [0, -8],
            className: 'font-mono text-[10px]',
          })
          .addTo(map);
      } else {
        marker.setLatLng([p.lat, p.lon]);
        marker.setTooltipContent(label);
      }
      marker.setStyle({ fillColor: low ? '#ef4444' : '#38bdf8' });
    };

    // Pointing at the route on the map: the nearest profile point within PICK_PX, once per frame at most.
    let fromMap = false;
    let pending: L.LeafletMouseEvent | null = null;
    let raf = 0;
    const pick = () => {
      raf = 0;
      const e = pending;
      pending = null;
      const st = useMissionTerrainStore.getState();
      if (!e || !st.showProfile || !st.profile) return;
      let best = -1;
      let bestPx = PICK_PX;
      st.profile.points.forEach((q, i) => {
        const d = map.latLngToContainerPoint([q.lat, q.lon]).distanceTo(e.containerPoint);
        if (d < bestPx) {
          bestPx = d;
          best = i;
        }
      });
      if (best >= 0) {
        fromMap = true;
        if (st.hover !== best) st.setHover(best);
      } else if (fromMap) {
        fromMap = false;
        st.setHover(null);
      }
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      pending = e;
      raf ||= requestAnimationFrame(pick);
    };
    const onOut = () => {
      if (fromMap) {
        fromMap = false;
        useMissionTerrainStore.getState().setHover(null);
      }
    };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    const unsubscribe = useMissionTerrainStore.subscribe((s, prev) => {
      if (s.hover !== prev.hover || s.profile !== prev.profile || s.showProfile !== prev.showProfile) show();
    });
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      if (raf) cancelAnimationFrame(raf);
      unsubscribe();
      marker?.remove();
    };
  }, [mapRef, ready]);
}
