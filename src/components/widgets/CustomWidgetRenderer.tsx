// A custom widget's card: header, alert border and badges around its panels.
//
// Most widgets are one panel. A composite widget lays several out on a 12-column grid. The card reads every bound
// value of every panel on one clock and hands each panel its share. What each display type draws, and the controls'
// own state, live in the panel components under ./custom.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomWidgetDefinition, WidgetDataBinding } from '../../types/widget';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import type { AlertState, BindingReading, UnitSystem } from '../../lib/widgetValues';
import { valueSampler } from '../../lib/valueSampler';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { ACCENT_HEX } from './custom/palette';
import {
  cardPanels,
  effectiveScheme,
  feedbackBinding,
  panelAlert,
  panelBindings,
  panelSpan,
  requiredMessageIds,
  staleSummary,
  worstAlert,
} from './custom/panelModel';
import { SCHEME_CLASSES, useBindingReadings, type PanelProps } from './custom/panelKit';
import { WidgetPanel, panelFills, panelIcon } from './custom/WidgetPanel';

valueSampler.setStateGetter(() => useTelemetryStore.getState());

/** Below this content width a composite card stacks its panels in one column. */
const STACK_BELOW_PX = 360;

interface CustomWidgetRendererProps {
  definition: CustomWidgetDefinition;
}

interface PanelLayout {
  def: CustomWidgetDefinition;
  bindings: WidgetDataBinding[];
  feedback?: WidgetDataBinding;
  /** Where this panel's readings start in the card's reading list. */
  offset: number;
}

/** Content width of an element, tracked as it resizes. */
function useWidth<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  return { ref, width };
}

export const CustomWidgetRenderer: React.FC<CustomWidgetRendererProps> = ({ definition }) => {
  const system = useUnitsStore((s) => s.system) as UnitSystem;
  const isComposite = definition.displayType === 'composite';

  // Each panel's values, then its toggle feedback field, all read on one clock.
  const layout = useMemo<PanelLayout[]>(() => {
    let offset = 0;
    return cardPanels(definition).map((def) => {
      const bindings = panelBindings(def);
      const feedback = feedbackBinding(def);
      const entry = { def, bindings, feedback, offset };
      offset += bindings.length + (feedback ? 1 : 0);
      return entry;
    });
  }, [definition]);
  const allBindings = useMemo(() => layout.flatMap((p) => (p.feedback ? [...p.bindings, p.feedback] : p.bindings)), [layout]);
  const staleTimeouts = useMemo(
    () => layout.flatMap((p) => Array<number | undefined>(p.bindings.length + (p.feedback ? 1 : 0)).fill(p.def.staleAfterSec)),
    [layout]
  );
  const allReadings = useBindingReadings(allBindings, system, staleTimeouts);

  // Ask the vehicle to stream every message this widget reads.
  const requiredMessages = useMemo(() => requiredMessageIds(definition), [definition]);
  useEffect(() => {
    if (requiredMessages.length === 0) return;
    const key = `custom-${definition.id}`;
    requiredMessages.forEach((id) => messageRateManager.registerRequirement(key, id));
    return () => messageRateManager.unregisterRequirement(key);
  }, [definition.id, requiredMessages]);

  const panels = layout.map((p) => {
    const readings = allReadings.slice(p.offset, p.offset + p.bindings.length);
    const alert = panelAlert(p.def, p.bindings, readings);
    const stale = staleSummary(p.bindings, readings);
    const scheme = effectiveScheme(alert, p.def.colorScheme);
    const props: PanelProps = {
      def: p.def,
      bindings: p.bindings,
      readings,
      feedback: p.feedback ? allReadings[p.offset + p.bindings.length] : undefined,
      system,
      alert,
      staleAll: stale.all,
      scheme: SCHEME_CLASSES[scheme],
      accentHex: ACCENT_HEX[scheme],
    };
    return props;
  });

  // The card shows the worst alert of any panel, and staleness across every displayed value.
  const shownBindings: WidgetDataBinding[] = panels.flatMap((p) => p.bindings);
  const shownReadings: BindingReading[] = panels.flatMap((p) => p.readings);
  const alert: AlertState = worstAlert(panels.map((p) => p.alert));
  const stale = staleSummary(shownBindings, shownReadings);
  const cardScheme = SCHEME_CLASSES[effectiveScheme(alert, definition.colorScheme)];
  const HeaderIcon = panelIcon(definition.displayType);

  const { ref: gridRef, width } = useWidth<HTMLDivElement>(isComposite);
  const stacked = width !== null && width < STACK_BELOW_PX;

  return (
    <Card
      className={`h-full flex flex-col bg-zinc-950/90 shadow-md transition-colors ${
        alert === 'crit' ? 'border-red-500/80 ring-1 ring-red-500/30' : alert === 'warn' ? 'border-amber-500/70' : 'border-zinc-800'
      }`}
    >
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 truncate">
            <HeaderIcon className={`h-3.5 w-3.5 shrink-0 ${cardScheme.icon}`} />
            <span className="truncate">{definition.name}</span>
          </CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {stale.count > 0 && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 font-mono uppercase"
                title={`No ${stale.messages.join(', ')} received for ${stale.ageSec}s`}
              >
                Stale {stale.ageSec}s
              </Badge>
            )}
            {alert !== 'normal' && !stale.all && (
              <Badge variant={alert === 'crit' ? 'destructive' : 'warning'} className="text-[9px] px-1.5 py-0 font-mono uppercase animate-pulse">
                {alert === 'crit' ? 'CRIT' : 'WARN'}
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] font-sans font-semibold capitalize">
              {definition.category}
            </Badge>
          </div>
        </div>
      </CardHeader>

      {isComposite ? (
        <CardContent className="p-2.5 sm:p-3 flex-1 min-h-0">
          <div ref={gridRef} className="grid grid-cols-12 gap-2.5 h-full content-start">
            {panels.map((p, i) => {
              const span = stacked ? 12 : panelSpan(definition, i);
              const title = definition.panels?.[i]?.title?.trim();
              const Icon = panelIcon(p.def.displayType);
              return (
                <section
                  key={`${i}-${p.def.displayType}`}
                  style={{ gridColumn: `span ${span} / span ${span}` }}
                  className={`min-w-0 flex flex-col rounded-lg border bg-zinc-900/30 p-2.5 transition-colors ${
                    p.alert === 'crit' ? 'border-red-500/60' : p.alert === 'warn' ? 'border-amber-500/50' : 'border-zinc-800/80'
                  }`}
                  aria-label={title || undefined}
                >
                  {/* A built-in widget brings its own title row. */}
                  {title && p.def.displayType !== 'builtin' && (
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1 mb-1.5 truncate">
                      <Icon className={`h-3 w-3 shrink-0 ${p.scheme.icon}`} />
                      <span className="truncate">{title}</span>
                    </h4>
                  )}
                  <div className={`flex-1 flex flex-col min-h-0 space-y-3 ${panelFills(p.def.displayType) ? '' : 'justify-center'}`}>
                    <WidgetPanel {...p} />
                  </div>
                </section>
              );
            })}
            {panels.length === 0 && <p className="col-span-12 text-xs text-zinc-500 text-center py-4">No panels configured.</p>}
          </div>
        </CardContent>
      ) : (
        <CardContent
          className={`p-3 sm:p-4 space-y-3 flex-1 flex flex-col min-h-0 ${panelFills(definition.displayType) ? '' : 'justify-center'}`}
        >
          <WidgetPanel {...panels[0]} />
        </CardContent>
      )}
    </Card>
  );
};
