// The panel list of a composite widget in the creator: choose the panel to edit, reorder, size and remove panels.

import React from 'react';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';

import { BUILTIN_PANELS, builtinPanelId } from '../../lib/builtinWidgets';
import { MAX_COMPOSITE_BINDINGS, MAX_PANELS } from '../../lib/widgetValidation';
import type { PanelDisplayType, WidgetPanelDefinition } from '../../types/widget';
import { Button } from '../ui/button';
import { panelIcon } from '../widgets/custom/WidgetPanel';

/** What a panel is, for the list: a built-in widget's name, otherwise the display type. */
function panelKind(p: WidgetPanelDefinition): string {
  if (p.displayType === 'builtin') return BUILTIN_PANELS[builtinPanelId(p.widgetId) ?? '']?.name ?? 'Built-in widget';
  return shortTypeName(p.displayType);
}

/** Display types in the order the creator offers them, with their names. */
export const PANEL_TYPE_OPTIONS: { value: PanelDisplayType; label: string }[] = [
  { value: 'stat-card', label: 'Stat card (one big value)' },
  { value: 'value-list', label: 'Value list (several readouts)' },
  { value: 'gauge-linear', label: 'Linear gauge (bar)' },
  { value: 'gauge-radial', label: 'Radial gauge (dial)' },
  { value: 'sparkline', label: 'Chart (values over time)' },
  { value: 'compass-rose', label: 'Compass rose (heading, wind, bearing)' },
  { value: 'multi-bar', label: 'Bar group (RC, servo, ESC, vibration)' },
  { value: 'param-control', label: 'Parameter control (one parameter)' },
  { value: 'param-set', label: 'Parameter set (by name, or a prefix like BATT_*)' },
  { value: 'indicator-led', label: 'LED (on or off)' },
  { value: 'action-button', label: 'Command button (a MAVLink command)' },
  { value: 'toggle-switch', label: 'Switch (relay or servo)' },
  { value: 'slider-control', label: 'Slider (PWM or speed)' },
  { value: 'text-display', label: 'Text' },
  { value: 'builtin', label: 'Built-in widget (GPS, battery, HUD, map…)' },
];

const shortTypeName = (t: PanelDisplayType) =>
  PANEL_TYPE_OPTIONS.find((o) => o.value === t)?.label.replace(/\s*\(.*$/, '') ?? t;

/** Panel widths offered, in twelfths of the card. */
export const SPAN_OPTIONS = [
  { value: 12, label: 'Full row' },
  { value: 9, label: '¾ row' },
  { value: 8, label: '⅔ row' },
  { value: 6, label: '½ row' },
  { value: 4, label: '⅓ row' },
  { value: 3, label: '¼ row' },
];

/** Values a panel reads (primary, extra values and toggle feedback). */
export function panelValueCount(p: WidgetPanelDefinition): number {
  return (p.binding ? 1 : 0) + (p.bindings?.length ?? 0) + (p.feedback ? 1 : 0);
}

interface CompositePanelListProps {
  panels: WidgetPanelDefinition[];
  selected: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
  onSpan: (index: number, span: number) => void;
}

export const CompositePanelList: React.FC<CompositePanelListProps> = ({
  panels,
  selected,
  onSelect,
  onAdd,
  onMove,
  onRemove,
  onSpan,
}) => {
  const values = panels.reduce((n, p) => n + panelValueCount(p), 0);
  return (
    <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">Panels</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-zinc-700 text-[11px]"
          onClick={onAdd}
          disabled={panels.length >= MAX_PANELS}
          title={panels.length >= MAX_PANELS ? `A composite widget holds at most ${MAX_PANELS} panels` : 'Add a panel'}
        >
          <Plus className="h-3 w-3" />
          Add panel
        </Button>
      </div>
      <p className="-mt-1 text-[10px] text-zinc-500">
        Panels fill the card left to right, wrapping when a row is full. On narrow cards (under 360 px) panels a third
        wide or less pair up two to a row; the rest take a full row. Choose a panel to edit it below.
      </p>
      <ol className="space-y-1">
        {panels.map((p, i) => {
          const Icon = panelIcon(p.displayType);
          const active = i === selected;
          return (
            <li
              key={i}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 ${
                active ? 'border-sky-500/70 bg-sky-950/30' : 'border-zinc-800 bg-zinc-950/40'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(i)}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-xs"
                aria-current={active ? 'true' : undefined}
                title="Edit this panel"
              >
                <span className="w-4 shrink-0 font-mono text-[10px] text-zinc-500">{i + 1}</span>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-zinc-500'}`} />
                <span className={`truncate ${active ? 'font-semibold text-zinc-100' : 'text-zinc-300'}`}>
                  {p.title?.trim() || panelKind(p)}
                </span>
                {p.title?.trim() && (
                  <span className="hidden truncate text-[10px] text-zinc-500 sm:inline">{panelKind(p)}</span>
                )}
              </button>
              <select
                value={p.span ?? 12}
                onChange={(e) => onSpan(i, Number(e.target.value))}
                className="h-7 rounded-md border border-zinc-700 bg-zinc-900 px-1 text-[11px] text-zinc-200"
                aria-label={`Panel ${i + 1} width`}
              >
                {SPAN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onMove(i, -1)}
                disabled={i === 0}
                className="flex h-7 w-6 items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                aria-label={`Move panel ${i + 1} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMove(i, 1)}
                disabled={i === panels.length - 1}
                className="flex h-7 w-6 items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                aria-label={`Move panel ${i + 1} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={panels.length <= 1}
                className="flex h-7 w-6 items-center justify-center rounded text-zinc-400 hover:text-red-400 disabled:opacity-30"
                aria-label={`Remove panel ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
      <p
        className={`text-[10px] ${values > MAX_COMPOSITE_BINDINGS ? 'font-semibold text-amber-400' : 'text-zinc-500'}`}
      >
        {panels.length} of {MAX_PANELS} panels · {values} of {MAX_COMPOSITE_BINDINGS} values
        {values > MAX_COMPOSITE_BINDINGS ? ' — remove some values to save' : ''}
      </p>
    </div>
  );
};
