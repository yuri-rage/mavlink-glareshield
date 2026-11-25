// Cockpit tab layouts (src/lib/cockpitLayout.ts).
import {
  appendPane,
  buildPreset,
  layoutFits,
  minLayoutSize,
  normalizeSizes,
  panesInOrder,
  removeFromLayout,
  sanitizeCockpit,
  setSplitSizes,
  widgetMinSize,
  MAX_DEPTH,
  SEPARATOR_PX,
} from '../src/lib/cockpitLayout.ts';
import type { PlacedWidget } from '../src/types/widget.ts';

const failures: string[] = [];
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures.push(name);
}
const J = JSON.stringify;

// Sanitizing.
{
  const ids = ['a', 'b', 'c', 'h'];
  const s = sanitizeCockpit({ header: 'h', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [30, 90] } }, ids)!;
  check('a valid layout is kept, sizes scaled to 100', J(s) === J({ header: 'h', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [25, 75] } }), J(s));
  const unknown = sanitizeCockpit({ header: 'zz', root: { split: 'row', children: [{ pane: 'a' }, { pane: 'nope' }, { pane: 'b' }], sizes: [1, 1, 1] } }, ids)!;
  check('unknown widgets dropped (header and panes)', unknown.header === null && J(panesInOrder(unknown)) === J(['a', 'b']), J(unknown));
  const dup = sanitizeCockpit({ header: 'a', root: { split: 'column', children: [{ pane: 'a' }, { pane: 'b' }, { pane: 'b' }] } }, ids)!;
  check('each widget once (header counts)', J(dup.root) === J({ pane: 'b' }), J(dup));
  const one = sanitizeCockpit({ header: null, root: { split: 'row', children: [{ pane: 'c' }] } }, ids)!;
  check('a split of one is that child', J(one.root) === J({ pane: 'c' }));
  let deep: any = { pane: 'a' };
  for (let i = 0; i < MAX_DEPTH + 3; i++) deep = { split: 'row', children: [deep, { pane: i === 0 ? 'b' : 'zz' }] };
  const d = sanitizeCockpit({ header: null, root: deep }, ids)!;
  check('too deep: the over-deep part is dropped', !panesInOrder(d).includes('a'), J(panesInOrder(d)));
  check('junk is no layout', sanitizeCockpit('x', ids) === null && sanitizeCockpit(null, ids) === null);
  check('bad sizes become equal', J(normalizeSizes([1, -2], 2)) === J([50, 50]) && J(normalizeSizes([1, NaN, 1], 3)) === J([33.34, 33.33, 33.33]));
check('a tiny share stays above zero (a zero would reset the split next time)', J(normalizeSizes([99999, 1], 2)) === J([99.5, 0.5]));
check('sizes always sum to exactly 100', [[1, 1, 1], [1, 2, 3, 4, 5, 6, 7], [3, 7]].every((v) => Math.round(normalizeSizes(v, v.length).reduce((a, b) => a + b, 0) * 100) === 10000));
}

// Editing.
{
  const ids = ['a', 'b', 'c'];
  const lay = sanitizeCockpit({ header: null, root: { split: 'row', children: [{ pane: 'a' }, { split: 'column', children: [{ pane: 'b' }, { pane: 'c' }], sizes: [50, 50] }], sizes: [60, 40] } }, ids)!;
  const r = removeFromLayout(lay, 'b', ids);
  check('removing a pane collapses its split', J(r.root) === J({ split: 'row', children: [{ pane: 'a' }, { pane: 'c' }], sizes: [60, 40] }), J(r.root));
  const a1 = appendPane({ header: null, root: null }, 'a');
  check('first pane is the root', J(a1.root) === J({ pane: 'a' }));
  const a2 = appendPane(appendPane(a1, 'b'), 'c');
  check('appended panes join the row, the others keeping their proportions', J(a2.root) === J({ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }, { pane: 'c' }], sizes: [50, 16.67, 33.33] }), J(a2.root));
  const s = setSplitSizes(lay, [1], [20, 80]);
  check('sizes set on the split at a path', J((s.root as any).children[1].sizes) === J([20, 80]) && J((s.root as any).sizes) === J([60, 40]));
  check('a path to a pane changes nothing', setSplitSizes(lay, [0], [1, 2]) === lay);
}

// Minimum sizes.
{
  const ids = ['hud', 'map', 'bat'];
  const lay = sanitizeCockpit({ header: null, root: { split: 'column', children: [{ split: 'row', children: [{ pane: 'hud' }, { pane: 'map' }] }, { pane: 'bat' }] } }, ids)!;
  const kinds: Record<string, string> = { hud: 'built-in-hud', map: 'built-in-map', bat: 'built-in-battery-card' };
  const need = minLayoutSize(lay.root, (id) => widgetMinSize(kinds[id]));
  check('rows add widths, columns add heights (with separators)', need.w === 380 + 320 + SEPARATOR_PX && need.h === Math.max(250, 240) + 110 + SEPARATOR_PX, J(need));
  check('fits a 1920x1000 room', layoutFits(need, { w: 1900, h: 900 }));
  check("doesn't fit a phone", !layoutFits(need, { w: 360, h: 700 }));
  check('slack keeps it from flickering at the edge', layoutFits(need, { w: need.w, h: need.h }) && !layoutFits(need, { w: need.w, h: need.h }, 16));
}

// Presets.
{
  let n = 0;
  const newId = () => `new-${++n}`;
  const tab: PlacedWidget[] = [
    { instanceId: 'w-qa', widgetId: 'built-in-glareshield', colSpan: 12 },
    { instanceId: 'w-hud', widgetId: 'built-in-hud', colSpan: 6 },
    { instanceId: 'w-map', widgetId: 'built-in-map', colSpan: 6 },
    { instanceId: 'w-vfr', widgetId: 'built-in-vfr-hud', colSpan: 4 },
    { instanceId: 'w-x', widgetId: 'built-in-inspector', colSpan: 4 },
  ];
  const hd = buildPreset('hd', tab, newId);
  check('HD preset: the quick actions pinned as the header', hd.layout.header === 'w-qa');
  check("HD preset: reuses the tab's widgets, adds what's missing", panesInOrder(hd.layout).includes('w-hud') && panesInOrder(hd.layout).includes('w-map') && hd.widgets.some((w) => w.widgetId === 'built-in-battery-card' && w.instanceId.startsWith('new-')));
  check("HD preset: the tab's other widgets are kept (unplaced)", hd.widgets.some((w) => w.instanceId === 'w-x') && !panesInOrder(hd.layout).includes('w-x'));
  const uw = buildPreset('ultrawide', tab, newId);
  check('Ultrawide preset: three columns', (uw.layout.root as any).split === 'row' && (uw.layout.root as any).children.length === 3);
  const legacy: PlacedWidget[] = [
    { instanceId: 'old-qa', widgetId: 'built-in-arm-modes' },
    { instanceId: 'old-pfd', widgetId: 'built-in-pfd' },
  ];
  const lp = buildPreset('hd', legacy, newId);
  check('presets reuse older names (arm-modes, pfd) instead of adding duplicates', lp.layout.header === 'old-qa' && panesInOrder(lp.layout).includes('old-pfd') && !lp.widgets.some((w) => w.widgetId === 'built-in-glareshield' || w.widgetId === 'built-in-hud'));
  const ft = buildPreset('from-tab', tab, newId);
  check("From the tab: all its widgets, large ones on top", J(panesInOrder(ft.layout)) === J(['w-qa', 'w-hud', 'w-map', 'w-x', 'w-vfr']) && (ft.layout.root as any).split === 'column', J(panesInOrder(ft.layout)));
  check('From the tab: adds nothing', ft.widgets.length === tab.length);
}

// Editing.
{
  const { splitPane, replacePane, swapPanes, movePane } = await import('../src/lib/cockpitLayout.ts');
  const ids = ['a', 'b', 'c', 'n'];
  const base = sanitizeCockpit({ header: null, root: { split: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [60, 40] } }, ids)!;
  const r = splitPane(base, 'b', 'right', 'n');
  check('split beside, same direction: a sibling taking half the room', J(r.root) === J({ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }, { pane: 'n' }], sizes: [60, 20, 20] }), J(r.root));
  const l = splitPane(base, 'a', 'left', 'n');
  check('split to the left: before it', J(panesInOrder(l)) === J(['n', 'a', 'b']));
  const d = splitPane(base, 'b', 'bottom', 'n');
  check('split below in a row: the pane becomes a column', J(d.root) === J({ split: 'row', children: [{ pane: 'a' }, { split: 'column', children: [{ pane: 'b' }, { pane: 'n' }], sizes: [50, 50] }], sizes: [60, 40] }), J(d.root));
  const single = splitPane({ header: null, root: { pane: 'a' } }, 'a', 'top', 'n');
  check('split a lone pane', J(single.root) === J({ split: 'column', children: [{ pane: 'n' }, { pane: 'a' }], sizes: [50, 50] }));
  check('replace a pane', J(panesInOrder(replacePane(base, 'b', 'c'))) === J(['a', 'c']));
  const s = swapPanes(base, 'a', 'b');
  check('swap keeps the places and sizes', J(s.root) === J({ split: 'row', children: [{ pane: 'b' }, { pane: 'a' }], sizes: [60, 40] }));
  const three = sanitizeCockpit({ header: null, root: { split: 'column', children: [{ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }] }, { pane: 'c' }], sizes: [70, 30] } }, ids)!;
  const m = movePane(three, 'c', 'a', 'left', ids);
  check('move to an edge: out of its place, beside the target', J(m.root) === J({ split: 'row', children: [{ pane: 'c' }, { pane: 'a' }, { pane: 'b' }], sizes: [25, 25, 50] }), J(m.root));
  check('move to the centre: a swap', J(panesInOrder(movePane(three, 'c', 'a', 'center', ids))) === J(['c', 'b', 'a']));
  check('move onto itself: nothing', movePane(three, 'a', 'a', 'left', ids) === three);
  const sib = movePane(base, 'a', 'b', 'right', ids);
  check('move past its own sibling', J(panesInOrder(sib)) === J(['b', 'a']) && J((sib.root as any).sizes) === J([50, 50]), J(sib.root));
}

console.log(failures.length ? `\n${failures.length} cockpit-layout check(s) FAILED` : '\nAll cockpit-layout checks PASSED');
if (failures.length) process.exit(1);
