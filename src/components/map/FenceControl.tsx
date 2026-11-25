// The vehicle's fence switch (MAV_CMD_DO_FENCE_ENABLE): a status chip over the map (FENCE ON / OFF / BREACH) that
// opens the controls, and the same controls inline in the planning Fence panel.
//
// Enabling checks the vehicle against everything that would be enforced (zones, home circle, altitude limits). Armed
// and outside, the fence action fires the moment it is on: allowed, after a second confirmation that names the
// action. Disabling while armed takes one confirmation saying what is lost. The only refusal is when there's nothing
// to enable, which the vehicle would refuse too. Changes last until reboot; FENCE_ENABLE (at boot) is unchanged.

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Shield, ShieldAlert, ShieldOff } from 'lucide-react';

import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { mavlinkConnection } from '../../mavlink/connection';
import {
  FENCE_TYPE_ALT_MIN,
  fenceEnableBreaches,
  fenceTypeNames,
  MAV_CMD_DO_FENCE_ENABLE,
  vehicleFenceState,
  type FenceState,
} from '../../mavlink/fenceControl';
import { FENCE_PARAMS, fenceActionText, fenceDraftFromPoints } from '../../mavlink/fenceDraft';
import { getVehicleCategory, MAVLINK_MSG_ID } from '../../mavlink/messages';
import { paramManager } from '../../mavlink/paramManager';
import { messageRateManager } from '../../mavlink/rateManager';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { AckChip } from '../widgets/custom/panelKit';
import { describeAck, type AckView } from '../widgets/custom/panelModel';

const EXTRA_PARAMS = ['FENCE_RADIUS', 'FENCE_ALT_MAX', 'FENCE_ALT_MIN'];

/** The fence's state, kept current (FENCE_STATUS goes stale on its own, so this re-checks every second). */
function useFenceState(): FenceState & { connected: boolean } {
  const sensorsPresent = useTelemetryStore((s) => s.sysStatus.sensorsPresent);
  const sensorsEnabled = useTelemetryStore((s) => s.sysStatus.sensorsEnabled);
  const sensorsHealth = useTelemetryStore((s) => s.sysStatus.sensorsHealth);
  const fenceStatusAt = useTelemetryStore((s) => s.fenceStatus.receivedAt);
  const fenceStatusBreached = useTelemetryStore((s) => s.fenceStatus.breached);
  const fenceType = useTelemetryStore((s) => s.parameters['FENCE_TYPE']?.value);
  const fenceAction = useTelemetryStore((s) => s.parameters['FENCE_ACTION']?.value);
  const hasZones = useTelemetryStore((s) => s.fencePoints.some((p) => p.command !== 5000));
  const connected = useTelemetryStore(
    (s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED'
  );
  const [nowMs, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // The checks need the fence parameters, which aren't downloaded unless asked for.
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId);
  useEffect(() => {
    if (connected && sysId > 0)
      [...FENCE_PARAMS, ...EXTRA_PARAMS].forEach((p) => paramManager.requestParam(sysId, compId || 1, p));
  }, [connected, sysId, compId]);
  // FENCE_STATUS isn't in every vehicle's default streams: ask for it while the fence is shown.
  const owner = `fence-control-${useId()}`; // each instance its own, so closing the popover keeps the chip's
  useEffect(() => {
    messageRateManager.registerRequirement(owner, MAVLINK_MSG_ID.FENCE_STATUS);
    return () => messageRateManager.unregisterRequirement(owner, MAVLINK_MSG_ID.FENCE_STATUS);
  }, [owner]);
  const st = vehicleFenceState({
    sensorsPresent,
    sensorsEnabled,
    sensorsHealth,
    fenceStatusAt,
    fenceStatusBreached,
    nowMs,
    fenceType,
    fenceAction,
    hasZones,
  });
  return { ...st, connected };
}

/** The controls: state, what's enforced, Enable / Disable (with their confirmations), the vehicle's answer. */
export const FenceControlBody: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const fs = useFenceState();
  const armed = useTelemetryStore((s) => s.heartbeat.isArmed);
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const sysId = useTelemetryStore((s) => s.heartbeat.systemId);
  const compId = useTelemetryStore((s) => s.heartbeat.componentId);
  const fencePoints = useTelemetryStore((s) => s.fencePoints);
  const lat = useTelemetryStore((s) => s.position.lat);
  const lon = useTelemetryStore((s) => s.position.lon);
  const relAlt = useTelemetryStore((s) => s.position.relativeAlt);
  const homeKnown = useTelemetryStore((s) => s.homePosition.source !== 'none');
  const homeDistance = useTelemetryStore((s) => s.homePosition.distanceM);
  const breachCount = useTelemetryStore((s) => s.fenceStatus.breachCount);
  const fenceRadius = useTelemetryStore((s) => s.parameters['FENCE_RADIUS']?.value);
  const altMax = useTelemetryStore((s) => s.parameters['FENCE_ALT_MAX']?.value);
  const altMin = useTelemetryStore((s) => s.parameters['FENCE_ALT_MIN']?.value);
  const fenceAction = useTelemetryStore((s) => s.parameters['FENCE_ACTION']?.value);
  const fenceEnableParam = useTelemetryStore((s) => s.parameters['FENCE_ENABLE']?.value);
  const fenceOptions = useTelemetryStore((s) => s.parameters['FENCE_OPTIONS']?.value);

  const action = fenceActionText(getVehicleCategory(vehicleType), fenceAction);
  const positionKnown = Number.isFinite(lat) && !(lat === 0 && lon === 0);
  const fence = useMemo(() => fenceDraftFromPoints(fencePoints), [fencePoints]);
  const breaches = fenceEnableBreaches({
    types: fs.types,
    fence,
    position: positionKnown ? { lat, lon } : null,
    relAlt: positionKnown && homeKnown ? relAlt : null,
    homeDistanceM: homeKnown ? homeDistance : null,
    fenceRadius,
    altMax,
    altMin,
    inclusionUnion: fenceOptions !== undefined ? (Math.round(fenceOptions) & 2) !== 0 : undefined,
  });
  const fires = armed && breaches.length > 0 && !fs.reportOnly && action !== null;

  const enable1 = useConfirmStep(6000);
  const enable2 = useConfirmStep(6000);
  const disable = useConfirmStep(6000);
  const [ack, setAck] = useState<AckView | null>(null);
  const send = (param1: number, label: string) => {
    enable1.cancel();
    enable2.cancel();
    disable.cancel();
    setAck({ status: 'pending', text: 'Sent, awaiting acknowledgement', time: Date.now() });
    const packet = mavlinkConnection
      .getEncoder()
      .createCommandLong(sysId, compId || 1, MAV_CMD_DO_FENCE_ENABLE, [param1, 0, 0, 0, 0, 0, 0]);
    void sendTrackedCommand(packet, { label }).then((info) => {
      const view = describeAck(info);
      // ArduPilot answers FAILED when there's nothing to enable.
      if (info.result === 4 && param1 === 1) view.text = 'Refused: no fence to enable (none loaded or configured)';
      setAck(view);
    });
  };

  const isOn = fs.state === 'on' || fs.state === 'breach';
  const nothing = fs.state === 'none';
  const onEnable = () => {
    if (fires) {
      if (!enable1.armed && !enable2.armed) return enable1.arm();
      if (enable1.armed) {
        enable1.cancel();
        return enable2.arm();
      }
    }
    send(1, 'Fence: enable');
  };
  const onDisable = () => {
    if (armed && !disable.armed) return disable.arm();
    send(0, 'Fence: disable');
  };

  const BTN =
    'inline-flex h-7 flex-1 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-40';
  const stateText =
    fs.state === 'breach'
      ? 'BREACHED'
      : fs.state === 'on'
        ? 'ON'
        : fs.state === 'off'
          ? 'OFF'
          : fs.state === 'none'
            ? 'nothing to enforce'
            : 'unknown';
  return (
    <div className={`space-y-1.5 text-[11px] ${compact ? '' : 'w-64'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-zinc-200">Fence</span>
        <span
          className={`font-mono font-bold ${fs.state === 'breach' ? 'text-red-400' : isOn ? 'text-emerald-300' : 'text-zinc-400'}`}
        >
          {stateText}
        </span>
      </div>
      <div className="space-y-0.5 text-[10px] leading-snug text-zinc-400">
        <div>
          Enforces: {fs.types ? fenceTypeNames(fs.types).join(', ') : 'nothing (upload a fence, or set FENCE_TYPE)'}
          {fs.reportOnly ? ' · report only' : action ? ` · on breach: ${action}` : ''}
        </div>
        {isOn && breachCount > 0 && <div>Breaches this flight: {breachCount}</div>}
        <div className="text-zinc-500">
          Until reboot; at boot the fence is{' '}
          {fenceEnableParam === undefined
            ? '(FENCE_ENABLE unknown)'
            : Math.round(fenceEnableParam) === 1
              ? 'on'
              : 'off'}{' '}
          (FENCE_ENABLE).
        </div>
      </div>

      {!isOn && breaches.length > 0 && (
        <div
          className={`rounded border px-1.5 py-1 text-[10px] leading-snug ${fires ? 'border-red-500/60 bg-red-950/50 text-red-200' : 'border-amber-500/40 bg-amber-950/40 text-amber-200'}`}
        >
          The vehicle is {breaches.join(' and ')}.{' '}
          {fires
            ? `Armed: enabling breaches at once and the vehicle will ${action}${getVehicleCategory(vehicleType) === 'copter' ? ' (on the ground, it disarms)' : ''}.`
            : armed
              ? 'The fence would report it (report only).'
              : 'With the fence on it will fail its pre-arm check here.'}
        </div>
      )}
      {disable.armed && (
        <div className="rounded border border-amber-500/50 bg-amber-950/50 px-1.5 py-1 text-[10px] leading-snug text-amber-200">
          Armed: the fence stops protecting the vehicle. An action it already took (e.g. RTL) carries on until you
          change mode.
        </div>
      )}

      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={!fs.connected || nothing || isOn}
          title={
            nothing
              ? 'Nothing to enforce: upload a fence, or configure FENCE_TYPE altitude or circle limits'
              : isOn
                ? 'The fence is on'
                : 'Enable the fence now'
          }
          onClick={onEnable}
          className={`${BTN} ${enable1.armed || enable2.armed ? 'border-red-500 bg-red-600 text-white' : 'border-emerald-700/70 text-emerald-300 hover:bg-emerald-950/50'}`}
        >
          <Shield className="h-3.5 w-3.5" />
          {enable2.armed
            ? `Confirm again: it will ${action} now`
            : enable1.armed
              ? `Enable: it will ${action}`
              : 'Enable'}
        </button>
        <button
          type="button"
          disabled={!fs.connected || !isOn}
          onClick={onDisable}
          title={isOn ? 'Disable the fence now' : 'The fence is off'}
          className={`${BTN} ${disable.armed ? 'border-amber-500 bg-amber-600 text-zinc-950' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'}`}
        >
          <ShieldOff className="h-3.5 w-3.5" />
          {disable.armed ? 'Confirm disable' : 'Disable'}
        </button>
      </div>
      {isOn && (fs.types & FENCE_TYPE_ALT_MIN) !== 0 && (
        <button
          type="button"
          onClick={() => send(2, 'Fence: disable floor')}
          title="Disable only the minimum-altitude fence (e.g. to land)"
          className="w-full rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-300 hover:bg-zinc-800"
        >
          Disable the floor only (FENCE_ALT_MIN)
        </button>
      )}
      <AckChip ack={ack} />
    </div>
  );
};

/** The chip over the map: the fence's state at a glance; click for the controls. */
export const FenceChip: React.FC = () => {
  const fs = useFenceState();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!fs.connected) return null;
  const breach = fs.state === 'breach';
  const on = fs.state === 'on' || breach;
  const Icon = breach ? ShieldAlert : on ? Shield : ShieldOff;
  const label = breach
    ? 'FENCE BREACH'
    : on
      ? 'FENCE ON'
      : fs.state === 'none'
        ? 'NO FENCE'
        : fs.state === 'unknown'
          ? 'FENCE ?'
          : 'FENCE OFF';
  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${label}: fence controls`}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 font-mono text-[10px] font-bold shadow-md ${
          breach
            ? 'animate-pulse border-red-500 bg-red-600 text-white'
            : on
              ? 'border-emerald-600/60 bg-zinc-950/90 text-emerald-300'
              : 'border-zinc-700 bg-zinc-950/90 text-zinc-400'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-[470] rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-xl backdrop-blur-sm">
          <FenceControlBody />
        </div>
      )}
    </div>
  );
};
