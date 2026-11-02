import React, { useState, useEffect } from 'react';
import { CustomWidgetDefinition } from '../../types/widget';
import { useTelemetryStore } from '../../store/telemetryStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { messageRateManager } from '../../mavlink/rateManager';
import { MAVLINK_MSG_ID } from '../../mavlink/messages';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Activity, Play, Zap, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';

interface CustomWidgetRendererProps {
  definition: CustomWidgetDefinition;
}

export const CustomWidgetRenderer: React.FC<CustomWidgetRendererProps> = ({ definition }) => {
  const telemetry = useTelemetryStore();
  const [toggleState, setToggleState] = useState(false);
  const [lastActionTime, setLastActionTime] = useState<number | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [sliderVal, setSliderVal] = useState<number>(definition.binding?.min ?? 0);

  // Register message rate subscription if bound to a telemetry stream
  useEffect(() => {
    if (!definition.binding?.messageName) return;
    const msgId = (MAVLINK_MSG_ID as any)[definition.binding.messageName.toUpperCase()];
    if (msgId !== undefined) {
      messageRateManager.registerRequirement(`custom-${definition.id}`, msgId);
      return () => {
        messageRateManager.unregisterRequirement(`custom-${definition.id}`);
      };
    }
  }, [definition.id, definition.binding?.messageName]);

  // Extract raw value based on message & field binding
  const extractBoundValue = (): number | string | null => {
    if (!definition.binding) return null;
    const { messageName, fieldName, multiplier = 1, decimals = 1 } = definition.binding;

    let rawVal: any = null;
    const msg = messageName.toUpperCase();

    // Field aliases to map MAVLink protocol names to store properties
    const fieldAliases: Record<string, string> = {
      voltage_battery: 'voltage',
      current_battery: 'current',
      battery_remaining: 'remaining',
      current_consumed: 'consumedMah',
      satellites_visible: 'satellites',
      eph: 'hdop',
      epv: 'vdop',
      vel: 'groundspeed',
      relative_alt: 'relativeAlt',
      roll_deg: 'rollDeg',
      pitch_deg: 'pitchDeg',
      yaw_deg: 'yawDeg',
    };
    const targetKey = fieldAliases[fieldName] || fieldName;

    if (msg === 'ATTITUDE') {
      rawVal = (telemetry.attitude as any)[targetKey] ?? (telemetry.attitude as any)[fieldName];
    } else if (msg === 'GLOBAL_POSITION_INT') {
      rawVal = (telemetry.position as any)[targetKey] ?? (telemetry.position as any)[fieldName];
    } else if (msg === 'VFR_HUD') {
      rawVal = (telemetry.vfr as any)[targetKey] ?? (telemetry.vfr as any)[fieldName];
    } else if (msg === 'SYS_STATUS' || msg === 'BATTERY_STATUS') {
      rawVal = (telemetry.battery as any)[targetKey] ?? (telemetry.battery as any)[fieldName];
    } else if (msg === 'GPS_RAW_INT') {
      rawVal = (telemetry.gps as any)[targetKey] ?? (telemetry.gps as any)[fieldName];
    } else if (msg === 'HEARTBEAT') {
      rawVal = (telemetry.heartbeat as any)[targetKey] ?? (telemetry.heartbeat as any)[fieldName];
    }

    if (rawVal === undefined || rawVal === null) return '--';

    if (typeof rawVal === 'number') {
      const transformed = rawVal * multiplier;
      return decimals !== undefined ? transformed.toFixed(decimals) : transformed;
    }

    return rawVal;
  };

  const sysId = telemetry.heartbeat.systemId || 1;
  const compId = telemetry.heartbeat.componentId || 1;

  const executeAction = () => {
    if (!definition.action) return;
    const encoder = mavlinkConnection.getEncoder();
    const cmd = encoder.createCommandLong(
      sysId,
      compId,
      definition.action.commandId,
      definition.action.params
    );
    mavlinkConnection.send(cmd);
    setLastActionTime(Date.now());
  };

  const handleTriggerAction = () => {
    if (!definition.action) return;
    if (definition.action.confirmation && !isConfirming) {
      setIsConfirming(true);
      return;
    }
    setIsConfirming(false);
    executeAction();
  };

  const handleToggle = () => {
    const next = !toggleState;
    setToggleState(next);
    if (definition.action) {
      // param1 often toggles 0/1 in ArduPilot relay/servo commands
      const params = [...definition.action.params] as [number, number, number, number, number, number, number];
      params[0] = next ? 1 : 0;
      const encoder = mavlinkConnection.getEncoder();
      const cmd = encoder.createCommandLong(sysId, compId, definition.action.commandId, params);
      mavlinkConnection.send(cmd);
    }
  };

  const boundValue = extractBoundValue();
  const unit = definition.binding?.unit ?? '';
  const min = definition.binding?.min ?? 0;
  const max = definition.binding?.max ?? 100;
  const numVal = typeof boundValue === 'string' ? parseFloat(boundValue) : boundValue;

  const pct = !isNaN(numVal as number) && max > min
    ? Math.max(0, Math.min(100, (((numVal as number) - min) / (max - min)) * 100))
    : 0;

  return (
    <Card className="border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="py-2.5 px-4 bg-zinc-900/60 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-sky-400" />
            {definition.name}
          </CardTitle>
          <Badge variant="secondary" className="text-[9px] font-mono capitalize">
            {definition.category}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-3">
        {/* Render according to displayType */}
        {definition.displayType === 'stat-card' && (
          <div className="text-center py-2">
            <div className="text-3xl font-mono font-bold text-zinc-100">
              {boundValue} <span className="text-sm font-normal text-zinc-400">{unit}</span>
            </div>
            {definition.description && (
              <p className="text-[11px] text-zinc-500 mt-1">{definition.description}</p>
            )}
          </div>
        )}

        {definition.displayType === 'gauge-radial' && (
          <div className="flex flex-col items-center justify-center py-2">
            <div className="relative w-28 h-28 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  className="stroke-zinc-800"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  className="stroke-sky-500 transition-all duration-300"
                  strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 38}
                  strokeDashoffset={2 * Math.PI * 38 * (1 - pct / 100)}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center font-mono">
                <span className="text-xl font-bold text-zinc-100">{boundValue}</span>
                <span className="text-[10px] text-zinc-400">{unit}</span>
              </div>
            </div>
            <div className="flex justify-between w-full px-4 text-[10px] text-zinc-500 font-mono mt-1">
              <span>{min} {unit}</span>
              <span>{max} {unit}</span>
            </div>
          </div>
        )}

        {definition.displayType === 'gauge-linear' && (
          <div className="space-y-2">
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-2xl font-bold text-zinc-100">
                {boundValue} <span className="text-xs font-normal text-zinc-400">{unit}</span>
              </span>
              <span className="text-[10px] text-zinc-500">{min} - {max} {unit}</span>
            </div>
            <div className="w-full bg-zinc-900 h-2.5 rounded-full overflow-hidden border border-zinc-800">
              <div
                className="h-full bg-sky-500 transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {definition.displayType === 'slider-control' && (
          <div className="space-y-3 py-1">
            <div className="flex justify-between items-baseline font-mono">
              <span className="text-xs text-zinc-400">Control Target</span>
              <span className="text-lg font-bold text-zinc-100">
                {sliderVal} <span className="text-xs text-zinc-400">{unit}</span>
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={(max - min) / 100 || 1}
              value={sliderVal}
              onChange={(e) => setSliderVal(Number(e.target.value))}
              onPointerUp={() => {
                if (definition.action) {
                  const params = [...definition.action.params] as [number, number, number, number, number, number, number];
                  params[0] = sliderVal;
                  const encoder = mavlinkConnection.getEncoder();
                  const cmd = encoder.createCommandLong(sysId, compId, definition.action.commandId, params);
                  mavlinkConnection.send(cmd);
                  setLastActionTime(Date.now());
                }
              }}
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
              <span>{min} {unit}</span>
              <span>{max} {unit}</span>
            </div>
          </div>
        )}

        {definition.displayType === 'indicator-led' && (
          <div className="flex items-center gap-3 py-2">
            <div
              className={`h-5 w-5 rounded-full border shadow-lg ${
                Number(boundValue) > 0
                  ? 'bg-emerald-400 border-emerald-300 shadow-emerald-500/50 animate-pulse'
                  : 'bg-zinc-800 border-zinc-700'
              }`}
            />
            <div>
              <span className="text-sm font-bold text-zinc-200">
                {Number(boundValue) > 0 ? 'ACTIVE / HIGH' : 'INACTIVE / LOW'}
              </span>
              <span className="text-[10px] text-zinc-500 block font-mono">
                Value: {boundValue}
              </span>
            </div>
          </div>
        )}

        {definition.displayType === 'action-button' && (
          <div className="space-y-2 py-1">
            {isConfirming ? (
              <div className="space-y-1.5">
                <Button
                  variant="destructive"
                  className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 animate-pulse"
                  onClick={handleTriggerAction}
                >
                  <AlertTriangle className="h-4 w-4" />
                  Confirm: {definition.action?.label || 'Execute'}?
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs text-zinc-400 h-7"
                  onClick={() => setIsConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="default"
                className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold gap-2"
                onClick={handleTriggerAction}
              >
                <Play className="h-4 w-4" />
                {definition.action?.label || 'Execute Action'}
              </Button>
            )}
            {lastActionTime && (
              <p className="text-[10px] text-emerald-400 text-center font-mono">
                Command dispatched at {new Date(lastActionTime).toLocaleTimeString()}
              </p>
            )}
          </div>
        )}

        {definition.displayType === 'toggle-switch' && (
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-xs font-bold text-zinc-200 block">Switch State</span>
              <span className="text-[10px] text-zinc-500 font-mono">
                {toggleState ? 'ENGAGED (1)' : 'DISENGAGED (0)'}
              </span>
            </div>
            <button
              onClick={handleToggle}
              className={`p-1 rounded-lg border transition-all ${
                toggleState ? 'border-sky-500 bg-sky-950/60 text-sky-400' : 'border-zinc-800 bg-zinc-900 text-zinc-500'
              }`}
            >
              {toggleState ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
            </button>
          </div>
        )}

        {definition.displayType === 'text-display' && (
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 font-mono text-xs text-zinc-300">
            {definition.description || 'Raw output'}: <b className="text-sky-400">{boundValue}</b>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
