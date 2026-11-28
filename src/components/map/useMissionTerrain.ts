// Keeps the mission draft's terrain profile and clearance issues current while planning (store/missionTerrainStore):
// fetches the elevation tiles along the route, then computes from them, with terrain data on. Aircraft get their
// altitude over the terrain, checked for clearance; ground vehicles the elevation along the route (profileMode). Recomputed a moment after the draft, the clearance or the vehicle's home changes.

import { useEffect } from 'react';

import { getVehicleCategory } from '../../mavlink/messages';
import { fliesSplines, missionPathLegs, routeIndices, type PathItem } from '../../mavlink/missionPath';
import { elevationProfile, missionProfile, profileMode, terrainIssues } from '../../mavlink/missionProfile';
import { terrainService } from '../../mavlink/terrainBoot';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useTerrainStore } from '../../store/terrainStore';
import { useUnitsStore } from '../../store/unitsStore';

const DEBOUNCE_MS = 250;

export function useMissionTerrain() {
  const active = useMissionPlanStore((s) => s.active);
  const draft = useMissionPlanStore((s) => s.history.present);
  const enabled = useTerrainStore((s) => s.enabled);
  const clearanceM = useTerrainStore((s) => s.clearanceM);
  const vehicleType = useTelemetryStore((s) => s.heartbeat.type);
  const homeKnown = useTelemetryStore((s) => s.homePosition.source !== 'none');
  const homeAlt = useTelemetryStore((s) => s.homePosition.alt);
  const imperial = useUnitsStore((s) => s.system === 'mph' || s.system === 'kts');

  useEffect(() => {
    const category = getVehicleCategory(vehicleType);
    const mode = profileMode(category);
    if (!active || !enabled || !mode) {
      useMissionTerrainStore.setState({ profile: null, issues: [], loading: false });
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const items: PathItem[] = draft.items.map((it) => ({
        command: it.command,
        lat: it.x,
        lon: it.y,
        alt: it.z,
        frame: it.frame,
        param1: it.param1,
      }));
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
      // Home's terrain too, when it has a position (0, 0 is "unknown", not a place to fetch).
      const homePos =
        items[0] && (items[0].lat !== 0 || items[0].lon !== 0) ? [{ lat: items[0].lat, lon: items[0].lon }] : [];
      await terrainService.heightsAt([...rough.points, ...homePos]);
      if (cancelled) return;
      const profile = missionProfile(items, legs, (lat, lon) => terrainService.heightNow(lat, lon), {
        homeMslHint: hint,
      });
      // Heights in the warnings in the user's units, whole feet or meters; above zero is at least 1 (never "0 ft below").
      const whole = (v: number) => (v > 0 ? Math.max(1, Math.round(v)) : Math.round(v));
      const fmt = (m: number) => (imperial ? `${whole(m * 3.28084)} ft` : `${whole(m)} m`);
      useMissionTerrainStore.setState(
        mode === 'elevation'
          ? { profile: elevationProfile(profile), mode, issues: [], loading: false }
          : { profile, mode, issues: terrainIssues(profile, legs, clearanceM, fmt), loading: false }
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, draft, enabled, clearanceM, vehicleType, homeKnown, homeAlt, imperial]);
}
