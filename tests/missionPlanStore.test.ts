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

S().setTool('add');
S().stop();
check('stop: inactive, tool back to select, saved draft removed', !S().active && S().tool === 'select' && !mem.has('mavlink_glareshield_mission_draft'));
S().edit((x) => d.appendWaypoint(x, 1, 1));
check('edit while not planning: ignored', S().history.present.items.length === 0);

console.log(failures.length ? `\n${failures.length} planning store check(s) FAILED` : '\nAll planning store checks PASSED');
process.exit(failures.length ? 1 : 0);
