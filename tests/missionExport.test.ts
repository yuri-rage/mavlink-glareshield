// KML and Mission Planner .poly exports (src/mavlink/missionExport.ts).
export {};
const { toKml, toMpPoly, circleRing } = await import('../src/mavlink/missionExport.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}

const wp = (seq: number, command: number, lat: number, lon: number, alt: number, frame = 3) => ({
  seq,
  command,
  lat,
  lon,
  alt,
  frame,
  param1: 0,
  param2: 0,
  param3: 0,
  param4: 0,
  current: false,
  autocontinue: 1,
});
const waypoints: any[] = [
  wp(0, 16, 35.0, -106.0, 1600, 0), // home, MSL
  wp(1, 22, 35.0005, -106.0005, 40), // takeoff: its position is ignored by the vehicle
  wp(2, 16, 35.001, -106.0, 50), // relative to home
  wp(3, 178, 0, 0, 0, 2), // DO_CHANGE_SPEED: no position
  wp(4, 16, 35.002, -106.001, 30, 10), // above terrain
  wp(5, 21, 35.0, -106.002, 0),
];
const fencePoints: any[] = [
  ...[
    [35.01, -106.01],
    [35.01, -105.99],
    [34.99, -105.99],
    [34.99, -106.01],
  ].map(([lat, lon], i) => ({ seq: i, command: 5001, lat, lon, param1: 4 })),
  { seq: 4, command: 5004, lat: 35.0, lon: -106.0, param1: 50 },
];
const rallyPoints: any[] = [{ seq: 0, lat: 35.003, lon: -106.003, alt: 60, frame: 3 }];

const kml = toKml({ waypoints, fencePoints, rallyPoints, name: 'Test <mission>' });
check(
  'KML header and document',
  kml.startsWith('<?xml') && kml.includes('<kml xmlns="http://www.opengis.net/kml/2.2">') && kml.includes('</kml>')
);
check('names escaped', kml.includes('<name>Test &lt;mission&gt;</name>'));
const route = kml.match(/<LineString><altitudeMode>(\w+)<\/altitudeMode><coordinates>([^<]+)<\/coordinates>/);
const routePts = route ? route[2].trim().split(' ') : [];
check(
  'route: home, then the waypoints flown to (not the takeoff, not the speed change), lon,lat,alt',
  routePts.length === 4,
  routePts.join(' ')
);
const flat = toKml({ waypoints: waypoints.filter((w) => w.frame !== 10), fencePoints: [], rallyPoints: [] });
check(
  'route above sea level (home known, nothing above terrain): relative = home MSL + alt',
  /<LineString><altitudeMode>absolute<\/altitudeMode><coordinates>-106,35,1600 -106,35.001,1650 /.test(flat)
);
check(
  'route with a terrain-relative waypoint: above ground, home 0, relative and terrain heights as they are',
  route?.[1] === 'relativeToGround' &&
    routePts[0] === '-106,35,0' &&
    routePts[1] === '-106,35.001,50' &&
    routePts[2] === '-106.001,35.002,30',
  routePts.join(' ')
);
check(
  'a terrain-frame waypoint is above ground',
  /<name>4 WAYPOINT<\/name>[\s\S]*?<altitudeMode>relativeToGround<\/altitudeMode>/.test(kml)
);
check(
  'no pin for the takeoff or the speed change',
  !kml.includes('<name>1 TAKEOFF</name>') && !kml.includes('CHANGE_SPEED</name>')
);
check(
  'fence polygon, closed (first point repeated)',
  /Inclusion polygon 1[\s\S]*?-106.01,35.01,0 [\s\S]*?-106.01,35.01,0/.test(kml)
);
check('fence circle as a polygon', kml.includes('Exclusion circle 1 (50 m)'));
check('rally point at home + 60 m', kml.includes('<name>Rally 1</name>') && kml.includes('-106.003,35.003,1660'));
check('balanced tags', (kml.match(/<Placemark>/g) ?? []).length === (kml.match(/<\/Placemark>/g) ?? []).length);

const noHome = toKml({ waypoints: waypoints.filter((w) => w.seq !== 0), fencePoints: [], rallyPoints: [] });
check('without a home: relative altitudes above ground', /<LineString><altitudeMode>relativeToGround/.test(noHome));

const ring = circleRing(35, -106, 100, 4);
const north = (ring[0][0] - 35) * 111320;
check('circle ring: points at the radius', ring.length === 4 && Math.abs(north - 100) < 1, String(north));

const poly = toMpPoly(waypoints);
const lines = poly.trim().split('\n');
check(
  '.poly: a comment, lat lon per positioned waypoint (no home, takeoff or speed change), closed',
  lines[0].startsWith('#') && lines.length === 5 && lines[1] === '35.001 -106' && lines[4] === lines[1],
  JSON.stringify(lines)
);
check('.poly of no positioned waypoints: empty', toMpPoly([waypoints[0], waypoints[3]]) === '');

console.log(
  failures.length ? `\n${failures.length} mission-export check(s) FAILED` : '\nAll mission-export checks PASSED'
);
process.exit(failures.length ? 1 : 0);
