import React from 'react';
import type { WidgetDataBinding, WidgetGaugeConfig } from '../../../types/widget';
import { arcPath, niceStep, niceTicks, polar, stepDecimals, thresholdZones, valueToAngle } from '../../../lib/gaugeGeometry';
import { ZONE_HEX, useChromeColors, useSmoothedValue } from './palette';

export interface RadialGaugeProps {
  /** Values below are all in display units. */
  value: number | null;
  text: string;
  unit: string;
  min: number;
  max: number;
  /** The binding whose thresholds (already in display units) define the zones. */
  zoneBinding?: WidgetDataBinding;
  config?: WidgetGaugeConfig;
  accent: string;
  secondary?: { value: number | null; text: string; label: string } | null;
  dimmed?: boolean;
}

const CX = 100;
const CY = 100;
const R = 70;

/** viewBox height per sweep, so the dial fills its box without empty space below the arc ends. */
const VIEW_HEIGHT: Record<number, number> = { 180: 150, 240: 158, 270: 172 };

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  value,
  text,
  unit,
  min,
  max,
  zoneBinding,
  config,
  accent,
  secondary,
  dimmed,
}) => {
  const colors = useChromeColors();
  const sweep = config?.sweep ?? 240;
  const style = config?.style ?? 'both';
  const half = sweep / 2;
  const viewHeight = VIEW_HEIGHT[sweep] ?? 160;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max) > lo ? Math.max(min, max) : lo + 1;

  const shown = useSmoothedValue(value);
  const shownSecondary = useSmoothedValue(secondary?.value ?? null);
  const angle = valueToAngle(shown ?? lo, lo, hi, sweep);
  const secondaryAngle = shownSecondary !== null ? valueToAngle(shownSecondary, lo, hi, sweep) : null;

  const majorCount = Math.max(2, Math.min(12, config?.majorTicks ?? 5));
  const majors = niceTicks(lo, hi, majorCount);
  const step = niceStep(lo, hi, majorCount);
  const minorPer = Math.max(0, Math.min(9, config?.minorTicks ?? 4));
  const minors: number[] = [];
  if (minorPer > 0) {
    const minorStep = step / (minorPer + 1);
    for (let v = Math.ceil(lo / minorStep - 1e-9) * minorStep; v <= hi + 1e-9; v += minorStep) {
      if (!majors.some((m) => Math.abs(m - v) < minorStep * 1e-3)) minors.push(v);
      if (minors.length > 400) break;
    }
  }
  const labelDecimals = stepDecimals(step);
  const zones = (config?.showZones ?? true) ? thresholdZones(zoneBinding, lo, hi) : [];

  const valueY = sweep === 180 ? CY + 27 : CY + 33;
  const showArc = style === 'arc' || style === 'both';
  const showNeedle = style === 'needle' || style === 'both';
  const tip = polar(CX, CY, R - 10, angle);
  const baseL = polar(CX, CY, 4.5, angle - 90);
  const baseR = polar(CX, CY, 4.5, angle + 90);
  const tail = polar(CX, CY, 14, angle + 180);

  return (
    <svg
      viewBox={`0 0 200 ${viewHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className={`w-full h-full transition-opacity ${dimmed ? 'opacity-40' : ''}`}
      role="img"
      aria-label={`${text} ${unit}`}
    >
      {/* Track */}
      <path d={arcPath(CX, CY, R, -half, half)} stroke={colors.track} strokeWidth={9} fill="none" strokeLinecap="butt" />

      {/* Threshold zones, as a thin band inside the track */}
      {zones.map((z) => (
        <path
          key={`${z.level}-${z.from}`}
          d={arcPath(CX, CY, R - 8.5, valueToAngle(z.from, lo, hi, sweep), valueToAngle(z.to, lo, hi, sweep))}
          stroke={ZONE_HEX[z.level]}
          strokeOpacity={z.level === 'normal' ? 0.55 : 0.85}
          strokeWidth={3}
          fill="none"
        />
      ))}

      {/* Value arc */}
      {showArc && shown !== null && angle > -half + 0.05 && (
        <path d={arcPath(CX, CY, R, -half, angle)} stroke={accent} strokeWidth={9} fill="none" strokeLinecap="butt" />
      )}

      {/* Ticks */}
      {minors.map((v) => {
        const a = valueToAngle(v, lo, hi, sweep);
        const p1 = polar(CX, CY, R + 6, a);
        const p2 = polar(CX, CY, R + 9.5, a);
        return <line key={`m${v}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.tickMinor} strokeWidth={1} />;
      })}
      {majors.map((v) => {
        const a = valueToAngle(v, lo, hi, sweep);
        const p1 = polar(CX, CY, R + 5, a);
        const p2 = polar(CX, CY, R + 12, a);
        const lp = polar(CX, CY, R + 21, a);
        return (
          <g key={`M${v}`}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={colors.tick} strokeWidth={1.6} />
            <text
              x={lp.x}
              y={lp.y}
              fill={colors.label}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {v.toFixed(labelDecimals)}
            </text>
          </g>
        );
      })}

      {/* Secondary marker (e.g. target): a notch outside the track */}
      {secondaryAngle !== null && (
        <g>
          {(() => {
            const p = polar(CX, CY, R + 4, secondaryAngle);
            const l = polar(CX, CY, R + 13, secondaryAngle - 4);
            const r = polar(CX, CY, R + 13, secondaryAngle + 4);
            return (
              <polygon
                points={`${p.x},${p.y} ${l.x},${l.y} ${r.x},${r.y}`}
                fill="#d946ef"
                stroke={colors.panel}
                strokeWidth={0.8}
              />
            );
          })()}
        </g>
      )}

      {/* Needle */}
      {showNeedle && shown !== null && (
        <g>
          <polygon
            points={`${tip.x},${tip.y} ${baseL.x},${baseL.y} ${tail.x},${tail.y} ${baseR.x},${baseR.y}`}
            fill={style === 'needle' ? accent : colors.needle}
          />
          <circle cx={CX} cy={CY} r={5.5} fill={colors.pivot} />
          <circle cx={CX} cy={CY} r={2.2} fill={colors.track} />
        </g>
      )}

      {/* Readout */}
      <text
        x={CX}
        y={valueY}
        fill={colors.text}
        fontSize={sweep === 180 ? 20 : 22}
        fontWeight={700}
        stroke={colors.backdrop}
        strokeWidth={4}
        paintOrder="stroke"
        strokeLinejoin="round"
        fontFamily="ui-monospace, monospace"
        textAnchor="middle"
      >
        {text}
        <tspan fontSize={10} fontWeight={400} fill={colors.textMuted} dx={3} strokeWidth={3}>
          {unit}
        </tspan>
      </text>
      {secondary && (
        <text
          x={CX}
          y={valueY + 15}
          fill="#d946ef"
          stroke={colors.backdrop}
          strokeWidth={3}
          paintOrder="stroke"
          fontSize={9.5}
          fontFamily="ui-monospace, monospace"
          textAnchor="middle"
        >
          ▼ {secondary.label} {secondary.text}
        </text>
      )}
    </svg>
  );
};
