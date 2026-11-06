// The panel list of a composite widget in the creator: choose the panel to edit, reorder, size and remove panels.

import React from 'react';
import type { PanelDisplayType, WidgetPanelDefinition } from '../../types/widget';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { panelIcon } from '../widgets/custom/WidgetPanel';
import { MAX_COMPOSITE_BINDINGS, MAX_PANELS } from '../../lib/widgetValidation';
import { BUILTIN_PANELS, builtinPanelId } from '../../lib/builtinWidgets';

/** What a panel is, for the list: a built-in widget's name, otherwise the display type. */
function panelKind(p: WidgetPanelDefinition): string {
  if (p.displayType === 'builtin') return BUILTIN_PANELS[builtinPanelId(p.widgetId) ?? '']?.name ?? 'Built-in widget';
  return shortTypeName(p.displayType);
}

/** Display types in the order the creator offers them, with their names. */
export const PANEL_TYPE_OPTIONS: { value: PanelDisplayType; label: string }[] = [
  { value: 'stat-card', label: 'Stat Card (Digital readout)' },
  { value: 'value-list', label: 'Value List (Several labelled readouts)' },
  { value: 'gauge-linear', label: 'Linear Gauge (Horizontal bar)' },
  { value: 'gauge-radial', label: 'Radial Gauge (Dial with needle)' },
  { value: 'sparkline', label: 'Time-Series Chart (One or more values over time)' },
  { value: 'compass-rose', label: 'Compass / Vector Rose (Heading / Wind / Bearing)' },
  { value: 'multi-bar', label: 'Multi-Channel Bar / PWM Visualizer (RC / Servo / ESC / Vibe)' },
  { value: 'param-control', label: 'Parameter Control (ArduPilot PARAM_SET)' },
  { value: 'indicator-led', label: 'LED Status Indicator (On/Off)' },
  { value: 'action-button', label: 'Action Button (MAVLink Command)' },
  { value: 'toggle-switch', label: 'Toggle Switch (Relay / Servo)' },
  { value: 'slider-control', label: 'Slider Control (PWM / Speed)' },
  { value: 'text-display', label: 'Text Output Display' },
  { value: 'builtin', label: 'Built-in Widget (GPS, Battery, HUD, Map…)' },
];

export const shortTypeName = (t: PanelDisplayType) => PANEL_TYPE_OPTIONS.find((o) => o.value === t)?.label.replace(/\s*\(.*$/, '') ?? t;

/** Panel widths offered, in twelfths of the card. */
export const SPAN_OPTIONS = [
  { value: 12, label: 'Full row' },
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

export const CompositePanelList: React.FC<CompositePanelListProps> = ({ panels, selected, onSelect, onAdd, onMove, onRemove, onSpan }) => {
  const values = panels.reduce((n, p) => n + panelValueCount(p), 0);
  return (
    <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">Panels</h4>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1 border-zinc-700"
          onClick={onAdd}
          disabled={panels.length >= MAX_PANELS}
          title={panels.length >= MAX_PANELS ? `A composite widget holds at most ${MAX_PANELS} panels` : 'Add a panel'}
        >
          <Plus className="h-3 w-3" />
          Add panel
        </Button>
      </div>
      <p className="text-[10px] text-zinc-500 -mt-1">
        Panels fill the card left to right, wrapping when a row is full. On narrow cards each panel takes a full row. Choose a
        panel to edit it below.
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
                className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-xs py-0.5"
                aria-current={active ? 'true' : undefined}
                title="Edit this panel"
              >
                <span className="text-[10px] font-mono text-zinc-500 w-4 shrink-0">{i + 1}</span>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-sky-400' : 'text-zinc-500'}`} />
                <span className={`truncate ${active ? 'text-zinc-100 font-semibold' : 'text-zinc-300'}`}>
                  {p.title?.trim() || panelKind(p)}
                </span>
                {p.title?.trim() && <span className="text-[10px] text-zinc-500 truncate hidden sm:inline">{panelKind(p)}</span>}
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
                className="h-7 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                aria-label={`Move panel ${i + 1} up`}
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onMove(i, 1)}
                disabled={i === panels.length - 1}
                className="h-7 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
                aria-label={`Move panel ${i + 1} down`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                disabled={panels.length <= 1}
                className="h-7 w-6 flex items-center justify-center rounded text-zinc-400 hover:text-red-400 disabled:opacity-30"
                aria-label={`Remove panel ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ol>
      <p className={`text-[10px] ${values > MAX_COMPOSITE_BINDINGS ? 'text-amber-400 font-semibold' : 'text-zinc-500'}`}>
        {panels.length} of {MAX_PANELS} panels · {values} of {MAX_COMPOSITE_BINDINGS} values
        {values > MAX_COMPOSITE_BINDINGS ? ' — remove some values to save' : ''}
      </p>
    </div>
  );
};
