// A waypoint's radius circle, the same on the vehicle's mission and the planning draft: thin and dashed, yellow for
// the item's own radius, white for the vehicle's default (waypointRadius.ts).

import L from 'leaflet';
import { getVehicleCategory } from '../../mavlink/messages';
import { waypointRadius } from '../../mavlink/waypointRadius';
import type { LastVehicle } from '../../store/lastVehicleStore';

export function radiusCircle(
  item: { command: number; param2?: number; param3?: number },
  lat: number,
  lon: number,
  vehicle: LastVehicle,
  opts: { pane: string; opacity: number }
): L.Circle | null {
  const r = waypointRadius({ command: item.command, param2: item.param2 ?? 0, param3: item.param3 ?? 0 }, getVehicleCategory(vehicle.type), (n) => vehicle.params[n]);
  if (!r) return null;
  return L.circle([lat, lon], {
    pane: opts.pane,
    radius: r.radiusM,
    color: r.source === 'item' ? '#facc15' : '#ffffff',
    weight: 1.5,
    dashArray: '5 5',
    opacity: opts.opacity,
    fill: false,
    interactive: false,
  });
}
