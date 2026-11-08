// What an imported widget or profile can do to the vehicle: commands it sends, parameters it writes, built-in
// widgets with their own controls. Shared by the widget import and the profile import previews, so both warn
// about the same things.

import type { CustomWidgetDefinition, DashboardTab } from '../types/widget';
import { BUILTIN_PANELS, builtinPanelId } from './builtinWidgets';

type ControlSource = Pick<CustomWidgetDefinition, 'action' | 'paramControl' | 'paramSet'>;

function describeOwn(p: ControlSource): string[] {
  const out: string[] = [];
  if (p.action) out.push(`sends ${p.action.label || 'a command'} (MAV_CMD ${p.action.commandId})`);
  if (p.paramControl) out.push(`writes parameter ${p.paramControl.paramId}`);
  if (p.paramSet && p.paramSet.params.length > 0) {
    const shown = p.paramSet.params.slice(0, 6).join(', ');
    const more = p.paramSet.params.length > 6 ? ` +${p.paramSet.params.length - 6} more` : '';
    out.push(`writes parameters ${shown}${more}`);
  }
  return out;
}

/** Each way one custom widget (including the panels of a composite) can act on the vehicle, as short phrases. */
export function widgetVehicleControls(w: CustomWidgetDefinition): string[] {
  const out = describeOwn(w);
  if (w.displayType === 'composite') {
    (w.panels ?? []).forEach((p, i) => {
      const where = `panel ${i + 1}${p.title ? ` (${p.title})` : ''}`;
      if (p.displayType === 'builtin') {
        const info = BUILTIN_PANELS[builtinPanelId(p.widgetId) ?? ''];
        if (info?.controls) out.push(`${where}: built-in ${info.name}, which can send ${info.controls}`);
        return;
      }
      for (const d of describeOwn(p)) out.push(`${where} ${d}`);
    });
  }
  return out;
}

export interface ProfileControl {
  /** Widget name, or the built-in widget's name. */
  name: string;
  /** What it can do. */
  controls: string[];
  builtin?: boolean;
}

/**
 * Everything in a profile that can act on the vehicle: its custom widgets (composites included), and the
 * built-in widgets with controls placed on its tabs.
 */
export function profileVehicleControls(profile: { customWidgets?: CustomWidgetDefinition[]; tabs?: DashboardTab[] }): ProfileControl[] {
  const out: ProfileControl[] = [];
  for (const w of profile.customWidgets ?? []) {
    const controls = widgetVehicleControls(w);
    if (controls.length > 0) out.push({ name: w.name, controls });
  }
  const builtins = new Set<string>();
  for (const tab of profile.tabs ?? []) {
    for (const placed of tab.widgets ?? []) {
      const id = builtinPanelId(placed.widgetId);
      if (id && BUILTIN_PANELS[id]?.controls) builtins.add(id);
    }
  }
  for (const id of builtins) {
    const info = BUILTIN_PANELS[id];
    out.push({ name: info.name, controls: [`can send ${info.controls}`], builtin: true });
  }
  return out;
}
