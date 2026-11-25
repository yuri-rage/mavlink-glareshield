// A small dropdown for the map header: a trigger button and a panel that closes on an outside click, on Escape,
// or when an item is chosen.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Check, ChevronDown } from 'lucide-react';

import { cn } from '../../lib/utils';

interface HeaderMenuProps {
  icon: React.ReactNode;
  /** Shown beside the icon on wide screens. */
  label: string;
  title: string;
  /** The panel's content; `close` dismisses the menu. */
  children: (close: () => void) => React.ReactNode;
  widthClass?: string;
  /** Extra content kept outside the panel, such as a hidden file input. */
  extra?: React.ReactNode;
}

export const HeaderMenu: React.FC<HeaderMenuProps> = ({ icon, label, title, children, widthClass = 'w-64', extra }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The panel is drawn on top of the page (a portal, fixed to the screen), so no card clips it, at the button:
  // below it unless it doesn't fit there and there's more room above (a map low on a phone screen), and no taller
  // than that room (it scrolls instead of running off the screen). Kept at the button as the page scrolls.
  const [place, setPlace] = useState<{
    up: boolean;
    maxH: number;
    right: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const btn = rootRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!btn || !panel) return;
      const margin = 8;
      const below = window.innerHeight - btn.bottom - margin;
      const above = btn.top - margin;
      const up = panel.scrollHeight > below && above > below;
      // Right-aligned with the button, but kept on screen at both edges (a button left of centre on a narrow phone
      // would otherwise push a wide panel off the left edge).
      const right = Math.max(
        margin,
        Math.min(window.innerWidth - btn.right, window.innerWidth - panel.offsetWidth - margin)
      );
      const next = up
        ? { up, maxH: Math.max(120, above), right, bottom: window.innerHeight - btn.top + 4 }
        : { up, maxH: Math.max(120, below), right, top: btn.bottom + 4 };
      // Unchanged: no re-render.
      setPlace((prev) =>
        prev &&
        prev.up === next.up &&
        prev.maxH === next.maxH &&
        prev.right === next.right &&
        prev.top === next.top &&
        prev.bottom === next.bottom
          ? prev
          : next
      );
    };
    measure();
    // The page (or a scrolling card) moving the button; scrolling inside the menu itself doesn't move it.
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      measure();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-bold transition-colors',
          open
            ? 'border-zinc-600 bg-zinc-800 text-white'
            : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white'
        )}
        title={title}
      >
        {icon}
        <span className="hidden text-[11px] xl:inline">{label}</span>
        <ChevronDown className={cn('h-3 w-3 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {extra}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="menu"
            // Hidden until measured (the first layout pass), so it never flashes in the wrong place.
            style={
              place
                ? { maxHeight: place.maxH, right: place.right, top: place.top, bottom: place.bottom }
                : { visibility: 'hidden', top: 0, right: 0 }
            }
            className={cn(
              'fixed z-[1100] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900/95 p-1 font-sans normal-case tracking-normal shadow-xl backdrop-blur-sm',
              widthClass
            )}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body
        )}
    </div>
  );
};

export const MenuSection: React.FC<{ label: string; first?: boolean }> = ({ label, first }) => (
  <>
    {!first && <div className="my-1 border-t border-zinc-800" />}
    <div className="px-2.5 pb-0.5 pt-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
  </>
);

export const MenuItem: React.FC<{
  icon?: React.ReactNode;
  label: string;
  detail?: string;
  disabled?: boolean;
  danger?: boolean;
  /** Shows a check and marks the item as the selected one of a group. */
  checked?: boolean;
  onClick: () => void;
}> = ({ icon, label, detail, disabled, danger, checked, onClick }) => (
  <button
    type="button"
    role={checked === undefined ? 'menuitem' : 'menuitemradio'}
    aria-checked={checked}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-40',
      danger ? 'text-red-300 hover:bg-red-500/15' : 'text-zinc-200 hover:bg-zinc-800 disabled:hover:bg-transparent',
      checked && 'text-sky-300'
    )}
  >
    <span className="flex w-4 shrink-0 justify-center">
      {checked === undefined ? icon : checked ? <Check className="h-3.5 w-3.5 text-sky-400" /> : null}
    </span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
    {detail && <span className="shrink-0 font-mono text-[10px] text-zinc-500">{detail}</span>}
  </button>
);
