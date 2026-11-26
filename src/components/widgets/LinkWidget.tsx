// The link to the vehicle, in one card: how much of its telemetry gets through (from packet sequence numbers), how
// much of ours it loses, the packet rate, a telemetry radio's signal at both ends, and quality over the last two
// minutes. Which of these it shows is chosen in its settings (the same for every Link card).

import React, { useEffect, useRef, useState } from 'react';

import { Radio, Settings2 } from 'lucide-react';

import { getCachedField, getLastSeen, getLinkHistory, getLinkStats, type LinkStats } from '../../lib/messageCache';
import { mavlinkConnection } from '../../mavlink/connection';
import { linkBars, linkLevel } from '../../mavlink/linkQuality';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

const STORAGE_KEY = 'mavlink_glareshield_link_widget';

/** What the card shows. */
export interface LinkWidgetOptions {
  quality: boolean;
  counts: boolean;
  rate: boolean;
  uplink: boolean;
  radio: boolean;
  chart: boolean;
}

const DEFAULTS: LinkWidgetOptions = { quality: true, counts: true, rate: true, uplink: true, radio: true, chart: true };

const OPTION_LABELS: [keyof LinkWidgetOptions, string, string][] = [
  ['quality', 'Downlink quality', "Bars and the % of the vehicle's packets received (last 5 s)"],
  ['counts', 'Received / lost', 'Packet counts over the last 5 s'],
  ['rate', 'Packet rate', 'Packets per second from the link'],
  ['uplink', 'Uplink loss', 'The % of our packets the vehicle reports lost (SYS_STATUS drop_rate_comm)'],
  ['radio', 'Radio signal', 'RSSI and noise at both ends, when a telemetry radio reports them (RADIO_STATUS)'],
  ['chart', 'Quality chart', 'Downlink quality over the last two minutes'],
];

function loadOptions(): LinkWidgetOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable or damaged: the defaults.
  }
  return { ...DEFAULTS };
}

const TONE = { good: 'text-emerald-400', fair: 'text-amber-400', poor: 'text-red-400' } as const;

/** Big four-bar signal icon, `filled` lit. */
const Bars: React.FC<{ filled: number; className: string }> = ({ filled, className }) => (
  <svg viewBox="0 0 16 14" className={`h-9 w-10 shrink-0 ${className}`} aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <rect
        key={i}
        x={i * 4 + 0.5}
        y={11 - i * 3.5}
        width={3}
        height={3 + i * 3.5}
        rx={0.6}
        fill="currentColor"
        opacity={i < filled ? 1 : 0.2}
      />
    ))}
  </svg>
);

const Row: React.FC<{ label: string; value: React.ReactNode; tone?: string; title?: string }> = ({
  label,
  value,
  tone = 'text-zinc-100',
  title,
}) => (
  <div
    className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5"
    title={title}
  >
    <span className="shrink-0 text-[11px] font-bold uppercase text-zinc-400">{label}</span>
    <span className={`truncate font-mono text-sm font-bold ${tone}`}>{value}</span>
  </div>
);

/** Quality over the last two minutes (0-100 %), as a filled line. */
const QualityChart: React.FC<{ points: readonly { t: number; quality: number | null }[] }> = ({ points }) => {
  const W = 240;
  const H = 60;
  const n = points.length;
  if (n < 2) {
    return <p className="py-3 text-center text-[11px] text-zinc-500">Collecting… (a point a second)</p>;
  }
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (q: number | null) => H - ((q ?? 0) / 100) * H;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.quality).toFixed(1)}`).join(' ');
  return (
    <div className="relative min-h-[64px] flex-1">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {[90, 70].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={y(g)}
            y2={y(g)}
            stroke={g === 90 ? '#10b981' : '#f59e0b'}
            strokeOpacity={0.35}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={`${line} L${W},${H} L0,${H} Z`} fill="#38bdf8" fillOpacity={0.12} />
        <path d={line} fill="none" stroke="#38bdf8" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="absolute right-1 top-0 font-mono text-[9px] text-zinc-500">100%</span>
      <span className="absolute bottom-0 left-1 font-mono text-[9px] text-zinc-500">−{n}s</span>
    </div>
  );
};

export const LinkWidget: React.FC = () => {
  const [opts, setOpts] = useState<LinkWidgetOptions>(loadOptions);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The settings menu closes on a click outside it (or its button) and on Escape.
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !menuButtonRef.current?.contains(t)) setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen]);
  const [link, setLink] = useState<LinkStats>(() => getLinkStats());
  const [rate, setRate] = useState(() => mavlinkConnection.stats.packetsPerSecond);
  const [history, setHistory] = useState(() => [...getLinkHistory()]);
  useEffect(() => {
    const t = setInterval(() => {
      setLink(getLinkStats());
      setRate(mavlinkConnection.stats.packetsPerSecond);
      setHistory([...getLinkHistory()]);
    }, 1000);
    return () => clearInterval(t);
  }, []);
  const toggle = (k: keyof LinkWidgetOptions) =>
    setOpts((o) => {
      const next = { ...o, [k]: !o[k] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Not saved: kept for this session.
      }
      return next;
    });

  const q = link.quality;
  const level = linkLevel(q);
  const hasLink = q !== null;
  // The vehicle's count of our packets it lost (centi-%), once SYS_STATUS has arrived.
  const dropRaw = getLastSeen('SYS_STATUS') !== undefined ? getCachedField('SYS_STATUS', 'drop_rate_comm') : undefined;
  const uplinkLoss = dropRaw === undefined ? null : dropRaw / 100;
  const hasRadio = link.rssi !== null || link.remrssi !== null;
  const noise = getCachedField('RADIO_STATUS', 'noise');
  const remnoise = getCachedField('RADIO_STATUS', 'remnoise');

  return (
    <Card className="relative flex h-full flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      <CardHeader className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 sm:px-3.5">
        <div className="flex items-center justify-between gap-1">
          <CardTitle className="flex shrink-0 items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
            <Radio className="h-3.5 w-3.5 text-sky-400" />
            Link
          </CardTitle>
          <div className="flex items-center gap-1">
            {!hasLink && (
              <Badge variant="secondary" className="px-2 py-0.5 font-mono text-[10px]">
                NO LINK
              </Badge>
            )}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-label="Choose what the Link card shows"
              title="Choose what this card shows"
              className={`rounded p-1 hover:bg-zinc-800 ${settingsOpen ? 'text-sky-300' : 'text-zinc-400'}`}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      {settingsOpen && (
        <div
          ref={menuRef}
          className="absolute right-2 top-9 z-20 w-60 space-y-1 rounded-lg border border-zinc-700 bg-zinc-950/95 p-2 shadow-xl backdrop-blur-sm"
        >
          {OPTION_LABELS.map(([k, label, hint]) => (
            <label
              key={k}
              className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-zinc-900"
              title={hint}
            >
              <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} className="mt-0.5 accent-sky-500" />
              <span className="text-[11px] text-zinc-200">{label}</span>
            </label>
          ))}
        </div>
      )}
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {opts.quality && (
          <div
            className="flex items-center gap-3"
            title="The % of the vehicle's packets received over the last 5 s, from their sequence numbers"
          >
            <Bars filled={linkBars(q)} className={level ? TONE[level] : 'text-zinc-600'} />
            <div>
              <div className={`font-mono text-2xl font-bold ${level ? TONE[level] : 'text-zinc-500'}`}>
                {q === null ? '--' : `${q.toFixed(0)}%`}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Downlink (vehicle → here)</div>
            </div>
          </div>
        )}
        {(opts.counts || opts.rate || opts.uplink) && (
          <div className="grid grid-cols-2 gap-2">
            {opts.counts && (
              <>
                <Row label="Received" value={hasLink ? link.received : '--'} title="Packets received, last 5 s" />
                <Row
                  label="Lost"
                  value={hasLink ? link.lost : '--'}
                  tone={link.lost > 0 ? 'text-amber-300' : 'text-zinc-100'}
                  title="Packets lost on the way, last 5 s"
                />
              </>
            )}
            {opts.rate && <Row label="Rate" value={hasLink ? `${rate}/s` : '--'} title="Packets per second" />}
            {opts.uplink && (
              <Row
                label="Uplink loss"
                value={uplinkLoss === null ? '--' : `${uplinkLoss.toFixed(1)}%`}
                tone={uplinkLoss !== null && uplinkLoss >= 5 ? 'text-amber-300' : 'text-zinc-100'}
                title="Our packets the vehicle reports lost (SYS_STATUS drop_rate_comm)"
              />
            )}
          </div>
        )}
        {opts.radio &&
          (hasRadio ? (
            <div className="grid grid-cols-2 gap-2">
              <Row label="RSSI here" value={link.rssi ?? '--'} title="Local radio's received signal (radio units)" />
              <Row label="RSSI vehicle" value={link.remrssi ?? '--'} title="The vehicle's radio's received signal" />
              <Row label="Noise here" value={noise ?? '--'} />
              <Row label="Noise vehicle" value={remnoise ?? '--'} />
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500" title="RADIO_STATUS, sent by SiK-style telemetry radios">
              No radio signal reported (a telemetry radio sends it).
            </p>
          ))}
        {opts.chart && <QualityChart points={history} />}
      </CardContent>
    </Card>
  );
};
