// Which draft the planning editor works on, as a switch over the map's upper right (opposite the GPS readout).
// Each tab shows when its draft has unsaved changes or errors. A Fence layer joins it later.

import React, { useMemo } from 'react';
import { XCircle } from 'lucide-react';
import { getVehicleCategory } from '../../mavlink/messages';
import { validateDraft } from '../../mavlink/missionDraft';
import { validateRallyDraft } from '../../mavlink/rallyDraft';
import { isDraftDirty, isRallyDirty, useMissionPlanStore, type PlanLayer } from '../../store/missionPlanStore';
import { useTelemetryStore } from '../../store/telemetryStore';

/** Room the switch takes at the map's top right, so the GPS readout column can stop short of it (px). */
export const PLAN_LAYER_SWITCH_WIDTH = 140;

export const PlanLayerSwitch: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => {
  const layer = useMissionPlanStore((s) => s.layer);
  const draft = useMissionPlanStore((s) => s.history.present);
  const rally = useMissionPlanStore((s) => s.rally.history.present);
  const missionDirty = useMissionPlanStore((s) => isDraftDirty(s));
  const rallyDirty = useMissionPlanStore((s) => isRallyDirty(s));
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  // Only errors are shown here, and rally errors don't depend on home or RALLY_LIMIT_KM (those are warnings).
  const missionErr = useMemo(
    () => validateDraft(draft, getVehicleCategory(vehicleType)).some((i) => i.severity === 'error'),
    [draft, vehicleType]
  );
  const rallyErr = useMemo(() => validateRallyDraft(rally).some((i) => i.severity === 'error'), [rally]);

  const tabs: { id: PlanLayer; label: string; dirty: boolean; err: boolean; on: string }[] = [
    { id: 'mission', label: 'Mission', dirty: missionDirty, err: missionErr, on: 'bg-amber-500 text-zinc-950' },
    { id: 'rally', label: 'Rally', dirty: rallyDirty, err: rallyErr, on: 'bg-fuchsia-500 text-zinc-950' },
  ];

  return (
    <div
      role="tablist"
      aria-label="Draft being edited"
      style={style}
      className={`flex rounded-lg border border-zinc-700 bg-zinc-950/90 p-0.5 shadow-md backdrop-blur-md ${className ?? ''}`}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={layer === t.id}
          onClick={() => useMissionPlanStore.getState().setLayer(t.id)}
          title={`Edit the ${t.id === 'mission' ? 'mission' : 'rally points'}${t.err ? ' (has errors)' : t.dirty ? ' (unsaved changes)' : ''}`}
          className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold ${
            layer === t.id ? t.on : 'text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          {t.label}
          {t.err ? <XCircle className="h-3 w-3" /> : t.dirty ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
        </button>
      ))}
    </div>
  );
};
