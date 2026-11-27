// The dashboard's tabs, in the navbar's top row (instead of a bar of their own, which took a full row of height), and
// the Edit Mode button. When the tabs don't fit in the room left between the vehicle's pills and the controls on the
// right, they collapse into a dropdown showing the open tab. In Edit Mode the full tab row returns below (rename,
// delete, reorder, New Tab: DashboardGrid), so nothing is shown here.

import React, { useLayoutEffect, useRef, useState } from 'react';

import { LayoutGrid, Pencil } from 'lucide-react';

import { useDashboardStore } from '../../store/dashboardStore';
import { HeaderMenu, MenuItem } from '../ui/HeaderMenu';

const pill = (active: boolean) =>
  `whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
    active ? 'bg-zinc-800 text-sky-400 ring-1 ring-zinc-700' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
  }`;

export const HeaderTabs: React.FC = () => {
  const tabs = useDashboardStore((s) => s.profile.tabs);
  const activeTabId = useDashboardStore((s) => s.activeTabId);
  const setActiveTab = useDashboardStore((s) => s.setActiveTab);
  const isEditing = useDashboardStore((s) => s.isEditing);
  const startEditing = useDashboardStore((s) => s.startEditing);
  const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  // Whether the tabs fit: their natural width (a hidden copy) against the room this slot has.
  const slotRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const slot = slotRef.current;
    const measure = measureRef.current;
    if (!slot || !measure) return;
    const check = () => setFits(measure.scrollWidth <= slot.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(slot);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [tabs.length]);

  if (isEditing) return null;

  const editButton = (
    <button
      type="button"
      onClick={startEditing}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white"
      title="Edit Mode: arrange tabs and widgets"
      aria-label="Edit Mode"
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );

  return (
    <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
      <div ref={slotRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
        {/* The natural width, measured out of sight. */}
        <div
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-1"
        >
          {tabs.map((t) => (
            <span key={t.id} className={pill(false)}>
              {t.title}
            </span>
          ))}
        </div>
        {fits ? (
          <nav className="flex items-center gap-1" aria-label="Dashboard tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={t.id === active?.id ? 'page' : undefined}
                className={pill(t.id === active?.id)}
              >
                {t.title}
              </button>
            ))}
          </nav>
        ) : (
          <HeaderMenu
            alwaysLabel
            icon={<LayoutGrid className="h-3.5 w-3.5 text-sky-400" />}
            label={active?.title ?? 'Tabs'}
            title="Dashboard tabs"
            widthClass="w-56"
          >
            {(close) =>
              tabs.map((t) => (
                <MenuItem
                  key={t.id}
                  checked={t.id === active?.id}
                  label={t.title}
                  onClick={() => {
                    setActiveTab(t.id);
                    close();
                  }}
                />
              ))
            }
          </HeaderMenu>
        )}
      </div>
      {editButton}
    </div>
  );
};
