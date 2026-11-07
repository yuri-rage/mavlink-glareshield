// A small dropdown for the map header: a trigger button and a panel that closes on an outside click, on Escape,
// or when an item is chosen.

import React, { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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
          'h-7 px-2 inline-flex items-center gap-1 rounded-md border text-xs font-bold transition-colors',
          open ? 'bg-zinc-800 border-zinc-600 text-white' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white'
        )}
        title={title}
      >
        {icon}
        <span className="hidden xl:inline text-[11px]">{label}</span>
        <ChevronDown className={cn('h-3 w-3 text-zinc-500 transition-transform', open && 'rotate-180')} />
      </button>
      {extra}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full mt-1 z-[1100] max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl p-1 font-sans normal-case tracking-normal',
            widthClass
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

export const MenuSection: React.FC<{ label: string; first?: boolean }> = ({ label, first }) => (
  <>
    {!first && <div className="my-1 border-t border-zinc-800" />}
    <div className="px-2.5 pt-0.5 pb-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">{label}</div>
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
      'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left text-[12px] transition-colors',
      'disabled:opacity-40 disabled:cursor-not-allowed',
      danger ? 'text-red-300 hover:bg-red-500/15' : 'text-zinc-200 hover:bg-zinc-800 disabled:hover:bg-transparent',
      checked && 'text-sky-300'
    )}
  >
    <span className="shrink-0 w-4 flex justify-center">
      {checked === undefined ? icon : checked ? <Check className="h-3.5 w-3.5 text-sky-400" /> : null}
    </span>
    <span className="flex-1 min-w-0 truncate">{label}</span>
    {detail && <span className="shrink-0 text-[10px] font-mono text-zinc-500">{detail}</span>}
  </button>
);
