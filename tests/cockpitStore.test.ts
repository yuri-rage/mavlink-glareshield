// Cockpit tabs in the dashboard store: switching, presets, adding and removing widgets, deleting a custom widget,
// importing (src/store/dashboardStore.ts), and the import safety check (src/lib/vehicleControls.ts).
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { panesInOrder } = await import('../src/lib/cockpitLayout.ts');
const { profileVehicleControls } = await import('../src/lib/vehicleControls.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const st = () => useDashboardStore.getState();
const hud = () => st().profile.tabs.find((t) => t.id === 'tab-flight')!;
st().setActiveTab('tab-flight');

st().setTabMode('tab-flight', 'cockpit');
check('to Cockpit: a layout from the tab\'s widgets, quick actions pinned', hud().mode === 'cockpit' && hud().cockpit?.header === 'w-glareshield' && panesInOrder(hud().cockpit).length === hud().widgets.length, JSON.stringify(hud().cockpit));

st().addWidgetToActiveTab('built-in-statustext-mini');
const added = hud().widgets[hud().widgets.length - 1].instanceId;
check('a widget added to a Cockpit tab gets a pane', panesInOrder(hud().cockpit).includes(added));
st().removeWidgetFromActiveTab(added);
check('a removed widget loses its pane', !panesInOrder(hud().cockpit).includes(added) && !hud().widgets.some((w) => w.instanceId === added));

// Quick actions added to a Cockpit tab with no header: pinned as the header.
st().unplaceFromCockpit('tab-flight', 'w-glareshield');
st().removeWidgetFromActiveTab('w-glareshield');
st().addWidgetToActiveTab('built-in-glareshield');
const qa = hud().widgets[hud().widgets.length - 1].instanceId;
check('quick actions added to a headerless Cockpit tab are pinned as its header', hud().cockpit?.header === qa);

st().unplaceFromCockpit('tab-flight', 'w-gps');
check('hidden: off the layout, still on the tab', !panesInOrder(hud().cockpit).includes('w-gps') && hud().widgets.some((w) => w.instanceId === 'w-gps'));
st().placeInCockpit('tab-flight', 'w-gps');
check('shown again as a pane', panesInOrder(hud().cockpit).includes('w-gps'));

st().applyCockpitPreset('tab-flight', 'ultrawide');
check('Ultrawide preset: adds Mini Messages, keeps the HUD it had', hud().widgets.some((w) => w.widgetId === 'built-in-statustext-mini') && panesInOrder(hud().cockpit).includes('w-hud'));
st().setCockpitSizes('tab-flight', [], [20, 60, 20]);
check('divider sizes saved', JSON.stringify((hud().cockpit!.root as any).sizes) === JSON.stringify([20, 60, 20]));

st().setTabMode('tab-flight', 'flow');
const kept = JSON.stringify(hud().cockpit);
check('back to Flow keeps the layout', hud().mode === undefined && !!hud().cockpit);
st().setTabMode('tab-flight', 'cockpit');
check('and Cockpit again restores it', JSON.stringify(hud().cockpit) === kept);

// A custom widget placed in the layout, then deleted: gone from the tab and the layout.
const customId = st().profile.customWidgets[0].id;
st().addWidgetToActiveTab(customId);
const cInst = hud().widgets.find((w) => w.widgetId === customId)!.instanceId;
check('custom widget placed', panesInOrder(hud().cockpit).includes(cInst));
st().deleteCustomWidget(customId);
check('deleting the custom widget removes its pane', !panesInOrder(hud().cockpit).includes(cInst) && !hud().widgets.some((w) => w.instanceId === cInst));

// Import: a hostile layout is cleaned (unknown widget, duplicates, junk); built-in controls still flagged.
const imported = {
  version: '1.0.0',
  name: 'x',
  updatedAt: '',
  customWidgets: [],
  tabs: [
    {
      id: 't1',
      title: 'Cockpit',
      mode: 'cockpit',
      widgets: [
        { instanceId: 'a', widgetId: 'built-in-hud' },
        { instanceId: 'b', widgetId: 'built-in-arm-modes' },
      ],
      cockpit: { header: 'ghost', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'a' }, { pane: 'nope' }, { pane: 'b' }, 7, { split: 'diagonal' }], sizes: ['x'] } },
    },
  ],
};
check('import accepted', st().importProfileJson(JSON.stringify(imported)));
const t1 = st().profile.tabs[0];
check('imported layout cleaned', t1.cockpit?.header === null && JSON.stringify(panesInOrder(t1.cockpit)) === JSON.stringify(['a', 'b']) && JSON.stringify((t1.cockpit!.root as any).sizes) === JSON.stringify([50, 50]), JSON.stringify(t1.cockpit));
check('import safety check sees controls in a Cockpit tab', profileVehicleControls(imported as any).some((c) => c.builtin));

console.log(failures.length ? `\n${failures.length} cockpit-store check(s) FAILED` : '\nAll cockpit-store checks PASSED');
if (failures.length) process.exit(1);
