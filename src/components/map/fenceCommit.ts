// Fence draft edits from the map and menus, kept apart from the Leaflet layer so they can be tested without a browser.

import { addShape, type FenceDraft } from '../../mavlink/fenceDraft';
import { useMissionPlanStore } from '../../store/missionPlanStore';

/** Apply a fence edit that also picks the shape to select; a refused edit leaves the draft alone. */
export function commitFence(make: (d: FenceDraft) => { draft: FenceDraft; index: number | null }) {
  const st = useMissionPlanStore.getState();
  try {
    const r = make(st.fence.history.present);
    st.fenceEdit(() => r.draft, r.index);
  } catch (err) {
    console.warn('[planning] fence edit refused:', err);
  }
}

/** Finish the polygon being drawn: it becomes a shape (inclusion or exclusion, as chosen) when it has 3 vertices. */
export function finishFencePolygon(): boolean {
  const st = useMissionPlanStore.getState();
  const vertices = st.fenceDrawing;
  if (!vertices || vertices.length < 3) return false;
  const inclusion = st.fenceDrawKind === 'polygon-inclusion';
  commitFence((d) => addShape(d, { kind: 'polygon', inclusion, vertices }));
  st.setFenceDrawing(null);
  return true;
}
