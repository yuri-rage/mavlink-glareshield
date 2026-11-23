/**
 * Mission draft checks: building a draft from the vehicle's mission or a file, every edit (insert, delete, move,
 * change command) keeping home fixed and DO_JUMP targets on their items, validation, comparing drafts (unsaved
 * changes and upload read-back), undo/redo, and a round trip through the file writer and loader.
 *
 * Run: npx tsx tests/missionDraft.test.ts
 */
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const d = await import('../src/mavlink/missionDraft.ts');
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
const cmds = (draft: any) => draft.items.map((it: any) => it.command).join(',');

// The store's view of a small mission: home, takeoff, two waypoints, a jump back to WP 2, land.
const HOME = { seq: 0, command: 16, lat: 35.0, lon: -106.0, alt: 1600, current: false, frame: 0 };
const waypoints = [
  { seq: 3, command: 16, lat: 35.002, lon: -106.001, alt: 40, current: false, frame: 3, param1: 2 },
  HOME,
  { seq: 1, command: 22, lat: 0, lon: 0, alt: 20, current: false, frame: 3, param1: 0 },
  { seq: 2, command: 16, lat: 35.001, lon: -106.001, alt: 30, current: true, frame: 3 },
  { seq: 4, command: 177, lat: 0, lon: 0, alt: 0, current: false, frame: 2, param1: 2, param2: 3 },
  { seq: 5, command: 21, lat: 35.0, lon: -106.0, alt: 0, current: false, frame: 3 },
];
const base = d.draftFromWaypoints(waypoints as any);

// ------------------------------------------------------------------------------------------------
// Conversions
// ------------------------------------------------------------------------------------------------
check('from waypoints: sorted by seq, home first', cmds(base) === '16,22,16,16,177,21', cmds(base));
check('from waypoints: missing params become 0, autocontinue 1', base.items[2].param2 === 0 && base.items[2].autocontinue === 1);
check('empty mission: home alone, at the given home', (() => {
  const e = d.draftFromWaypoints([], { lat: 1, lon: 2, alt: 3 });
  return e.items.length === 1 && e.items[0].x === 1 && e.items[0].y === 2 && e.items[0].z === 3;
})());
{
  const items = d.draftToItems(base);
  check('to items: seq is the index', items.every((it: any, i: number) => it.seq === i));
  check('to items: only home is current', items[0].current === 1 && items.slice(1).every((it: any) => it.current === 0));
  check('to items: mission_type 0', items.every((it: any) => it.mission_type === 0));
}

// ------------------------------------------------------------------------------------------------
// Edits keep home and jump targets
// ------------------------------------------------------------------------------------------------
{
  const wp = d.newWaypoint(base, 3, 35.0015, -106.0015);
  const ins = d.insertItems(base, 2, [wp]);
  check('new waypoint after the takeoff takes its altitude', d.newWaypoint(base, 2, 1, 1).z === 20);
  check('insert: lands at the index', ins.items[2] === wp && cmds(ins) === '16,22,16,16,16,177,21', cmds(ins));
  check('insert before jump target: target follows its item', ins.items[5].param1 === 3, String(ins.items[5].param1));
  const after = d.insertItems(base, 4, [wp]);
  check('insert after jump target: target unchanged', after.items[5].param1 === 2, String(after.items[5].param1));
  check('insert: the original draft is untouched', base.items.length === 6 && base.items[4].param1 === 2);
  check('insert at home is refused', throws(() => d.insertItems(base, 0, [wp])));
  check('insert past the end is refused', throws(() => d.insertItems(base, 7, [wp])));
  check('new waypoint takes the altitude and frame before it', wp.z === 30 && wp.frame === 3, `${wp.z} ${wp.frame}`);
  check('new waypoint after only home uses the default altitude', d.newWaypoint(base, 1, 1, 1).z === d.DEFAULT_WAYPOINT_ALT);
  check('new waypoint does not copy a land altitude', d.newWaypoint(base, 6, 1, 1).z === 40);
}
{
  const app = d.appendWaypoint(base, 35.003, -106.002);
  check('append: added last', app.items.length === 7 && app.items[6].x === 35.003);
}
{
  const del = d.removeItems(base, [1]);
  check('delete before jump target: target shifts down', del.items[3].command === 177 && del.items[3].param1 === 1, String(del.items[3].param1));
  const delTarget = d.removeItems(base, [2]);
  check(
    'delete the jump target: jump moves to the item that took its place',
    delTarget.items[3].command === 177 && delTarget.items[3].param1 === 2 && delTarget.items[2].x === 35.002,
    String(delTarget.items[3].param1)
  );
  const delTail = d.removeItems(d.removeItems(base, [5]), [3, 2]);
  // Remaining: home, takeoff, jump. The jump's target (old 2) and everything after it up to the jump went.
  check('delete target and every item after it: jump points at the next item, here itself', delTail.items[2].param1 === 2);
  check('delete home is refused', throws(() => d.removeItems(base, [0])));
}
{
  const mv = d.moveItem(base, 2, 3);
  check('move: order changes', mv.items[2].x === 35.002 && mv.items[3].x === 35.001);
  check('move the jump target: jump follows it', mv.items[4].param1 === 3, String(mv.items[4].param1));
  const mvJump = d.moveItem(base, 4, 1);
  check('move the jump itself: target still the same waypoint', mvJump.items[1].command === 177 && mvJump.items[3].x === 35.001 && mvJump.items[1].param1 === 3);
  check('move to home is refused', throws(() => d.moveItem(base, 2, 0)));
  check('move to the same place returns the same draft', d.moveItem(base, 2, 2) === base);
  const back = d.moveItem(d.moveItem(base, 1, 5), 5, 1);
  check('move there and back restores the mission', d.draftsEqual(base, back));
}
{
  const up = d.updateItem(base, 3, { z: 55 });
  check('update: changes the field only', up.items[3].z === 55 && up.items[3].x === 35.002 && base.items[3].z === 40);
  check('update home is refused', throws(() => d.updateItem(base, 0, { z: 1 })));
  const pos = d.setItemPosition(base, 3, 35.1, -106.1);
  check('set position: altitude kept', pos.items[3].x === 35.1 && pos.items[3].y === -106.1 && pos.items[3].z === 40);
  check('set position of a jump is refused', throws(() => d.setItemPosition(base, 4, 1, 1)));
}
{
  const toServo = d.changeCommand(base, 3, 183);
  const s = toServo.items[3];
  check('change to a command without location: x/y/z and params cleared', s.command === 183 && s.x === 0 && s.y === 0 && s.z === 0 && s.param1 === 0);
  const toLoiter = d.changeCommand(toServo, 3, 17, { lat: 35.5, lon: -106.5 });
  const l = toLoiter.items[3];
  check('change to a location command: takes the given position and the altitude before it', l.x === 35.5 && l.y === -106.5 && l.z === 30 && l.frame === 3, `${l.z} ${l.frame}`);
  const wpToLoiter = d.changeCommand(base, 3, 19);
  check('location to location: position and altitude kept, params cleared', wpToLoiter.items[3].x === 35.002 && wpToLoiter.items[3].z === 40 && wpToLoiter.items[3].param1 === 0);
  check('change to the same command returns the same draft', d.changeCommand(base, 3, 16) === base);
}
check('jumps targeting: finds the jump', JSON.stringify(d.jumpsTargeting(base, 2)) === '[4]');

// ------------------------------------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------------------------------------
const issues = (draft: any, cat?: any) => d.validateDraft(draft, cat);
const has = (list: any[], index: number, severity: string, text: RegExp) => list.some((i) => i.index === index && i.severity === severity && text.test(i.message));

check('valid mission: no errors', issues(base, 'copter').filter((i: any) => i.severity === 'error').length === 0, JSON.stringify(issues(base, 'copter')));
check('valid mission: no warnings for a copter with takeoff first', issues(base, 'copter').length === 0);
check('empty mission: warns it clears the vehicle', has(issues(d.draftFromWaypoints([HOME] as any)), -1, 'warning', /empty/));
check('location item at 0,0: warning (current location)', has(issues(d.updateItem(base, 2, { x: 0, y: 0 })), 2, 'warning', /no position/));
check('takeoff at 0,0: no issue', !issues(base).some((i: any) => i.index === 1));
check('location out of range: error', has(issues(d.updateItem(base, 2, { x: 91 })), 2, 'error', /outside/));
check('non-number param: error', has(issues(d.updateItem(base, 2, { param1: NaN })), 2, 'error', /not a number/));
check('jump past the end: error', has(issues(d.updateItem(base, 4, { param1: 9 })), 4, 'error', /not an item/));
check('jump to home: error', has(issues(d.updateItem(base, 4, { param1: 0 })), 4, 'error', /not an item/));
check('jump to itself: error', has(issues(d.updateItem(base, 4, { param1: 4 })), 4, 'error', /itself/));
check('jump repeat below -1: error', has(issues(d.updateItem(base, 4, { param2: -2 })), 4, 'error', /repeat/));
check('jump repeat -1 (forever) is allowed', !issues(d.updateItem(base, 4, { param2: -1 })).some((i: any) => i.index === 4));
check('terrain frame: warning', has(issues(d.updateItem(base, 2, { frame: 10 })), 2, 'warning', /terrain/));
check('odd frame: warning', has(issues(d.updateItem(base, 2, { frame: 1 })), 2, 'warning', /frame/));
check('below home: warning', has(issues(d.updateItem(base, 2, { z: -5 })), 2, 'warning', /below home/));
check('land below home is fine', !issues(d.updateItem(base, 5, { z: -5 })).some((i: any) => i.index === 5));
{
  const noTakeoff = d.removeItems(base, [1]);
  check('copter without takeoff first: warning', has(issues(noTakeoff, 'copter'), 1, 'warning', /takeoff/));
  check('plane without takeoff first: warning', has(issues(noTakeoff, 'plane'), 1, 'warning', /takeoff/));
  check('rover without takeoff: no warning', !issues(noTakeoff, 'rover').some((i: any) => /takeoff/.test(i.message)));
}
check('home is not validated', !issues(d.draftFromWaypoints([{ ...HOME, lat: 0, lon: 0 }, ...waypoints.filter((w) => w.seq > 0)] as any)).some((i: any) => i.index === 0));

// ------------------------------------------------------------------------------------------------
// Comparison
// ------------------------------------------------------------------------------------------------
{
  check('same draft: equal', d.draftsEqual(base, d.draftFromWaypoints(waypoints as any)));
  // What the vehicle sends back after an upload: float32 params, int frames reported plain, alt rounded to cm,
  // a different home, autocontinue missing.
  const readBack = d.draftFromItems(
    d.draftToItems(base).map((it: any) => ({
      ...it,
      param1: Math.fround(it.param1),
      frame: it.frame === 3 ? 6 : it.frame,
      z: it.frame === 2 ? it.z : Math.round(it.z * 100) / 100 + 0.004,
      x: it.seq === 0 ? 35.5 : it.x,
      autocontinue: undefined,
    }))
  );
  check('read-back within the vehicle\'s precision: equal', d.draftsEqual(base, readBack), JSON.stringify(d.compareDrafts(base, readBack)));
  const moved = d.updateItem(base, 2, { x: 35.0011 });
  check('moved waypoint: structural difference', d.compareDrafts(base, moved).structural.length === 1);
  const higher = d.updateItem(base, 2, { z: 30.5 });
  check('altitude change: structural difference', /altitude/.test(d.compareDrafts(base, higher).structural.join()));
  const delay = d.updateItem(base, 2, { param1: 5 });
  const c = d.compareDrafts(base, delay);
  check('param change: a param difference only', c.structural.length === 0 && c.params.length === 1, JSON.stringify(c));
  const jump = d.updateItem(base, 4, { param1: 3 });
  check('jump target change: structural', /jump target/.test(d.compareDrafts(base, jump).structural.join()));
  check('item count change: structural', d.compareDrafts(base, d.removeItems(base, [3])).structural.length > 0);
  const servo = d.changeCommand(base, 3, 183);
  const servo2 = d.updateItem(servo, 3, { z: 1 });
  check('non-location x/y/z compared as params', d.compareDrafts(servo, servo2).params.length === 1 && d.compareDrafts(servo, servo2).structural.length === 0);
}

// ------------------------------------------------------------------------------------------------
// Undo / redo
// ------------------------------------------------------------------------------------------------
{
  let h = d.historyInit(base);
  const a = d.appendWaypoint(base, 35.01, -106.01);
  const b = d.removeItems(a, [1]);
  h = d.historyPush(d.historyPush(h, a), b);
  check('history: present is the latest', h.present === b && h.past.length === 2);
  h = d.historyUndo(h);
  check('undo: previous state', h.present === a && h.future.length === 1);
  h = d.historyRedo(h);
  check('redo: forward again', h.present === b);
  h = d.historyPush(d.historyUndo(h), base);
  check('a new edit after undo drops redo', h.future.length === 0 && h.present === base);
  check('undo with nothing to undo: unchanged', d.historyUndo(d.historyInit(base)).present === base);
  check('pushing the same state: no new entry', d.historyPush(d.historyInit(base), base).past.length === 0);
  let big = d.historyInit(0 as number);
  for (let i = 1; i <= 150; i++) big = d.historyPush(big, i);
  check('history: capped at the limit', big.past.length === d.HISTORY_LIMIT && big.past[0] === 50);
}

// ------------------------------------------------------------------------------------------------
// File round trip
// ------------------------------------------------------------------------------------------------
{
  const edited = d.appendWaypoint(d.moveItem(base, 2, 3), 35.0031234, -106.0021234);
  const text = toQgcWpl(d.draftToItems(edited));
  const parsed = parseDroppedMissionFile('draft.waypoints', new TextEncoder().encode(text));
  const loaded = parsed ? d.draftFromItems(parsed.items) : null;
  check('save to .waypoints and load: same mission', Boolean(loaded) && d.draftsEqual(edited, loaded!), loaded ? JSON.stringify(d.compareDrafts(edited, loaded)) : 'no parse');
}

console.log(failures.length ? `\n${failures.length} mission draft check(s) FAILED` : '\nAll mission draft checks PASSED');
process.exit(failures.length ? 1 : 0);
