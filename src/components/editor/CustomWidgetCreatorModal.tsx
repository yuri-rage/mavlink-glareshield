import React, { useEffect, useMemo, useState } from 'react';

import { Download, Plus, Save } from 'lucide-react';

import { BUILTIN_PANELS } from '../../lib/builtinWidgets';
import { downloadFile } from '../../lib/download';
import { getObservedCatalog } from '../../lib/messageCache';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { cleanBinding, MAX_COMPOSITE_BINDINGS, MAX_PANELS, sanitizeParamSetEntries } from '../../lib/widgetValidation';
import {
  COMMAND_PRESET_GROUPS,
  COMMAND_PRESETS,
  findCommandPreset,
  irreversibleCommand,
  presetFitsWidget,
  presetKindFor,
  presetTitle,
  type PresetWidgetKind,
} from '../../mavlink/commandPresets';
import { getVehicleCategory } from '../../mavlink/messages';
import { expandParamPatterns } from '../../mavlink/paramMatch';
import { getParamMetadata } from '../../mavlink/paramMetadata';
import { useDashboardStore } from '../../store/dashboardStore';
import { useParamMetaStore } from '../../store/paramMetaStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import {
  CustomWidgetDefinition,
  MultiBarGroupType,
  PanelDisplayType,
  WidgetChartConfig,
  WidgetDataBinding,
  WidgetDisplayType,
  WidgetGaugeConfig,
  WidgetPanelDefinition,
} from '../../types/widget';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Modal } from '../ui/modal';
import { GLOBAL_FRAMES } from '../widgets/custom/panelModel';
import { WINDOW_CHOICES } from '../widgets/custom/TimeSeriesChart';
import { CustomWidgetRenderer } from '../widgets/CustomWidgetRenderer';
import { BindingEditor, NumberField, SELECT_CLASS } from './BindingEditor';
import { CompositePanelList, PANEL_TYPE_OPTIONS, panelValueCount, SPAN_OPTIONS } from './CompositePanelList';

interface CustomWidgetCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWidget?: CustomWidgetDefinition | null;
}

const COMMON_FIELDS: Record<string, string[]> = {
  // Not a MAVLink message: the link to the vehicle, measured here (% of its packets received over the last 5 s), with
  // a telemetry radio's signal when one reports it.
  LINK: ['quality', 'loss', 'received', 'lost', 'rssi', 'remrssi'],
  SYS_STATUS: ['voltage_battery', 'current_battery', 'battery_remaining', 'load', 'drop_rate_comm', 'errors_comm'],
  ATTITUDE: ['rollDeg', 'pitchDeg', 'yawDeg', 'roll', 'pitch', 'yaw', 'rollSpeed', 'pitchSpeed', 'yawSpeed'],
  VFR_HUD: ['groundspeed', 'airspeed', 'climb', 'throttle', 'alt', 'heading'],
  GLOBAL_POSITION_INT: ['relative_alt', 'alt', 'vx', 'vy', 'vz', 'hdg', 'lat', 'lon'],
  GPS_RAW_INT: ['satellites_visible', 'eph', 'epv', 'vel', 'cog', 'fixType'],
  BATTERY_STATUS: ['current_battery', 'current_consumed', 'battery_remaining', 'voltage'],
  SCALED_IMU: ['nz', 'xacc', 'yacc', 'zacc'],
  SCALED_PRESSURE: ['press_abs', 'press_diff', 'temperature'],
  POWER_STATUS: ['Vcc', 'Vservo', 'flags'],
  RC_CHANNELS: [
    'rssi',
    'chancount',
    'chan1_raw',
    'chan2_raw',
    'chan3_raw',
    'chan4_raw',
    'chan5_raw',
    'chan6_raw',
    'chan7_raw',
    'chan8_raw',
    'chan9_raw',
    'chan10_raw',
    'chan11_raw',
    'chan12_raw',
    'chan13_raw',
    'chan14_raw',
    'chan15_raw',
    'chan16_raw',
  ],
  'RC_CHANNELS (scaled)': [
    'chan1_scaled',
    'chan2_scaled',
    'chan3_scaled',
    'chan4_scaled',
    'chan5_scaled',
    'chan6_scaled',
    'chan7_scaled',
    'chan8_scaled',
    'chan9_scaled',
    'chan10_scaled',
    'chan11_scaled',
    'chan12_scaled',
    'chan13_scaled',
    'chan14_scaled',
    'chan15_scaled',
    'chan16_scaled',
  ],
  SERVO_OUTPUT_RAW: [
    'servo1_raw',
    'servo2_raw',
    'servo3_raw',
    'servo4_raw',
    'servo5_raw',
    'servo6_raw',
    'servo7_raw',
    'servo8_raw',
    'servo9_raw',
    'servo10_raw',
    'servo11_raw',
    'servo12_raw',
    'servo13_raw',
    'servo14_raw',
    'servo15_raw',
    'servo16_raw',
  ],
  'SERVO_OUTPUT_RAW (scaled)': [
    'servo1_scaled',
    'servo2_scaled',
    'servo3_scaled',
    'servo4_scaled',
    'servo5_scaled',
    'servo6_scaled',
    'servo7_scaled',
    'servo8_scaled',
    'servo9_scaled',
    'servo10_scaled',
    'servo11_scaled',
    'servo12_scaled',
    'servo13_scaled',
    'servo14_scaled',
    'servo15_scaled',
    'servo16_scaled',
  ],
  NAV_CONTROLLER_OUTPUT: [
    'wp_dist',
    'nav_bearing',
    'target_bearing',
    'alt_error',
    'aspd_error',
    'xtrack_error',
    'nav_roll',
    'nav_pitch',
  ],
  WIND: ['direction', 'speed', 'speed_z'],
  // PID_TUNING per controller axis (sent while GCS_PID_MASK selects it); other axes appear once received.
  PID_TUNING_ROLL: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_PITCH: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_YAW: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_ACCZ: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  PID_TUNING_STEER: ['desired', 'achieved', 'FF', 'P', 'I', 'D', 'SRate', 'PDmod'],
  VIBRATION: ['vibration_x', 'vibration_y', 'vibration_z', 'clipping_0', 'clipping_1', 'clipping_2'],
  RELAY_STATUS: ['on', 'present'],
  EKF_STATUS_REPORT: [
    'flags',
    'velocity_variance',
    'pos_horiz_variance',
    'pos_vert_variance',
    'compass_variance',
    'terrain_alt_variance',
    'airspeed_variance',
  ],
  RANGEFINDER: ['distance', 'voltage'],
  DISTANCE_SENSOR: ['current_distance', 'min_distance', 'max_distance', 'signal_quality'],
  RPM: ['rpm1', 'rpm2'],
  // Landed state (0 unknown, 1 on ground, 2 in air, 3 taking off, 4 landing) and VTOL state (3 hover, 4 forward).
  EXTENDED_SYS_STATE: ['landed_state', 'vtol_state'],
  ESC_TELEMETRY_5_TO_8: [
    'rpm5',
    'rpm6',
    'rpm7',
    'rpm8',
    'temp5',
    'temp6',
    'temp7',
    'temp8',
    'curr5',
    'curr6',
    'curr7',
    'curr8',
    'volt5',
    'volt6',
    'volt7',
    'volt8',
  ],
  ESC_TELEMETRY_9_TO_12: [
    'rpm9',
    'rpm10',
    'rpm11',
    'rpm12',
    'temp9',
    'temp10',
    'temp11',
    'temp12',
    'curr9',
    'curr10',
    'curr11',
    'curr12',
  ],
  // Gimbal attitude in degrees (from the quaternion); yaw is vehicle-relative unless flags has the earth-frame bit.
  GIMBAL_DEVICE_ATTITUDE_STATUS: ['roll', 'pitch', 'yaw', 'angular_velocity_z', 'flags', 'failure_flags'],
  MOUNT_STATUS: ['pitch', 'roll', 'yaw', 'mount_mode'],
  CAMERA_FEEDBACK: ['img_idx', 'completed_captures', 'lat', 'lng', 'alt_rel', 'yaw'],
  EFI_STATUS: [
    'rpm',
    'health',
    'engine_load',
    'throttle_position',
    'fuel_flow',
    'fuel_consumed',
    'cylinder_head_temperature',
    'exhaust_gas_temperature',
    'ignition_voltage',
    'fuel_pressure',
  ],
  GENERATOR_STATUS: [
    'generator_speed',
    'bus_voltage',
    'battery_current',
    'load_current',
    'power_generated',
    'runtime',
    'time_until_maintenance',
    'generator_temperature',
    'rectifier_temperature',
  ],
  ESC_TELEMETRY_1_TO_4: [
    'rpm1',
    'rpm2',
    'rpm3',
    'rpm4',
    'temp1',
    'temp2',
    'temp3',
    'temp4',
    'curr1',
    'curr2',
    'curr3',
    'curr4',
    'volt1',
    'volt2',
    'volt3',
    'volt4',
  ],
  HEARTBEAT: ['customMode', 'isArmed', 'systemStatus'],
};

const TELEMETRY_TYPES: WidgetDisplayType[] = [
  'stat-card',
  'gauge-linear',
  'gauge-radial',
  'indicator-led',
  'text-display',
  'compass-rose',
  'sparkline',
  'value-list',
];
/** How many values after the first each type uses. */
const EXTRA_VALUE_LIMIT: Partial<Record<WidgetDisplayType, number>> = {
  sparkline: 7,
  'value-list': 15,
  'gauge-radial': 1,
  'gauge-linear': 1,
  'compass-rose': 1,
};

const DEFAULT_BINDING: WidgetDataBinding = {
  messageName: 'SYS_STATUS',
  fieldName: 'voltage_battery',
  unit: 'V',
  multiplier: 1,
  decimals: 1,
  min: 0,
  max: 100,
};

/** Message-specific defaults when the user picks a message for a binding. */
function messageDefaults(msg: string): Partial<WidgetDataBinding> {
  if (msg === 'RC_CHANNELS (scaled)' || msg === 'SERVO_OUTPUT_RAW (scaled)')
    return { min: -1, max: 1, unit: '', decimals: 2 };
  if (msg === 'RC_CHANNELS' || msg === 'SERVO_OUTPUT_RAW') return { min: 1000, max: 2000, unit: 'µs', decimals: 0 };
  return {};
}

const Section: React.FC<{
  title: string;
  tone?: 'sky' | 'amber';
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, tone = 'sky', right, children }) => (
  <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
    <div className="flex items-center justify-between gap-2">
      <h4
        className={`text-xs font-bold uppercase tracking-wider ${tone === 'amber' ? 'text-amber-400' : 'text-sky-400'}`}
      >
        {title}
      </h4>
      {right}
    </div>
    {children}
  </div>
);

export const CustomWidgetCreatorModal: React.FC<CustomWidgetCreatorModalProps> = ({
  isOpen,
  onClose,
  initialWidget,
}) => {
  const { saveCustomWidget, addWidgetToActiveTab } = useDashboardStore();
  const isEditing = Boolean(initialWidget);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // The single widget's type, or (for a composite) the selected panel's.
  const [displayType, setDisplayType] = useState<PanelDisplayType>('stat-card');
  const [category, setCategory] = useState<'telemetry' | 'control' | 'avionics' | 'custom'>('telemetry');
  const [colorScheme, setColorScheme] = useState<'default' | 'green' | 'amber' | 'blue' | 'red'>('default');

  // Composite widgets: the panel list, and which panel the form below is editing. The selected panel's settings live
  // in the form state; the others in `panels` (see panelsWithCurrent).
  const [isComposite, setIsComposite] = useState(false);
  const [panels, setPanels] = useState<WidgetPanelDefinition[]>([]);
  const [selected, setSelected] = useState(0);
  const [panelTitle, setPanelTitle] = useState('');
  const [panelSpan, setPanelSpan] = useState(12);
  const [panelDescription, setPanelDescription] = useState('');
  const [panelColor, setPanelColor] = useState<WidgetPanelDefinition['colorScheme']>(undefined);
  const [builtinId, setBuiltinId] = useState('built-in-gps-card');
  const toSingleConfirm = useConfirmStep();

  // Telemetry bindings and display options
  const [binding, setBinding] = useState<WidgetDataBinding>(DEFAULT_BINDING);
  const [extraBindings, setExtraBindings] = useState<WidgetDataBinding[]>([]);
  const [gauge, setGauge] = useState<WidgetGaugeConfig>({});
  const [chart, setChart] = useState<WidgetChartConfig>({});
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [feedback, setFeedback] = useState<WidgetDataBinding>({
    messageName: 'SERVO_OUTPUT_RAW',
    fieldName: 'servo9_raw',
    decimals: 0,
  });
  const [stateThreshold, setStateThreshold] = useState<number | undefined>(undefined);
  // LED: its words when on / off, and whether off is an alert (a health flag).
  const [ledOnLabel, setLedOnLabel] = useState('');
  const [ledOffLabel, setLedOffLabel] = useState('');
  const [offAlert, setOffAlert] = useState<'' | 'warn' | 'crit'>('');
  const [staleAfterSec, setStaleAfterSec] = useState<number | undefined>(undefined);

  // Multi-bar config
  const [multiBarGroup, setMultiBarGroup] = useState<MultiBarGroupType>('rc-8');

  // Param control config (blank fields fall back to the parameter's metadata)
  const [paramId, setParamId] = useState('WPNAV_SPEED');
  const [paramUnit, setParamUnit] = useState('');
  const [paramMin, setParamMin] = useState('');
  const [paramMax, setParamMax] = useState('');
  const [paramStep, setParamStep] = useState('');
  const [paramOptionsText, setParamOptionsText] = useState('');
  const [paramConfirm, setParamConfirm] = useState(true);

  const heartbeatType = useTelemetryStore((s) => s.heartbeat.type);
  const firmwareVersion = useTelemetryStore((s) => s.firmwareVersion);
  const ensureParamMeta = useParamMetaStore((s) => s.ensure);
  useParamMetaStore((s) => s.catalog);
  useEffect(() => {
    if (!isOpen) return;
    ensureParamMeta(getVehicleCategory(heartbeatType), firmwareVersion);
  }, [isOpen, heartbeatType, firmwareVersion, ensureParamMeta]);
  const paramMeta = getParamMetadata(paramId.trim().toUpperCase() || 'WPNAV_SPEED');

  // Parameter set config: one entry per line (or comma separated)
  const [paramSetText, setParamSetText] = useState('');
  const [paramSetConfirm, setParamSetConfirm] = useState(true);
  const downloadedParamNames = useTelemetryStore((s) => s.parameters);
  const paramSetEntries = useMemo(() => sanitizeParamSetEntries(paramSetText.split(/[\s,]+/)), [paramSetText]);
  const paramSetPreview = useMemo(
    () => expandParamPatterns(paramSetEntries, Object.keys(downloadedParamNames)),
    [paramSetEntries, downloadedParamNames]
  );

  // Action Binding
  const [actionLabel, setActionLabel] = useState('Trigger Command');
  const [commandId, setCommandId] = useState('20'); // MAV_CMD_NAV_RETURN_TO_LAUNCH
  const [cmdParams, setCmdParams] = useState<string[]>(['0', '0', '0', '0', '0', '0', '0']);
  const param1 = cmdParams[0];
  const setCmdParam = (i: number, v: string) => setCmdParams((prev) => prev.map((x, j) => (j === i ? v : x)));
  // "Custom" stays selected while the user types an ID, even one that happens to match a preset.
  const [customCommand, setCustomCommand] = useState(false);
  // COMMAND_LONG or COMMAND_INT (in `cmdFrame`), and the one non-command action (set the vehicle's clock).
  const [sendAs, setSendAs] = useState<'long' | 'int'>('long');
  const [cmdFrame, setCmdFrame] = useState(3);
  const [specialAction, setSpecialAction] = useState<'system-time' | undefined>(undefined);
  const [showMoreParams, setShowMoreParams] = useState(false);
  // Toggles and sliders overwrite a param with their own value, so they are offered only the presets where that
  // value is what the command expects (see CommandPreset.toggle / slider).
  const presetKind: PresetWidgetKind = presetKindFor(displayType);
  const offeredPresets = COMMAND_PRESETS.filter((c) => presetFitsWidget(c, presetKind));
  // An irreversible command (terminate, parachute release, reboot, format) always confirms: the box can't be unticked.
  const irreversible = specialAction
    ? null
    : irreversibleCommand(
        parseInt(commandId, 10) || 0,
        presetKind === 'button' ? cmdParams.map((v) => parseFloat(v) || 0) : null
      );
  const selectedPreset = customCommand
    ? undefined
    : findCommandPreset(
        parseInt(commandId, 10) || 0,
        cmdParams.map((v) => parseFloat(v) || 0),
        presetKind,
        specialAction
      );
  const applyPreset = (key: string) => {
    const preset = COMMAND_PRESETS.find((c) => c.key === key);
    if (!preset) {
      setCustomCommand(true);
      setSpecialAction(undefined);
      return;
    }
    setCustomCommand(false);
    setSpecialAction(preset.special);
    setSendAs('long');
    setCommandId(String(preset.commandId));
    setCmdParams(preset.params.map(String));
    setShowMoreParams(preset.params.slice(3).some((v) => v !== 0));
    // Follow the preset's label unless the user has written their own.
    const trimmed = actionLabel.trim();
    if (!trimmed || trimmed === 'Trigger Command' || COMMAND_PRESETS.some((c) => c.label === trimmed)) {
      setActionLabel(preset.label);
    }
  };
  const [requireConfirm, setRequireConfirm] = useState(true);

  /**
   * The user picked another widget type. Switching to a toggle or slider whose command doesn't fit it (a new
   * widget's default RTL, say) starts it on the first preset that does: set relay, or change speed. A command the
   * user chose as Custom is never replaced, and loading a saved widget never comes through here.
   */
  const changeDisplayType = (next: PanelDisplayType) => {
    setDisplayType(next);
    if (next === 'compass-rose' && binding.messageName === 'SYS_STATUS') {
      setBinding({ ...binding, messageName: 'WIND', fieldName: 'direction', unit: '°', min: 0, max: 360 });
    }
    const kind = presetKindFor(next);
    if (kind === 'button' || customCommand) return;
    if (
      findCommandPreset(
        parseInt(commandId, 10) || 0,
        cmdParams.map((v) => parseFloat(v) || 0),
        kind,
        specialAction
      )
    )
      return;
    const first = COMMAND_PRESETS.find((c) => presetFitsWidget(c, kind));
    if (first) applyPreset(first.key);
  };

  // Field picker: the curated list plus every field the vehicle has actually sent (refreshed on open).
  const [observedCatalog, setObservedCatalog] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (!isOpen) return;
    setObservedCatalog(getObservedCatalog());
    const timer = setInterval(() => setObservedCatalog(getObservedCatalog()), 3000);
    return () => clearInterval(timer);
  }, [isOpen]);
  const catalog = useMemo(() => {
    const merged: Record<string, string[]> = {};
    for (const [m, fields] of Object.entries(COMMON_FIELDS)) merged[m] = [...fields];
    for (const [m, fields] of Object.entries(observedCatalog)) {
      merged[m] = [...new Set([...(merged[m] ?? []), ...fields])];
    }
    return merged;
  }, [observedCatalog]);
  const observed = useMemo(() => new Set(Object.keys(observedCatalog)), [observedCatalog]);

  /** Load a widget's (or panel's) display settings into the form. */
  const loadSettings = (w?: Partial<CustomWidgetDefinition>) => {
    setDisplayType(w?.displayType && w.displayType !== 'composite' ? w.displayType : 'stat-card');
    setBinding(w?.binding ? { ...w.binding } : { ...DEFAULT_BINDING });
    setExtraBindings((w?.bindings ?? []).map((b) => ({ ...b })));
    setGauge({ ...(w?.gauge ?? {}) });
    setChart({ ...(w?.chart ?? {}) });
    setFeedbackEnabled(Boolean(w?.feedback));
    setFeedback(
      w?.feedback ? { ...w.feedback } : { messageName: 'SERVO_OUTPUT_RAW', fieldName: 'servo9_raw', decimals: 0 }
    );
    setStateThreshold(w?.stateThreshold);
    setLedOnLabel(w?.stateLabels?.on ?? '');
    setLedOffLabel(w?.stateLabels?.off ?? '');
    setOffAlert(w?.offAlert ?? '');
    setStaleAfterSec(w?.staleAfterSec);

    setMultiBarGroup(w?.multiBarConfig?.group ?? 'rc-8');

    setParamSetText((w?.paramSet?.params ?? []).join('\n'));
    // As single-parameter controls: confirm unless the widget says not to.
    setParamSetConfirm(w?.paramSet?.confirmation !== false);

    const pc = w?.paramControl;
    setParamId(pc?.paramId || 'WPNAV_SPEED');
    setParamUnit(pc?.unit ?? '');
    setParamMin(pc?.min !== undefined ? String(pc.min) : '');
    setParamMax(pc?.max !== undefined ? String(pc.max) : '');
    setParamStep(pc?.step !== undefined ? String(pc.step) : '');
    setParamConfirm(pc?.confirmation ?? true);
    setParamOptionsText(pc?.options ? pc.options.map((o) => `${o.label}:${o.value}`).join(', ') : '');

    const a = w?.action;
    setActionLabel(a?.label || 'Trigger Command');
    setCommandId(String(a?.commandId || 20));
    const loaded = Array.from({ length: 7 }, (_, i) => String(a?.params?.[i] ?? 0));
    setCmdParams(loaded);
    // Judged for the widget's own type: a saved toggle whose command isn't a toggle preset is the user's Custom
    // choice, kept as is.
    setSpecialAction(a?.special);
    setSendAs(a?.send === 'int' ? 'int' : 'long');
    setCmdFrame(a?.frame ?? 3);
    setCustomCommand(
      !findCommandPreset(a?.commandId || 20, a?.params ?? [], presetKindFor(w?.displayType), a?.special)
    );
    setShowMoreParams(loaded.slice(3).some((v) => Number(v) !== 0));
    setRequireConfirm(a?.confirmation ?? true);
  };

  /** Load a composite panel into the form. */
  const loadPanel = (p: WidgetPanelDefinition) => {
    loadSettings(p);
    setPanelTitle(p.title ?? '');
    setPanelSpan(p.span ?? 12);
    setPanelDescription(p.description ?? '');
    setPanelColor(p.colorScheme);
    setBuiltinId(p.widgetId ?? 'built-in-gps-card');
  };

  useEffect(() => {
    if (!isOpen) return;
    const w = initialWidget;
    setName(w?.name || '');
    setDescription(w?.description || '');
    setCategory(w?.category || 'telemetry');
    setColorScheme(w?.colorScheme || 'default');
    toSingleConfirm.cancel();
    if (w?.displayType === 'composite') {
      const list = (w.panels ?? []).length
        ? (w.panels ?? []).map((p) => ({ ...p }))
        : [{ displayType: 'stat-card' as const }];
      setIsComposite(true);
      setPanels(list);
      setSelected(0);
      loadPanel(list[0]);
    } else {
      setIsComposite(false);
      setPanels([]);
      setSelected(0);
      loadSettings(w ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialWidget]);

  const isActionWidget =
    displayType === 'action-button' || displayType === 'toggle-switch' || displayType === 'slider-control';
  const isTelemetryWidget = TELEMETRY_TYPES.includes(displayType);
  const isGauge = displayType === 'gauge-radial' || displayType === 'gauge-linear';
  const multiGauge = isGauge && gauge.layout === 'multiple';
  // One gauge per value: up to 6 dials or 8 bars in one card.
  const extraLimit = multiGauge ? (displayType === 'gauge-radial' ? 5 : 7) : (EXTRA_VALUE_LIMIT[displayType] ?? 0);
  const extrasUsed = extraBindings.slice(0, extraLimit);
  const usesRange = displayType !== 'value-list' && displayType !== 'stat-card' && displayType !== 'text-display';

  /** The form's settings as a single widget (for a composite, the selected panel's settings). */
  const buildSingle = (): CustomWidgetDefinition => {
    const id = initialWidget?.id || `custom-${Date.now()}`;
    const def: CustomWidgetDefinition = {
      id,
      name: name.trim() || 'Custom Instrument',
      description: description.trim(),
      category: isActionWidget || displayType === 'param-control' || displayType === 'param-set' ? 'control' : category,
      displayType,
      colorScheme,
    };

    if (isTelemetryWidget) {
      def.binding = cleanBinding({ ...binding, multiplier: binding.multiplier ?? 1 });
      // Keep each extra value's own min / max: the multi-gauge layout scales every gauge separately.
      if (extrasUsed.length) def.bindings = extrasUsed.map((b) => cleanBinding(b));
      if (staleAfterSec !== undefined) def.staleAfterSec = staleAfterSec;
    }
    if (displayType === 'slider-control') {
      def.binding = cleanBinding({
        messageName: binding.messageName,
        fieldName: binding.fieldName,
        unit: binding.unit,
        min: binding.min ?? 0,
        max: binding.max ?? 100,
      });
    }
    if (displayType === 'gauge-radial') def.gauge = { ...gauge };
    if (displayType === 'gauge-linear')
      def.gauge = { layout: gauge.layout, majorTicks: gauge.majorTicks, showZones: gauge.showZones };
    if (displayType === 'sparkline') def.chart = { ...chart };
    if (displayType === 'indicator-led') {
      if (stateThreshold !== undefined) def.stateThreshold = stateThreshold;
      const on = ledOnLabel.trim();
      const off = ledOffLabel.trim();
      if (on || off) def.stateLabels = { ...(on ? { on } : {}), ...(off ? { off } : {}) };
      if (offAlert) def.offAlert = offAlert;
    }
    if (displayType === 'toggle-switch' && feedbackEnabled) {
      def.feedback = cleanBinding(feedback);
      if (stateThreshold !== undefined) def.stateThreshold = stateThreshold;
      if (staleAfterSec !== undefined) def.staleAfterSec = staleAfterSec;
    }

    if (displayType === 'multi-bar') {
      def.multiBarConfig = {
        group: multiBarGroup,
      };
    }

    if (displayType === 'param-set') {
      def.paramSet = { params: paramSetEntries, confirmation: paramSetConfirm };
    }

    if (displayType === 'param-control') {
      const parsedOptions = paramOptionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const [lbl, valStr] = pair.split(':').map((x) => x.trim());
          const val = parseFloat(valStr);
          return lbl && !isNaN(val) ? { label: lbl, value: val } : null;
        })
        .filter((x): x is { label: string; value: number } => x !== null);

      const minVal = paramMin.trim() !== '' ? parseFloat(paramMin) : NaN;
      const maxVal = paramMax.trim() !== '' ? parseFloat(paramMax) : NaN;
      const stepVal = paramStep.trim() !== '' ? parseFloat(paramStep) : NaN;
      def.paramControl = {
        paramId: paramId.trim().toUpperCase() || 'WPNAV_SPEED',
        unit: paramUnit.trim() || undefined,
        min: Number.isFinite(minVal) ? minVal : undefined,
        max: Number.isFinite(maxVal) ? maxVal : undefined,
        step: Number.isFinite(stepVal) ? stepVal : undefined,
        options: parsedOptions.length > 0 ? parsedOptions : undefined,
        confirmation: paramConfirm,
      };
    }

    if (isActionWidget) {
      def.action = {
        label: actionLabel,
        commandId: parseInt(commandId, 10) || 0,
        params: cmdParams.map((v) => parseFloat(v) || 0) as [number, number, number, number, number, number, number],
        confirmation: requireConfirm || irreversible !== null,
        ...(specialAction
          ? { special: specialAction }
          : sendAs === 'int'
            ? { send: 'int' as const, frame: cmdFrame }
            : {}),
      };
    }

    return def;
  };

  /** The selected panel as the form currently has it. */
  const currentPanel = (): WidgetPanelDefinition => {
    if (displayType === 'builtin') {
      // A built-in widget has no settings of its own: just which one, its title and width.
      const panel: WidgetPanelDefinition = { displayType, widgetId: builtinId };
      if (panelTitle.trim()) panel.title = panelTitle.trim();
      if (panelSpan !== 12) panel.span = panelSpan;
      return panel;
    }
    const {
      id: _id,
      name: _name,
      category: _category,
      description: _description,
      colorScheme: _color,
      ...settings
    } = buildSingle();
    const panel: WidgetPanelDefinition = { ...(settings as Omit<WidgetPanelDefinition, 'displayType'>), displayType };
    if (panelTitle.trim()) panel.title = panelTitle.trim();
    if (panelSpan !== 12) panel.span = panelSpan;
    if (panelDescription.trim()) panel.description = panelDescription.trim();
    if (panelColor) panel.colorScheme = panelColor;
    return panel;
  };
  const panelsWithCurrent = (): WidgetPanelDefinition[] => panels.map((p, i) => (i === selected ? currentPanel() : p));

  const buildDefinition = (): CustomWidgetDefinition => {
    if (!isComposite) return buildSingle();
    const list = panelsWithCurrent();
    const hasControl = list.some((p) =>
      ['action-button', 'toggle-switch', 'slider-control', 'param-control', 'param-set'].includes(p.displayType)
    );
    return {
      id: initialWidget?.id || `custom-${Date.now()}`,
      name: name.trim() || 'Custom Instrument',
      description: description.trim(),
      category: hasControl ? 'control' : category,
      displayType: 'composite',
      colorScheme,
      panels: list,
    };
  };

  // --- Composite panel list -------------------------------------------------------------------------------------
  const selectPanel = (i: number) => {
    if (i === selected) return;
    const list = panelsWithCurrent();
    setPanels(list);
    setSelected(i);
    loadPanel(list[i]);
  };
  const addPanel = () => {
    const list = panelsWithCurrent();
    if (list.length >= MAX_PANELS) return;
    const next: WidgetPanelDefinition = { displayType: 'stat-card', span: 6, binding: { ...DEFAULT_BINDING } };
    setPanels([...list, next]);
    setSelected(list.length);
    loadPanel(next);
  };
  const movePanel = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    const list = panelsWithCurrent();
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPanels(list);
    // The form keeps editing the same panel wherever it moves.
    if (selected === i) setSelected(j);
    else if (selected === j) setSelected(i);
  };
  const removePanel = (i: number) => {
    const list = panelsWithCurrent();
    if (list.length <= 1) return;
    list.splice(i, 1);
    const nextSel = i < selected ? selected - 1 : Math.min(selected, list.length - 1);
    setPanels(list);
    setSelected(nextSel);
    if (i === selected) loadPanel(list[nextSel]);
  };
  const setSpanOf = (i: number, span: number) => {
    if (i === selected) setPanelSpan(span);
    else
      setPanels((list) =>
        list.map((p, j) => {
          if (j !== i) return p;
          const { span: _old, ...rest } = p;
          return span === 12 ? rest : { ...rest, span }; // a full row is the default, so it isn't stored
        })
      );
  };
  /** Turn the current single widget into the first panel of a composite. */
  const makeComposite = () => {
    const first = { ...currentPanel(), span: 12 };
    // The widget's description and colour stay with the card.
    delete first.description;
    delete first.colorScheme;
    setPanels([first]);
    setSelected(0);
    setPanelTitle('');
    setPanelSpan(12);
    setPanelDescription('');
    setPanelColor(undefined);
    setIsComposite(true);
  };
  /** Back to a single widget: the selected panel becomes the widget. */
  const makeSingle = () => {
    if (panels.length > 1 && !toSingleConfirm.armed) {
      toSingleConfirm.arm();
      return;
    }
    toSingleConfirm.cancel();
    if (!description.trim() && panelDescription.trim()) setDescription(panelDescription.trim());
    setPanels([]);
    setSelected(0);
    setIsComposite(false);
  };

  const compositeValues = isComposite ? panelsWithCurrent().reduce((n, p) => n + panelValueCount(p), 0) : 0;
  const overValueLimit = compositeValues > MAX_COMPOSITE_BINDINGS;

  const previewJson = JSON.stringify({ ...buildDefinition(), id: `${initialWidget?.id ?? 'new'}-preview` });
  // Keep the preview's definition stable between renders that don't change it (its chart restarts otherwise).
  const previewDefinition = useMemo(() => JSON.parse(previewJson) as CustomWidgetDefinition, [previewJson]);

  const handleSaveAndPlace = (e: React.FormEvent) => {
    e.preventDefault();
    if (overValueLimit) return;
    const def = buildDefinition();
    saveCustomWidget(def);
    if (!isEditing) {
      addWidgetToActiveTab(def.id, def.displayType === 'composite' ? 12 : 6);
    }
    onClose();
  };

  const handleDownloadWidgetJson = () => {
    const def = buildDefinition();
    downloadFile(
      `${def.name.toLowerCase().replace(/\s+/g, '-')}.widget.json`,
      JSON.stringify(def, null, 2),
      'application/json'
    );
  };

  const addExtra = () => {
    const last = extraBindings[extraBindings.length - 1] ?? binding;
    setExtraBindings((list) => [
      ...list.slice(0, extraLimit),
      {
        messageName: last.messageName,
        fieldName: last.fieldName,
        unit: last.unit,
        unitKind: last.unitKind,
        multiplier: last.multiplier,
        decimals: last.decimals,
      },
    ]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title={isEditing ? `Edit Custom Widget: ${initialWidget?.name}` : 'Create Custom Declarative Widget'}
      description="Define a reusable, safe JSON widget bound to MAVLink telemetry fields, a parameter, or a flight command. The preview is live."
    >
      <form
        onSubmit={handleSaveAndPlace}
        className={`grid grid-cols-1 items-start gap-4 ${isComposite ? 'lg:grid-cols-[minmax(0,1fr)_440px]' : 'lg:grid-cols-[minmax(0,1fr)_320px]'}`}
      >
        <div className="min-w-0 space-y-4">
          {/* Name & Display Type */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Widget Name</label>
              <Input
                type="text"
                required
                placeholder="e.g. Bus Voltmeter, RC Monitor, WP Speed"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Display UI Type</label>
              <select
                value={isComposite ? 'composite' : displayType}
                onChange={(e) => {
                  const next = e.target.value as WidgetDisplayType;
                  if (next === 'composite') {
                    if (!isComposite) makeComposite();
                    return;
                  }
                  if (isComposite) {
                    makeSingle();
                    return;
                  }
                  changeDisplayType(next);
                }}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
              >
                {!isComposite &&
                  PANEL_TYPE_OPTIONS.filter((o) => o.value !== 'builtin').map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                {isComposite && (
                  <option value="single" disabled={displayType === 'builtin'}>
                    {displayType === 'builtin'
                      ? 'Single widget (select a panel that is not built-in)'
                      : 'Single widget (keep the selected panel)'}
                  </option>
                )}
                <option value="composite">Composite (several panels in one card)</option>
              </select>
              {toSingleConfirm.armed && (
                <div className="flex items-center gap-2 text-[11px] text-amber-300">
                  <span>
                    Keep only panel {selected + 1} and drop the other {panels.length - 1}?
                  </span>
                  <button type="button" className="font-bold underline" onClick={makeSingle}>
                    Yes
                  </button>
                  <button type="button" className="text-zinc-400 underline" onClick={toSingleConfirm.cancel}>
                    No
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-2">
              <label className="text-xs font-semibold text-zinc-300">Description (Optional)</label>
              <Input
                type="text"
                placeholder="Brief explanation of this widget"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-zinc-300">Accent Color</label>
              <select
                value={colorScheme}
                onChange={(e) => setColorScheme(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
              >
                <option value="default">Sky Blue (Default)</option>
                <option value="blue">Aviation Cyan-Blue</option>
                <option value="green">Emerald Green</option>
                <option value="amber">Amber Warning</option>
                <option value="red">Crimson Red</option>
              </select>
            </div>
          </div>

          {isComposite && (
            <>
              <CompositePanelList
                panels={panelsWithCurrent()}
                selected={selected}
                onSelect={selectPanel}
                onAdd={addPanel}
                onMove={movePanel}
                onRemove={removePanel}
                onSpan={setSpanOf}
              />
              <Section title={`Panel ${selected + 1}`}>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Panel Type</label>
                    <select
                      value={displayType}
                      onChange={(e) => {
                        const next = e.target.value as PanelDisplayType;
                        changeDisplayType(next);
                      }}
                      className={SELECT_CLASS}
                      aria-label="Panel type"
                    >
                      {PANEL_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Panel Title (Optional)</label>
                    <Input
                      type="text"
                      maxLength={40}
                      placeholder="Heading above the panel"
                      value={panelTitle}
                      onChange={(e) => setPanelTitle(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Width</label>
                    <select
                      value={panelSpan}
                      onChange={(e) => setPanelSpan(Number(e.target.value))}
                      className={SELECT_CLASS}
                    >
                      {SPAN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {displayType === 'builtin' ? (
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-400">Built-in Widget</label>
                      <select
                        value={builtinId}
                        onChange={(e) => setBuiltinId(e.target.value)}
                        className={SELECT_CLASS}
                        aria-label="Built-in widget"
                      >
                        {Object.entries(BUILTIN_PANELS).map(([id, info]) => (
                          <option key={id} value={id}>
                            {info.name}
                            {info.large ? ' (large: best full width)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-400">Accent Color</label>
                      <select
                        value={panelColor ?? ''}
                        onChange={(e) =>
                          setPanelColor((e.target.value || undefined) as WidgetPanelDefinition['colorScheme'])
                        }
                        className={SELECT_CLASS}
                      >
                        <option value="">Same as the card</option>
                        <option value="default">Sky Blue</option>
                        <option value="blue">Aviation Cyan-Blue</option>
                        <option value="green">Emerald Green</option>
                        <option value="amber">Amber Warning</option>
                        <option value="red">Crimson Red</option>
                      </select>
                    </div>
                  )}
                  {(displayType === 'stat-card' ||
                    displayType === 'text-display' ||
                    displayType === 'compass-rose') && (
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[11px] font-medium text-zinc-400">
                        {displayType === 'text-display' ? 'Readout Label' : 'Caption (Optional)'}
                      </label>
                      <Input
                        type="text"
                        placeholder={displayType === 'text-display' ? 'e.g. HDOP' : 'Shown under the value'}
                        value={panelDescription}
                        onChange={(e) => setPanelDescription(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500">
                  {displayType === 'builtin'
                    ? `The ${BUILTIN_PANELS[builtinId]?.name ?? 'built-in'} widget shows its own title and works as it does on the dashboard.${
                        BUILTIN_PANELS[builtinId]?.controls
                          ? ` It can send ${BUILTIN_PANELS[builtinId]?.controls}.`
                          : ''
                      }`
                    : 'The settings below are for this panel.'}
                </p>
              </Section>
            </>
          )}

          {/* Multi-Bar Channel Group Configuration */}
          {displayType === 'multi-bar' && (
            <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">Multi-Channel Bar / PWM Group</h4>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Telemetry Channel Group</label>
                <select
                  value={multiBarGroup}
                  onChange={(e) => setMultiBarGroup(e.target.value as MultiBarGroupType)}
                  className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 font-mono text-xs text-zinc-200"
                >
                  <option value="rc-8">RC_CHANNELS: Radio Input Channels 1–8 (1000–2000 µs)</option>
                  <option value="rc-8-scaled">RC_CHANNELS (scaled): Radio Input Channels 1–8 (-1.0 to 1.0)</option>
                  <option value="servo-8">SERVO_OUTPUT_RAW: Motor / Servo Outputs 1–8 (1000–2000 µs)</option>
                  <option value="servo-8-scaled">
                    SERVO_OUTPUT_RAW (scaled): Motor / Servo Outputs 1–8 (-1.0 to 1.0)
                  </option>
                  <option value="esc-rpm">ESC_TELEMETRY_1_TO_4: ESC 1–4 Motor Speed (RPM)</option>
                  <option value="esc-temp">ESC_TELEMETRY_1_TO_4: ESC 1–4 Temperature (°C)</option>
                  <option value="esc-current">ESC_TELEMETRY_1_TO_4: ESC 1–4 Current Draw (A)</option>
                  <option value="vibration-xyz">VIBRATION: 3-Axis IMU Vibration X / Y / Z (m/s²)</option>
                  <option value="ekf-variances">EKF_STATUS_REPORT: EKF Variances (Vel / PosH / PosV / Mag)</option>
                  <option value="battery-cells">BATTERY_STATUS: Individual LiPo Cell Voltages (V)</option>
                </select>
              </div>
            </div>
          )}

          {/* Parameter Set Configuration */}
          {displayType === 'param-set' && (
            <div className="space-y-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">Parameters to list</h4>
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={paramSetConfirm}
                    onChange={(e) => setParamSetConfirm(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                  />
                  Confirm every write
                </label>
              </div>
              <textarea
                value={paramSetText}
                onChange={(e) => setParamSetText(e.target.value.toUpperCase())}
                rows={5}
                spellCheck={false}
                placeholder={'BATT_CAPACITY\nBATT_*\n-BATT2_*\nFS_*'}
                aria-label="Parameters to list"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 font-mono text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
              />
              <p className="text-[10px] leading-snug text-zinc-500">
                One per line (or separated by commas or spaces). An exact name keeps its place;{' '}
                <code className="text-sky-300">*</code> and <code className="text-sky-300">?</code> add every matching
                parameter alphabetically; a leading <code className="text-sky-300">-</code> leaves matches out. Up to 64
                entries. Out-of-range values always ask before writing.
              </p>
              <div className="font-mono text-[10px] text-zinc-400">
                {Object.keys(downloadedParamNames).length === 0 ? (
                  <span className="text-zinc-500">
                    Download the vehicle's parameters to preview what the patterns match.
                  </span>
                ) : (
                  <>
                    <span className="text-zinc-300">{paramSetPreview.filter((r) => r.present).length} parameters</span>
                    {paramSetPreview.some((r) => !r.present) && (
                      <span className="text-amber-400">
                        {' '}
                        · not on this vehicle:{' '}
                        {paramSetPreview
                          .filter((r) => !r.present)
                          .map((r) => r.name)
                          .join(', ')}
                      </span>
                    )}
                    {paramSetPreview.length > 0 && (
                      <div className="truncate text-zinc-500" title={paramSetPreview.map((r) => r.name).join(', ')}>
                        {paramSetPreview
                          .slice(0, 12)
                          .map((r) => r.name)
                          .join(', ')}
                        {paramSetPreview.length > 12 ? ` +${paramSetPreview.length - 12}` : ''}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Parameter Control Configuration */}
          {displayType === 'param-control' && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">
                  ArduPilot Parameter Binding (PARAM_SET)
                </h4>
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={paramConfirm}
                    onChange={(e) => setParamConfirm(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                  />
                  Require Confirmation
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Parameter ID (up to 16 chars)</label>
                  <Input
                    type="text"
                    maxLength={16}
                    placeholder="e.g. WPNAV_SPEED, RTL_ALT"
                    value={paramId}
                    onChange={(e) => setParamId(e.target.value.toUpperCase())}
                    className="h-8 font-mono text-xs uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Common Parameter Presets</label>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const [pid, punit, pmin, pmax, pstep] = e.target.value.split('|');
                      setParamId(pid);
                      setParamUnit(punit);
                      setParamMin(pmin);
                      setParamMax(pmax);
                      setParamStep(pstep);
                    }}
                    className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 font-mono text-xs text-zinc-300"
                  >
                    <option value="">— Quick-fill common param —</option>
                    <option value="WPNAV_SPEED|cm/s|50|2000|50">WPNAV_SPEED (Waypoint Speed cm/s)</option>
                    <option value="RTL_ALT|cm|0|30000|100">RTL_ALT (Return Altitude cm)</option>
                    <option value="PILOT_SPEED_UP|cm/s|50|500|10">PILOT_SPEED_UP (Max Climb Rate cm/s)</option>
                    <option value="BATT_CAPACITY|mAh|500|50000|100">BATT_CAPACITY (Battery Capacity mAh)</option>
                    <option value="MOT_SPIN_ARM|ratio|0|0.3|0.01">MOT_SPIN_ARM (Motor Spin Armed)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Unit</label>
                  <Input
                    type="text"
                    placeholder={paramMeta?.units || 'auto'}
                    value={paramUnit}
                    onChange={(e) => setParamUnit(e.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Min</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={paramMeta?.min !== undefined ? String(paramMeta.min) : 'auto'}
                    value={paramMin}
                    onChange={(e) => setParamMin(e.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Max</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={paramMeta?.max !== undefined ? String(paramMeta.max) : 'auto'}
                    value={paramMax}
                    onChange={(e) => setParamMax(e.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Step</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={paramMeta?.increment !== undefined ? String(paramMeta.increment) : '1'}
                    value={paramStep}
                    onChange={(e) => setParamStep(e.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">
                  Dropdown Options (Optional, format:{' '}
                  <code className="text-sky-400">Slow:300, Cruise:500, Fast:1000</code>)
                </label>
                <Input
                  type="text"
                  placeholder="Leave blank for numeric input, or enter Label:Value pairs"
                  value={paramOptionsText}
                  onChange={(e) => setParamOptionsText(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
          )}

          {/* Telemetry binding (primary value) */}
          {isTelemetryWidget && (
            <Section
              title={
                multiGauge
                  ? 'Gauge 1'
                  : displayType === 'value-list' || displayType === 'sparkline'
                    ? 'Value 1'
                    : 'Telemetry Data Binding'
              }
            >
              <BindingEditor
                value={binding}
                onChange={setBinding}
                catalog={catalog}
                observed={observed}
                showRange={usesRange}
                showThresholds={displayType !== 'compass-rose'}
                showLabel={displayType === 'value-list' || displayType === 'sparkline' || multiGauge}
                showColor={displayType === 'sparkline'}
                onMessagePicked={(msg) => setBinding((b) => ({ ...b, ...messageDefaults(msg) }))}
              />
              {displayType === 'sparkline' && (
                <p className="text-[10px] text-zinc-500">
                  Min and max are only used when the chart scale is set to Fixed.
                </p>
              )}
            </Section>
          )}

          {/* Slider range */}
          {displayType === 'slider-control' && (
            <Section title="Slider Range & Unit">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Unit Label</label>
                  <Input
                    type="text"
                    placeholder="µs, m/s"
                    value={binding.unit ?? ''}
                    onChange={(e) => setBinding({ ...binding, unit: e.target.value })}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <NumberField
                  label="Min Value"
                  value={binding.min}
                  onChange={(v) => setBinding({ ...binding, min: v })}
                />
                <NumberField
                  label="Max Value"
                  value={binding.max}
                  onChange={(v) => setBinding({ ...binding, max: v })}
                />
              </div>
            </Section>
          )}

          {/* Radial / linear gauge options */}
          {(displayType === 'gauge-radial' || displayType === 'gauge-linear') && (
            <Section title="Scale">
              <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                <div className="col-span-2 space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Layout</label>
                  <select
                    value={gauge.layout ?? 'marker'}
                    onChange={(e) => setGauge({ ...gauge, layout: e.target.value as WidgetGaugeConfig['layout'] })}
                    className={SELECT_CLASS}
                  >
                    <option value="marker">One gauge (optional target marker)</option>
                    <option value="multiple">One gauge per value</option>
                  </select>
                </div>
                {displayType === 'gauge-radial' && (
                  <>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-400">Sweep</label>
                      <select
                        value={gauge.sweep ?? 240}
                        onChange={(e) => setGauge({ ...gauge, sweep: Number(e.target.value) as 180 | 240 | 270 })}
                        className={SELECT_CLASS}
                      >
                        <option value={180}>180° (half dial)</option>
                        <option value={240}>240°</option>
                        <option value={270}>270°</option>
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-400">Indicator</label>
                      <select
                        value={gauge.style ?? 'both'}
                        onChange={(e) => setGauge({ ...gauge, style: e.target.value as WidgetGaugeConfig['style'] })}
                        className={SELECT_CLASS}
                      >
                        <option value="both">Arc + needle</option>
                        <option value="needle">Needle</option>
                        <option value="arc">Arc</option>
                      </select>
                    </div>
                  </>
                )}
                <NumberField
                  label="Major ticks (approx.)"
                  value={gauge.majorTicks}
                  placeholder="5"
                  step="1"
                  min={2}
                  max={12}
                  onChange={(v) => setGauge({ ...gauge, majorTicks: v })}
                />
                {displayType === 'gauge-radial' && (
                  <NumberField
                    label="Minor per major"
                    value={gauge.minorTicks}
                    placeholder="4"
                    step="1"
                    min={0}
                    max={9}
                    onChange={(v) => setGauge({ ...gauge, minorTicks: v })}
                  />
                )}
                <label className="flex h-8 cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={gauge.showZones ?? true}
                    onChange={(e) => setGauge({ ...gauge, showZones: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-900 accent-sky-500"
                  />
                  Threshold zones
                </label>
              </div>
            </Section>
          )}

          {/* Additional values */}
          {isTelemetryWidget && extraLimit > 0 && (
            <Section
              title={multiGauge ? 'More Gauges' : extraLimit === 1 ? 'Secondary Marker (Optional)' : 'More Values'}
              right={
                extrasUsed.length < extraLimit && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 border-zinc-700 text-[11px]"
                    onClick={addExtra}
                  >
                    <Plus className="h-3 w-3" />
                    {multiGauge ? 'Add gauge' : extraLimit === 1 ? 'Add marker' : 'Add value'}
                  </Button>
                )
              }
            >
              <p className="-mt-1 text-[10px] text-zinc-500">
                {displayType === 'sparkline'
                  ? 'Each value is plotted as its own series on the same chart.'
                  : displayType === 'value-list'
                    ? 'Each value gets its own labelled row.'
                    : multiGauge
                      ? "Each value gets its own gauge with its own range, thresholds, multiplier and offset. A blank min or max uses the first gauge's."
                      : 'Drawn as a magenta marker on the same scale, e.g. a target against the actual value.'}
              </p>
              {extrasUsed.map((b, i) => (
                <div key={i} className="border-t border-zinc-800/80 pt-2 first:border-t-0 first:pt-0">
                  <BindingEditor
                    title={multiGauge ? `Gauge ${i + 2}` : extraLimit === 1 ? 'Marker value' : `Value ${i + 2}`}
                    value={b}
                    onChange={(next) => setExtraBindings((list) => list.map((x, j) => (j === i ? next : x)))}
                    onRemove={() => setExtraBindings((list) => list.filter((_, j) => j !== i))}
                    catalog={catalog}
                    observed={observed}
                    showRange={multiGauge}
                    showThresholds={displayType === 'value-list' || multiGauge}
                    showLabel
                    showColor={displayType === 'sparkline'}
                  />
                </div>
              ))}
            </Section>
          )}

          {/* Chart options */}
          {displayType === 'sparkline' && (
            <Section title="Chart">
              <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Default window</label>
                  <select
                    value={chart.windowSec ?? 30}
                    onChange={(e) => setChart({ ...chart, windowSec: Number(e.target.value) })}
                    className={SELECT_CLASS}
                  >
                    {WINDOW_CHOICES.map((s) => (
                      <option key={s} value={s}>
                        {s >= 60 ? `${s / 60} min` : `${s} s`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Vertical scale</label>
                  <select
                    value={chart.yScale ?? 'auto'}
                    onChange={(e) => setChart({ ...chart, yScale: e.target.value as WidgetChartConfig['yScale'] })}
                    className={SELECT_CLASS}
                  >
                    <option value="auto">Auto (fit data)</option>
                    <option value="zero">Auto, include zero</option>
                    <option value="fixed">Fixed (min / max)</option>
                  </select>
                </div>
                <label className="flex h-8 cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={chart.showGrid ?? true}
                    onChange={(e) => setChart({ ...chart, showGrid: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-900 accent-sky-500"
                  />
                  Grid
                </label>
                <label className="flex h-8 cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={chart.fill ?? false}
                    onChange={(e) => setChart({ ...chart, fill: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-900 accent-sky-500"
                  />
                  Shade first series
                </label>
              </div>
            </Section>
          )}

          {/* LED on-threshold */}
          {displayType === 'indicator-led' && (
            <Section title="LED State">
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="On when value is above"
                  value={stateThreshold}
                  placeholder="0"
                  onChange={setStateThreshold}
                />
                <div className="min-w-0 space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">When off</label>
                  <select
                    value={offAlert}
                    onChange={(e) => setOffAlert(e.target.value as '' | 'warn' | 'crit')}
                    className={SELECT_CLASS}
                    title="For a health flag: off turns the light, and the card, amber or red"
                  >
                    <option value="">No alert</option>
                    <option value="warn">Warning (amber)</option>
                    <option value="crit">Critical (red)</option>
                  </select>
                </div>
                <div className="min-w-0 space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Reads when on</label>
                  <Input
                    value={ledOnLabel}
                    maxLength={24}
                    placeholder="ACTIVE / HIGH"
                    onChange={(e) => setLedOnLabel(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Reads when off</label>
                  <Input
                    value={ledOffLabel}
                    maxLength={24}
                    placeholder="INACTIVE / LOW"
                    onChange={(e) => setLedOffLabel(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <p className="text-[10px] text-zinc-500">
                For a bitmask flag, set the binding's bit (e.g. SYS_STATUS.onboard_control_sensors_health, bit 24 for
                logging).
              </p>
            </Section>
          )}

          {/* Toggle feedback */}
          {displayType === 'toggle-switch' && (
            <Section
              title="Vehicle State Feedback"
              right={
                <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={feedbackEnabled}
                    onChange={(e) => setFeedbackEnabled(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-sky-500"
                  />
                  Follow a vehicle field
                </label>
              }
            >
              <p className="-mt-1 text-[10px] text-zinc-500">
                With feedback the switch shows what the vehicle reports (e.g. the servo output it drives) instead of
                what was last sent.
              </p>
              {commandId.trim() === '181' && (
                <p className="-mt-1 text-[10px] text-sky-300/90">
                  Relay toggles follow the vehicle's RELAY_STATUS for relay {param1 || '0'} (RELAY
                  {(Number(param1) || 0) + 1}) automatically. Set a field here only to follow something else.
                </p>
              )}
              {feedbackEnabled && (
                <>
                  <BindingEditor
                    value={feedback}
                    onChange={setFeedback}
                    catalog={catalog}
                    observed={observed}
                    showRange={false}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="On when value is above"
                      value={stateThreshold}
                      placeholder="0 (e.g. 1500 for PWM)"
                      onChange={setStateThreshold}
                    />
                  </div>
                </>
              )}
            </Section>
          )}

          {/* Staleness */}
          {(isTelemetryWidget || (displayType === 'toggle-switch' && feedbackEnabled)) && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <NumberField
                label="Stale after (s)"
                value={staleAfterSec}
                placeholder="3"
                min={0.5}
                onChange={setStaleAfterSec}
              />
            </div>
          )}

          {/* Action Command Binding */}
          {isActionWidget && (
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">MAVLink Command Trigger</h4>
                <label
                  className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-zinc-300"
                  title={irreversible ? `Always confirms: this command ${irreversible}` : undefined}
                >
                  <input
                    type="checkbox"
                    checked={requireConfirm || irreversible !== null}
                    disabled={irreversible !== null}
                    onChange={(e) => setRequireConfirm(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                  />
                  {displayType === 'toggle-switch' ? 'Slide to Switch (confirms)' : 'Require Confirmation'}
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Action Label</label>
                  <Input
                    type="text"
                    placeholder="e.g. Return to Home, Open Gripper"
                    value={actionLabel}
                    onChange={(e) => setActionLabel(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Command</label>
                  <select
                    value={selectedPreset?.key ?? 'custom'}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs text-zinc-200"
                  >
                    {COMMAND_PRESET_GROUPS.filter((group) => offeredPresets.some((c) => c.group === group)).map(
                      (group) => (
                        <optgroup key={group} label={group}>
                          {offeredPresets
                            .filter((c) => c.group === group)
                            .map((c) => (
                              <option key={c.key} value={c.key}>
                                {presetTitle(c, presetKind)}
                                {c.special ? '' : ` (${c.commandId})`}
                              </option>
                            ))}
                        </optgroup>
                      )
                    )}
                    <option value="custom">Custom command ID…</option>
                  </select>
                </div>
              </div>

              {(customCommand || !selectedPreset) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Command ID (MAV_CMD)</label>
                    <Input
                      type="number"
                      min={0}
                      max={65535}
                      value={commandId}
                      onChange={(e) => setCommandId(e.target.value)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              )}
              {selectedPreset?.hint && <p className="-mt-1 text-[10px] text-zinc-500">{selectedPreset.hint}</p>}
              {presetKind !== 'button' && (
                <p className="-mt-1 text-[10px] text-amber-300/90">
                  {presetKind === 'toggle'
                    ? 'A toggle sends on/off in param 1 (param 2 for relay and servo), replacing what is written there, so only commands that take on/off are listed.'
                    : 'A slider sends its value in param 2 for speed, relay and servo, and in param 1 for any other command, so only speed and servo are listed.'}
                </p>
              )}

              {!specialAction && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Send as</label>
                    <select
                      value={sendAs}
                      onChange={(e) => setSendAs(e.target.value === 'int' ? 'int' : 'long')}
                      className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs text-zinc-200"
                    >
                      <option value="long">COMMAND_LONG</option>
                      <option value="int">COMMAND_INT</option>
                    </select>
                  </div>
                  {sendAs === 'int' && (
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-zinc-400">Frame</label>
                      <select
                        value={cmdFrame}
                        onChange={(e) => setCmdFrame(Number(e.target.value))}
                        className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs text-zinc-200"
                      >
                        <option value={3}>Global, relative to home</option>
                        <option value={0}>Global, above sea level</option>
                        <option value={10}>Global, above terrain</option>
                        <option value={2}>None (params as numbers)</option>
                        {/* A frame from an imported widget that isn't one of the above (e.g. a _INT variant). */}
                        {![3, 0, 10, 2].includes(cmdFrame) && <option value={cmdFrame}>MAV_FRAME {cmdFrame}</option>}
                      </select>
                    </div>
                  )}
                </div>
              )}
              {!specialAction && sendAs === 'int' && (
                <p className="-mt-1 text-[10px] text-zinc-500">
                  {GLOBAL_FRAMES.has(cmdFrame)
                    ? 'Param 5 and 6 are latitude and longitude in degrees (sent ×10⁷); param 7 is altitude (m).'
                    : 'Params 5 and 6 are sent as whole numbers (x, y); param 7 as is.'}
                </p>
              )}

              {!specialAction && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {['Param 1', 'Param 2', 'Param 3'].map((label, i) => (
                      <div key={label} className="space-y-1">
                        <label className="text-[11px] font-medium text-zinc-400">{label}</label>
                        <Input
                          type="number"
                          step="any"
                          value={cmdParams[i]}
                          onChange={(e) => setCmdParam(i, e.target.value)}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMoreParams((v) => !v)}
                    className="text-[11px] text-zinc-400 hover:text-zinc-200"
                  >
                    {showMoreParams ? '− Hide params 4–7' : '+ Params 4–7'}
                  </button>
                  {showMoreParams && (
                    <div className="grid grid-cols-4 gap-2">
                      {[3, 4, 5, 6].map((i) => (
                        <div key={i} className="space-y-1">
                          <label className="text-[11px] font-medium text-zinc-400">Param {i + 1}</label>
                          <Input
                            type="number"
                            step="any"
                            value={cmdParams[i]}
                            onChange={(e) => setCmdParam(i, e.target.value)}
                            className="h-8 font-mono text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadWidgetJson}
              className="gap-1.5 border-zinc-700 text-xs"
            >
              <Download className="h-3.5 w-3.5 text-sky-400" />
              Export Widget JSON
            </Button>

            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={overValueLimit}
                title={overValueLimit ? `A composite widget reads at most ${MAX_COMPOSITE_BINDINGS} values` : undefined}
                className="gap-1 bg-sky-500 text-xs font-bold text-white hover:bg-sky-600"
              >
                <Save className="h-3.5 w-3.5" />
                {isEditing ? 'Save Changes' : 'Save & Place'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="min-w-0 space-y-1.5 lg:sticky lg:top-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Live Preview</div>
          {/* inert: preview controls must never send commands or parameter writes */}
          <div
            ref={(el) => el?.setAttribute('inert', '')}
            className={`pointer-events-none flex select-none flex-col ${isComposite ? 'max-h-[70vh] min-h-[300px] overflow-hidden' : 'h-[300px]'}`}
          >
            <CustomWidgetRenderer definition={previewDefinition} />
          </div>
          <p className="text-[10px] text-zinc-500">
            Shows live telemetry when connected. Controls are disabled in the preview.
          </p>
        </div>
      </form>
    </Modal>
  );
};
