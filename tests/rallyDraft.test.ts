/**
 * Rally draft checks: conversions (keeping the altitude frame), edits, validation (including RALLY_LIMIT_KM),
 * comparison and the read-back verdict, and a round trip through the file writer and loader.
 *
 * Run: npx tsx tests/rallyDraft.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const r = await import('../src/mavlink/rallyDraft.ts');
const { toQgcWpl, rallyToItems } = await import('../src/mavlink/missionFileWriter.ts');
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

const HOME = { lat: 35.0, lon: -106.0 };
const stored = [
  { seq: 1, lat: 35.01, lon: -106.01, alt: 50, frame: 3 },
  { seq: 0, lat: 35.002, lon: -106.002, alt: 40 }, // older cache: no frame
  { seq: 2, lat: 35.02, lon: -106.02, alt: 60, frame: 0 },
];
const base = r.rallyDraftFromPoints(stored as any);

// Conversions
check('from points: seq order', base.points.map((p: any) => p.alt).join(',') === '40,50,60');
check('from points: missing frame reads as relative to home', base.points[0].frame === 3);
check('from points: frame kept', base.points[2].frame === 0);
{
  const items = r.rallyDraftToItems(base);
  check(
    'to items: rally command, mission_type 2, seq from 0',
    items.every((it: any, i: number) => it.command === 5100 && it.mission_type === 2 && it.seq === i)
  );
  check('to items: frame kept', items[2].frame === 0);
}
check(
  'from file items: only rally commands',
  r.rallyDraftFromItems([
    { seq: 0, command: 16, x: 1, y: 1, z: 1 },
    { seq: 1, command: 5100, frame: 3, x: 35.1, y: -106.1, z: 25 },
  ] as any).points.length === 1
);
check(
  'rallyToItems (vehicle rally points to file): keeps the frame',
  rallyToItems(stored as any).find((it: any) => it.z === 60)?.frame === 0
);

// Edits
{
  const a = r.addRallyPoint(base, 0, 35.003, -106.003);
  check(
    'add after a point: lands after it, takes its altitude and frame',
    a.index === 1 && a.draft.points[1].alt === 40 && a.draft.points[1].frame === 3
  );
  const e = r.addRallyPoint(base, null, 35.03, -106.03);
  check(
    'add with nothing selected: appended, altitude from the last point',
    e.index === 3 && e.draft.points[3].alt === 60 && e.draft.points[3].frame === 0
  );
  const first = r.addRallyPoint({ points: [] }, null, 35.03, -106.03);
  check(
    'first point: default altitude, relative to home',
    first.draft.points[0].alt === r.DEFAULT_RALLY_ALT && first.draft.points[0].frame === 3
  );
  check('add: original untouched', base.points.length === 3);
  const m = r.moveRallyPoint(base, 1, 35.5, -106.5);
  check('move: position changes, altitude kept', m.points[1].lat === 35.5 && m.points[1].alt === 50);
  const u = r.updateRallyPoint(base, 2, { alt: 80 });
  check('update: altitude only', u.points[2].alt === 80 && u.points[2].lat === 35.02);
  check(
    'altitude kept to whole meters (ArduPilot stores int16 m): 100 ft = 30.48 m becomes 30',
    r.updateRallyPoint(base, 0, { alt: 30.48 }).points[0].alt === 30
  );
  check(
    'file altitudes rounded to whole meters too',
    r.rallyDraftFromItems([{ seq: 0, command: 5100, frame: 3, x: 35.1, y: -106.1, z: 45.6 }] as any).points[0].alt ===
      46
  );
  const d = r.removeRallyPoint(base, 0);
  check('remove: gone, others keep their order', d.points.length === 2 && d.points[0].alt === 50);
  check(
    'edits on a missing point are refused',
    throws(() => r.removeRallyPoint(base, 3)) && throws(() => r.updateRallyPoint(base, -1, {}))
  );
}

// Validation
const has = (list: any[], index: number, severity: string, re: RegExp) =>
  list.some((i) => i.index === index && i.severity === severity && re.test(i.message));
check(
  'valid points: no issues',
  r.validateRallyDraft(base, { home: HOME, limitKm: 5 }).length === 0,
  JSON.stringify(r.validateRallyDraft(base, { home: HOME, limitKm: 5 }))
);
check('no points: warns it clears the vehicle', has(r.validateRallyDraft({ points: [] }), -1, 'warning', /clears/));
check(
  '0,0: error',
  has(r.validateRallyDraft(r.updateRallyPoint(base, 0, { lat: 0, lon: 0 })), 0, 'error', /no position/)
);
check(
  'out of range: error',
  has(r.validateRallyDraft(r.updateRallyPoint(base, 0, { lat: 91 })), 0, 'error', /outside/)
);
check(
  'not a number: error',
  has(r.validateRallyDraft(r.updateRallyPoint(base, 0, { alt: NaN })), 0, 'error', /not a number/)
);
check(
  'below home: warning',
  has(r.validateRallyDraft(r.updateRallyPoint(base, 0, { alt: -1 })), 0, 'warning', /below home/)
);
check(
  'terrain frame: warning',
  has(r.validateRallyDraft(r.updateRallyPoint(base, 0, { frame: 10 })), 0, 'warning', /terrain/)
);
{
  const far = r.updateRallyPoint(base, 2, { lat: 35.1, lon: -106.0 }); // ~11 km north
  check(
    'beyond RALLY_LIMIT_KM: warning that it is ignored',
    has(r.validateRallyDraft(far, { home: HOME, limitKm: 2 }), 2, 'warning', /RALLY_LIMIT_KM/)
  );
  check(
    'RALLY_LIMIT_KM 0 (disabled): no warning',
    !r.validateRallyDraft(far, { home: HOME, limitKm: 0 }).some((i: any) => /RALLY_LIMIT_KM/.test(i.message))
  );
  check(
    'limit unknown (params not loaded): no warning',
    !r.validateRallyDraft(far, { home: HOME }).some((i: any) => /RALLY_LIMIT_KM/.test(i.message))
  );
  check(
    'home unknown: no warning',
    !r.validateRallyDraft(far, { limitKm: 2 }).some((i: any) => /RALLY_LIMIT_KM/.test(i.message))
  );
}
check('distance: about 11.1 km per 0.1° of latitude', Math.abs(r.distanceM(35, -106, 35.1, -106) - 11119) < 20);

// Comparison and read-back
{
  const readBack = base.points.map((p: any, seq: number) => ({
    seq,
    lat: p.lat,
    lon: p.lon,
    alt: Math.round(p.alt * 100) / 100 + 0.004,
    frame: p.frame === 3 ? 6 : p.frame,
  }));
  check(
    'read-back within the vehicle precision (cm, _INT frames): verified',
    r.checkRallyReadBack(base, readBack as any).status === 'verified',
    JSON.stringify(r.checkRallyReadBack(base, readBack as any).differences)
  );
  check(
    'read-back missing a point: mismatch',
    r.checkRallyReadBack(base, readBack.slice(0, 2) as any).status === 'mismatch'
  );
  check(
    'read-back moved: mismatch',
    r.checkRallyReadBack(base, readBack.map((p: any, i: number) => (i === 1 ? { ...p, lat: p.lat + 1e-5 } : p)) as any)
      .status === 'mismatch'
  );
  check('nothing read back after uploading points: unreadable', r.checkRallyReadBack(base, []).status === 'unreadable');
  check('cleared (none uploaded, none back): verified', r.checkRallyReadBack({ points: [] }, []).status === 'verified');
  check(
    'cleared but the read failed: unreadable, not verified',
    r.checkRallyReadBack({ points: [] }, [], false).status === 'unreadable'
  );
  check(
    'a matching list from a failed read is still unreadable',
    r.checkRallyReadBack(base, readBack as any, false).status === 'unreadable'
  );
  check('equal drafts', r.rallyDraftsEqual(base, r.rallyDraftFromPoints(stored as any)));
}

// File round trip
{
  const edited = r.addRallyPoint(r.updateRallyPoint(base, 1, { alt: 55.5 }), null, 35.0312345, -106.0312345).draft;
  const parsed = parseDroppedMissionFile(
    'rally.waypoints',
    new TextEncoder().encode(toQgcWpl(r.rallyDraftToItems(edited)))
  );
  const loaded = parsed ? r.rallyDraftFromItems(parsed.items) : null;
  check(
    'save to .waypoints and load: same rally points',
    Boolean(loaded) && r.rallyDraftsEqual(edited, loaded!),
    loaded ? r.compareRallyDrafts(edited, loaded).join('; ') : 'no parse'
  );
}

console.log(failures.length ? `\n${failures.length} rally draft check(s) FAILED` : '\nAll rally draft checks PASSED');
process.exit(failures.length ? 1 : 0);
