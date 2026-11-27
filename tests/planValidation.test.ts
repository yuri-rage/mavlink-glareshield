// QGC .plan files that would load wrong: a fence circle or polygon vertex missing its position (it would sit at
// (0, 0): an inclusion circle there breaches at once), a landing pattern missing a coordinate. Each is refused with
// a message that says what to fix, not read as "not a plan". (0, 0) where ArduPilot means "here" still loads.
import { parseQgcPlanJson, PlanFileError } from '../src/mavlink/missionFileParser.ts';

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};
const plan = (over: any) =>
  JSON.stringify({
    fileType: 'Plan',
    version: 1,
    mission: { items: [], plannedHomePosition: [35, -106, 1600], ...(over.mission ?? {}) },
    geoFence: { version: 2, polygons: [], circles: [], ...(over.geoFence ?? {}) },
    rallyPoints: { version: 2, points: [], ...(over.rallyPoints ?? {}) },
  });
const refused = (json: string, pattern: RegExp) => {
  try {
    parseQgcPlanJson(json);
    return 'loaded';
  } catch (e) {
    return e instanceof PlanFileError && pattern.test(e.message) ? 'ok' : `other error: ${(e as Error).message}`;
  }
};
const wp = (cmd: number, lat: number, lon: number) => ({
  type: 'SimpleItem',
  command: cmd,
  frame: 3,
  autoContinue: true,
  params: [0, 0, 0, null, lat, lon, 30],
});

const ring = [
  [35.0, -106.0],
  [35.01, -106.0],
  [35.01, -106.01],
];
let r = parseQgcPlanJson(
  plan({
    geoFence: {
      polygons: [{ inclusion: true, polygon: ring }],
      circles: [{ inclusion: true, circle: { center: [35, -106], radius: 300 } }],
    },
  })
);
check('a sound fence loads', !!r?.sections?.find((s) => s.missionType === 1 && s.items.length === 4));

check(
  'circle without a center: refused',
  refused(
    plan({ geoFence: { circles: [{ inclusion: true, circle: { radius: 300 } }] } }),
    /Fence circle 1 has no valid center/
  ) === 'ok'
);
check(
  'circle at (0, 0): refused',
  refused(
    plan({ geoFence: { circles: [{ inclusion: true, circle: { center: [0, 0], radius: 300 } }] } }),
    /no valid center/
  ) === 'ok'
);
check(
  'circle without a radius: refused',
  refused(
    plan({ geoFence: { circles: [{ inclusion: false, circle: { center: [35, -106], radius: 0 } }] } }),
    /no valid radius/
  ) === 'ok'
);
check(
  'polygon vertex missing: refused, numbered',
  refused(
    plan({ geoFence: { polygons: [{ polygon: ring }, { polygon: [...ring, [35.02]] }] } }),
    /Fence polygon 2 has a vertex/
  ) === 'ok'
);
check(
  'polygon of 2 vertices: refused',
  refused(plan({ geoFence: { polygons: [{ polygon: ring.slice(0, 2) }] } }), /fewer than 3 vertices/) === 'ok'
);

const landing = (over: any) => ({
  type: 'ComplexItem',
  complexItemType: 'fwLandingPattern',
  version: 2,
  altitudesAreRelative: true,
  loiterRadius: 75,
  landingApproachCoordinate: [35.02, -106.02, 40],
  landCoordinate: [35.0, -106.0, 0],
  ...over,
});
check('a sound landing pattern loads', !!parseQgcPlanJson(plan({ mission: { items: [landing({})] } })));
check(
  'landing pattern without its approach: refused, not a TypeError',
  refused(
    plan({ mission: { items: [landing({ landingApproachCoordinate: undefined })] } }),
    /no approach coordinate/
  ) === 'ok'
);
check(
  'vtol landing pattern without its land point: refused',
  refused(
    plan({ mission: { items: [landing({ complexItemType: 'vtolLandingPattern', landCoordinate: null })] } }),
    /no land coordinate/
  ) === 'ok'
);

// ArduPilot reads (0, 0) as "the vehicle's position" for these: still loads.
r = parseQgcPlanJson(plan({ mission: { items: [wp(22, 0, 0), wp(16, 35.01, -106.01), wp(21, 0, 0)] } }));
// Item 0 is the planned home.
check(
  'takeoff and land "here" (0, 0): still load',
  r?.items.length === 4 && r.items[1].command === 22 && r.items[3].command === 21,
  r?.items.map((i) => i.command).join(',')
);
// A waypoint at (0, 0) is still refused (as before), now as a PlanFileError.
check(
  'a waypoint at (0, 0): refused',
  refused(plan({ mission: { items: [wp(16, 0, 0)] } }), /invalid coordinates/) === 'ok'
);

// Rally points, the fence's breach return and survey transects: a real position each, or the plan is refused.
check(
  'a rally point with no position: refused, numbered',
  refused(
    plan({
      rallyPoints: {
        points: [
          [35, -106, 50],
          [null, null, 50],
        ],
      },
    }),
    /Rally point 2/
  ) === 'ok'
);
check(
  'a rally point at (0, 0): refused',
  refused(plan({ rallyPoints: { points: [[0, 0, 50]] } }), /Rally point 1/) === 'ok'
);
r = parseQgcPlanJson(plan({ rallyPoints: { points: [[35, -106, 50]] } }));
check('a real rally point loads', !!r?.sections?.some((sec: any) => sec.type === 'rally' && sec.items.length === 1));
check(
  'a breach return of nulls: refused',
  refused(
    plan({ geoFence: { polygons: [{ inclusion: true, polygon: ring }], breachReturn: [null, null, 0] } }),
    /breach return/
  ) === 'ok'
);
r = parseQgcPlanJson(plan({ geoFence: { polygons: [{ inclusion: true, polygon: ring }], breachReturn: [0, 0, 0] } }));
check(
  'a breach return of [0, 0, 0] (QGC: not set) is skipped, the fence loads',
  !!r?.sections?.some((sec: any) => sec.type === 'fence' && !sec.items.some((it: any) => it.command === 5000))
);
const survey = (pts: any[]) => ({ type: 'ComplexItem', complexItemType: 'survey', transects: [pts] });
check(
  'a survey transect point with no position: refused',
  refused(plan({ mission: { items: [survey([[35, -106, 30], null])] } }), /transect point/) === 'ok'
);
r = parseQgcPlanJson(plan({ mission: { items: [survey([[35, -106, 30], { lat: 35.001, lon: -106, alt: 40 }])] } }));
// Home is item 0, then the two transect points.
check('a survey with real transect points loads', (r?.items.length ?? 0) === 3);

console.log(failures.length ? `\n${failures.length} plan check(s) FAILED` : '\nAll plan checks PASSED');
if (failures.length) process.exit(1);
