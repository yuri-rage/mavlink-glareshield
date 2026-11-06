// A custom widget's card: header, alert border and badges around its panel.
//
// The card reads every bound value on one clock and hands the panel its readings. What each display type draws, and
// the controls' own state, live in the panel components under ./custom.

import React, { useEffect, useMemo } from 'react';
import type { CustomWidgetDefinition } from '../../types/widget';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { messageRateManager } from '../../mavlink/rateManager';
import type { UnitSystem } from '../../lib/widgetValues';
import { valueSampler } from '../../lib/valueSampler';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { ACCENT_HEX } from './custom/palette';
import { effectiveScheme, feedbackBinding, panelAlert, panelBindings, requiredMessageIds, staleSummary } from './custom/panelModel';
import { SCHEME_CLASSES, useBindingReadings } from './custom/panelKit';
import { WidgetPanel, panelFills, panelIcon } from './custom/WidgetPanel';

// Kept here for existing imports.
export { extractBoundValueFromState, scalePwmToUnitRange } from '../../lib/widgetValues';
export { describeAck } from './custom/panelModel';

valueSampler.setStateGetter(() => useTelemetryStore.getState());

interface CustomWidgetRendererProps {
  definition: CustomWidgetDefinition;
}

export const CustomWidgetRenderer: React.FC<CustomWidgetRendererProps> = ({ definition }) => {
  const system = useUnitsStore((s) => s.system) as UnitSystem;

  const bindings = useMemo(() => panelBindings(definition), [definition]);
  const fbBindings = useMemo(() => {
    const fb = feedbackBinding(definition);
    return fb ? [fb] : [];
  }, [definition]);
  // One read clock for everything the card shows: the panel's values, then its toggle feedback field.
  const allBindings = useMemo(() => [...bindings, ...fbBindings], [bindings, fbBindings]);
  const allReadings = useBindingReadings(allBindings, system, definition.staleAfterSec);
  const readings = allReadings.slice(0, bindings.length);
  const feedback = fbBindings.length ? allReadings[bindings.length] : undefined;

  // Ask the vehicle to stream every message this widget reads.
  const requiredMessages = useMemo(() => requiredMessageIds(definition), [definition]);
  useEffect(() => {
    if (requiredMessages.length === 0) return;
    const key = `custom-${definition.id}`;
    requiredMessages.forEach((id) => messageRateManager.registerRequirement(key, id));
    return () => messageRateManager.unregisterRequirement(key);
  }, [definition.id, requiredMessages]);

  const alert = panelAlert(definition, bindings, readings);
  const stale = staleSummary(bindings, readings);
  const scheme = effectiveScheme(alert, definition.colorScheme);
  const schemeClasses = SCHEME_CLASSES[scheme];
  const HeaderIcon = panelIcon(definition.displayType);

  return (
    <Card
      className={`h-full flex flex-col bg-zinc-950/90 shadow-md transition-colors ${
        alert === 'crit' ? 'border-red-500/80 ring-1 ring-red-500/30' : alert === 'warn' ? 'border-amber-500/70' : 'border-zinc-800'
      }`}
    >
      <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5 truncate">
            <HeaderIcon className={`h-3.5 w-3.5 shrink-0 ${schemeClasses.icon}`} />
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

      <CardContent
        className={`p-3 sm:p-4 space-y-3 flex-1 flex flex-col min-h-0 ${panelFills(definition.displayType) ? '' : 'justify-center'}`}
      >
        <WidgetPanel
          def={definition}
          bindings={bindings}
          readings={readings}
          feedback={feedback}
          system={system}
          alert={alert}
          staleAll={stale.all}
          scheme={schemeClasses}
          accentHex={ACCENT_HEX[scheme]}
        />
      </CardContent>
    </Card>
  );
};
