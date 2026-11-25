// Cockpit tabs: the layout tree's rules, kept free of React so they can be tested.
//
// A Cockpit tab's widgets stay in tab.widgets (as in a Flow tab); its layout refers to them by instance ID: one may
// be pinned as a header above the panes (the quick-actions bar, whose Takeoff checklist grows), the rest are panes
// in a tree of row/column splits sized in percentages, so one layout scales from HD to 4K to ultrawide. Every
// layout that comes in (saved, imported, edited) goes through sanitizeCockpit: only known widgets, each once, a
// bounded depth and pane count, sizes that sum to 100.

import type { CockpitLayout, CockpitNode, PlacedWidget } from '../types/widget';

export const MAX_DEPTH = 6;
export const MAX_PANES = 24;
/** Separator thickness between panes, px (counted in the minimum sizes). */
export const SEPARATOR_PX = 6;

export function isPane(n: CockpitNode): n is { pane: string } {
  return 'pane' in n;
}

/** Sizes for n children: the given ones when usable (finite, positive, n of them), else equal; scaled to sum 100. */
export function normalizeSizes(sizes: unknown, n: number): number[] {
  if (n <= 0) return [];
  const ok = Array.isArray(sizes) && sizes.length === n && sizes.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
  const raw = ok ? (sizes as number[]) : Array(n).fill(1);
  const total = raw.reduce((a, b) => a + b, 0);
  // Each at least 0.5 (a zero would read as invalid next time, resetting the split), to the hundredth.
  const out = raw.map((v) => Math.max(0.5, Math.round((v / total) * 100 * 100) / 100));
  // The sum exactly 100 (three thirds round to 99.99): the difference goes to the largest.
  const big = out.indexOf(Math.max(...out));
  out[big] = Math.round((out[big] + 100 - out.reduce((a, b) => a + b, 0)) * 100) / 100;
  return out;
}

/**
 * A safe layout from anything (saved, imported, after an edit): panes only for widgets in `widgetIds`, each used
 * once (and not also the header), splits with at least two children (a split of one is that child), at most
 * MAX_DEPTH deep and MAX_PANES panes, sizes normalized. Null for something that isn't a layout at all.
 */
export function sanitizeCockpit(raw: unknown, widgetIds: Iterable<string>): CockpitLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const ids = new Set(widgetIds);
  const r = raw as { header?: unknown; root?: unknown };
  const header = typeof r.header === 'string' && ids.has(r.header) ? r.header : null;
  const used = new Set<string>(header ? [header] : []);
  let panes = 0;
  const walk = (n: unknown, depth: number): CockpitNode | null => {
    if (!n || typeof n !== 'object' || depth > MAX_DEPTH) return null;
    const node = n as { pane?: unknown; split?: unknown; children?: unknown; sizes?: unknown };
    if (typeof node.pane === 'string') {
      if (!ids.has(node.pane) || used.has(node.pane) || panes >= MAX_PANES) return null;
      used.add(node.pane);
      panes++;
      return { pane: node.pane };
    }
    if ((node.split === 'row' || node.split === 'column') && Array.isArray(node.children)) {
      const kept: { child: CockpitNode; size: unknown }[] = [];
      node.children.forEach((c, i) => {
        const child = walk(c, depth + 1);
        if (child) kept.push({ child, size: Array.isArray(node.sizes) ? node.sizes[i] : undefined });
      });
      if (kept.length === 0) return null;
      if (kept.length === 1) return kept[0].child;
      const sizes = kept.map((k) => k.size);
      return { split: node.split, children: kept.map((k) => k.child), sizes: normalizeSizes(sizes.every((s) => s !== undefined) ? sizes : null, kept.length) };
    }
    return null;
  };
  return { header, root: walk(r.root, 0) };
}

/** The layout's widgets in reading order: the header, then the panes (left to right, top to bottom). */
export function panesInOrder(layout: CockpitLayout | null | undefined): string[] {
  if (!layout) return [];
  const out: string[] = layout.header ? [layout.header] : [];
  const walk = (n: CockpitNode | null) => {
    if (!n) return;
    if (isPane(n)) out.push(n.pane);
    else n.children.forEach(walk);
  };
  walk(layout.root);
  return out;
}

/** The layout with a widget taken out (its space goes to its neighbours). */
export function removeFromLayout(layout: CockpitLayout, instanceId: string, widgetIds: Iterable<string>): CockpitLayout {
  const ids = [...widgetIds].filter((id) => id !== instanceId);
  return sanitizeCockpit(layout, ids) ?? { header: null, root: null };
}

/** The layout with a widget added as a pane: a new column at the right of a row layout, else beside everything. */
export function appendPane(layout: CockpitLayout, instanceId: string): CockpitLayout {
  const pane: CockpitNode = { pane: instanceId };
  const root = layout.root;
  if (!root) return { ...layout, root: pane };
  if (!isPane(root) && root.split === 'row') {
    const n = root.children.length;
    return { ...layout, root: { ...root, children: [...root.children, pane], sizes: normalizeSizes([...root.sizes.map((s) => (s * n) / (n + 1)), 100 / (n + 1)], n + 1) } };
  }
  return { ...layout, root: { split: 'row', children: [root, pane], sizes: [75, 25] } };
}

/** The node at `path` (child indexes from the root), or null. */
export function nodeAt(root: CockpitNode | null, path: number[]): CockpitNode | null {
  let n = root;
  for (const i of path) {
    if (!n || isPane(n)) return null;
    n = n.children[i] ?? null;
  }
  return n;
}

/** The layout with the split at `path` given new sizes (after a divider drag). */
export function setSplitSizes(layout: CockpitLayout, path: number[], sizes: number[]): CockpitLayout {
  const update = (n: CockpitNode, depth: number): CockpitNode => {
    if (isPane(n)) return n;
    if (depth === path.length) return { ...n, sizes: normalizeSizes(sizes, n.children.length) };
    return { ...n, children: n.children.map((c, i) => (i === path[depth] ? update(c, depth + 1) : c)) };
  };
  return layout.root && nodeAt(layout.root, path) && !isPane(nodeAt(layout.root, path)!) ? { ...layout, root: update(layout.root, 0) } : layout;
}

export interface Size {
  w: number;
  h: number;
}

/** The smallest a pane showing this widget may be (px): what it needs to stay readable and usable. */
export function widgetMinSize(widgetId: string): Size {
  switch (widgetId) {
    case 'built-in-hud':
    case 'built-in-pfd':
      // At this size the HUD's readouts are at 0.8x and its compass tape narrowed (HudWidget), clear of each other.
      return { w: 380, h: 250 };
    case 'built-in-map':
      return { w: 320, h: 240 };
    case 'built-in-charts':
    case 'built-in-parameters':
    case 'built-in-inspector':
    case 'built-in-pid-tuning':
      return { w: 360, h: 260 };
    case 'built-in-logs':
    case 'built-in-ntrip':
      return { w: 320, h: 240 };
    case 'built-in-statustext':
      return { w: 300, h: 180 };
    case 'built-in-statustext-mini':
      return { w: 260, h: 110 };
    case 'built-in-glareshield':
    case 'built-in-arm-modes':
      return { w: 360, h: 110 };
    case 'built-in-all-modes':
    case 'built-in-set-speed':
    case 'built-in-waypoints':
      return { w: 260, h: 140 };
    case 'built-in-battery-card':
    case 'built-in-gps-card':
    case 'built-in-vfr-hud':
      // Their first row of figures; the rest scrolls in a short pane.
      return { w: 240, h: 110 };
    default:
      return { w: 220, h: 140 };
  }
}

/** The least room the panes need: rows add widths, columns add heights (plus separators). */
export function minLayoutSize(root: CockpitNode | null, minFor: (instanceId: string) => Size): Size {
  if (!root) return { w: 0, h: 0 };
  if (isPane(root)) return minFor(root.pane);
  const kids = root.children.map((c) => minLayoutSize(c, minFor));
  const seps = SEPARATOR_PX * (kids.length - 1);
  return root.split === 'row'
    ? { w: kids.reduce((a, k) => a + k.w, 0) + seps, h: Math.max(...kids.map((k) => k.h)) }
    : { w: Math.max(...kids.map((k) => k.w)), h: kids.reduce((a, k) => a + k.h, 0) + seps };
}

/** Whether the panes fit the room, with `slack` px to spare (so the choice doesn't flicker at the boundary). */
export function layoutFits(need: Size, room: Size, slack = 0): boolean {
  return need.w + slack <= room.w && need.h + slack <= room.h;
}

// ------------------------------------------------------------------------------------------------
// Presets
// ------------------------------------------------------------------------------------------------

export type CockpitPresetId = 'hd' | 'ultrawide' | 'map-first' | 'from-tab';

export const COCKPIT_PRESETS: { id: CockpitPresetId; name: string; description: string }[] = [
  { id: 'hd', name: 'HD cockpit', description: 'HUD and map side by side, telemetry cards beneath (16:9 screens).' },
  { id: 'ultrawide', name: 'Ultrawide', description: 'HUD | map | a column of telemetry and messages (21:9 screens).' },
  { id: 'map-first', name: 'Map first', description: 'A large map with the HUD and telemetry in a side column.' },
  { id: 'from-tab', name: "This tab's widgets", description: 'The widgets already on the tab: large ones on top, small ones beneath.' },
];

/** Widgets that want room (instruments, maps, lists) rather than a card's worth. */
const LARGE = new Set(['built-in-hud', 'built-in-pfd', 'built-in-map', 'built-in-charts', 'built-in-parameters', 'built-in-statustext', 'built-in-inspector', 'built-in-logs', 'built-in-pid-tuning', 'built-in-ntrip']);
const QUICK_ACTIONS = new Set(['built-in-glareshield', 'built-in-arm-modes']);

/**
 * A preset applied to a tab: the widgets it uses (the tab's own where it has them, new instances otherwise; the
 * tab's other widgets are kept, unplaced) and the layout. `newId` makes instance IDs.
 */
export function buildPreset(preset: CockpitPresetId, existing: PlacedWidget[], newId: () => string): { widgets: PlacedWidget[]; layout: CockpitLayout } {
  const widgets = [...existing];
  const taken = new Set<string>();
  // A widget the preset wants, by any of its names (older profiles have built-in-arm-modes for the quick actions,
  // built-in-pfd for the HUD): the tab's own instance when it has one, else a new one under the first name.
  const ALIASES: Record<string, string[]> = {
    'built-in-glareshield': ['built-in-glareshield', 'built-in-arm-modes'],
    'built-in-hud': ['built-in-hud', 'built-in-pfd'],
  };
  const use = (widgetId: string): string => {
    const names = ALIASES[widgetId] ?? [widgetId];
    const have = widgets.find((w) => names.includes(w.widgetId) && !taken.has(w.instanceId));
    if (have) {
      taken.add(have.instanceId);
      return have.instanceId;
    }
    const placed: PlacedWidget = { instanceId: newId(), widgetId, colSpan: 6 };
    widgets.push(placed);
    taken.add(placed.instanceId);
    return placed.instanceId;
  };
  const p = (widgetId: string): CockpitNode => ({ pane: use(widgetId) });
  const row = (children: CockpitNode[], sizes: number[]): CockpitNode => ({ split: 'row', children, sizes });
  const col = (children: CockpitNode[], sizes: number[]): CockpitNode => ({ split: 'column', children, sizes });

  let header: string | null;
  let root: CockpitNode | null;
  if (preset === 'from-tab') {
    const qa = existing.find((w) => QUICK_ACTIONS.has(w.widgetId));
    header = qa ? use(qa.widgetId) : null;
    const rest = existing.filter((w) => !taken.has(w.instanceId));
    rest.forEach((w) => taken.add(w.instanceId));
    const big = rest.filter((w) => LARGE.has(w.widgetId)).map((w) => ({ pane: w.instanceId }) as CockpitNode);
    const small = rest.filter((w) => !LARGE.has(w.widgetId)).map((w) => ({ pane: w.instanceId }) as CockpitNode);
    const bigRow = big.length > 1 ? row(big, []) : big[0] ?? null;
    const smallRow = small.length > 1 ? row(small, []) : small[0] ?? null;
    root = bigRow && smallRow ? col([bigRow, smallRow], [70, 30]) : bigRow ?? smallRow;
  } else {
    header = use('built-in-glareshield');
    if (preset === 'hd') {
      root = col([row([p('built-in-hud'), p('built-in-map')], [45, 55]), row([p('built-in-vfr-hud'), p('built-in-battery-card'), p('built-in-gps-card')], [])], [64, 36]);
    } else if (preset === 'ultrawide') {
      root = row(
        [p('built-in-hud'), p('built-in-map'), col([p('built-in-vfr-hud'), p('built-in-battery-card'), p('built-in-gps-card'), p('built-in-statustext-mini')], [])],
        [30, 46, 24]
      );
    } else {
      root = row([p('built-in-map'), col([p('built-in-hud'), p('built-in-vfr-hud'), p('built-in-statustext-mini')], [50, 30, 20])], [70, 30]);
    }
  }
  const layout = sanitizeCockpit({ header, root }, widgets.map((w) => w.instanceId)) ?? { header: null, root: null };
  return { widgets, layout };
}
