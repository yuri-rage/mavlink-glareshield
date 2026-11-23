// Confirms uploading a draft (the mission, or the rally points): what it replaces, what changes, the draft's
// warnings, and the vehicle's state. Uploading while armed shows the in-flight warning. When the vehicle is using
// what is being replaced (the mission in AUTO, rally points during RTL) the upload needs a second confirmation.

import React, { useMemo } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { compareDrafts, validateDraft, type MissionDraft } from '../../mavlink/missionDraft';
import { compareRallyDrafts, validateRallyDraft, type RallyDraft } from '../../mavlink/rallyDraft';
import { getVehicleCategory } from '../../mavlink/messages';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { useMissionPlanStore } from '../../store/missionPlanStore';
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
  const issues = useMemo(() => validateDraft(draft, getVehicleCategory(vehicleType)), [draft, vehicleType]);
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
