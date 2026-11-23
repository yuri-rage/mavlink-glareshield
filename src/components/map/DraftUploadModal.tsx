// Confirms uploading the mission draft: what it replaces, how the route changes, the draft's warnings, and the
// vehicle's state. Uploading while armed shows the in-flight warning; in AUTO, where the vehicle is flying the
// mission being replaced, the upload needs a second confirmation.

import React, { useMemo } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { compareDrafts, validateDraft, type MissionDraft } from '../../mavlink/missionDraft';
import { getVehicleCategory } from '../../mavlink/messages';
import { useConfirmStep } from '../../lib/useWaypointNavigation';
import { useMissionPlanStore } from '../../store/missionPlanStore';

interface DraftUploadModalProps {
  /** The vehicle's mission as it is now, to show what changes. */
  vehicle: MissionDraft;
  vehicleType: number;
  armed: boolean;
  modeName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DraftUploadModal: React.FC<DraftUploadModalProps> = ({ vehicle, vehicleType, armed, modeName, onConfirm, onCancel }) => {
  // The live draft: what this shows is what gets uploaded, even if it changes while the dialog is open.
  const draft = useMissionPlanStore((s) => s.history.present);
  const inAuto = modeName === 'AUTO';
  const second = useConfirmStep(6000);
  const issues = useMemo(() => validateDraft(draft, getVehicleCategory(vehicleType)), [draft, vehicleType]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const changes = useMemo(() => compareDrafts(vehicle, draft), [vehicle, draft]);
  const changeCount = changes.structural.length + changes.params.length;
  const listed = [...changes.structural, ...changes.params].slice(0, 6);

  const confirm = () => {
    if (inAuto && !second.armed) return second.arm();
    second.cancel();
    onConfirm();
  };

  return (
    <Modal isOpen onClose={onCancel} title="Upload mission draft" description="Replaces the mission on the vehicle. Fence and rally points are not changed.">
      <div className="space-y-3 text-xs">
        {(armed || inAuto) && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/70 bg-red-950/80 p-3 text-red-200 shadow-md">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <b className="mb-1 block font-bold text-red-300">
                VEHICLE IS {armed ? 'ARMED' : ''}
                {armed && inAuto ? ' AND ' : ''}
                {inAuto ? 'IN AUTO' : ''}
              </b>
              {inAuto
                ? 'The vehicle is flying its mission now. Uploading replaces it immediately: check which item it flies to next.'
                : 'Uploading replaces the mission on an armed vehicle.'}
            </div>
          </div>
        )}

        <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="flex justify-between text-zinc-300">
            <span className="text-zinc-400">Draft</span>
            <span className="font-mono font-bold text-zinc-100">{draft.items.length - 1} items</span>
          </div>
          <div className="flex justify-between text-zinc-300">
            <span className="text-zinc-400">On the vehicle now</span>
            <span className="font-mono">{Math.max(0, vehicle.items.length - 1)} items</span>
          </div>
          <div className="border-t border-zinc-800/70 pt-1.5">
            <span className="text-zinc-400">{changeCount === 0 ? 'No changes from the vehicle’s mission.' : `Changes (${changeCount}):`}</span>
            {listed.length > 0 && (
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-300">
                {listed.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
                {changeCount > listed.length && <li className="text-zinc-500">…and {changeCount - listed.length} more</li>}
              </ul>
            )}
          </div>
        </div>

        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="space-y-1">
            {[...errors, ...warnings].map((iss, i) => (
              <li key={i} className={`flex gap-1.5 ${iss.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {iss.index >= 1 ? <b className="font-mono">#{iss.index} </b> : null}
                  {iss.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-zinc-500">
          After uploading, the mission is read back from the vehicle and compared with the draft.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={armed || inAuto ? 'destructive' : 'default'}
            size="sm"
            className="gap-1.5 font-bold"
            disabled={errors.length > 0}
            onClick={confirm}
          >
            <Upload className="h-3.5 w-3.5" />
            {second.armed ? 'Confirm again: replace the active mission' : 'Upload'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
