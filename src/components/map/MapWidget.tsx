import React, { useEffect, useRef, useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { missionManager, MissionManagerStatus, groupFencePolygons } from '../../mavlink/missionManager';
import { MAVLINK_MSG_ID, getVehicleCategory } from '../../mavlink/messages';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RefreshCw, Crosshair, Maximize2, Shield, Flag, X, Eraser } from 'lucide-react';
import L from 'leaflet';

function renderVehicleSvg(type: number): string {
  const cat = getVehicleCategory(type);
  if (cat === 'rover') {
    if (type === 11) {
      // Boat - Mission Planner vibrant magenta
      return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2 C16 6 18 12 18 20 L6 20 C6 12 8 6 12 2 Z" fill="#d946ef" stroke="#ffffff" stroke-width="1.5" />
        <circle cx="12" cy="11" r="2.5" fill="#ffffff" />
      </svg>`;
    }
    // Ground Rover - Mission Planner vibrant magenta with white accents
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="4" width="4" height="6" rx="1.5" fill="#a21caf" stroke="#ffffff" stroke-width="1" />
      <rect x="18" y="4" width="4" height="6" rx="1.5" fill="#a21caf" stroke="#ffffff" stroke-width="1" />
      <rect x="2" y="14" width="4" height="6" rx="1.5" fill="#a21caf" stroke="#ffffff" stroke-width="1" />
      <rect x="18" y="14" width="4" height="6" rx="1.5" fill="#a21caf" stroke="#ffffff" stroke-width="1" />
      <rect x="5.5" y="3" width="13" height="18" rx="3" fill="#d946ef" stroke="#ffffff" stroke-width="1.5" />
      <polygon points="12,5 16,11 8,11" fill="#ffffff" />
    </svg>`;
  } else if (cat === 'plane') {
    // Plane - Mission Planner vibrant magenta
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L14 9L22 13L22 15L14 13L14 19L17 21L17 22L12 21L7 22L7 21L10 19L10 13L2 15L2 13L10 9L12 2Z" fill="#d946ef" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" />
    </svg>`;
  } else if (cat === 'sub') {
    // Sub - Mission Planner vibrant magenta
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="7" y="3" width="10" height="18" rx="5" fill="#d946ef" stroke="#ffffff" stroke-width="1.5" />
      <circle cx="12" cy="10" r="2.5" fill="#ffffff" />
      <rect x="5" y="15" width="14" height="2" fill="#ffffff" />
    </svg>`;
  } else {
    // Copter (default) - Mission Planner vibrant magenta
    return `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="5" y1="5" x2="19" y2="19" stroke="#ffffff" stroke-width="2" />
      <line x1="19" y1="5" x2="5" y2="19" stroke="#ffffff" stroke-width="2" />
      <circle cx="5" cy="5" r="3" fill="#d946ef" stroke="#ffffff" stroke-width="1" />
      <circle cx="19" cy="5" r="3" fill="#d946ef" stroke="#ffffff" stroke-width="1" />
      <circle cx="5" cy="19" r="3" fill="#d946ef" stroke="#ffffff" stroke-width="1" />
      <circle cx="19" cy="19" r="3" fill="#d946ef" stroke="#ffffff" stroke-width="1" />
      <circle cx="12" cy="12" r="4" fill="#c026d3" stroke="#ffffff" stroke-width="1.5" />
      <polygon points="12,4 14,8 10,8" fill="#fde047" stroke="#ffffff" stroke-width="0.5" />
    </svg>`;
  }
}

function lerpAngle(current: number, target: number, t: number): number {
  let diff = (target - current) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return current + diff * t;
}

type MapLayerType = 'satellite' | 'street';

export const MapWidget: React.FC = () => {
  const {
    heartbeat,
    position,
    attitude,
    missionWaypoints,
    fencePoints,
    rallyPoints,
    flightTrace,
    addTracePoint,
    clearTrace,
  } = useTelemetryStore();
  const { formatAltitude, altitudeMode } = useUnitsStore();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const trailPolylineRef = useRef<L.Polyline | null>(null);
  const missionPolylineRef = useRef<L.Polyline | null>(null);
  const missionMarkersRef = useRef<L.Marker[]>([]);
  const fenceLayersRef = useRef<L.Layer[]>([]);
  const rallyMarkersRef = useRef<L.Marker[]>([]);

  // Telemetry target & high-performance display animation refs
  const targetPosRef = useRef<{ lat: number; lon: number; yaw: number }>({ lat: 0, lon: 0, yaw: 0 });
  const displayPosRef = useRef<{ lat: number; lon: number; yaw: number } | null>(null);
  const followVehicleRef = useRef<boolean>(true);
  const isInteractingRef = useRef<boolean>(false);
  const isFlyingToRef = useRef<boolean>(false);

  const [followVehicle, setFollowVehicle] = useState(true);
  const [mapLayer, setMapLayer] = useState<MapLayerType>('satellite');
  const [missionStatus, setMissionStatus] = useState<MissionManagerStatus>({
    isFetching: false,
    method: 'idle',
    waypointCount: 0,
    fenceCount: 0,
    rallyCount: 0,
    message: '',
  });

  // Track waypoint/mission download state
  useEffect(() => {
    return missionManager.onStatusChange((st) => {
      setMissionStatus(st);
    });
  }, []);

  // Sync flight trace polyline with store
  useEffect(() => {
    if (trailPolylineRef.current) {
      trailPolylineRef.current.setLatLngs(flightTrace);
    }
  }, [flightTrace]);

  // Register subscription for position
  useEffect(() => {
    messageRateManager.registerRequirement('map-pos', MAVLINK_MSG_ID.GLOBAL_POSITION_INT);
    return () => {
      messageRateManager.unregisterRequirement('map-pos');
    };
  }, []);

  // Request waypoints, fences, and rally points from ArduPilot
  const handleFetchMission = () => {
    missionManager.fetchMission();
  };

  const handleFitBounds = () => {
    if (!mapInstanceRef.current) return;

    const points: [number, number][] = [];
    if (position.lat !== 0 || position.lon !== 0) {
      points.push([position.lat, position.lon]);
    }
    missionWaypoints.forEach((w) => {
      if (w.lat !== 0 || w.lon !== 0) points.push([w.lat, w.lon]);
    });
    fencePoints.forEach((f) => {
      if (f.lat !== 0 || f.lon !== 0) points.push([f.lat, f.lon]);
    });
    rallyPoints.forEach((r) => {
      if (r.lat !== 0 || r.lon !== 0) points.push([r.lat, r.lon]);
    });

    if (points.length > 0) {
      setFollowVehicle(false);
      followVehicleRef.current = false;
      mapInstanceRef.current.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 19 });
    }
  };

  const createTileLayer = (layerType: MapLayerType): L.TileLayer => {
    switch (layerType) {
      case 'street':
        return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          maxZoom: 19,
        });
      case 'satellite':
      default:
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
          maxZoom: 19,
        });
    }
  };

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = position.lat !== 0 ? position.lat : 37.7749;
    const initialLon = position.lon !== 0 ? position.lon : -122.4194;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: 17,
      zoomControl: false,
    });

    // Default to Google Satellite imagery
    const tileLayer = createTileLayer('satellite');
    tileLayer.addTo(map);
    activeTileLayerRef.current = tileLayer;

    // Zoom control in bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Custom map panes for strict z-index layering (ensures trace and vehicle are never obscured)
    map.createPane('fencesPane');
    map.getPane('fencesPane')!.style.zIndex = '410';

    map.createPane('missionLinesPane');
    map.getPane('missionLinesPane')!.style.zIndex = '420';

    map.createPane('trailPane');
    map.getPane('trailPane')!.style.zIndex = '450';

    map.createPane('rallyMarkersPane');
    map.getPane('rallyMarkersPane')!.style.zIndex = '580';

    map.createPane('missionMarkersPane');
    map.getPane('missionMarkersPane')!.style.zIndex = '600';

    map.createPane('vehicleMarkerPane');
    map.getPane('vehicleMarkerPane')!.style.zIndex = '700';

    // Interaction listeners: unlock follow mode when user drags the map
    map.on('dragstart', () => {
      isInteractingRef.current = true;
      setFollowVehicle(false);
      followVehicleRef.current = false;
    });
    map.on('dragend', () => {
      isInteractingRef.current = false;
    });
    map.on('zoomstart', () => {
      isInteractingRef.current = true;
    });
    map.on('zoomend', () => {
      isInteractingRef.current = false;
    });

    // Vehicle Marker with custom rotating SVG
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker-icon',
      html: `
        <div id="vehicle-icon-div" style="transform: rotate(${attitude.yawDeg}deg); transition: transform 0.2s linear; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
          ${renderVehicleSvg(heartbeat.type)}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([initialLat, initialLon], {
      icon: vehicleIcon,
      pane: 'vehicleMarkerPane',
      zIndexOffset: 10000,
    }).addTo(map);
    vehicleMarkerRef.current = marker;

    // Trail polyline - Mission Planner vibrant magenta trace line
    const trailPoly = L.polyline(flightTrace, {
      color: '#d946ef',
      weight: 3.5,
      opacity: 0.95,
      pane: 'trailPane',
    }).addTo(map);
    trailPolylineRef.current = trailPoly;

    // Mission polyline - Mission Planner bright electric yellow mission path
    const missionPoly = L.polyline([], {
      color: '#ffff00',
      weight: 4,
      opacity: 1.0,
      pane: 'missionLinesPane',
    }).addTo(map);
    missionPolylineRef.current = missionPoly;

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tile Layer when layerType changes
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (activeTileLayerRef.current) {
      mapInstanceRef.current.removeLayer(activeTileLayerRef.current);
    }

    const newLayer = createTileLayer(mapLayer);
    newLayer.addTo(mapInstanceRef.current);
    activeTileLayerRef.current = newLayer;
  }, [mapLayer]);

  // Sync followVehicleRef with followVehicle state
  useEffect(() => {
    followVehicleRef.current = followVehicle;
  }, [followVehicle]);

  // Ingest raw telemetry updates into high-rate target ref
  useEffect(() => {
    if (position.lat === 0 && position.lon === 0) return;

    targetPosRef.current = {
      lat: position.lat,
      lon: position.lon,
      yaw: attitude.yawDeg,
    };

    // Instant initialization on first received point
    if (!displayPosRef.current) {
      displayPosRef.current = {
        lat: position.lat,
        lon: position.lon,
        yaw: attitude.yawDeg,
      };
      if (vehicleMarkerRef.current) {
        vehicleMarkerRef.current.setLatLng([position.lat, position.lon]);
      }
    }
  }, [position.lat, position.lon, attitude.yawDeg]);

  // Silky-smooth 60/120fps continuous interpolation and scale-invariant camera gimbal
  // Eliminates jello effect by moving marker and camera in the exact same render frame
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const animate = (now: number) => {
      animId = requestAnimationFrame(animate);

      const map = mapInstanceRef.current;
      const marker = vehicleMarkerRef.current;
      if (!map || !marker) return;

      const target = targetPosRef.current;
      if (target.lat === 0 && target.lon === 0) return;

      if (!displayPosRef.current) {
        displayPosRef.current = { ...target };
      }

      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      // Frame-rate independent exponential smoothing
      // At 60fps dt~0.016, lerpRate~0.22 (smoothly bridges 5-10Hz telemetry without delay)
      const lerpRate = 1 - Math.exp(-dt * 15);
      const cur = displayPosRef.current;

      cur.lat += (target.lat - cur.lat) * lerpRate;
      cur.lon += (target.lon - cur.lon) * lerpRate;
      cur.yaw = lerpAngle(cur.yaw, target.yaw, lerpRate);

      const latLng: [number, number] = [cur.lat, cur.lon];
      marker.setLatLng(latLng);

      const iconDiv = document.getElementById('vehicle-icon-div');
      if (iconDiv) {
        iconDiv.style.transform = `rotate(${cur.yaw.toFixed(1)}deg)`;
      }

      // Append to persistent flight trace if vehicle moved
      if (cur.lat !== 0 || cur.lon !== 0) {
        addTracePoint(cur.lat, cur.lon);
      }

      // Smooth camera follow without jello effect or animation thrashing
      if (followVehicleRef.current && !isInteractingRef.current) {
        const centerPoint = map.getSize().divideBy(2);
        const vehiclePoint = map.latLngToContainerPoint(latLng);
        const dx = vehiclePoint.x - centerPoint.x;
        const dy = vehiclePoint.y - centerPoint.y;
        const pixelDist = Math.sqrt(dx * dx + dy * dy);

        // Scale-invariant pixel deadband:
        // Ignore < 2.0 screen pixels of drift (eliminates stationary sensor noise at any zoom level)
        if (pixelDist >= 2.0) {
          if (pixelDist > 180 && !isFlyingToRef.current) {
            // Far off-screen: initiate smooth fly-to
            isFlyingToRef.current = true;
            map.panTo(latLng, { animate: true, duration: 0.4 });
            map.once('moveend', () => {
              isFlyingToRef.current = false;
            });
          } else if (!isFlyingToRef.current) {
            // Close tracking gimbal: smooth non-animated sub-pixel panBy
            // Critical damping factor ensures camera glides with the vehicle without oscillation or jello
            const panFactor = 1 - Math.exp(-dt * 10);
            map.panBy([dx * panFactor, dy * panFactor], { animate: false });
          }
        }
      }
    };

    animId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  // Update vehicle icon when vehicle type changes
  useEffect(() => {
    if (!vehicleMarkerRef.current) return;
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker-icon',
      html: `
        <div id="vehicle-icon-div" style="transform: rotate(${attitude.yawDeg}deg); transition: transform 0.2s linear; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
          ${renderVehicleSvg(heartbeat.type)}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    vehicleMarkerRef.current.setIcon(vehicleIcon);
    vehicleMarkerRef.current.setZIndexOffset(10000);
  }, [heartbeat.type]);

  // Update mission waypoints rendering
  useEffect(() => {
    if (!mapInstanceRef.current || !missionPolylineRef.current) return;

    // Clear old mission markers
    missionMarkersRef.current.forEach((m) => m.remove());
    missionMarkersRef.current = [];

    // Filter valid waypoints
    const validWps = missionWaypoints.filter((w) => (w.lat !== 0 || w.lon !== 0) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180);
    const lineCoords: [number, number][] = validWps.map((w) => [w.lat, w.lon]);
    missionPolylineRef.current.setLatLngs(lineCoords);

    // Add numbered waypoint markers - Mission Planner vibrant green sharply tapered pin icons
    validWps.forEach((wp) => {
      const isHome = wp.seq === 0;
      const pinColor = isHome ? '#15803d' : '#22c55e';
      const textColor = isHome ? '#14532d' : '#15803d';
      const label = isHome ? 'H' : wp.seq.toString();

      const wpIcon = L.divIcon({
        className: 'wp-marker',
        html: `
          <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.85)); width: 26px; height: 36px; display: flex; align-items: center; justify-content: center;">
            <svg width="26" height="36" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Sharply Tapered Needle Pin Shape pointing directly downward at bottom tip -->
              <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="${pinColor}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
              <!-- High-contrast White Inner Badge -->
              <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
              <!-- Number / Home Label -->
              <text x="13" y="15" font-size="${label.length > 2 ? '8.5' : '10.5'}" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="${textColor}">${label}</text>
            </svg>
          </div>
        `,
        iconSize: [26, 36],
        iconAnchor: [13, 35],
        popupAnchor: [0, -33],
      });

      const m = L.marker([wp.lat, wp.lon], {
        icon: wpIcon,
        pane: 'missionMarkersPane',
        zIndexOffset: isHome ? 200 : 100,
      })
        .bindPopup(`<b>${isHome ? 'Home Location (WP #0)' : `Waypoint #${wp.seq}`}</b><br/>Cmd: ${wp.command}<br/>Alt: ${wp.alt}m<br/>Lat: ${wp.lat.toFixed(6)}<br/>Lon: ${wp.lon.toFixed(6)}`)
        .addTo(mapInstanceRef.current!);
      missionMarkersRef.current.push(m);
    });
  }, [missionWaypoints]);

  // Update geofence rendering - Mission Planner solid red lines with transparent/dimmed interiors
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing fence layers
    fenceLayersRef.current.forEach((l) => l.remove());
    fenceLayersRef.current = [];

    const homeWp = missionWaypoints.find((w) => w.seq === 0);
    const defaultCenterLat = homeWp?.lat || position.lat || 37.7749;
    const defaultCenterLon = homeWp?.lon || position.lon || -122.4194;

    // 1. Group polygon fences so consecutive polygon fences are rendered independently
    // and each contains only the number of vertices described by the fence file
    const polygons = groupFencePolygons(fencePoints);

    polygons.forEach((polyData, idx) => {
      const isInclusion = polyData.type === 'inclusion';
      const typeLabel = isInclusion ? 'Inclusion Boundary' : 'Exclusion Zone (Keep Out)';
      const countLabel = polygons.length > 1 ? ` #${idx + 1}` : '';

      // Inclusion fences: blue lines with NO shading
      // Exclusion fences: red lines with translucent shading
      const poly = L.polygon(polyData.points, {
        color: isInclusion ? '#0ea5e9' : '#ef4444',
        weight: 2.5,
        fill: !isInclusion,
        fillColor: isInclusion ? 'transparent' : '#ef4444',
        fillOpacity: isInclusion ? 0 : 0.15,
        pane: 'fencesPane',
      })
        .bindPopup(
          `<b>Geofence ${typeLabel}${countLabel}</b><br/>${polyData.points.length} vertices${
            polyData.expectedCount ? ` (file spec: ${polyData.expectedCount})` : ''
          }<br/>Items #${polyData.seqs[0]} – #${polyData.seqs[polyData.seqs.length - 1]}`
        )
        .addTo(mapInstanceRef.current!);

      fenceLayersRef.current.push(poly);
    });

    // 2. Render circular fences and fence return points
    // Deduplicate by sequence to avoid stacked layers increasing apparent opacity
    const seenCircleSeqs = new Set<number>();

    fencePoints.forEach((fp) => {
      if (seenCircleSeqs.has(fp.seq)) return;
      seenCircleSeqs.add(fp.seq);

      const centerLat = fp.lat !== 0 ? fp.lat : defaultCenterLat;
      const centerLon = fp.lon !== 0 ? fp.lon : defaultCenterLon;

      const isCircle =
        fp.command === 5004 ||
        fp.command === 5005 ||
        (fp.command === 5003 && (fp.radius !== undefined || (fp.param1 !== undefined && fp.param1 > 0)));
      const isReturnPoint = fp.command === 5000 || (fp.command === 5003 && !isCircle);

      if (isCircle) {
        // Inclusion circles: command 5003, 5005, or fp.inclusion === true
        const isInc = fp.inclusion ?? (fp.command === 5003 || fp.command === 5005);
        const rad = fp.radius ?? (fp.param1 && fp.param1 > 0 ? fp.param1 : 100);

        // For small circles, scale stroke weight so it doesn't swallow the interior
        const strokeWeight = rad < 40 ? 1.5 : 2.5;

        const circle = L.circle([centerLat, centerLon], {
          radius: rad,
          color: isInc ? '#0ea5e9' : '#ef4444',
          weight: strokeWeight,
          fill: !isInc,
          fillColor: isInc ? 'transparent' : '#ef4444',
          fillOpacity: isInc ? 0 : 0.15,
          pane: 'fencesPane',
        })
          .bindPopup(
            `<b>${isInc ? 'Inclusion' : 'Exclusion'} Circle Fence (#${fp.seq})</b><br/>Radius: ${rad}m<br/>Center: ${centerLat.toFixed(6)}, ${centerLon.toFixed(6)}`
          )
          .addTo(mapInstanceRef.current!);
        fenceLayersRef.current.push(circle);
      } else if (isReturnPoint) {
        // Fence Return point - purple sharply tapered needle pin
        const retIcon = L.divIcon({
          className: 'fence-ret-marker',
          html: `
            <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.8)); width: 26px; height: 36px; display: flex; align-items: center; justify-content: center;">
              <svg width="26" height="36" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="#a855f7" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
                <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
                <text x="13" y="15" font-size="8.5" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="#7e22ce">FR</text>
              </svg>
            </div>
          `,
          iconSize: [26, 36],
          iconAnchor: [13, 35],
          popupAnchor: [0, -33],
        });
        const marker = L.marker([centerLat, centerLon], {
          icon: retIcon,
          pane: 'rallyMarkersPane',
          zIndexOffset: 80,
        })
          .bindPopup(`<b>Fence Return Point</b><br/>Lat: ${centerLat.toFixed(6)}<br/>Lon: ${centerLon.toFixed(6)}`)
          .addTo(mapInstanceRef.current!);
        fenceLayersRef.current.push(marker);
      }
    });
  }, [fencePoints, missionWaypoints, position.lat, position.lon]);

  // Update rally points rendering
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    // Clear existing rally markers
    rallyMarkersRef.current.forEach((m) => m.remove());
    rallyMarkersRef.current = [];

    rallyPoints.forEach((rp) => {
      if (rp.lat === 0 && rp.lon === 0) return;

      const rallyIcon = L.divIcon({
        className: 'rally-marker',
        html: `
          <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.8)); width: 26px; height: 36px; display: flex; align-items: center; justify-content: center;">
            <svg width="26" height="36" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="#9a337d" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
              <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
              <text x="13" y="15" font-size="8.5" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="#9a337d">R${rp.seq}</text>
            </svg>
          </div>
        `,
        iconSize: [26, 36],
        iconAnchor: [13, 35],
        popupAnchor: [0, -33],
      });

      const m = L.marker([rp.lat, rp.lon], {
        icon: rallyIcon,
        pane: 'rallyMarkersPane',
        zIndexOffset: 90,
      })
        .bindPopup(`<b>Rally Point #${rp.seq}</b><br/>Alt: ${rp.alt}m<br/>Lat: ${rp.lat.toFixed(6)}<br/>Lon: ${rp.lon.toFixed(6)}`)
        .addTo(mapInstanceRef.current!);
      rallyMarkersRef.current.push(m);
    });
  }, [rallyPoints]);

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-lg overflow-hidden flex flex-col h-full min-h-[300px]">
      <CardHeader className="py-1.5 px-2.5 sm:px-3 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {missionWaypoints.length > 0 && (
              <Badge variant="warning" className="text-[10px] font-mono px-1.5 py-0.5">
                {missionWaypoints.length} WPs
              </Badge>
            )}
            {fencePoints.length > 0 && (
              <Badge variant="destructive" className="text-[10px] font-mono px-1.5 py-0.5 gap-1">
                <Shield className="h-2.5 w-2.5 inline" /> {fencePoints.length} Fence
              </Badge>
            )}
            {rallyPoints.length > 0 && (
              <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0.5 gap-1 text-[#f0abfc] border-[#9a337d]/40 bg-[#9a337d]/15">
                <Flag className="h-2.5 w-2.5 inline text-[#f0abfc]" /> {rallyPoints.length} Rally
              </Badge>
            )}
            {missionStatus.isFetching && missionStatus.method === 'ftp' && (
              <Badge variant="info" className="text-[9px] font-mono px-1.5 py-0.5">
                MAVFTP
              </Badge>
            )}
            {missionStatus.isFetching && missionStatus.method === 'legacy' && (
              <Badge variant="secondary" className="text-[9px] font-mono px-1.5 py-0.5">
                STREAM
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 ml-auto">
            {/* Map Imagery Selector (Satellite / Streets) */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-[10px] font-mono font-medium">
              <button
                onClick={() => setMapLayer('satellite')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  mapLayer === 'satellite'
                    ? 'bg-zinc-800 text-sky-400 font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Esri World Imagery (Satellite)"
              >
                Sat
              </button>
              <button
                onClick={() => setMapLayer('street')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  mapLayer === 'street'
                    ? 'bg-zinc-800 text-sky-400 font-bold shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="OpenStreetMap Standard Map"
              >
                Map
              </button>
            </div>

            {flightTrace.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearTrace}
                className="h-7 w-7 p-0 text-xs font-bold text-zinc-400 hover:text-amber-400 border-zinc-800"
                title="Clear flight trace"
              >
                <Eraser className="h-3.5 w-3.5 text-amber-400" />
              </Button>
            )}

            <Button
              variant={followVehicle ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setFollowVehicle(true);
                followVehicleRef.current = true;
                const target = displayPosRef.current ?? targetPosRef.current;
                if (mapInstanceRef.current && (target.lat !== 0 || target.lon !== 0)) {
                  isFlyingToRef.current = true;
                  mapInstanceRef.current.panTo([target.lat, target.lon], {
                    animate: true,
                    duration: 0.4,
                  });
                  mapInstanceRef.current.once('moveend', () => {
                    isFlyingToRef.current = false;
                  });
                }
              }}
              className={`h-7 w-7 p-0 text-xs font-bold ${
                followVehicle ? 'bg-sky-500 text-white' : 'text-zinc-400'
              }`}
              title={followVehicle ? 'Centered on vehicle (click to re-center)' : 'Click to center and follow vehicle'}
            >
              <Crosshair className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleFitBounds}
              className="h-7 w-7 p-0 text-xs font-bold text-zinc-300 hover:text-white"
              title="Fit map to vehicle, waypoints, and fence"
            >
              <Maximize2 className="h-3.5 w-3.5 text-sky-400" />
            </Button>

            <Button
              variant={missionStatus.isFetching ? 'destructive' : 'outline'}
              size="sm"
              onClick={missionStatus.isFetching ? () => missionManager.cancelFetch() : handleFetchMission}
              className={`h-7 px-2 text-xs font-bold gap-1 transition-colors ${
                missionStatus.isFetching
                  ? 'bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:text-red-300'
                  : 'text-zinc-300 hover:text-white'
              }`}
              title={missionStatus.isFetching ? 'Cancel waypoint and fence fetch' : 'Fetch waypoints, fence & rally from vehicle'}
            >
              {missionStatus.isFetching ? (
                <>
                  <X className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-[11px]">Cancel</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
                  <span className="hidden xl:inline text-[11px]">Fetch WPs</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Progress / Status banner */}
      {missionStatus.message && (
        <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-1 text-[11px] font-mono flex items-center justify-between">
          <span className={missionStatus.isFetching ? 'text-amber-400 animate-pulse font-medium' : 'text-emerald-400'}>
            {missionStatus.message}
          </span>
          {missionStatus.isFetching && missionStatus.method === 'ftp' && (
            <span className="text-[10px] text-sky-400 font-bold ml-2">MAVFTP</span>
          )}
        </div>
      )}

      <CardContent className="p-0 flex-1 relative min-h-[280px]">
        <div ref={mapContainerRef} className="w-full h-full min-h-[280px] z-0" />

        {/* GPS Coordinate readout HUD overlay in bottom-left */}
        <div className="absolute bottom-2 left-2 z-[400] bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 rounded-lg px-2.5 py-1 text-[11px] font-mono text-zinc-300 flex items-center gap-3 pointer-events-none">
          <span>Lat: <b className="text-sky-400">{position.lat.toFixed(6)}</b></span>
          <span>Lon: <b className="text-sky-400">{position.lon.toFixed(6)}</b></span>
          <span>Alt: <b className="text-emerald-400">{formatAltitude(altitudeMode === 'msl' ? (position.alt || position.relativeAlt) : position.relativeAlt).full} {altitudeMode.toUpperCase()}</b></span>
        </div>
      </CardContent>
    </Card>
  );
};