import React, { useEffect, useRef, useState } from 'react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { missionManager, MissionManagerStatus, groupFencePolygons } from '../../mavlink/missionManager';
import { MAVLINK_MSG_ID, getVehicleCategory } from '../../mavlink/messages';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RefreshCw, Crosshair, Maximize2, Shield, Flag, X, Eraser, Upload } from 'lucide-react';
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

interface GpsFix {
  t: number;
  timeBootMs: number;
  lat: number;
  lon: number;
  yaw: number;
}

interface MapWidgetProps {
  colSpan?: number;
}

export const MapWidget: React.FC<MapWidgetProps> = ({ colSpan = 6 }) => {
  const heartbeat = useTelemetryStore((s) => s.heartbeat);
  const position = useTelemetryStore((s) => s.position);
  const attitude = useTelemetryStore((s) => s.attitude);
  const missionWaypoints = useTelemetryStore((s) => s.missionWaypoints);
  const fencePoints = useTelemetryStore((s) => s.fencePoints);
  const rallyPoints = useTelemetryStore((s) => s.rallyPoints);
  const flightTrace = useTelemetryStore((s) => s.flightTrace);
  const clearTrace = useTelemetryStore((s) => s.clearTrace);

  const isFullWidth = colSpan === 12;
  const [aspectRatio, setAspectRatio] = useState<'4:3' | '16:9'>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('mavlink_glareshield_map_aspect');
        if (saved === '16:9' || saved === '4:3') return saved;
      }
    } catch {}
    return '4:3';
  });

  const handleAspectChange = (aspect: '4:3' | '16:9') => {
    setAspectRatio(aspect);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('mavlink_glareshield_map_aspect', aspect);
      }
    } catch {}
  };

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

  // GPS fixes buffer for linear interpolation (played back 1 fix-interval late)
  const fixesRef = useRef<GpsFix[]>([]);
  const displayPosRef = useRef<{ lat: number; lon: number; yaw: number } | null>(null);
  const yawRef = useRef<number>(attitude.yawDeg);
  const followVehicleRef = useRef<boolean>(true);
  const isInteractingRef = useRef<boolean>(false);
  const isFlyingToRef = useRef<boolean>(false);

  const [followVehicle, setFollowVehicle] = useState(true);
  const [mapLayer, setMapLayer] = useState<MapLayerType>('satellite');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [missionStatus, setMissionStatus] = useState<MissionManagerStatus>({
    isFetching: false,
    method: 'idle',
    waypointCount: 0,
    fenceCount: 0,
    rallyCount: 0,
    message: '',
  });

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      const result = await missionManager.uploadFile(file.name, buffer);
      if (!result.success && result.error) {
        setUploadError(result.error);
        setTimeout(() => setUploadError(null), 6000);
      }
    } catch (err: any) {
      console.error('Failed to process dropped file:', err);
      setUploadError(err?.message || 'Failed to read dropped file');
      setTimeout(() => setUploadError(null), 6000);
    }
  };

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

  // Invalidate map size on container resize
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Scroll and touch zoom centering during follow
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (followVehicle) {
      map.options.scrollWheelZoom = 'center';
      map.options.touchZoom = 'center';
    } else {
      map.options.scrollWheelZoom = true;
      map.options.touchZoom = true;
    }
  }, [followVehicle]);

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
          maxNativeZoom: 19,
          maxZoom: 22,
        });
      case 'satellite':
      default:
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
          maxNativeZoom: 19,
          maxZoom: 22,
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
      maxZoom: 22,
      zoomControl: false,
      scrollWheelZoom: 'center',
      touchZoom: 'center',
    });

    // Default to Google Satellite imagery
    const tileLayer = createTileLayer('satellite');
    tileLayer.addTo(map);
    activeTileLayerRef.current = tileLayer;

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

    // Vehicle Marker with custom rotating SVG (scoped to marker element without CSS transition delay)
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker-icon',
      html: `
        <div class="vehicle-icon-rotator" style="transform: rotate(${attitude.yawDeg}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
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

  // Sync live vehicle heading without triggering GPS fix buffer pushes
  useEffect(() => {
    yawRef.current = attitude.yawDeg;
  }, [attitude.yawDeg]);

  // Buffer incoming GPS fixes for linear interpolation
  useEffect(() => {
    if (position.lat === 0 && position.lon === 0) return;

    const now = performance.now();
    const fix: GpsFix = {
      t: now,
      timeBootMs: position.timeBootMs,
      lat: position.lat,
      lon: position.lon,
      yaw: attitude.yawDeg,
    };

    const fixes = fixesRef.current;
    if (fixes.length > 0) {
      const prev = fixes[fixes.length - 1];
      // If gap exceeds 1.0s (telemetry dropout or link loss), reset history and snap immediately
      const gapMs = (fix.timeBootMs > 0 && prev.timeBootMs > 0)
        ? (fix.timeBootMs - prev.timeBootMs)
        : (now - prev.t);
      if (gapMs > 1000) {
        fixesRef.current = [fix];
        displayPosRef.current = { lat: fix.lat, lon: fix.lon, yaw: fix.yaw };
        if (vehicleMarkerRef.current) {
          vehicleMarkerRef.current.setLatLng([fix.lat, fix.lon]);
        }
        return;
      }
    }

    fixes.push(fix);
    if (fixes.length > 4) fixes.shift();

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
  }, [position.timeBootMs, position.lat, position.lon]);

  // Linear interpolation played back one fix-interval late, camera locked to marker
  useEffect(() => {
    let animId: number;

    const animate = (now: number) => {
      animId = requestAnimationFrame(animate);

      const map = mapInstanceRef.current;
      const marker = vehicleMarkerRef.current;
      if (!map || !marker) return;

      const fixes = fixesRef.current;
      if (fixes.length === 0) return;

      let curLat = fixes[fixes.length - 1].lat;
      let curLon = fixes[fixes.length - 1].lon;
      const targetYaw = yawRef.current;

      if (fixes.length >= 2) {
        const p0 = fixes[fixes.length - 2];
        const p1 = fixes[fixes.length - 1];
        // Use true autopilot time_boot_ms delta if available to eliminate WebSocket arrival jitter
        const bootDt = (p1.timeBootMs > 0 && p0.timeBootMs > 0) ? (p1.timeBootMs - p0.timeBootMs) : 0;
        const fixDt = (bootDt > 10 && bootDt <= 1000) ? bootDt : (p1.t - p0.t);
        if (fixDt > 10 && fixDt <= 1000) {
          // Play back one fix-interval late (steady, even motion)
          const u = Math.min(Math.max((now - p1.t) / fixDt, 0.0), 1.0);
          curLat = p0.lat + (p1.lat - p0.lat) * u;
          curLon = p0.lon + (p1.lon - p0.lon) * u;
        } else {
          // Gap > 1s (stop or link dropout): snap directly to newest fix
          curLat = p1.lat;
          curLon = p1.lon;
        }
      }

      displayPosRef.current = { lat: curLat, lon: curLon, yaw: targetYaw };

      const latLng: [number, number] = [curLat, curLon];
      marker.setLatLng(latLng);

      const iconEl = marker.getElement()?.querySelector('.vehicle-icon-rotator') as HTMLElement | null;
      if (iconEl) {
        iconEl.style.transform = `rotate(${targetYaw.toFixed(1)}deg)`;
      }

      // Camera locked to marker with integer pixel panBy only on non-zero steps
      if (followVehicleRef.current && !isInteractingRef.current) {
        const centerPoint = map.getSize().divideBy(2);
        const vehiclePoint = map.latLngToContainerPoint(latLng);
        const dx = vehiclePoint.x - centerPoint.x;
        const dy = vehiclePoint.y - centerPoint.y;
        const pixelDist = Math.hypot(dx, dy);

        if (pixelDist > 180 && !isFlyingToRef.current) {
          isFlyingToRef.current = true;
          map.panTo(latLng, { animate: true, duration: 0.4 });
          map.once('moveend', () => {
            isFlyingToRef.current = false;
          });
        } else if (!isFlyingToRef.current) {
          const stepX = Math.round(dx);
          const stepY = Math.round(dy);

          // Only call panBy on non-zero steps to avoid 60fps tile recalculation
          if (stepX !== 0 || stepY !== 0) {
            map.panBy([stepX, stepY], { animate: false });
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
        <div class="vehicle-icon-rotator" style="transform: rotate(${attitude.yawDeg}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
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
  }, [fencePoints, missionWaypoints]);

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

  const aspectClass = isFullWidth
    ? (aspectRatio === '4:3'
        ? 'aspect-[16/9] md:aspect-[4/3] min-h-[440px] max-h-[82vh]'
        : 'aspect-[16/9] min-h-[440px] max-h-[82vh]')
    : 'h-full min-h-[350px] lg:min-h-[480px]';

  return (
    <Card className={`border-zinc-800 bg-zinc-950/90 shadow-lg overflow-hidden flex flex-col w-full ${aspectClass}`}>
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
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
            {/* Aspect Ratio Selector when in full-width mode */}
            {isFullWidth && (
              <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-[10px] font-sans font-medium">
                <button
                  onClick={() => handleAspectChange('4:3')}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    aspectRatio === '4:3'
                      ? 'bg-zinc-800 text-sky-400 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="4:3 Square Tactical Aspect Ratio"
                >
                  4:3
                </button>
                <button
                  onClick={() => handleAspectChange('16:9')}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    aspectRatio === '16:9'
                      ? 'bg-zinc-800 text-sky-400 font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="16:9 Widescreen Aspect Ratio"
                >
                  16:9
                </button>
              </div>
            )}

            {/* Map Imagery Selector (Satellite / Streets) */}
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-[10px] font-sans font-medium">
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
                const lastFix = fixesRef.current[fixesRef.current.length - 1];
                const target = displayPosRef.current ?? (lastFix ? { lat: lastFix.lat, lon: lastFix.lon } : { lat: position.lat, lon: position.lon });
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
      {(missionStatus.message || uploadError) && (
        <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-1 text-[11px] font-mono flex items-center justify-between">
          <span
            className={
              uploadError
                ? 'text-red-400 font-medium'
                : missionStatus.isFetching || missionStatus.isUploading
                ? 'text-amber-400 animate-pulse font-medium'
                : 'text-emerald-400'
            }
          >
            {uploadError || missionStatus.message}
          </span>
          {!uploadError && (missionStatus.isFetching || missionStatus.isUploading) && missionStatus.method === 'ftp' && (
            <span className="text-[10px] text-sky-400 font-bold ml-2">MAVFTP</span>
          )}
          {!uploadError && (missionStatus.isFetching || missionStatus.isUploading) && missionStatus.method === 'legacy' && (
            <span className="text-[10px] text-purple-400 font-bold ml-2">ITEM-BY-ITEM</span>
          )}
        </div>
      )}

      <CardContent
        className="p-0 flex-1 relative min-h-[300px] h-full overflow-hidden"
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDraggingOver(false);
        }}
        onDrop={handleFileDrop}
      >
        <div ref={mapContainerRef} className="w-full h-full min-h-[300px] z-0" />

        {/* Drag and Drop Upload Overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-[500] bg-zinc-950/85 backdrop-blur-sm border-2 border-dashed border-sky-400 rounded-lg flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150 pointer-events-none">
            <div className="p-4 rounded-full bg-sky-500/10 border border-sky-500/30 text-sky-400 mb-3 animate-bounce">
              <Upload className="h-8 w-8" />
            </div>
            <div className="text-base font-bold text-white mb-1">
              Drop Mission, Geofence, or Rally Point File
            </div>
            <div className="text-xs text-zinc-400 max-w-sm">
              Supports <span className="text-sky-300 font-mono">.waypoints</span>,{' '}
              <span className="text-sky-300 font-mono">.fence</span>,{' '}
              <span className="text-sky-300 font-mono">.rally</span>,{' '}
              <span className="text-sky-300 font-mono">.plan</span>, or binary{' '}
              <span className="text-sky-300 font-mono">.dat</span>. Automatically uploads via high-speed MAVFTP with item-by-item fallback.
            </div>
          </div>
        )}

        {/* GPS Coordinate readout HUD overlay in top-left (decoupled from bottom Leaflet attribution) */}
        <div className="absolute top-2 left-2 z-[400] bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 rounded-lg px-2.5 py-1 text-[11px] font-mono text-zinc-300 flex items-center gap-3 pointer-events-none shadow-md">
          <span>Lat: <b className="text-sky-400">{position.lat.toFixed(6)}</b></span>
          <span>Lon: <b className="text-sky-400">{position.lon.toFixed(6)}</b></span>
          <span>Alt: <b className="text-emerald-400">{formatAltitude(altitudeMode === 'msl' ? (position.alt || position.relativeAlt) : position.relativeAlt).full} {altitudeMode.toUpperCase()}</b></span>
        </div>
      </CardContent>
    </Card>
  );
};