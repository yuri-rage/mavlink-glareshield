// Several vehicles on one link: the picker (which one the app commands), the offer to take over another when the
// active one falls silent, and the confirmation of a switch. See mavlink/vehicleRoster.ts for the rules.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, Radio } from 'lucide-react';
import {
  dismissTakeoverOffer,
  requestVehicleSwitch,
  switchToVehicle,
  useVehicleRosterStore,
  SILENT_MS,
  type RosterVehicle,
} from '../../mavlink/vehicleRoster';
import { getVehicleCategoryLabel } from '../../mavlink/messages';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { missionManager } from '../../mavlink/missionManager';
import { paramManager } from '../../mavlink/paramManager';
import { logManager } from '../../mavlink/logManager';
import { Button } from '../ui/button';
import { isAnyDirty, useMissionPlanStore } from '../../store/missionPlanStore';

/** Re-render every second while `on` (ages of last contact); idle otherwise. */
function useTick(on: boolean, ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

/** One line about a listed vehicle: type, mode, armed, height, battery, last heard. */
export function vehicleSummary(v: RosterVehicle, now: number, imperial: boolean): string {
  const parts = [getVehicleCategoryLabel(v.type), v.modeName, v.armed ? 'ARMED' : 'disarmed'];
  if (v.relAlt !== undefined) parts.push(imperial ? `${Math.round(v.relAlt * 3.28084)} ft` : `${Math.round(v.relAlt)} m`);
  if (v.battery !== undefined) parts.push(`${v.battery}%`);
  const quiet = now - v.lastHeard;
  if (quiet > 3000) parts.push(`heard ${age(quiet)} ago`);
  return parts.join(' · ');
}

/** The navbar chip: which vehicle is commanded, and a menu of the others (shown once more than one is heard). */
export const VehiclePicker: React.FC = () => {
  const vehicles = useVehicleRosterStore((s) => s.vehicles);
  const active = useVehicleRosterStore((s) => s.activeSystemId);
  const imperial = useUnitsStore((s) => s.system === 'mph' || s.system === 'kts');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The menu shows ages; the chip itself doesn't.
  useTick(open);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const list = Object.values(vehicles).sort((a, b) => a.sysId - b.sysId);
  if (list.length < 2 || active === null) return null;
  const now = Date.now();
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`h-7 px-2 rounded-lg border text-xs font-mono font-bold flex items-center gap-1 ${
          open ? 'border-sky-400 bg-sky-950/80 text-sky-200' : 'border-violet-500/60 bg-violet-950/50 text-violet-200 hover:brightness-110'
        }`}
        title={`Commanding vehicle ${active} of ${list.length} on the link: click to switch`}
        aria-label={`Vehicle ${active}: switch vehicle`}
      >
        <Radio className="h-3.5 w-3.5" />
        SYS {active}
        <span className="font-sans font-normal text-violet-300/80">/{list.length}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-72 rounded-xl bg-zinc-900/95 border border-zinc-700/80 shadow-2xl backdrop-blur-md p-2 z-50">
          <div className="px-2 pb-1.5 mb-1.5 border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Vehicles on the link</div>
          {list.map((v) => {
            const isActive = v.sysId === active;
            const silent = now - v.lastHeard > SILENT_MS;
            return (
              <button
                key={v.sysId}
                type="button"
                disabled={isActive}
                onClick={() => {
                  setOpen(false);
                  requestVehicleSwitch(v.sysId);
                }}
                className={`w-full text-left rounded-lg px-2 py-1.5 text-xs flex flex-col gap-0.5 ${isActive ? 'bg-sky-500/15 cursor-default' : 'hover:bg-zinc-800'}`}
              >
                <span className="flex items-center justify-between">
                  <span className={`font-mono font-bold ${isActive ? 'text-sky-300' : 'text-zinc-200'}`}>SYS {v.sysId}</span>
                  <span className={`text-[10px] font-bold ${isActive ? 'text-sky-300' : silent ? 'text-red-300' : 'text-zinc-500'}`}>
                    {isActive ? 'COMMANDING' : silent ? 'SILENT' : 'switch to'}
                  </span>
                </span>
                <span className={`text-[11px] ${v.armed ? 'text-amber-200' : 'text-zinc-400'}`}>{vehicleSummary(v, now, imperial)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** The active vehicle is silent and another is heard (after both were heard together): offer, never take over. */
export const TakeoverBanner: React.FC = () => {
  const offer = useVehicleRosterStore((s) => s.takeoverOffer);
  const active = useVehicleRosterStore((s) => s.activeSystemId);
  const vehicles = useVehicleRosterStore((s) => s.vehicles);
  useTick(offer !== null);
  if (offer === null || active === null) return null;
  const old = vehicles[active];
  const other = vehicles[offer];
  return (
    <div role="alert" className="bg-violet-950/90 border-t border-violet-500/60 px-3 sm:px-6 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-violet-100">
      <span className="flex items-center gap-2 min-w-0">
        <ArrowLeftRight className="h-4 w-4 text-violet-300 shrink-0" />
        <span>
          <strong>Vehicle {active}</strong> silent{old ? ` for ${age(Date.now() - old.lastHeard)}` : ''}; <strong>vehicle {offer}</strong> is on the link
          {other ? ` (${other.modeName}${other.armed ? ', ARMED' : ''})` : ''}. The controls still command vehicle {active}.
        </span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <Button size="sm" variant="outline" className="h-6 px-2.5 text-[11px] font-bold border-violet-400/60 bg-violet-900/50 text-white hover:bg-violet-800" onClick={() => requestVehicleSwitch(offer)}>
          Switch to {offer}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-violet-200" onClick={dismissTakeoverOffer}>
          Keep waiting
        </Button>
      </span>
    </div>
  );
};

/** What a switch from the active vehicle would leave or stop: none, and the switch happens without asking. */
function switchConsequences(): string[] {
  const out: string[] = [];
  const hb = useTelemetryStore.getState().heartbeat;
  if (hb.isArmed) out.push(`Vehicle ${hb.systemId} is ARMED (${hb.modeName}). It carries on in that mode, with nothing from here commanding it.`);
  const m = missionManager.getStatus();
  if (m.isUploading) out.push('A mission upload is under way: it stops, and the old vehicle may hold part of it.');
  else if (m.isFetching) out.push('A mission download is under way: it stops.');
  if (paramManager.getStatus().isFetching) out.push('The parameter download stops.');
  if (logManager.busy) out.push('The log transfer (list or download) stops.');
  for (const b of useVehicleRosterStore.getState().busy) out.push(`${b}: stops.`);
  const plan = useMissionPlanStore.getState();
  if (plan.active) {
    out.push(
      `Planning is open${isAnyDirty(plan) ? ' with changes not uploaded' : ''}: the plan stays open, and Upload would send it to the vehicle you switch to.`
    );
  }
  return out;
}

/** Confirms a requested switch when something is at stake (armed, a transfer under way); otherwise switches. */
export const VehicleSwitchDialog: React.FC = () => {
  const pending = useVehicleRosterStore((s) => s.pendingSwitch);
  const active = useVehicleRosterStore((s) => s.activeSystemId);
  const target = useVehicleRosterStore((s) => (s.pendingSwitch !== null ? s.vehicles[s.pendingSwitch] : undefined));
  const imperial = useUnitsStore((s) => s.system === 'mph' || s.system === 'kts');
  const [reasons, setReasons] = useState<string[] | null>(null);
  useEffect(() => {
    if (pending === null) {
      setReasons(null);
      return;
    }
    const r = switchConsequences();
    if (r.length === 0) switchToVehicle(pending);
    else setReasons(r);
  }, [pending]);
  useEffect(() => {
    if (pending === null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useVehicleRosterStore.setState({ pendingSwitch: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);
  if (pending === null || !reasons) return null;
  const cancel = () => useVehicleRosterStore.setState({ pendingSwitch: null });
  return (
    <div className="fixed inset-0 z-[1100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Switch vehicle">
      <div className="bg-zinc-950 border border-amber-500/50 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="px-4 py-3 bg-amber-950/40 border-b border-amber-500/30 text-sm font-bold text-amber-200 flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4" />
          Switch from vehicle {active} to vehicle {pending}?
        </div>
        <div className="p-4 space-y-2 text-xs text-zinc-300">
          <ul className="list-disc pl-4 space-y-1">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {target && (
            <p className="text-zinc-400">
              Vehicle {pending}: {vehicleSummary(target, Date.now(), imperial)}.
            </p>
          )}
          <p className="text-zinc-400">
            Every control then commands vehicle {pending}. Its parameters and home are read afresh; download its mission to
            see it.
          </p>
        </div>
        <div className="px-4 py-3 bg-zinc-900 border-t border-zinc-800 flex justify-end gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={cancel}>
            Stay on vehicle {active}
          </Button>
          <Button size="sm" className="h-8 text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white" onClick={() => switchToVehicle(pending)}>
            Switch to vehicle {pending}
          </Button>
        </div>
      </div>
    </div>
  );
};
