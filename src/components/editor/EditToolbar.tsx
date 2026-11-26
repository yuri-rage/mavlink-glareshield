import React, { useEffect, useState } from 'react';

import { Check, Pencil, Plus, Sliders } from 'lucide-react';

import {
  COCKPIT_PRESETS,
  COMPACT_PREVIEWS,
  panesInOrder,
  WIDE_ASPECT,
  type CockpitPresetId,
  type CompactPreviewId,
} from '../../lib/cockpitLayout';
import { COCKPIT_VARIANTS, editTarget, layoutOf, useDashboardStore } from '../../store/dashboardStore';
import { Button } from '../ui/button';

interface EditToolbarProps {
  onOpenWidgetModal: () => void;
  onOpenProfileModal: () => void;
}

export const EditToolbar: React.FC<EditToolbarProps> = ({ onOpenWidgetModal, onOpenProfileModal }) => {
  const {
    isEditing,
    toggleEditing,
    profile,
    activeTabId,
    setTabMode,
    applyCockpitPreset,
    editVariant,
    setEditVariant,
    addLayout,
    removeLayout,
    compactPreview,
    setCompactPreview,
  } = useDashboardStore();
  const [confirmRemove, setConfirmRemove] = useState(false);
  // A pending "Remove the ... layout?" doesn't outlive what it was about.
  useEffect(() => setConfirmRemove(false), [activeTabId, editVariant, isEditing]);

  if (!isEditing) return null;

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];
  const cockpit = activeTab?.mode === 'cockpit';
  // The tab's layouts (standard always; wide and compact when it has them) and the one being edited.
  const variants = cockpit ? COCKPIT_VARIANTS.filter((v) => v === 'standard' || layoutOf(activeTab, v)) : [];
  const editing = cockpit ? editTarget(activeTab, editVariant) : 'standard';
  const shown = cockpit ? panesInOrder(layoutOf(activeTab, editing)).length : 0;
  const VARIANT_INFO = {
    standard: { name: 'Standard', when: 'the usual layout' },
    wide: { name: 'Wide', when: `used when the window is wider than ${WIDE_ASPECT}:1 (an ultrawide)` },
    compact: {
      name: 'Compact',
      when: "used when the standard (or wide) layout doesn't fit the window, e.g. a laptop, before stacking",
    },
  } as const;

  return (
    <div
      data-edit-chrome
      className="flex flex-wrap items-center justify-between gap-2.5 border-b border-amber-500/30 bg-amber-950/40 px-3 py-2 text-xs sm:px-6"
    >
      <div className="flex min-w-0 items-center gap-2 font-medium text-amber-300">
        <Pencil className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="font-bold uppercase tracking-tight text-amber-200">Dashboard Editor:</span>
        <span className="hidden truncate text-zinc-400 md:inline">
          Editing <strong className="text-zinc-200">{activeTab?.title}</strong>
          {cockpit && variants.length > 1 && (
            <strong className="text-sky-300"> ({VARIANT_INFO[editing].name.toLowerCase()} layout)</strong>
          )}{' '}
          {cockpit
            ? `(${shown} shown${activeTab.widgets.length > shown ? `, ${activeTab.widgets.length - shown} hidden` : ''})`
            : `(${activeTab?.widgets.length || 0} widgets)`}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {/* The tab's layout: Flow (a scrolling grid) or Cockpit (panes filling the window). */}
        {activeTab && (
          <div className="flex items-center gap-1.5">
            <div
              className="grid grid-cols-2 gap-0.5 rounded-md border border-zinc-700 bg-zinc-900 p-0.5"
              role="radiogroup"
              aria-label="Tab layout"
            >
              {(['flow', 'cockpit'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={(m === 'cockpit') === cockpit}
                  onClick={() => setTabMode(activeTab.id, m)}
                  title={
                    m === 'flow'
                      ? 'Widgets in a scrolling grid (any screen)'
                      : 'Panes filling the window, no page scroll (stacked on small screens)'
                  }
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    (m === 'cockpit') === cockpit ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {m === 'flow' ? 'Flow' : 'Cockpit'}
                </button>
              ))}
            </div>
            {/* Other layouts (wide: ultrawides; compact: short windows): explicit, and always shown which one is being
                edited. */}
            {cockpit && variants.length > 1 && (
              <div
                className="flex gap-0.5 rounded-md border border-sky-700/60 bg-zinc-900 p-0.5"
                role="radiogroup"
                aria-label="Layout being edited"
              >
                {variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={editing === v}
                    onClick={() => setEditVariant(v)}
                    title={`${VARIANT_INFO[v].name}: ${VARIANT_INFO[v].when}`}
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      editing === v ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {VARIANT_INFO[v].name}
                  </button>
                ))}
              </div>
            )}
            {cockpit &&
              (['wide', 'compact'] as const)
                .filter((v) => !layoutOf(activeTab, v))
                .map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => addLayout(activeTab.id, v)}
                    className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-semibold text-zinc-300 hover:text-white"
                    title={`A ${VARIANT_INFO[v].name.toLowerCase()} layout of this tab, ${VARIANT_INFO[v].when}; it starts as a copy of the standard one`}
                  >
                    + {VARIANT_INFO[v].name}
                  </button>
                ))}
            {cockpit && editing === 'compact' && (
              <select
                value={compactPreview}
                onChange={(e) => setCompactPreview(e.target.value as CompactPreviewId)}
                className="h-7 rounded-md border border-sky-700/60 bg-zinc-900 px-1.5 text-[11px] font-semibold text-sky-300"
                aria-label="Preview the compact layout at"
                title="Edit the compact layout in a frame the size of a laptop's browser window (when this window is larger)"
              >
                {COMPACT_PREVIEWS.map((p) => (
                  <option key={p.id} value={p.id}>
                    Preview: {p.label}
                  </option>
                ))}
                <option value="off">Preview: off (this window)</option>
              </select>
            )}
            {cockpit &&
              editing !== 'standard' &&
              (confirmRemove ? (
                <span className="flex items-center gap-1 rounded border border-red-500/40 bg-red-950/90 px-1.5 py-0.5 text-[10px] text-red-200">
                  Remove the {VARIANT_INFO[editing].name.toLowerCase()} layout?
                  <button
                    type="button"
                    onClick={() => {
                      removeLayout(activeTab.id, editing);
                      setConfirmRemove(false);
                    }}
                    className="rounded bg-red-600 px-1 font-bold text-white"
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmRemove(false)} className="rounded bg-zinc-800 px-1">
                    No
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(true)}
                  className="h-7 rounded-md px-1.5 text-[11px] text-zinc-400 hover:text-red-300"
                  title={`Remove the ${VARIANT_INFO[editing].name.toLowerCase()} layout (its widgets stay on the tab)`}
                >
                  Remove {VARIANT_INFO[editing].name.toLowerCase()}
                </button>
              ))}
            {cockpit && (
              <select
                value=""
                onChange={(e) => e.target.value && applyCockpitPreset(activeTab.id, e.target.value as CockpitPresetId)}
                className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-1.5 text-[11px] font-semibold text-zinc-300"
                aria-label="Apply a layout preset"
                title="Lay the tab out as a preset (the tab's widgets are reused; missing ones added)"
              >
                <option value="">Preset…</option>
                {COCKPIT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id} title={p.description}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <Button
          variant="default"
          size="sm"
          onClick={onOpenWidgetModal}
          className="h-7 gap-1.5 bg-sky-500 px-3 text-xs font-semibold text-white shadow-sm hover:bg-sky-600"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Widget</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenProfileModal}
          className="h-7 gap-1.5 border-zinc-700 bg-zinc-900/80 px-2.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
          title="Profiles, Backup & Export"
        >
          <Sliders className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Profiles & Backup</span>
        </Button>

        <Button
          variant="warning"
          size="sm"
          onClick={toggleEditing}
          className="h-7 gap-1.5 px-3 text-xs font-bold shadow-sm"
        >
          <Check className="h-3.5 w-3.5" />
          <span>Finish Edit</span>
        </Button>
      </div>
    </div>
  );
};
