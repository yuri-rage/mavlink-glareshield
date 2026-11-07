// PID tuning: desired vs achieved for one controller, with its P / I / D / FF terms underneath, from PID_TUNING.
//
// The controllers offered depend on the vehicle type (and, when the parameter metadata is loaded, on the firmware
// version); see mavlink/pidTuning.ts. Reporting is switched per controller with GCS_PID_MASK, from the widget.
// Values are plotted as each message arrives (lib/pidTuningRecorder.ts), in the units the firmware reports.

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Eraser, Loader2, Radio } from 'lucide-react';
import { useTelemetryStore } from '../../store/telemetryStore';
import { useParamMetaStore } from '../../store/paramMetaStore';
import { mavlinkConnection } from '../../mavlink/connection';
import { messageRateManager } from '../../mavlink/rateManager';
import { getVehicleCategory, MAVLINK_MSG_ID, type VehicleCategory } from '../../mavlink/messages';
import { getParamMetadata } from '../../mavlink/paramMetadata';
import {
  maskHasBit,
  pidControllersFor,
  pidPickerAxes,
  withMaskBit,
  type PidController,
  type PidTuningField,
} from '../../mavlink/pidTuning';
import { pidTuningRecorder } from '../../lib/pidTuningRecorder';
import { cn } from '../../lib/utils';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { ChartControls, TimeSeriesChart, type ChartSeries } from './custom/TimeSeriesChart';
import { useVehicleTarget } from './custom/panelKit';

const MASK_PARAM = 'GCS_PID_MASK';
const ECHO_TIMEOUT_MS = 4000;
/** An axis counts as streaming when a message arrived this recently. */
const LIVE_MS = 2000;

const TERM_STYLE: Record<PidTuningField, { label: string; color: string; title: string }> = {
  desired: { label: 'Desired', color: '#38bdf8', title: 'Target the controller is asked to reach' },
  achieved: { label: 'Achieved', color: '#f59e0b', title: 'Measured response' },
  P: { label: 'P', color: '#10b981', title: 'Proportional term' },
  I: { label: 'I', color: '#a78bfa', title: 'Integrator term' },
  D: { label: 'D', color: '#f472b6', title: 'Derivative term' },
  FF: { label: 'FF', color: '#94a3b8', title: 'Feed-forward term' },
  SRate: { label: 'Slew', color: '#fb923c', title: 'Slew rate of the output (the slew limiter acts on this)' },
  PDmod: { label: 'PD mod', color: '#e879f9', title: 'P and D scaling applied by the slew limiter (1 = none)' },
};
const TERMS: PidTuningField[] = ['P', 'I', 'D', 'FF', 'SRate', 'PDmod'];
const DEFAULT_TERMS: PidTuningField[] = ['P', 'I', 'D', 'FF'];

const axisStorageKey = (category: VehicleCategory) => `glareshield_pid_axis_${category}`;
function loadAxis(category: VehicleCategory): number | null {
  try {
    const v = Number(localStorage.getItem(axisStorageKey(category)));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function saveAxis(category: VehicleCategory, axis: number) {
  try {
    localStorage.setItem(axisStorageKey(category), String(axis));
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

function series(axis: number, field: PidTuningField): ChartSeries {
  const style = TERM_STYLE[field];
  return {
    key: `pid-${axis}-${field}`,
    ring: pidTuningRecorder.ring(axis, field),
    label: style.label,
    color: style.color,
    unit: '',
    decimals: 3,
    toDisplay: (v: number) => v,
  };
}

/** Tracking error (achieved − desired) over the visible window: RMS and the largest magnitude. */
function trackingError(axis: number, windowSec: number, pausedAt: number | null): { rms: number; peak: number; n: number } {
  const des = pidTuningRecorder.ring(axis, 'desired');
  const ach = pidTuningRecorder.ring(axis, 'achieved');
  const end = pausedAt ?? Date.now();
  const i0 = des.lowerBound(end - windowSec * 1000);
  const i1 = des.lowerBound(end + 1);
  let sum = 0;
  let peak = 0;
  let n = 0;
  // Both rings get one entry per message (gaps included), so the same index is the same message.
  for (let i = i0; i < i1 && i < ach.length; i++) {
    const e = ach.values[ach.index(i)] - des.values[des.index(i)];
    if (!Number.isFinite(e)) continue;
    sum += e * e;
    if (Math.abs(e) > peak) peak = Math.abs(e);
    n++;
  }
  return { rms: n ? Math.sqrt(sum / n) : NaN, peak, n };
}

export const PidTuningWidget: React.FC = () => {
  const { sysId, compId } = useVehicleTarget();
  const linked = useTelemetryStore((s) => s.heartbeat.lastHeartbeatTime > 0 && s.heartbeat.modeName !== 'DISCONNECTED');
  const heartbeatType = useTelemetryStore((s) => s.heartbeat.type);
  const firmwareVersion = useTelemetryStore((s) => s.firmwareVersion);
  const maskEntry = useTelemetryStore((s) => s.parameters[MASK_PARAM]);
  const category = getVehicleCategory(heartbeatType);

  // The firmware's own GCS_PID_MASK bit list, when its metadata is loaded, trims the vehicle's controller list.
  const ensureMeta = useParamMetaStore((s) => s.ensure);
  const catalog = useParamMetaStore((s) => s.catalog);
  useEffect(() => {
    if (linked) ensureMeta(category, firmwareVersion);
  }, [linked, category, firmwareVersion, ensureMeta]);
  const maskBitmask = useMemo(() => (catalog ? getParamMetadata(MASK_PARAM)?.bitmask ?? null : null), [catalog]);
  const controllers = useMemo(() => pidControllersFor(category, maskBitmask), [category, maskBitmask]);

  // Axes that are arriving but aren't in the list still get a button.
  const [seen, setSeen] = useState(() => pidTuningRecorder.seenAxes());
  useEffect(() => pidTuningRecorder.onNewAxis(() => setSeen(pidTuningRecorder.seenAxes())), []);
  const axes = useMemo(() => pidPickerAxes(controllers, seen), [controllers, seen]);

  const [chosen, setChosen] = useState<number | null>(() => loadAxis(category));
  useEffect(() => setChosen(loadAxis(category)), [category]);
  const current: PidController | undefined = axes.find((a) => a.axis === chosen) ?? axes[0];
  const axis = current?.axis ?? 0;
  const pick = (a: number) => {
    setChosen(a);
    saveAxis(category, a);
  };

  const [terms, setTerms] = useState<PidTuningField[]>(DEFAULT_TERMS);
  const [windowSec, setWindowSec] = useState(30);
  const [pausedAt, setPausedAt] = useState<number | null>(null);

  // Ask for PID_TUNING while the widget is open; the vehicle sends it only for axes GCS_PID_MASK selects.
  useEffect(() => {
    messageRateManager.registerRequirement('pid-tuning', MAVLINK_MSG_ID.PID_TUNING);
    return () => messageRateManager.unregisterRequirement('pid-tuning');
  }, []);

  // Read GCS_PID_MASK if the parameter list hasn't brought it.
  useEffect(() => {
    if (!linked || maskEntry || axes.length === 0) return;
    mavlinkConnection.send(mavlinkConnection.getEncoder().createParamRequestRead(sysId, compId, -1, MASK_PARAM));
  }, [linked, maskEntry, axes.length, sysId, compId]);

  // GCS_PID_MASK writes, confirmed when the vehicle echoes the value.
  const [pending, setPending] = useState<{ value: number; since: number } | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  useEffect(() => {
    if (pending && maskEntry && Math.abs(maskEntry.value - pending.value) < 0.5) setPending(null);
  }, [maskEntry, pending]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setPending(null);
      setWriteError('No confirmation from the vehicle; GCS_PID_MASK may not have changed.');
    }, ECHO_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [pending]);
  const writeMask = (value: number) => {
    if (!maskEntry || maskEntry.type === undefined) return;
    setWriteError(null);
    mavlinkConnection.send(mavlinkConnection.getEncoder().createParamSet(sysId, compId, MASK_PARAM, value, maskEntry.type));
    setPending({ value, since: Date.now() });
  };

  // Streaming indicator and the error readout refresh a few times a second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);

  const mask = maskEntry?.value;
  const maskKnown = typeof mask === 'number' && Number.isFinite(mask);
  const reporting = current && current.bit >= 0 && maskKnown ? maskHasBit(mask, current.bit) : null;
  const live = axis > 0 && Date.now() - pidTuningRecorder.lastSeen(axis) < LIVE_MS;
  const err = axis > 0 ? trackingError(axis, windowSec, pausedAt) : { rms: NaN, peak: 0, n: 0 };
  const reportingNames = maskKnown ? axes.filter((a) => a.bit >= 0 && maskHasBit(mask, a.bit)).map((a) => a.label) : [];

  const mainSeries = useMemo(() => (axis ? [series(axis, 'desired'), series(axis, 'achieved')] : []), [axis]);
  const termSeries = useMemo(() => (axis ? terms.map((f) => series(axis, f)) : []), [axis, terms]);

  const header = (
    <CardHeader className="py-1.5 px-3 sm:px-3.5 bg-zinc-900/60 border-b border-zinc-800">
      <CardTitle className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-sky-400" />
          PID Tuning
        </span>
        <div className="flex items-center gap-1.5 normal-case tracking-normal font-normal">
          <ChartControls
            windowSec={windowSec}
            onWindow={setWindowSec}
            paused={pausedAt !== null}
            onTogglePause={() => setPausedAt((p) => (p === null ? Date.now() : null))}
          />
          <button
            type="button"
            onClick={() => pidTuningRecorder.clear()}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-zinc-800 hover:bg-zinc-800 text-[10px] font-bold text-zinc-300 uppercase"
            title="Clear the recorded history"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        </div>
      </CardTitle>
    </CardHeader>
  );

  if (axes.length === 0) {
    return (
      <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
        {header}
        <CardContent className="p-3 text-xs text-zinc-500">
          {linked
            ? 'This vehicle type does not report PID tuning (no GCS_PID_MASK).'
            : 'Connect to a vehicle to see the controllers it can report.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col border-zinc-800 bg-zinc-950/90 shadow-md">
      {header}
      <CardContent className="p-2.5 sm:p-3 flex-1 flex flex-col gap-2 min-h-0">
        {/* Controller picker: one button per controller this vehicle can report. */}
        <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Controller">
          {axes.map((a) => {
            const on = a.bit >= 0 && maskKnown && maskHasBit(mask, a.bit);
            const streaming = Date.now() - pidTuningRecorder.lastSeen(a.axis) < LIVE_MS;
            return (
              <button
                key={a.axis}
                type="button"
                role="tab"
                aria-selected={a.axis === axis}
                onClick={() => pick(a.axis)}
                title={`${a.description}${a.bit >= 0 ? ` · GCS_PID_MASK bit ${a.bit}` : ''}`}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-semibold',
                  a.axis === axis
                    ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                    : 'border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                )}
              >
                <span
                  className={cn('h-1.5 w-1.5 rounded-full', streaming ? 'bg-emerald-400' : on ? 'bg-amber-400' : 'bg-zinc-700')}
                  aria-hidden
                />
                {a.label}
              </button>
            );
          })}
        </div>

        {/* Reporting switch for the chosen controller (GCS_PID_MASK). */}
        <div className="flex items-center justify-between gap-2 flex-wrap rounded-md border border-zinc-800 bg-zinc-900/40 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-1.5 min-w-0 text-zinc-400">
            <Radio className={cn('h-3.5 w-3.5 shrink-0', live ? 'text-emerald-400' : 'text-zinc-600')} />
            <span className="truncate">
              <span className="font-mono text-zinc-300">GCS_PID_MASK</span>{' '}
              {maskKnown ? (
                <>
                  = <span className="font-mono text-zinc-200">{mask}</span>
                  {reportingNames.length > 0 ? ` · reporting ${reportingNames.join(', ')}` : ' · reporting nothing'}
                </>
              ) : linked ? (
                'reading…'
              ) : (
                'unknown (not connected)'
              )}
            </span>
          </div>
          {current && current.bit >= 0 && (
            <div className="flex items-center gap-1.5">
              {pending && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" aria-label="Waiting for the vehicle" />}
              <button
                type="button"
                disabled={!linked || !maskKnown || maskEntry?.type === undefined || pending !== null}
                onClick={() => maskKnown && writeMask(withMaskBit(mask, current.bit, !reporting))}
                className={cn(
                  'px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase disabled:opacity-40 disabled:cursor-not-allowed',
                  reporting
                    ? 'border-amber-600/50 text-amber-300 hover:bg-amber-500/10'
                    : 'border-emerald-600/50 text-emerald-300 hover:bg-emerald-500/10'
                )}
                title={`Sets GCS_PID_MASK bit ${current.bit}`}
              >
                {reporting ? `Stop ${current.label}` : `Report ${current.label}`}
              </button>
              {maskKnown && mask > 0 && (
                <button
                  type="button"
                  disabled={!linked || pending !== null}
                  onClick={() => writeMask(0)}
                  className="px-2 py-0.5 rounded-md border border-zinc-700 text-[10px] font-bold uppercase text-zinc-400 hover:bg-zinc-800 disabled:opacity-40"
                  title="Set GCS_PID_MASK to 0: stop all PID_TUNING reporting"
                >
                  Stop all
                </button>
              )}
            </div>
          )}
        </div>
        {writeError && <p className="text-[11px] text-amber-400">{writeError}</p>}

        {/* Desired vs achieved. */}
        <div className="flex-[3] flex flex-col min-h-0">
          <TimeSeriesChart
            series={mainSeries}
            config={{ yScale: 'auto' }}
            fixedMin={0}
            fixedMax={1}
            windowSec={windowSec}
            pausedAt={pausedAt}
            controls={false}
            plotMinHeight={140}
          />
          <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-zinc-500">
            <span title="Root-mean-square of achieved − desired over the visible window">
              error RMS <span className="text-zinc-300">{Number.isFinite(err.rms) ? err.rms.toFixed(3) : '--'}</span>
            </span>
            <span title="Largest |achieved − desired| over the visible window">
              peak <span className="text-zinc-300">{err.n ? err.peak.toFixed(3) : '--'}</span>
            </span>
            <span>{err.n} samples</span>
          </div>
          {err.n === 0 && !pausedAt && (
            <p className="mt-1 text-[11px] text-zinc-500">
              {reporting === false
                ? `No data: ${current?.label} isn't selected in GCS_PID_MASK. Report it above to start the stream.`
                : reporting
                  ? 'Waiting for PID_TUNING from the vehicle…'
                  : 'No PID_TUNING for this controller yet.'}
            </p>
          )}
        </div>

        {/* Controller terms. */}
        <div className="flex-[2] flex flex-col min-h-0 border-t border-zinc-900 pt-1.5 gap-1">
          <div className="flex items-center gap-1 flex-wrap">
            {TERMS.map((f) => {
              const on = terms.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTerms((t) => (on ? t.filter((x) => x !== f) : TERMS.filter((x) => x === f || t.includes(x))))}
                  title={TERM_STYLE[f].title}
                  className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold',
                    on ? 'border-zinc-600 text-zinc-200 bg-zinc-800/60' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: on ? TERM_STYLE[f].color : '#3f3f46' }} />
                  {TERM_STYLE[f].label}
                </button>
              );
            })}
          </div>
          {termSeries.length > 0 ? (
            <TimeSeriesChart
              series={termSeries}
              config={{ yScale: 'auto' }}
              fixedMin={0}
              fixedMax={1}
              windowSec={windowSec}
              pausedAt={pausedAt}
              controls={false}
              plotMinHeight={90}
            />
          ) : (
            <p className="text-[11px] text-zinc-500 py-2">Pick terms to plot.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
