// A custom widget's card: header, alert border and badges around its panels.
//
// Most widgets are one panel. A composite widget lays several out on a 12-column grid. The card reads every bound
// value of every panel on one clock and hands each panel its share. What each display type draws, and the controls'
// own state, live in the panel components under ./custom.

import React, { useEffect, useMemo, useRef, useState } from 'react';

import { valueSampler } from '../../lib/valueSampler';
import type { AlertState, BindingReading, UnitSystem } from '../../lib/widgetValues';
import { messageRateManager } from '../../mavlink/rateManager';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import type { CustomWidgetDefinition, WidgetDataBinding } from '../../types/widget';
import { useInPane } from '../dashboard/paneContext';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ACCENT_HEX } from './custom/palette';
import { SCHEME_CLASSES, useBindingReadings, type PanelProps } from './custom/panelKit';
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
import { panelFills, panelIcon, WidgetPanel } from './custom/WidgetPanel';

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
  // In a Cockpit pane: fill it (see the composite grid below).
  const inPane = useInPane();

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
  const allBindings = useMemo(
    () => layout.flatMap((p) => (p.feedback ? [...p.bindings, p.feedback] : p.bindings)),
    [layout]
  );
  const staleTimeouts = useMemo(
    () =>
      layout.flatMap((p) =>
        Array<number | undefined>(p.bindings.length + (p.feedback ? 1 : 0)).fill(p.def.staleAfterSec)
      ),
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
      className={`flex h-full flex-col bg-zinc-950/90 shadow-md transition-colors ${
        alert === 'crit'
          ? 'border-red-500/80 ring-1 ring-red-500/30'
          : alert === 'warn'
            ? 'border-amber-500/70'
            : 'border-zinc-800'
      }`}
    >
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-1.5 truncate text-xs font-bold uppercase tracking-wider text-zinc-300">
            <HeaderIcon className={`h-3.5 w-3.5 shrink-0 ${cardScheme.icon}`} />
            <span className="truncate">{definition.name}</span>
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {stale.count > 0 && (
              <Badge
                variant="secondary"
                className="px-1.5 py-0 font-mono text-[10px] uppercase"
                title={`No ${stale.messages.join(', ')} received for ${stale.ageSec}s`}
              >
                Stale {stale.ageSec}s
              </Badge>
            )}
            {alert !== 'normal' && !stale.all && (
              <Badge
                variant={alert === 'crit' ? 'destructive' : 'warning'}
                className="animate-pulse px-1.5 py-0 font-mono text-[10px] uppercase"
              >
                {alert === 'crit' ? 'CRIT' : 'WARN'}
              </Badge>
            )}
            <Badge variant="secondary" className="font-sans text-[10px] font-semibold capitalize">
              {definition.category}
            </Badge>
          </div>
        </div>
      </CardHeader>

      {isComposite ? (
        // In a pane, a composite taller than the pane scrolls inside the card (its header and border stay put).
        // In a pane, a little tighter (padding, gaps, tiles): a pane's height is fixed, a Flow card's grows.
        <CardContent className={`min-h-0 flex-1 ${inPane ? 'overflow-y-auto p-2 sm:p-2' : 'p-2.5 sm:p-3'}`}>
          {/* In a Cockpit pane the rows share its height (each at least its content), so the card fills the pane rather
              than leaving a gap below or scrolling; elsewhere they keep their natural heights. */}
          <div
            ref={gridRef}
            className={`grid h-full grid-cols-12 ${inPane ? 'content-stretch gap-2 [grid-auto-rows:minmax(min-content,1fr)]' : 'content-start gap-2.5'}`}
          >
            {panels.map((p, i) => {
              const span = stacked ? 12 : panelSpan(definition, i);
              const title = definition.panels?.[i]?.title?.trim();
              const Icon = panelIcon(p.def.displayType);
              return (
                <section
                  key={`${i}-${p.def.displayType}`}
                  style={{ gridColumn: `span ${span} / span ${span}` }}
                  // A size container: a panel's values scale with its own width (TelemetryPanels).
                  className={`flex min-w-0 flex-col rounded-lg border bg-zinc-900/30 ${inPane ? 'p-2' : 'p-2.5'} transition-colors @container ${
                    p.alert === 'crit'
                      ? 'border-red-500/60'
                      : p.alert === 'warn'
                        ? 'border-amber-500/50'
                        : 'border-zinc-800/80'
                  }`}
                  aria-label={title || undefined}
                >
                  {/* A built-in widget brings its own title row. */}
                  {title && p.def.displayType !== 'builtin' && (
                    <h4
                      className={`${inPane ? 'mb-1' : 'mb-1.5'} flex items-center gap-1 truncate text-[11px] font-semibold uppercase tracking-wider text-zinc-400`}
                    >
                      <Icon className={`h-3 w-3 shrink-0 ${p.scheme.icon}`} />
                      <span className="truncate">{title}</span>
                    </h4>
                  )}
                  <div
                    className={`flex min-h-0 flex-1 flex-col space-y-3 ${panelFills(p.def.displayType) ? '' : 'justify-center'}`}
                  >
                    <WidgetPanel {...p} />
                  </div>
                </section>
              );
            })}
            {panels.length === 0 && (
              <p className="col-span-12 py-4 text-center text-xs text-zinc-500">No panels configured.</p>
            )}
          </div>
        </CardContent>
      ) : (
        // In a pane, content taller than the pane scrolls inside the card. Centring uses my-auto on a wrapper, not
        // justify-center, which would push overflowing content's top out of reach.
        <CardContent className={`flex min-h-0 flex-1 flex-col p-3 sm:p-4 ${inPane ? 'overflow-y-auto' : ''}`}>
          <div
            className={`flex flex-col space-y-3 ${panelFills(definition.displayType) ? 'min-h-0 flex-1' : 'my-auto'}`}
          >
            <WidgetPanel {...panels[0]} />
          </div>
        </CardContent>
      )}
    </Card>
  );
};
