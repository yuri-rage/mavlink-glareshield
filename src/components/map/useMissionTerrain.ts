// Keeps the mission draft's terrain profile and clearance issues current while planning (store/missionTerrainStore):
// fetches the elevation tiles along the route, then computes from them. Only for aircraft (terrainChecked) with
// terrain data on. Recomputed a moment after the draft, the clearance or the vehicle's home changes.

import { useEffect } from 'react';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTerrainStore } from '../../store/terrainStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { getVehicleCategory } from '../../mavlink/messages';
import { fliesSplines, missionPathLegs, routeIndices, type PathItem } from '../../mavlink/missionPath';
import { missionProfile, terrainChecked, terrainIssues } from '../../mavlink/missionProfile';
import { terrainService } from '../../mavlink/terrainBoot';

const DEBOUNCE_MS = 250;

export function useMissionTerrain() {
  const active = useMissionPlanStore((s) => s.active);
  const draft = useMissionPlanStore((s) => s.history.present);
  const enabled = useTerrainStore((s) => s.enabled);
  const clearanceM = useTerrainStore((s) => s.clearanceM);
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const homeKnown = useTelemetryStore((s) => s.homePosition.source !== 'none');
  const homeAlt = useTelemetryStore((s) => s.homePosition.alt);

  useEffect(() => {
    const category = getVehicleCategory(vehicleType);
    if (!active || !enabled || !terrainChecked(category)) {
      useMissionTerrainStore.setState({ profile: null, issues: [], loading: false });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const items: PathItem[] = draft.items.map((it) => ({ command: it.command, lat: it.x, lon: it.y, alt: it.z, frame: it.frame, param1: it.param1 }));
      const splines = fliesSplines(category);
      const legs = missionPathLegs(items, routeIndices(items, splines), splines);
      if (legs.length === 0) {
        useMissionTerrainStore.setState({ profile: null, issues: [], loading: false });
        return;
      }
      const hint = homeKnown && homeAlt !== 0 ? homeAlt : null;
      // A first pass names the points; fetch their tiles, then compute with them loaded.
      const rough = missionProfile(items, legs, () => null, { homeMslHint: hint });
      useMissionTerrainStore.setState({ loading: true });
      await terrainService.heightsAt([...rough.points, { lat: items[0].lat, lon: items[0].lon }]);
      if (cancelled) return;
      const profile = missionProfile(items, legs, (lat, lon) => terrainService.heightNow(lat, lon), { homeMslHint: hint });
      useMissionTerrainStore.setState({ profile, issues: terrainIssues(profile, legs, clearanceM), loading: false });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, draft, enabled, clearanceM, vehicleType, homeKnown, homeAlt]);
}
