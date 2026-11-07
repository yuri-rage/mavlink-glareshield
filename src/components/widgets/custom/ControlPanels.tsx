// Custom widget panels that act on the vehicle: command buttons, toggles, sliders and parameter setters.
// Each panel owns its confirmation and acknowledgement state, so several can share a card independently.

import React, { useEffect, useRef, useState } from 'react';
import { useTelemetryStore } from '../../../store/telemetryStore';
import { mavlinkConnection } from '../../../mavlink/connection';
import { paramManager } from '../../../mavlink/paramManager';
import { getMavCmdName, getVehicleCategory } from '../../../mavlink/messages';
import { Button } from '../../ui/button';
import { AlertTriangle, Check, Play, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  effectiveParamControl,
  feedbackBinding,
  feedbackThreshold,
  followsRelayStatus,
  relayInstance,
  sliderParams,
  toggleParams,
} from './panelModel';
import { getCachedField } from '../../../lib/messageCache';
import { extractBit } from '../../../lib/widgetValues';
import { AckChip, useCommandSender, useVehicleTarget, type PanelProps } from './panelKit';
import { SlideToConfirm } from './SlideToConfirm';
import { getParamMetadata } from '../../../mavlink/paramMetadata';
import { useParamMetaStore } from '../../../store/paramMetaStore';

export const ActionButtonPanel: React.FC<PanelProps> = ({ def, scheme }) => {
  const { sysId, compId } = useVehicleTarget();
  const { ack, send } = useCommandSender();
  const [isConfirming, setIsConfirming] = useState(false);

  const trigger = () => {
    if (!def.action) return;
    if (def.action.confirmation && !isConfirming) {
      setIsConfirming(true);
      return;
    }
    setIsConfirming(false);
    const cmd = mavlinkConnection.getEncoder().createCommandLong(sysId, compId, def.action.commandId, def.action.params);
    send(cmd, def.action.label || def.name);
  };

  return (
    <div className="space-y-2 py-1">
      {isConfirming ? (
        <div className="space-y-1.5">
          <Button variant="destructive" className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold gap-2 text-xs" onClick={trigger}>
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">
              Confirm: {def.action?.label || 'Execute'}
              {def.action ? ` — ${getMavCmdName(def.action.commandId)}` : ''}?
            </span>
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs text-zinc-400 h-7" onClick={() => setIsConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="default" className={`w-full ${scheme.button} text-white font-bold gap-2`} onClick={trigger}>
          <Play className="h-4 w-4" />
          {def.action?.label || 'Execute Action'}
        </Button>
      )}
      <AckChip ack={ack} />
    </div>
  );
};

export const TogglePanel: React.FC<PanelProps> = ({ def, feedback, scheme }) => {
  const { sysId, compId } = useVehicleTarget();
  const { ack, send } = useCommandSender();
  const [lastSent, setLastSent] = useState(false);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');

  const fbBinding = feedbackBinding(def);
  const threshold = feedbackThreshold(def);
  // A relay toggle follows RELAY_STATUS, unless the vehicle reports that relay as not configured.
  const relay = followsRelayStatus(def) ? relayInstance(def) : undefined;
  const presentMask = relay !== undefined && feedback && !feedback.stale ? getCachedField('RELAY_STATUS', 'present') : undefined;
  const relayMissing = relay !== undefined && presentMask !== undefined && extractBit(presentMask, relay) === 0;
  /** Vehicle-reported switch state when there is a feedback field, otherwise what was last sent. */
  const feedbackOn =
    feedback && feedback.base !== null && !feedback.stale && !relayMissing ? feedback.base > threshold : null;
  const switchOn = feedbackOn ?? lastSent;
  const hasFeedback = Boolean(fbBinding);
  const feedbackText =
    relay !== undefined ? `${fbBinding?.label} ${feedbackOn ? 'ON' : 'OFF'}` : `${fbBinding?.fieldName} ${feedback?.text}`;
  // With confirmation on, the switch is a slide-to-confirm control (like the arming slider): the slide itself is
  // the deliberate action, so there is no separate confirm step.
  const slide = Boolean(def.action?.confirmation);

  const execute = (next: boolean) => {
    const previous = switchOn;
    setLastSent(next);
    if (!def.action) return;
    const params = toggleParams(def.action.commandId, def.action.params, next);
    const cmd = mavlinkConnection.getEncoder().createCommandLong(sysId, compId, def.action.commandId, params);
    // Rejected or unanswered: the switch didn't move, so don't show it as if it had.
    send(cmd, `${def.action.label || def.name}: ${next ? 'ON' : 'OFF'}`, (status) => {
      if (status === 'rejected') setLastSent(previous);
    });
  };

  const commandName = def.action ? getMavCmdName(def.action.commandId) : '';

  // Laid out top-down with the slider pinned to the bottom, so side-by-side toggles line up however long their
  // status text runs (or while one shows an acknowledgement).
  return (
    <div className="flex-1 flex flex-col gap-2 py-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-bold text-zinc-200 block">{feedbackOn !== null ? 'Vehicle State' : 'Switch State'}</span>
          <span className="text-[10px] text-zinc-500 font-mono">
            <span className={switchOn ? 'text-amber-300 font-bold' : ''}>{switchOn ? 'ENGAGED' : 'DISENGAGED'}</span>
            {feedbackOn !== null
              ? ` · ${feedbackText}`
              : relayMissing
                ? ` · ${fbBinding?.label} not configured (last sent)`
                : hasFeedback
                  ? ' · no feedback yet (last sent)'
                  : ' · last sent'}
          </span>
        </div>
        {!slide && (
          <button
            onClick={() => execute(!switchOn)}
            className={`p-1 rounded-lg border transition-all shrink-0 ${switchOn ? scheme.toggleActive : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}
            aria-pressed={switchOn}
            aria-label={`${def.name}: ${switchOn ? 'on' : 'off'}`}
          >
            {switchOn ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
          </button>
        )}
        {slide && commandName && <span className="text-[10px] text-zinc-500 font-mono truncate shrink-0">{commandName}</span>}
      </div>
      <AckChip ack={ack} />
      {slide && (
        <div className="mt-auto">
          <SlideToConfirm
            label={!linked ? 'NO LINK — Locked' : switchOn ? 'Slide to DISENGAGE' : 'Slide to ENGAGE'}
            onConfirm={() => execute(!switchOn)}
            disabled={!linked}
            toneClass={
              switchOn ? 'accent-amber-500 bg-amber-950/40 border-amber-800/60' : 'accent-emerald-500 bg-emerald-950/40 border-emerald-800/60'
            }
            ariaLabel={`${def.name}: ${switchOn ? 'on, slide right to turn off' : 'off, slide right to turn on'}`}
          />
        </div>
      )}
    </div>
  );
};

export const SliderPanel: React.FC<PanelProps> = ({ def, scheme }) => {
  const { sysId, compId } = useVehicleTarget();
  const { ack, send } = useCommandSender();
  const sMin = def.binding?.min ?? 0;
  const sMax = def.binding?.max ?? 100;
  const sUnit = def.binding?.unit ?? '';
  const [value, setValue] = useState<number>(sMin);
  const [isConfirming, setIsConfirming] = useState(false);

  const execute = (val: number) => {
    if (def.action) {
      const params = sliderParams(def.action.commandId, def.action.params, val);
      const cmd = mavlinkConnection.getEncoder().createCommandLong(sysId, compId, def.action.commandId, params);
      send(cmd, `${def.action.label || def.name}: ${val}`);
    }
    setIsConfirming(false);
  };

  return (
    <div className="space-y-3 py-1">
      <div className="flex justify-between items-baseline font-mono">
        <span className="text-xs text-zinc-400">Control Target</span>
        <span className="text-lg font-bold text-zinc-100">
          {value} <span className="text-xs text-zinc-400">{sUnit}</span>
        </span>
      </div>
      <input
        type="range"
        min={sMin}
        max={sMax}
        step={(sMax - sMin) / 100 || 1}
        value={value}
        onChange={(e) => {
          setValue(Number(e.target.value));
          if (def.action?.confirmation) setIsConfirming(true);
        }}
        onPointerUp={() => {
          if (!def.action?.confirmation) execute(value);
        }}
        className={`w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer ${scheme.accent}`}
      />
      <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
        <span>
          {sMin} {sUnit}
        </span>
        <span>
          {sMax} {sUnit}
        </span>
      </div>
      {def.action?.confirmation && isConfirming && (
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="destructive"
            className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-7 gap-1"
            onClick={() => execute(value)}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Apply: {value} {sUnit}
              {def.action ? ` — ${getMavCmdName(def.action.commandId)}` : ''}
            </span>
          </Button>
          <Button size="sm" variant="outline" className="text-xs text-zinc-400 h-7" onClick={() => setIsConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}
      <AckChip ack={ack} />
    </div>
  );
};

type ParamStatus = { type: 'info' | 'success' | 'error'; text: string } | null;

export const ParamPanel: React.FC<PanelProps> = ({ def, scheme }) => {
  const { sysId, compId } = useVehicleTarget();
  const paramId = def.paramControl?.paramId?.trim().toUpperCase() || 'WPNAV_SPEED';
  const paramEntry = useTelemetryStore((s) => s.parameters[paramId]);
  const heartbeatType = useTelemetryStore((s) => s.heartbeat.type);
  const firmwareVersion = useTelemetryStore((s) => s.firmwareVersion);
  // Anything the widget doesn't set comes from the vehicle's parameter metadata (range, step, units, named
  // values), so a panel only needs the parameter's name. Load the metadata if it hasn't been yet, and re-read
  // when it arrives.
  const ensureMeta = useParamMetaStore((s) => s.ensure);
  useParamMetaStore((s) => s.catalog);
  useEffect(() => {
    ensureMeta(getVehicleCategory(heartbeatType), firmwareVersion);
  }, [heartbeatType, firmwareVersion, ensureMeta]);
  const meta = getParamMetadata(paramId);
  const control = effectiveParamControl(def.paramControl, meta);

  const [input, setInput] = useState<string>('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmingOutOfBounds, setIsConfirmingOutOfBounds] = useState(false);
  const [status, setStatus] = useState<ParamStatus>(null);
  const pendingWriteRef = useRef<{ value: number; time: number } | null>(null);

  const requestParam = () => paramManager.requestParam(sysId, compId, paramId);

  // Ask the vehicle for the parameter if it hasn't been loaded.
  useEffect(() => {
    if (paramEntry === undefined) requestParam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramId, paramEntry]);

  // Fill the input once the vehicle's value arrives.
  useEffect(() => {
    if (paramEntry !== undefined && input === '') setInput(String(Number(paramEntry.value.toFixed(4))));
  }, [paramEntry, input]);

  // A write is confirmed when the vehicle echoes the new value.
  useEffect(() => {
    if (pendingWriteRef.current && paramEntry !== undefined) {
      if (Math.abs(paramEntry.value - pendingWriteRef.current.value) < 0.0001) {
        setStatus({
          type: 'success',
          text: `✓ Confirmed on vehicle: ${paramId} = ${Number(paramEntry.value.toFixed(4))} at ${new Date().toLocaleTimeString()}`,
        });
        pendingWriteRef.current = null;
      }
    }
  }, [paramEntry, paramId]);

  // No echo within 4 s: report it.
  useEffect(() => {
    if (!status || status.type !== 'info') return;
    const timer = setTimeout(() => {
      if (pendingWriteRef.current) {
        setStatus({ type: 'error', text: `No confirmation echo received for ${paramId}. Autopilot may have rejected value or timed out.` });
        pendingWriteRef.current = null;
      }
    }, 4000);
    return () => clearTimeout(timer);
  }, [status, paramId]);

  const isOutOfBounds = (num: number) =>
    (control?.min !== undefined && num < control.min) || (control?.max !== undefined && num > control.max);

  const write = (val: number) => {
    // Refuse to write until the parameter's real type is known.
    if (paramEntry === undefined || paramEntry.type === undefined) {
      requestParam();
      setStatus({ type: 'error', text: `Cannot write: parameter type for ${paramId} is unknown. Requesting from autopilot...` });
      setIsConfirming(false);
      setIsConfirmingOutOfBounds(false);
      return;
    }
    const encoder = mavlinkConnection.getEncoder();
    mavlinkConnection.send(encoder.createParamSet(sysId, compId, paramId, val, paramEntry.type));
    pendingWriteRef.current = { value: val, time: Date.now() };
    setStatus({ type: 'info', text: `PARAM_SET sent for ${paramId} = ${val}... awaiting vehicle confirmation echo` });
    setIsConfirming(false);
    setIsConfirmingOutOfBounds(false);
  };

  const initiate = () => {
    const num = parseFloat(input);
    if (isNaN(num)) return;
    if (control?.confirmation) {
      setIsConfirming(true);
      setIsConfirmingOutOfBounds(false);
    } else if (isOutOfBounds(num)) {
      // Out-of-bounds writes need explicit confirmation even when normal confirmation is off.
      setIsConfirmingOutOfBounds(true);
      setIsConfirming(false);
    } else {
      write(num);
    }
  };

  const onInputChange = (value: string) => {
    setInput(value);
    if (isConfirming) setIsConfirming(false);
    if (isConfirmingOutOfBounds) setIsConfirmingOutOfBounds(false);
  };

  return (
    <div className="space-y-2.5 py-1">
      <div className="flex items-center justify-between text-xs font-mono">
        <div>
          <span className="text-zinc-400 block text-[10px]">PARAMETER ID</span>
          <span className="font-bold text-sky-400" title={meta?.description}>{paramId}</span>
          {meta?.displayName && <span className="block text-[10px] text-zinc-500 font-sans">{meta.displayName}</span>}
        </div>
        <div className="text-right flex items-center gap-1.5">
          <div>
            <span className="text-zinc-400 block text-[10px]">LIVE VALUE</span>
            <div className="flex items-baseline justify-end gap-1 font-bold text-zinc-100">
              <span>{paramEntry !== undefined ? Number(paramEntry.value.toFixed(4)) : 'Not loaded'}</span>
              {control?.unit && <span className="text-[10px] text-zinc-400 font-normal">{control.unit}</span>}
              {paramEntry?.defaultValue !== undefined && (
                <span
                  className={`text-[9.5px] font-mono font-normal ml-1 ${
                    Math.abs(paramEntry.value - paramEntry.defaultValue) > 1e-6 ? 'text-amber-300' : 'text-zinc-500'
                  }`}
                  title={`Default: ${paramEntry.defaultValue}`}
                >
                  (def: {Number(paramEntry.defaultValue.toFixed(4))})
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={requestParam}
            title="Read parameter from autopilot"
            className="p-1.5 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {control?.options && control.options.length > 0 ? (
        <div className="flex items-center gap-2">
          <select
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            className="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-xs font-mono text-zinc-100"
          >
            {input !== '' && !control.options.some((opt) => String(opt.value) === input) && <option value={input}>{input} (not in list)</option>}
            {control.options.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
          <Button size="sm" className={`h-8 text-xs font-bold gap-1 ${scheme.button} text-white`} onClick={initiate}>
            <Check className="h-3.5 w-3.5" />
            Set
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            step={control?.step ?? 'any'}
            min={control?.min}
            max={control?.max}
            value={input}
            placeholder={paramEntry !== undefined ? String(paramEntry.value) : 'Enter value'}
            onChange={(e) => onInputChange(e.target.value)}
            className="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-mono text-zinc-100"
          />
          <Button size="sm" className={`h-8 text-xs font-bold gap-1 ${scheme.button} text-white`} onClick={initiate}>
            <Check className="h-3.5 w-3.5" />
            Apply
          </Button>
          {paramEntry?.defaultValue !== undefined &&
            Math.abs(paramEntry.value - paramEntry.defaultValue) > 1e-6 &&
            input !== String(Number(paramEntry.defaultValue.toFixed(4))) && (
              <button
                type="button"
                onClick={() => onInputChange(String(Number(paramEntry.defaultValue!.toFixed(4))))}
                className="h-8 px-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-amber-300 text-[10px] font-mono shrink-0"
                title={`Reset input to default: ${paramEntry.defaultValue}`}
              >
                Def
              </button>
            )}
        </div>
      )}

      {isConfirming && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-7 gap-1"
              onClick={() => {
                const num = parseFloat(input);
                if (isNaN(num)) return;
                if (isOutOfBounds(num)) {
                  // Second confirmation for an out-of-bounds write.
                  setIsConfirming(false);
                  setIsConfirmingOutOfBounds(true);
                } else {
                  write(num);
                }
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Write {paramId} = {input}?
            </Button>
            <Button size="sm" variant="outline" className="text-xs text-zinc-400 h-7" onClick={() => setIsConfirming(false)}>
              Cancel
            </Button>
          </div>
          {paramEntry === undefined && (
            <span className="text-red-400 block text-[10px] text-center font-mono">
              * Parameter type not yet loaded from autopilot. Will fetch type first.
            </span>
          )}
        </div>
      )}

      {isConfirmingOutOfBounds && (
        <div className="space-y-1.5 p-2 rounded-lg bg-amber-950/40 border border-amber-600/80">
          <div className="flex items-start gap-1.5 text-amber-200 text-[11px] font-mono leading-tight">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Out of Bounds:</strong> Value <span className="text-white font-bold">{input}</span> is outside recommended limits (
              {control?.min ?? '–∞'} to {control?.max ?? '+∞'}). Confirm force write?
            </span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Button
              size="sm"
              variant="destructive"
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-7 gap-1"
              onClick={() => {
                const num = parseFloat(input);
                if (!isNaN(num)) write(num);
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Force Write {paramId} = {input}
            </Button>
            <Button size="sm" variant="outline" className="text-xs text-zinc-400 h-7" onClick={() => setIsConfirmingOutOfBounds(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status && (
        <p
          className={`text-[10px] font-mono text-center px-1.5 py-0.5 rounded ${
            status.type === 'success'
              ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-800/40'
              : status.type === 'error'
                ? 'text-red-400 bg-red-950/40 border border-red-800/40'
                : 'text-amber-400 bg-amber-950/40 border border-amber-800/40 animate-pulse'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
};
