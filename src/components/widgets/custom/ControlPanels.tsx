// Custom widget panels that act on the vehicle: command buttons, toggles, sliders and parameter setters.
// Each panel owns its confirmation and acknowledgement state, so several can share a card independently.

import React, { useEffect, useRef, useState } from 'react';

import { AlertTriangle, Check, ListChecks, Play, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';

import { getCachedField } from '../../../lib/messageCache';
import { extractBit } from '../../../lib/widgetValues';
import { mavlinkConnection } from '../../../mavlink/connection';
import { getMavCmdName, getVehicleCategory } from '../../../mavlink/messages';
import { paramManager } from '../../../mavlink/paramManager';
import { formatParamValue, getParamMetadata } from '../../../mavlink/paramMetadata';
import { useParamMetaStore } from '../../../store/paramMetaStore';
import { useTelemetryStore } from '../../../store/telemetryStore';
import { Button } from '../../ui/button';
import { BitmaskEditor, DetailsButton, ParamDetails } from '../params/ParamEditors';
import { AckChip, useCommandSender, usePanelWidth, useVehicleTarget, type PanelProps } from './panelKit';
import {
  actionPacket,
  effectiveParamControl,
  feedbackBinding,
  feedbackThreshold,
  followsRelayStatus,
  relayInstance,
  sliderParams,
  toggleParams,
} from './panelModel';
import { SlideToConfirm } from './SlideToConfirm';

export const ActionButtonPanel: React.FC<PanelProps> = ({ def, scheme }) => {
  const { sysId, compId } = useVehicleTarget();
  const { ack, send, sendUnacknowledged } = useCommandSender();
  const [isConfirming, setIsConfirming] = useState(false);

  const trigger = () => {
    if (!def.action) return;
    if (def.action.confirmation && !isConfirming) {
      setIsConfirming(true);
      return;
    }
    setIsConfirming(false);
    const packet = actionPacket(mavlinkConnection.getEncoder(), sysId, compId, def.action, def.action.params);
    if (def.action.special === 'system-time') {
      // No acknowledgement comes for this message; ArduPilot uses it only without GPS time (RTC_TYPES).
      sendUnacknowledged(packet, 'not acknowledged; used only if the vehicle has no GPS time');
      return;
    }
    send(packet, def.action.label || def.name);
  };

  return (
    <div className="space-y-2 py-1">
      {isConfirming ? (
        <div className="space-y-1.5">
          <Button
            variant="destructive"
            className="w-full gap-2 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700"
            onClick={trigger}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">
              Confirm: {def.action?.label || 'Execute'}
              {def.action
                ? ` — ${def.action.special === 'system-time' ? 'SYSTEM_TIME' : getMavCmdName(def.action.commandId)}`
                : ''}
              ?
            </span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-xs text-zinc-400"
            onClick={() => setIsConfirming(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="default" className={`w-full ${scheme.button} gap-2 font-bold text-white`} onClick={trigger}>
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
  const presentMask =
    relay !== undefined && feedback && !feedback.stale ? getCachedField('RELAY_STATUS', 'present') : undefined;
  const relayMissing = relay !== undefined && presentMask !== undefined && extractBit(presentMask, relay) === 0;
  /** Vehicle-reported switch state when there is a feedback field, otherwise what was last sent. */
  const feedbackOn =
    feedback && feedback.base !== null && !feedback.stale && !relayMissing ? feedback.base > threshold : null;
  const switchOn = feedbackOn ?? lastSent;
  const hasFeedback = Boolean(fbBinding);
  const feedbackText =
    relay !== undefined
      ? `${fbBinding?.label} ${feedbackOn ? 'ON' : 'OFF'}`
      : `${fbBinding?.fieldName} ${feedback?.text}`;
  // With confirmation on, the switch is a slide-to-confirm control (like the arming slider): the slide itself is
  // the deliberate action, so there is no separate confirm step.
  const slide = Boolean(def.action?.confirmation);

  const execute = (next: boolean) => {
    const previous = switchOn;
    setLastSent(next);
    if (!def.action) return;
    const params = toggleParams(def.action.commandId, def.action.params, next);
    const cmd = actionPacket(mavlinkConnection.getEncoder(), sysId, compId, def.action, params);
    // Rejected or unanswered: the switch didn't move, so don't show it as if it had.
    send(cmd, `${def.action.label || def.name}: ${next ? 'ON' : 'OFF'}`, (status) => {
      if (status === 'rejected') setLastSent(previous);
    });
  };

  const commandName = def.action ? getMavCmdName(def.action.commandId) : '';

  // Laid out top-down with the slider pinned to the bottom, so side-by-side toggles line up however long their
  // status text runs (or while one shows an acknowledgement).
  return (
    <div className="flex flex-1 flex-col gap-2 py-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block text-xs font-bold text-zinc-200">
            {feedbackOn !== null ? 'Vehicle State' : 'Switch State'}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            <span className={switchOn ? 'font-bold text-amber-300' : ''}>{switchOn ? 'ENGAGED' : 'DISENGAGED'}</span>
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
            className={`shrink-0 rounded-lg border p-1 transition-all ${switchOn ? scheme.toggleActive : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}
            aria-pressed={switchOn}
            aria-label={`${def.name}: ${switchOn ? 'on' : 'off'}`}
          >
            {switchOn ? <ToggleRight className="h-6 w-6" /> : <ToggleLeft className="h-6 w-6" />}
          </button>
        )}
        {slide && commandName && (
          <span className="shrink-0 truncate font-mono text-[10px] text-zinc-500">{commandName}</span>
        )}
      </div>
      <AckChip ack={ack} />
      {slide && (
        <div className="mt-auto">
          <SlideToConfirm
            label={!linked ? 'NO LINK — Locked' : switchOn ? 'Slide to DISENGAGE' : 'Slide to ENGAGE'}
            onConfirm={() => execute(!switchOn)}
            disabled={!linked}
            toneClass={
              switchOn
                ? 'accent-amber-500 bg-amber-950/40 border-amber-800/60'
                : 'accent-emerald-500 bg-emerald-950/40 border-emerald-800/60'
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
      const cmd = actionPacket(mavlinkConnection.getEncoder(), sysId, compId, def.action, params);
      send(cmd, `${def.action.label || def.name}: ${val}`);
    }
    setIsConfirming(false);
  };

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-baseline justify-between font-mono">
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
        className={`h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 ${scheme.accent}`}
      />
      <div className="flex justify-between font-mono text-[10px] text-zinc-500">
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
            className="h-7 flex-1 gap-1 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700"
            onClick={() => execute(value)}
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Apply: {value} {sUnit}
              {def.action ? ` — ${getMavCmdName(def.action.commandId)}` : ''}
            </span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs text-zinc-400"
            onClick={() => setIsConfirming(false)}
          >
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
  const metaSummary = useParamMetaStore((s) => s.summary);
  useParamMetaStore((s) => s.catalog);
  useEffect(() => {
    ensureMeta(getVehicleCategory(heartbeatType), firmwareVersion);
  }, [heartbeatType, firmwareVersion, ensureMeta]);
  const meta = getParamMetadata(paramId);
  const control = effectiveParamControl(def.paramControl, meta);

  const [input, setInput] = useState<string>('');
  const [customNumeric, setCustomNumeric] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmingOutOfBounds, setIsConfirmingOutOfBounds] = useState(false);
  const [status, setStatus] = useState<ParamStatus>(null);
  const [detailsAnchor, setDetailsAnchor] = useState<HTMLElement | null>(null);
  const [bitmaskAnchor, setBitmaskAnchor] = useState<HTMLElement | null>(null);
  const pendingWriteRef = useRef<{ value: number; time: number } | null>(null);

  useEffect(() => {
    setCustomNumeric(false);
    setBitmaskAnchor(null);
  }, [paramId]);

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
        setStatus({
          type: 'error',
          text: `No confirmation echo received for ${paramId}. Autopilot may have rejected value or timed out.`,
        });
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
      setStatus({
        type: 'error',
        text: `Cannot write: parameter type for ${paramId} is unknown. Requesting from autopilot...`,
      });
      setIsConfirming(false);
      setIsConfirmingOutOfBounds(false);
      return;
    }
    const encoder = mavlinkConnection.getEncoder();
    mavlinkConnection.send(encoder.createParamSet(sysId, compId, paramId, val, paramEntry.type));
    pendingWriteRef.current = { value: val, time: Date.now() };
    setStatus({
      type: 'info',
      text: `PARAM_SET sent for ${paramId} = ${val}... awaiting vehicle confirmation echo`,
    });
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

  const { ref: containerRef, width } = usePanelWidth<HTMLDivElement>();
  const narrow = width !== null && width < 280;
  const defaultFormatted =
    paramEntry?.defaultValue !== undefined ? formatParamValue(paramEntry.defaultValue) : undefined;
  const isModifiedFromDefault =
    paramEntry?.defaultValue !== undefined && Math.abs(paramEntry.value - paramEntry.defaultValue) > 1e-6;
  const canResetToDefault =
    defaultFormatted !== undefined && (isModifiedFromDefault || (input !== '' && input !== defaultFormatted));

  return (
    <div ref={containerRef} className="space-y-2.5 py-1">
      <div className="flex items-start justify-between gap-2 font-mono text-xs">
        <div className="min-w-0 flex-1">
          <span className="block text-[10px] text-zinc-400">PARAMETER ID</span>
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate font-bold text-sky-400" title={meta?.description}>
              {paramId}
            </span>
            {meta && <DetailsButton name={paramId} onClick={(b) => setDetailsAnchor((cur) => (cur ? null : b))} />}
          </div>
          {meta?.displayName && (
            <span className="block truncate font-sans text-[10px] text-zinc-500">{meta.displayName}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3 text-right">
          <div>
            <span className="block text-[10px] text-zinc-400">LIVE VALUE</span>
            <div className="flex items-baseline justify-end gap-1 font-bold text-zinc-100">
              <span>{paramEntry !== undefined ? formatParamValue(paramEntry.value) : 'Not loaded'}</span>
              {control?.unit && <span className="text-[10px] font-normal text-zinc-400">{control.unit}</span>}
            </div>
            {narrow && defaultFormatted !== undefined && (
              <span
                className={`block font-mono text-[10px] ${isModifiedFromDefault ? 'text-amber-300' : 'text-zinc-500'}`}
                title={`Default: ${defaultFormatted}${control?.unit ? ` ${control.unit}` : ''}`}
              >
                ({defaultFormatted}
                {control?.unit ? ` ${control.unit}` : ''})
              </span>
            )}
          </div>
          {!narrow && defaultFormatted !== undefined && (
            <div>
              <span className="block text-[10px] text-zinc-400">DEFAULT</span>
              <div
                className={`flex items-baseline justify-end gap-1 font-bold ${isModifiedFromDefault ? 'text-amber-300' : 'text-zinc-400'}`}
                title={`Default: ${defaultFormatted}${control?.unit ? ` ${control.unit}` : ''}`}
              >
                <span>{defaultFormatted}</span>
                {control?.unit && <span className="text-[10px] font-normal text-zinc-500">{control.unit}</span>}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={requestParam}
            title="Read parameter from autopilot"
            className="rounded border border-zinc-800 bg-zinc-900 p-1.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {detailsAnchor && meta && (
        <ParamDetails
          name={paramId}
          meta={meta}
          anchor={detailsAnchor}
          onClose={() => setDetailsAnchor(null)}
          source={metaSummary}
          defaultValue={paramEntry?.defaultValue}
        />
      )}

      {control?.options && control.options.length > 0 && !customNumeric ? (
        <div className="flex items-center gap-2">
          <select
            value={input}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setCustomNumeric(true);
              } else {
                onInputChange(e.target.value);
              }
            }}
            className="h-8 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 font-mono text-xs text-zinc-100"
          >
            {input !== '' && !control.options.some((opt) => String(opt.value) === input) && (
              <option value={input}>{input} (not in list)</option>
            )}
            {control.options.map((opt) => (
              <option key={opt.value} value={String(opt.value)}>
                {opt.label} ({opt.value})
              </option>
            ))}
            <option value="__custom__">Other value…</option>
          </select>
          <Button size="sm" className={`h-8 gap-1 text-xs font-bold ${scheme.button} text-white`} onClick={initiate}>
            <Check className="h-3.5 w-3.5" />
            Set
          </Button>
          {canResetToDefault && (
            <button
              type="button"
              onClick={() => onInputChange(defaultFormatted!)}
              className="h-8 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-400 hover:text-amber-300"
              title={`Reset input to default: ${defaultFormatted}`}
            >
              Def
            </button>
          )}
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
            className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 font-mono text-xs text-zinc-100"
          />
          {meta?.bitmask && !control?.options?.length && (
            <button
              type="button"
              onClick={(e) => setBitmaskAnchor((cur) => (cur ? null : e.currentTarget))}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-300 hover:border-sky-500/60 hover:text-sky-300"
              title="Edit bitmask flags"
              aria-haspopup="dialog"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Bits
            </button>
          )}
          {control?.options && control.options.length > 0 && (
            <button
              type="button"
              onClick={() => setCustomNumeric(false)}
              className="h-8 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-400 hover:text-sky-300"
              title="Choose from named values list"
            >
              List
            </button>
          )}
          <Button size="sm" className={`h-8 gap-1 text-xs font-bold ${scheme.button} text-white`} onClick={initiate}>
            <Check className="h-3.5 w-3.5" />
            Apply
          </Button>
          {canResetToDefault && (
            <button
              type="button"
              onClick={() => onInputChange(defaultFormatted!)}
              className="h-8 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 font-mono text-[10px] text-zinc-400 hover:text-amber-300"
              title={`Reset input to default: ${defaultFormatted}`}
            >
              Def
            </button>
          )}
        </div>
      )}
      {bitmaskAnchor && meta?.bitmask && (
        <BitmaskEditor
          name={paramId}
          bitmask={meta.bitmask}
          value={Number.isFinite(parseFloat(input)) ? parseFloat(input) : (paramEntry?.value ?? 0)}
          original={paramEntry?.value ?? 0}
          anchor={bitmaskAnchor}
          onChange={(v) => onInputChange(String(v))}
          onSave={() => {
            setBitmaskAnchor(null);
            initiate();
          }}
          onCancel={() => setBitmaskAnchor(null)}
        />
      )}

      {isConfirming && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 flex-1 gap-1 bg-amber-600 text-xs font-bold text-white hover:bg-amber-700"
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
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-zinc-400"
              onClick={() => setIsConfirming(false)}
            >
              Cancel
            </Button>
          </div>
          {paramEntry === undefined && (
            <span className="block text-center font-mono text-[10px] text-red-400">
              * Parameter type not yet loaded from autopilot. Will fetch type first.
            </span>
          )}
        </div>
      )}

      {isConfirmingOutOfBounds && (
        <div className="space-y-1.5 rounded-lg border border-amber-600/80 bg-amber-950/40 p-2">
          <div className="flex items-start gap-1.5 font-mono text-[11px] leading-tight text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Out of Bounds:</strong> Value <span className="font-bold text-white">{input}</span> is outside
              recommended limits ({control?.min ?? '–∞'} to {control?.max ?? '+∞'}). Confirm force write?
            </span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Button
              size="sm"
              variant="destructive"
              className="h-7 flex-1 gap-1 bg-red-600 text-xs font-bold text-white hover:bg-red-700"
              onClick={() => {
                const num = parseFloat(input);
                if (!isNaN(num)) write(num);
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Force Write {paramId} = {input}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs text-zinc-400"
              onClick={() => setIsConfirmingOutOfBounds(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status && (
        <p
          className={`rounded px-1.5 py-0.5 text-center font-mono text-[10px] ${
            status.type === 'success'
              ? 'border border-emerald-800/40 bg-emerald-950/40 text-emerald-400'
              : status.type === 'error'
                ? 'border border-red-800/40 bg-red-950/40 text-red-400'
                : 'animate-pulse border border-amber-800/40 bg-amber-950/40 text-amber-400'
          }`}
        >
          {status.text}
        </p>
      )}
    </div>
  );
};
