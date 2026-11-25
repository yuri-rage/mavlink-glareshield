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

// Limits and flattening.
{
  const { splitPane, swapPanes, movePane, placedOrUnchanged } = await import('../src/lib/cockpitLayout.ts');
  const ids = ['a', 'b', 'c', 'd'];
  const nested = sanitizeCockpit({ header: null, root: { split: 'row', children: [{ pane: 'a' }, { split: 'column', children: [{ pane: 'b' }, { split: 'row', children: [{ pane: 'c' }, { pane: 'd' }], sizes: [50, 50] }], sizes: [50, 50] }], sizes: [40, 60] } }, ids)!;
  const flat = removeFromLayout(nested, 'b', ids);
  check('removing a pane merges a same-direction split into its parent (sizes in proportion, summing to 100)', J(flat.root) === J({ split: 'row', children: [{ pane: 'a' }, { pane: 'c' }, { pane: 'd' }], sizes: [40, 30, 30] }), J(flat.root));

  // A pane at the deepest level (6): splitting it across would put two panes deeper than allowed.
  const deepIds = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'q', 's'];
  let node: any = { pane: 'p6' };
  for (let lvl = 5; lvl >= 0; lvl--) node = { split: lvl % 2 === 0 ? 'row' : 'column', children: [{ pane: `p${lvl}` }, node] };
  // One more pane at the top, whose removal doesn't make the chain any shorter.
  node.children.unshift({ pane: 's' });
  const deep = sanitizeCockpit({ header: null, root: node }, deepIds)!;
  check('built a pane at depth 6', panesInOrder(deep).includes('p6'), J(panesInOrder(deep)));
  const across = sanitizeCockpit(splitPane(deep, 'p6', 'right', 'q'), deepIds);
  check('past the depth limit the split would drop both panes (what the guard is for)', !panesInOrder(across).includes('p6'));
  check('...so the guarded edit changes nothing', placedOrUnchanged(deep, across, ['q']) === deep);
  check('moving a pane to a too-deep place: nothing changes, no pane lost', movePane(deep, 's', 'p6', 'right', deepIds) === deep);
  check('moving one whose leaving makes room: allowed, nothing lost', panesInOrder(movePane(deep, 'p0', 'p6', 'right', deepIds)).length === panesInOrder(deep).length);

  // At the pane limit (24): a 25th can't be added.
  const many = Array.from({ length: 24 }, (_, i) => `m${i}`);
  const full = sanitizeCockpit({ header: null, root: { split: 'row', children: many.map((m) => ({ pane: m })) } }, [...many, 'x'])!;
  const over = sanitizeCockpit(splitPane(full, 'm0', 'right', 'x'), [...many, 'x']);
  check('past the pane limit, sanitizing drops a pane elsewhere (the last)', !panesInOrder(over).includes('m23'));
  check('...so the guarded split changes nothing', placedOrUnchanged(full, over, ['x']) === full);

  const two = sanitizeCockpit({ header: null, root: { split: 'column', children: [{ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [30, 70] }, { split: 'row', children: [{ pane: 'c' }, { pane: 'd' }], sizes: [80, 20] }], sizes: [60, 40] } }, ids)!;
  const sw = swapPanes(two, 'a', 'd');
  check('a swap across branches keeps both splits\' sizes', J((sw.root as any).children.map((c: any) => c.sizes)) === J([[30, 70], [80, 20]]) && J(panesInOrder(sw)) === J(['d', 'b', 'c', 'a']));
}

// Whole edges: a pane across the whole bottom (or down a whole side).
{
  const { addAtEdge, movePaneToEdge } = await import('../src/lib/cockpitLayout.ts');
  const ids = ['a', 'b', 'c', 's'];
  const grid = sanitizeCockpit({ header: null, root: { split: 'column', children: [{ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }] }, { pane: 'c' }], sizes: [60, 40] } }, ids)!;
  const bottom = addAtEdge(grid, 's', 'bottom');
  check('along the bottom of a column layout: another full-width row', J(bottom.root) === J({ split: 'column', children: [{ split: 'row', children: [{ pane: 'a' }, { pane: 'b' }], sizes: [50, 50] }, { pane: 'c' }, { pane: 's' }], sizes: [45, 30, 25] }), J(bottom.root));
  const left = addAtEdge(grid, 's', 'left');
  check('down the left of a column layout: a full-height column beside everything', J(left.root) === J({ split: 'row', children: [{ pane: 's' }, grid.root], sizes: [25, 75] }), J(left.root));
  const row = sanitizeCockpit({ header: null, root: { split: 'row', children: [{ pane: 'a' }, { split: 'column', children: [{ pane: 'b' }, { pane: 'c' }] }], sizes: [50, 50] } }, ids)!;
  const moved = movePaneToEdge(row, 'b', 'bottom', ids);
  check('a pane moved to the whole bottom: out of its place, full width below the rest', J(moved.root) === J({ split: 'column', children: [{ split: 'row', children: [{ pane: 'a' }, { pane: 'c' }], sizes: [50, 50] }, { pane: 'b' }], sizes: [75, 25] }), J(moved.root));
  const lone = movePaneToEdge(sanitizeCockpit({ header: null, root: { pane: 'a' } }, ids)!, 'a', 'bottom', ids);
  check('the only pane to an edge: still the only pane', J(lone.root) === J({ pane: 'a' }));
}

// Custom widgets' minimum size, from their definition.
{
  const { customWidgetMinSize } = await import('../src/lib/cockpitLayout.ts');
  const stat = customWidgetMinSize({ id: 'x', name: 'x', category: 'telemetry', displayType: 'stat-card' } as any);
  check('a single stat card: small', stat.w === 220 && stat.h < 160, J(stat));
  const twoUp = customWidgetMinSize({ id: 'y', name: 'y', category: 'telemetry', displayType: 'composite', panels: [{ displayType: 'stat-card', span: 6 }, { displayType: 'stat-card', span: 6 }, { displayType: 'sparkline', span: 12 }] } as any);
  check('a composite with panels side by side: wide enough not to stack, two rows tall', twoUp.w === 360 && twoUp.h >= 70 + 130 + 40, J(twoUp));
  const withHud = customWidgetMinSize({ id: 'z', name: 'z', category: 'telemetry', displayType: 'composite', panels: [{ displayType: 'builtin', widgetId: 'built-in-hud' }] } as any);
  check('a composite holding the HUD: at least the HUD panel\'s own minimum', withHud.h >= 300, J(withHud));
  const { widgetMinSize, CUSTOM_MIN_H_CAP } = await import('../src/lib/cockpitLayout.ts');
  const params = customWidgetMinSize({ id: 'p', name: 'p', category: 'custom', displayType: 'composite', panels: [{ displayType: 'builtin', widgetId: 'built-in-parameters' }] } as any);
  check('a built-in panel asks what the widget asks in a pane (not its Flow-card minimum)', params.h <= widgetMinSize('built-in-parameters').h + 100, J(params));
  const tall = customWidgetMinSize({ id: 't', name: 't', category: 'custom', displayType: 'composite', panels: [1, 2, 3, 4].map(() => ({ displayType: 'sparkline' })) } as any);
  check('a tall composite is capped (the pane scrolls it, the tab doesn\'t stack)', tall.h === CUSTOM_MIN_H_CAP, J(tall));
  const longList = customWidgetMinSize({ id: 'l', name: 'l', category: 'telemetry', displayType: 'value-list', binding: {}, bindings: Array.from({ length: 15 }, () => ({})) } as any);
  check('a long value list is capped too', longList.h === CUSTOM_MIN_H_CAP, J(longList));
  const rc = customWidgetMinSize({ id: 'r', name: 'r', category: 'telemetry', displayType: 'composite', panels: [{ displayType: 'multi-bar', multiBarConfig: { group: 'rc-8' } }] } as any);
  const one = customWidgetMinSize({ id: 'o', name: 'o', category: 'telemetry', displayType: 'composite', panels: [{ displayType: 'stat-card' }] } as any);
  check('eight RC bars ask for eight bars\' height (from the group, not the bindings)', rc.h - one.h > 120, `${rc.h} vs ${one.h}`);
}

console.log(failures.length ? `\n${failures.length} cockpit-layout check(s) FAILED` : '\nAll cockpit-layout checks PASSED');
if (failures.length) process.exit(1);
