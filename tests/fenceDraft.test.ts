/**
 * Fence draft checks: converting to and from ArduPilot fence items (vertex grouping by count), edits, validation,
 * the breach rule (exclusion, inclusion intersection or union), comparison and the read-back verdict, and a round
 * trip through the file writer and loader.
 *
 * Run: npx tsx tests/fenceDraft.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const f = await import('../src/mavlink/fenceDraft.ts');
const { toQgcWpl } = await import('../src/mavlink/missionFileWriter.ts');
const { parseDroppedMissionFile } = await import('../src/mavlink/missionFileParser.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof RangeError;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// A square inclusion (~111 m per 0.001°), a small exclusion inside it, a circle, a return point.
const sq = (lat: number, lon: number, d: number) => [
  { lat, lon },
  { lat: lat + d, lon },
  { lat: lat + d, lon: lon + d },
  { lat, lon: lon + d },
];
const item = (seq: number, command: number, p: { lat: number; lon: number }, param1: number) => ({
  seq,
  command,
  x: p.lat,
  y: p.lon,
  z: 0,
  frame: 0,
  param1,
});
const outer = sq(35, -106, 0.002);
const hole = sq(35.0008, -105.9992, 0.0004);
const items = [
  ...outer.map((p, i) => item(i, 5001, p, 4)),
  ...hole.map((p, i) => item(4 + i, 5002, p, 4)),
  item(8, 5003, { lat: 35.001, lon: -106.001 }, 200),
  item(9, 5000, { lat: 35.0003, lon: -105.9997 }, 0),
];
const base = f.fenceDraftFromItems(items as any);

// Conversions
check(
  'from items: inclusion polygon, exclusion polygon, circle',
  base.shapes.map((s: any) => `${s.inclusion ? 'in' : 'ex'}-${s.kind}`).join(',') === 'in-polygon,ex-polygon,in-circle'
);
check(
  'from items: vertices grouped by count',
  (base.shapes[0] as any).vertices.length === 4 && (base.shapes[1] as any).vertices.length === 4
);
check('from items: circle radius from param1', (base.shapes[2] as any).radius === 200);
check('from items: return point', base.returnPoint?.lat === 35.0003);
{
  // Two inclusion polygons back to back: split by the vertex count, not by the command.
  const two = f.fenceDraftFromItems([
    ...sq(35, -106, 0.001).map((p, i) => item(i, 5001, p, 4)),
    ...[0, 1, 2].map((k) => item(4 + k, 5001, { lat: 35.01 + k * 1e-4, lon: -106 + (k % 2) * 1e-4 }, 3)),
  ] as any);
  check(
    'two adjacent inclusion polygons are split by vertex count',
    two.shapes.length === 2 && (two.shapes[1] as any).vertices.length === 3
  );
}
{
  const out = f.fenceDraftToItems(base);
  check(
    'to items: polygon vertices carry the vertex count; return point last',
    out.length === 10 &&
      out[0].param1 === 4 &&
      out[9].command === 5000 &&
      out.every((it: any, i: number) => it.seq === i && it.mission_type === 1)
  );
  check('to items and back: same fence', f.fenceDraftsEqual(base, f.fenceDraftFromItems(out)));
  check(
    'to store points and back: same fence',
    f.fenceDraftsEqual(base, f.fenceDraftFromPoints(f.fenceDraftToPoints(base)))
  );
}

// Edits
{
  const moved = f.moveVertex(base, 0, 2, { lat: 35.0025, lon: -105.9975 });
  check(
    'move a vertex',
    (moved.shapes[0] as any).vertices[2].lat === 35.0025 && (base.shapes[0] as any).vertices[2].lat === 35.002
  );
  const ins = f.insertVertex(base, 0, 1, { lat: 35.002, lon: -105.999 });
  check(
    'insert a vertex after one: lands between it and the next',
    ins.index === 2 &&
      (ins.draft.shapes[0] as any).vertices.length === 5 &&
      (ins.draft.shapes[0] as any).vertices[2].lon === -105.999
  );
  const five = ins.draft;
  check('remove a vertex', (f.removeVertex(five, 0, 2).shapes[0] as any).vertices.length === 4);
  check(
    'a polygon keeps at least 3 vertices',
    throws(() => f.removeVertex(f.removeVertex(base, 0, 0), 0, 0))
  );
  check(
    'vertex edits on a circle are refused',
    throws(() => f.moveVertex(base, 2, 0, { lat: 1, lon: 1 }))
  );
  const areaBefore = f.polygonAreaM2((base.shapes[0] as any).vertices);
  const shifted = f.moveShape(base, 0, { lat: 36, lon: -105 });
  const c = f.polygonCenter((shifted.shapes[0] as any).vertices);
  check('move a whole polygon: its centre lands where dropped', near(c.lat, 36, 1e-9) && near(c.lon, -105, 1e-9));
  check(
    'move a whole polygon: it keeps its size (in metres)',
    near(f.polygonAreaM2((shifted.shapes[0] as any).vertices), areaBefore, areaBefore * 0.002)
  );
  check(
    'move a circle: its centre',
    (f.moveShape(base, 2, { lat: 35.5, lon: -106.5 }).shapes[2] as any).center.lat === 35.5
  );
  check('set radius', (f.setRadius(base, 2, 120).shapes[2] as any).radius === 120);
  check('switch inclusion / exclusion', f.setInclusion(base, 1, true).shapes[1].inclusion === true);
  check('remove a shape', f.removeShape(base, 1).shapes.length === 2);
  check(
    'add a shape returns its index',
    f.addShape(base, f.squareAt({ lat: 35.01, lon: -106 }, 100, false)).index === 3
  );
  check('clear the return point', f.setReturnPoint(base, null).returnPoint === null);
  const square = f.squareAt({ lat: 35.01, lon: -106.01 }, 100, true) as any;
  check(
    'square helper: 100 m sides, centred',
    near(f.polygonAreaM2(square.vertices), 10000, 20) && near(f.polygonCenter(square.vertices).lat, 35.01, 1e-9)
  );
}

// Validation
const has = (list: any[], index: number, sev: string, re: RegExp) =>
  list.some((i) => i.index === index && i.severity === sev && re.test(i.message));
check(
  'valid fence: no issues',
  f.validateFenceDraft(base, { fenceEnable: 1, fenceType: 7 }).length === 0,
  JSON.stringify(f.validateFenceDraft(base, { fenceEnable: 1, fenceType: 7 }))
);
check("empty fence: warns it clears the vehicle's", has(f.validateFenceDraft(f.EMPTY_FENCE), -1, 'warning', /clears/));
{
  const two = {
    ...base,
    shapes: [
      {
        kind: 'polygon',
        inclusion: true,
        vertices: [
          { lat: 35, lon: -106 },
          { lat: 35.001, lon: -106 },
        ],
      },
    ],
  } as any;
  check('polygon with 2 vertices: error', has(f.validateFenceDraft(two), 0, 'error', /at least 3/));
  const bowtie = {
    shapes: [
      {
        kind: 'polygon',
        inclusion: true,
        vertices: [
          { lat: 35, lon: -106 },
          { lat: 35.001, lon: -105.999 },
          { lat: 35.001, lon: -106 },
          { lat: 35, lon: -105.999 },
        ],
      },
    ],
    returnPoint: null,
  } as any;
  check('self-intersecting polygon: error', has(f.validateFenceDraft(bowtie), 0, 'error', /crosses itself/));
  check(
    'convex and concave simple polygons: not flagged as crossing',
    !f.selfIntersects(outer) &&
      !f.selfIntersects([
        { lat: 0, lon: 0 },
        { lat: 2, lon: 0 },
        { lat: 1, lon: 1 },
        { lat: 2, lon: 2 },
        { lat: 0, lon: 2 },
      ])
  );
  check('zero radius: error', has(f.validateFenceDraft(f.setRadius(base, 2, 0)), 2, 'error', /positive radius/));
  check(
    'vertex at 0,0: error',
    has(f.validateFenceDraft(f.moveVertex(base, 0, 0, { lat: 0, lon: 0 })), 0, 'error', /valid position/)
  );
  check(
    'return point outside the fence: warning',
    has(f.validateFenceDraft(f.setReturnPoint(base, { lat: 36, lon: -106 })), -2, 'warning', /outside the fence/)
  );
  check(
    'FENCE_TYPE without polygons/circles: warning',
    has(f.validateFenceDraft(base, { fenceType: 3 }), -1, 'warning', /FENCE_TYPE/)
  );
  check('FENCE_ENABLE 0: warning', has(f.validateFenceDraft(base, { fenceEnable: 0 }), -1, 'warning', /FENCE_ENABLE/));
}

// Breach (AC_PolyFence_loader::breached)
{
  const inOuter = { lat: 35.0003, lon: -105.9997 }; // inside the square, outside the hole and the circle? (circle: 300 m around 35.001,-106.001)
  const inHole = { lat: 35.001, lon: -105.999 };
  check('inside an exclusion zone: breached', f.fenceBreached(base, inHole));
  const insideSquareOnly = { lat: 35.0019, lon: -105.9981 }; // in the square, far from the circle's centre
  check(
    'outside one inclusion zone (default intersection): breached',
    f.distanceM(insideSquareOnly, { lat: 35.001, lon: -106.001 }) > 200 && f.fenceBreached(base, insideSquareOnly)
  );
  check(
    'outside one inclusion zone with FENCE_OPTIONS union: not breached',
    !f.fenceBreached(base, insideSquareOnly, { inclusionUnion: true })
  );
  check(
    'outside every inclusion zone with union: breached',
    f.fenceBreached(base, { lat: 36, lon: -106 }, { inclusionUnion: true })
  );
  check('in both inclusion zones, outside the exclusion: not breached', !f.fenceBreached(base, inOuter));
  check(
    'only exclusions: outside them is fine',
    !f.fenceBreached({ shapes: [base.shapes[1]], returnPoint: null }, { lat: 36, lon: -106 })
  );
}

// Breach reasons agree with the rule and name the zones
{
  const pts = [
    { lat: 35.001, lon: -105.999 },
    { lat: 35.0019, lon: -105.9981 },
    { lat: 35.0003, lon: -105.9997 },
    { lat: 36, lon: -106 },
  ];
  check(
    'breach reasons agree with fenceBreached (both modes)',
    pts.every((p) =>
      [false, true].every(
        (u) =>
          f.fenceBreachReasons(base, p, { inclusionUnion: u }).length > 0 ===
          f.fenceBreached(base, p, { inclusionUnion: u })
      )
    )
  );
  check(
    'inside an exclusion zone: named',
    f
      .fenceBreachReasons(base, { lat: 35.001, lon: -105.999 })
      .some((r: string) => /inside exclusion polygon F2/.test(r))
  );
  check(
    'outside an inclusion zone: named',
    f
      .fenceBreachReasons(base, { lat: 35.0019, lon: -105.9981 })
      .some((r: string) => /outside inclusion zone F3/.test(r))
  );
  check('safe position: no reasons', f.fenceBreachReasons(base, { lat: 35.0003, lon: -105.9997 }).length === 0);
  const trap = f.addShape(base, {
    kind: 'circle',
    inclusion: false,
    center: { lat: 35.0003, lon: -105.9997 },
    radius: 10,
  }).draft;
  check(
    'a new exclusion circle over the vehicle: breach',
    f.fenceBreachReasons(trap, { lat: 35.0003, lon: -105.9997 }).join() === 'inside exclusion circle F4'
  );
}
{
  const changed = f.fenceChanges(
    base,
    f.setReturnPoint(
      f.setRadius(f.addShape(base, f.squareAt({ lat: 35.01, lon: -106 }, 50, false)).draft, 2, 120),
      null
    )
  );
  check(
    'changes listed in words',
    changed.join('; ') === 'F3 changed: inclusion circle; F4 added: exclusion polygon; return point removed',
    changed.join('; ')
  );
  check('no changes: empty', f.fenceChanges(base, base).length === 0);
  check(
    'fence action text: copter RTL, rover terminate, report only',
    f.fenceActionText('copter', 1) === 'RTL (or land)' &&
      /TERMINATE/.test(f.fenceActionText('rover', 5)!) &&
      f.fenceActionText('plane', 0) === null
  );
}

// Fencing on or off, as the upload check decides it
{
  const G = 1 << 20;
  const st = (o: any) => f.fencingState({ sensorsPresent: 0, sensorsEnabled: 0, armed: true, ...o });
  check(
    'SYS_STATUS reports the fence: its enabled bit decides',
    st({ sensorsPresent: G, sensorsEnabled: G, fenceEnable: 0 }) === true &&
      st({ sensorsPresent: G, sensorsEnabled: 0, fenceEnable: 1 }) === false
  );
  check(
    'fence enabled but none loaded yet (not present): FENCE_ENABLE says on',
    st({ sensorsPresent: 1, fenceEnable: 1, fenceAction: 1 }) === true
  );
  check('report only: off', st({ fenceEnable: 1, fenceAction: 0 }) === false);
  check('parameters unknown: unknown', st({}) === undefined);
  check(
    'auto-enable while armed: unknown',
    st({ fenceEnable: 0, fenceAutoEnable: 3 }) === undefined &&
      st({ fenceEnable: 0, fenceAutoEnable: 3, armed: false }) === false
  );
}

// Comparison and read-back
{
  const rb = f.fenceDraftToPoints(base);
  check('read-back of the same fence: verified', f.checkFenceReadBack(base, rb).status === 'verified');
  check(
    'read-back missing the return point: mismatch',
    f.checkFenceReadBack(base, rb.slice(0, -1)).status === 'mismatch'
  );
  check(
    'read-back with a moved vertex: mismatch',
    f.checkFenceReadBack(
      base,
      rb.map((p: any, i: number) => (i === 1 ? { ...p, lat: p.lat + 1e-5 } : p))
    ).status === 'mismatch'
  );
  check('nothing back after sending a fence: unreadable', f.checkFenceReadBack(base, []).status === 'unreadable');
  check(
    'cleared (nothing sent, nothing back): verified',
    f.checkFenceReadBack(f.EMPTY_FENCE, []).status === 'verified'
  );
  check('a failed read: unreadable even if it matches', f.checkFenceReadBack(base, rb, false).status === 'unreadable');
  check('radius within 1 cm: same', f.fenceDraftsEqual(base, f.setRadius(base, 2, 200.004)));
}

// File round trip
{
  const parsed = parseDroppedMissionFile(
    'fence.waypoints',
    new TextEncoder().encode(toQgcWpl(f.fenceDraftToItems(base)))
  );
  const loaded = parsed ? f.fenceDraftFromItems(parsed.items) : null;
  check(
    'save to .waypoints and load: same fence',
    Boolean(loaded) && f.fenceDraftsEqual(base, loaded!),
    loaded ? f.compareFenceDrafts(base, loaded).join('; ') : 'no parse'
  );
}

// The Mission menu's saves while planning: the draft through the store-point writers (fenceToItems, .plan)
{
  const { fenceToItems, toQgcPlan } = await import('../src/mavlink/missionFileWriter.ts');
  const pts = f.fenceDraftToPoints(base);
  const wpl = parseDroppedMissionFile('d-fence.waypoints', new TextEncoder().encode(toQgcWpl(fenceToItems(pts))));
  const viaWpl = wpl ? f.fenceDraftFromItems(wpl.items) : null;
  check(
    'menu save (.waypoints) of the fence draft loads back the same',
    Boolean(viaWpl) && f.fenceDraftsEqual(base, viaWpl!),
    viaWpl ? f.compareFenceDrafts(base, viaWpl).join('; ') : 'no parse'
  );
  const plan = parseDroppedMissionFile(
    'd.plan',
    new TextEncoder().encode(
      toQgcPlan({ waypoints: [], fencePoints: pts, rallyPoints: [], home: null, vehicleType: 2 } as any)
    )
  );
  const fenceSec = plan?.sections?.find((sec: any) => sec.type === 'fence');
  const viaPlan = fenceSec ? f.fenceDraftFromItems(fenceSec.items) : null;
  check(
    'menu save (.plan) of the fence draft loads back the same',
    Boolean(viaPlan) && f.fenceDraftsEqual(base, viaPlan!),
    viaPlan ? f.compareFenceDrafts(base, viaPlan).join('; ') : 'no fence section'
  );
}

console.log(failures.length ? `\n${failures.length} fence draft check(s) FAILED` : '\nAll fence draft checks PASSED');
process.exit(failures.length ? 1 : 0);
