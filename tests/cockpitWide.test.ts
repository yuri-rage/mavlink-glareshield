// A Cockpit tab's wide layout (ultrawide screens): when it's used, and that editing it leaves the standard one alone.
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, String(v)), removeItem: (k: string) => mem.delete(k) };
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { panesInOrder, variantFor, WIDE_ASPECT } = await import('../src/lib/cockpitLayout.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const J = JSON.stringify;

check(`wide only past ${WIDE_ASPECT}:1, and only if the tab has one`, variantFor(true, 3440, 1305) === 'wide' && variantFor(true, 1920, 970) === 'standard' && variantFor(true, 2560, 1305) === 'standard' && variantFor(false, 3440, 1305) === 'standard');

const st = () => useDashboardStore.getState();
const hud = () => st().profile.tabs.find((t) => t.id === 'tab-flight')!;
st().setActiveTab('tab-flight');
st().setTabMode('tab-flight', 'cockpit');
st().setEditVariant('standard');
st().applyCockpitPreset('tab-flight', 'hd');
const standard = J(hud().cockpit);

st().addWideLayout('tab-flight');
check('a wide layout starts as a copy of the standard one, and is then edited', J(hud().cockpitWide) === standard && st().editVariant === 'wide');

st().applyCockpitPreset('tab-flight', 'ultrawide');
check('a preset while editing the wide layout changes only it', J(hud().cockpit) === standard && (hud().cockpitWide!.root as any).children.length === 3);
st().setCockpitSizes('tab-flight', [], [20, 60, 20]);
st().moveInCockpit('tab-flight', 'w-hud', 'w-map-flight', 'center');
st().unplaceFromCockpit('tab-flight', 'w-gps');
check('sizes, moves and hiding in the wide layout leave the standard one as it was', J(hud().cockpit) === standard && !panesInOrder(hud().cockpitWide).includes('w-gps') && panesInOrder(hud().cockpit).includes('w-gps'));

st().addWidgetToActiveTab('built-in-charts');
const charts = hud().widgets.find((w) => w.widgetId === 'built-in-charts')!.instanceId;
check('a widget added while editing the wide layout: placed there, not shown in the standard one', panesInOrder(hud().cockpitWide).includes(charts) && !panesInOrder(hud().cockpit).includes(charts));

st().setEditVariant('standard');
st().unplaceFromCockpit('tab-flight', 'w-vfr');
check('editing the standard layout leaves the wide one alone', !panesInOrder(hud().cockpit).includes('w-vfr') && panesInOrder(hud().cockpitWide).includes('w-vfr'));

st().removeWidgetFromActiveTab('w-battery');
check('a widget removed from the tab leaves both layouts', !panesInOrder(hud().cockpit).includes('w-battery') && !panesInOrder(hud().cockpitWide).includes('w-battery'));

st().setEditVariant('wide');
st().removeWideLayout('tab-flight');
check('removing the wide layout: gone, the standard one kept, editing it again', !hud().cockpitWide && !!hud().cockpit && st().editVariant === 'standard');

// Import: a wide layout is cleaned like the standard one.
st().importProfileJson(J({ version: '1', name: 'w', updatedAt: '', customWidgets: [], tabs: [{ id: 't', title: 'T', mode: 'cockpit', widgets: [{ instanceId: 'a', widgetId: 'built-in-hud' }], cockpit: { header: null, root: { pane: 'a' } }, cockpitWide: { header: 'zz', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'ghost' }] } } }] }));
const t = st().profile.tabs[0];
check('an imported wide layout is cleaned', J(t.cockpitWide) === J({ header: null, root: { pane: 'a' } }), J(t.cockpitWide));

console.log(failures.length ? `\n${failures.length} wide-layout check(s) FAILED` : '\nAll wide-layout checks PASSED');
if (failures.length) process.exit(1);
