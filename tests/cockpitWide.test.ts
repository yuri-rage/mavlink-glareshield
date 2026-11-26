// A Cockpit tab's wide layout (ultrawide screens): when it's used, and that editing it leaves the standard one alone.
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => mem.set(k, String(v)),
  removeItem: (k: string) => mem.delete(k),
};
const { useDashboardStore } = await import('../src/store/dashboardStore.ts');
const { panesInOrder, variantFor, WIDE_ASPECT } = await import('../src/lib/cockpitLayout.ts');

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const J = JSON.stringify;

check(
  `wide only past ${WIDE_ASPECT}:1, and only if the tab has one`,
  variantFor(true, 3440, 1305) === 'wide' &&
    variantFor(true, 1920, 970) === 'standard' &&
    variantFor(true, 2560, 1305) === 'standard' &&
    variantFor(false, 3440, 1305) === 'standard'
);
check('a phone in landscape (915x310) stays standard', variantFor(true, 915, 310) === 'standard');

const st = () => useDashboardStore.getState();
const hud = () => st().profile.tabs.find((t) => t.id === 'tab-flight')!;
st().setActiveTab('tab-flight');
// Start from a HUD tab without a wide layout (the default has one), to make it here.
st().removeWideLayout('tab-flight');
st().setTabMode('tab-flight', 'cockpit');
st().setEditVariant('standard');
st().applyCockpitPreset('tab-flight', 'hd');
const standard = J(hud().cockpit);

st().addWideLayout('tab-flight');
check(
  'a wide layout starts as a copy of the standard one, and is then edited',
  J(hud().cockpitWide) === standard && st().editVariant === 'wide'
);

st().applyCockpitPreset('tab-flight', 'ultrawide');
check(
  'a preset while editing the wide layout changes only it',
  J(hud().cockpit) === standard && (hud().cockpitWide!.root as any).children.length === 3
);
st().setCockpitSizes('tab-flight', [], [20, 60, 20]);
st().moveInCockpit('tab-flight', 'w-hud', 'w-map-flight', 'center');
st().unplaceFromCockpit('tab-flight', 'w-gps');
check(
  'sizes, moves and hiding in the wide layout leave the standard one as it was',
  J(hud().cockpit) === standard &&
    !panesInOrder(hud().cockpitWide).includes('w-gps') &&
    panesInOrder(hud().cockpit).includes('w-gps')
);

const std0 = J(hud().cockpit);
st().splitInCockpit('tab-flight', 'w-map-flight', 'bottom', { widgetId: 'built-in-statustext' });
const msgs = hud().widgets.find((w) => w.widgetId === 'built-in-statustext')!.instanceId;
st().replaceInCockpit('tab-flight', 'w-vfr', { widgetId: 'built-in-inspector' });
st().placeInCockpit('tab-flight', 'w-gps');
check(
  'split, replace and show while editing the wide layout leave the standard one alone',
  J(hud().cockpit) === std0 &&
    panesInOrder(hud().cockpitWide).includes(msgs) &&
    panesInOrder(hud().cockpitWide).includes('w-gps') &&
    !panesInOrder(hud().cockpitWide).includes('w-vfr')
);
st().replaceInCockpit('tab-flight', hud().widgets.find((w) => w.widgetId === 'built-in-inspector')!.instanceId, {
  instanceId: 'w-vfr',
});

st().addWidgetToActiveTab('built-in-charts');
const charts = hud().widgets.find((w) => w.widgetId === 'built-in-charts')!.instanceId;
check(
  'a widget added while editing the wide layout: placed there, not shown in the standard one',
  panesInOrder(hud().cockpitWide).includes(charts) && !panesInOrder(hud().cockpit).includes(charts)
);

st().setEditVariant('standard');
st().unplaceFromCockpit('tab-flight', 'w-vfr');
check(
  'editing the standard layout leaves the wide one alone',
  !panesInOrder(hud().cockpit).includes('w-vfr') && panesInOrder(hud().cockpitWide).includes('w-vfr')
);

st().removeWidgetFromActiveTab('w-battery');
check(
  'a widget removed from the tab leaves both layouts',
  !panesInOrder(hud().cockpit).includes('w-battery') && !panesInOrder(hud().cockpitWide).includes('w-battery')
);

// A custom widget in both layouts, deleted: gone from both.
{
  const customId = st().profile.customWidgets[0].id;
  st().setEditVariant('wide');
  st().addWidgetToActiveTab(customId);
  const inst = hud().widgets.find((w) => w.widgetId === customId)!.instanceId;
  st().setEditVariant('standard');
  st().placeInCockpit('tab-flight', inst);
  check(
    'custom widget placed in both layouts',
    panesInOrder(hud().cockpit).includes(inst) && panesInOrder(hud().cockpitWide).includes(inst)
  );
  st().deleteCustomWidget(customId);
  check(
    'deleting the custom widget removes it from both layouts',
    !panesInOrder(hud().cockpit).includes(inst) && !panesInOrder(hud().cockpitWide).includes(inst)
  );
}

st().setEditVariant('wide');
st().removeWideLayout('tab-flight');
check(
  'removing the wide layout: gone, the standard one kept, editing it again',
  !hud().cockpitWide && !!hud().cockpit && st().editVariant === 'standard'
);

// Import: a wide layout is cleaned like the standard one.
st().importProfileJson(
  J({
    version: '1',
    name: 'w',
    updatedAt: '',
    customWidgets: [],
    tabs: [
      {
        id: 't',
        title: 'T',
        mode: 'cockpit',
        widgets: [{ instanceId: 'a', widgetId: 'built-in-hud' }],
        cockpit: { header: null, root: { pane: 'a' } },
        cockpitWide: { header: 'zz', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'ghost' }] } },
      },
    ],
  })
);
const t = st().profile.tabs[0];
st().setEditVariant('wide');
st().importProfileJson(J({ version: '1', name: 'w2', updatedAt: '', customWidgets: [], tabs: [t] }));
check('an import edits the standard layout again', st().editVariant === 'standard');
check(
  'an imported wide layout is cleaned',
  J(t.cockpitWide) === J({ header: null, root: { pane: 'a' } }),
  J(t.cockpitWide)
);

// A stale active tab id (a profile without the default 'tab-flight', after a reload): the actions act on the tab the
// dashboard shows (the first), not on nothing.
{
  const { shownTabId } = await import('../src/store/dashboardStore.ts');
  st().resetToDefaults();
  const first = st().profile.tabs[0].id;
  st().setActiveTab('no-such-tab');
  check('a stale id resolves to the first tab', shownTabId(st()) === first);
  const before = st().profile.tabs[0].widgets.length;
  st().removeWidgetFromActiveTab(st().profile.tabs[0].widgets[0].instanceId);
  check(
    'Delete with a stale id removes the widget from the tab on screen',
    st().profile.tabs[0].widgets.length === before - 1
  );
}

// Deleting the pinned bar (the default HUD tab pins it in both layouts): gone from the tab and both headers.
{
  st().resetToDefaults();
  st().setActiveTab('tab-flight');
  st().removeWidgetFromActiveTab('w-glareshield');
  const t = st().profile.tabs.find((x) => x.id === 'tab-flight')!;
  check(
    'the pinned bar deleted: off the tab, neither layout pins anything',
    !t.widgets.some((w) => w.instanceId === 'w-glareshield') &&
      t.cockpit!.header === null &&
      t.cockpitWide!.header === null,
    JSON.stringify([t.cockpit!.header, t.cockpitWide!.header])
  );
}

console.log(failures.length ? `\n${failures.length} wide-layout check(s) FAILED` : '\nAll wide-layout checks PASSED');
if (failures.length) process.exit(1);
