// Planning mode: the drafts being edited on the map (the mission, the rally points and the fence as layers), each with
// its undo history and the vehicle's version it started from. Drafts are saved in this browser so switching
// dashboard tabs or reloading doesn't lose work. Nothing here talks to the vehicle: a draft only replaces the
// vehicle's mission, rally points or fence through an upload.

import { create } from 'zustand';

import { EMPTY_FENCE, fenceDraftsEqual, type FenceDraft, type LatLon } from '../mavlink/fenceDraft';
import {
  draftsEqual,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  type History,
  type MissionDraft,
} from '../mavlink/missionDraft';
import { rallyDraftsEqual, type RallyDraft } from '../mavlink/rallyDraft';
import { onActiveVehicleChange } from '../mavlink/vehicleRoster';

const STORAGE_KEY = 'mavlink_glareshield_mission_draft';

/** What a click on the map does while planning: select pins only, or add a waypoint where clicked. */
export type PlanTool = 'select' | 'add'; // 'add' is labeled Place

/** Which draft the map and panel edit. */
export type PlanLayer = 'mission' | 'rally' | 'fence';

/** The rally point draft: the same shape of state as the mission's, kept apart. */
export interface RallyLayerState {
  history: History<RallyDraft>;
  /** The vehicle's rally points when planning started or last synced. */
  base: RallyDraft;
  selected: number | null;
  /** The vehicle's rally points changed after the draft started (and the draft has changes of its own). */
  vehicleChanged: boolean;
}

/** The fence draft, like the rally layer; `selected` is a shape index. */
export interface FenceLayerState {
  history: History<FenceDraft>;
  /** The vehicle's fence when planning started or last synced. */
  base: FenceDraft;
  selected: number | null;
  vehicleChanged: boolean;
}

/** What the Place tool draws on the fence layer. */
export type FenceDrawKind =
  'polygon-inclusion' | 'polygon-exclusion' | 'circle-inclusion' | 'circle-exclusion' | 'return-point';

/** Where the draft came from, shown in the panel. */
export type DraftSource = { kind: 'vehicle' } | { kind: 'file'; name: string } | { kind: 'empty' };

interface MissionPlanState {
  /** Planning mode is on. */
  active: boolean;
  history: History<MissionDraft>;
  /** The mission the draft is compared with for unsaved changes: the vehicle's when planning started or last synced. */
  base: MissionDraft;
  source: DraftSource;
  /** Index of the selected item, or null. */
  selected: number | null;
  tool: PlanTool;
  /** The draft is being uploaded: edits, undo and redo wait until it finishes. */
  uploading: boolean;
  /** The vehicle's mission changed after the draft started (and the draft has changes of its own). */
  vehicleChanged: boolean;
  layer: PlanLayer;
  rally: RallyLayerState;
  fence: FenceLayerState;
  /** What Place draws on the fence layer, and the polygon being drawn (its vertices so far), not yet in the draft. */
  fenceDrawKind: FenceDrawKind;
  fenceDrawing: LatLon[] | null;

  /** Turn planning on with `draft` (and `rally`, `fence`), each also its base (no changes yet). */
  start: (draft: MissionDraft, source: DraftSource, rally?: RallyDraft, fence?: FenceDraft) => void;
  /** Turn planning off and drop the draft. */
  stop: () => void;
  /** Apply an edit to the draft as one undo step. Edits throw on invalid input; the draft is then unchanged. */
  edit: (fn: (d: MissionDraft) => MissionDraft, select?: number | null) => void;
  /** Replace the draft (e.g. a file) as one undo step, keeping the base. False when refused (not planning, or
   *  uploading). */
  replace: (draft: MissionDraft, source: DraftSource) => boolean;
  /** Replace the draft with the vehicle's mission, which also becomes the base; undo brings the edits back. */
  resetToVehicle: (draft: MissionDraft) => void;
  /** Take the vehicle's mission as both draft and base, with a fresh history (nothing to undo into). */
  syncFromVehicle: (draft: MissionDraft) => void;
  /** Undo / redo on the active layer. */
  undo: () => void;
  redo: () => void;
  select: (index: number | null) => void;
  setLayer: (layer: PlanLayer) => void;
  setTool: (tool: PlanTool) => void;
  setUploading: (uploading: boolean) => void;
  setVehicleChanged: (changed: boolean) => void;
  /** Keep the draft, comparing it from now on with `base` (the vehicle's current mission). */
  rebase: (base: MissionDraft) => void;
  /** After a verified upload: what the vehicle holds becomes the draft and the base, with a fresh history. */
  uploaded: (readBack: MissionDraft) => void;

  // The rally layer: the same operations, on the rally draft.
  rallyEdit: (fn: (d: RallyDraft) => RallyDraft, select?: number | null) => void;
  rallyReplace: (draft: RallyDraft) => boolean;
  rallyResetToVehicle: (draft: RallyDraft) => void;
  rallySyncFromVehicle: (draft: RallyDraft) => void;
  rallySelect: (index: number | null) => void;
  setRallyVehicleChanged: (changed: boolean) => void;
  rallyRebase: (base: RallyDraft) => void;
  rallyUploaded: (readBack: RallyDraft) => void;

  // The fence layer: the same operations, on the fence draft (selection is a shape index).
  fenceEdit: (fn: (d: FenceDraft) => FenceDraft, select?: number | null) => void;
  fenceReplace: (draft: FenceDraft) => boolean;
  fenceResetToVehicle: (draft: FenceDraft) => void;
  fenceSyncFromVehicle: (draft: FenceDraft) => void;
  fenceSelect: (index: number | null) => void;
  setFenceVehicleChanged: (changed: boolean) => void;
  fenceRebase: (base: FenceDraft) => void;
  fenceUploaded: (readBack: FenceDraft) => void;
  setFenceDrawKind: (kind: FenceDrawKind) => void;
  /** The polygon being drawn: its vertices so far, or null for none. */
  setFenceDrawing: (vertices: LatLon[] | null) => void;
}

/**
 * What to do when the vehicle's mission (as the app knows it) may have changed while planning:
 * - 'none': nothing. Not planning; a transfer is running (a download arrives item by item, an upload sets the
 *   mission to the draft first); the vehicle's mission isn't known yet (after a reload, before any download, it
 *   looks empty); or a clean draft already matches it (syncing would only throw away redo).
 * - 'sync': the draft has no changes of its own, so it follows the vehicle's mission.
 * - 'changed' / 'unchanged': the draft has changes; show or clear the "vehicle's mission changed" banner.
 */
export function vehicleMissionUpdate(input: {
  active: boolean;
  uploading: boolean;
  transferring: boolean;
  vehicleKnown: boolean;
  dirty: boolean;
  vehicleEqualsBase: boolean;
}): 'none' | 'sync' | 'changed' | 'unchanged' {
  if (!input.active || input.uploading || input.transferring || !input.vehicleKnown) return 'none';
  if (!input.dirty) return input.vehicleEqualsBase ? 'none' : 'sync';
  return input.vehicleEqualsBase ? 'unchanged' : 'changed';
}

/** True when the mission draft differs from the mission it started from. */
export function isDraftDirty(s: Pick<MissionPlanState, 'history' | 'base'>): boolean {
  return !draftsEqual(s.history.present, s.base);
}

/** True when the rally draft differs from the rally points it started from. */
export function isRallyDirty(s: Pick<MissionPlanState, 'rally'>): boolean {
  return !rallyDraftsEqual(s.rally.history.present, s.rally.base);
}

/** True when the fence draft differs from the fence it started from. */
export function isFenceDirty(s: Pick<MissionPlanState, 'fence'>): boolean {
  return !fenceDraftsEqual(s.fence.history.present, s.fence.base);
}

/** Any draft has unsaved changes (for leaving planning, closing the tab, the header dot). */
export function isAnyDirty(s: Pick<MissionPlanState, 'history' | 'base' | 'rally' | 'fence'>): boolean {
  return isDraftDirty(s) || isRallyDirty(s) || isFenceDirty(s);
}

const EMPTY: MissionDraft = { items: [] };
const EMPTY_RALLY: RallyDraft = { points: [] };
const rallyInit = (draft: RallyDraft = EMPTY_RALLY): RallyLayerState => ({
  history: historyInit(draft),
  base: draft,
  selected: null,
  vehicleChanged: false,
});
const fenceInit = (draft: FenceDraft = EMPTY_FENCE): FenceLayerState => ({
  history: historyInit(draft),
  base: draft,
  selected: null,
  vehicleChanged: false,
});
const fitSelection = (sel: number | null, length: number) => (sel !== null && sel < length ? sel : null);

interface Saved {
  active: boolean;
  present: MissionDraft;
  base: MissionDraft;
  source: DraftSource;
  /** Absent in drafts saved before rally editing. */
  rally?: { present: RallyDraft; base: RallyDraft };
  /** Absent in drafts saved before fence editing. */
  fence?: { present: FenceDraft; base: FenceDraft };
}

function isDraft(v: any): v is MissionDraft {
  return Boolean(v) && Array.isArray(v.items) && v.items.every((it: any) => it && typeof it.command === 'number');
}

function isRallyDraft(v: any): v is RallyDraft {
  return (
    Boolean(v) &&
    Array.isArray(v.points) &&
    v.points.every((p: any) => p && ['lat', 'lon', 'alt', 'frame'].every((k) => typeof p[k] === 'number'))
  );
}

function isFenceDraft(v: any): v is FenceDraft {
  const pos = (p: any) => p && typeof p.lat === 'number' && typeof p.lon === 'number';
  return (
    Boolean(v) &&
    Array.isArray(v.shapes) &&
    (v.returnPoint === null || pos(v.returnPoint)) &&
    v.shapes.every(
      (sh: any) =>
        sh &&
        typeof sh.inclusion === 'boolean' &&
        ((sh.kind === 'polygon' && Array.isArray(sh.vertices) && sh.vertices.every(pos)) ||
          (sh.kind === 'circle' && pos(sh.center) && typeof sh.radius === 'number'))
    )
  );
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.active || !isDraft(s.present) || !isDraft(s.base) || s.present.items.length === 0) return null;
    const rally = s.rally && isRallyDraft(s.rally.present) && isRallyDraft(s.rally.base) ? s.rally : undefined;
    const fence = s.fence && isFenceDraft(s.fence.present) && isFenceDraft(s.fence.base) ? s.fence : undefined;
    return { active: true, present: s.present, base: s.base, source: s.source ?? { kind: 'empty' }, rally, fence };
  } catch {
    return null;
  }
}

function save(s: MissionPlanState) {
  try {
    if (!s.active) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const saved: Saved = {
      active: true,
      present: s.history.present,
      base: s.base,
      source: s.source,
      rally: { present: s.rally.history.present, base: s.rally.base },
      fence: { present: s.fence.history.present, base: s.fence.base },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: the draft still works for this session.
  }
}

const restored = load();

export const useMissionPlanStore = create<MissionPlanState>((set, get) => ({
  active: restored?.active ?? false,
  history: historyInit(restored?.present ?? EMPTY),
  base: restored?.base ?? EMPTY,
  source: restored?.source ?? { kind: 'empty' },
  selected: null,
  tool: 'select',
  uploading: false,
  vehicleChanged: false,
  layer: 'mission',
  rally: restored?.rally
    ? { history: historyInit(restored.rally.present), base: restored.rally.base, selected: null, vehicleChanged: false }
    : rallyInit(),
  fence: restored?.fence
    ? { history: historyInit(restored.fence.present), base: restored.fence.base, selected: null, vehicleChanged: false }
    : fenceInit(),
  fenceDrawKind: 'polygon-inclusion',
  fenceDrawing: null,

  start: (draft, source, rally, fence) =>
    set({
      active: true,
      history: historyInit(draft),
      base: draft,
      source,
      selected: null,
      tool: 'select',
      vehicleChanged: false,
      layer: 'mission',
      rally: rallyInit(rally),
      fence: fenceInit(fence),
      fenceDrawing: null,
    }),

  stop: () =>
    set({
      active: false,
      history: historyInit(EMPTY),
      base: EMPTY,
      source: { kind: 'empty' },
      selected: null,
      tool: 'select',
      vehicleChanged: false,
      layer: 'mission',
      rally: rallyInit(),
      fence: fenceInit(),
      fenceDrawing: null,
    }),

  edit: (fn, select) => {
    const { history, active, uploading } = get();
    if (!active || uploading) return;
    const next = fn(history.present);
    set({
      history: historyPush(history, next),
      ...(select !== undefined ? { selected: select } : {}),
    });
  },

  replace: (draft, source) => {
    const { history, active, uploading } = get();
    if (!active || uploading) return false;
    set({ history: historyPush(history, draft), source, selected: null });
    return true;
  },

  resetToVehicle: (draft) => {
    const { history, active, uploading } = get();
    if (!active || uploading) return;
    set({
      history: historyPush(history, draft),
      base: draft,
      source: { kind: 'vehicle' },
      selected: null,
      vehicleChanged: false,
    });
  },

  syncFromVehicle: (draft) => {
    if (!get().active) return;
    const sel = get().selected;
    set({
      history: historyInit(draft),
      base: draft,
      source: { kind: 'vehicle' },
      selected: sel !== null && sel < draft.items.length ? sel : null,
      vehicleChanged: false,
    });
  },

  undo: () => {
    const { uploading, layer, rally, fence } = get();
    if (uploading) return;
    if (layer === 'rally') {
      const h = historyUndo(rally.history);
      set({ rally: { ...rally, history: h, selected: fitSelection(rally.selected, h.present.points.length) } });
      return;
    }
    if (layer === 'fence') {
      const h = historyUndo(fence.history);
      set({ fence: { ...fence, history: h, selected: fitSelection(fence.selected, h.present.shapes.length) } });
      return;
    }
    const h = historyUndo(get().history);
    set({ history: h, selected: fitSelection(get().selected, h.present.items.length) });
  },

  redo: () => {
    const { uploading, layer, rally, fence } = get();
    if (uploading) return;
    if (layer === 'rally') {
      const h = historyRedo(rally.history);
      set({ rally: { ...rally, history: h, selected: fitSelection(rally.selected, h.present.points.length) } });
      return;
    }
    if (layer === 'fence') {
      const h = historyRedo(fence.history);
      set({ fence: { ...fence, history: h, selected: fitSelection(fence.selected, h.present.shapes.length) } });
      return;
    }
    const h = historyRedo(get().history);
    set({ history: h, selected: fitSelection(get().selected, h.present.items.length) });
  },

  select: (index) => set({ selected: index }),

  // Leaving the fence layer drops a polygon being drawn (it was never in the draft).
  setLayer: (layer) => set({ layer, ...(layer !== 'fence' ? { fenceDrawing: null } : {}) }),

  // Leaving Place drops a fence polygon being drawn.
  setTool: (tool) => set({ tool, ...(tool !== 'add' ? { fenceDrawing: null } : {}) }),

  setUploading: (uploading) => set({ uploading }),

  setVehicleChanged: (vehicleChanged) => {
    if (get().vehicleChanged !== vehicleChanged) set({ vehicleChanged });
  },

  rebase: (base) => {
    if (!get().active) return;
    set({ base, vehicleChanged: false });
  },

  uploaded: (readBack) => {
    if (!get().active) return;
    const sel = get().selected;
    set({
      history: historyInit(readBack),
      base: readBack,
      source: { kind: 'vehicle' },
      selected: sel !== null && sel < readBack.items.length ? sel : null,
      vehicleChanged: false,
    });
  },

  rallyEdit: (fn, select) => {
    const { rally, active, uploading } = get();
    if (!active || uploading) return;
    const next = fn(rally.history.present);
    set({
      rally: {
        ...rally,
        history: historyPush(rally.history, next),
        ...(select !== undefined ? { selected: select } : {}),
      },
    });
  },

  rallyReplace: (draft) => {
    const { rally, active, uploading } = get();
    if (!active || uploading) return false;
    set({ rally: { ...rally, history: historyPush(rally.history, draft), selected: null } });
    return true;
  },

  rallyResetToVehicle: (draft) => {
    const { rally, active, uploading } = get();
    if (!active || uploading) return;
    set({
      rally: {
        ...rally,
        history: historyPush(rally.history, draft),
        base: draft,
        selected: null,
        vehicleChanged: false,
      },
    });
  },

  rallySyncFromVehicle: (draft) => {
    const { rally, active } = get();
    if (!active) return;
    set({
      rally: {
        history: historyInit(draft),
        base: draft,
        selected: fitSelection(rally.selected, draft.points.length),
        vehicleChanged: false,
      },
    });
  },

  rallySelect: (index) => set({ rally: { ...get().rally, selected: index } }),

  setRallyVehicleChanged: (changed) => {
    const { rally } = get();
    if (rally.vehicleChanged !== changed) set({ rally: { ...rally, vehicleChanged: changed } });
  },

  rallyRebase: (base) => {
    const { rally, active } = get();
    if (!active) return;
    set({ rally: { ...rally, base, vehicleChanged: false } });
  },

  rallyUploaded: (readBack) => {
    const { rally, active } = get();
    if (!active) return;
    set({
      rally: {
        history: historyInit(readBack),
        base: readBack,
        selected: fitSelection(rally.selected, readBack.points.length),
        vehicleChanged: false,
      },
    });
  },

  fenceEdit: (fn, select) => {
    const { fence, active, uploading } = get();
    if (!active || uploading) return;
    const next = fn(fence.history.present);
    set({
      fence: {
        ...fence,
        history: historyPush(fence.history, next),
        ...(select !== undefined ? { selected: select } : {}),
      },
    });
  },

  fenceReplace: (draft) => {
    const { fence, active, uploading } = get();
    if (!active || uploading) return false;
    set({ fence: { ...fence, history: historyPush(fence.history, draft), selected: null } });
    return true;
  },

  fenceResetToVehicle: (draft) => {
    const { fence, active, uploading } = get();
    if (!active || uploading) return;
    set({
      fence: {
        ...fence,
        history: historyPush(fence.history, draft),
        base: draft,
        selected: null,
        vehicleChanged: false,
      },
    });
  },

  fenceSyncFromVehicle: (draft) => {
    const { fence, active } = get();
    if (!active) return;
    set({
      fence: {
        history: historyInit(draft),
        base: draft,
        selected: fitSelection(fence.selected, draft.shapes.length),
        vehicleChanged: false,
      },
    });
  },

  fenceSelect: (index) => set({ fence: { ...get().fence, selected: index } }),

  setFenceVehicleChanged: (changed) => {
    const { fence } = get();
    if (fence.vehicleChanged !== changed) set({ fence: { ...fence, vehicleChanged: changed } });
  },

  fenceRebase: (base) => {
    const { fence, active } = get();
    if (!active) return;
    set({ fence: { ...fence, base, vehicleChanged: false } });
  },

  setFenceDrawKind: (fenceDrawKind) => set({ fenceDrawKind, fenceDrawing: null }),

  setFenceDrawing: (fenceDrawing) => set({ fenceDrawing }),

  fenceUploaded: (readBack) => {
    const { fence, active } = get();
    if (!active) return;
    set({
      fence: {
        history: historyInit(readBack),
        base: readBack,
        selected: fitSelection(fence.selected, readBack.shapes.length),
        vehicleChanged: false,
      },
    });
  },
}));

// Save after every change. A draft is a few kB, and the map commits a drag only when it ends.
let lastSaved: {
  active: boolean;
  present: MissionDraft;
  base: MissionDraft;
  source: DraftSource;
  rallyPresent: RallyDraft;
  rallyBase: RallyDraft;
  fencePresent: FenceDraft;
  fenceBase: FenceDraft;
} | null = null;
useMissionPlanStore.subscribe((s) => {
  if (
    lastSaved &&
    lastSaved.active === s.active &&
    lastSaved.present === s.history.present &&
    lastSaved.base === s.base &&
    lastSaved.source === s.source &&
    lastSaved.rallyPresent === s.rally.history.present &&
    lastSaved.rallyBase === s.rally.base &&
    lastSaved.fencePresent === s.fence.history.present &&
    lastSaved.fenceBase === s.fence.base
  ) {
    return;
  }
  lastSaved = {
    active: s.active,
    present: s.history.present,
    base: s.base,
    source: s.source,
    rallyPresent: s.rally.history.present,
    rallyBase: s.rally.base,
    fencePresent: s.fence.history.present,
    fenceBase: s.fence.base,
  };
  save(s);
});

// Another vehicle is now commanded while planning: the plan stays open (it may be meant for this vehicle too), but
// nothing is known yet of what this vehicle holds, so every layer is compared with nothing: the whole plan counts as
// changes to upload, and a download of the vehicle's own mission is reported as a change (not taken over the draft).
onActiveVehicleChange(() => {
  const st = useMissionPlanStore.getState();
  if (!st.active) return;
  st.rebase({ items: [] });
  st.rallyRebase({ points: [] });
  st.fenceRebase(EMPTY_FENCE);
});
