import React, { useState, useEffect, useMemo } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  CustomWidgetDefinition,
  MultiBarGroupType,
  WidgetChartConfig,
  WidgetDataBinding,
  WidgetDisplayType,
  WidgetGaugeConfig,
} from '../../types/widget';
import { Download, Plus, Save } from 'lucide-react';
import { BindingEditor, NumberField, SELECT_CLASS } from './BindingEditor';
import { getObservedCatalog } from '../../lib/messageCache';
import { CustomWidgetRenderer } from '../widgets/CustomWidgetRenderer';
import { WINDOW_CHOICES } from '../widgets/custom/TimeSeriesChart';

interface CustomWidgetCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWidget?: CustomWidgetDefinition | null;
}

export const COMMON_FIELDS: Record<string, string[]> = {
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
  VIBRATION: ['vibration_x', 'vibration_y', 'vibration_z', 'clipping_0', 'clipping_1', 'clipping_2'],
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

/** Drop undefined / empty keys so saved JSON stays tidy. */
function cleanBinding(b: WidgetDataBinding, keepRange = true): WidgetDataBinding {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined || v === '') continue;
    if (!keepRange && (k === 'min' || k === 'max')) continue;
    out[k] = v;
  }
  return out as unknown as WidgetDataBinding;
}

/** Message-specific defaults when the user picks a message for a binding. */
function messageDefaults(msg: string): Partial<WidgetDataBinding> {
  if (msg === 'RC_CHANNELS (scaled)' || msg === 'SERVO_OUTPUT_RAW (scaled)') return { min: -1, max: 1, unit: '', decimals: 2 };
  if (msg === 'RC_CHANNELS' || msg === 'SERVO_OUTPUT_RAW') return { min: 1000, max: 2000, unit: 'µs', decimals: 0 };
  return {};
}

const Section: React.FC<{ title: string; tone?: 'sky' | 'amber'; right?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  tone = 'sky',
  right,
  children,
}) => (
  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h4 className={`text-xs font-bold uppercase tracking-wider ${tone === 'amber' ? 'text-amber-400' : 'text-sky-400'}`}>
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
  const [displayType, setDisplayType] = useState<WidgetDisplayType>('stat-card');
  const [category, setCategory] = useState<'telemetry' | 'control' | 'avionics' | 'custom'>('telemetry');
  const [colorScheme, setColorScheme] = useState<'default' | 'green' | 'amber' | 'blue' | 'red'>('default');

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
  const [staleAfterSec, setStaleAfterSec] = useState<number | undefined>(undefined);

  // Multi-bar config
  const [multiBarGroup, setMultiBarGroup] = useState<MultiBarGroupType>('rc-8');

  // Param control config
  const [paramId, setParamId] = useState('WPNAV_SPEED');
  const [paramUnit, setParamUnit] = useState('cm/s');
  const [paramMin, setParamMin] = useState('50');
  const [paramMax, setParamMax] = useState('2000');
  const [paramStep, setParamStep] = useState('10');
  const [paramOptionsText, setParamOptionsText] = useState('');
  const [paramConfirm, setParamConfirm] = useState(true);

  // Action Binding
  const [actionLabel, setActionLabel] = useState('Trigger Command');
  const [commandId, setCommandId] = useState('20'); // MAV_CMD_NAV_RETURN_TO_LAUNCH
  const [param1, setParam1] = useState('0');
  const [param2, setParam2] = useState('0');
  const [param3, setParam3] = useState('0');
  const [requireConfirm, setRequireConfirm] = useState(true);

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

  useEffect(() => {
    if (!isOpen) return;
    const w = initialWidget;
    setName(w?.name || '');
    setDescription(w?.description || '');
    setDisplayType(w?.displayType ?? 'stat-card');
    setCategory(w?.category || 'telemetry');
    setColorScheme(w?.colorScheme || 'default');
    setBinding(w?.binding ? { ...w.binding } : { ...DEFAULT_BINDING });
    setExtraBindings((w?.bindings ?? []).map((b) => ({ ...b })));
    setGauge({ ...(w?.gauge ?? {}) });
    setChart({ ...(w?.chart ?? {}) });
    setFeedbackEnabled(Boolean(w?.feedback));
    setFeedback(w?.feedback ? { ...w.feedback } : { messageName: 'SERVO_OUTPUT_RAW', fieldName: 'servo9_raw', decimals: 0 });
    setStateThreshold(w?.stateThreshold);
    setStaleAfterSec(w?.staleAfterSec);

    setMultiBarGroup(w?.multiBarConfig?.group ?? 'rc-8');

    const pc = w?.paramControl;
    setParamId(pc?.paramId || 'WPNAV_SPEED');
    setParamUnit(pc ? pc.unit ?? '' : 'cm/s');
    setParamMin(pc ? (pc.min !== undefined ? String(pc.min) : '') : '50');
    setParamMax(pc ? (pc.max !== undefined ? String(pc.max) : '') : '2000');
    setParamStep(pc ? (pc.step !== undefined ? String(pc.step) : '1') : '10');
    setParamConfirm(pc?.confirmation ?? true);
    setParamOptionsText(pc?.options ? pc.options.map((o) => `${o.label}:${o.value}`).join(', ') : '');

    const a = w?.action;
    setActionLabel(a?.label || 'Trigger Command');
    setCommandId(String(a?.commandId || 20));
    setParam1(String(a?.params?.[0] ?? 0));
    setParam2(String(a?.params?.[1] ?? 0));
    setParam3(String(a?.params?.[2] ?? 0));
    setRequireConfirm(a?.confirmation ?? true);
  }, [isOpen, initialWidget]);

  const isActionWidget =
    displayType === 'action-button' || displayType === 'toggle-switch' || displayType === 'slider-control';
  const isTelemetryWidget = TELEMETRY_TYPES.includes(displayType);
  const extraLimit = EXTRA_VALUE_LIMIT[displayType] ?? 0;
  const extrasUsed = extraBindings.slice(0, extraLimit);
  const usesRange = displayType !== 'value-list' && displayType !== 'stat-card' && displayType !== 'text-display';

  const buildDefinition = (): CustomWidgetDefinition => {
    const id = initialWidget?.id || `custom-${Date.now()}`;
    const def: CustomWidgetDefinition = {
      id,
      name: name.trim() || 'Custom Instrument',
      description: description.trim(),
      category: isActionWidget || displayType === 'param-control' ? 'control' : category,
      displayType,
      colorScheme,
    };

    if (isTelemetryWidget) {
      def.binding = cleanBinding({ ...binding, multiplier: binding.multiplier ?? 1 });
      if (extrasUsed.length) def.bindings = extrasUsed.map((b) => cleanBinding(b, false));
      if (staleAfterSec !== undefined) def.staleAfterSec = staleAfterSec;
    }
    if (displayType === 'slider-control') {
      def.binding = cleanBinding({ messageName: binding.messageName, fieldName: binding.fieldName, unit: binding.unit, min: binding.min ?? 0, max: binding.max ?? 100 });
    }
    if (displayType === 'gauge-radial') def.gauge = { ...gauge };
    if (displayType === 'gauge-linear') def.gauge = { majorTicks: gauge.majorTicks, showZones: gauge.showZones };
    if (displayType === 'sparkline') def.chart = { ...chart };
    if (displayType === 'indicator-led' && stateThreshold !== undefined) def.stateThreshold = stateThreshold;
    if (displayType === 'toggle-switch' && feedbackEnabled) {
      def.feedback = cleanBinding(feedback, false);
      if (stateThreshold !== undefined) def.stateThreshold = stateThreshold;
      if (staleAfterSec !== undefined) def.staleAfterSec = staleAfterSec;
    }

    if (displayType === 'multi-bar') {
      def.multiBarConfig = {
        group: multiBarGroup,
      };
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

      def.paramControl = {
        paramId: paramId.trim().toUpperCase() || 'WPNAV_SPEED',
        unit: paramUnit.trim(),
        min: paramMin.trim() !== '' ? parseFloat(paramMin) : undefined,
        max: paramMax.trim() !== '' ? parseFloat(paramMax) : undefined,
        step: paramStep.trim() !== '' ? parseFloat(paramStep) : 1,
        options: parsedOptions.length > 0 ? parsedOptions : undefined,
        confirmation: paramConfirm,
      };
    }

    if (isActionWidget) {
      def.action = {
        label: actionLabel,
        commandId: parseInt(commandId, 10) || 0,
        params: [parseFloat(param1) || 0, parseFloat(param2) || 0, parseFloat(param3) || 0, 0, 0, 0, 0],
        confirmation: requireConfirm,
      };
    }

    return def;
  };

  const previewJson = JSON.stringify({ ...buildDefinition(), id: `${initialWidget?.id ?? 'new'}-preview` });
  // Keep the preview's definition stable between renders that don't change it (its chart restarts otherwise).
  const previewDefinition = useMemo(() => JSON.parse(previewJson) as CustomWidgetDefinition, [previewJson]);

  const handleSaveAndPlace = (e: React.FormEvent) => {
    e.preventDefault();
    const def = buildDefinition();
    saveCustomWidget(def);
    if (!isEditing) {
      addWidgetToActiveTab(def.id, 6);
    }
    onClose();
  };

  const handleDownloadWidgetJson = () => {
    const def = buildDefinition();
    const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${def.name.toLowerCase().replace(/\s+/g, '-')}.widget.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addExtra = () => {
    const last = extraBindings[extraBindings.length - 1] ?? binding;
    setExtraBindings((list) => [
      ...list.slice(0, extraLimit),
      { messageName: last.messageName, fieldName: last.fieldName, unit: last.unit, unitKind: last.unitKind, multiplier: last.multiplier, decimals: last.decimals },
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
      <form onSubmit={handleSaveAndPlace} className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          {/* Name & Display Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                value={displayType}
                onChange={(e) => {
                  const nextType = e.target.value as WidgetDisplayType;
                  setDisplayType(nextType);
                  if (nextType === 'compass-rose' && binding.messageName === 'SYS_STATUS') {
                    setBinding({ ...binding, messageName: 'WIND', fieldName: 'direction', unit: '°', min: 0, max: 360 });
                  }
                }}
                className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
              >
                <option value="stat-card">Stat Card (Digital readout)</option>
                <option value="value-list">Value List (Several labelled readouts)</option>
                <option value="gauge-linear">Linear Gauge (Horizontal bar)</option>
                <option value="gauge-radial">Radial Gauge (Dial with needle)</option>
                <option value="sparkline">Time-Series Chart (One or more values over time)</option>
                <option value="compass-rose">Compass / Vector Rose (Heading / Wind / Bearing)</option>
                <option value="multi-bar">Multi-Channel Bar / PWM Visualizer (RC / Servo / ESC / Vibe)</option>
                <option value="param-control">Parameter Control (ArduPilot PARAM_SET)</option>
                <option value="indicator-led">LED Status Indicator (On/Off)</option>
                <option value="action-button">Action Button (MAVLink Command)</option>
                <option value="toggle-switch">Toggle Switch (Relay / Servo)</option>
                <option value="slider-control">Slider Control (PWM / Speed)</option>
                <option value="text-display">Text Output Display</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2 space-y-1">
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

        {/* Multi-Bar Channel Group Configuration */}
        {displayType === 'multi-bar' && (
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Multi-Channel Bar / PWM Group
            </h4>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">Telemetry Channel Group</label>
              <select
                value={multiBarGroup}
                onChange={(e) => setMultiBarGroup(e.target.value as MultiBarGroupType)}
                className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200"
              >
                <option value="rc-8">RC_CHANNELS: Radio Input Channels 1–8 (1000–2000 µs)</option>
                <option value="rc-8-scaled">RC_CHANNELS (scaled): Radio Input Channels 1–8 (-1.0 to 1.0)</option>
                <option value="servo-8">SERVO_OUTPUT_RAW: Motor / Servo Outputs 1–8 (1000–2000 µs)</option>
                <option value="servo-8-scaled">SERVO_OUTPUT_RAW (scaled): Motor / Servo Outputs 1–8 (-1.0 to 1.0)</option>
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

        {/* Parameter Control Configuration */}
        {displayType === 'param-control' && (
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">
                ArduPilot Parameter Binding (PARAM_SET)
              </h4>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={paramConfirm}
                  onChange={(e) => setParamConfirm(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                />
                Require Confirmation
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Parameter ID (up to 16 chars)</label>
                <Input
                  type="text"
                  maxLength={16}
                  placeholder="e.g. WPNAV_SPEED, RTL_ALT"
                  value={paramId}
                  onChange={(e) => setParamId(e.target.value.toUpperCase())}
                  className="h-8 text-xs font-mono uppercase"
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
                  className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-300"
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

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Unit</label>
                <Input
                  type="text"
                  placeholder="cm/s, m, %"
                  value={paramUnit}
                  onChange={(e) => setParamUnit(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Min</label>
                <Input
                  type="number"
                  step="any"
                  value={paramMin}
                  onChange={(e) => setParamMin(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Max</label>
                <Input
                  type="number"
                  step="any"
                  value={paramMax}
                  onChange={(e) => setParamMax(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Step</label>
                <Input
                  type="number"
                  step="any"
                  value={paramStep}
                  onChange={(e) => setParamStep(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">
                Dropdown Options (Optional, format: <code className="text-sky-400">Slow:300, Cruise:500, Fast:1000</code>)
              </label>
              <Input
                type="text"
                placeholder="Leave blank for numeric input, or enter Label:Value pairs"
                value={paramOptionsText}
                onChange={(e) => setParamOptionsText(e.target.value)}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>
        )}

        {/* Telemetry binding (primary value) */}
        {isTelemetryWidget && (
          <Section title={displayType === 'value-list' || displayType === 'sparkline' ? 'Value 1' : 'Telemetry Data Binding'}>
            <BindingEditor
              value={binding}
              onChange={setBinding}
              catalog={catalog}
              observed={observed}
              showRange={usesRange}
              showThresholds={displayType !== 'compass-rose'}
              showLabel={displayType === 'value-list' || displayType === 'sparkline'}
              showColor={displayType === 'sparkline'}
              onMessagePicked={(msg) => setBinding((b) => ({ ...b, ...messageDefaults(msg) }))}
            />
            {displayType === 'sparkline' && (
              <p className="text-[10px] text-zinc-500">Min and max are only used when the chart scale is set to Fixed.</p>
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
                  className="h-8 text-xs font-mono"
                />
              </div>
              <NumberField label="Min Value" value={binding.min} onChange={(v) => setBinding({ ...binding, min: v })} />
              <NumberField label="Max Value" value={binding.max} onChange={(v) => setBinding({ ...binding, max: v })} />
            </div>
          </Section>
        )}

        {/* Additional values */}
        {isTelemetryWidget && extraLimit > 0 && (
          <Section
            title={extraLimit === 1 ? 'Secondary Marker (Optional)' : 'More Values'}
            right={
              extrasUsed.length < extraLimit && (
                <Button type="button" variant="outline" size="sm" className="h-7 text-[11px] gap-1 border-zinc-700" onClick={addExtra}>
                  <Plus className="h-3 w-3" />
                  {extraLimit === 1 ? 'Add marker' : 'Add value'}
                </Button>
              )
            }
          >
            <p className="text-[10px] text-zinc-500 -mt-1">
              {displayType === 'sparkline'
                ? 'Each value is plotted as its own series on the same chart.'
                : displayType === 'value-list'
                  ? 'Each value gets its own labelled row.'
                  : 'Drawn as a magenta marker on the same scale, e.g. a target against the actual value.'}
            </p>
            {extrasUsed.map((b, i) => (
              <div key={i} className="pt-2 border-t border-zinc-800/80 first:border-t-0 first:pt-0">
                <BindingEditor
                  title={extraLimit === 1 ? 'Marker value' : `Value ${i + 2}`}
                  value={b}
                  onChange={(next) => setExtraBindings((list) => list.map((x, j) => (j === i ? next : x)))}
                  onRemove={() => setExtraBindings((list) => list.filter((_, j) => j !== i))}
                  catalog={catalog}
                  observed={observed}
                  showRange={false}
                  showThresholds={displayType === 'value-list'}
                  showLabel
                  showColor={displayType === 'sparkline'}
                />
              </div>
            ))}
          </Section>
        )}

        {/* Radial / linear gauge options */}
        {(displayType === 'gauge-radial' || displayType === 'gauge-linear') && (
          <Section title="Scale">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
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
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none h-8">
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

        {/* Chart options */}
        {displayType === 'sparkline' && (
          <Section title="Chart">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
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
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none h-8">
                <input
                  type="checkbox"
                  checked={chart.showGrid ?? true}
                  onChange={(e) => setChart({ ...chart, showGrid: e.target.checked })}
                  className="rounded border-zinc-700 bg-zinc-900 accent-sky-500"
                />
                Grid
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none h-8">
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
            </div>
          </Section>
        )}

        {/* Toggle feedback */}
        {displayType === 'toggle-switch' && (
          <Section
            title="Vehicle State Feedback"
            right={
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
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
            <p className="text-[10px] text-zinc-500 -mt-1">
              With feedback the switch shows what the vehicle reports (e.g. the servo output it drives) instead of what was
              last sent.
            </p>
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                MAVLink Command Trigger
              </h4>
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={requireConfirm}
                  onChange={(e) => setRequireConfirm(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                />
                Require Confirmation
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                <label className="text-[11px] font-medium text-zinc-400">Command ID (MAV_CMD)</label>
                <select
                  value={commandId}
                  onChange={(e) => setCommandId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200"
                >
                  <option value="20">20 - RTL (Return to Launch)</option>
                  <option value="21">21 - LAND</option>
                  <option value="22">22 - TAKEOFF</option>
                  <option value="176">176 - DO_SET_MODE</option>
                  <option value="178">178 - DO_CHANGE_SPEED</option>
                  <option value="181">181 - DO_SET_RELAY (P1=Relay#, P2=On/Off)</option>
                  <option value="183">183 - DO_SET_SERVO (P1=Servo#, P2=PWM)</option>
                  <option value="400">400 - ARM / DISARM</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Param 1 (Instance/ID)</label>
                <Input
                  type="number"
                  step="any"
                  value={param1}
                  onChange={(e) => setParam1(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Param 2 (Value/ON PWM)</label>
                <Input
                  type="number"
                  step="any"
                  value={param2}
                  onChange={(e) => setParam2(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Param 3 (OFF PWM/Opt)</label>
                <Input
                  type="number"
                  step="any"
                  value={param3}
                  onChange={(e) => setParam3(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadWidgetJson}
              className="gap-1.5 text-xs border-zinc-700"
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
                className="bg-sky-500 hover:bg-sky-600 text-white font-bold gap-1 text-xs"
              >
                <Save className="h-3.5 w-3.5" />
                {isEditing ? 'Save Changes' : 'Save & Place'}
              </Button>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-0 space-y-1.5 min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Live Preview</div>
          {/* inert: preview controls must never send commands or parameter writes */}
          <div ref={(el) => el?.setAttribute('inert', '')} className="h-[300px] flex flex-col pointer-events-none select-none">
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
