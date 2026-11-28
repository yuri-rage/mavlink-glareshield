// The desktop app's title bar when the window is frameless (Settings → Display → Title bar: Auto-hide): out of sight
// until the pointer reaches the window's top edge, then it slides down over the top of the app, which keeps its size
// (an overlay, nothing reflows). It drags the window and holds minimize, maximize and close. It goes when the pointer
// moves below it, and shows for a moment at startup so it can be found.
//
// The bar is a drag region (-webkit-app-region: drag), and the page gets no pointer events over a drag region: so the
// pointer is followed on the window (pointermove), not with :hover on the bar. While the pointer is over the bar
// nothing arrives, and the bar stays. Reaching the top edge is also reported by the main process (onPointerAtTop),
// from the cursor's screen position: on Windows the system keeps a resize border just inside a frameless window's
// top edge, and the page gets no events there at all.

import React, { useEffect, useRef, useState } from 'react';

import { Copy, Minus, Square, X } from 'lucide-react';

import { desktopApi } from '../../desktop/api';

/** How close to the top edge (px) the pointer brings the bar down. */
const REVEAL_PX = 8;
const BAR_PX = 32;
/** How far below the bar (px) the pointer may stray before it goes, and after how long (ms). */
const SLACK_PX = 12;
const HIDE_MS = 350;
const STARTUP_MS = 2500;

const drag = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export const TitleBar: React.FC = () => {
  const win = desktopApi()?.window;
  const [shown, setShown] = useState(true);
  const [maximized, setMaximized] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!win?.frameless) return;
    const cancelHide = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
    const hideSoon = (ms = HIDE_MS) => {
      if (hideTimer.current) return;
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setShown(false);
      }, ms);
    };
    const onMove = (e: PointerEvent) => {
      if (e.clientY <= REVEAL_PX) {
        cancelHide();
        setShown(true);
      } else if (e.clientY > BAR_PX + SLACK_PX) {
        hideSoon();
      } else {
        cancelHide();
      }
    };
    // Out of the window other than over the top (where the window is being dragged, or the pointer left to the
    // desktop above a maximized window): it goes.
    const onLeave = (e: PointerEvent) => {
      if (e.clientY > BAR_PX) hideSoon();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    hideSoon(STARTUP_MS);
    void win.isMaximized().then(setMaximized);
    const off = win.onMaximized(setMaximized);
    const offTop = win.onPointerAtTop(() => {
      cancelHide();
      setShown(true);
    });
    return () => {
      cancelHide();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      off();
      offTop();
    };
  }, [win]);

  if (!win?.frameless) return null;
  const btn =
    'flex h-full w-11 items-center justify-center text-zinc-300 transition-colors hover:bg-zinc-700/70 hover:text-white focus-visible:bg-zinc-700/70 focus-visible:outline-none';
  return (
    <div
      className={`fixed inset-x-0 top-0 z-[1000] flex h-8 select-none items-center border-b border-zinc-700/70 bg-zinc-900 shadow-lg shadow-black/40 transition-transform duration-150 ease-out ${shown ? 'translate-y-0' : '-translate-y-full'}`}
      style={drag}
      // Keyboard focus on a control brings the bar down too (it's out of sight otherwise).
      onFocus={() => setShown(true)}
      aria-hidden={!shown}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-3">
        <img src="/logo-64.png" alt="" className="h-4 w-4 shrink-0" />
        <span className="truncate text-xs font-semibold tracking-wide text-zinc-200">Glareshield</span>
      </div>
      <div className="flex h-full shrink-0" style={noDrag}>
        <button
          type="button"
          className={btn}
          onClick={() => win.minimize()}
          aria-label="Minimize"
          tabIndex={shown ? 0 : -1}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => win.toggleMaximize()}
          aria-label={maximized ? 'Restore' : 'Maximize'}
          tabIndex={shown ? 0 : -1}
        >
          {maximized ? <Copy className="h-3.5 w-3.5 -scale-x-100" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className={`${btn} hover:bg-red-600 hover:text-white`}
          onClick={() => win.close()}
          aria-label="Close"
          tabIndex={shown ? 0 : -1}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};
