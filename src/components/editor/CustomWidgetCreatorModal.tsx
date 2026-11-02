import React, { useState, useEffect } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CustomWidgetDefinition, MultiBarGroupType, WidgetDisplayType } from '../../types/widget';
import { Download, Save } from 'lucide-react';

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

  // Telemetry Binding
  const [messageName, setMessageName] = useState('SYS_STATUS');
  const [fieldName, setFieldName] = useState('voltage_battery');
  const [unit, setUnit] = useState('V');
  const [multiplier, setMultiplier] = useState('1');
  const [decimals, setDecimals] = useState('1');
  const [minVal, setMinVal] = useState('0');
  const [maxVal, setMaxVal] = useState('100');
  const [warnThreshold, setWarnThreshold] = useState('');
  const [critThreshold, setCritThreshold] = useState('');
  const [thresholdInvert, setThresholdInvert] = useState(false);

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

  useEffect(() => {
    if (!isOpen) return;
    if (initialWidget) {
      setName(initialWidget.name || '');
      setDescription(initialWidget.description || '');
      setDisplayType(initialWidget.displayType);
      setCategory(initialWidget.category || 'telemetry');
      setColorScheme(initialWidget.colorScheme || 'default');

      if (initialWidget.binding) {
        setMessageName(initialWidget.binding.messageName || 'SYS_STATUS');
        setFieldName(initialWidget.binding.fieldName || 'voltage_battery');
        setUnit(initialWidget.binding.unit ?? '');
        setMultiplier(String(initialWidget.binding.multiplier ?? 1));
        setDecimals(String(initialWidget.binding.decimals ?? 1));
        setMinVal(String(initialWidget.binding.min ?? 0));
        setMaxVal(String(initialWidget.binding.max ?? 100));
        setWarnThreshold(
          initialWidget.binding.warnThreshold !== undefined ? String(initialWidget.binding.warnThreshold) : ''
        );
        setCritThreshold(
          initialWidget.binding.critThreshold !== undefined ? String(initialWidget.binding.critThreshold) : ''
        );
        setThresholdInvert(Boolean(initialWidget.binding.thresholdInvert));
      }

      if (initialWidget.multiBarConfig) {
        setMultiBarGroup(initialWidget.multiBarConfig.group);
      }

      if (initialWidget.paramControl) {
        setParamId(initialWidget.paramControl.paramId || 'WPNAV_SPEED');
        setParamUnit(initialWidget.paramControl.unit ?? '');
        setParamMin(initialWidget.paramControl.min !== undefined ? String(initialWidget.paramControl.min) : '');
        setParamMax(initialWidget.paramControl.max !== undefined ? String(initialWidget.paramControl.max) : '');
        setParamStep(initialWidget.paramControl.step !== undefined ? String(initialWidget.paramControl.step) : '1');
        setParamConfirm(initialWidget.paramControl.confirmation ?? true);
        setParamOptionsText(
          initialWidget.paramControl.options
            ? initialWidget.paramControl.options.map((o) => `${o.label}:${o.value}`).join(', ')
            : ''
        );
      }

      if (initialWidget.action) {
        setActionLabel(initialWidget.action.label || 'Trigger Command');
        setCommandId(String(initialWidget.action.commandId || 20));
        setParam1(String(initialWidget.action.params?.[0] ?? 0));
        setParam2(String(initialWidget.action.params?.[1] ?? 0));
        setParam3(String(initialWidget.action.params?.[2] ?? 0));
        setRequireConfirm(initialWidget.action.confirmation ?? true);
      }
    } else {
      setName('');
      setDescription('');
      setDisplayType('stat-card');
      setCategory('telemetry');
      setColorScheme('default');
      setMessageName('SYS_STATUS');
      setFieldName('voltage_battery');
      setUnit('V');
      setMultiplier('1');
      setDecimals('1');
      setMinVal('0');
      setMaxVal('100');
      setWarnThreshold('');
      setCritThreshold('');
      setThresholdInvert(false);
      setMultiBarGroup('rc-8');
      setParamId('WPNAV_SPEED');
      setParamUnit('cm/s');
      setParamMin('50');
      setParamMax('2000');
      setParamStep('10');
      setParamOptionsText('');
      setParamConfirm(true);
    }
  }, [isOpen, initialWidget]);

  const isActionWidget =
    displayType === 'action-button' || displayType === 'toggle-switch' || displayType === 'slider-control';
  const isTelemetryWidget =
    displayType === 'stat-card' ||
    displayType === 'gauge-linear' ||
    displayType === 'gauge-radial' ||
    displayType === 'indicator-led' ||
    displayType === 'text-display' ||
    displayType === 'slider-control' ||
    displayType === 'compass-rose' ||
    displayType === 'sparkline';

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
      const warnNum = warnThreshold.trim() !== '' ? parseFloat(warnThreshold) : undefined;
      const critNum = critThreshold.trim() !== '' ? parseFloat(critThreshold) : undefined;
      def.binding = {
        messageName,
        fieldName,
        unit: unit.trim(),
        multiplier: parseFloat(multiplier) || 1,
        min: parseFloat(minVal) || 0,
        max: parseFloat(maxVal) || 100,
        decimals: parseInt(decimals, 10) >= 0 ? parseInt(decimals, 10) : 1,
        ...(warnNum !== undefined && !isNaN(warnNum) ? { warnThreshold: warnNum } : {}),
        ...(critNum !== undefined && !isNaN(critNum) ? { critThreshold: critNum } : {}),
        ...(thresholdInvert ? { thresholdInvert: true } : {}),
      };
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
        params: [
          parseFloat(param1) || 0,
          parseFloat(param2) || 0,
          parseFloat(param3) || 0,
          0,
          0,
          0,
          0,
        ],
        confirmation: requireConfirm,
      };
    }

    return def;
  };

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? `Edit Custom Widget: ${initialWidget?.name}` : 'Create Custom Declarative Widget'}
      description="Define a reusable, safe JSON widget bound to any MAVLink telemetry field, parameter, or flight command."
    >
      <form onSubmit={handleSaveAndPlace} className="space-y-4">
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
                if (nextType === 'compass-rose' && messageName === 'SYS_STATUS') {
                  setMessageName('WIND');
                  setFieldName('direction');
                  setUnit('°');
                  setMinVal('0');
                  setMaxVal('360');
                }
              }}
              className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
            >
              <option value="stat-card">Stat Card (Digital readout)</option>
              <option value="gauge-linear">Linear Gauge (Horizontal bar)</option>
              <option value="gauge-radial">Radial Gauge (Circular dial)</option>
              <option value="sparkline">Sparkline Mini-Chart (Rolling trend)</option>
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
                <option value="servo-8">SERVO_OUTPUT_RAW: Motor / Servo Outputs 1–8 (1000–2000 µs)</option>
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

        {/* Telemetry Binding Settings (for stat, gauge, led, text, slider, compass-rose, sparkline) */}
        {isTelemetryWidget && (
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">
              {displayType === 'slider-control' ? 'Slider Range & Unit' : 'Telemetry Data Binding'}
            </h4>

            {displayType !== 'slider-control' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">MAVLink Message</label>
                  <select
                    value={messageName}
                    onChange={(e) => {
                      const msg = e.target.value;
                      setMessageName(msg);
                      if (COMMON_FIELDS[msg]?.length) {
                        setFieldName(COMMON_FIELDS[msg][0]);
                      }
                    }}
                    className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200"
                  >
                    {Object.keys(COMMON_FIELDS).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-400">Target Field</label>
                  <select
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200"
                  >
                    {(COMMON_FIELDS[messageName] || []).map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Unit Label</label>
                <Input
                  type="text"
                  placeholder="V, m/s, %"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Min Value</label>
                <Input
                  type="number"
                  step="any"
                  value={minVal}
                  onChange={(e) => setMinVal(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Max Value</label>
                <Input
                  type="number"
                  step="any"
                  value={maxVal}
                  onChange={(e) => setMaxVal(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              {displayType !== 'slider-control' && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Scale Mult</label>
                    <Input
                      type="number"
                      step="any"
                      value={multiplier}
                      onChange={(e) => setMultiplier(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-zinc-400">Decimals</label>
                    <Input
                      type="number"
                      min="0"
                      max="6"
                      value={decimals}
                      onChange={(e) => setDecimals(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </>
              )}
            </div>

            {displayType !== 'slider-control' && (
              <div className="pt-2 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-amber-400/90">Warning Threshold (Opt)</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="e.g. 14.4 or 35"
                    value={warnThreshold}
                    onChange={(e) => setWarnThreshold(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-red-400/90">Critical Threshold (Opt)</label>
                  <Input
                    type="number"
                    step="any"
                    placeholder="e.g. 13.8 or 50"
                    value={critThreshold}
                    onChange={(e) => setCritThreshold(e.target.value)}
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer select-none h-8 pb-1">
                  <input
                    type="checkbox"
                    checked={thresholdInvert}
                    onChange={(e) => setThresholdInvert(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-900 accent-amber-500"
                  />
                  Alert when below threshold (e.g. Voltage)
                </label>
              </div>
            )}
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
      </form>
    </Modal>
  );
};
