// How wide the dashboard's scrolling (Flow) tabs may grow: Standard (1280 px), Wide (1680 px) or the full window.
// Saved in this browser. Settings > Display chooses it.

import { create } from 'zustand';

export type ContentWidth = 'standard' | 'wide' | 'full';

const KEY = 'mavlink_glareshield_content_width';

function load(): ContentWidth {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'standard' || v === 'wide' || v === 'full') return v;
  } catch {
    // Storage unavailable: the default.
  }
  return 'standard';
}

/** The dashboard's max-width class for each choice. */
export const CONTENT_WIDTH_CLASS: Record<ContentWidth, string> = {
  standard: 'max-w-7xl',
  wide: 'max-w-[1680px]',
  full: 'max-w-none',
};

interface LayoutState {
  contentWidth: ContentWidth;
  setContentWidth: (w: ContentWidth) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  contentWidth: load(),
  setContentWidth: (contentWidth) => {
    try {
      localStorage.setItem(KEY, contentWidth);
    } catch {
      // This session only.
    }
    set({ contentWidth });
  },
}));
