// Cockpit tabs in the dashboard store: switching, presets, adding and removing widgets, deleting a custom widget,
// importing (src/store/dashboardStore.ts), and the import safety check (src/lib/vehicleControls.ts).
export {};
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => mem.set(k, String(v)),
  removeItem: (k: string) => mem.delete(k),
};
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

// The defaults: the flying tabs and Configuration are Cockpit tabs (HUD with a wide layout too), Telemetry is Flow,
// and every default layout is already clean (sanitizing leaves it as written).
{
  const { reconcileTab } = await import('../src/store/dashboardStore.ts');
  const tabs = st().profile.tabs;
  const mode = (id: string) => tabs.find((t) => t.id === id)?.mode ?? 'flow';
  check(
    'defaults: HUD, Moving Map and Configuration are Cockpit; Telemetry is Flow',
    mode('tab-flight') === 'cockpit' &&
      mode('tab-map') === 'cockpit' &&
      mode('tab-console') === 'cockpit' &&
      mode('tab-telemetry') === 'flow'
  );
  check('defaults: HUD has a wide layout', !!hud().cockpitWide);
  check(
    'defaults: every layout is valid as written',
    tabs.every((t) => JSON.stringify(reconcileTab(t)) === JSON.stringify(t)),
    tabs.map((t) => t.id).join()
  );
}

// From here, a HUD tab as an older profile has it (Flow, no layouts), to switch it ourselves.
st().updateTab('tab-flight', (t) => ({
  id: t.id,
  title: t.title,
  widgets: t.widgets.filter((w) => w.widgetId !== 'built-in-statustext-mini'),
}));

st().setTabMode('tab-flight', 'cockpit');
check(
  "to Cockpit: a layout from the tab's widgets, quick actions pinned",
  hud().mode === 'cockpit' &&
    hud().cockpit?.header === 'w-glareshield' &&
    panesInOrder(hud().cockpit).length === hud().widgets.length,
  JSON.stringify(hud().cockpit)
);

st().addWidgetToActiveTab('built-in-statustext-mini');
const added = hud().widgets[hud().widgets.length - 1].instanceId;
check('a widget added to a Cockpit tab gets a pane', panesInOrder(hud().cockpit).includes(added));
st().removeWidgetFromActiveTab(added);
check(
  'a removed widget loses its pane',
  !panesInOrder(hud().cockpit).includes(added) && !hud().widgets.some((w) => w.instanceId === added)
);

// Quick actions added to a Cockpit tab with no header: pinned as the header.
st().unplaceFromCockpit('tab-flight', 'w-glareshield');
st().removeWidgetFromActiveTab('w-glareshield');
st().addWidgetToActiveTab('built-in-glareshield');
const qa = hud().widgets[hud().widgets.length - 1].instanceId;
check('quick actions added to a headerless Cockpit tab are pinned as its header', hud().cockpit?.header === qa);
st().unplaceFromCockpit('tab-flight', qa);
st().placeInCockpit('tab-flight', qa);
check(
  'hidden quick actions shown again are re-pinned as the header',
  hud().cockpit?.header === qa && !panesInOrder({ header: null, root: hud().cockpit!.root }).includes(qa)
);

st().unplaceFromCockpit('tab-flight', 'w-gps');
check(
  'hidden: off the layout, still on the tab',
  !panesInOrder(hud().cockpit).includes('w-gps') && hud().widgets.some((w) => w.instanceId === 'w-gps')
);
st().placeInCockpit('tab-flight', 'w-gps');
check('shown again as a pane', panesInOrder(hud().cockpit).includes('w-gps'));

st().applyCockpitPreset('tab-flight', 'ultrawide');
check(
  'Ultrawide preset: adds Mini Messages, keeps the HUD it had',
  hud().widgets.some((w) => w.widgetId === 'built-in-statustext-mini') && panesInOrder(hud().cockpit).includes('w-hud')
);
st().setCockpitSizes('tab-flight', [], [20, 60, 20]);
check('divider sizes saved', JSON.stringify((hud().cockpit!.root as any).sizes) === JSON.stringify([20, 60, 20]));

st().setTabMode('tab-flight', 'flow');
const kept = JSON.stringify(hud().cockpit);
check('back to Flow keeps the layout', hud().mode === undefined && !!hud().cockpit);
st().setTabMode('tab-flight', 'cockpit');
check('and Cockpit again restores it', JSON.stringify(hud().cockpit) === kept);

// The editor's actions.
{
  st().applyCockpitPreset('tab-flight', 'hd');
  const before = hud().widgets.length;
  st().splitInCockpit('tab-flight', 'w-hud', 'bottom', { widgetId: 'built-in-charts' });
  const charts = hud().widgets.find((w) => w.widgetId === 'built-in-charts')!;
  check(
    'Add below: a new widget, in a pane under the HUD',
    hud().widgets.length === before + 1 &&
      panesInOrder(hud().cockpit).indexOf(charts.instanceId) === panesInOrder(hud().cockpit).indexOf('w-hud') + 1
  );
  st().unplaceFromCockpit('tab-flight', 'w-gps');
  st().splitInCockpit('tab-flight', 'w-map-flight', 'right', { instanceId: 'w-gps' });
  check(
    'Add beside: a hidden widget comes back (no duplicate)',
    panesInOrder(hud().cockpit).includes('w-gps') &&
      hud().widgets.filter((w) => w.widgetId === 'built-in-gps-card').length === 1
  );
  st().replaceInCockpit('tab-flight', charts.instanceId, { widgetId: 'built-in-statustext' });
  check(
    'Change: the pane shows another widget; the old one stays on the tab, hidden',
    !panesInOrder(hud().cockpit).includes(charts.instanceId) &&
      hud().widgets.some((w) => w.instanceId === charts.instanceId) &&
      hud().widgets.some((w) => w.widgetId === 'built-in-statustext')
  );
  const order = panesInOrder(hud().cockpit);
  st().moveInCockpit('tab-flight', 'w-hud', 'w-map-flight', 'center');
  const swapped = panesInOrder(hud().cockpit);
  check(
    'Swap: two panes exchange places',
    swapped.indexOf('w-hud') === order.indexOf('w-map-flight') &&
      swapped.indexOf('w-map-flight') === order.indexOf('w-hud')
  );
  st().moveInCockpit('tab-flight', 'w-vfr', 'w-hud', 'left');
  const moved = panesInOrder(hud().cockpit);
  check('Move to an edge: beside the target', moved.indexOf('w-vfr') === moved.indexOf('w-hud') - 1);
}

// Guards: bad targets and sources change nothing and leave no stray widget.
{
  const before = JSON.stringify(hud());
  st().splitInCockpit('tab-flight', 'no-such-pane', 'right', { widgetId: 'built-in-charts' });
  check("split beside a pane that isn't shown: nothing changes (no widget added)", JSON.stringify(hud()) === before);
  st().replaceInCockpit('tab-flight', 'w-hud', { instanceId: 'w-map-flight' });
  check('replace with a widget already shown: nothing changes (no pane lost)', JSON.stringify(hud()) === before);
  st().splitInCockpit('tab-flight', 'w-hud', 'right', { instanceId: 'ghost' });
  check('split with a widget not on the tab: nothing changes', JSON.stringify(hud()) === before);
}

// Whole edges.
{
  st().applyCockpitPreset('tab-flight', 'hd');
  st().addAtEdgeInCockpit('tab-flight', 'bottom', { widgetId: 'built-in-charts' });
  // The newest (an earlier check left another Charts widget on the tab, hidden).
  const charts = hud().widgets[hud().widgets.length - 1].instanceId;
  const root = hud().cockpit!.root as any;
  check(
    'a chart along the whole bottom: the last row of the root column, full width',
    root.split === 'column' && root.children[root.children.length - 1].pane === charts
  );
  st().moveToEdgeInCockpit('tab-flight', 'w-gps', 'right');
  const r2 = hud().cockpit!.root as any;
  check(
    'a pane moved down the whole right side',
    r2.split === 'row' && r2.children[r2.children.length - 1].pane === 'w-gps'
  );
  const before = JSON.stringify(hud());
  st().addAtEdgeInCockpit('tab-flight', 'top', { instanceId: 'w-hud' });
  check("a widget already shown can't be added again at an edge", JSON.stringify(hud()) === before);
  st().removeWidgetFromActiveTab(charts);
}

// Unpin and pin the quick-actions bar.
{
  st().applyCockpitPreset('tab-flight', 'hd');
  const qa = hud().cockpit!.header!;
  st().unpinInCockpit('tab-flight');
  check(
    'unpinned: the bar is a pane, nothing pinned',
    hud().cockpit!.header === null && panesInOrder(hud().cockpit).includes(qa)
  );
  st().pinInCockpit('tab-flight', 'w-hud');
  check('only the quick-actions bar can be pinned', hud().cockpit!.header === null);
  st().pinInCockpit('tab-flight', qa);
  check(
    'pinned again',
    hud().cockpit!.header === qa && panesInOrder(hud().cockpit).filter((x) => x === qa).length === 1
  );
}

// A custom widget placed in the layout, then deleted: gone from the tab and the layout.
const customId = st().profile.customWidgets[0].id;
st().addWidgetToActiveTab(customId);
const cInst = hud().widgets.find((w) => w.widgetId === customId)!.instanceId;
check('custom widget placed', panesInOrder(hud().cockpit).includes(cInst));
st().deleteCustomWidget(customId);
check(
  'deleting the custom widget removes its pane',
  !panesInOrder(hud().cockpit).includes(cInst) && !hud().widgets.some((w) => w.instanceId === cInst)
);

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
      cockpit: {
        header: 'ghost',
        root: {
          split: 'row',
          children: [{ pane: 'a' }, { pane: 'a' }, { pane: 'nope' }, { pane: 'b' }, 7, { split: 'diagonal' }],
          sizes: ['x'],
        },
      },
    },
  ],
};
check('import accepted', st().importProfileJson(JSON.stringify(imported)));
const t1 = st().profile.tabs[0];
check(
  'imported layout cleaned',
  t1.cockpit?.header === null &&
    JSON.stringify(panesInOrder(t1.cockpit)) === JSON.stringify(['a', 'b']) &&
    JSON.stringify((t1.cockpit!.root as any).sizes) === JSON.stringify([50, 50]),
  JSON.stringify(t1.cockpit)
);
check(
  'import safety check sees controls in a Cockpit tab',
  profileVehicleControls(imported as any).some((c) => c.builtin)
);

// At the pane limit: Add does nothing, and leaves no widget unplaced on the tab.
{
  const ids = Array.from({ length: 24 }, (_, i) => `m${i}`);
  st().importProfileJson(
    JSON.stringify({
      version: '1',
      name: 'full',
      updatedAt: '',
      customWidgets: [],
      tabs: [
        {
          id: 'tf',
          title: 'Full',
          mode: 'cockpit',
          widgets: ids.map((id) => ({ instanceId: id, widgetId: 'built-in-battery-card' })),
          cockpit: { header: null, root: { split: 'row', children: ids.map((id) => ({ pane: id })) } },
        },
      ],
    })
  );
  const tf = () => st().profile.tabs.find((t) => t.id === 'tf')!;
  const before = JSON.stringify(tf());
  st().splitInCockpit('tf', 'm0', 'right', { widgetId: 'built-in-charts' });
  check(
    'a 25th pane: nothing changes (no pane lost, no orphan widget)',
    JSON.stringify(tf()) === before && tf().widgets.length === 24
  );
}

console.log(
  failures.length ? `\n${failures.length} cockpit-store check(s) FAILED` : '\nAll cockpit-store checks PASSED'
);
if (failures.length) process.exit(1);
