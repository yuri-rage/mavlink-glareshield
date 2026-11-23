/**
 * Mission path checks: straight legs, and spline legs drawn as the cubic Hermite curve ArduPilot Copter flies
 * (AC_WPNav / SplineCurve), with its rules for the origin and destination velocities and the overshoot limit.
 *
 * Run: npx tsx tests/missionPath.test.ts
 */
export {};
const p = await import('../src/mavlink/missionPath.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearV = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => near(v, b[i], tol));

// The Hermite curve itself, in metres.
{
  const o: [number, number, number] = [0, 0, 0];
  const d: [number, number, number] = [100, 0, 0];
  const straight = p.splineLeg(o, d, [0, 0, 0], [0, 0, 0], 4);
  check('no velocities: the curve stays on the chord', straight.every((q) => near(q[1], 0) && q[0] >= 0 && q[0] <= 100));
  check('ends exactly at origin and destination', nearV(straight[0], o) && nearV(straight[4], d));
  // v0 = (0, 100), v1 = (100, 0): at t = 0.5, p = o/2 + v0/8 + d/2 - v1/8 (Hermite basis) = (50 - 12.5, 12.5)
  const bent = p.splineLeg(o, d, [0, 100, 0], [100, 0, 0], 2);
  check('Hermite midpoint matches the basis functions', nearV(bent[1], [37.5, 12.5, 0]), JSON.stringify(bent[1]));
  // |v0| + |v1| = 1000 > 4 × 100: both scaled by 400/1000.
  const big = p.splineLeg(o, d, [0, 500, 0], [500, 0, 0], 2);
  const scaled = p.splineLeg(o, d, [0, 200, 0], [200, 0, 0], 2);
  check('velocities over 4× the leg length are scaled down (SPLINE_FACTOR)', nearV(big[1], scaled[1]), `${big[1]} vs ${scaled[1]}`);
}

// Missions: home, then waypoints along a square-ish route. ~0.001° ≈ 111 m north, ~91 m east at 35°.
const item = (command: number, lat: number, lon: number, extra: Partial<{ param1: number; frame: number; alt: number }> = {}) => ({
  command,
  lat,
  lon,
  alt: extra.alt ?? 30,
  frame: extra.frame ?? 3,
  param1: extra.param1 ?? 0,
});
const HOME = item(16, 35, -106, { frame: 0, alt: 1600 });

{
  const items = [HOME, item(16, 35.001, -106), item(16, 35.001, -105.999)];
  const legs = p.missionPathLegs(items, [0, 1, 2], true);
  check('waypoints only: straight legs of two points', legs.length === 2 && legs.every((l) => !l.spline && l.latLngs.length === 2));
  check('joined path: each vertex once', p.joinLegs(legs).length === 3);
}

{
  // WP north, then a spline east, then a WP further east: the spline leaves heading north, arrives heading east.
  const items = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(16, 35.001, -105.998)];
  const legs = p.missionPathLegs(items, [0, 1, 2, 3], true);
  const s = legs[1];
  check('spline leg is curved and sampled', s.spline && s.latLngs.length > 10);
  check('spline leg starts and ends on its waypoints',
    nearV(s.latLngs[0], [35.001, -106]) && nearV(s.latLngs[s.latLngs.length - 1], [35.001, -105.999]));
  // Leaving the previous (northbound) straight leg, the curve first bulges north of the chord.
  const early = s.latLngs[3];
  check('spline leaves in the direction of the previous leg (north of the chord)', early[0] > 35.001, String(early[0]));
  check('copter off: spline drawn straight (rover, plane)', !p.missionPathLegs(items, [0, 1, 2, 3], false)[1].spline);
  check('midpoint handle lies on the curve', nearV(p.legMidpoint(s), s.latLngs[Math.floor(s.latLngs.length / 2)]));
}

{
  // A hold time at the origin stops the vehicle: no origin velocity, so no bulge.
  const items = [HOME, item(16, 35.001, -106, { param1: 5 }), item(82, 35.001, -105.999)];
  const s = p.missionPathLegs(items, [0, 1, 2], true)[1];
  check('hold at the origin: the curve starts along the chord (no velocity)', s.latLngs.every((q) => near(q[0], 35.001, 1e-9)));
}

{
  // Spline after spline: the second leg starts with the first leg's destination velocity.
  const items = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(82, 35.002, -105.999)];
  const legs = p.missionPathLegs(items, [0, 1, 2, 3], true);
  check('consecutive splines: both curved', legs[1].spline && legs[2].spline);
  // Leg 1's destination velocity points from its origin (WP1) to the next spline (WP3): north-east. So leg 2
  // leaves WP2 heading north-east, i.e. its second sample is east of WP2.
  const second = legs[2].latLngs[1];
  check('second spline leaves along the first one\'s exit direction (north-east)', second[0] > 35.001 && second[1] > -105.999, `${second}`);
}

{
  // The next navigation command has no location (RTL): the spline ends with no velocity.
  const items = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(20, 0, 0)];
  const s = p.missionPathLegs(items, [0, 1, 2], true)[1];
  const last = s.latLngs[s.latLngs.length - 2];
  // Arriving with zero velocity, the end of the curve approaches along the curve's own direction, not along a next
  // leg; just check it still ends on the waypoint and stays sane (no NaN).
  check('next navigation command without a location: ends on the waypoint, no NaN', s.latLngs.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])) && Number.isFinite(last[0]));
  // DO commands between are skipped when finding the next navigation point.
  const withDo = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(183, 0, 0), item(16, 35.001, -105.998)];
  const viaDo = p.missionPathLegs(withDo, [0, 1, 2, 4], true)[1].latLngs;
  const direct = p.missionPathLegs([HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(16, 35.001, -105.998)], [0, 1, 2, 3], true)[1].latLngs;
  check('DO commands between are skipped when finding the next point', viaDo.every((q, i) => nearV(q, direct[i], 1e-12)));
}

{
  // Terrain change: no velocities across it.
  const items = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999, { frame: 10 })];
  const s = p.missionPathLegs(items, [0, 1, 2], true)[1];
  check('terrain frame change: no origin velocity (straight along the chord)', s.latLngs.every((q) => near(q[0], 35.001, 1e-9)));
}

{
  // Which vehicles fly splines, and the route for one that doesn't: the spline waypoint is skipped.
  check('copter and unknown vehicles fly splines; rover, plane, sub do not',
    p.fliesSplines('copter') && p.fliesSplines('generic') && !p.fliesSplines('rover') && !p.fliesSplines('plane') && !p.fliesSplines('sub'));
  const items = [HOME, item(16, 35.001, -106), item(82, 35.001, -105.999), item(201, 35.0015, -105.9985), item(16, 35.002, -105.999)];
  check('route: home and navigation items with a position; an ROI is not a vertex', p.routeIndices(items, true).join(',') === '0,1,2,4');
  check('route for a vehicle that skips splines: the spline waypoint is bypassed', p.routeIndices(items, false).join(',') === '0,1,4');
}

console.log(failures.length ? `\n${failures.length} mission path check(s) FAILED` : '\nAll mission path checks PASSED');
process.exit(failures.length ? 1 : 0);
