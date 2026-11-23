// Planning mode: the mission draft being edited on the map, its undo history, and the mission it started from.
// The draft is saved in this browser so switching dashboard tabs or reloading doesn't lose work. Nothing here talks
// to the vehicle: the draft only replaces the vehicle's mission through an upload.

import { create } from 'zustand';
import {
  draftsEqual,
  historyInit,
  historyPush,
  historyRedo,
  historyUndo,
  type History,
  type MissionDraft,
} from '../mavlink/missionDraft';

const STORAGE_KEY = 'mavlink_glareshield_mission_draft';

/** What a click on the map does while planning: select pins only, or add a waypoint where clicked. */
export type PlanTool = 'select' | 'add'; // 'add' is labelled Place

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

  /** Turn planning on with `draft`, which is also the base (no changes yet). */
  start: (draft: MissionDraft, source: DraftSource) => void;
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
  undo: () => void;
  redo: () => void;
  select: (index: number | null) => void;
  setTool: (tool: PlanTool) => void;
  setUploading: (uploading: boolean) => void;
  setVehicleChanged: (changed: boolean) => void;
  /** Keep the draft, comparing it from now on with `base` (the vehicle's current mission). */
  rebase: (base: MissionDraft) => void;
  /** After a verified upload: what the vehicle holds becomes the draft and the base, with a fresh history. */
  uploaded: (readBack: MissionDraft) => void;
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

/** True when the draft differs from the mission it started from. */
export function isDraftDirty(s: Pick<MissionPlanState, 'history' | 'base'>): boolean {
  return !draftsEqual(s.history.present, s.base);
}

const EMPTY: MissionDraft = { items: [] };

interface Saved {
  active: boolean;
  present: MissionDraft;
  base: MissionDraft;
  source: DraftSource;
}

function isDraft(v: any): v is MissionDraft {
  return Boolean(v) && Array.isArray(v.items) && v.items.every((it: any) => it && typeof it.command === 'number');
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s?.active || !isDraft(s.present) || !isDraft(s.base) || s.present.items.length === 0) return null;
    return { active: true, present: s.present, base: s.base, source: s.source ?? { kind: 'empty' } };
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
    const saved: Saved = { active: true, present: s.history.present, base: s.base, source: s.source };
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

  start: (draft, source) =>
    set({ active: true, history: historyInit(draft), base: draft, source, selected: null, tool: 'select', vehicleChanged: false }),

  stop: () =>
    set({
      active: false,
      history: historyInit(EMPTY),
      base: EMPTY,
      source: { kind: 'empty' },
      selected: null,
      tool: 'select',
      vehicleChanged: false,
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
    set({ history: historyPush(history, draft), base: draft, source: { kind: 'vehicle' }, selected: null, vehicleChanged: false });
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
    if (get().uploading) return;
    const h = historyUndo(get().history);
    const sel = get().selected;
    set({ history: h, selected: sel !== null && sel < h.present.items.length ? sel : null });
  },

  redo: () => {
    if (get().uploading) return;
    const h = historyRedo(get().history);
    const sel = get().selected;
    set({ history: h, selected: sel !== null && sel < h.present.items.length ? sel : null });
  },

  select: (index) => set({ selected: index }),

  setTool: (tool) => set({ tool }),

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
}));

// Save after every change. A draft is a few kB, and the map commits a drag only when it ends.
let lastSaved: { active: boolean; present: MissionDraft; base: MissionDraft; source: DraftSource } | null = null;
useMissionPlanStore.subscribe((s) => {
  if (
    lastSaved &&
    lastSaved.active === s.active &&
    lastSaved.present === s.history.present &&
    lastSaved.base === s.base &&
    lastSaved.source === s.source
  ) {
    return;
  }
  lastSaved = { active: s.active, present: s.history.present, base: s.base, source: s.source };
  save(s);
});
