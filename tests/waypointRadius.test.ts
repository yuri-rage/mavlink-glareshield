// Waypoint radii drawn while planning: the item's own radius where the vehicle keeps it, else the vehicle's default.
import { CMD, waypointRadius } from '../src/mavlink/waypointRadius.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const it = (command: number, param2 = 0, param3 = 0) => ({ command, param2, param3 });
const none = () => undefined;
const params = (p: Record<string, number>) => (n: string) => p[n];
const show = (r: ReturnType<typeof waypointRadius>) => (r ? `${r.radiusM} ${r.source} ${r.label}` : 'null');

// Plane
let r = waypointRadius(it(CMD.WAYPOINT, 25), 'plane', none);
check("plane waypoint accept radius: the item's (yellow)", r?.radiusM === 25 && r.source === 'item', show(r));
r = waypointRadius(it(CMD.WAYPOINT, 400), 'plane', none);
check('plane accept radius capped at 255 m (stored in a byte)', r?.radiusM === 255, show(r));
r = waypointRadius(it(CMD.WAYPOINT, 0), 'plane', params({ WP_RADIUS: 70 }));
check(
  'plane waypoint without one: WP_RADIUS (white)',
  r?.radiusM === 70 && r.source === 'default' && /WP_RADIUS/.test(r.label),
  show(r)
);
r = waypointRadius(it(CMD.WAYPOINT, 0), 'plane', none);
check('plane WP_RADIUS not read: firmware default 90 m', r?.radiusM === 90, show(r));
r = waypointRadius(it(CMD.LOITER_UNLIM, 0, -80), 'plane', none);
check('plane loiter radius (negative = CCW): 80 m item', r?.radiusM === 80 && r.source === 'item', show(r));
r = waypointRadius(it(CMD.LOITER_UNLIM, 0, 0), 'plane', params({ WP_LOITER_RAD: -75 }));
check('plane loiter without radius: |WP_LOITER_RAD| default', r?.radiusM === 75 && r.source === 'default', show(r));
r = waypointRadius(it(CMD.LOITER_TIME, 0, 120), 'plane', none);
check(
  'plane loiter time: param3 not stored, WP_LOITER_RAD (60) default',
  r?.radiusM === 60 && r.source === 'default',
  show(r)
);
r = waypointRadius(it(CMD.LOITER_TO_ALT, 150, 0), 'plane', none);
check('plane loiter-to-alt radius is param2', r?.radiusM === 150 && r.source === 'item', show(r));
r = waypointRadius(it(CMD.LOITER_TURNS, 0, 1234), 'plane', none);
check('loiter turns over 255 m stored in tens: 1230', r?.radiusM === 1230, show(r));

// Copter
r = waypointRadius(it(CMD.WAYPOINT, 25), 'copter', params({ WP_RADIUS_M: 1.5 }));
check(
  "copter ignores accept radius: WP_RADIUS_M (white; master's name)",
  r?.radiusM === 1.5 && r.source === 'default' && /WP_RADIUS_M/.test(r.label),
  show(r)
);
r = waypointRadius(it(CMD.WAYPOINT), 'copter', params({ WPNAV_RADIUS: 300 }));
check('older copter: WPNAV_RADIUS in cm', r?.radiusM === 3 && /WPNAV_RADIUS\)/.test(r.label), show(r));
r = waypointRadius(it(CMD.SPLINE_WAYPOINT), 'copter', none);
check('copter spline waypoint: default 2 m', r?.radiusM === 2, show(r));
r = waypointRadius(it(CMD.LOITER_TURNS, 0, 20), 'copter', none);
check('copter circle radius: item', r?.radiusM === 20 && r.source === 'item', show(r));
r = waypointRadius(it(CMD.LOITER_UNLIM, 0, 50), 'copter', none);
check(
  'copter loiter unlimited holds position: waypoint radius, not param3',
  r?.radiusM === 2 && r.source === 'default',
  show(r)
);

// Rover and others
r = waypointRadius(it(CMD.WAYPOINT, 9), 'rover', params({ WP_RADIUS: 1 }));
check('rover: WP_RADIUS', r?.radiusM === 1 && r.source === 'default', show(r));
check('non-waypoint (DO_JUMP): none', waypointRadius(it(177), 'copter', none) === null);
check('vehicle unknown: no default', waypointRadius(it(CMD.WAYPOINT), 'generic', none) === null);

console.log(failures.length ? `\n${failures.length} radius check(s) FAILED` : '\nAll radius checks PASSED');
if (failures.length) process.exit(1);
