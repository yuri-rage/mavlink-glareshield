import React, { useState } from 'react';
import { useDashboardStore } from '../../store/dashboardStore';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { CustomWidgetDefinition, WidgetDisplayType } from '../../types/widget';
import { Download, Save } from 'lucide-react';

interface CustomWidgetCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMON_FIELDS: Record<string, string[]> = {
  SYS_STATUS: ['voltage_battery', 'current_battery', 'battery_remaining', 'load', 'drop_rate_comm'],
  ATTITUDE: ['roll', 'pitch', 'yaw', 'rollspeed', 'pitchspeed', 'yawspeed'],
  VFR_HUD: ['groundspeed', 'airspeed', 'climb', 'throttle', 'alt', 'heading'],
  GLOBAL_POSITION_INT: ['relative_alt', 'alt', 'vx', 'vy', 'vz', 'hdg'],
  GPS_RAW_INT: ['satellites_visible', 'eph', 'epv', 'vel'],
  BATTERY_STATUS: ['current_battery', 'current_consumed', 'battery_remaining'],
};

export const CustomWidgetCreatorModal: React.FC<CustomWidgetCreatorModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { saveCustomWidget, addWidgetToActiveTab } = useDashboardStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [displayType, setDisplayType] = useState<WidgetDisplayType>('stat-card');
  const [category, setCategory] = useState<'telemetry' | 'control' | 'avionics'>('telemetry');

  // Telemetry Binding
  const [messageName, setMessageName] = useState('SYS_STATUS');
  const [fieldName, setFieldName] = useState('voltage_battery');
  const [unit, setUnit] = useState('V');
  const [multiplier, setMultiplier] = useState('1');
  const [minVal, setMinVal] = useState('0');
  const [maxVal, setMaxVal] = useState('100');

  // Action Binding
  const [actionLabel, setActionLabel] = useState('Trigger Command');
  const [commandId, setCommandId] = useState('20'); // MAV_CMD_NAV_RETURN_TO_LAUNCH
  const [param1, setParam1] = useState('0');

  const buildDefinition = (): CustomWidgetDefinition => {
    const id = `custom-${Date.now()}`;
    const def: CustomWidgetDefinition = {
      id,
      name: name.trim() || 'Custom Instrument',
      description: description.trim(),
      category,
      displayType,
    };

    if (displayType === 'action-button' || displayType === 'toggle-switch') {
      def.action = {
        label: actionLabel,
        commandId: parseInt(commandId, 10) || 0,
        params: [parseFloat(param1) || 0, 0, 0, 0, 0, 0, 0],
      };
    } else {
      def.binding = {
        messageName,
        fieldName,
        unit: unit.trim(),
        multiplier: parseFloat(multiplier) || 1,
        min: parseFloat(minVal) || 0,
        max: parseFloat(maxVal) || 100,
        decimals: 1,
      };
    }

    return def;
  };

  const handleSaveAndPlace = (e: React.FormEvent) => {
    e.preventDefault();
    const def = buildDefinition();
    saveCustomWidget(def);
    addWidgetToActiveTab(def.id, 6);
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
      title="Create Custom Declarative Widget"
      description="Define a reusable, safe JSON widget bound to any MAVLink telemetry field or flight command."
    >
      <form onSubmit={handleSaveAndPlace} className="space-y-4">
        {/* Name & Display Type */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-300">Widget Name</label>
            <Input
              type="text"
              required
              placeholder="e.g. Bus Voltmeter, Parachute Release"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-zinc-300">Display UI Type</label>
            <select
              value={displayType}
              onChange={(e) => setDisplayType(e.target.value as WidgetDisplayType)}
              className="h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-100"
            >
              <option value="stat-card">Stat Card (Digital readout)</option>
              <option value="gauge-linear">Linear Gauge (Horizontal bar)</option>
              <option value="indicator-led">LED Status Indicator (On/Off)</option>
              <option value="action-button">Action Button (MAVLink Command)</option>
              <option value="toggle-switch">Toggle Switch (Relay / Servo)</option>
              <option value="text-display">Text Output Display</option>
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-zinc-300">Description (Optional)</label>
          <Input
            type="text"
            placeholder="Brief explanation of this widget"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="text-xs"
          />
        </div>

        {/* Telemetry Binding Settings (for stat, gauge, led, text) */}
        {displayType !== 'action-button' && displayType !== 'toggle-switch' ? (
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Telemetry Data Binding
            </h4>

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

            <div className="grid grid-cols-3 gap-2">
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
                  value={minVal}
                  onChange={(e) => setMinVal(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Max Value</label>
                <Input
                  type="number"
                  value={maxVal}
                  onChange={(e) => setMaxVal(e.target.value)}
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        ) : (
          /* Action Command Binding */
          <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              MAVLink Command Trigger
            </h4>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">Button Label</label>
              <Input
                type="text"
                placeholder="e.g. Return to Home, Open Gripper"
                value={actionLabel}
                onChange={(e) => setActionLabel(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Command ID (MAV_CMD)</label>
                <select
                  value={commandId}
                  onChange={(e) => setCommandId(e.target.value)}
                  className="h-8 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-0 text-xs font-mono text-zinc-200"
                >
                  <option value="20">20 - RTL (Return to Launch)</option>
                  <option value="21">21 - LAND</option>
                  <option value="181">181 - DO_SET_RELAY</option>
                  <option value="183">183 - DO_SET_SERVO</option>
                  <option value="400">400 - ARM / DISARM</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-400">Param 1 Value</label>
                <Input
                  type="number"
                  value={param1}
                  onChange={(e) => setParam1(e.target.value)}
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
              Save & Place
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
