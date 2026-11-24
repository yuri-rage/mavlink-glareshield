// Over the map: the worst ADS-B traffic threat (alert in red, caution in amber), with how many others are near.
// Nothing shows when no traffic is a caution or alert. Clicking centres the map on the aircraft.

import React, { useEffect, useState } from 'react';
import { Plane } from 'lucide-react';
import { useTrafficStore } from '../../store/trafficStore';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useUnitsStore } from '../../store/unitsStore';
import { compassPoint, emergencySquawk, icaoHex, ownForThreat, rankTraffic, relAltText } from '../../mavlink/adsb';

export const TrafficBanner: React.FC<{ onFocus: (lat: number, lon: number) => void }> = ({ onFocus }) => {
  const aircraft = useTrafficStore((s) => s.aircraft);
  const position = useTelemetryStore((s) => s.position);
  const { formatAltitude, formatDistance } = useUnitsStore();
  // Re-check as reports age, even when nothing new arrives.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  const ranked = rankTraffic(Object.values(aircraft), ownForThreat(position)).filter((r) => r.t && r.t.level !== 'none');
  if (ranked.length === 0) return null;
  const { a, t } = ranked[0];
  const alert = t!.level === 'alert';
  const em = emergencySquawk(a.squawk);
  return (
    <button
      type="button"
      onClick={() => onFocus(a.lat, a.lon)}
      role="alert"
      className={`pointer-events-auto inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left font-mono text-[11px] font-bold shadow-md ${
        alert ? 'animate-pulse border-red-500 bg-red-600 text-white' : 'border-amber-500/60 bg-amber-950/90 text-amber-200'
      }`}
      title="Show on the map"
    >
      <Plane className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        TRAFFIC {a.callsign ?? icaoHex(a.icao)} {formatDistance(t!.distanceM).full} {compassPoint(t!.bearingDeg)},{' '}
        {relAltText(t!.relAltM, a.climbMs, formatAltitude)}
        {t!.closing ? ', closing' : ''}
        {em ? ` · ${em.toUpperCase()}` : ''}
        {ranked.length > 1 ? ` · +${ranked.length - 1}` : ''}
      </span>
    </button>
  );
};
