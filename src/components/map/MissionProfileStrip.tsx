// The mission's altitude profile, along the bottom of the map while planning (aircraft, terrain data on): distance
// along the route against altitude above sea level. Terrain as a filled area with the clearance as a faint line above
// it, the planned route over it (red where it is within the clearance or below the terrain), the route's items
// marked. Hover for distance, planned altitude, terrain and height above it there; the point is marked on the map too
// (and pointing at the route on the map marks it here); click to bring it into view on the map.

import React, { useMemo } from 'react';
import { Mountain, X } from 'lucide-react';
import { useMissionTerrainStore } from '../../store/missionTerrainStore';
import { useTerrainStore } from '../../store/terrainStore';
import { useUnitsStore } from '../../store/unitsStore';
import { useMissionPlanStore } from '../../store/missionPlanStore';
import { usePanelWidth } from '../widgets/custom/panelKit';

const H = 120;
const PAD = { l: 44, r: 8, t: 8, b: 16 };

export const MissionProfileStrip: React.FC<{ style?: React.CSSProperties; onShowPoint?: (lat: number, lon: number) => void }> = ({ style, onShowPoint }) => {
  const profile = useMissionTerrainStore((s) => s.profile);
  const loading = useMissionTerrainStore((s) => s.loading);
  const issues = useMissionTerrainStore((s) => s.issues);
  const clearance = useTerrainStore((s) => s.clearanceM);
  const { formatAltitude, formatDistance } = useUnitsStore();
  const { ref, width } = usePanelWidth<HTMLDivElement>();
  // Shared with the map: pointing here marks the point there, and the other way round.
  const hover = useMissionTerrainStore((s) => s.hover);
  const setHover = useMissionTerrainStore((s) => s.setHover);
  const W = Math.max(200, width ?? 600);

  const chart = useMemo(() => {
    if (!profile || profile.points.length < 2) return null;
    const vals = profile.points.flatMap((p) => [p.alt, p.terrain]).filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    const lo = Math.min(...vals);
    const hi = Math.max(...vals, lo + 20);
    const span = hi - lo;
    const y0 = lo - span * 0.08;
    const y1 = hi + span * 0.12;
    const len = Math.max(profile.length, 1);
    const x = (d: number) => PAD.l + (d / len) * (W - PAD.l - PAD.r);
    const y = (h: number) => PAD.t + (1 - (h - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    const withT = profile.points.filter((p) => p.terrain !== null);
    const terrainPath = withT.length
      ? `M${x(withT[0].dist)},${H - PAD.b} ` + withT.map((p) => `L${x(p.dist)},${y(p.terrain!)}`).join(' ') + ` L${x(withT[withT.length - 1].dist)},${H - PAD.b} Z`
      : '';
    const clearPath = withT.map((p, i) => `${i ? 'L' : 'M'}${x(p.dist)},${y(p.terrain! + clearance)}`).join(' ');
    // The route, split where it is too close (so those stretches can be red).
    const segs: { d: string; bad: boolean }[] = [];
    let cur: { d: string; bad: boolean } | null = null;
    for (const p of profile.points) {
      if (p.alt === null) {
        cur = null;
        continue;
      }
      const bad = p.checked && p.terrain !== null && p.alt - p.terrain < clearance;
      if (!cur || cur.bad !== bad) {
        const start: string = cur ? cur.d.split(' ').pop()!.replace(/^L/, 'M') : `M${x(p.dist)},${y(p.alt)}`;
        cur = { d: start, bad };
        segs.push(cur);
      }
      cur.d += ` L${x(p.dist)},${y(p.alt)}`;
    }
    const ticks = [y0 + (y1 - y0) * 0.15, (y0 + y1) / 2, y1 - (y1 - y0) * 0.15];
    return { x, y, terrainPath, clearPath, segs, ticks, len };
  }, [profile, clearance, W]);

  const p = hover !== null && profile ? profile.points[hover] : null;
  const minAgl = issues.length ? Math.min(...issues.map((i) => i.minAgl)) : null;

  return (
    <div
      style={style}
      className="pointer-events-auto absolute z-[445] rounded-lg border border-zinc-700 bg-zinc-950/95 shadow-xl backdrop-blur-md"
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2 py-1 text-[10px]">
        <Mountain className="h-3.5 w-3.5 text-amber-400" />
        <span className="font-bold uppercase tracking-wider text-zinc-300">Profile</span>
        {profile && <span className="font-mono text-zinc-500">{formatDistance(profile.length).full}</span>}
        {loading && <span className="animate-pulse text-sky-300">loading terrain…</span>}
        {minAgl !== null && (
          <span className="font-mono text-red-300">
            {minAgl < 0 ? `${formatAltitude(-minAgl).full} below terrain` : `${formatAltitude(minAgl).full} above terrain`} at lowest
          </span>
        )}
        {profile?.homeFrom === 'terrain' && <span className="text-amber-300" title="The mission's home has no altitude: the terrain there is used">home altitude from terrain</span>}
        {profile?.homeFrom === 'unknown' && (
          <span className="text-amber-300" title="Relative altitudes are above home: connect to a vehicle, or give the mission a home">
            home unknown: relative altitudes not placed
          </span>
        )}
        <span className="ml-auto min-w-0 truncate font-mono text-zinc-400">
          {p
            ? `${formatDistance(p.dist).full} · ${p.alt !== null ? formatAltitude(p.alt).full : '?'} MSL · terrain ${p.terrain !== null ? formatAltitude(p.terrain).full : '?'}${
                p.alt !== null && p.terrain !== null ? ` · ${formatAltitude(p.alt - p.terrain).full} above` : ''
              }`
            : `clearance ${formatAltitude(clearance).full}`}
        </span>
        <button type="button" className="text-zinc-500 hover:text-zinc-200" aria-label="Hide profile" onClick={() => useMissionTerrainStore.getState().setShowProfile(false)}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={ref} className="relative">
        {!chart ? (
          <div className="flex items-center justify-center text-[11px] text-zinc-500" style={{ height: H }}>
            {loading ? 'Loading terrain along the route…' : 'Add waypoints with positions to see the profile.'}
          </div>
        ) : (
          <svg
            width={W}
            height={H}
            className="block"
            onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              if (!profile) return;
              const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const d = ((e.clientX - rect.left - PAD.l) / (W - PAD.l - PAD.r)) * chart.len;
              let best = 0;
              profile.points.forEach((q, i) => {
                if (Math.abs(q.dist - d) < Math.abs(profile.points[best].dist - d)) best = i;
              });
              setHover(best);
            }}
            onClick={() => {
              const q = hover !== null && profile ? profile.points[hover] : null;
              if (q) onShowPoint?.(q.lat, q.lon);
            }}
            style={{ cursor: onShowPoint ? 'pointer' : undefined }}
          >
            {chart.ticks.map((t, i) => (
              <g key={i}>
                <line x1={PAD.l} x2={W - PAD.r} y1={chart.y(t)} y2={chart.y(t)} stroke="#27272a" strokeWidth={1} />
                <text x={PAD.l - 4} y={chart.y(t) + 3} textAnchor="end" fontSize={9} fill="#71717a" fontFamily="ui-monospace, monospace">
                  {Math.round(Number(formatAltitude(t).value))}
                </text>
              </g>
            ))}
            <path d={chart.terrainPath} fill="#78716c" fillOpacity={0.45} stroke="#a8a29e" strokeWidth={1} />
            {clearance > 0 && <path d={chart.clearPath} fill="none" stroke="#a8a29e" strokeOpacity={0.5} strokeDasharray="3 4" strokeWidth={1} />}
            {chart.segs.map((s, i) => (
              <path key={i} d={s.d} fill="none" stroke={s.bad ? '#ef4444' : '#f59e0b'} strokeWidth={s.bad ? 3 : 2} />
            ))}
            {profile!.marks.map((m) => (
              <g key={`${m.item}-${m.dist}`}>
                <line x1={chart.x(m.dist)} x2={chart.x(m.dist)} y1={PAD.t} y2={H - PAD.b} stroke="#52525b" strokeDasharray="2 3" />
                {m.alt !== null && <circle cx={chart.x(m.dist)} cy={chart.y(m.alt)} r={3} fill="#f59e0b" stroke="#09090b" />}
                <text x={chart.x(m.dist)} y={H - 4} textAnchor="middle" fontSize={9} fill="#a1a1aa" fontFamily="ui-monospace, monospace">
                  {m.item === 0 ? 'H' : m.item}
                </text>
              </g>
            ))}
            {p && <line x1={chart.x(p.dist)} x2={chart.x(p.dist)} y1={PAD.t} y2={H - PAD.b} stroke="#38bdf8" strokeWidth={1} />}
          </svg>
        )}
      </div>
    </div>
  );
};

/** The map toolbar button that shows or hides the strip. */
export const ProfileToggle: React.FC<{ disabledReason?: string }> = ({ disabledReason }) => {
  const shown = useMissionTerrainStore((s) => s.showProfile);
  const layer = useMissionPlanStore((s) => s.layer);
  if (layer !== 'mission') return null;
  return (
    <button
      type="button"
      aria-pressed={shown}
      disabled={Boolean(disabledReason)}
      title={disabledReason ?? 'Altitude profile over the terrain'}
      onClick={() => useMissionTerrainStore.getState().setShowProfile(!shown)}
      className={`inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] font-bold shadow-md disabled:opacity-40 ${
        shown ? 'border-amber-500/60 bg-amber-500 text-zinc-950' : 'border-zinc-700 bg-zinc-950/90 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      <Mountain className="h-3.5 w-3.5" />
      Profile
    </button>
  );
};
