// The gimbal over the map: a GIMBAL chip (only while a gimbal is enabled) opening its controls (pitch and yaw, quick
// forward / straight down, follow the vehicle or hold the heading, neutral, retract, stop pointing at a target), and
// "Point camera here" for the map's right-click card. Pointing at a place on Copter with a gimbal that can't pan turns
// the vehicle to face it: that asks first, naming it.

import React, { useEffect, useRef, useState } from 'react';

import { Camera, Crosshair } from 'lucide-react';

import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { mavlinkConnection } from '../../mavlink/connection';
import {
  forwardYaw,
  GIMBAL_CAP,
  gimbalLimits,
  MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW,
  MAV_CMD_DO_SET_ROI_LOCATION,
  MAV_CMD_DO_SET_ROI_NONE,
  pitchYawParams,
  roiTurnsVehicle,
} from '../../mavlink/gimbal';
import { getVehicleCategory } from '../../mavlink/messages';
import { gimbalEnabled, useGimbalStore } from '../../store/gimbalStore';
import { useReplaying } from '../../store/replayStore';
import { sendTrackedCommand, useTelemetryStore } from '../../store/telemetryStore';
import { AckChip } from '../widgets/custom/panelKit';
import { describeAck, type AckView } from '../widgets/custom/panelModel';

function useSender() {
  const [ack, setAck] = useState<AckView | null>(null);
  const send = (packet: Uint8Array, label: string, onAccepted?: () => void) => {
    setAck({ status: 'pending', text: 'Sent, awaiting acknowledgment', time: Date.now() });
    void sendTrackedCommand(packet, { label }).then((info) => {
      setAck(describeAck(info));
      if (info.result === 0) onAccepted?.();
    });
  };
  return { ack, send };
}

const target = () => {
  const hb = useTelemetryStore.getState().heartbeat;
  return { sys: hb.systemId, comp: hb.componentId || 1 };
};
const deviceId = () => useGimbalStore.getState().info?.deviceId ?? 1;

/** A gimbal is enabled now (re-checked every second, as attitude reports age). */
export function useGimbalEnabled(): boolean {
  const mountTypes = useGimbalStore((s) => s.mountTypes);
  const info = useGimbalStore((s) => s.info);
  const attitude = useGimbalStore((s) => s.attitude);
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const replaying = useReplaying();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // Not while replaying a log: there is no live gimbal to point.
  return linked && !replaying && gimbalEnabled({ mountTypes, info, attitude }, now);
}

export const GimbalControlBody: React.FC = () => {
  const info = useGimbalStore((s) => s.info);
  const attitude = useGimbalStore((s) => s.attitude);
  const yawLock = useGimbalStore((s) => s.yawLock);
  const roi = useGimbalStore((s) => s.roi);
  const { ack, send } = useSender();
  const canYaw = info ? (info.capFlags & GIMBAL_CAP.HAS_YAW_AXIS) !== 0 : true;
  // Finite limits (NaN means unknown or unbounded); with yaw lock, yaw is a true heading over the whole circle.
  const { pitchMin, pitchMax, yawMin, yawMax } = gimbalLimits(info, yawLock === true);
  const [pitch, setPitch] = useState(() => Math.round(attitude?.pitch ?? 0));
  const [yaw, setYaw] = useState(() => (canYaw ? Math.round(attitude && !attitude.earthFrame ? attitude.yaw : 0) : 0));
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // Angles, neutral and retract take the gimbal off a target it was pointing at (ArduPilot leaves GPS-point mode):
  // forget the target once the vehicle accepts. Changing only the yaw lock doesn't.
  const clearRoi = () => useGimbalStore.getState().set({ roi: null });
  const point = (p: number, y: number, label: string) => {
    const { sys, comp } = target();
    const params = pitchYawParams({
      deviceId: deviceId(),
      pitchDeg: clamp(p, pitchMin, pitchMax),
      yawDeg: canYaw ? clamp(y, yawMin, yawMax) : 0,
      yawLock: yawLock ?? false,
    });
    send(
      mavlinkConnection.getEncoder().createCommandLong(sys, comp, MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW, params),
      label,
      clearRoi
    );
  };
  /** Forward / Down: along the vehicle (with yaw lock that's the vehicle's true heading, not north). */
  const alongVehicle = (p: number, label: string) => {
    const y = forwardYaw(yawLock === true, useTelemetryStore.getState().attitude.yawDeg);
    setPitch(p);
    setYaw(Math.round(y));
    point(p, y, label);
  };
  const mode = (o: { retract?: boolean; neutral?: boolean; yawLock?: boolean }, label: string) => {
    const { sys, comp } = target();
    const leavesTarget = Boolean(o.retract || o.neutral);
    send(
      mavlinkConnection
        .getEncoder()
        .createCommandLong(
          sys,
          comp,
          MAV_CMD_DO_GIMBAL_MANAGER_PITCHYAW,
          pitchYawParams({ deviceId: deviceId(), ...o })
        ),
      label,
      leavesTarget ? clearRoi : undefined
    );
  };
  const stopRoi = () => {
    const { sys, comp } = target();
    send(
      mavlinkConnection
        .getEncoder()
        .createCommandLong(sys, comp, MAV_CMD_DO_SET_ROI_NONE, [deviceId(), 0, 0, 0, 0, 0, 0]),
      'Gimbal: stop pointing',
      () => useGimbalStore.getState().set({ roi: null })
    );
  };

  const BTN =
    'rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-bold text-zinc-200 hover:bg-zinc-800 disabled:opacity-40';
  const has = (f: number) => !info || (info.capFlags & f) !== 0;
  return (
    <div className="w-64 space-y-2 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="font-bold text-zinc-200">Gimbal</span>
        <span className="font-mono text-[10px] text-zinc-400">
          {attitude
            ? // Near straight up or down, yaw from the attitude is meaningless (gimbal lock): don't show a number.
              `pitch ${Math.round(attitude.pitch)}° · yaw ${Math.abs(attitude.pitch) > 85 ? '—' : `${Math.round(attitude.yaw)}°${attitude.earthFrame ? ' (true)' : ''}`}`
            : 'no attitude yet'}
        </span>
      </div>
      <label className="block space-y-0.5">
        <span className="flex justify-between text-[10px] text-zinc-400">
          <span>Pitch</span>
          <span className="font-mono">{pitch}°</span>
        </span>
        <input
          type="range"
          min={Math.round(pitchMin)}
          max={Math.round(pitchMax)}
          step={1}
          value={pitch}
          onChange={(e) => setPitch(Number(e.target.value))}
          className="w-full accent-sky-500"
          aria-label="Pitch"
        />
      </label>
      <label className="block space-y-0.5">
        <span className="flex justify-between text-[10px] text-zinc-400">
          <span>Yaw {yawLock ? '(true heading, held)' : '(relative to the vehicle)'}</span>
          <span className="font-mono">{canYaw ? `${yaw}°` : 'no pan'}</span>
        </span>
        <input
          type="range"
          disabled={!canYaw}
          min={Math.round(yawMin)}
          max={Math.round(yawMax)}
          step={1}
          value={yaw}
          onChange={(e) => setYaw(Number(e.target.value))}
          className="w-full accent-sky-500 disabled:opacity-40"
          aria-label="Yaw"
        />
      </label>
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          className={`${BTN} col-span-3 border-sky-700 text-sky-300`}
          onClick={() => point(pitch, yaw, `Gimbal: pitch ${pitch}°, yaw ${yaw}°`)}
        >
          Point
        </button>
        <button type="button" className={BTN} onClick={() => alongVehicle(0, 'Gimbal: forward')}>
          Forward
        </button>
        <button
          type="button"
          className={BTN}
          disabled={pitchMin > -89}
          title={pitchMin > -89 ? `Pitch limit is ${Math.round(pitchMin)}°` : 'Straight down'}
          onClick={() => alongVehicle(-90, 'Gimbal: down')}
        >
          Down
        </button>
        <button
          type="button"
          className={BTN}
          disabled={!has(GIMBAL_CAP.HAS_NEUTRAL)}
          onClick={() => mode({ neutral: true }, 'Gimbal: neutral')}
        >
          Neutral
        </button>
      </div>
      <div className="flex items-center justify-between gap-1">
        <div
          className="grid flex-1 grid-cols-2 gap-0.5 rounded-md border border-zinc-800 bg-zinc-900 p-0.5"
          role="radiogroup"
          aria-label="Gimbal yaw"
        >
          {[false, true].map((lock) => (
            <button
              key={String(lock)}
              type="button"
              role="radio"
              aria-checked={yawLock === lock}
              disabled={!canYaw}
              onClick={() => mode({ yawLock: lock }, `Gimbal: ${lock ? 'hold heading' : 'follow vehicle'}`)}
              title={lock ? 'Hold the true heading as the vehicle turns' : 'Turn with the vehicle'}
              className={`rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40 ${yawLock === lock ? 'bg-sky-500/20 font-medium text-sky-300' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {lock ? 'Hold heading' : 'Follow'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={BTN}
          disabled={!has(GIMBAL_CAP.HAS_RETRACT)}
          onClick={() => mode({ retract: true }, 'Gimbal: retract')}
        >
          Retract
        </button>
      </div>
      {roi && (
        <button type="button" className={`${BTN} w-full border-amber-600/60 text-amber-300`} onClick={stopRoi}>
          Stop pointing at the target
        </button>
      )}
      <p className="text-[10px] leading-snug text-zinc-500">
        Right-click the map to point the camera at a place. RC gimbal input takes over when moved.
      </p>
      <AckChip ack={ack} />
    </div>
  );
};

/** For the map's right-click card: point the camera at the place (asks first when the vehicle would turn to it). */
export const PointCameraButton: React.FC<{ lat: number; lon: number; onDone: () => void }> = ({ lat, lon, onDone }) => {
  const enabled = useGimbalEnabled();
  const info = useGimbalStore((s) => s.info);
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const confirm = useConfirmStep(6000);
  const { ack, send } = useSender();
  if (!enabled) return null;
  const turns = roiTurnsVehicle(getVehicleCategory(vehicleType), info?.capFlags ?? null);
  const go = () => {
    if (turns && !confirm.armed) return confirm.arm();
    confirm.cancel();
    const { sys, comp } = target();
    // COMMAND_INT, height 0 above home: the place on the ground (taken as home's height).
    const packet = mavlinkConnection
      .getEncoder()
      .createCommandInt(sys, comp, MAV_CMD_DO_SET_ROI_LOCATION, 3, [deviceId(), 0, 0, 0, lat * 1e7, lon * 1e7, 0]);
    send(packet, 'Gimbal: point here', () => {
      useGimbalStore.getState().set({ roi: { lat, lon } });
      setTimeout(onDone, 600);
    });
  };
  return (
    <div className="space-y-1">
      {confirm.armed && (
        <p className="text-[10px] leading-snug text-amber-300">
          The gimbal can&apos;t pan: the vehicle will turn to face this point.
        </p>
      )}
      <button
        type="button"
        onClick={go}
        className={`flex h-7 w-full items-center justify-center gap-1.5 rounded-md border text-[11px] font-bold ${
          confirm.armed
            ? 'border-amber-500 bg-amber-600 text-zinc-950'
            : 'border-zinc-600 text-zinc-200 hover:bg-zinc-800'
        }`}
      >
        <Crosshair className="h-3.5 w-3.5" />
        {confirm.armed ? 'Confirm: turn and point here' : 'Point camera here'}
      </button>
      <AckChip ack={ack} />
    </div>
  );
};

/** The chip over the map, only while a gimbal is enabled. */
export const GimbalChip: React.FC = () => {
  const enabled = useGimbalEnabled();
  const roi = useGimbalStore((s) => s.roi);
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
  if (!enabled) return null;
  return (
    <div ref={ref} className="pointer-events-auto relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Gimbal controls"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 font-mono text-[10px] font-bold shadow-md ${
          roi ? 'border-amber-500/60 bg-zinc-950/90 text-amber-300' : 'border-sky-600/60 bg-zinc-950/90 text-sky-300'
        }`}
      >
        <Camera className="h-3.5 w-3.5" />
        {roi ? 'GIMBAL · TARGET' : 'GIMBAL'}
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-[470] rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-xl backdrop-blur-sm">
          <GimbalControlBody />
        </div>
      )}
    </div>
  );
};
