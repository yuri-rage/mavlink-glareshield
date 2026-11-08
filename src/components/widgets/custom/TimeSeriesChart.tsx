import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { WidgetChartConfig } from '../../../types/widget';
import type { SampleRing } from '../../../lib/valueSampler';
import { niceStep, niceTicks, stepDecimals } from '../../../lib/gaugeGeometry';
import { useChromeColors, useElementSize } from './palette';

export interface ChartSeries {
  key: string;
  ring: SampleRing;
  label: string;
  color: string;
  unit: string;
  decimals: number;
  /** Base units → display units. */
  toDisplay: (base: number) => number;
}

export interface TimeSeriesChartProps {
  series: ChartSeries[];
  config?: WidgetChartConfig;
  /** Display-unit bounds for the 'fixed' scale (the primary binding's min/max). */
  fixedMin: number;
  fixedMax: number;
  dimmed?: boolean;
  /** Controlled window (seconds). When set, the chart's own window buttons are not used. */
  windowSec?: number;
  /** Controlled pause instant (null = live). When set (even to null), the chart's own pause is not used. */
  pausedAt?: number | null;
  /** Show the window / pause buttons (default true). Hide them when a parent controls several charts at once. */
  controls?: boolean;
  /** Minimum plot height in px (default 120). */
  plotMinHeight?: number;
  /** Label each legend value even for a single series (default: only with several). */
  legendLabels?: boolean;
}

export const WINDOW_CHOICES = [10, 30, 60, 300] as const;
const LEFT = 50;
const RIGHT = 8;
const TOP = 6;
const BOTTOM = 19;
const FRAME_MS = 66; // ~15 fps

function windowLabel(sec: number): string {
  return sec >= 60 ? `${sec / 60}m` : `${sec}s`;
}

/** Visible y-range for the chosen scale mode. */
export function computeYRange(
  dataMin: number,
  dataMax: number,
  mode: WidgetChartConfig['yScale'],
  fixedMin: number,
  fixedMax: number
): [number, number] {
  if (mode === 'fixed' && fixedMax > fixedMin) return [fixedMin, fixedMax];
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    if (mode === 'zero') return [0, 1];
    return fixedMax > fixedMin ? [fixedMin, fixedMax] : [0, 1];
  }
  let lo = mode === 'zero' ? Math.min(dataMin, 0) : dataMin;
  let hi = mode === 'zero' ? Math.max(dataMax, 0) : dataMax;
  // A steady signal gets a band around it instead of a zero-height range that blows noise up to full height.
  const minSpan = Math.max(Math.abs(hi), Math.abs(lo)) * 0.02 || 0.2;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  if (mode === 'zero') {
    // Keep zero on the edge when all data is on one side of it.
    if (dataMin >= 0) lo = 0;
    if (dataMax <= 0) hi = 0;
  }
  return [lo, hi];
}

/** Window choice and pause, shared by a chart and by parents that drive several charts at once. */
export const ChartControls: React.FC<{
  windowSec: number;
  onWindow: (sec: number) => void;
  paused: boolean;
  onTogglePause: () => void;
}> = ({ windowSec, onWindow, paused, onTogglePause }) => (
  <div className="flex items-center gap-1 shrink-0">
    <div className="flex rounded-md border border-zinc-800 overflow-hidden">
      {WINDOW_CHOICES.map((sec) => (
        <button
          key={sec}
          type="button"
          onClick={() => onWindow(sec)}
          className={`px-1.5 py-0.5 text-[11px] font-mono ${
            windowSec === sec ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
          aria-pressed={windowSec === sec}
        >
          {windowLabel(sec)}
        </button>
      ))}
    </div>
    <button
      type="button"
      onClick={onTogglePause}
      className={`p-1 rounded-md border ${
        paused ? 'border-amber-500/60 text-amber-400' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
      }`}
      title={paused ? 'Resume' : 'Pause (hover the chart to read values)'}
      aria-label={paused ? 'Resume chart' : 'Pause chart'}
    >
      {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
    </button>
  </div>
);

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({
  series,
  config,
  fixedMin,
  fixedMax,
  dimmed,
  windowSec: controlledWindow,
  pausedAt: controlledPause,
  controls = true,
  plotMinHeight = 120,
  legendLabels,
}) => {
  const colors = useChromeColors();
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ownWindow, setWindowSec] = useState<number>(config?.windowSec ?? 30);
  const [ownPause, setPausedAt] = useState<number | null>(null);
  const windowSec = controlledWindow ?? ownWindow;
  const pausedAt = controlledPause !== undefined ? controlledPause : ownPause;
  const hoverRef = useRef<number | null>(null); // canvas x in CSS px
  const [latest, setLatest] = useState<string[]>([]);
  const redrawRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (config?.windowSec) setWindowSec(config.windowSec);
  }, [config?.windowSec]);

  // Legend values at 4 Hz (paused: the values at the pause instant).
  useEffect(() => {
    const update = () => {
      setLatest(
        series.map((s) => {
          const ring = s.ring;
          let idx = ring.length - 1;
          if (pausedAt !== null) idx = ring.lowerBound(pausedAt) - 1;
          for (; idx >= 0 && idx >= ring.length - 50; idx--) {
            const v = ring.values[ring.index(idx)];
            if (Number.isFinite(v)) return s.toDisplay(v).toFixed(s.decimals);
          }
          return '--';
        })
      );
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [series, pausedAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const w = size.width;
      const h = size.height;
      const plotW = Math.max(10, w - LEFT - RIGHT);
      const plotH = Math.max(10, h - TOP - BOTTOM);
      const end = pausedAt ?? Date.now();
      const start = end - windowSec * 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Visible data range (display units).
      let dMin = Infinity;
      let dMax = -Infinity;
      const ranges = series.map((s) => {
        const ring = s.ring;
        const i0 = Math.max(0, ring.lowerBound(start) - 1);
        const i1 = ring.lowerBound(end + 1);
        for (let i = i0; i < i1; i++) {
          const v = ring.values[ring.index(i)];
          if (!Number.isFinite(v)) continue;
          const d = s.toDisplay(v);
          if (d < dMin) dMin = d;
          if (d > dMax) dMax = d;
        }
        return [i0, i1] as const;
      });
      const [yLo, yHi] = computeYRange(dMin, dMax, config?.yScale ?? 'auto', fixedMin, fixedMax);
      const ySpan = yHi - yLo || 1;
      const xOf = (t: number) => LEFT + ((t - start) / (end - start)) * plotW;
      const yOf = (v: number) => TOP + (1 - (v - yLo) / ySpan) * plotH;

      // Grid and axes.
      ctx.font = '11px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      const yCount = Math.max(3, Math.min(8, Math.floor(plotH / 22)));
      const yStep = niceStep(yLo, yHi, yCount);
      const yDec = stepDecimals(yStep);
      for (const v of niceTicks(yLo, yHi, yCount)) {
        const y = yOf(v);
        if (config?.showGrid ?? true) {
          ctx.strokeStyle = colors.grid;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(LEFT, Math.round(y) + 0.5);
          ctx.lineTo(LEFT + plotW, Math.round(y) + 0.5);
          ctx.stroke();
        }
        ctx.fillStyle = colors.label;
        ctx.textAlign = 'right';
        ctx.fillText(v.toFixed(yDec), LEFT - 5, y);
      }
      const xStepSec = niceStep(0, windowSec, Math.max(2, Math.min(6, Math.floor(plotW / 70))));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (let s = 0; s <= windowSec + 1e-9; s += xStepSec) {
        const x = LEFT + plotW - (s / windowSec) * plotW;
        if (config?.showGrid ?? true) {
          ctx.strokeStyle = colors.grid;
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, TOP);
          ctx.lineTo(Math.round(x) + 0.5, TOP + plotH);
          ctx.stroke();
        }
        ctx.fillStyle = colors.label;
        ctx.fillText(s === 0 ? (pausedAt ? 'paused' : 'now') : `-${s >= 60 && s % 60 === 0 ? `${s / 60}m` : `${Number(s.toFixed(1))}s`}`, x, TOP + plotH + 4);
      }

      // Series: one min/max pair per pixel column keeps 3000-sample windows cheap and spikes visible.
      ctx.save();
      ctx.beginPath();
      ctx.rect(LEFT, TOP, plotW, plotH);
      ctx.clip();
      series.forEach((s, si) => {
        const ring = s.ring;
        const [i0, i1] = ranges[si];
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        let penDown = false;
        let col = -1;
        let cMin = 0;
        let cMax = 0;
        let firstX = NaN;
        let lastX = NaN;
        const flush = () => {
          if (col < 0) return;
          const x = col + 0.5;
          if (!penDown) {
            ctx.moveTo(x, yOf(cMin));
            penDown = true;
          } else {
            ctx.lineTo(x, yOf(cMin));
          }
          if (cMax !== cMin) ctx.lineTo(x, yOf(cMax));
        };
        for (let i = i0; i < i1; i++) {
          const idx = ring.index(i);
          const v = ring.values[idx];
          if (!Number.isFinite(v)) {
            flush();
            col = -1;
            penDown = false;
            continue;
          }
          const d = s.toDisplay(v);
          const x = Math.floor(xOf(ring.times[idx]));
          if (Number.isNaN(firstX)) firstX = x;
          lastX = x;
          if (x !== col) {
            flush();
            col = x;
            cMin = d;
            cMax = d;
          } else {
            if (d < cMin) cMin = d;
            if (d > cMax) cMax = d;
          }
        }
        flush();
        ctx.stroke();

        if (si === 0 && (config?.fill ?? false) && Number.isFinite(firstX)) {
          // Re-trace as a closed shape for the fill.
          ctx.fillStyle = s.color;
          ctx.globalAlpha = 0.16;
          ctx.beginPath();
          let started = false;
          for (let i = i0; i < i1; i++) {
            const idx = ring.index(i);
            const v = ring.values[idx];
            if (!Number.isFinite(v)) continue;
            const x = xOf(ring.times[idx]);
            const y = yOf(s.toDisplay(v));
            if (!started) {
              ctx.moveTo(x, TOP + plotH);
              ctx.lineTo(x, y);
              started = true;
            } else ctx.lineTo(x, y);
          }
          ctx.lineTo(lastX, TOP + plotH);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      });
      ctx.restore();

      // Hover readout.
      const hx = hoverRef.current;
      if (hx !== null && hx >= LEFT && hx <= LEFT + plotW) {
        const t = start + ((hx - LEFT) / plotW) * (end - start);
        ctx.strokeStyle = colors.tick;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(hx) + 0.5, TOP);
        ctx.lineTo(Math.round(hx) + 0.5, TOP + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        const lines = series.map((s) => {
          const ring = s.ring;
          const i = Math.min(ring.length - 1, ring.lowerBound(t));
          let text = '--';
          if (i >= 0 && ring.length > 0) {
            const idx = ring.index(i);
            const v = ring.values[idx];
            if (Number.isFinite(v) && Math.abs(ring.times[idx] - t) < 1000) {
              text = `${s.toDisplay(v).toFixed(s.decimals)} ${s.unit}`.trim();
              ctx.fillStyle = s.color;
              ctx.beginPath();
              ctx.arc(hx, yOf(s.toDisplay(v)), 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          return { color: s.color, text: `${s.label}: ${text}` };
        });
        const ago = (end - t) / 1000;
        const header = ago < 0.05 ? 'now' : `-${ago.toFixed(1)}s`;
        ctx.font = '11px ui-monospace, monospace';
        const boxW = Math.max(...[header, ...lines.map((l) => l.text)].map((s) => ctx.measureText(s).width)) + 16;
        const boxH = 15 * (lines.length + 1) + 6;
        const bx = hx + 10 + boxW > LEFT + plotW ? hx - 10 - boxW : hx + 10;
        const by = TOP + 4;
        ctx.fillStyle = colors.panel;
        ctx.strokeStyle = colors.tickMinor;
        ctx.beginPath();
        ctx.rect(bx, by, boxW, boxH);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = colors.textMuted;
        ctx.fillText(header, bx + 8, by + 4);
        lines.forEach((l, i) => {
          ctx.fillStyle = l.color;
          ctx.fillText(l.text, bx + 8, by + 4 + 15 * (i + 1));
        });
      }
    };

    redrawRef.current = draw;
    draw();
    if (pausedAt !== null) return; // static while paused; hover triggers redraws
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        draw();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [size.width, size.height, series, windowSec, pausedAt, config?.yScale, config?.showGrid, config?.fill, fixedMin, fixedMax, colors]);

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    hoverRef.current = e.clientX - rect.left;
    if (pausedAt !== null) redrawRef.current();
  };
  const onPointerLeave = () => {
    hoverRef.current = null;
    if (pausedAt !== null) redrawRef.current();
  };

  return (
    <div className={`flex flex-col gap-1.5 h-full min-h-0 transition-opacity ${dimmed ? 'opacity-40' : ''}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap min-w-0 font-mono">
          {series.map((s, i) => (
            <span key={s.key + i} className="flex items-baseline gap-1 min-w-0">
              <span className="h-2 w-2 rounded-full shrink-0 self-center" style={{ background: s.color }} />
              {(series.length > 1 || legendLabels) && <span className="text-xs text-zinc-400 truncate">{s.label}</span>}
              <span className={`${series.length > 1 ? 'text-base' : 'text-2xl'} font-bold text-zinc-100`}>{latest[i] ?? '--'}</span>
              <span className="text-xs text-zinc-400">{s.unit}</span>
            </span>
          ))}
        </div>
        {controls && (
          <ChartControls
            windowSec={windowSec}
            onWindow={setWindowSec}
            paused={pausedAt !== null}
            onTogglePause={() => setPausedAt((p) => (p === null ? Date.now() : null))}
          />
        )}
      </div>
      <div ref={wrapRef} className="relative flex-1" style={{ minHeight: plotMinHeight }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={onPointerLeave}
        />
      </div>
    </div>
  );
};
