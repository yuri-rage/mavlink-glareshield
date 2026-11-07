/**
 * Saving the mission, fence and rally points to files and loading them back.
 *
 * Every file the map saves must parse with the same loader the map uses for dropped files, and give back the
 * items the vehicle sent: the same commands, frames, parameters and coordinates, in the same order.
 *
 * Run: npx tsx tests/missionFiles.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const { parseDroppedMissionFile, packDatFile } = await import('../src/mavlink/missionFileParser.ts');
const { toQgcWpl, toQgcPlan, waypointsToItems, fenceToItems, rallyToItems, groupFenceForPlan, missionFileStem } = await import(
  '../src/mavlink/missionFileWriter.ts'
);
const { missionManager } = await import('../src/mavlink/missionManager.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
const near = (a: number | undefined, b: number | undefined, tol = 1e-6) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;
const enc = (s: string) => new TextEncoder().encode(s);

// What the store holds after a fetch (lat/lon in degrees, float32 parameters).
const f32 = (v: number) => Math.fround(v);
const waypoints = [
  { seq: 0, command: 16, lat: 37.7749, lon: -122.4194, alt: 12.5, current: false, frame: 0, param1: 0, param2: 0, param3: 0, param4: 0 },
  { seq: 1, command: 22, lat: 0, lon: 0, alt: 30, current: true, frame: 3, param1: f32(15), param2: 0, param3: 0, param4: 0 },
  { seq: 2, command: 16, lat: 37.7755123, lon: -122.4182456, alt: 40, current: false, frame: 3, param1: f32(2.5), param2: f32(0.1), param3: 0, param4: 0 },
  { seq: 3, command: 178, lat: 0, lon: 0, alt: 0, current: false, frame: 2, param1: 1, param2: f32(7.3), param3: -1, param4: 0 },
  { seq: 4, command: 177, lat: 0, lon: 0, alt: 0, current: false, frame: 2, param1: 2, param2: 3, param3: 0, param4: 0 },
  { seq: 5, command: 21, lat: 37.7749, lon: -122.4194, alt: 0, current: false, frame: 3, param1: 0, param2: 0, param3: 0, param4: 0 },
];
const fencePoints = [
  { seq: 0, command: 5001, lat: 37.77, lon: -122.42, param1: 4, vertexCount: 4, inclusion: true },
  { seq: 1, command: 5001, lat: 37.78, lon: -122.42, param1: 4, vertexCount: 4, inclusion: true },
  { seq: 2, command: 5001, lat: 37.78, lon: -122.41, param1: 4, vertexCount: 4, inclusion: true },
  { seq: 3, command: 5001, lat: 37.77, lon: -122.41, param1: 4, vertexCount: 4, inclusion: true },
  { seq: 4, command: 5002, lat: 37.774, lon: -122.416, param1: 3, vertexCount: 3, inclusion: false },
  { seq: 5, command: 5002, lat: 37.775, lon: -122.416, param1: 3, vertexCount: 3, inclusion: false },
  { seq: 6, command: 5002, lat: 37.775, lon: -122.415, param1: 3, vertexCount: 3, inclusion: false },
  { seq: 7, command: 5003, lat: 37.7749, lon: -122.4194, param1: 400, radius: 400, inclusion: true },
  { seq: 8, command: 5004, lat: 37.776, lon: -122.418, param1: 25, radius: 25, inclusion: false },
  { seq: 9, command: 5000, lat: 37.7745, lon: -122.4191, alt: 0, param1: 0 },
];
const rallyPoints = [
  { seq: 0, lat: 37.7752, lon: -122.4201, alt: 35 },
  { seq: 1, lat: 37.7731, lon: -122.4177, alt: 50 },
];

function sameItems(name: string, got: any[], want: any[]) {
  const problems: string[] = [];
  if (got.length !== want.length) problems.push(`count ${got.length} != ${want.length}`);
  for (let i = 0; i < Math.min(got.length, want.length); i++) {
    const g = got[i];
    const w = want[i];
    if (g.command !== w.command) problems.push(`#${i} command ${g.command} != ${w.command}`);
    if ((g.frame ?? 3) !== (w.frame ?? 3)) problems.push(`#${i} frame ${g.frame} != ${w.frame}`);
    for (const k of ['param1', 'param2', 'param3', 'param4', 'z'] as const) {
      if (!near(g[k], w[k], 1e-4)) problems.push(`#${i} ${k} ${g[k]} != ${w[k]}`);
    }
    if (!near(g.x, w.x, 1e-7) || !near(g.y, w.y, 1e-7)) problems.push(`#${i} position ${g.x},${g.y} != ${w.x},${w.y}`);
  }
  check(name, problems.length === 0, problems.slice(0, 4).join('; '));
}

// ------------------------------------------------------------------------------------------------
// QGC WPL 110, one file per kind
// ------------------------------------------------------------------------------------------------
{
  const want = waypointsToItems(waypoints);
  const text = toQgcWpl(want);
  check('mission WPL starts with the QGC WPL 110 header', text.startsWith('QGC WPL 110\n'));
  check('mission WPL has one line per item', text.trim().split('\n').length === waypoints.length + 1);
  check('float32 noise is not written', !text.includes('0.100000001') && !text.includes('7.30000019'));
  check('only home is marked current', text.split('\n')[1].split('\t')[1] === '1' && text.split('\n')[3].split('\t')[1] === '0');
  const parsed = parseDroppedMissionFile('mission.waypoints', enc(text));
  check('mission WPL loads as a mission', parsed?.type === 'mission' && parsed.missionType === 0);
  sameItems('mission WPL round-trips every item', parsed?.items ?? [], want);
}
{
  const want = fenceToItems(fencePoints);
  const parsed = parseDroppedMissionFile('x-fence.waypoints', enc(toQgcWpl(want)));
  check('fence WPL loads as a fence', parsed?.type === 'fence' && parsed.missionType === 1);
  sameItems('fence WPL round-trips polygons, circles and the return point', parsed?.items ?? [], want);
}
{
  const want = rallyToItems(rallyPoints);
  const parsed = parseDroppedMissionFile('x-rally.waypoints', enc(toQgcWpl(want)));
  check('rally WPL loads as rally points', parsed?.type === 'rally' && parsed.missionType === 2);
  sameItems('rally WPL round-trips', parsed?.items ?? [], want);
}
{
  // A fence holding only a return point is still a fence.
  const parsed = parseDroppedMissionFile('rp.waypoints', enc(toQgcWpl(fenceToItems([fencePoints[9]]))));
  check('a lone fence return point loads as a fence', parsed?.type === 'fence');
}

// ------------------------------------------------------------------------------------------------
// QGC .plan with all three
// ------------------------------------------------------------------------------------------------
{
  const text = toQgcPlan({ waypoints, fencePoints, rallyPoints, vehicleType: 2 });
  const obj = JSON.parse(text);
  check('plan has the keys QGroundControl requires', obj.fileType === 'Plan' && obj.mission.firmwareType === 3 && obj.mission.vehicleType === 2 &&
    typeof obj.mission.cruiseSpeed === 'number' && typeof obj.mission.hoverSpeed === 'number' && Array.isArray(obj.mission.items));
  check('plan keeps home out of the items', obj.mission.items.length === waypoints.length - 1 && near(obj.mission.plannedHomePosition[0], 37.7749));
  check('plan doJumpIds count from 1', obj.mission.items.map((i: any) => i.doJumpId).join(',') === '1,2,3,4,5');
  check('plan has two polygons and two circles', obj.geoFence.polygons.length === 2 && obj.geoFence.circles.length === 2);
  check('plan polygons keep their vertex counts', obj.geoFence.polygons[0].polygon.length === 4 && obj.geoFence.polygons[1].polygon.length === 3);
  check('plan keeps inclusion and exclusion', obj.geoFence.polygons[0].inclusion === true && obj.geoFence.polygons[1].inclusion === false &&
    obj.geoFence.circles[0].inclusion === true && obj.geoFence.circles[1].inclusion === false);
  check('plan keeps the breach return point', Array.isArray(obj.geoFence.breachReturn) && near(obj.geoFence.breachReturn[0], 37.7745));

  const parsed = parseDroppedMissionFile('all.plan', enc(text));
  check('plan loads as a plan with three sections', parsed?.type === 'plan' && parsed.sections?.length === 3);
  const section = (t: string) => parsed?.sections?.find((s) => s.type === t)?.items ?? [];
  const wantMission = waypointsToItems(waypoints);
  sameItems('plan mission round-trips (home included)', section('mission'), wantMission);
  // The plan loader orders polygons, then circles, then the return point, which is how the vehicle sent them here.
  sameItems('plan fence round-trips', section('fence'), fenceToItems(fencePoints));
  sameItems('plan rally round-trips', section('rally'), rallyToItems(rallyPoints));
}
{
  // No mission home item: the vehicle's home stands in.
  const obj = JSON.parse(toQgcPlan({ waypoints: [], fencePoints, rallyPoints: [], home: { lat: 1.5, lon: 2.5, alt: 100 } }));
  check('plan without a mission uses the vehicle home', obj.mission.plannedHomePosition.join(',') === '1.5,2.5,100' && obj.mission.items.length === 0);
  const parsed = parseDroppedMissionFile('fence.plan', enc(JSON.stringify(obj)));
  check('a fence-only plan loads as a fence', parsed?.type === 'fence');
}
{
  // Polygon vertices whose count is missing still group into one polygon.
  const noCount = fencePoints.slice(0, 4).map((f) => ({ ...f, param1: 0, vertexCount: undefined }));
  const { polygons } = groupFenceForPlan(noCount);
  check('vertices without a count form one polygon', polygons.length === 1 && polygons[0].polygon.length === 4);
}

// ------------------------------------------------------------------------------------------------
// mission.dat read over MAVFTP must give the same values as the MISSION_ITEM_INT stream
// ------------------------------------------------------------------------------------------------
{
  const items = waypointsToItems(waypoints);
  items[4] = { ...items[4], x: 12, y: 34 }; // a non-location command using param5/param6
  const unpacked = missionManager.unpackMissionDat(packDatFile(items, 0)) ?? [];
  check('mission.dat keeps param5/6 of commands without a location', unpacked[4]?.lat === 12 && unpacked[4]?.lon === 34);
  check('mission.dat still scales located commands', near(unpacked[2]?.lat, 37.7755123, 1e-7));
}

check('file stem names the system and time', missionFileStem(3, new Date(2026, 10, 7, 9, 5)) === 'glareshield-sys3-20261107-0905');

console.log(failures.length ? `\n${failures.length} FAILED` : '\nAll mission file checks passed');
process.exit(failures.length ? 1 : 0);
