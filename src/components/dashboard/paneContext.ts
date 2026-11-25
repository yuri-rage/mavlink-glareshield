// Whether a widget is drawn in a Cockpit pane: then it fills the pane (no minimum heights, no shape of its own,
// lists scrolling inside), instead of sizing itself as it does in a Flow tab's grid.

import { createContext, useContext } from 'react';

export const PaneContext = createContext(false);

/** True inside a Cockpit pane. */
export function useInPane(): boolean {
  return useContext(PaneContext);
}

/** Whether a widget is pinned as a Cockpit tab's header (above the panes, at its own height). */
export const HeaderSlotContext = createContext(false);

/** True when pinned above a Cockpit tab's panes: what it would expand inline should float over the panes instead. */
export function useInHeaderSlot(): boolean {
  return useContext(HeaderSlotContext);
}
