import 'leaflet/dist/leaflet.css';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTelemetryStore, sendTrackedCommand, computeDistanceAndBearing } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import { missionManager, MissionManagerStatus, groupFencePolygons } from '../../mavlink/missionManager';
import { mavlinkConnection } from '../../mavlink/connection';
import { MAVLINK_MSG_ID, getVehicleCategory, getGuidedModeNum, cmdHasLocation } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Modal } from '../ui/modal';
import { parseDroppedMissionFile, ParsedMissionFile } from '../../mavlink/missionFileParser';
import { MissionItemIntData } from '../../mavlink/encoder';
import { RefreshCw, Crosshair, Shield, Flag, Upload, AlertTriangle, Navigation, Home, LocateFixed, Map as MapIcon } from 'lucide-react';
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


/** Within this horizontal distance of a fly-to target, the vehicle has arrived and the target is cleared. */
const FLY_TO_ARRIVAL_M = 3;

/** The fly-to target crosshair; a picked but unsent point is drawn fainter. */
function flyToTargetSvg(opacity: number): string {
  return `
        <div style="opacity:${opacity}; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.9)); width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="14" cy="14" r="10" stroke="#38bdf8" stroke-width="2" fill="rgba(14,165,233,0.25)"/>
            <circle cx="14" cy="14" r="3" fill="#38bdf8"/>
            <line x1="14" y1="1" x2="14" y2="7" stroke="#38bdf8" stroke-width="2"/>
            <line x1="14" y1="21" x2="14" y2="27" stroke="#38bdf8" stroke-width="2"/>
            <line x1="1" y1="14" x2="7" y2="14" stroke="#38bdf8" stroke-width="2"/>
            <line x1="21" y1="14" x2="27" y2="14" stroke="#38bdf8" stroke-width="2"/>
          </svg>
        </div>
      `;
}

interface GpsFix {
  t: number;
  timeBootMs: number;
  lat: number;
  lon: number;
  yaw: number;
}

import { computeMapBadgeVisibility } from './mapBadgeVisibility';
import { MapMissionFooter } from './MapMissionFooter';
import { MissionMenu } from './MissionMenu';
import { MapViewMenu, type MapLayerType } from './MapViewMenu';
import { FlyToPopover } from './FlyToPopover';

interface MapWidgetProps {
  colSpan?: number;
}

/** The Home marker's popup: source, altitude, position, and the vector from the vehicle when known. */
function homePopupHtml(home: {
  source: string;
  alt: number;
  lat: number;
  lon: number;
  distanceM: number | null;
  bearingDeg: number | null;
}): string {
  return `<b>Home Position (${home.source})</b><br/>Alt: ${home.alt.toFixed(1)}m<br/>Lat: ${home.lat.toFixed(6)}<br/>Lon: ${home.lon.toFixed(6)}${
    home.distanceM !== null ? `<br/>${useUnitsStore.getState().formatHomeVector(home.bearingDeg, home.distanceM)}` : ''
  }`;
}

// The map's view, kept across unmounts (switching dashboard tabs) so it comes back as it was left. Zoom is also
// kept across reloads.
const ZOOM_KEY = 'mavlink_glareshield_map_zoom';
interface SavedMapView {
  zoom: number;
  center: [number, number];
  follow: boolean;
  layer: MapLayerType;
}
let savedMapView: SavedMapView | null = null;
function initialZoom(): number {
  if (savedMapView) return savedMapView.zoom;
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    if (Number.isFinite(z) && z >= 1 && z <= 22) return z;
  } catch {}
  return 17;
}

export const MapWidget: React.FC<MapWidgetProps> = ({ colSpan = 6 }) => {
  const heartbeat = useTelemetryStore((s) => s.heartbeat);
  const connected = heartbeat.lastHeartbeatTime > 0 && heartbeat.modeName !== 'DISCONNECTED';
  const hasConnectedInSession = useTelemetryStore((s) => s.hasConnectedInSession);
  const position = useTelemetryStore((s) => s.position);
  const homePosition = useTelemetryStore((s) => s.homePosition);
  const missionWaypoints = useTelemetryStore((s) => s.missionWaypoints);
  const fencePoints = useTelemetryStore((s) => s.fencePoints);
  const rallyPoints = useTelemetryStore((s) => s.rallyPoints);
  const flightTrace = useTelemetryStore((s) => s.flightTrace);
  const clearTrace = useTelemetryStore((s) => s.clearTrace);
  const baseStationPosition = useTelemetryStore((s) => s.baseStationPosition);

  const hasValidPosition = (position.lat !== 0 || position.lon !== 0) && (connected || hasConnectedInSession);

  const isFullWidth = colSpan === 12;
  const [aspectRatio, setAspectRatio] = useState<'4:3' | '16:9' | '1:1'>(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem('mavlink_glareshield_map_aspect');
        if (saved === '16:9' || saved === '4:3' || saved === '1:1') return saved;
      }
    } catch {}
    return '4:3';
  });

  const handleAspectChange = (aspect: '4:3' | '16:9' | '1:1') => {
    setAspectRatio(aspect);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('mavlink_glareshield_map_aspect', aspect);
      }
    } catch {}
  };

  const { formatAltitude, altitudeMode, formatHomeVector } = useUnitsStore();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const activeTileLayerRef = useRef<L.TileLayer | null>(null);
  const vehicleMarkerRef = useRef<L.Marker | null>(null);
  const trailPolylineRef = useRef<L.Polyline | null>(null);
  const missionPolylineRef = useRef<L.Polyline | null>(null);
  const missionMarkersRef = useRef<L.Marker[]>([]);
  const fenceLayersRef = useRef<L.Layer[]>([]);
  const rallyMarkersRef = useRef<L.Marker[]>([]);
  const baseMarkerRef = useRef<L.Marker | null>(null);
  const homeMarkerRef = useRef<L.Marker | null>(null);
  const flyToMarkerRef = useRef<L.Marker | null>(null);
  const flyToLineRef = useRef<L.Polyline | null>(null);
  const flyToModeRef = useRef<boolean>(false);

  // GPS fixes buffer for linear interpolation (played back 1 fix-interval late)
  const fixesRef = useRef<GpsFix[]>([]);
  const displayPosRef = useRef<{ lat: number; lon: number; yaw: number } | null>(null);
  // Heading, read by the marker animation. Kept in a ref fed by a store subscription: subscribing to attitude in
  // render re-rendered the whole map at the attitude rate just to update this number.
  const yawRef = useRef<number>(useTelemetryStore.getState().attitude.yawDeg);
  useEffect(
    () =>
      useTelemetryStore.subscribe((s) => {
        yawRef.current = s.attitude.yawDeg;
      }),
    []
  );
  const followVehicleRef = useRef<boolean>(savedMapView?.follow ?? true);
  const isInteractingRef = useRef<boolean>(false);
  const isFlyingToRef = useRef<boolean>(false);

  const [followVehicle, setFollowVehicle] = useState(() => savedMapView?.follow ?? true);
  const [mapLayer, setMapLayer] = useState<MapLayerType>(() => savedMapView?.layer ?? 'satellite');
  const mapLayerRef = useRef(mapLayer);
  mapLayerRef.current = mapLayer;
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    filename: string;
    buffer: Uint8Array;
    parsed: ParsedMissionFile;
  } | null>(null);
  const previewLayersRef = useRef<L.Layer[]>([]);

  // Fly-To-Here (DO_REPOSITION) state
  const [flyToMode, setFlyToMode] = useState(false);
  /** The point picked to fly to; `accuracyM` is set when it is the browser's own location ("fly to me"). */
  const [pendingFlyTo, setPendingFlyTo] = useState<{ lat: number; lon: number; accuracyM?: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const [flyToAltInput, setFlyToAltInput] = useState<string>('20');
  const [activeFlyToTarget, setActiveFlyToTarget] = useState<{ lat: number; lon: number; alt: number } | null>(null);
  // Where the picked point sits in the map container, so the fly-to card stays beside it as the map moves.
  const [flyToAnchor, setFlyToAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    flyToModeRef.current = flyToMode;
    if (!flyToMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFlyToMode(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [flyToMode]);

  const [missionStatus, setMissionStatus] = useState<MissionManagerStatus>({
    isFetching: false,
    method: 'idle',
    waypointCount: 0,
    fenceCount: 0,
    rallyCount: 0,
    message: '',
  });

  // Responsive header badge visibility to keep top bar on a single row without feedback oscillation
  const [hideBadges, setHideBadges] = useState(false);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const rightControlsRef = useRef<HTMLDivElement | null>(null);

  const userWpCount = Math.max(0, missionWaypoints.length - 1);

  useEffect(() => {
    const updateBadgeVisibility = () => {
      const header = headerRef.current;
      const controls = rightControlsRef.current;
      if (!header || !controls) return;

      const headerWidth = header.clientWidth;
      const controlsWidth = controls.offsetWidth;

      setHideBadges((prev) =>
        computeMapBadgeVisibility({
          headerWidth,
          controlsWidth,
          userWpCount,
          fenceCount: fencePoints.length,
          rallyCount: rallyPoints.length,
          isFetching: missionStatus.isFetching,
          previouslyHidden: prev,
        })
      );
    };

    updateBadgeVisibility();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      updateBadgeVisibility();
    });

    if (headerRef.current) {
      observer.observe(headerRef.current);
    }
    if (rightControlsRef.current) {
      observer.observe(rightControlsRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [userWpCount, fencePoints.length, rallyPoints.length, missionStatus.isFetching, colSpan]);

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    await loadMissionFile(files[0]);
  };

  /** Parses a dropped or picked flight plan file and shows its preview, ready to upload. */
  const loadMissionFile = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);
      const parsed = parseDroppedMissionFile(file.name, buffer);
      if (!parsed || parsed.items.length === 0) {
        setUploadError('Unable to parse file. Format not recognized or file is empty.');
        setTimeout(() => setUploadError(null), 6000);
        return;
      }
      setPendingUpload({ filename: file.name, buffer, parsed });
    } catch (err: any) {
      console.error('Failed to parse dropped flight plan file:', err);
      setUploadError(err?.message || 'Failed to parse dropped flight plan file');
      setTimeout(() => setUploadError(null), 7000);
    }
  };

  const handleCancelUpload = () => {
    previewLayersRef.current.forEach((l) => l.remove());
    previewLayersRef.current = [];
    setPendingUpload(null);
  };

  const handleConfirmUpload = async () => {
    if (!pendingUpload) return;
    const { filename, buffer } = pendingUpload;
    handleCancelUpload();

    try {
      const result = await missionManager.uploadFile(filename, buffer);
      if (!result.success && result.error) {
        setUploadError(result.error);
        setTimeout(() => setUploadError(null), 7000);
      }
    } catch (err: any) {
      console.error('Failed to upload flight plan file:', err);
      setUploadError(err?.message || 'Failed to upload flight plan file');
      setTimeout(() => setUploadError(null), 7000);
    }
  };

  // Render dashed preview overlay on map whenever a pending upload is staged
  useEffect(() => {
    previewLayersRef.current.forEach((l) => l.remove());
    previewLayersRef.current = [];

    if (!pendingUpload || !mapInstanceRef.current) return;

    const map = mapInstanceRef.current;
    const previewPoints: [number, number][] = [];

    const renderItemsPreview = (items: MissionItemIntData[], type: string) => {
      if (type === 'mission') {
        const validCoords = items
          .filter((w) => (w.x !== 0 || w.y !== 0) && Math.abs(w.x ?? 0) <= 90 && Math.abs(w.y ?? 0) <= 180)
          .map((w) => [w.x!, w.y!] as [number, number]);

        if (validCoords.length > 0) {
          validCoords.forEach((pt) => previewPoints.push(pt));
          const line = L.polyline(validCoords, {
            color: '#f59e0b',
            weight: 3,
            dashArray: '6, 6',
            opacity: 0.9,
          }).addTo(map);
          previewLayersRef.current.push(line);

          validCoords.forEach(([lat, lon], idx) => {
            const icon = L.divIcon({
              className: 'preview-wp-icon',
              html: `<div style="background:#f59e0b;color:#000;font-size:10px;font-weight:bold;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.6);">${idx}</div>`,
              iconSize: [18, 18],
              iconAnchor: [9, 9],
            });
            const marker = L.marker([lat, lon], { icon }).addTo(map);
            previewLayersRef.current.push(marker);
          });
        }
      } else if (type === 'fence') {
        const fps = items.map((it) => ({
          seq: it.seq,
          command: it.command,
          lat: it.x ?? 0,
          lon: it.y ?? 0,
          alt: it.z ?? 0,
          param1: it.param1,
          inclusion: it.command === 5001 || it.command === 5003 || it.command === 5005,
        }));
        const polys = groupFencePolygons(fps);
        polys.forEach((p) => {
          if (p.points && p.points.length > 0) {
            p.points.forEach((pt: [number, number]) => previewPoints.push(pt));
            const poly = L.polygon(p.points, {
              color: '#f97316',
              weight: 2,
              dashArray: '6, 6',
              fillColor: '#ea580c',
              fillOpacity: 0.15,
            }).addTo(map);
            previewLayersRef.current.push(poly);
          }
        });
      } else if (type === 'rally') {
        items.forEach((rp) => {
          if (rp.x && rp.y) {
            previewPoints.push([rp.x, rp.y]);
            const icon = L.divIcon({
              className: 'preview-rally-icon',
              html: `<div style="background:#a855f7;color:#fff;font-size:10px;font-weight:bold;width:16px;height:16px;border-radius:3px;display:flex;align-items:center;justify-content:center;border:1px solid #fff;">R</div>`,
              iconSize: [16, 16],
              iconAnchor: [8, 8],
            });
            const marker = L.marker([rp.x, rp.y], { icon }).addTo(map);
            previewLayersRef.current.push(marker);
          }
        });
      }
    };

    if (pendingUpload.parsed.sections && pendingUpload.parsed.sections.length > 0) {
      pendingUpload.parsed.sections.forEach((sec) => renderItemsPreview(sec.items, sec.type));
    } else {
      renderItemsPreview(pendingUpload.parsed.items, pendingUpload.parsed.type);
    }

    if (previewPoints.length > 0) {
      setFollowVehicle(false);
      followVehicleRef.current = false;
      map.fitBounds(L.latLngBounds(previewPoints), { padding: [50, 50] });
    }
  }, [pendingUpload]);

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
      // Commands without a location carry plain parameters in lat/lon (gimbal flags, shot numbers): skip them.
      if (cmdHasLocation(w.command) && (w.lat !== 0 || w.lon !== 0)) points.push([w.lat, w.lon]);
    });
    fencePoints.forEach((f) => {
      if (f.lat !== 0 || f.lon !== 0) points.push([f.lat, f.lon]);
    });
    rallyPoints.forEach((r) => {
      if (r.lat !== 0 || r.lon !== 0) points.push([r.lat, r.lon]);
    });
    if (baseStationPosition && (baseStationPosition.lat !== 0 || baseStationPosition.lon !== 0)) {
      points.push([baseStationPosition.lat, baseStationPosition.lon]);
    }

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
          crossOrigin: true,
        });
      case 'satellite':
      default:
        return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: 'Tiles &copy; Esri &mdash; Source: Esri, USGS, NOAA',
          maxNativeZoom: 19,
          maxZoom: 22,
          crossOrigin: true,
        });
    }
  };

  const openFlyToPrompt = (lat: number, lon: number, accuracyM?: number) => {
    const st = useTelemetryStore.getState();
    if (st.heartbeat.lastHeartbeatTime === 0 || st.heartbeat.modeName === 'DISCONNECTED') return;
    const curAlt = Math.max(10, Math.round(st.position.relativeAlt || 20));
    setFlyToAltInput(String(curAlt));
    setPendingFlyTo({ lat, lon, accuracyM });
    setFlyToMode(false);
  };

  // Geolocation needs a secure page (https or localhost) and a browser that has it.
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator && (typeof window === 'undefined' || window.isSecureContext);

  /** "Fly to me": the browser's location, offered in the same card as a picked point. */
  const handleFlyToMe = () => {
    if (!canLocate || locating) return;
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const map = mapInstanceRef.current;
        if (map && !map.getBounds().pad(-0.1).contains([lat, lon])) {
          // Bring both the vehicle and the person into view.
          setFollowVehicle(false);
          followVehicleRef.current = false;
          const v = useTelemetryStore.getState().position;
          const pts: [number, number][] = [[lat, lon]];
          if (v.lat !== 0 || v.lon !== 0) pts.push([v.lat, v.lon]);
          map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 17), animate: false });
        }
        openFlyToPrompt(lat, lon, accuracy);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked for this site. Allow it in the browser to use Fly to me.'
            : err.code === err.TIMEOUT
              ? 'Timed out finding your location.'
              : 'Your location is not available.'
        );
        setTimeout(() => setLocateError(null), 6000);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  // Initialize Leaflet map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const hasFix = position.lat !== 0 || position.lon !== 0;
    // Following: centre on the vehicle. Otherwise back where the user left the map.
    const [initialLat, initialLon] =
      savedMapView && !(savedMapView.follow && hasFix)
        ? savedMapView.center
        : [hasFix ? position.lat : 39.8283457, hasFix ? position.lon : -98.5794797];
    const following = savedMapView?.follow ?? true;

    mapContainerRef.current.classList.add('gs-map');
    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLon],
      zoom: initialZoom(),
      maxZoom: 22,
      zoomControl: false,
      scrollWheelZoom: following ? 'center' : true,
      touchZoom: following ? 'center' : true,
    });

    const saveView = () => {
      const c = map.getCenter();
      savedMapView = { zoom: map.getZoom(), center: [c.lat, c.lng], follow: followVehicleRef.current, layer: mapLayerRef.current };
    };
    map.on('moveend', saveView);
    map.on('zoomend', () => {
      try {
        localStorage.setItem(ZOOM_KEY, String(map.getZoom()));
      } catch {}
    });

    const tileLayer = createTileLayer(mapLayerRef.current);
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
      isFlyingToRef.current = false;
      setFollowVehicle(false);
      followVehicleRef.current = false;
    });
    map.on('dragend', () => {
      isInteractingRef.current = false;
    });
    map.on('zoomstart', () => {
      isInteractingRef.current = true;
      isFlyingToRef.current = false;
    });
    map.on('zoomend', () => {
      isInteractingRef.current = false;
    });

    // Right-click (or long-press on mobile) opens Guided Fly-To-Here prompt
    map.on('contextmenu', (e: L.LeafletMouseEvent) => {
      openFlyToPrompt(e.latlng.lat, e.latlng.lng);
    });

    // Left-click picks the point while the Fly To button is armed
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (flyToModeRef.current) {
        openFlyToPrompt(e.latlng.lat, e.latlng.lng);
      }
    });

    // Vehicle Marker with custom rotating SVG (scoped to marker element without CSS transition delay)
    const vehicleIcon = L.divIcon({
      className: 'vehicle-marker-icon',
      html: `
        <div class="vehicle-icon-rotator" style="transform: rotate(${yawRef.current}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
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

    // Trail polyline: dark magenta, so it reads against satellite imagery and stays distinct from the
    // bright magenta / yellow mission lines.
    const trailPoly = L.polyline(flightTrace, {
      color: '#8c0073',
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
      saveView();
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

  // Buffer incoming GPS fixes for linear interpolation
  useEffect(() => {
    if (position.lat === 0 && position.lon === 0) return;

    const now = performance.now();
    const fix: GpsFix = {
      t: now,
      timeBootMs: position.timeBootMs,
      lat: position.lat,
      lon: position.lon,
      yaw: yawRef.current,
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
        yaw: yawRef.current,
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
          // panTo onto the current view never fires moveend; release the lock after the 0.4 s pan has had time.
          const safetyTimer = setTimeout(() => {
            isFlyingToRef.current = false;
          }, 800);
          map.once('moveend', () => {
            clearTimeout(safetyTimer);
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
        <div class="vehicle-icon-rotator" style="transform: rotate(${yawRef.current}deg); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.8));">
          ${renderVehicleSvg(heartbeat.type)}
        </div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    vehicleMarkerRef.current.setIcon(vehicleIcon);
    vehicleMarkerRef.current.setZIndexOffset(10000);
  }, [heartbeat.type]);

  // Hide vehicle marker when no valid GPS position has been received, and dim on link loss
  useEffect(() => {
    if (!vehicleMarkerRef.current) return;
    if (!hasValidPosition) {
      vehicleMarkerRef.current.setOpacity(0);
    } else if (!connected) {
      vehicleMarkerRef.current.setOpacity(0.45);
    } else {
      vehicleMarkerRef.current.setOpacity(1);
    }
  }, [hasValidPosition, connected]);

  // Render standalone Home ('H') marker when homePosition is known and not already rendered by mission WP #0
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (homeMarkerRef.current) {
      homeMarkerRef.current.remove();
      homeMarkerRef.current = null;
    }

    const hasMissionHome = missionWaypoints.some((w) => w.seq === 0 && (w.lat !== 0 || w.lon !== 0));
    if (hasMissionHome || homePosition.source === 'none' || (homePosition.lat === 0 && homePosition.lon === 0)) {
      return;
    }

    const homeIcon = L.divIcon({
      className: 'home-standalone-marker',
      html: `
        <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.85)); width: 26px; height: 36px; display: flex; align-items: center; justify-content: center;">
          <svg width="26" height="36" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="#15803d" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
            <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
            <text x="13" y="15" font-size="10.5" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="#14532d">H</text>
          </svg>
        </div>
      `,
      iconSize: [26, 36],
      iconAnchor: [13, 35],
      popupAnchor: [0, -33],
    });

    const m = L.marker([homePosition.lat, homePosition.lon], {
      icon: homeIcon,
      pane: 'missionMarkersPane',
      zIndexOffset: 220,
    })
      .bindPopup(homePopupHtml(useTelemetryStore.getState().homePosition))
      .addTo(mapInstanceRef.current);

    homeMarkerRef.current = m;
    // Distance and bearing change with every position update: only the popup text follows them (below), the
    // marker isn't rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homePosition.lat, homePosition.lon, homePosition.source, missionWaypoints]);

  useEffect(() => {
    homeMarkerRef.current?.setPopupContent(homePopupHtml(homePosition));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homePosition.distanceM, homePosition.bearingDeg, homePosition.alt, formatHomeVector]);

  // While a point is picked, track it on screen and mark it on the map.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !pendingFlyTo) {
      setFlyToAnchor(null);
      return;
    }
    const update = () => {
      const pt = map.latLngToContainerPoint([pendingFlyTo.lat, pendingFlyTo.lon]);
      const size = map.getSize();
      setFlyToAnchor({ x: pt.x, y: pt.y, width: size.x, height: size.y });
    };
    update();
    map.on('move zoom resize', update);
    const ghost = L.marker([pendingFlyTo.lat, pendingFlyTo.lon], {
      icon: L.divIcon({ className: 'flyto-target-marker', html: flyToTargetSvg(0.55), iconSize: [28, 28], iconAnchor: [14, 14] }),
      pane: 'missionMarkersPane',
      zIndexOffset: 310,
      interactive: false,
    }).addTo(map);
    const extras: L.Layer[] = [];
    if (pendingFlyTo.accuracyM !== undefined) {
      extras.push(
        L.circle([pendingFlyTo.lat, pendingFlyTo.lon], {
          radius: pendingFlyTo.accuracyM,
          color: '#60a5fa',
          weight: 1,
          fillOpacity: 0.12,
          interactive: false,
          pane: 'missionLinesPane',
        }).addTo(map),
        L.circleMarker([pendingFlyTo.lat, pendingFlyTo.lon], {
          radius: 6,
          color: '#ffffff',
          weight: 2,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          interactive: false,
          pane: 'missionMarkersPane',
        }).addTo(map)
      );
    }
    return () => {
      map.off('move zoom resize', update);
      ghost.remove();
      extras.forEach((l) => l.remove());
    };
  }, [pendingFlyTo]);

  // A sent target is shown only while the vehicle is going there: it is dropped on arrival, when the vehicle
  // leaves GUIDED or disarms, and if GUIDED never takes hold after the send.
  const flyToStartRef = useRef<{ wasGuided: boolean; wasArmed: boolean } | null>(null);
  useEffect(() => {
    if (!activeFlyToTarget) {
      flyToStartRef.current = null;
      return;
    }
    const hb = useTelemetryStore.getState().heartbeat;
    flyToStartRef.current = { wasGuided: hb.modeName === 'GUIDED', wasArmed: hb.isArmed };
    // The send may itself have asked for GUIDED; give the mode change a moment, then give up on it.
    const t = setTimeout(() => {
      const mode = useTelemetryStore.getState().heartbeat.modeName;
      if (mode !== 'GUIDED' && mode !== 'DISCONNECTED') setActiveFlyToTarget(null);
    }, 3000);
    return () => clearTimeout(t);
  }, [activeFlyToTarget]);

  useEffect(() => {
    const start = flyToStartRef.current;
    // A dropped link says nothing about what the vehicle is doing; keep the target until it is heard again.
    if (!activeFlyToTarget || !start || heartbeat.modeName === 'DISCONNECTED') return;
    if (heartbeat.modeName === 'GUIDED') start.wasGuided = true;
    if (heartbeat.isArmed) start.wasArmed = true;
    const leftGuided = start.wasGuided && heartbeat.modeName !== 'GUIDED';
    const disarmed = start.wasArmed && !heartbeat.isArmed;
    if (leftGuided || disarmed) setActiveFlyToTarget(null);
  }, [activeFlyToTarget, heartbeat.modeName, heartbeat.isArmed]);

  useEffect(() => {
    if (!activeFlyToTarget || (position.lat === 0 && position.lon === 0)) return;
    const { distanceM } = computeDistanceAndBearing(position.lat, position.lon, activeFlyToTarget.lat, activeFlyToTarget.lon);
    // A little over the usual 2 m waypoint radius, so a vehicle holding just outside it still counts as there.
    if (distanceM < FLY_TO_ARRIVAL_M) setActiveFlyToTarget(null);
  }, [activeFlyToTarget, position.lat, position.lon]);

  // Render active Fly-To target marker (only re-creates when target changes)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    if (flyToMarkerRef.current) {
      flyToMarkerRef.current.remove();
      flyToMarkerRef.current = null;
    }

    if (!activeFlyToTarget) return;

    const targetIcon = L.divIcon({
      className: 'flyto-target-marker',
      html: flyToTargetSvg(1),
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    const m = L.marker([activeFlyToTarget.lat, activeFlyToTarget.lon], {
      icon: targetIcon,
      pane: 'missionMarkersPane',
      zIndexOffset: 300,
    })
      .bindPopup(
        `<b>Guided Fly-To Target</b><br/>Alt: ${activeFlyToTarget.alt}m<br/>Lat: ${activeFlyToTarget.lat.toFixed(
          6
        )}<br/>Lon: ${activeFlyToTarget.lon.toFixed(6)}`
      )
      .addTo(mapInstanceRef.current);
    flyToMarkerRef.current = m;

    return () => {
      if (flyToMarkerRef.current) {
        flyToMarkerRef.current.remove();
        flyToMarkerRef.current = null;
      }
    };
  }, [activeFlyToTarget]);

  // Update dashed vector line connecting vehicle to target (efficient setLatLngs without recreation)
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (!activeFlyToTarget || (position.lat === 0 && position.lon === 0)) {
      if (flyToLineRef.current) {
        flyToLineRef.current.remove();
        flyToLineRef.current = null;
      }
      return;
    }

    const latLngs: [number, number][] = [
      [position.lat, position.lon],
      [activeFlyToTarget.lat, activeFlyToTarget.lon],
    ];

    if (flyToLineRef.current) {
      flyToLineRef.current.setLatLngs(latLngs);
    } else {
      flyToLineRef.current = L.polyline(latLngs, {
        color: '#38bdf8',
        weight: 2.5,
        dashArray: '6, 6',
        opacity: 0.9,
        pane: 'missionLinesPane',
      }).addTo(mapInstanceRef.current);
    }
  }, [activeFlyToTarget, position.lat, position.lon]);

  const cancelFlyTo = useCallback(() => setPendingFlyTo(null), []);

  const handleConfirmFlyTo = () => {
    if (!pendingFlyTo) return;
    const alt = Math.max(2, Number(flyToAltInput) || 20);
    const { lat, lon } = pendingFlyTo;
    const encoder = mavlinkConnection.getEncoder();
    const sysId = heartbeat.systemId || 1;
    const compId = heartbeat.componentId || 1;

    // DO_REPOSITION asks for the change to GUIDED itself (param2 bit 0); set the mode too, for firmware that ignores it.
    if (heartbeat.modeName !== 'GUIDED') {
      const guidedNum = getGuidedModeNum(heartbeat.type);
      const modeCmd = encoder.createSetMode(sysId, compId, guidedNum);
      sendTrackedCommand(modeCmd, { label: 'Mode GUIDED', targetKey: 'mode:GUIDED' });
    }

    setPendingFlyTo(null);
    // No link, no command: show nothing (the command feedback reports it as not sent).
    if (mavlinkConnection.getStatus() !== 'connected') {
      sendTrackedCommand(encoder.createDoReposition(sysId, compId, lat, lon, alt), { label: 'Fly To', targetKey: 'action:reposition' });
      return;
    }

    const repoCmd = encoder.createDoReposition(sysId, compId, lat, lon, alt);
    sendTrackedCommand(repoCmd, {
      label: `Fly To (${lat.toFixed(4)}, ${lon.toFixed(4)}) @ ${alt}m`,
      targetKey: 'action:reposition',
    }).then((ack) => {
      // Drop the target only when the vehicle refused it. A timeout keeps it (over a lossy link the ACK can go
      // missing while the vehicle is on its way), and so does NOT_SENT here: the command left, and the link
      // dropped before the answer, which says nothing about where the vehicle is going. The mode and arming
      // checks clear it once the vehicle is heard again.
      const refused = ack.result > 0 && ack.result !== 5; // not ACCEPTED (0) or IN_PROGRESS (5)
      if (refused) setActiveFlyToTarget((t) => (t && t.lat === lat && t.lon === lon ? null : t));
    });
    setActiveFlyToTarget({ lat, lon, alt });
  };

  // Update mission waypoints rendering
  useEffect(() => {
    if (!mapInstanceRef.current || !missionPolylineRef.current) return;

    // Clear old mission markers
    missionMarkersRef.current.forEach((m) => m.remove());
    missionMarkersRef.current = [];

    // Filter valid waypoints
    const validWps = missionWaypoints.filter((w) => cmdHasLocation(w.command) && (w.lat !== 0 || w.lon !== 0) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180);
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
    const defaultCenterLat = homeWp?.lat || position.lat || 39.8283457;
    const defaultCenterLon = homeWp?.lon || position.lon || -98.5794797;

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

  // Update RTK base station marker rendering - blue needle pin with bold "B"
  useEffect(() => {
    if (!mapInstanceRef.current) return;

    if (baseMarkerRef.current) {
      baseMarkerRef.current.remove();
      baseMarkerRef.current = null;
    }

    if (!baseStationPosition || (baseStationPosition.lat === 0 && baseStationPosition.lon === 0)) {
      return;
    }

    const baseIcon = L.divIcon({
      className: 'base-station-marker',
      html: `
        <div style="filter: drop-shadow(0 3px 6px rgba(0,0,0,0.85)); width: 26px; height: 36px; display: flex; align-items: center; justify-content: center;">
          <svg width="26" height="36" viewBox="0 0 26 36" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Sharply Tapered Needle Pin Shape pointing directly downward at bottom tip -->
            <path d="M 13 35 L 4.2 14.5 A 9.5 9.5 0 1 1 21.8 14.5 Z" fill="#2563eb" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>
            <!-- High-contrast White Inner Badge -->
            <circle cx="13" cy="11.5" r="7.5" fill="#ffffff" />
            <!-- Base Station Label 'B' -->
            <text x="13" y="15" font-size="10.5" font-weight="900" font-family="ui-monospace, monospace, sans-serif" text-anchor="middle" fill="#1d4ed8">B</text>
          </svg>
        </div>
      `,
      iconSize: [26, 36],
      iconAnchor: [13, 35],
      popupAnchor: [0, -33],
    });

    const marker = L.marker([baseStationPosition.lat, baseStationPosition.lon], {
      icon: baseIcon,
      pane: 'missionMarkersPane',
      zIndexOffset: 150,
    })
      .bindPopup(
        `<b>RTK Base Station (ARP)</b><br/>Lat: ${baseStationPosition.lat.toFixed(6)}<br/>Lon: ${baseStationPosition.lon.toFixed(
          6
        )}${baseStationPosition.alt !== undefined ? `<br/>Alt: ${baseStationPosition.alt.toFixed(1)}m` : ''}`
      )
      .addTo(mapInstanceRef.current);

    baseMarkerRef.current = marker;

    return () => {
      if (baseMarkerRef.current) {
        baseMarkerRef.current.remove();
        baseMarkerRef.current = null;
      }
    };
  }, [baseStationPosition]);

  const aspectClass = isFullWidth
    ? (aspectRatio === '1:1'
        ? 'aspect-square min-h-[440px] max-h-[85vh]'
        : aspectRatio === '4:3'
        ? 'aspect-[16/9] md:aspect-[4/3] min-h-[440px] max-h-[82vh]'
        : 'aspect-[16/9] min-h-[440px] max-h-[82vh]')
    : 'h-full min-h-[350px] lg:min-h-[480px]';

  return (
    <Card className={`border-zinc-800 bg-zinc-950/90 shadow-lg overflow-hidden flex flex-col w-full ${aspectClass}`}>
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div ref={headerRef} className="flex items-center justify-between gap-1.5 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 shrink-0">
              <MapIcon className="h-3.5 w-3.5 text-sky-400 shrink-0" />
              Map
            </CardTitle>
            {missionStatus.isFetching && (
              <Badge
                variant={missionStatus.method === 'ftp' ? 'info' : 'secondary'}
                className="text-[9px] font-mono px-1.5 py-0.5 shrink-0 flex items-center gap-1"
              >
                <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                {missionStatus.method === 'ftp' ? 'MAVFTP' : 'STREAM'}
              </Badge>
            )}
            {!hideBadges && (
              <div className="flex items-center gap-1.5 min-w-0">
                {userWpCount > 0 && (
                  <Badge variant="warning" className="text-[10px] font-mono px-1.5 py-0.5 shrink-0">
                    {userWpCount} {userWpCount === 1 ? 'WP' : 'WPs'}
                  </Badge>
                )}
                {fencePoints.length > 0 && (
                  <Badge variant="destructive" className="text-[10px] font-mono px-1.5 py-0.5 gap-1 shrink-0">
                    <Shield className="h-2.5 w-2.5 inline" /> {fencePoints.length} Fence
                  </Badge>
                )}
                {rallyPoints.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0.5 gap-1 text-[#f0abfc] border-[#9a337d]/40 bg-[#9a337d]/15 shrink-0">
                    <Flag className="h-2.5 w-2.5 inline text-[#f0abfc]" /> {rallyPoints.length} Rally
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div ref={rightControlsRef} className="flex items-center gap-1 sm:gap-1.5 ml-auto shrink-0">
            <Button
              variant={flyToMode ? 'default' : 'outline'}
              size="sm"
              disabled={!connected}
              onClick={() => setFlyToMode((v) => !v)}
              aria-pressed={flyToMode}
              className={`h-7 w-7 p-0 ${flyToMode ? 'bg-sky-500 text-white ring-2 ring-sky-300' : 'text-zinc-300 hover:text-white disabled:opacity-40'}`}
              title={
                connected
                  ? flyToMode
                    ? 'Pick a point on the map (Esc to cancel)'
                    : 'Fly to a point: click here, then the map. Right-click or long-press the map works too.'
                  : 'Connect to a vehicle to use Fly To'
              }
            >
              <Navigation className={`h-3.5 w-3.5 ${flyToMode ? '' : 'text-sky-300'}`} />
            </Button>

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
                  const safetyTimer = setTimeout(() => {
                    isFlyingToRef.current = false;
                  }, 800);
                  mapInstanceRef.current.once('moveend', () => {
                    clearTimeout(safetyTimer);
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

            <MapViewMenu
              layer={mapLayer}
              onLayer={setMapLayer}
              aspect={isFullWidth ? aspectRatio : undefined}
              onAspect={isFullWidth ? handleAspectChange : undefined}
              onFit={handleFitBounds}
              tracePoints={flightTrace.length}
              onClearTrace={clearTrace}
            />

            <MissionMenu
              connected={connected}
              isFetching={missionStatus.isFetching}
              isUploading={Boolean(missionStatus.isUploading)}
              onFetch={handleFetchMission}
              onCancelFetch={() => missionManager.cancelFetch()}
              onOpenFile={loadMissionFile}
            />
          </div>
        </div>
      </CardHeader>

      {/* Progress / Status banner */}
      {(missionStatus.message || uploadError) && (
        <div className="bg-zinc-900/90 border-b border-zinc-800 px-3 sm:px-4 py-1 text-[11px] font-mono flex items-center justify-between min-w-0 gap-2">
          <span
            className={`truncate min-w-0 ${
              uploadError
                ? 'text-red-400 font-medium'
                : missionStatus.isFetching || missionStatus.isUploading
                ? 'text-amber-400 animate-pulse font-medium'
                : 'text-emerald-400'
            }`}
            title={uploadError || missionStatus.message}
          >
            {uploadError || missionStatus.message}
          </span>
          {!uploadError && (missionStatus.isFetching || missionStatus.isUploading) && missionStatus.method === 'ftp' && (
            <span className="text-[10px] text-sky-400 font-bold shrink-0 ml-2">MAVFTP</span>
          )}
          {!uploadError && (missionStatus.isFetching || missionStatus.isUploading) && missionStatus.method === 'legacy' && (
            <span className="text-[10px] text-purple-400 font-bold shrink-0 ml-2">ITEM-BY-ITEM</span>
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
        <div className="absolute top-2 left-2 z-[400] bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 rounded-lg px-2.5 py-1 text-[11px] sm:text-xs font-mono text-zinc-300 flex flex-wrap items-center gap-2.5 pointer-events-none shadow-md">
          <span>
            Lat: <b className="text-sky-400">{hasValidPosition ? position.lat.toFixed(6) : '--'}</b>
          </span>
          <span>
            Lon: <b className="text-sky-400">{hasValidPosition ? position.lon.toFixed(6) : '--'}</b>
          </span>
          <span>
            Alt:{' '}
            <b className="text-emerald-400">
              {hasValidPosition
                ? `${formatAltitude(altitudeMode === 'msl' ? (position.alt || position.relativeAlt) : position.relativeAlt).full} ${altitudeMode.toUpperCase()}`
                : '--'}
            </b>
          </span>
          {hasValidPosition && homePosition.distanceM !== null && (
            <span className="text-emerald-300 flex items-center gap-1 border-l border-zinc-800 pl-2">
              <Home className="h-3 w-3 text-emerald-400 inline" />
              <b>{formatHomeVector(homePosition.bearingDeg, homePosition.distanceM)}</b>
            </span>
          )}
        </div>

        {/* Fly-To prompt (mission progress moved to the footer below the map) */}
        {connected && (flyToMode || locating || locateError) && !pendingFlyTo && (
          <div className="absolute bottom-2 left-2 right-2 sm:right-auto z-[400] bg-zinc-950/85 backdrop-blur-md border border-zinc-800/80 rounded-lg px-2.5 py-1 text-[11px] font-mono shadow-md flex items-center gap-2 flex-wrap">
            {locateError ? (
              <span className="text-amber-400">{locateError}</span>
            ) : locating ? (
              <span className="text-sky-300 animate-pulse">Finding your location…</span>
            ) : (
              <>
                <span>
                  <span className="text-sky-300 font-bold">Pick a point to fly to</span>
                  <span className="text-zinc-500"> · Esc to cancel</span>
                </span>
                {canLocate && (
                  <button
                    type="button"
                    onClick={handleFlyToMe}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 font-sans font-bold text-blue-300 hover:bg-blue-500/20"
                    title="Send the vehicle to where this device is (the browser asks for your location)"
                  >
                    <LocateFixed className="h-3 w-3" /> Fly to me
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {pendingFlyTo && flyToAnchor && (
          <FlyToPopover
            lat={pendingFlyTo.lat}
            lon={pendingFlyTo.lon}
            anchor={flyToAnchor}
            bounds={flyToAnchor}
            altInput={flyToAltInput}
            onAltInput={setFlyToAltInput}
            modeName={heartbeat.modeName}
            armed={heartbeat.isArmed}
            accuracyM={pendingFlyTo.accuracyM}
            onSend={handleConfirmFlyTo}
            onCancel={cancelFlyTo}
          />
        )}
      </CardContent>

      <MapMissionFooter />

      {/* Confirmation Modal with Armed/Auto Warning and Summary */}
      {pendingUpload && (
        <Modal
          isOpen={true}
          onClose={handleCancelUpload}
          title={`Confirm Upload: ${pendingUpload.filename}`}
          description="Review flight plan items and vehicle status before replacing vehicle memory."
        >
          <div className="space-y-4">
            {/* Explicit Armed / AUTO Flight Warning */}
            {(heartbeat.isArmed || heartbeat.modeName === 'AUTO') && (
              <div className="p-3 rounded-lg bg-red-950/80 border border-red-500/70 text-red-200 text-xs flex items-start gap-2.5 shadow-md">
                <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <b className="text-red-300 font-bold block mb-1">
                    ACTIVE FLIGHT WARNING: VEHICLE IS {heartbeat.isArmed ? 'ARMED' : ''}{heartbeat.isArmed && heartbeat.modeName === 'AUTO' ? ' AND IN ' : ''}{heartbeat.modeName === 'AUTO' ? 'AUTO MODE' : ''}!
                  </b>
                  Uploading will immediately overwrite the active flight plan or geofence in mid-air. Ensure you intend to replace the active mission now.
                </div>
              </div>
            )}

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="text-zinc-400">File Type:</span>
                <Badge variant="outline" className="font-mono uppercase text-sky-400 border-sky-500/30">
                  {pendingUpload.parsed.type}
                </Badge>
              </div>

              {pendingUpload.parsed.sections && pendingUpload.parsed.sections.length > 1 ? (
                <div className="space-y-1.5 pt-1 border-t border-zinc-800/60">
                  <span className="text-zinc-400 block font-medium">Plan Sections:</span>
                  {pendingUpload.parsed.sections.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between pl-2 text-zinc-300">
                      <span className="capitalize">{s.type}:</span>
                      <span className="font-mono text-zinc-400">{s.items.length} items</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between text-zinc-300">
                  <span className="text-zinc-400">Total Items:</span>
                  <span className="font-mono font-bold text-zinc-100">{pendingUpload.parsed.items.length}</span>
                </div>
              )}

              <p className="text-[11px] text-zinc-500 pt-1">
                Preview route and boundaries are highlighted with dashed lines on the map.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button variant="outline" size="sm" onClick={handleCancelUpload}>
                Cancel
              </Button>
              <Button
                variant={heartbeat.isArmed ? 'destructive' : 'default'}
                size="sm"
                className="font-bold"
                onClick={handleConfirmUpload}
              >
                Confirm & Upload
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
};