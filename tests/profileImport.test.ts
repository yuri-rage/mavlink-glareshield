// Importing a profile (src/store/dashboardStore.ts parseProfileImport): malformed entries are dropped rather than
// crashing the import preview, actions stay confirmed, and the cleaned profile imports as previewed.
export {};
(globalThis as any).localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const { parseProfileImport, useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { profileVehicleControls } = await import('../src/lib/vehicleControls.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

check('not JSON: null', parseProfileImport('{nope') === null);
check('no tabs: null', parseProfileImport('{}') === null && parseProfileImport('{"tabs":"x"}') === null);
check('only malformed tabs: null', parseProfileImport('{"tabs":[null, 3, "x", {"title":"no id"}]}') === null);

const json = JSON.stringify({
  name: 'Field',
  tabs: [
    null,
    { id: 't1', title: 'Flight', widgets: [null, { instanceId: 'w1', widgetId: 'builtin-hud' }, { widgetId: 'x' }] },
    { id: 't2', widgets: 'not an array' },
  ],
  customWidgets: [
    null,
    'x',
    { name: 'no id' },
    {
      id: 'c1',
      name: 'Relay',
      displayType: 'button',
      action: { label: 'Relay on', commandId: 181, params: [0, 1], confirmation: false },
    },
  ],
});
const p = parseProfileImport(json);
check('mixed: the good tabs kept', p?.tabs.map((t) => t.id).join(',') === 't1,t2', p?.tabs.map((t) => t.id).join(','));
check('a tab without a title gets one', p?.tabs[1].title === 'Tab');
check('malformed placed widgets dropped', p?.tabs[0].widgets.length === 1 && p.tabs[1].widgets.length === 0);
check('malformed custom widgets dropped', p?.customWidgets.length === 1 && p.customWidgets[0].id === 'c1');
check('an imported action is confirmed', p?.customWidgets[0].action?.confirmation === true);
let previewOk = true;
try {
  profileVehicleControls(p!);
  p!.tabs.map((t) => t.title).join(', ');
} catch {
  previewOk = false;
}
check('the preview reads it without throwing', previewOk);

// Apply: the preview's profile, as the modal passes it, imports the same.
check('applying the previewed profile imports it', useDashboardStore.getState().importProfileJson(JSON.stringify(p)));
const after = useDashboardStore.getState().profile;
check(
  'imported as previewed (cleaning twice changes nothing)',
  JSON.stringify(after.tabs) === JSON.stringify(p!.tabs) &&
    JSON.stringify(after.customWidgets) === JSON.stringify(p!.customWidgets)
);
check(
  'importProfileJson refuses {"tabs":[null]}',
  useDashboardStore.getState().importProfileJson('{"tabs":[null]}') === false
);

console.log(
  failures.length ? `\n${failures.length} profile-import check(s) FAILED` : '\nAll profile-import checks PASSED'
);
process.exit(failures.length ? 1 : 0);
