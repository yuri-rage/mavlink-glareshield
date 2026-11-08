import React from 'react';
import type { WidgetDataBinding, WidgetGaugeConfig } from '../../../types/widget';
import { bestGridColumns } from '../../../lib/gaugeGeometry';
import { RadialGauge, VIEW_HEIGHT } from './RadialGauge';
import { useElementSize } from './palette';

export interface GridGauge {
  key: string;
  label: string;
  value: number | null;
  text: string;
  unit: string;
  min: number;
  max: number;
  zoneBinding?: WidgetDataBinding;
  accent: string;
  dimmed?: boolean;
}

const LABEL_HEIGHT = 16;
/** Below this cell width a dial drops its minor ticks and inner labels. */
const COMPACT_BELOW_PX = 210;

/** Several radial dials laid out to fill the card, each as large as the card's shape allows. */
export const GaugeGrid: React.FC<{ gauges: GridGauge[]; config?: WidgetGaugeConfig }> = ({ gauges, config }) => {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const sweep = config?.sweep ?? 240;
  const aspect = 232 / (VIEW_HEIGHT[sweep] ?? 160);
  const cols = bestGridColumns(gauges.length, size.width, size.height, aspect, LABEL_HEIGHT);
  const rows = Math.ceil(gauges.length / Math.max(1, cols));
  const compact = size.width > 0 && size.width / cols < COMPACT_BELOW_PX;

  return (
    <div
      ref={ref}
      className="absolute inset-0 grid gap-x-2 gap-y-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
    >
      {gauges.map((g) => (
        <div key={g.key} className="flex flex-col min-h-0 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 text-center truncate leading-4">
            {g.label}
          </div>
          <div className="relative flex-1 min-h-0">
            <RadialGauge
              value={g.value}
              text={g.text}
              unit={g.unit}
              min={g.min}
              max={g.max}
              zoneBinding={g.zoneBinding}
              config={config}
              accent={g.accent}
              dimmed={g.dimmed}
              compact={compact}
              alignTop
            />
          </div>
        </div>
      ))}
    </div>
  );
};
