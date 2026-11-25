// Mission summary (distance, time, height, reach) and the route-vs-fence check.
import { missionSummary, vehicleSpeeds } from '../src/mavlink/missionSummary.ts';
import { routeFenceIssues } from '../src/mavlink/routeFence.ts';
import type { FenceDraft } from '../src/mavlink/fenceDraft.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const L0 = 35, O0 = -106;
const north = (m: number) => L0 + m / 111195; // 1 m of latitude on the mean sphere
const east = (m: number) => O0 + m / (111195 * Math.cos((L0 * Math.PI) / 180));
const it = (command: number, x = 0, y = 0, z = 0, p1 = 0, p2 = 0, p3 = 0) => ({ command, x, y, z, param1: p1, param2: p2, param3: p3, frame: 3 });
const none = () => undefined;
const params = (p: Record<string, number>) => (n: string) => p[n];
const HOME = it(16, L0, O0, 0);

// Copter: takeoff to 20 m, 1000 m north at 10 m/s, land.
let items = [HOME, it(22, 0, 0, 20), it(16, north(1000), O0, 20), it(21, 0, 0, 0)];
let s = missionSummary(items, 'copter', none);
check('copter: 1 km route', near(s.distanceM, 1000, 1), s.distanceM.toFixed(1));
// 20/2.5 = 8 s climb + 100 s + land: 10 m at 1.5 m/s (6.7 s) + 10 m at 0.5 m/s (20 s) = 134.7 s
// + speeding up and slowing down once (10 m/s / 2.5 m/s² = 4 s) for the one run before landing
check('copter: time = climb + leg at WP_SPD + one stop + landing', near(s.timeS, 8 + 100 + 4 + 10 / 1.5 + 20, 0.5), s.timeS.toFixed(1));
check('copter: max altitude, farthest from home', s.maxAltM === 20 && near(s.farthestM, 1000, 1), `${s.maxAltM} ${s.farthestM.toFixed(0)}`);
check('copter speeds: master WP_SPD (m/s) over 4.6 WPNAV_SPEED (cm/s)', vehicleSpeeds('copter', params({ WP_SPD: 5, WPNAV_SPEED: 1500 })).horizontal === 5 && vehicleSpeeds('copter', params({ WPNAV_SPEED: 1500 })).horizontal === 15);
check('copter climb/descent from WPNAV_SPEED_UP/DN (cm/s) on 4.6', vehicleSpeeds('copter', params({ WPNAV_SPEED_UP: 300, WPNAV_SPEED_DN: 200 })).up === 3 && vehicleSpeeds('copter', params({ WPNAV_SPEED_UP: 300, WPNAV_SPEED_DN: 200 })).down === 2);

// Hold, a speed change, and a finite jump.
items = [HOME, it(22, 0, 0, 20), it(16, north(500), O0, 20, 30), it(178, 0, 0, 0, 1, 5), it(16, north(1000), O0, 20), it(177, 0, 0, 0, 2, 1), it(20)];
s = missionSummary(items, 'copter', none);
// legs: 0->2 500 m @10 (50 s) +30 hold; speed 5; 2->4 500 m @5 (100 s); jump to 2 once: 4->2 500 m (100) + 30 hold; 2->4 (100); RTL 1000 m @5 (200) + land 26.7
// stops: the first hold at 10 m/s (4 s), the second at 5 m/s (2 s), before and after RTL (2 + 2 s), RTL's 5 s wait
check('copter: hold, DO_CHANGE_SPEED and one jump repeat counted', s.jumps && near(s.distanceM, 500 * 4 + 1000, 2) && near(s.timeS, 8 + 50 + 30 + 100 + 100 + 30 + 100 + 200 + 10 / 1.5 + 20 + 4 + 2 + 2 + 2 + 5, 1), `${s.distanceM.toFixed(0)} m, ${s.timeS.toFixed(1)} s`);
check('copter accel: WP_ACC (m/s²), else WPNAV_ACCEL (cm/s²); RTL_LOIT_TIME in ms', vehicleSpeeds('copter', params({ WPNAV_ACCEL: 500 })).accel === 5 && vehicleSpeeds('copter', params({ RTL_LOIT_TIME: 0 })).rtlLoiterS === 0);
items = [HOME, it(16, north(300), O0, 20), it(177, 0, 0, 0, 1, -1)];
check('endless jump: open-ended', /forever/.test(missionSummary(items, 'copter', none).openEnded ?? ''));
items = [HOME, it(16, north(300), O0, 20), it(17, north(600), O0, 20)];
check('unlimited loiter: open-ended', /until switched/.test(missionSummary(items, 'copter', none).openEnded ?? ''));

// Plane: 2 km at AIRSPEED_CRUISE 20 with a 3-turn loiter of 100 m.
items = [HOME, it(22, 0, 0, 50, 15), it(16, north(2000), O0, 50, 30), it(18, north(2000), east(500), 50, 3, 0, 100)];
s = missionSummary(items, 'plane', params({ AIRSPEED_CRUISE: 20 }));
// takeoff climb 50/5 = 10 s; 2000/20 = 100 s (param1 30 isn't a hold on Plane); 500/20 = 25; loiter 3*2π*100/20 = 94.2
check('plane: cruise, no hold from param1, loiter turns', near(s.timeS, 10 + 100 + 25 + (3 * 2 * Math.PI * 100) / 20, 0.5), s.timeS.toFixed(1));
check('plane: AIRSPEED_CRUISE, else TRIM_ARSPD_CM (cm/s)', vehicleSpeeds('plane', params({ TRIM_ARSPD_CM: 1800 })).horizontal === 18);
check('rover: WP_SPEED, else CRUISE_SPEED', vehicleSpeeds('rover', params({ CRUISE_SPEED: 3 })).horizontal === 3 && vehicleSpeeds('rover', params({ WP_SPEED: 4, CRUISE_SPEED: 3 })).horizontal === 4);
// A spline leg's drawn length is used, not the straight line.
items = [HOME, it(82, north(1000), O0, 20)];
s = missionSummary(items, 'copter', none, [{ from: 0, to: 1, spline: true, latLngs: [[L0, O0], [north(500), east(200)], [north(1000), O0]] }]);
check('the route as drawn (a curved leg is longer)', s.distanceM > 1070, s.distanceM.toFixed(0));

// Route vs fence: an inclusion square 600 m on a side around home, an exclusion circle on the way north.
const sq = (h: number) => [{ lat: north(-h), lon: east(-h) }, { lat: north(h), lon: east(-h) }, { lat: north(h), lon: east(h) }, { lat: north(-h), lon: east(h) }];
const fence: FenceDraft = { shapes: [{ kind: 'polygon', inclusion: true, vertices: sq(300) }, { kind: 'circle', inclusion: false, center: { lat: north(150), lon: O0 }, radius: 30 }], returnPoint: null };
const route = [it(16, L0, O0, 0), it(16, north(200), O0, 20), it(16, north(500), O0, 200)];
const legs = [
  { from: 0, to: 1, spline: false, latLngs: [[L0, O0], [north(200), O0]] as [number, number][] },
  { from: 1, to: 2, spline: false, latLngs: [[north(200), O0], [north(500), O0]] as [number, number][] },
];
let iss = routeFenceIssues(legs, route, fence, { home: { lat: L0, lon: O0 }, types: 7, altMax: 100, circleRadius: 400 });
const msg = (i: number) => iss.filter((x) => x.index === i).map((x) => x.message).join(' / ');
check('leg into the exclusion circle: warned at its end item', /inside exclusion circle F2/.test(msg(1)), msg(1));
check('leg leaving the inclusion square: warned', /outside inclusion zone F1/.test(msg(2)), msg(2));
check('beyond the home circle (FENCE_RADIUS 400)', /circle around home/.test(msg(2)), msg(2));
check('above FENCE_ALT_MAX', /maximum altitude/.test(msg(2)) && !/maximum altitude/.test(msg(1)), msg(2));
check('warnings, not errors', iss.every((x) => x.severity === 'warning'));
iss = routeFenceIssues(legs, route, fence, { home: { lat: L0, lon: O0 }, types: 1, altMax: 100 });
check('FENCE_TYPE without polygons: shapes not checked', !iss.some((x) => /inclusion|exclusion/.test(x.message)), JSON.stringify(iss));
iss = routeFenceIssues(legs, route, fence, { home: { lat: L0, lon: O0 }, enabled: false });
check('fencing off: said so', iss.length > 0 && iss.every((x) => /fencing is off/.test(x.message)));
check('no fence: nothing', routeFenceIssues(legs, route, { shapes: [], returnPoint: null }, { home: { lat: L0, lon: O0 } }).length === 0);

console.log(failures.length ? `\n${failures.length} summary check(s) FAILED` : '\nAll summary checks PASSED');
process.exit(failures.length ? 1 : 0);
