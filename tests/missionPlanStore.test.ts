/**
 * Planning store checks: unsaved-change tracking, edits and undo locked while uploading, the draft after a verified
 * upload, keeping a draft when the vehicle's mission changes, and the draft surviving a reload.
 *
 * Run: npx tsx tests/missionPlanStore.test.ts
 */
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};

const d = await import('../src/mavlink/missionDraft.ts');
const { useMissionPlanStore, isDraftDirty } = await import('../src/store/missionPlanStore.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

const vehicle = d.draftFromWaypoints([
  { seq: 0, command: 16, lat: 35, lon: -106, alt: 1600, current: false, frame: 0 },
  { seq: 1, command: 22, lat: 0, lon: 0, alt: 20, current: false, frame: 3 },
  { seq: 2, command: 16, lat: 35.001, lon: -106.001, alt: 30, current: false, frame: 3 },
] as any);
const S = () => useMissionPlanStore.getState();

S().start(vehicle, { kind: 'vehicle' });
check('start: active, clean, nothing to undo', S().active && !isDraftDirty(S()) && S().history.past.length === 0);

S().edit((x) => d.appendWaypoint(x, 35.002, -106.002), 3);
check('edit: dirty, selects, one undo step', isDraftDirty(S()) && S().selected === 3 && S().history.past.length === 1);

// Reload: a fresh copy of the store module reads the saved draft back.
{
  const saved = JSON.parse(mem.get('mavlink_glareshield_mission_draft') ?? 'null');
  check('saved: active draft with the edit', saved?.active === true && saved.present.items.length === 4 && saved.base.items.length === 3);
}

// Upload lock.
S().setUploading(true);
const before = S().history.present;
S().edit((x) => d.appendWaypoint(x, 36, -107));
S().undo();
S().replace(vehicle, { kind: 'file', name: 'x' });
S().resetToVehicle(vehicle);
check('uploading: edits, undo, replace and reset are ignored', S().history.present === before && S().history.past.length === 1);
S().setUploading(false);

// Verified upload: the read-back becomes draft and base, history starts over.
const readBack = d.updateItem(S().history.present, 2, { param1: Math.fround(0.1) });
S().uploaded(readBack);
check('uploaded: clean, no undo into the old vehicle mission', !isDraftDirty(S()) && S().history.past.length === 0 && S().history.present === readBack);
check('uploaded: source is the vehicle', S().source.kind === 'vehicle');

// The vehicle's mission changes while the draft has edits: keep the draft.
S().edit((x) => d.updateItem(x, 2, { z: 45 }));
S().setVehicleChanged(true);
const otherVehicle = d.removeItems(readBack, [3]);
S().rebase(otherVehicle);
check('keep draft: banner cleared, draft unchanged, still dirty against the new base', !S().vehicleChanged && S().history.present.items[2].z === 45 && isDraftDirty(S()));

// Load the vehicle's instead: undo brings the edits back.
S().setVehicleChanged(true);
S().resetToVehicle(otherVehicle);
check('load vehicle: draft = vehicle, clean, banner cleared', !isDraftDirty(S()) && !S().vehicleChanged);
S().undo();
check('load vehicle then undo: edits back', S().history.present.items[2].z === 45);

// A clean draft follows the vehicle.
S().resetToVehicle(otherVehicle);
S().syncFromVehicle(vehicle);
check('sync: draft and base become the vehicle mission, fresh history', S().history.present === vehicle && S().base === vehicle && S().history.past.length === 0);

// Reload: a second copy of the store module starts from what the first one saved.
{
  S().edit((x) => d.appendWaypoint(x, 35.003, -106.003));
  const fresh = await import('../src/store/missionPlanStore.ts?reload=1' as string);
  check('reload: the second copy is a separate store', fresh.useMissionPlanStore !== useMissionPlanStore);
  const r = fresh.useMissionPlanStore.getState();
  check(
    'reload: planning restored with the edited draft and its base',
    r.active && r.history.present.items.length === S().history.present.items.length && r.base.items.length === S().base.items.length && fresh.isDraftDirty(r),
    `${r.active} ${r.history.present.items.length}`
  );
}

// Review fixes: what happens when the vehicle's mission changes.
{
  const { vehicleMissionUpdate } = await import('../src/store/missionPlanStore.ts');
  const base = { active: true, uploading: false, transferring: false, vehicleKnown: true, dirty: false, vehicleEqualsBase: false };
  check('vehicle update: clean draft follows a changed vehicle mission', vehicleMissionUpdate(base) === 'sync');
  check('vehicle update: clean draft already matching does nothing (keeps redo)', vehicleMissionUpdate({ ...base, vehicleEqualsBase: true }) === 'none');
  check('vehicle update: nothing during a download or upload', vehicleMissionUpdate({ ...base, transferring: true }) === 'none' && vehicleMissionUpdate({ ...base, uploading: true }) === 'none');
  check('vehicle update: nothing before the vehicle mission is known (after a reload)', vehicleMissionUpdate({ ...base, dirty: true, vehicleKnown: false }) === 'none');
  check('vehicle update: dirty draft + changed vehicle shows the banner', vehicleMissionUpdate({ ...base, dirty: true }) === 'changed');
  check('vehicle update: dirty draft + vehicle back to base clears it', vehicleMissionUpdate({ ...base, dirty: true, vehicleEqualsBase: true }) === 'unchanged');
  check('vehicle update: not planning does nothing', vehicleMissionUpdate({ ...base, active: false }) === 'none');
}
check('replace while uploading reports it was refused', (() => {
  S().setUploading(true);
  const r = S().replace(vehicle, { kind: 'file', name: 'x' });
  S().setUploading(false);
  return r === false;
})());
check('replace when allowed reports success', S().replace(vehicle, { kind: 'file', name: 'x' }) === true);

// Number fields commit only typed changes (tabbing through a rounded field changes nothing).
{
  const { typedValue } = await import('../src/components/map/MissionPlanPanel.tsx');
  check('number field: unchanged rounded text commits nothing', typedValue('98', '98', true) === null && typedValue(' 98 ', '98', true) === null);
  check('number field: typed value commits', typedValue('120', '98', true) === 120);
  check('number field: junk commits nothing', typedValue('abc', '98', true) === null && typedValue('', '98', true) === null);
  // Focused, not typed, and the pin was dragged meanwhile: the old text must not be written back over the drag.
  check('number field: not typed commits nothing even when the value moved', typedValue('35.0010000', '35.0020000', false) === null);
}

// Rally layer: its own draft, history, base and selection; undo/redo follow the active layer.
{
  const r = await import('../src/store/missionPlanStore.ts');
  const rd = await import('../src/mavlink/rallyDraft.ts');
  const rally = rd.rallyDraftFromPoints([{ seq: 0, lat: 35.01, lon: -106.01, alt: 50, frame: 3 }] as any);
  S().start(vehicle, { kind: 'vehicle' }, rally);
  check('rally: starts clean with the vehicle rally points', !r.isRallyDirty(S()) && S().rally.history.present.points.length === 1 && S().layer === 'mission');

  S().rallyEdit((x) => rd.addRallyPoint(x, null, 35.02, -106.02).draft, 1);
  check('rally edit: dirty, selected, mission untouched', r.isRallyDirty(S()) && S().rally.selected === 1 && !isDraftDirty(S()) && r.isAnyDirty(S()));

  S().edit((x) => d.appendWaypoint(x, 35.002, -106.002));
  S().undo(); // mission layer active: undoes the mission edit only
  check('undo on the mission layer leaves the rally draft alone', !isDraftDirty(S()) && S().rally.history.present.points.length === 2);
  S().setLayer('rally');
  S().undo();
  check('undo on the rally layer undoes the rally edit', !r.isRallyDirty(S()) && S().rally.history.present.points.length === 1 && S().rally.selected === null);
  S().redo();
  check('redo on the rally layer', S().rally.history.present.points.length === 2);

  S().setUploading(true);
  const before = S().rally.history.present;
  S().rallyEdit((x) => rd.removeRallyPoint(x, 0));
  S().undo();
  check('rally: edits and undo locked while uploading', S().rally.history.present === before && S().rallyReplace(rally) === false);
  S().setUploading(false);

  // Saved across a reload, both layers.
  const saved = JSON.parse(mem.get('mavlink_glareshield_mission_draft') ?? 'null');
  check('saved: rally draft and base alongside the mission', saved?.rally?.present?.points?.length === 2 && saved?.rally?.base?.points?.length === 1);
  const fresh = await import('../src/store/missionPlanStore.ts?rally=1' as string);
  check('reload: rally draft restored, still dirty', fresh.useMissionPlanStore.getState().rally.history.present.points.length === 2 && fresh.isRallyDirty(fresh.useMissionPlanStore.getState()));

  // A draft saved before rally editing (no rally field) still loads, with an empty rally layer.
  const old = JSON.parse(mem.get('mavlink_glareshield_mission_draft')!);
  delete old.rally;
  mem.set('mavlink_glareshield_mission_draft', JSON.stringify(old));
  const fromOld = await import('../src/store/missionPlanStore.ts?rally=2' as string);
  check('older saved draft (mission only) loads, rally layer empty and clean',
    fromOld.useMissionPlanStore.getState().active && fromOld.useMissionPlanStore.getState().rally.history.present.points.length === 0 && !fromOld.isRallyDirty(fromOld.useMissionPlanStore.getState()));

  // Keep / load / sync / uploaded, as for the mission.
  const moved = rd.moveRallyPoint(rally, 0, 35.5, -106.5);
  S().setRallyVehicleChanged(true);
  S().rallyRebase(moved);
  check('rally keep draft: banner cleared, draft kept', !S().rally.vehicleChanged && S().rally.history.present.points.length === 2);
  S().rallyResetToVehicle(moved);
  check('rally load vehicle: clean', !r.isRallyDirty(S()));
  S().undo();
  check('rally load vehicle then undo: edits back', S().rally.history.present.points.length === 2);
  S().rallySyncFromVehicle(rally);
  check('rally sync: fresh history', S().rally.history.past.length === 0 && S().rally.base === rally);
  S().rallyEdit((x) => rd.updateRallyPoint(x, 0, { alt: 70 }));
  S().rallyUploaded(rally);
  check('rally uploaded: clean, fresh history', !r.isRallyDirty(S()) && S().rally.history.past.length === 0);

  S().stop();
  check('stop: rally layer cleared, mission layer active', S().rally.history.present.points.length === 0 && S().layer === 'mission');
  S().start(vehicle, { kind: 'vehicle' });
}

S().setTool('add');
S().stop();
check('stop: inactive, tool back to select, saved draft removed', !S().active && S().tool === 'select' && !mem.has('mavlink_glareshield_mission_draft'));
S().edit((x) => d.appendWaypoint(x, 1, 1));
check('edit while not planning: ignored', S().history.present.items.length === 0);

console.log(failures.length ? `\n${failures.length} planning store check(s) FAILED` : '\nAll planning store checks PASSED');
process.exit(failures.length ? 1 : 0);
