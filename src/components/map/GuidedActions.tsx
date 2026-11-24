// Guided actions while flying (mavlink/guidedActions.ts builds the commands):
// - the map header's altitude button: change altitude (Copter, Plane), and set home to the vehicle's position;
// - in the Fly-to card, for the point picked: orbit it (Plane) and set home there.
// Each says what it will do before it does it, and anything that moves home or takes the vehicle out of its mode
// asks for a second press naming the consequence.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Home, Orbit, RotateCcw, RotateCw } from 'lucide-react';
import { useTelemetryStore, sendTrackedCommand } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { getVehicleCategory } from '../../mavlink/messages';
import { canChangeAltitude, canOrbit, changeAltitude, orbit, setHome, type CommandIntSpec } from '../../mavlink/guidedActions';
import { useLengthUnit, wholeLength } from '../../lib/inputUnits';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { terrainService } from '../../mavlink/terrainBoot';
import { useLastVehicleStore } from '../../store/lastVehicleStore';
import { describeAck, type AckView } from '../widgets/custom/panelModel';
import { AckChip } from '../widgets/custom/panelKit';
import { distanceM } from '../../mavlink/fenceDraft';

function useSender() {
  const [ack, setAck] = useState<AckView | null>(null);
  const send = (spec: CommandIntSpec, onAccepted?: () => void) => {
    const hb = useTelemetryStore.getState().heartbeat;
    const packet = mavlinkConnection.getEncoder().createCommandInt(hb.systemId, hb.componentId || 1, spec.command, spec.frame, spec.params);
    setAck({ status: 'pending', text: 'Sent, awaiting acknowledgement', time: Date.now() });
    void sendTrackedCommand(packet, { label: spec.label }).then((info) => {
      setAck(describeAck(info));
      if (info.result === 0) onAccepted?.();
    });
  };
  return { ack, send };
}

const BTN = 'flex h-7 w-full items-center justify-center gap-1.5 rounded-md border text-[11px] font-bold';
const CONFIRM = 'border-amber-500 bg-amber-600 text-zinc-950';
const PLAIN = 'border-zinc-600 text-zinc-200 hover:bg-zinc-800';
const FIELD = 'h-7 w-16 rounded border border-zinc-700 bg-zinc-900 text-center font-mono text-xs text-zinc-100 focus:border-sky-500 focus:outline-none';

/** Set home to the vehicle's position: confirmed first (RTL and relative altitudes move with it). */
const SetHomeHereButton: React.FC = () => {
  const confirm = useConfirmStep(6000);
  const { ack, send } = useSender();
  return (
    <div className="space-y-1">
      {confirm.armed && <p className="text-[10px] leading-snug text-amber-300">Home moves to where the vehicle is now: RTL returns there, and heights above home are measured from it.</p>}
      <button
        type="button"
        className={`${BTN} ${confirm.armed ? CONFIRM : PLAIN}`}
        onClick={() => {
          if (!confirm.armed) return confirm.arm();
          confirm.cancel();
          send(setHome(null));
        }}
      >
        <Home className="h-3.5 w-3.5" />
        {confirm.armed ? 'Confirm: set home here' : 'Set home to vehicle position'}
      </button>
      <AckChip ack={ack} />
    </div>
  );
};

/**
 * The map header's altitude button: a card to change the vehicle's altitude (Copter, Plane) and to set home to its
 * position. `target` is the Fly-to target being flown to, if any (Copter keeps going there at the new height).
 */
export const AltitudeAction: React.FC<{ target: { lat: number; lon: number } | null; disabled: boolean }> = ({ target, disabled }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const len = useLengthUnit();
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);
  const type = useTelemetryStore((s) => s.heartbeat.type);
  const modeName = useTelemetryStore((s) => s.heartbeat.modeName);
  const category = getVehicleCategory(type);
  const [input, setInput] = useState('');
  const confirm = useConfirmStep(6000);
  const { ack, send } = useSender();

  useEffect(() => {
    if (!open) return;
    // Opened: start from the current height above home.
    const rel = useTelemetryStore.getState().position.relativeAlt || 0;
    setInput(String(Math.max(1, Math.round(len.fromSi(rel)))));
    confirm.cancel();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const typed = Number(input);
  const altM = input.trim() !== '' && Number.isFinite(typed) ? len.toSi(typed) : NaN;
  // Copter keeps going to the Fly-to target while it is in GUIDED; otherwise it holds where it is.
  const pos = useTelemetryStore((s) => s.position);
  const here = pos.lat || pos.lon ? { lat: pos.lat, lon: pos.lon, isTarget: false } : null;
  const holdAt = modeName === 'GUIDED' && target ? { ...target, isTarget: true } : here;
  const plan = canChangeAltitude(category) ? changeAltitude(category, modeName, altM, holdAt, (m) => formatAltitude(m).full) : null;

  const go = () => {
    if (!plan) return;
    if (plan.switchesToGuided && !confirm.armed) return confirm.arm();
    confirm.cancel();
    send(plan.spec);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={disabled ? 'Connect to a vehicle (not while planning)' : 'Change altitude · set home'}
        className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${open ? 'border-sky-400 bg-sky-500 text-white' : 'border-zinc-700 text-sky-300 hover:bg-zinc-800'} disabled:opacity-40`}
      >
        <ArrowUpDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-[1000] w-60 space-y-2 rounded-lg border border-sky-500/40 bg-zinc-950/95 p-2.5 text-xs shadow-2xl backdrop-blur-md">
          {canChangeAltitude(category) ? (
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                go();
              }}
            >
              <div className="flex items-center gap-1.5">
                <label htmlFor="guided-alt" className="mr-auto font-bold text-zinc-200">
                  Altitude
                </label>
                <input id="guided-alt" inputMode="decimal" value={input} onChange={(e) => { setInput(e.target.value); confirm.cancel(); }} className={FIELD} />
                <span className="text-[10px] text-zinc-500">{len.unit} above home</span>
              </div>
              {plan && <p className={`text-[10px] leading-snug ${plan.switchesToGuided ? 'text-amber-300' : 'text-zinc-400'}`}>{plan.note}</p>}
              <button type="submit" disabled={!plan} className={`${BTN} ${confirm.armed ? CONFIRM : 'border-sky-600 bg-sky-600 text-white hover:bg-sky-500'} disabled:opacity-40`}>
                <ArrowUpDown className="h-3.5 w-3.5" />
                {confirm.armed ? 'Confirm: switch to GUIDED' : plan?.switchesToGuided ? 'Switch to GUIDED & change altitude' : 'Change altitude'}
              </button>
              <AckChip ack={ack} />
            </form>
          ) : (
            <p className="text-[10px] leading-snug text-zinc-500">No altitude change for this vehicle.</p>
          )}
          <div className="border-t border-zinc-800 pt-2">
            <SetHomeHereButton />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * For the point picked in the Fly-to card: orbit it (Plane), at the card's altitude, and set home there. Home's
 * altitude is the ground's at the point (terrain tiles); without it, home keeps its current altitude, and the
 * confirmation says so.
 */
export const PointGuidedActions: React.FC<{ lat: number; lon: number; altRelM: number; onDone: () => void }> = ({ lat, lon, altRelM, onDone }) => {
  const category = getVehicleCategory(useTelemetryStore((s) => s.heartbeat.type));
  const home = useTelemetryStore((s) => s.homePosition);
  const len = useLengthUnit();
  const formatAltitude = useUnitsStore((s) => s.formatAltitude);
  const formatDistance = useUnitsStore((s) => s.formatDistance);
  const loiterRad = useLastVehicleStore((s) => s.params.WP_LOITER_RAD);
  const [radius, setRadius] = useState(() => String(Math.round(len.fromSi(Math.abs(loiterRad ?? 60) || 60))));
  const [ccw, setCcw] = useState(false);
  const orbitSend = useSender();
  const homeSend = useSender();
  const homeConfirm = useConfirmStep(8000);
  // The ground's height at the point, looked up when home is about to be set there.
  const [ground, setGround] = useState<number | null | 'loading'>(null);
  useEffect(() => {
    if (!homeConfirm.armed) return;
    let live = true;
    setGround('loading');
    void terrainService.heightAt(lat, lon).then((h) => live && setGround(h));
    return () => {
      live = false;
    };
  }, [homeConfirm.armed, lat, lon]);

  const radiusM = len.toSi(Number(radius));
  const orbitSpec = canOrbit(category) ? orbit(lat, lon, altRelM, radiusM, ccw, (m) => wholeLength(m, len)) : null;
  const homeKnown = home.lat !== 0 || home.lon !== 0;
  const groundM = typeof ground === 'number' ? ground : null;
  const homeAlt = groundM ?? home.alt;
  const moved = homeKnown ? distanceM({ lat: home.lat, lon: home.lon }, { lat, lon }) : null;
  const dAlt = homeKnown && groundM !== null ? groundM - home.alt : null;

  return (
    <div className="space-y-1.5 border-t border-zinc-800 pt-1.5">
      {canOrbit(category) && (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <span className="mr-auto text-[10px] text-zinc-400">Orbit radius</span>
            <input
              aria-label="Orbit radius"
              inputMode="decimal"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              // Inside the Fly-to form: Enter here must not send "Fly here".
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              className={FIELD}
            />
            <span className="text-[10px] text-zinc-500">{len.unit}</span>
            <button
              type="button"
              onClick={() => setCcw((v) => !v)}
              title={ccw ? 'Counter-clockwise (click for clockwise)' : 'Clockwise (click for counter-clockwise)'}
              aria-label={ccw ? 'Counter-clockwise' : 'Clockwise'}
              className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            >
              {ccw ? <RotateCcw className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button type="button" disabled={!orbitSpec} onClick={() => orbitSpec && orbitSend.send(orbitSpec, () => setTimeout(onDone, 600))} className={`${BTN} ${PLAIN} disabled:opacity-40`}>
            <Orbit className="h-3.5 w-3.5" />
            Orbit here ({ccw ? 'CCW' : 'CW'})
          </button>
          <AckChip ack={orbitSend.ack} />
        </div>
      )}
      <div className="space-y-1">
        {homeConfirm.armed && (
          <p className="text-[10px] leading-snug text-amber-300">
            {ground === 'loading'
              ? 'Looking up the ground height here…'
              : `Home moves ${moved !== null ? `${formatDistance(moved).full.toLowerCase()} ` : ''}to this point${
                  dAlt !== null ? `, ground ${formatAltitude(Math.abs(dAlt)).full} ${dAlt >= 0 ? 'higher' : 'lower'}` : ''
                }: RTL returns here, and heights above home are measured from it.${
                  groundM === null ? ` No terrain height here: home keeps its altitude (${formatAltitude(home.alt).full} MSL).` : ''
                }`}
          </p>
        )}
        <button
          type="button"
          disabled={homeConfirm.armed && ground === 'loading'}
          onClick={() => {
            if (!homeConfirm.armed) return homeConfirm.arm();
            homeConfirm.cancel();
            homeSend.send(setHome({ lat, lon, altMslM: homeAlt }), () => setTimeout(onDone, 600));
          }}
          className={`${BTN} ${homeConfirm.armed ? CONFIRM : PLAIN} disabled:opacity-60`}
        >
          <Home className="h-3.5 w-3.5" />
          {homeConfirm.armed ? 'Confirm: set home here' : 'Set home here'}
        </button>
        <AckChip ack={homeSend.ack} />
      </div>
    </div>
  );
};
