// Confirms uploading a draft (the mission, the rally points or the fence): what it replaces, what changes, the
// draft's warnings, and the vehicle's state. Uploading while armed shows the in-flight warning. When the upload acts
// on the vehicle at once (the mission in AUTO, rally points during RTL, a fence that puts an armed vehicle with
// fencing on outside it) it needs a second confirmation that names the consequence. Never a hard block.

import React, { useEffect, useMemo } from 'react';
import { paramManager } from '../../mavlink/paramManager';
import { AlertTriangle, Upload } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { compareDrafts, validateDraft, type MissionDraft } from '../../mavlink/missionDraft';
import { compareRallyDrafts, validateRallyDraft, type RallyDraft } from '../../mavlink/rallyDraft';
import {
  FENCE_PARAMS,
  fenceActionText,
  fenceBreachReasons,
  fenceChanges,
  fencingState,
  validateFenceDraft,
  type FenceDraft,
} from '../../mavlink/fenceDraft';
import { getVehicleCategory } from '../../mavlink/messages';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTelemetryStore } from '../../store/telemetryStore';

interface VehicleState {
  vehicleType: number;
  armed: boolean;
  modeName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The dialog both uploads share. */
const UploadConfirm: React.FC<{
  title: string;
  description: string;
  draftCount: string;
  vehicleCount: string;
  /** What "no changes" refers to, e.g. "the vehicle's mission". */
  subject: string;
  changes: string[];
  issues: { label: string | null; severity: 'error' | 'warning'; message: string }[];
  armed: boolean;
  /** The vehicle is using what is being replaced right now: its warning text, and a second confirmation. */
  inUse: { heading: string; text: string } | null;
  armedText: string;
  secondLabel: string;
  readBackNote: string;
  /** Extra state shown under the counts (the fence's status). */
  status?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}> = (p) => {
  const second = useConfirmStep(6000);
  const errors = p.issues.filter((i) => i.severity === 'error');
  const ordered = [...errors, ...p.issues.filter((i) => i.severity === 'warning')];
  const listed = p.changes.slice(0, 6);

  const confirm = () => {
    if (p.inUse && !second.armed) return second.arm();
    second.cancel();
    p.onConfirm();
  };

  return (
    <Modal isOpen onClose={p.onCancel} title={p.title} description={p.description}>
      <div className="space-y-3 text-xs">
        {(p.armed || p.inUse) && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/70 bg-red-950/80 p-3 text-red-200 shadow-md">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <b className="mb-1 block font-bold text-red-300">
                VEHICLE IS {p.armed ? 'ARMED' : ''}
                {p.armed && p.inUse ? ' AND ' : ''}
                {p.inUse ? p.inUse.heading : ''}
              </b>
              {p.inUse ? p.inUse.text : p.armedText}
            </div>
          </div>
        )}

        <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="flex justify-between text-zinc-300">
            <span className="text-zinc-400">Draft</span>
            <span className="font-mono font-bold text-zinc-100">{p.draftCount}</span>
          </div>
          <div className="flex justify-between text-zinc-300">
            <span className="text-zinc-400">On the vehicle now</span>
            <span className="font-mono">{p.vehicleCount}</span>
          </div>
          <div className="border-t border-zinc-800/70 pt-1.5">
            <span className="text-zinc-400">{p.changes.length === 0 ? `No changes from ${p.subject}.` : `Changes (${p.changes.length}):`}</span>
            {listed.length > 0 && (
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-300">
                {listed.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
                {p.changes.length > listed.length && <li className="text-zinc-500">…and {p.changes.length - listed.length} more</li>}
              </ul>
            )}
          </div>
          {p.status && <div className="border-t border-zinc-800/70 pt-1.5">{p.status}</div>}
        </div>

        {ordered.length > 0 && (
          <ul className="space-y-1">
            {ordered.map((iss, i) => (
              <li key={i} className={`flex gap-1.5 ${iss.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {iss.label ? <b className="font-mono">{iss.label} </b> : null}
                  {iss.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-zinc-500">{p.readBackNote}</p>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-2">
          <Button variant="outline" size="sm" onClick={p.onCancel}>
            Cancel
          </Button>
          <Button
            variant={p.armed || p.inUse ? 'destructive' : 'default'}
            size="sm"
            className="gap-1.5 font-bold"
            disabled={errors.length > 0}
            onClick={confirm}
          >
            <Upload className="h-3.5 w-3.5" />
            {second.armed ? p.secondLabel : 'Upload'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

/** Uploading the mission draft. In AUTO, where the vehicle flies the mission being replaced, confirm twice. */
export const DraftUploadModal: React.FC<VehicleState & { vehicle: MissionDraft }> = ({ vehicle, vehicleType, armed, modeName, onConfirm, onCancel }) => {
  // The live draft: what this shows is what gets uploaded, even if it changes while the dialog is open.
  const draft = useMissionPlanStore((s) => s.history.present);
  const terrainIssues = useMissionTerrainStore((s) => s.issues);
  const issues = useMemo(() => [...validateDraft(draft, getVehicleCategory(vehicleType)), ...terrainIssues], [draft, vehicleType, terrainIssues]);
  const changes = useMemo(() => {
    const c = compareDrafts(vehicle, draft);
    return [...c.structural, ...c.params];
  }, [vehicle, draft]);
  return (
    <UploadConfirm
      title="Upload mission draft"
      description="Replaces the mission on the vehicle. Fence and rally points are not changed."
      draftCount={`${draft.items.length - 1} items`}
      vehicleCount={`${Math.max(0, vehicle.items.length - 1)} items`}
      subject="the vehicle’s mission"
      changes={changes}
      issues={issues.map((i) => ({ label: i.index >= 1 ? `#${i.index}` : null, severity: i.severity, message: i.message }))}
      armed={armed}
      inUse={
        modeName === 'AUTO'
          ? { heading: 'IN AUTO', text: 'The vehicle is flying its mission now. Uploading replaces it immediately: check which item it flies to next.' }
          : null
      }
      armedText="Uploading replaces the mission on an armed vehicle."
      secondLabel="Confirm again: replace the active mission"
      readBackNote="After uploading, the mission is read back from the vehicle and compared with the draft."
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};

/** Uploading the rally draft. During RTL, when the vehicle may be heading to a rally point, confirm twice. */
export const RallyUploadModal: React.FC<VehicleState & { vehicle: RallyDraft }> = ({ vehicle, armed, modeName, onConfirm, onCancel }) => {
  const draft = useMissionPlanStore((s) => s.rally.history.present);
  const homeKnown = useTelemetryStore((s) => s.homePosition.source !== 'none');
  const homeLat = useTelemetryStore((s) => s.homePosition.lat);
  const homeLon = useTelemetryStore((s) => s.homePosition.lon);
  const limitKm = useTelemetryStore((s) => s.parameters['RALLY_LIMIT_KM']?.value);
  const issues = useMemo(
    () => validateRallyDraft(draft, { home: homeKnown ? { lat: homeLat, lon: homeLon } : null, limitKm }),
    [draft, homeKnown, homeLat, homeLon, limitKm]
  );
  const changes = useMemo(() => compareRallyDrafts(vehicle, draft), [vehicle, draft]);
  const returning = /RTL/i.test(modeName);
  const count = (n: number) => `${n} point${n === 1 ? '' : 's'}`;
  return (
    <UploadConfirm
      title="Upload rally points"
      description="Replaces the rally points on the vehicle. The mission and fence are not changed."
      draftCount={count(draft.points.length)}
      vehicleCount={count(vehicle.points.length)}
      subject="the vehicle’s rally points"
      changes={changes}
      issues={issues.map((i) => ({ label: i.index >= 0 ? `R${i.index + 1}` : null, severity: i.severity, message: i.message }))}
      armed={armed}
      inUse={
        returning
          ? { heading: `IN ${modeName}`, text: 'The vehicle may be returning to a rally point now. Uploading changes where it can go immediately.' }
          : null
      }
      armedText="Uploading changes where the vehicle goes on RTL while it is armed."
      secondLabel="Confirm again: change rally points during RTL"
      readBackNote="After uploading, the rally points are read back from the vehicle and compared with the draft."
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};

/**
 * Uploading the fence draft. A new fence applies the moment the vehicle has it, so the vehicle's position is checked
 * against it with ArduPilot's rule: inside a new exclusion zone, or outside the inclusion zones, is a breach. Armed,
 * with fencing on, that means the fence action fires at once: allowed, after a second confirmation naming it.
 */
export const FenceUploadModal: React.FC<VehicleState & { vehicle: FenceDraft }> = ({ vehicle, vehicleType, armed, onConfirm, onCancel }) => {
  const draft = useMissionPlanStore((s) => s.fence.history.present);
  const lat = useTelemetryStore((s) => s.position.lat);
  const lon = useTelemetryStore((s) => s.position.lon);
  const sensorsPresent = useTelemetryStore((s) => s.sysStatus.sensorsPresent);
  const sensorsEnabled = useTelemetryStore((s) => s.sysStatus.sensorsEnabled);
  const fenceEnable = useTelemetryStore((s) => s.parameters['FENCE_ENABLE']?.value);
  const fenceType = useTelemetryStore((s) => s.parameters['FENCE_TYPE']?.value);
  const fenceAction = useTelemetryStore((s) => s.parameters['FENCE_ACTION']?.value);
  const fenceOptions = useTelemetryStore((s) => s.parameters['FENCE_OPTIONS']?.value);
  const fenceAutoEnable = useTelemetryStore((s) => s.parameters['FENCE_AUTOENABLE']?.value);
  const category = getVehicleCategory(vehicleType);
  // Fresh values for the decision below: the dialog updates as they arrive.
  useEffect(() => {
    const hb = useTelemetryStore.getState().heartbeat;
    if (hb.systemId > 0) FENCE_PARAMS.forEach((p) => paramManager.requestParam(hb.systemId, hb.componentId || 1, p));
  }, []);
  const inclusionUnion = fenceOptions !== undefined ? (Math.round(fenceOptions) & 2) !== 0 : undefined;

  const issues = useMemo(() => validateFenceDraft(draft, { fenceEnable, fenceType, inclusionUnion }), [draft, fenceEnable, fenceType, inclusionUnion]);
  const changes = useMemo(() => fenceChanges(vehicle, draft), [vehicle, draft]);

  const fencingOn = fencingState({ sensorsPresent, sensorsEnabled, fenceEnable, fenceAction, fenceAutoEnable, armed });
  // Polygons and circles are enforced unless FENCE_TYPE is known to leave out bit 2 (value 4).
  const shapesEnforced = fenceType === undefined || (Math.round(fenceType) & 4) !== 0;
  const action = fenceActionText(category, fenceAction);
  const positionKnown = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const reasons = useMemo(
    () => (positionKnown ? fenceBreachReasons(draft, { lat, lon }, { inclusionUnion }) : []),
    [draft, lat, lon, positionKnown, inclusionUnion]
  );
  const breach = reasons.length > 0;
  const fires = armed && breach && fencingOn !== false && shapesEnforced && action !== null;

  const extra: { label: string | null; severity: 'error' | 'warning'; message: string }[] = [];
  if (breach && !fires) {
    extra.push({
      label: null,
      severity: 'warning',
      message: `The vehicle is ${reasons.join(' and ')} of this fence. ${
        armed ? 'Fencing is off or not enforcing these shapes now, but turning it on here breaches at once.' : 'With fencing on (or auto-enabled) it will fail its pre-arm check here.'
      }`,
    });
  }
  if (!positionKnown && armed && fencingOn !== false) {
    extra.push({ label: null, severity: 'warning', message: "The vehicle's position is unknown, so it couldn't be checked against the new fence." });
  }

  const n = draft.shapes.length;
  const count = (d: FenceDraft) => `${d.shapes.length} shape${d.shapes.length === 1 ? '' : 's'}${d.returnPoint ? ' + return point' : ''}`;
  const onText = fencingOn === undefined ? 'unknown' : fencingOn ? 'ON' : 'off';
  return (
    <UploadConfirm
      title="Upload fence"
      description={n === 0 ? "Clears the fence on the vehicle. The mission and rally points are not changed." : 'Replaces the fence on the vehicle. The mission and rally points are not changed.'}
      draftCount={count(draft)}
      vehicleCount={count(vehicle)}
      subject="the vehicle’s fence"
      changes={changes}
      issues={[
        ...extra,
        ...issues.map((i) => ({ label: i.index >= 0 ? `F${i.index + 1}` : i.index === -2 ? 'RP' : null, severity: i.severity, message: i.message })),
      ]}
      armed={armed}
      inUse={
        fires
          ? {
              heading: 'OUTSIDE THE NEW FENCE',
              text: `It is ${reasons.join(' and ')}. ${
                fencingOn ? 'Fencing is on' : 'Fencing may be on (its state is unknown)'
              }, and the new fence applies the moment it is uploaded: the vehicle will ${action} immediately${
                category === 'copter' ? ' (on the ground, it disarms instead)' : ''
              }.`,
            }
          : null
      }
      armedText="The new fence applies the moment it is uploaded."
      secondLabel={`Confirm again: it will ${action ?? 'breach'} now`}
      readBackNote="After uploading, the fence is read back from the vehicle and compared with the draft. Altitude limits (FENCE_ALT_MAX/MIN) are parameters and are not changed."
      status={
        <div className="space-y-0.5 text-zinc-400">
          <div className="flex justify-between">
            <span>Fencing</span>
            <span className={`font-mono ${fencingOn ? 'font-bold text-red-300' : 'text-zinc-300'}`}>{onText}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>On breach</span>
            <span className="text-right font-mono text-zinc-300">{action ?? 'report only'}</span>
          </div>
          {!shapesEnforced && <div className="text-amber-300">FENCE_TYPE doesn't enforce polygons and circles: this fence is stored but not enforced.</div>}
          <div className="flex justify-between gap-2">
            <span>Vehicle position</span>
            <span className={`text-right font-mono ${breach ? 'font-bold text-red-300' : 'text-zinc-300'}`}>
              {!positionKnown ? 'unknown' : breach ? 'breaches the new fence' : 'within the new fence'}
            </span>
          </div>
        </div>
      }
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
};
