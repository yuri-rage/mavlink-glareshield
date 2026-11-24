/**
 * Mission altitude profile over terrain: planned altitudes along the route (relative, MSL and above-terrain items,
 * takeoff and land), the terrain beneath, and the clearance checks, on a synthetic world: flat ground at 1000 m with
 * a 200 m ridge across part of the route.
 *
 * Run: npx tsx tests/missionProfile.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const mp = await import('../src/mavlink/missionProfile.ts');
const { missionPathLegs, routeIndices } = await import('../src/mavlink/missionPath.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number | null, b: number, tol = 0.5) => a !== null && Math.abs(a - b) <= tol;

// About 111 m per 0.001 deg of latitude. The ridge: 35.004 to 35.006.
const terrain = (lat: number, _lon: number) => (lat >= 35.004 && lat <= 35.006 ? 1200 : 1000);
const it = (command: number, lat: number, alt: number, frame = 3, param1 = 0) => ({ command, lat, lon: -106, alt, frame, param1 });
const items = [
  it(16, 35, 1000, 0), // home, MSL 1000
  { ...it(22, 0, 50), lon: 0 }, // takeoff to 50 m (no position)
  it(16, 35.01, 50), // WP2: 50 m above home, 1.1 km north, across the ridge (ridge top is 200 m above home)
  it(16, 35.02, 60, 10), // WP3: 60 m above terrain
  it(16, 35.03, 60, 10), // WP4: 60 m above terrain
  it(21, 35.035, 0), // land
];
const legs = missionPathLegs(items as any, routeIndices(items as any, false), false);
const prof = mp.missionProfile(items as any, legs, terrain, { stepM: 10 });
check('home from the mission\'s home item (MSL)', prof.homeMsl === 1000 && prof.homeFrom === 'mission');
check('marks at the route\'s items, in order, with distances', prof.marks.map((m) => m.item).join() === '0,2,3,4,5' && prof.marks[1].dist > 1100 && prof.marks[1].dist < 1120, prof.marks.map((m) => `${m.item}@${Math.round(m.dist)}`).join(' '));
const first = prof.points[0];
check('the takeoff climb at home starts on the ground, unchecked', near(first.alt, 1000) && first.dist === 0 && !first.checked);
const atRidge = prof.points.find((p) => p.lat >= 35.0045 && p.leg === 0)!;
check('leg from home: at the takeoff altitude (1050), flying level to WP2 at 1050', near(atRidge.alt, 1050) && atRidge.terrain === 1200);
const terr = prof.points.filter((p) => p.leg === 2);
check('leg between two above-terrain waypoints follows the ground: 60 m above it throughout', terr.every((p) => near(p.alt! - p.terrain!, 60)), terr.slice(0, 3).map((p) => p.alt).join());
const mixed = prof.points.filter((p) => p.leg === 1);
// WP2 is 1050 MSL over 1000 m ground (50 m above it); WP3 is 60 m above terrain: the leg follows the ground, its height
// above it going 50 -> 60 (AC_WPNav flies the leg in the destination's frame).
check('leg into an above-terrain waypoint follows the ground (height above it 50 -> 60)', near(mixed[0].alt! - mixed[0].terrain!, 50, 1) && near(mixed[mixed.length - 1].alt! - mixed[mixed.length - 1].terrain!, 60) && mixed.every((p) => p.alt! - p.terrain! >= 49.5 && p.alt! - p.terrain! <= 60.5));
const toLand = prof.points.filter((p) => p.leg === 3);
check('into a land: level at the previous altitude, then an unchecked descent to the ground', near(toLand[toLand.length - 2].alt, 1060) && near(toLand[toLand.length - 1].alt, 1000) && !toLand[toLand.length - 1].checked);

const issues = mp.terrainIssues(prof, legs, 30);
check('one issue: the leg into WP2 goes 150 m below the ridge', issues.length === 1 && issues[0].index === 2 && near(issues[0].minAgl, -150) && /150 m below/.test(issues[0].message), JSON.stringify(issues));
check('the issue says where along the route', issues[0].at > 440 && issues[0].at < 670, String(issues[0].at));
// Raise WP2 above the ridge but within the clearance of it.
const items2 = items.map((x, i) => (i === 2 ? { ...x, alt: 215 } : i === 1 ? { ...x, alt: 215 } : x));
const prof2 = mp.missionProfile(items2 as any, missionPathLegs(items2 as any, routeIndices(items2 as any, false), false), terrain, { stepM: 10 });
const i2 = mp.terrainIssues(prof2, legs, 30);
check('15 m above the ridge with a 30 m clearance: within, warned', i2.length === 1 && near(i2[0].minAgl, 15) && /within 15 m/.test(i2[0].message), JSON.stringify(i2));
check('clearance 10 m: nothing', mp.terrainIssues(prof2, legs, 10).length === 0);

// Without a takeoff the first leg is level with its destination (not climbing from the ground near home).
const noTo = items.filter((_, i) => i !== 1);
const noToLegs = missionPathLegs(noTo as any, routeIndices(noTo as any, false), false);
const p3 = mp.missionProfile(noTo as any, noToLegs, () => 1000, { stepM: 10 });
check('no takeoff: the leg from home is level with WP2, no warning near home', near(p3.points[0].alt, 1050) && mp.terrainIssues(p3, noToLegs, 30).length === 0);

// Home altitude unknown in the mission: the terrain there.
const relHome = [{ ...items[0], frame: 3, alt: 0 }, ...items.slice(1)];
const p4 = mp.missionProfile(relHome as any, legs, terrain, { stepM: 50 });
check('home altitude unknown: taken from the terrain at home', p4.homeMsl === 1000 && p4.homeFrom === 'terrain');
check('terrain unknown: no altitudes, no issues', mp.terrainIssues(mp.missionProfile(relHome as any, legs, () => null), legs, 30).length === 0);

// Offline: home has no position (0, 0). Never look up terrain there; relative altitudes unknown, no false warnings.
{
  const asked: string[] = [];
  const offline = [{ ...items[0], lat: 0, lon: 0, alt: 0 }, ...items.slice(1)];
  const offLegs = missionPathLegs(offline as any, routeIndices(offline as any, false), false);
  const look = (lat: number, lon: number) => (asked.push(`${lat},${lon}`), terrain(lat, lon));
  const po = mp.missionProfile(offline as any, offLegs, look, { stepM: 50 });
  check('home at 0, 0: terrain never looked up there, home unknown', !asked.includes('0,0') && po.homeMsl === null && po.homeFrom === 'unknown');
  check('home at 0, 0: relative legs aren\'t placed, so no false below-terrain warnings', mp.terrainIssues(po, offLegs, 30).every((i) => !/below/.test(i.message) || i.index === 4), JSON.stringify(mp.terrainIssues(po, offLegs, 30)));
}

// Takeoffs: one in a terrain frame without a position climbs over home's terrain; one with a position (Plane) is an
// unchecked climb from the ground.
{
  const terrTo = items.map((x, i) => (i === 1 ? { ...x, frame: 10, alt: 40 } : x));
  const p5 = mp.missionProfile(terrTo as any, legs, terrain, { stepM: 10 });
  check('terrain-frame takeoff without a position: 40 m above home\'s terrain (1040), not looked up at 0, 0', near(p5.points.find((q) => q.leg === 0 && q.checked)!.alt, 1040));
  const plane = [items[0], it(22, 35.003, 40), it(16, 35.01, 100), it(21, 35.02, 0)];
  const pl = missionPathLegs(plane as any, routeIndices(plane as any, false), false);
  const pp = mp.missionProfile(plane as any, pl, terrain, { stepM: 10 });
  const climb = pp.points.filter((q) => q.leg === 0);
  check('positioned takeoff: the leg to it climbs from the ground (1000) to 1040, unchecked', near(climb[0].alt, 1000) && near(climb[climb.length - 1].alt, 1040) && climb.every((q) => !q.checked));
}

// A fraction below the terrain reads "1 m below", not "0 m below".
{
  const pr = { points: [{ dist: 10, lat: 35, lon: -106, alt: 999.7, terrain: 1000, leg: 0, checked: true }], marks: [], length: 10, homeMsl: 1000, homeFrom: 'mission' as const };
  const m = mp.terrainIssues(pr as any, [{ from: 0, to: 1, spline: false, latLngs: [] }] as any, 30)[0].message;
  check('a fraction below: "1 m below"', /goes 1 m below/.test(m), m);
  // In feet, 0.3 m is 1 ft below (the 1-unit floor is the formatter's, not a whole metre first: that read "3 ft").
  const ftWhole = (v: number) => `${v > 0 ? Math.max(1, Math.round(v * 3.28084)) : Math.round(v * 3.28084)} ft`;
  const f = mp.terrainIssues(pr as any, [{ from: 0, to: 1, spline: false, latLngs: [] }] as any, 30, ftWhole)[0].message;
  check('a fraction below in feet: "1 ft below", not "3 ft"', /goes 1 ft below/.test(f), f);
}

{
  const ft = (m: number) => `${Math.round(m * 3.28084)} ft`;
  const msgs = mp.terrainIssues(prof, legs, 30, ft).map((i) => i.message).join(' / ');
  check('warnings in the user\'s units (feet)', /goes 492 ft below/.test(msgs) && !/ m /.test(msgs), msgs);
  const within = mp.terrainIssues(prof2, legs, 30, ft)[0].message;
  check('the clearance in feet too', /within 49 ft .*clearance 98 ft/.test(within), within);
}

check('checked vehicles: copter, plane, unknown; not rover, sub, tracker',
  mp.terrainChecked('copter') && mp.terrainChecked('plane') && mp.terrainChecked('generic') && !mp.terrainChecked('rover') && !mp.terrainChecked('sub') && !mp.terrainChecked('tracker'));

console.log(failures.length ? `\n${failures.length} profile check(s) FAILED` : '\nAll profile checks PASSED');
process.exit(failures.length ? 1 : 0);
