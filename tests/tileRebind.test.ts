// Changing a tile's value (src/lib/tileRebind.ts): which tiles show one value and can be rebound, what they show
// now, and that a rebind changes only that tile (in a composite) or the widget itself (a single-value widget).
export {};
const { isRebindable, tileValue, rebindTile } = await import('../src/lib/tileRebind.ts');

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

const volt = { messageName: 'SYS_STATUS', fieldName: 'voltage_battery', unit: 'V', decimals: 1 };
const speed = { messageName: 'VFR_HUD', fieldName: 'groundspeed', unit: 'm/s', decimals: 1 };
const composite: any = {
  id: 'w',
  name: 'Vitals',
  category: 'telemetry',
  displayType: 'composite',
  panels: [
    { displayType: 'stat-card', title: 'Voltage', binding: volt, span: 4 },
    { displayType: 'value-list', title: 'Several', binding: volt, bindings: [speed] },
    { displayType: 'builtin', widgetId: 'built-in-gps-card' },
    { displayType: 'action-button', title: 'RTL', binding: volt },
    { displayType: 'gauge-radial', title: 'Throttle', binding: volt, gauge: { layout: 'multiple' }, bindings: [speed] },
  ],
};

check('a stat card with one value: rebindable', isRebindable(composite.panels[0]));
check('a value list with several: not', !isRebindable(composite.panels[1]));
check('a built-in widget: not', !isRebindable(composite.panels[2]));
check('a command button: not', !isRebindable(composite.panels[3]));
check('several gauges in one panel: not', !isRebindable(composite.panels[4]));

const v = tileValue(composite, 0);
check("a tile's value and title", v?.binding.fieldName === 'voltage_battery' && v.title === 'Voltage');
check('a composite as a whole: no single value', tileValue(composite, null) === null);
check('a tile that is not rebindable: none', tileValue(composite, 1) === null);

const after = rebindTile(composite, 0, speed, 'Speed');
check(
  'rebind: that tile shows the new value and title',
  after.panels![0].binding!.fieldName === 'groundspeed' && after.panels![0].title === 'Speed'
);
check('rebind: its other settings stay (width)', after.panels![0].span === 4);
check('rebind: the other panels are untouched', after.panels![1] === composite.panels[1] && after.panels!.length === 5);
check('rebind: the original definition is not changed', composite.panels[0].binding.fieldName === 'voltage_battery');

const single: any = { id: 's', name: 'Bus Voltage', category: 'telemetry', displayType: 'stat-card', binding: volt };
check('a single-value widget: rebindable as a whole', tileValue(single, null)?.title === 'Bus Voltage');
const s2 = rebindTile(single, null, speed, '');
check(
  'a single widget: new value; an empty name keeps the old',
  s2.binding!.fieldName === 'groundspeed' && s2.name === 'Bus Voltage'
);

// Picking another message or field clears what described the old value (units, scaling, thresholds), keeps color.
{
  const { forNewValue } = await import('../src/components/editor/TileRebind.tsx');
  const old = {
    ...volt,
    unit: '%',
    warnThreshold: 30,
    critThreshold: 15,
    thresholdInvert: true,
    multiplier: 0.001,
    color: '#0f0',
  };
  const n = forNewValue(old as any, { ...old, messageName: 'VFR_HUD', fieldName: 'groundspeed' } as any);
  check(
    'another field: units, thresholds and scaling cleared, color kept',
    n.fieldName === 'groundspeed' &&
      n.unit === undefined &&
      n.warnThreshold === undefined &&
      n.multiplier === undefined &&
      n.color === '#0f0'
  );
  const same = forNewValue(old as any, { ...old, decimals: 2 } as any);
  check('the same field, a setting changed: kept as edited', same.warnThreshold === 30 && same.decimals === 2);
}

console.log(failures.length ? `\n${failures.length} tile-rebind check(s) FAILED` : '\nAll tile-rebind checks PASSED');
process.exit(failures.length ? 1 : 0);
