import { BUILTIN_PANELS, builtinPanelId } from '../../lib/builtinWidgets';
import { VALID_DISPLAY_TYPES, sanitizeWidgetDefinition } from '../../lib/widgetValidation';
import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CustomWidgetDefinition, WidgetDisplayType } from '../../types/widget';
import { MAV_CMD } from '../../mavlink/messages';
import {
  Compass,
  Radio,
  Shield,
  MapPin,
  Milestone,
  Battery,
  Satellite,
  Gauge,
  Terminal,
  Sliders,
  LineChart,
  Plus,
  Upload,
  Zap,
  AlertTriangle,
  Pencil,
  Trash2,
  Check,
} from 'lucide-react';

function getMavCmdName(cmdId: number): string {
  for (const [key, val] of Object.entries(MAV_CMD)) {
    if (val === cmdId) return key;
  }
  return `CMD_${cmdId}`;
}

interface AddWidgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenWidgetCreator: () => void;
  onEditCustomWidget?: (widget: CustomWidgetDefinition) => void;
}

const BUILT_IN_CATALOG = [
  {
    id: 'built-in-glareshield',
    name: 'Flight Controls (Arming & Quick Modes)',
    category: 'control',
    description: 'Safety master arm/disarm slider and quick mode selector buttons.',
    icon: Shield,
    defaultSpan: 12,
  },
  {
    id: 'built-in-all-modes',
    name: 'All Flight Modes',
    category: 'control',
    description: 'Full grid of all selectable flight modes for the active vehicle type with live status.',
    icon: Sliders,
    defaultSpan: 12,
  },
  {
    id: 'built-in-set-speed',
    name: 'Set Speed Controller',
    category: 'control',
    description: 'Command vehicle target cruising or navigation speed with live speed indicator.',
    icon: Gauge,
    defaultSpan: 6,
  },
  {
    id: 'built-in-hud',
    name: 'Heads-Up Display (HUD)',
    category: 'avionics',
    description: 'Collimated artificial horizon, pitch ladder, roll arc, altitude/airspeed tapes, and waypoint counter.',
    icon: Compass,
    defaultSpan: 6,
  },
  {
    id: 'built-in-map',
    name: 'Tactical Navigation Map',
    category: 'avionics',
    description: 'Leaflet GPS map with vehicle heading vector, breadcrumb trail, and mission waypoints.',
    icon: MapPin,
    defaultSpan: 6,
  },
  {
    id: 'built-in-battery-card',
    name: 'Battery & Power Card',
    category: 'telemetry',
    description: 'Bus voltage, current draw, remaining capacity %, and individual cell voltages.',
    icon: Battery,
    defaultSpan: 4,
  },
  {
    id: 'built-in-gps-card',
    name: 'GNSS / GPS Card',
    category: 'telemetry',
    description: 'Fix status (3D/RTK), satellite count, HDOP precision, and coordinates.',
    icon: Satellite,
    defaultSpan: 4,
  },
  {
    id: 'built-in-vfr-hud',
    name: 'VFR Flight Metrics',
    category: 'telemetry',
    description: 'Groundspeed, airspeed, climb rate, throttle percentage, and compass heading.',
    icon: Gauge,
    defaultSpan: 4,
  },
  {
    id: 'built-in-charts',
    name: 'Real-Time Telemetry Charts',
    category: 'telemetry',
    description: 'Rolling time-series graphs of altitude, groundspeed, and battery current.',
    icon: LineChart,
    defaultSpan: 12,
  },
  {
    id: 'built-in-statustext',
    name: 'MAVLink STATUSTEXT Console',
    category: 'telemetry',
    description: 'Live flight controller status message log with severity filtering and audio alerts.',
    icon: Terminal,
    defaultSpan: 6,
  },
  {
    id: 'built-in-statustext-mini',
    name: 'Mini STATUSTEXT',
    category: 'telemetry',
    description: 'Compact message log, newest first. Control-widget height by default; grows with taller neighbours. Also fits in composite cards.',
    icon: Terminal,
    defaultSpan: 4,
  },
  {
    id: 'built-in-parameters',
    name: 'ArduPilot Parameter Manager',
    category: 'control',
    description: 'Searchable parameter table with live modification and reading from vehicle.',
    icon: Sliders,
    defaultSpan: 6,
  },
  {
    id: 'built-in-ntrip',
    name: 'RTK / NTRIP Correction Injector',
    category: 'avionics',
    description: 'Stream RTCM3 corrections from an NTRIP caster or USB serial base station and inject into vehicle GPS.',
    icon: Satellite,
    defaultSpan: 6,
  },
  {
    id: 'built-in-waypoints',
    name: 'Waypoint Navigation & Mission Control',
    category: 'control',
    description: 'Advance to next waypoint, jump immediately to any mission waypoint, and track active waypoint metrics.',
    icon: Milestone,
    defaultSpan: 6,
  },
];

/** What an import preview lists: the widget itself, or each panel of a composite widget. */
interface ImportPart {
  heading?: string;
  /** A built-in widget panel: its name and the vehicle controls it contains, if any. */
  builtin?: { name: string; controls?: string };
  binding?: CustomWidgetDefinition['binding'];
  extraCount: number;
  action?: CustomWidgetDefinition['action'];
  paramControl?: CustomWidgetDefinition['paramControl'];
}

function importParts(w: CustomWidgetDefinition): ImportPart[] {
  const part = (p: Pick<CustomWidgetDefinition, 'binding' | 'bindings' | 'action' | 'paramControl'>, heading?: string): ImportPart => ({
    heading,
    binding: p.binding,
    extraCount: p.bindings?.length ?? 0,
    action: p.action,
    paramControl: p.paramControl,
  });
  if (w.displayType !== 'composite') return [part(w)];
  return (w.panels ?? []).map((p, i) => {
    const heading = `Panel ${i + 1}${p.title ? `: ${p.title}` : ''} (${p.displayType})`;
    if (p.displayType !== 'builtin') return part(p, heading);
    const info = BUILTIN_PANELS[builtinPanelId(p.widgetId) ?? ''];
    return { heading, extraCount: 0, builtin: { name: info?.name ?? String(p.widgetId), controls: info?.controls } };
  });
}

const ImportPartDetails: React.FC<{ part: ImportPart }> = ({ part }) => (
  <div className={part.heading ? 'mt-2 pl-2 border-l-2 border-zinc-700 space-y-1' : 'space-y-1'}>
    {part.heading && <div className="text-zinc-200 font-bold">{part.heading}</div>}
    {part.builtin && <div>Built-in widget: <b className="text-zinc-100">{part.builtin.name}</b></div>}
    {part.builtin?.controls && (
      <div className="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded mt-2 space-y-1 text-amber-200">
        <div className="font-bold flex items-center gap-1.5 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Built-in Vehicle Controls:
        </div>
        <div>This panel can send {part.builtin.controls}.</div>
        <div className="text-[11px] text-amber-400 mt-1">
          * These are the built-in widget's own controls, with its own confirmations, as when you place it yourself.
        </div>
      </div>
    )}
    {part.binding && (
      <div className="p-2 bg-zinc-950 rounded border border-zinc-800 mt-2 space-y-0.5">
        <div className="text-zinc-300 font-bold">Telemetry Binding:</div>
        <div>Message: {part.binding.messageName}</div>
        <div>Field: {part.binding.fieldName}</div>
        <div>Unit: {part.binding.unit || 'none'}</div>
        {part.extraCount > 0 && <div>+ {part.extraCount} more value{part.extraCount === 1 ? '' : 's'}</div>}
      </div>
    )}
    {part.action && (
      <div className="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded mt-2 space-y-1 text-amber-200">
        <div className="font-bold flex items-center gap-1.5 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Autopilot Action Command:
        </div>
        <div>Label: <b className="text-zinc-100">{part.action.label}</b></div>
        <div>MAV_CMD: <b className="text-zinc-100">{getMavCmdName(part.action.commandId)} ({part.action.commandId})</b></div>
        <div>Parameters: [{part.action.params.join(', ')}]</div>
        <div className="text-[11px] text-amber-400 mt-1">
          * Confirmation is enforced on imported actions to prevent accidental autopilot commands.
        </div>
      </div>
    )}
    {part.paramControl && (
      <div className="p-2.5 bg-amber-950/40 border border-amber-600/40 rounded mt-2 space-y-1 text-amber-200">
        <div className="font-bold flex items-center gap-1.5 text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Autopilot Parameter Control:
        </div>
        <div>Target Parameter: <b className="text-zinc-100 font-mono">{part.paramControl.paramId}</b></div>
        {part.paramControl.min !== undefined && part.paramControl.max !== undefined && (
          <div>Allowed Range: <b className="text-zinc-100 font-mono">[{part.paramControl.min}, {part.paramControl.max}] {part.paramControl.unit || ''}</b></div>
        )}
        {part.paramControl.options && part.paramControl.options.length > 0 && (
          <div>Options: <b className="text-zinc-100 font-mono">{part.paramControl.options.map((o) => `${o.label}:${o.value}`).join(', ')}</b></div>
        )}
        <div className="text-[11px] text-amber-400 mt-1">
          * Confirmation is enforced on imported parameter controls to prevent unintended vehicle configuration changes.
        </div>
      </div>
    )}
  </div>
);

export const AddWidgetModal: React.FC<AddWidgetModalProps> = ({
  isOpen,
  onClose,
  onOpenWidgetCreator,
  onEditCustomWidget,
}) => {
  const { profile, activeTabId, addWidgetToActiveTab, saveCustomWidget, deleteCustomWidget } = useDashboardStore();
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [pendingImportWidget, setPendingImportWidget] = useState<CustomWidgetDefinition | null>(null);

  const activeTab = profile.tabs.find((t) => t.id === activeTabId) || profile.tabs[0];
  const placedWidgetIdsOnTab = new Set(activeTab ? activeTab.widgets.map((w) => w.widgetId) : []);

  const handleAddBuiltIn = (widgetId: string, colSpan: number) => {
    addWidgetToActiveTab(widgetId, colSpan);
    onClose();
  };

  const handleUploadJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const raw = JSON.parse(event.target?.result as string) as CustomWidgetDefinition;
        if (raw.id && raw.name && raw.displayType) {
          if (!VALID_DISPLAY_TYPES.has(raw.displayType)) {
            alert(`Invalid custom widget displayType: ${raw.displayType}`);
            return;
          }
          const parsed = sanitizeWidgetDefinition(raw);

          // Check if ID collides with built-in or existing custom widgets
          const existingWidgets = useDashboardStore.getState().profile.customWidgets;
          const existingIds = new Set([
            ...BUILT_IN_CATALOG.map((b) => b.id),
            ...existingWidgets.map((c) => c.id),
          ]);
          const isDuplicateId = existingIds.has(parsed.id);
          const isDuplicateName = existingWidgets.some((c) => c.name.trim().toLowerCase() === parsed.name.trim().toLowerCase());

          if (isDuplicateId) {
            const freshId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            console.warn(`[Widget Import] ID "${parsed.id}" collides with existing widget. Reassigned to fresh ID "${freshId}".`);
            parsed.id = freshId;
          }

          if ((isDuplicateId || isDuplicateName) && !parsed.name.includes('(imported)')) {
            parsed.name = `${parsed.name} (imported)`;
          }

          // sanitizeWidgetDefinition() above already forced confirmation on actions and parameter writes.
          setPendingImportWidget(parsed);
        } else {
          alert('Invalid custom widget format: missing id, name, or displayType.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const filteredBuiltIn = filterCategory === 'all'
    ? BUILT_IN_CATALOG
    : BUILT_IN_CATALOG.filter((w) => w.category === filterCategory);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Widget to Current View"
      description="Choose a built-in instrument or select/upload a declarative custom widget."
    >
      <div className="space-y-4">
        {pendingImportWidget ? (
          <div className="space-y-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="flex items-center gap-2 text-sky-400 font-bold text-sm">
              <Zap className="h-4 w-4" />
              <span>Import Preview: {pendingImportWidget.name}</span>
            </div>
            <div className="text-xs text-zinc-400 space-y-1.5 font-mono">
              <div><b className="text-zinc-300">Display Type:</b> {pendingImportWidget.displayType}</div>
              <div><b className="text-zinc-300">Category:</b> {pendingImportWidget.category}</div>
              {pendingImportWidget.description && <div><b className="text-zinc-300">Description:</b> {pendingImportWidget.description}</div>}
              {importParts(pendingImportWidget).map((part, i) => (
                <ImportPartDetails key={i} part={part} />
              ))}
              {!importParts(pendingImportWidget).some((p) => p.action || p.paramControl || p.builtin?.controls) && (
                <div className="text-zinc-500 italic mt-1">No autopilot actions or parameter controls (read-only instrument).</div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="default"
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={() => {
                  saveCustomWidget(pendingImportWidget);
                  addWidgetToActiveTab(pendingImportWidget.id, pendingImportWidget.displayType === 'composite' ? 12 : 6);
                  setPendingImportWidget(null);
                  onClose();
                }}
              >
                Accept & Add to View
              </Button>
              <Button
                variant="outline"
                onClick={() => setPendingImportWidget(null)}
                className="text-zinc-400"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Action Header: Creator & Upload */}
        <div className="flex items-center gap-2 p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl">
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              onClose();
              onOpenWidgetCreator();
            }}
            className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold gap-1.5 h-9"
          >
            <Plus className="h-4 w-4" />
            Build Custom Widget
          </Button>

          <label className="flex-1">
            <input
              type="file"
              accept=".json"
              onChange={handleUploadJson}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="w-full gap-1.5 h-9 border-zinc-700 text-zinc-200 pointer-events-none"
            >
              <Upload className="h-4 w-4 text-emerald-400" />
              Upload .json Widget
            </Button>
          </label>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs pb-1">
          {['all', 'control', 'avionics', 'telemetry', 'custom'].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`px-3 py-1 rounded-lg capitalize font-semibold transition-colors ${
                filterCategory === cat
                  ? 'bg-zinc-800 text-sky-400 border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Widget Catalog List */}
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
          {/* Custom User Widgets */}
          {(filterCategory === 'all' || filterCategory === 'custom') &&
            profile.customWidgets.map((cw) => (
              <div
                key={cw.id}
                className="flex items-start justify-between p-3 rounded-xl border border-sky-950/60 bg-sky-950/10 hover:border-sky-500/40 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 mt-0.5">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 flex items-center gap-1.5 flex-wrap">
                      {cw.name}
                      <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-sky-950 text-sky-300 border border-sky-800">
                        {cw.displayType}
                      </span>
                      {placedWidgetIdsOnTab.has(cw.id) && (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-0.5">
                          <Check className="h-2.5 w-2.5" /> On Tab
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{cw.description || 'Custom user widget'}</p>
                  </div>
                </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {onEditCustomWidget && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 px-2 text-xs border-zinc-700 text-zinc-300 hover:text-white"
                        onClick={() => onEditCustomWidget(cw)}
                        title="Edit custom widget definition"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs border-zinc-700 text-red-400 hover:text-red-300 hover:border-red-500/40"
                      onClick={() => deleteCustomWidget(cw.id)}
                      title="Delete custom widget definition"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="h-8 px-3 text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white"
                      onClick={() => handleAddBuiltIn(cw.id, 6)}
                    >
                      Place
                    </Button>
                  </div>
                </div>
              ))}

          {/* Built-in Widgets */}
          {filteredBuiltIn.map((item) => {
            const Icon = item.icon;
            const isAlreadyOnTab = placedWidgetIdsOnTab.has(item.id);
            return (
              <div
                key={item.id}
                className="flex items-start justify-between p-3 rounded-xl border border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-zinc-800 text-zinc-300 mt-0.5">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 flex items-center gap-1.5 flex-wrap">
                      <span>{item.name}</span>
                      {isAlreadyOnTab && (
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-0.5 font-sans">
                          <Check className="h-2.5 w-2.5" /> On Tab
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5">{item.description}</p>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs font-bold border-zinc-700 hover:bg-zinc-800"
                  onClick={() => handleAddBuiltIn(item.id, item.defaultSpan)}
                >
                  {isAlreadyOnTab ? 'Place Copy' : 'Place'}
                </Button>
              </div>
            );
          })}
        </div>
        </>
        )}
      </div>
    </Modal>
  );
};
