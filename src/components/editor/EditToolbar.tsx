import React from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Button } from '../ui/button';
import { Plus, Sliders, Check, Pencil } from 'lucide-react';
import { COCKPIT_PRESETS, panesInOrder, type CockpitPresetId } from '../../lib/cockpitLayout';

interface EditToolbarProps {
  onOpenWidgetModal: () => void;
  onOpenProfileModal: () => void;
}

export const EditToolbar: React.FC<EditToolbarProps> = ({
  onOpenWidgetModal,
  onOpenProfileModal,
}) => {
  const { isEditing, toggleEditing, profile, activeTabId, setTabMode, applyCockpitPreset } = useDashboardStore();

  if (!isEditing) return null;

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];
  const cockpit = activeTab?.mode === 'cockpit';
  const shown = cockpit ? panesInOrder(activeTab.cockpit).length : 0;

  return (
    <div className="bg-amber-950/40 border-b border-amber-500/30 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2.5 text-xs">
      <div className="flex items-center gap-2 text-amber-300 font-medium min-w-0">
        <Pencil className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <span className="font-bold tracking-tight text-amber-200 uppercase">Dashboard Editor:</span>
        <span className="text-zinc-400 truncate hidden md:inline">
          Editing <strong className="text-zinc-200">{activeTab?.title}</strong>{' '}
          {cockpit
            ? `(${shown} shown${activeTab.widgets.length > shown ? `, ${activeTab.widgets.length - shown} hidden` : ''})`
            : `(${activeTab?.widgets.length || 0} widgets)`}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap ml-auto">
        {/* The tab's layout: Flow (a scrolling grid) or Cockpit (panes filling the window). */}
        {activeTab && (
          <div className="flex items-center gap-1.5">
            <div className="grid grid-cols-2 gap-0.5 rounded-md border border-zinc-700 bg-zinc-900 p-0.5" role="radiogroup" aria-label="Tab layout">
              {(['flow', 'cockpit'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={(m === 'cockpit') === cockpit}
                  onClick={() => setTabMode(activeTab.id, m)}
                  title={m === 'flow' ? 'Widgets in a scrolling grid (any screen)' : 'Panes filling the window, no page scroll (stacked on small screens)'}
                  className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                    (m === 'cockpit') === cockpit ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {m === 'flow' ? 'Flow' : 'Cockpit'}
                </button>
              ))}
            </div>
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
          className="gap-1.5 h-7 px-3 text-xs font-semibold bg-sky-500 hover:bg-sky-600 text-white shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add Widget</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenProfileModal}
          className="gap-1.5 h-7 px-2.5 text-xs font-medium border-zinc-700 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300"
          title="Profiles, Backup & Export"
        >
          <Sliders className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Profiles & Backup</span>
        </Button>

        <Button
          variant="warning"
          size="sm"
          onClick={toggleEditing}
          className="gap-1.5 h-7 px-3 text-xs font-bold shadow-sm"
        >
          <Check className="h-3.5 w-3.5" />
          <span>Finish Edit</span>
        </Button>
      </div>
    </div>
  );
};
