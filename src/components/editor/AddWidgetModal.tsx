import React, { useEffect, useRef, useState } from 'react';

import {
  Activity,
  AlertTriangle,
  Battery,
  Check,
  Compass,
  FileText,
  Gauge,
  LineChart,
  MapPin,
  Milestone,
  Pencil,
  Plus,
  Radio,
  Satellite,
  Search,
  Shield,
  Sliders,
  Terminal,
  Trash2,
  Upload,
  Waves,
  Zap,
} from 'lucide-react';

import { BUILTIN_PANELS, builtinPanelId } from '../../lib/builtinWidgets';
import { fuzzyRank } from '../../lib/fuzzy';
import { sanitizeWidgetDefinition, VALID_DISPLAY_TYPES } from '../../lib/widgetValidation';
import { MAV_CMD } from '../../mavlink/messages';
import { useDashboardStore } from '../../store/dashboardStore';
import { CustomWidgetDefinition } from '../../types/widget';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';

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

/** What a custom widget is searched by: its name and description, type, and its panels' titles and bound fields. */
function customSearchFields(cw: CustomWidgetDefinition): string[] {
  const bindings = [
    cw.binding,
    ...(cw.bindings ?? []),
    ...(cw.panels ?? []).flatMap((p) => [p.binding, ...(p.bindings ?? [])]),
  ];
  return [
    cw.name,
    cw.description ?? '',
    cw.displayType,
    ...(cw.panels ?? []).map((p) => p.title ?? ''),
    ...bindings.filter(Boolean).map((b) => `${b!.messageName} ${b!.fieldName} ${b!.label ?? ''}`),
    cw.action?.label ?? '',
    cw.paramControl?.paramId ?? '',
  ];
}

const BUILT_IN_CATALOG = [
  {
    id: 'built-in-glareshield',
    name: 'Arm & Modes',
    category: 'control',
    description: 'The slide-to-arm interlock and quick mode buttons (Takeoff, Auto, Loiter, RTL, Land).',
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
    description:
      'Collimated artificial horizon, pitch ladder, roll arc, altitude/airspeed tapes, and waypoint counter.',
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
    id: 'built-in-logs',
    name: 'Logs',
    category: 'telemetry',
    description:
      "The vehicle's DataFlash (.bin) logs: list, download to this computer (MAVFTP when possible, otherwise MAVLink) and erase. ArduPilot only sends logs while disarmed.",
    icon: FileText,
    defaultSpan: 6,
  },
  {
    id: 'built-in-inspector',
    name: 'MAVLink Inspector',
    category: 'telemetry',
    description:
      "Every message on the link by system and component, with its rate; select one for its latest fields, decoded from ArduPilot's message definitions with units. For development and debugging.",
    icon: Waves,
    defaultSpan: 12,
  },
  {
    id: 'built-in-pid-tuning',
    name: 'PID Tuning',
    category: 'telemetry',
    description:
      "Desired vs achieved for one controller, with its P / I / D / FF terms, from PID_TUNING. Offers the vehicle type's own controllers and switches their reporting (GCS_PID_MASK).",
    icon: Activity,
    defaultSpan: 6,
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
    id: 'built-in-link',
    name: 'Link',
    category: 'telemetry',
    description:
      "The link to the vehicle: downlink quality (bars, from packet sequence numbers), packets received and lost, rate, uplink loss, a telemetry radio's signal, and quality over two minutes. Choose what it shows.",
    icon: Radio,
    defaultSpan: 4,
  },
  {
    id: 'built-in-statustext-mini',
    name: 'Mini STATUSTEXT',
    category: 'telemetry',
    description:
      'Compact message log, newest first. Control-widget height by default; grows with taller neighbors. Also fits in composite cards.',
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
    description:
      'Stream RTCM3 corrections from an NTRIP caster or USB serial base station and inject into vehicle GPS.',
    icon: Satellite,
    defaultSpan: 6,
  },
  {
    id: 'built-in-waypoints',
    name: 'Waypoint Navigation & Mission Control',
    category: 'control',
    description:
      'Advance to next waypoint, jump immediately to any mission waypoint, and track active waypoint metrics.',
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
  paramSet?: CustomWidgetDefinition['paramSet'];
}

function importParts(w: CustomWidgetDefinition): ImportPart[] {
  const part = (
    p: Pick<CustomWidgetDefinition, 'binding' | 'bindings' | 'action' | 'paramControl' | 'paramSet'>,
    heading?: string
  ): ImportPart => ({
    heading,
    binding: p.binding,
    extraCount: p.bindings?.length ?? 0,
    action: p.action,
    paramControl: p.paramControl,
    paramSet: p.paramSet,
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
  <div className={part.heading ? 'mt-2 space-y-1 border-l-2 border-zinc-700 pl-2' : 'space-y-1'}>
    {part.heading && <div className="font-bold text-zinc-200">{part.heading}</div>}
    {part.builtin && (
      <div>
        Built-in widget: <b className="text-zinc-100">{part.builtin.name}</b>
      </div>
    )}
    {part.builtin?.controls && (
      <div className="mt-2 space-y-1 rounded border border-amber-600/40 bg-amber-950/40 p-2.5 text-amber-200">
        <div className="flex items-center gap-1.5 font-bold text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Built-in Vehicle Controls:
        </div>
        <div>This panel can send {part.builtin.controls}.</div>
        <div className="mt-1 text-[11px] text-amber-400">
          * These are the built-in widget's own controls, with its own confirmations, as when you place it yourself.
        </div>
      </div>
    )}
    {part.binding && (
      <div className="mt-2 space-y-0.5 rounded border border-zinc-800 bg-zinc-950 p-2">
        <div className="font-bold text-zinc-300">Telemetry Binding:</div>
        <div>Message: {part.binding.messageName}</div>
        <div>Field: {part.binding.fieldName}</div>
        <div>Unit: {part.binding.unit || 'none'}</div>
        {part.extraCount > 0 && (
          <div>
            + {part.extraCount} more value{part.extraCount === 1 ? '' : 's'}
          </div>
        )}
      </div>
    )}
    {part.action && (
      <div className="mt-2 space-y-1 rounded border border-amber-600/40 bg-amber-950/40 p-2.5 text-amber-200">
        <div className="flex items-center gap-1.5 font-bold text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Autopilot Action Command:
        </div>
        <div>
          Label: <b className="text-zinc-100">{part.action.label}</b>
        </div>
        <div>
          MAV_CMD:{' '}
          <b className="text-zinc-100">
            {getMavCmdName(part.action.commandId)} ({part.action.commandId})
          </b>
        </div>
        <div>Parameters: [{part.action.params.join(', ')}]</div>
        <div className="mt-1 text-[11px] text-amber-400">
          * Confirmation is enforced on imported actions to prevent accidental autopilot commands.
        </div>
      </div>
    )}
    {part.paramControl && (
      <div className="mt-2 space-y-1 rounded border border-amber-600/40 bg-amber-950/40 p-2.5 text-amber-200">
        <div className="flex items-center gap-1.5 font-bold text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Autopilot Parameter Control:
        </div>
        <div>
          Target Parameter: <b className="font-mono text-zinc-100">{part.paramControl.paramId}</b>
        </div>
        {part.paramControl.min !== undefined && part.paramControl.max !== undefined && (
          <div>
            Allowed Range:{' '}
            <b className="font-mono text-zinc-100">
              [{part.paramControl.min}, {part.paramControl.max}] {part.paramControl.unit || ''}
            </b>
          </div>
        )}
        {part.paramControl.options && part.paramControl.options.length > 0 && (
          <div>
            Options:{' '}
            <b className="font-mono text-zinc-100">
              {part.paramControl.options.map((o) => `${o.label}:${o.value}`).join(', ')}
            </b>
          </div>
        )}
        <div className="mt-1 text-[11px] text-amber-400">
          * Confirmation is enforced on imported parameter controls to prevent unintended vehicle configuration changes.
        </div>
      </div>
    )}
    {part.paramSet && (
      <div className="mt-2 space-y-1 rounded border border-amber-600/40 bg-amber-950/40 p-2.5 text-amber-200">
        <div className="flex items-center gap-1.5 font-bold text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Autopilot Parameter Set:
        </div>
        <div>
          Can edit: <b className="break-words font-mono text-zinc-100">{part.paramSet.params.join(', ') || '(none)'}</b>
        </div>
        <div className="mt-1 text-[11px] text-amber-400">
          * Patterns such as BATT_* cover every matching parameter on the vehicle. Confirmation is enforced on every
          write from an imported set.
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
  // Fuzzy search over the catalog (names, descriptions, ids; a custom widget's panels and bound fields too).
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Each time it opens: an empty search, focused (type straight away; Enter places the best match).
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    const t = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);
  const uploadRef = useRef<HTMLInputElement>(null);
  /** Deleting a definition also removes it from every tab, so it takes a second click. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
          const existingIds = new Set([...BUILT_IN_CATALOG.map((b) => b.id), ...existingWidgets.map((c) => c.id)]);
          const isDuplicateId = existingIds.has(parsed.id);
          const isDuplicateName = existingWidgets.some(
            (c) => c.name.trim().toLowerCase() === parsed.name.trim().toLowerCase()
          );

          if (isDuplicateId) {
            const freshId = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            console.warn(
              `[Widget Import] ID "${parsed.id}" collides with existing widget. Reassigned to fresh ID "${freshId}".`
            );
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

  type BuiltIn = (typeof BUILT_IN_CATALOG)[number];
  type Entry = { kind: 'custom'; cw: CustomWidgetDefinition } | { kind: 'builtin'; item: BuiltIn };
  const builtInPool =
    filterCategory === 'all' ? BUILT_IN_CATALOG : BUILT_IN_CATALOG.filter((w) => w.category === filterCategory);
  const customPool = filterCategory === 'all' || filterCategory === 'custom' ? profile.customWidgets : [];
  // No search: custom widgets, then the built-ins, as before. Searching: one list, best match first (on a tie a
  // custom widget first).
  const entries: Entry[] = !query.trim()
    ? [
        ...customPool.map((cw): Entry => ({ kind: 'custom', cw })),
        ...builtInPool.map((item): Entry => ({ kind: 'builtin', item })),
      ]
    : [
        ...fuzzyRank(customPool, query, customSearchFields).map(({ item, score }) => ({
          score,
          e: { kind: 'custom', cw: item } as Entry,
        })),
        ...fuzzyRank(builtInPool, query, (w) => [w.name, w.description, w.id, w.category]).map(({ item, score }) => ({
          score,
          e: { kind: 'builtin', item } as Entry,
        })),
      ]
        .map((x, i) => ({ ...x, i }))
        .sort((p, q) => q.score - p.score || p.i - q.i)
        .map((x) => x.e);
  const nothingMatches = query.trim() !== '' && entries.length === 0;
  /** Enter in the search box places the best match. */
  const placeBest = () => {
    const e = entries[0];
    if (!e) return;
    if (e.kind === 'custom') handleAddBuiltIn(e.cw.id, e.cw.displayType === 'composite' ? 12 : 6);
    else handleAddBuiltIn(e.item.id, e.item.defaultSpan);
  };

  const renderCustom = (cw: CustomWidgetDefinition) => (
    <div
      key={cw.id}
      className="flex flex-col justify-between gap-2 rounded-xl border border-sky-950/60 bg-sky-950/10 p-3 transition-all hover:border-sky-500/40 sm:flex-row sm:items-start"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="mt-0.5 rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-400">
          <Zap className="h-4 w-4" />
        </div>
        <div>
          <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-zinc-100">
            {cw.name}
            <span className="py-0.2 rounded border border-sky-800 bg-sky-950 px-1.5 text-[9px] uppercase text-sky-300">
              {cw.displayType}
            </span>
            {placedWidgetIdsOnTab.has(cw.id) && (
              <span className="py-0.2 inline-flex items-center gap-0.5 rounded border border-emerald-500/40 bg-emerald-950/80 px-1.5 text-[9px] uppercase text-emerald-400">
                <Check className="h-2.5 w-2.5" /> On Tab
              </span>
            )}
          </h4>
          <p className="mt-0.5 text-[11px] text-zinc-400">{cw.description || 'Custom user widget'}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        {onEditCustomWidget && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 px-2 text-xs text-zinc-300 hover:text-white"
            onClick={() => onEditCustomWidget(cw)}
            title="Edit custom widget definition"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
        {confirmDeleteId === cw.id ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-8 gap-1 bg-red-600 px-2 text-xs font-bold text-white hover:bg-red-700"
            onClick={() => {
              deleteCustomWidget(cw.id);
              setConfirmDeleteId(null);
            }}
            onBlur={() => setConfirmDeleteId(null)}
            autoFocus
            title="Delete this definition and remove it from every tab"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete?
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 border-zinc-700 px-2 text-xs text-red-400 hover:border-red-500/40 hover:text-red-300"
            onClick={() => setConfirmDeleteId(cw.id)}
            title="Delete custom widget definition (asks to confirm)"
            aria-label={`Delete ${cw.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="default"
          className="h-8 bg-sky-500 px-3 text-xs font-bold text-white hover:bg-sky-600"
          onClick={() => handleAddBuiltIn(cw.id, cw.displayType === 'composite' ? 12 : 6)}
        >
          Place
        </Button>
      </div>
    </div>
  );

  const renderBuiltIn = (item: BuiltIn) => {
    const Icon = item.icon;
    const isAlreadyOnTab = placedWidgetIdsOnTab.has(item.id);
    return (
      <div
        key={item.id}
        className="flex flex-col justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 transition-all hover:border-zinc-700 sm:flex-row sm:items-start"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-zinc-800 p-2 text-zinc-300">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h4 className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-zinc-100">
              <span>{item.name}</span>
              {isAlreadyOnTab && (
                <span className="py-0.2 inline-flex items-center gap-0.5 rounded border border-emerald-500/40 bg-emerald-950/80 px-1.5 font-sans text-[9px] uppercase text-emerald-400">
                  <Check className="h-2.5 w-2.5" /> On Tab
                </span>
              )}
            </h4>
            <p className="mt-0.5 text-[11px] text-zinc-400">{item.description}</p>
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 self-end border-zinc-700 px-3 text-xs font-bold hover:bg-zinc-800 sm:self-auto"
          onClick={() => handleAddBuiltIn(item.id, item.defaultSpan)}
        >
          {isAlreadyOnTab ? 'Place Copy' : 'Place'}
        </Button>
      </div>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add Widget to Current View"
      description="Choose a built-in instrument or select/upload a declarative custom widget."
    >
      <div className="space-y-4">
        {pendingImportWidget ? (
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-sky-400">
              <Zap className="h-4 w-4" />
              <span>Import Preview: {pendingImportWidget.name}</span>
            </div>
            <div className="space-y-1.5 font-mono text-xs text-zinc-400">
              <div>
                <b className="text-zinc-300">Display Type:</b> {pendingImportWidget.displayType}
              </div>
              <div>
                <b className="text-zinc-300">Category:</b> {pendingImportWidget.category}
              </div>
              {pendingImportWidget.description && (
                <div>
                  <b className="text-zinc-300">Description:</b> {pendingImportWidget.description}
                </div>
              )}
              {importParts(pendingImportWidget).map((part, i) => (
                <ImportPartDetails key={i} part={part} />
              ))}
              {!importParts(pendingImportWidget).some(
                (p) => p.action || p.paramControl || p.paramSet || p.builtin?.controls
              ) && (
                <div className="mt-1 italic text-zinc-500">
                  No autopilot actions or parameter controls (read-only instrument).
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="default"
                className="flex-1 bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                onClick={() => {
                  saveCustomWidget(pendingImportWidget);
                  addWidgetToActiveTab(
                    pendingImportWidget.id,
                    pendingImportWidget.displayType === 'composite' ? 12 : 6
                  );
                  setPendingImportWidget(null);
                  onClose();
                }}
              >
                Accept & Add to View
              </Button>
              <Button variant="outline" onClick={() => setPendingImportWidget(null)} className="text-zinc-400">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Action Header: Creator & Upload */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  onClose();
                  onOpenWidgetCreator();
                }}
                className="h-9 min-w-[9rem] flex-1 gap-1.5 bg-sky-500 font-bold text-white hover:bg-sky-600"
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">Build Custom Widget</span>
              </Button>

              <input
                ref={uploadRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  handleUploadJson(e);
                  e.target.value = ''; // the same file can be chosen again
                }}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => uploadRef.current?.click()}
                className="h-9 min-w-[9rem] flex-1 gap-1.5 border-zinc-700 text-zinc-200"
              >
                <Upload className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="truncate">Upload .json Widget</span>
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    placeBest();
                  }
                }}
                placeholder="Search widgets (e.g. bat, hud, rc chan)…"
                aria-label="Search widgets"
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-950 pl-8 pr-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap items-center gap-1.5 pb-1 text-xs">
              {['all', 'control', 'avionics', 'telemetry', 'custom'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(cat)}
                  className={`rounded-lg px-3 py-1 font-semibold capitalize transition-colors ${
                    filterCategory === cat
                      ? 'border border-zinc-700 bg-zinc-800 text-sky-400'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Widget Catalog List */}
            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {nothingMatches && (
                <p className="py-6 text-center text-xs text-zinc-500">
                  No widgets match “{query.trim()}”{filterCategory !== 'all' ? ` in ${filterCategory}` : ''}.
                </p>
              )}
              {entries.map((e) => (e.kind === 'custom' ? renderCustom(e.cw) : renderBuiltIn(e.item)))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
