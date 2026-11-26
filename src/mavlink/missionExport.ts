// Exports for other tools: the mission (route and waypoints), geofence and rally points as KML (Google Earth, QGIS,
// QGroundControl's polygon import), and the waypoints as a Mission Planner polygon (.poly, which its survey tools load).
// Kept free of the connection and the store so it can be tested on its own.

import type { MissionWaypoint } from '../store/telemetryStore';
import { cmdUsesPosition, getMavCmdName } from './messages';
import { groupFenceForPlan, type PlanInput } from './missionFileWriter';

/** MAV_CMD values below this are navigation commands (the route's points). */
const NAV_LAST = 95;
const located = (lat: number, lon: number) =>
  (lat !== 0 || lon !== 0) &&
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180;

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number, d = 7) => Number(n.toFixed(d)).toString();

/** A KML altitude: above sea level when it can be (home known), above ground for terrain frames. */
interface KmlAlt {
  alt: number;
  mode: 'absolute' | 'relativeToGround';
}

/** MAV_FRAME to a KML altitude: MSL as is, relative-to-home on top of home's MSL altitude, terrain as above ground. */
function kmlAlt(alt: number, frame: number | undefined, homeMsl: number | null): KmlAlt {
  const f = frame ?? 3;
  if (f === 0 || f === 5) return { alt, mode: 'absolute' };
  if (f === 10 || f === 11) return { alt, mode: 'relativeToGround' };
  // Relative to home (3, 6) and anything else: absolute when home's altitude is known, else above ground (close
  // enough near home).
  return homeMsl !== null ? { alt: homeMsl + alt, mode: 'absolute' } : { alt, mode: 'relativeToGround' };
}

const coord = (lat: number, lon: number, alt = 0) => `${fmt(lon)},${fmt(lat)},${fmt(alt, 2)}`;

function placemark(name: string, style: string, lat: number, lon: number, a: KmlAlt, description = ''): string {
  return [
    '      <Placemark>',
    `        <name>${xml(name)}</name>`,
    description ? `        <description>${xml(description)}</description>` : '',
    `        <styleUrl>#${style}</styleUrl>`,
    `        <Point><altitudeMode>${a.mode}</altitudeMode><coordinates>${coord(lat, lon, a.alt)}</coordinates></Point>`,
    '      </Placemark>',
  ]
    .filter(Boolean)
    .join('\n');
}

function polygon(name: string, style: string, ring: [number, number][]): string {
  const closed = [...ring, ring[0]];
  return [
    '      <Placemark>',
    `        <name>${xml(name)}</name>`,
    `        <styleUrl>#${style}</styleUrl>`,
    '        <Polygon><altitudeMode>clampToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>',
    `          ${closed.map(([lat, lon]) => coord(lat, lon)).join(' ')}`,
    '        </coordinates></LinearRing></outerBoundaryIs></Polygon>',
    '      </Placemark>',
  ].join('\n');
}

/** A circle as a polygon (KML has none): `n` points on the circle. */
export function circleRing(lat: number, lon: number, radiusM: number, n = 72): [number, number][] {
  const R = 6378137;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    const dLat = ((radiusM * Math.cos(a)) / R) * (180 / Math.PI);
    const dLon = ((radiusM * Math.sin(a)) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
    out.push([lat + dLat, lon + dLon]);
  }
  return out;
}

const cmdLabel = (command: number) => getMavCmdName(command).replace(/^(MAV_CMD_)?(NAV_|DO_)?/, '');

/** The mission, geofence and rally points as one KML document, in folders. */
export function toKml(input: PlanInput & { name?: string }): string {
  const homeItem = input.waypoints.find((w) => w.seq === 0 && located(w.lat, w.lon));
  const home = homeItem ?? (input.home && located(input.home.lat, input.home.lon) ? input.home : null);
  // Home's altitude above sea level: the mission's home item is MSL (frame 0), as is the vehicle's home.
  const homeMsl = home ? home.alt : null;
  const items = [...input.waypoints].sort((a, b) => a.seq - b.seq);

  // The route: home, then every navigation command the vehicle flies to (not a takeoff's ignored position).
  const route = items.filter(
    (w) => w.seq > 0 && w.command < NAV_LAST && cmdUsesPosition(w.command) && located(w.lat, w.lon)
  );
  // A line has one altitude mode. Above sea level when home is known and no point is above terrain; otherwise
  // above ground, with heights relative to home (close to above ground near home) and terrain heights as they are.
  const terrain = (w: MissionWaypoint) => w.frame === 10 || w.frame === 11;
  const lineMode = homeMsl !== null && !route.some(terrain) ? 'absolute' : 'relativeToGround';
  const lineAlt = (w: MissionWaypoint) => {
    if (lineMode === 'absolute') return kmlAlt(w.alt, w.frame, homeMsl).alt;
    if (terrain(w)) return w.alt;
    const msl = w.frame === 0 || w.frame === 5;
    return msl && homeMsl !== null ? w.alt - homeMsl : w.alt;
  };
  const routeCoords = [
    ...(home ? [coord(home.lat, home.lon, lineMode === 'absolute' ? (homeMsl ?? 0) : 0)] : []),
    ...route.map((w) => coord(w.lat, w.lon, lineAlt(w))),
  ];

  const pins = items
    .filter((w) => w.seq > 0 && cmdUsesPosition(w.command) && located(w.lat, w.lon))
    .map((w) =>
      placemark(
        `${w.seq} ${cmdLabel(w.command)}`,
        'wp',
        w.lat,
        w.lon,
        kmlAlt(w.alt, w.frame, homeMsl),
        `${cmdLabel(w.command)}, ${fmt(w.alt, 1)} m (${(w.frame ?? 3) === 0 ? 'above sea level' : (w.frame ?? 3) === 10 ? 'above terrain' : 'above home'})`
      )
    );

  const fence = groupFenceForPlan(input.fencePoints);
  const fenceMarks = [
    ...fence.polygons.map((p, i) =>
      polygon(
        `${p.inclusion ? 'Inclusion' : 'Exclusion'} polygon ${i + 1}`,
        p.inclusion ? 'fenceIn' : 'fenceOut',
        p.polygon
      )
    ),
    ...fence.circles.map((c, i) =>
      polygon(
        `${c.inclusion ? 'Inclusion' : 'Exclusion'} circle ${i + 1} (${fmt(c.circle.radius, 0)} m)`,
        c.inclusion ? 'fenceIn' : 'fenceOut',
        circleRing(c.circle.center[0], c.circle.center[1], c.circle.radius)
      )
    ),
    ...(fence.breachReturn
      ? [
          placemark(
            'Fence return point',
            'fenceIn',
            fence.breachReturn[0],
            fence.breachReturn[1],
            kmlAlt(fence.breachReturn[2], 3, homeMsl)
          ),
        ]
      : []),
  ];

  const rally = input.rallyPoints
    .filter((r) => located(r.lat, r.lon))
    .map((r) => placemark(`Rally ${r.seq + 1}`, 'rally', r.lat, r.lon, kmlAlt(r.alt, r.frame, homeMsl)));

  const folder = (name: string, body: string[]) =>
    body.length ? ['    <Folder>', `      <name>${xml(name)}</name>`, ...body, '    </Folder>'] : [];
  const style = (id: string, color: string, extra = '') =>
    `    <Style id="${id}"><LineStyle><color>${color}</color><width>3</width></LineStyle>${extra}</Style>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '  <Document>',
    `    <name>${xml(input.name ?? 'Mission')}</name>`,
    // KML colours are aabbggrr.
    style('route', 'ff0bbff5'),
    style('wp', 'ff0bbff5', '<IconStyle><color>ff0bbff5</color></IconStyle>'),
    style('fenceIn', 'ff3c3cef', '<PolyStyle><color>333c3cef</color></PolyStyle>'),
    style('fenceOut', 'ff3c3cef', '<PolyStyle><color>993c3cef</color></PolyStyle>'),
    style('rally', 'fffcabf0', '<IconStyle><color>fffcabf0</color></IconStyle>'),
    ...(home ? [placemark('Home', 'wp', home.lat, home.lon, { alt: homeMsl ?? 0, mode: 'absolute' })] : []),
    ...(routeCoords.length >= 2
      ? [
          '    <Placemark>',
          '      <name>Route</name>',
          '      <styleUrl>#route</styleUrl>',
          `      <LineString><altitudeMode>${lineMode}</altitudeMode><coordinates>${routeCoords.join(' ')}</coordinates></LineString>`,
          '    </Placemark>',
        ]
      : []),
    ...folder('Waypoints', pins),
    ...folder('Geofence', fenceMarks),
    ...folder('Rally points', rally),
    '  </Document>',
    '</kml>',
    '',
  ].join('\n');
}

/**
 * The waypoints with a position as a Mission Planner polygon (.poly): a comment line, then "lat lon" per point, the
 * first repeated to close it, as Mission Planner writes them (its survey tools load it). Home is left out.
 */
export function toMpPoly(waypoints: MissionWaypoint[]): string {
  const pts = [...waypoints]
    .sort((a, b) => a.seq - b.seq)
    .filter((w) => w.seq > 0 && cmdUsesPosition(w.command) && located(w.lat, w.lon));
  if (pts.length === 0) return '';
  const lines = pts.map((w) => `${fmt(w.lat)} ${fmt(w.lon)}`);
  return ['#saved by Glareshield', ...lines, lines[0], ''].join('\n');
}

/** How many points a .poly from these waypoints would have (the menu's count). */
export const polyPointCount = (waypoints: MissionWaypoint[]) =>
  waypoints.filter((w) => w.seq > 0 && cmdUsesPosition(w.command) && located(w.lat, w.lon)).length;
